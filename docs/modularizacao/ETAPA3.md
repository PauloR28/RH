# Etapa 3 — Fundação no backend (relatório)

## O que foi feito

| Item | Onde |
|---|---|
| Catálogo de módulos e dono padrão de cada permissão (dados puros) | `apps/backend/rh_api/modulos_catalogo.py` |
| Perfis de TI: administração completa de `core` + `tecnologia` (decisão 2/D-10) | `rbac.py` (`PERMISSOES_ADMINISTRACAO_TI`, 40 permissões) · `PERMISSIONS_VERSION = "2026-10-03-modularizacao"` |
| Schema: V055 `modulos_sistema`, V056 `permissoes.modulo_dono/abre_modulo`, V057 perfis de TI (+ rollbacks) | `repositories/modulos_schema.py` (fonte única) → `infra/sql/migrations/V055…V057` (+ `.rollback.sql`); espelhado no bootstrap (`ensure_modulos_schema`) |
| Ponto único de acesso | `services/acesso.py` (visibilidade, filtro por módulo ativo, cache 15 s, falha → padrões do catálogo) |
| Guarda de módulo nas rotas existentes | `dependencies.get_current_user`: remove do usuário, **por pedido**, as permissões de módulos desativados. Cobre as 394 `require_permissions`, as `ensure_user_permission` e qualquer `user.has_permission` inline. Nenhuma URL/contrato mudou. |
| Endpoint do core | `GET /core/acesso` (módulos visíveis + padrão + permissões efetivas) |
| Endpoints de Tecnologia | `GET /tecnologia/modulos`, `PUT /tecnologia/modulos/{chave}` (liga/desliga; core e tecnologia recusam, 409), `PUT /tecnologia/permissoes/{chave}/modulo` (reatribuir dono — a "configurabilidade"; recusa mover a permissão que abre a Tecnologia). Auditados. |
| Trava do Administrador | `repositories/security.py::_garantir_fronteira_administrador`: só o Administrador cria/edita/ativa/bloqueia/exclui/redefine senha-MFA de usuário Administrador, atribui esse perfil ou edita as permissões dele. Perfis de TI administram todo o resto. |

## Desvios do PLANO (e por quê)

1. **V057 em vez de V058**, e **sem tabela `sistema_parametros`**: já existe `dbo.parametros_sistema` (chave/valor, com categoria `sistema_interno` que a tela de parâmetros esconde e não deixa editar — `repositories/sistema.py:200/226`). A flag do WFM (Etapa 4) usará essa tabela, categoria `sistema_interno`. Menos uma tabela nova.
2. A guarda ficou em `get_current_user` (filtro de permissões por pedido) em vez de dentro de cada `require_permissions`: um ponto só, cobre também as checagens inline (inclusive `POST /settings/users/{id}/status`).
3. O dono de `onboarding.editar` é **core** (D-9) e `sessao.gestao/drive/treinamentos` também (não abrem módulo).

## Matriz perfil × módulo (verificada por teste, flag fechada → aberta)
Administrador: rh, operacao, tecnologia · Gestor: rh, operacao · Analista(rh)/DP/Estagiário: rh · Supervisor/Control Desk/Qualidade/Operador: operacao · Funcionário/Candidato: só core · **Analista de TI: operacao + tecnologia (seletor)** · **Técnicos de TI: tecnologia (e operacao quando a flag abre o WFM)**. Igual ao §9 do PLANO.

## Diferenças de acesso em relação ao snapshot da Etapa 2 (a única mudança aprovada)
- Perfis de TI ganham as 40 permissões de core/tecnologia (Analista de TI +37, Técnicos +38; nada de RH/Operação/WFM novo; `wfm.escala.criar` segue só no Analista). Rotas e telas desses 4 perfis só **crescem**, com **uma** exceção: perdem `screen-processes-open`. Motivo: hoje o frontend não restringe sessão a quem não tem nenhuma chave `sessao.*`, então os Técnicos abriam essa tela (que não exige permissão e só aparece vazia); ao receber `sessao.gestao/drive/treinamentos/configuracoes` passam a ser restringidos como todo mundo. É um efeito colateral aceitável e coberto pelo teste (só pode "perder" telas sem permissão própria).
- Nenhum outro perfil muda (testes `test_matriz_acesso_caracterizacao.py` verdes, 9).

## Migrations: ciclo testado (banco descartável `RH_Provas_modularizacao`)
Aplicar V055–V057 → 114 concessões registradas no log, 156 permissões com dono (core 16, rh 79, operacao 37, tecnologia 25), 6 que abrem módulo → reaplicar (idempotente, sem mudança) → rollback V057→V055 → estado idêntico ao original (897 linhas de `perfil_permissoes`, mesmo checksum, colunas/tabelas/constraints removidos) → rollback repetido (sem erro) → reaplicar. Detalhe: o rollback da V057 só remove o que o log da própria V057 registra; linhas que o bootstrap tenha inserido antes não são tocadas.
O que **não** foi aplicado: o DEV compartilhado (`RH_Provas`) ainda não tem V055–V057 (o código funciona sem elas: cai nos padrões do catálogo).

## Testes novos
`test_acesso_modulos.py` (16: dono por decisão do RH, matriz perfil×módulo nos dois estados da flag, módulo desativado, protegidos, falha de leitura, reatribuição, `/core/acesso`, guarda 403, enumeração de rotas sem permissão declarada), `test_modulos_schema.py` (11: migrations geradas do mesmo DDL, aditivas, rollback exato, trava do Administrador), `test_modulos_integration.py` (5, contra o banco; pula sem V055/V056). Caracterização atualizada: TI só ganha core/tecnologia, só o Analista cria escala.

## Riscos / pendências para você
- **Todos os usuários precisam logar de novo no deploy** (`PERMISSIONS_VERSION`).
- O banco de cada ambiente manda (achado da Etapa 2): V057 insere o que falta e **não** reescreve nenhuma linha existente (nem negação explícita do Administrador).
- Rotas ainda sem permissão declarada (61, congeladas em `snapshots/rotas_sem_permissao.json`): públicas, autoatendimento (`/auth/me*`) e algumas com checagem na camada de repositório (`/emails/enviar`, `/policies/*`, `/celebratory-dates`, `/settings/users/{id}/status`). Não pertencem a módulo desativável por design (core).
- Suíte completa contra a cópia: **700 passam, 11 falham, 5 desselecionados**. As 11 falhas são pré-existentes e não relacionadas (8 `test_onedrive_upload_guardrails`, `test_e2e_login_bypass`, `test_lgpd_retencao::test_executar_apaga_so_quem_venceu` — falha idêntica no DEV não migrado —, `test_monitoria_fluxo_integration::test_tipos_de_atendimento_pertencem_a_operacao_e_canal`). Correção ao relatório da Etapa 0: as 10 falhas sem integração eram 8 do OneDrive + e2e + lgpd. Os 5 desselecionados são `test_trigger_bloqueia_update_e_delete_direto`: o `DELETE FROM dbo.monitoria_logs` do teste fica >5 min no SQL Express (memória), por ambiente; passou no baseline da Etapa 2.
