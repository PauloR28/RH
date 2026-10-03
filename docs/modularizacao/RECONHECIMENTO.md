# Modularização do Conecta — Etapa 0: Reconhecimento

Data: 02/out/2026 · Nenhum código foi alterado. Única escrita: este arquivo (e um `_baseline_pytest.txt` temporário, descartável).
Consultas ao banco foram **somente leitura** (banco de desenvolvimento, via `.env`).

---

## 1. Stack real

| Camada | Realidade |
|---|---|
| Backend | Python 3.13, **FastAPI** 0.135, pydantic 2, uvicorn. **Sem ORM**: SQL puro via `pyodbc` (SQL Server). Pacote `apps/backend/rh_api` (camadas `routers/ services/ repositories/ schemas/`) e um pacote irmão `apps/backend/conecta` (domínio/aplicação em estilo hexagonal; usado hoje para `AuthorizationPolicy` em `dependencies.py:15`). |
| Frontend | **JavaScript puro, sem bundler** (ES modules servidos estáticos; Vite só opcional). UI em `htm`/React vendorizado (`infraestrutura-react.js`). Carregamento sob demanda **já existe** por tela: `carregarTela(() => import('../features/wfm/index.js?v=…'))` (`app/aplicacao-raiz.js:122`). Cache-busting manual por `?v=`. |
| App Android | `app-treinamento-colaborador/` (Expo/React Native + axios). |
| Migrations | Arquivos SQL idempotentes em `infra/sql/migrations/V0NN__nome.sql` (+ `.rollback.sql` em **11** das 54). **Última: V054** (`V054__wfm_troca_antecedencia.sql`). Aplicadas por `infra/scripts/powershell/aplicar-migrations.ps1`, que **reaplica todas** a cada deploy (não há tabela de controle de versão aplicada — a segurança vem de cada script ser idempotente). O schema WFM nasce de `repositories/wfm_schema.py` e o script `.sql` é "gerado" dele (há teste de drift: `test_schema_source_of_truth_drift.py`). Existe também bootstrap automático de schema na subida (`main.py:268`, desligável). |
| Testes | pytest, **676 testes** coletados (`pytest.ini` → `apps/backend/tests`); CI (`.github/workflows/ci.yml`): `ruff check` + `pytest -q` + `node --check` + smoke de frontend + build Docker + Trivy. Playwright E2E em `apps/frontend/tests-e2e`. |

## 2. Git: branch, relação com a main, de onde partir

- Branch atual: **`wfm`**. `git log main..wfm` = **9 commits** (`b5aeae3` … `7f1eff5`); `git log wfm..main` = **0**. Ou seja: **o WFM não está integrado à main**, e `wfm` é um *fast-forward* da `main`. A main já contém Monitoria (último commit `629ed9c`).
- Árvore de trabalho: só `?? trilha-qa-conecta.html` (não relacionado).
- **Recomendação: criar a branch da tarefa a partir de `wfm`** (ex.: `modularizacao`), pois (a) a tarefa mexe diretamente em WFM (flag, tela emprestada, perfis de TI, `rbac.py` que só tem as permissões `wfm.*` nessa branch) e (b) partir da main perderia tudo isso e causaria conflito certo em `rbac.py`, `auth.py`, `dependencies.py`.
- ⚠ **Risco de deploy:** `.github/workflows/deploy-producao.yml:5` faz **deploy automático em produção em todo push para `main`**. Qualquer merge `wfm → main` (inclusive um simples fast-forward) vai para produção sem passo de aprovação. Como a regra desta tarefa é "nada vai para produção sem sua aprovação", sugiro **nunca fazer push/merge na `main` nesta tarefa** e que a branch de trabalho não tenha o nome `main`; o deploy em teste/homologação deve ser manual (ver §11, dúvida D-5).

## 3. Como o acesso é verificado hoje

### Backend
1. **Fonte da verdade no código:** `rh_api/rbac.py` — catálogo `PERMISSION_DEFINITIONS` (**156 permissões**, `rbac.py:168`) e `ROLE_PERMISSIONS` por perfil (`rbac.py:464`), com várias camadas *aditivas* por cima (Monitoria `:637-681`, sessões `:687-710`, WFM `:717-780`).
2. **Persistência:** o bootstrap faz *seed* em `permissoes` e `perfil_permissoes` com `IF NOT EXISTS` — **só insere, nunca remove nem sobrescreve** (`repositories/bootstrap.py:~270-290`). O que o Administrador edita na tela Perfis e Permissões grava em `perfil_permissoes` (`repositories/security.py:~1300-1320`).
3. **Login/token:** `security.py:_get_role_permissions_from_db` (`:225-244`) lê `perfil_permissoes` e as **embute no token**; `auth.py:validate_access_token` (`:270-290`) lê do token. Mudou o catálogo → sobe `PERMISSIONS_VERSION` (`rbac.py:30`) e todos os tokens antigos caem em 401 ("faça login de novo").
4. **Guarda nas rotas:** `dependencies.py:117 require_permissions(...)` (**394** usos em `routers/*.py`) e `ensure_user_permission` (18 usos). **Não há guarda por módulo hoje.** Vários routers **não têm prefixo** (`processes`, `interviews`, `pipeline`, `analytics`, `history`, `scorecards`, `email_inbox`, `operations`, `generated_exams`…), então uma guarda de módulo "por prefixo de URL" **não** serve; terá de ser por dependência no router/rota ou por tabela rota→módulo.
5. **Escopo por operação:** `dependencies.py:28-57 _refresh_monitoria_scope` relê `usuarios_operacoes` a cada requisição em `/monitoria` e `/wfm` (globais: `services/wfm_scope.py:28` `PERFIS_GLOBAIS = {Administrador, Gestor}`). `ensure_resource_scope` (`:176`).
6. **Regras de domínio do WFM** em `services/wfm_scope.py` (listas de perfis por ação, ex.: `pode_aprovar` `:129`, `pode_editar_tipos_escala` `:116`) — **não** passam por `perfil_permissoes`; são checagens por **ID de perfil**. Importante para a decisão 2 (ver R-6).

### Frontend
- `app/controlador-aplicacao.js`: `PERMISSOES_TELAS` (tela → permissão, `:~130-231`) e `SESSAO_DA_TELA` (tela → sessão, `:236-283`); `podeAcessarTela` (`:1159`) = permissão da tela **e** chave `sessao.X.acessar`. Se o token não traz nenhuma chave `sessao.*`, não restringe nada (compatibilidade).
- O conceito de **sessão** (9: curriculos, processos, provas, gestao, drive, treinamentos, monitoria, wfm, configuracoes) já existe nos dois lados — é o embrião do módulo, mas é mais fino (um módulo agrupará várias sessões).
- Listas de perfis fixas no frontend (vão contra a Etapa 7): `ICONE_POR_PERFIL` e `SESSOES_PERMISSAO` em `features/configuracoes/index.js:76/~108`; literais de perfil em `features/monitoria/{painel,listas,index,comum,detalhe}.js` e `configuracoes/monitoria-config.js` (29 ocorrências); `controlador-aplicacao.js:1161` (`perfilUsuario === 'supervisor'`).

## 4. Permissões × módulo (proposta)

156 permissões. Convenções: **core** = compartilhado/invisível; **rh**, **operacao**, **tecnologia**. `?` = dúvida (decisão sua). Contagem por grupo atual do catálogo (campo `module` do `PermissionDefinition`).

| Grupo atual (`module`) | Qtde | Proposta | Obs. |
|---|---|---|---|
| Geral (`inicio.visualizar`, `dashboard.visualizar`) | 2 | **core** | `dashboard.visualizar` hoje é funil de RH → **dúvida** (core vs rh). |
| Notificações | 2 | **core** | `notificacoes.configurar` → **dúvida** (tecnologia?). |
| Vagas · Processos · Candidatos · Entrevistas · Provas · Documentos · Etapas e Trilhas · Fit Cultural · Templates de Documentos | 9+4+17+7+11+7+2+2+2 | **rh** | |
| Onboarding (Central de Treinamentos) | 6 | **rh** | ⚠ ver R-3: Operador, Funcionário e Supervisor têm *só* isto de RH. |
| E-mails | 3 | **rh ?** | Hoje concede a sessão `configuracoes` a Estagiário/DP/RH (ver R-2). |
| OneDrive (Drive) | 3 | **rh ?** | Usado pelo RH/DP/Gestor; poderia ser core. |
| Relatórios | 2 | **rh ?** | Gestor usa também para Monitoria/WFM. |
| Calendário · Políticas | 2+2 | **rh ?** | Calendário tem sincronização com SharePoint. |
| **Mural** | 4 | **? (core ou rh)** | Você pediu para marcar. Hoje na sessão "Gestão"; **todos os perfis** recebem `mural.visualizar` → se for `rh`, Operador/Funcionário/Supervisor ganhariam o módulo RH só por isso. Minha sugestão: **core** (comunicado institucional). |
| Monitoria | 15 | **operacao** | |
| WFM | 20 | **operacao** | Tela emprestada à TI = mesmas permissões, sem duplicar (decisão 4). |
| Configurações · Usuários · Logs · Central de Ajuda | 2+12+2+2 | **tecnologia** | |
| LGPD | 5 | **tecnologia ?** | Anonimizar/exportar são administração; `lgpd.visualizar` é dado a DP/Gestor → **dúvida**. |
| Operações | 2 | `visualizar` = **core**; `editar` = **tecnologia** | ⚠ ver R-2: `operacoes.visualizar` é dado a quase todos; se fosse "tecnologia", daria módulo a Control Desk/Qualidade/Analista de TI. |
| Sessões (`sessao.*.acessar`) | 9 | herdam: curriculos/processos/provas/treinamentos → **rh**; gestao/drive → **rh ?**; monitoria/wfm → **operacao**; configuracoes → **tecnologia** | ⚠ ver R-2 sobre `sessao.configuracoes.acessar`. |

Matriz preliminar simulada (perfil → módulos que a regra "≥1 permissão do módulo" daria, **com esta proposta ingênua**, WFM fechado; só módulos com ≥1 permissão), para mostrar onde a regra literal erra:

| Perfil (usuários DEV) | rh | operacao | tecnologia | Problema |
|---|---|---|---|---|
| Administrador | ✔ | ✔ | ✔ | ok |
| Gestor (1) | ✔ | ✔ | **✔ (indevido)** | `lgpd.visualizar` + `sessao.configuracoes.acessar` |
| Analista/rh (1) | ✔ | — | **✔ (indevido)** | `emails.*`, `sessao.configuracoes.acessar` |
| DP · Estagiário (0) | ✔ | — | **✔ (indevido)** | idem |
| Supervisor (1) | ✔ (treinamentos) | ✔ | — | ok, mas vê 2 módulos |
| Control Desk (1) · Qualidade (1) | — | ✔ | — (se `operacoes.visualizar`=core) | ok |
| **Operador (2)** | **✔ (só Treinamentos)** | ✔ (Monitoria) | — | R-3 |
| Funcionário (0) | ✔ (só Treinamentos) | — | — | R-3 |
| Analista de TI (1) · Técnicos (2) | — | ✔ (WFM; ✘ com WFM fechado para Técnicos) | — | decisão 2 muda isto |

## 5. Onde `RH_WFM_LIBERAR_PARTICIPANTES` é lida (direta e indireta)

Leitura **única, na importação do módulo** (exige reinício para valer):
- `rbac.py:753` — `WFM_PARTICIPANTES_LIBERADO` (aceita `1/true/sim/yes/on`); `rbac.py:754` `WFM_PERFIS_EM_TESTE_FECHADO` = Operador, Qualidade, Técnico Jr/Pl/Sr.
- `rbac.py:755-760` — **na carga do módulo**, decide se as permissões WFM desses perfis entram em `ROLE_PERMISSIONS` (⇒ no seed do bootstrap, no fallback sem banco e nos testes).
- `rbac.py:880-886 aplicar_restricao_wfm_em_teste()` — filtra `wfm.*` e `sessao.wfm.acessar` mesmo que estejam gravadas no banco/token. Chamada em:
  - `auth.py:167` (`_user_from_record`), `auth.py:284` (`validate_access_token`), `repositories/security.py:244` (`_get_role_permissions_from_db`).
- Indiretos: tudo que consome `ROLE_PERMISSIONS`/`get_role_permissions` — `bootstrap.py` (seed), `auth.py` (login por usuário de ambiente), testes. Não há leitura no frontend, em `infra/`, `.env.example`, compose nem workflows (grep sem ocorrências).
- Testes: `tests/conftest.py:9` força `=1` para toda a suíte; `test_wfm_aprovacao_ti.py:463-495` roda subprocessos com a variável vazia.
- ⚠ Particularidade: `perfil_permissoes` **já contém** as permissões WFM desses perfis no banco DEV (Técnicos = 6, Qualidade = 16, Operador = 13); o bloqueio hoje acontece **na leitura** (`aplicar_restricao…`), não por ausência de linhas. A substituição por configuração em banco (Etapa 4) precisa manter esse desenho (filtro na leitura), senão mudar o valor não teria efeito sem reseed.
- Como a leitura é na importação, **um botão em tempo de execução exige mudar o desenho** (consultar a config a cada login/requisição, com cache curto) — e há o token: o token embute as permissões, então a flag precisa ser reaplicada também em `validate_access_token` (já é — `auth.py:284`), porém **a lista só se atualiza no próximo login/refresh** para quem estiver logado se mexermos só no filtro de login. Detalhar no PLANO.
- Valor atual da flag no DEV: **não definida** no `.env` (`RH_WFM_LIBERAR_PARTICIPANTES` ausente) ⇒ **fechada**. Em teste/homologação/produção: não consegui verificar (não tenho acesso aos `.env` desses ambientes; `infra/docker/env/*.env.example` não citam a variável). **Preciso que você informe o valor atual em cada ambiente** (Etapa 4 exige "valor inicial igual ao atual").

## 6. Como a equipe de TI está representada hoje

Já existe — **recomendo reaproveitar, não criar "Suporte TI"**:
- **Operação `TI`** (chave `'TI'`, nome "Tecnologia (TI)", ativa) em `dbo.operacoes`, semeada por `wfm_schema.py:486-489` (`_OPERACAO_TI_SQL`), presente no DEV. Mesma operação aparece na lista de operações do sistema inteiro (processos, monitoria etc.) — a ocultação nesses outros contextos precisa ser verificada no PLANO.
- **Tipos de escala** em `dbo.wfm_tipos_escala` com chave virtual `TI::PLANTAO-SABADO`, `TI::SOBREAVISO` (semeados em `wfm_schema.py:497-499`); `services/wfm_scope.py:34 OPERACOES_SO_TIPOS = {"TI"}` (a operação TI não tem escala "principal", só as escalas criadas). `operacao_base()` (`:37`) separa `TI::X` → `TI`.
- **Vínculos no DEV:** `usuarios_operacoes` com operação `TI`: 1 Analista de TI + 2 Técnico Pleno. `equipes_operacao`: **nenhuma equipe de TI**.
- **Escopo:** Analista de TI e Técnicos **não** são globais (`PERFIS_GLOBAIS` = Administrador, Gestor) — o escopo vem do vínculo `usuarios_operacoes`. Ou seja, o isolamento "TI não vê outras operações" já existe por vínculo; o que falta é o **menu no módulo tecnologia**.
- Perfis TI hoje: Analista de TI com 23 permissões (WFM completo de gestão, sem Monitoria/`usuarios.*`); Técnicos com 6 (Operador-like, bloqueadas pela flag).

## 7. Rotas que o app Android consome

Encontradas em `app-treinamento-colaborador/src/services/*` (o repositório inclui o app e seu CLAUDE.md):
`POST /auth/app/login-email`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`,
`GET /onboarding/meus-treinamentos`, `GET /onboarding/meus-treinamentos/presenciais`,
`POST /onboarding/meus-treinamentos/itens/{id}/concluir`,
`GET /onboarding/itens/{id}/video`, `GET /onboarding/secoes-imagens/…` (mídia),
`GET /estilos/avatares/{avatar}.png` e `/estilos/tokens.css` (estáticos).
Todas ficarão sob guarda de módulo **rh** (Onboarding). Consequências: o usuário do app (Funcionário/Operador) precisa continuar passando na guarda — o módulo `rh` **não pode** ser desligável sem derrubar o app; `/auth/*` e estáticos ficam fora da guarda (core). O contrato de `GET /auth/me`/`/auth/login` (`LoginResponse`) só pode receber campos **novos**, nunca remoção/renomeação.

## 8. Testes existentes

- 676 testes; ~20 arquivos tocam permissões/perfis (`test_wfm_aprovacao_ti.py`, `test_monitoria_foundation.py`, `test_security_foundation.py`, `test_resource_scope*.py`, `test_wfm_scope.py`, `test_usuarios_massa.py`…). **Não existe teste de caracterização da matriz perfil × rota/tela** — a Etapa 2 é de fato necessária. Cobertura de permissões é *pontual por funcionalidade*, não sistemática.
- Rodar: `.venv\Scripts\python.exe -m pytest -q` (da raiz). Integrações usam o **banco DEV real** (`tests/_integracao_dev.py` — pulam se não houver banco). ⚠ Rodar a suíte escreve no banco DEV.
- Baseline (parcial): em execução parcial (`-x`) 132 passaram e **1 falhou antes de qualquer alteração minha**: `test_e2e_login_bypass.py::test_e2e_login_returns_404_in_production_even_with_matching_secret` (`ConfigurationError: RH_AUTH_TOKEN_SECRET deve ter ao menos 32 caracteres em PROD` — depende do `.env` local; falha de ambiente, não de código). Resultado da execução completa: ver §12 (anexado ao fim quando concluir).
- Front: smoke/checagens estáticas no CI e Playwright em `apps/frontend/tests-e2e` (não executado aqui).

## 9. Banco DEV hoje (conferência do que o documento afirma)

15 perfis ✔. Usuários por perfil: Administrador (n/d nesta consulta), Analista de TI 1, Control Desk 1, Gestor 1, Operador 2, Qualidade 1, Analista/rh 1, Supervisor 1, Técnico Pleno 2; DP, Estagiário, Funcionário, Técnico Jr/Sr, Candidato: 0 → **"nove em uso" bate** (incluindo o Administrador). `permissoes.modulo` **já existe** como coluna (agrupamento de exibição, ver R-1). Não há tabela de controle de migrations aplicadas.

## 10. Divergências entre o documento e o código (reportar, não supor)

1. **"Módulo" já é palavra do código**: `permissoes.modulo` / `PermissionDefinition.module` / `SESSOES_PERMISSAO[].modulos` significam *grupo de exibição* (26 valores: "Candidatos", "WFM"…). Se a nova coluna se chamar também `modulo`, haverá colisão semântica e de SQL. Proposta: usar **`modulo_dono`** e registro **`modulos_sistema`**, e documentar que "módulo (grupo de exibição)" vira "grupo" na UI. (Também existe "sessão" — outro conceito, mais fino.)
2. "Teams e notificações de aprovação não existem (`wfm_trocas.py:13`)" — confere (fora de escopo).
3. O documento diz que "a flag é lida" como algo único; na verdade é lida **na importação** e aplicada em **três pontos de leitura** (§5). Não é um simples `if`.
4. `docs/` está **inteiramente no `.gitignore`** (`.gitignore:81`, já registrado na minha memória). O critério de pronto "documentos estão no repositório" exige **decisão sua**: forçar `git add -f docs/modularizacao/*` ou abrir exceção no `.gitignore`.
5. Nome sugerido "Suporte TI": já existe a operação `TI` / "Tecnologia (TI)" — reaproveitar (§6).

## 11. Riscos para as próximas etapas

| # | Risco | Mitigação proposta |
|---|---|---|
| R-1 | Colisão de vocabulário "módulo/sessão/ambiente/grupo" (§10.1). | Nomes novos `modulos_sistema`, `modulo_dono`; glossário no PLANO; "ambiente" não usado. |
| R-2 | **A regra "≥1 permissão do módulo" dá `tecnologia` a perfis que não devem ter**: `sessao.configuracoes.acessar` é concedida a Estagiário/DP/RH/Gestor por causa de `emails.*`/`lgpd.visualizar` (`rbac.py:699-710`); `operacoes.visualizar` é dada a quase todos. Resultado literal: RH/Gestor veriam o módulo tecnologia. | Classificar permissões **de uso comum** como core (`operacoes.visualizar`, `mural.visualizar`) e **só** permissões administrativas como `tecnologia`; reclassificar `emails.*`; decidir o destino de `sessao.configuracoes.acessar`. Verificar na matriz da Etapa 2 (a matriz tem de ser idêntica). |
| R-3 | **Operador/Funcionário/Supervisor passariam a ter módulo `rh` só por Treinamentos** (e Operador também `operacao` ⇒ seletor aparece para ele). O app Android e o autoatendimento dependem disso. | Decisão sua (D-1): módulo `rh` para quem só tem Treinamentos? Alternativa: permissões de autoatendimento (`onboarding.visualizar`, `onboarding.concluir_proprio`) como **core**; ou exigir "permissão de gestão" para exibir o módulo. |
| R-4 | **Perfis TI mudam de matriz (decisão 2)** mas as regras do WFM em `wfm_scope.py` são por **ID de perfil**; dar "tudo que o Administrador pode" aos 4 perfis de TI colide com "Administrador não tem permissões operacionais do WFM" e "só o Analista monta escala". "Acesso completo de administração" inclui `usuarios.alterar_perfil`, `redefinir_senha`, logs, `configuracoes.editar`… — poder elevado a Técnico **Júnior**, inclusive sobre outros perfis (inclusive virar Administrador). | Não é reabertura de decisão: preciso só confirmar escopo (D-2): irrestrito, ou sem poder de promover a Administrador/editar perfis acima? Registrar em auditoria. |
| R-5 | A flag é lida na importação e o token embute permissões; um botão em runtime exige releitura por requisição/login + versão de permissões. Risco de "o botão muda e nada acontece" ou o oposto (acesso reaberto por token antigo). | PLANO desenha leitura com cache curto e invalidação; testes dos 5 estados pedidos. |
| R-6 | **Deploy automático em prod no push da `main`** (§2). | Branch própria; sem merge/push na main; deploy de teste/homologação manual. |
| R-7 | Guarda por módulo sobre rotas **sem prefixo** e sobre rotas públicas (`/conecta-provas-api`, `/disc-api`, `*-api`, logos públicas) e `/auth/*`/`/estilos`. | Mapa rota→módulo explícito e versionado, com teste que falha se surgir rota nova sem módulo declarado. |
| R-8 | Desligar o módulo `rh` derrubaria o app Android e o portal do candidato (público). | Módulos desligáveis: `rh`/`operacao` apenas; portal público do candidato não passa pela guarda por usuário; avisar na UI. |
| R-9 | Migrations: não há controle de versão aplicada e só 11/54 têm rollback. | Cada migration nova com `.rollback.sql` testado em banco descartável; **proponho não rodar rollback contra o DEV compartilhado** (D-4). |
| R-10 | A suíte usa o banco DEV real (escreve nele); `pytest` órfão já travou o DEV antes (minha memória). | Ambiente descartável/schema separado para a Etapa 2/3, ou aceitar DEV compartilhado. |
| R-11 | Fronteira de módulo já violada: `rh_api/services/*` (ex.: `monitoria_*`, `wfm_*`) importam `repositories` de RH e vice-versa (`dependencies.py` importa `services.monitoria_scope`; `repositories/wfm.py` importa `rbac`). Só registro, conforme pedido. | — |
| R-12 | Frontend: `controlador-aplicacao.js` tem 2048 linhas com mapas de tela→permissão/sessão e perfil literal; reorganizar por módulo sem alterar telas existentes. | Etapa 7: mapa vem do endpoint; telas existentes ficam onde estão. |
| R-13 | `PERMISSIONS_VERSION` precisa subir a cada mudança de matriz ⇒ todos os usuários deslogam no deploy. | Avisar; fazer no horário combinado. |

## 12. Perguntas que precisam de resposta antes do PLANO (todas com minha recomendação)

- **D-1 (R-3):** Quem só tem Treinamentos (Operador, Funcionário, Supervisor) entra no módulo `rh`? **Recomendo:** autoatendimento de Treinamentos = **core** (não conta para exibir o módulo `rh`); `rh` aparece só com permissões de gestão (vagas/candidatos/processos/provas/onboarding.criar|gerenciar etc.). Assim o Operador não vê seletor por causa de Treinamentos.
- **D-2 (R-4):** Perfis de TI com "administração completa": ok incluir `usuarios.alterar_perfil` e `usuarios.redefinir_senha` para Técnico Júnior? **Recomendo** conceder tudo conforme decidido, mas impedir (no servidor) atribuir/editar o perfil Administrador a quem não for Administrador, e auditar tudo.
- **D-3:** Mural, Calendário, Políticas, OneDrive, Relatórios, E-mails, LGPD, `dashboard.visualizar`, `notificacoes.configurar` — confirmar a coluna "?" do §4. Recomendo: Mural/Notificações/Dashboard-geral = core; Calendário/Políticas/E-mails/OneDrive/Relatórios = rh; LGPD operacional = rh, LGPD de configuração/anonimização = tecnologia.
- **D-4:** Onde posso testar migrations + rollback? **Recomendo** criar um banco DEV descartável (restaurar cópia do DEV) e não rodar rollbacks no DEV compartilhado.
- **D-5:** Qual é o procedimento/servidor de **teste e homologação**? Só vejo `infra/docker/compose.hml.yml` e o runner de produção; preciso saber como fazer o deploy lá e os valores atuais da flag em cada ambiente (§5).
- **D-6:** `docs/` no repositório: forçar o add ou liberar no `.gitignore`?
- **D-7:** Confirma partir da branch `wfm` (nova branch `modularizacao`)? E que **nada** será enviado à `main`?

---
## Anexo — baseline da suíte (antes de qualquer alteração)

- `pytest -q -k "not integration"` (sem os 89 testes de integração): **577 passaram, 10 falharam**, 22 s. As 10 falhas: 9 em `test_onedrive_upload_guardrails.py` (`assert not True`, parecem dependentes de configuração/credencial local do OneDrive) e `test_e2e_login_bypass.py` (exige `RH_AUTH_TOKEN_SECRET` ≥ 32 caracteres em PROD). **Já falhavam antes do meu trabalho; não investiguei a causa (fora do escopo).** Serão tratadas como baseline "vermelho conhecido" e excluídas da comparação.
- `pytest -q` completo (inclui integração contra o banco DEV): **não terminou em ~15 min** (provável travamento em teste de integração/lock no DEV — mesmo padrão do "pytest órfão" já visto). Interrompi o processo. Preciso de D-4 (banco descartável) antes da Etapa 2/3 para ter baseline de integração confiável.
