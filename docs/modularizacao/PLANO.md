# Modularização do Conecta — Etapa 1: Plano técnico

Branch: `modularizacao` (criada de `wfm` @ `7f1eff5`). Nada será enviado à `main`.
Base: [RECONHECIMENTO.md](RECONHECIMENTO.md) + decisões do RH em 02/out/2026 (D-1…D-7).

## 0. Decisões incorporadas e como as li

| Decisão | Como entra no plano |
|---|---|
| D-1: criar/administrar treinamentos → `rh`; ter treinamento atribuído **não** abre `rh` | Treinamentos de autoatendimento ficam **core**. Ver regra de visibilidade (§2.3). |
| D-2: TI com administração completa, com trava no servidor | Etapa 3 (migration V058 + trava "só Administrador atribui/edita o perfil Administrador" + auditoria). |
| D-3: E-mails e OneDrive → `rh`; Relatórios → `tecnologia`, **configurável**; demais "?" como recomendei | Ver §2.2. O dono de cada permissão é **dado no banco** (`modulo_dono`), editável na tela de ativação — é a "configurabilidade". |
| D-4: banco descartável | Etapa 2: restaurar cópia do DEV como `…_modularizacao` para migrations/rollback/suíte; o DEV compartilhado só recebe o deploy final. |
| D-5: "ok" | Não recebi o valor atual da flag por ambiente nem o procedimento de deploy. O plano **não depende do valor**: o valor inicial da configuração é copiado da própria variável de ambiente do servidor na primeira leitura (§4). O passo a passo de deploy fica como roteiro a validar com você na Etapa 8. |
| D-6: docs versionados | `git add -f docs/modularizacao/*`. |
| D-7: branch `modularizacao`, sem `main` | Feito. |

## 1. Glossário (para não repetir a colisão do §10.1 do reconhecimento)

- **Módulo** (novo): `core`, `rh`, `operacao`, `tecnologia`. Tabela `modulos_sistema`.
- **Grupo** (antigo "módulo" de `permissoes.modulo`): agrupamento de exibição ("Candidatos", "WFM"…). Não muda.
- **Sessão**: chave-mestra `sessao.X.acessar` por perfil (9). Não muda; passa a ser o gatilho de visibilidade de módulo.
- "Ambiente" não é usado em nada novo.

## 2. Modelo de dados (somente aditivo)

### 2.1 Tabelas e colunas novas

| Migration | Conteúdo | Rollback |
|---|---|---|
| **V055** `modulos_sistema` | `chave NVARCHAR(30) PK`, `nome`, `ordem INT`, `ativo BIT DEFAULT 1`, `protegido BIT` (core e tecnologia: nunca desligáveis), `atualizado_em`, `atualizado_por`. Seed: core(protegido), rh, operacao, tecnologia(protegido). | `V055…rollback.sql`: `DROP TABLE` (guardado por `IF OBJECT_ID`). |
| **V056** colunas em `permissoes` | `modulo_dono NVARCHAR(30) NULL` (FK lógica a `modulos_sistema.chave`) e `abre_modulo BIT NOT NULL DEFAULT 0`. Seed por mapeamento (§2.2), apenas onde `modulo_dono IS NULL` (não sobrescreve edição do RH). | Remove as duas colunas (e as constraints default) — guardado por `COL_LENGTH`. |
| **V057** `sistema_parametros` | `chave NVARCHAR(80) PK`, `valor NVARCHAR(400)`, `atualizado_em`, `atualizado_por`. **Sem** seed de `wfm.liberar_participantes` (§4: é semeada pelo código a partir da variável de ambiente). | `DROP TABLE`. |
| **V058** perfis de TI | Insere em `perfil_permissoes` (sem apagar nada) as permissões da decisão 2 para `analista_ti`, `tecnico_junior/pleno/senior`; registra cada linha realmente inserida em `modularizacao_grants_log (id_perfil, chave_permissao, migration, criado_em)`. | Remove de `perfil_permissoes` **só** as linhas listadas no log da V058 (não toca no que já existia) e depois o log. |

Por que `sistema_parametros` e não `configuracoes_sistema`: esta última alimenta o catálogo genérico "Geral" da tela de Configurações (um parâmetro técnico apareceria lá e seria editável sem confirmação/auditoria).

Todas as migrations: idempotentes, convenção `V0NN__nome.sql` + `V0NN__nome.rollback.sql`, e o mesmo DDL espelhado no bootstrap (`repositories/bootstrap.py`) para ambientes que o usam; o teste de drift existente (`test_schema_source_of_truth_drift.py`) cobre o espelho. Rollback é testado em banco descartável: aplicar → verificar → reverter → verificar estado idêntico ao anterior → reaplicar.

### 2.2 Mapeamento permissão → módulo (seed)

(156 permissões; regra por grupo, exceções por chave. `*` = abre módulo, ver §2.3.)

| Módulo dono | Permissões |
|---|---|
| **core** | Geral (`inicio.*`, `dashboard.visualizar`), Notificações (`visualizar` e `configurar`), Mural (4), `operacoes.visualizar`, **autoatendimento de Treinamentos**: `onboarding.visualizar`, `onboarding.concluir_proprio`, `sessao.treinamentos.acessar`; `sessao.gestao.acessar`, `sessao.drive.acessar` (não abrem módulo). |
| **rh** | Vagas, Processos, Candidatos, Entrevistas, Provas, Documentos, Etapas e Trilhas, Fit Cultural, Templates de Documentos, E-mails, OneDrive, Calendário, Políticas, LGPD operacional (`lgpd.visualizar`, `registrar_solicitacao`); Onboarding de gestão (`onboarding.editar`, `criar`, `gerenciar`, `configurar_acesso`); sessões `curriculos*`, `processos*`, `provas*`. |
| **operacao** | Monitoria (15), WFM (20), `sessao.monitoria.acessar*`, `sessao.wfm.acessar*`. |
| **tecnologia** | Configurações, Usuários, Logs, Central de Ajuda, Operações (`operacoes.editar`), LGPD de configuração/anonimização/exportação (`lgpd.configurar/anonimizar/exportar_dados`), **Relatórios** (`relatorios.*`, ver D-8), `sessao.configuracoes.acessar`; `configuracoes.visualizar*`. |

Ambiguidades que continuam abertas e que você responde no portão: **D-8, D-9, D-10, D-11** (§9).

### 2.3 Regra de visibilidade do módulo (refinamento da decisão 1)

> Um usuário **enxerga** o módulo M quando: M está `ativo` **e** o perfil dele tem pelo menos uma permissão com `modulo_dono = M` **e** `abre_modulo = 1`. O `core` é sempre visível (não aparece no seletor).

`abre_modulo=1` é semeado só em: `sessao.curriculos|processos|provas.acessar` (rh), `sessao.monitoria|wfm.acessar` (operacao) e `configuracoes.visualizar` (tecnologia). Motivo (tudo do RECONHECIMENTO R-2/R-3): "pelo menos uma permissão qualquer" daria `tecnologia` a RH/Gestor (via `emails.*`/`lgpd`/`sessao.configuracoes`) e `rh` a quem só tem treinamento atribuído. Reaproveito as chaves de sessão que o Administrador já liga/desliga por perfil — nada de conceito novo para quem usa a tela. É um refinamento da decisão 1, não uma reabertura; está sinalizado para você validar.

## 3. Ponto único de acesso (backend)

Novo `rh_api/services/acesso.py` (puro + leitura com cache de 15 s do estado de `modulos_sistema`, invalidado na escrita):

```
modulo_da_permissao(chave) -> str            # banco (modulo_dono) com fallback no seed em código
modulos_visiveis(user) -> list[ModuloVisivel]
pode_acessar_modulo(user, modulo) -> bool    # ativo + visibilidade
pode(user, permissao, operacao=None) -> Decisao   # permissão + módulo da permissão ativo + escopo (reusa user.allows_operacao / wfm_scope)
wfm_participantes_liberado() -> bool         # §4
```

- `dependencies.require_permissions` e `ensure_user_permission` passam a chamar `pode()` **depois** do teste de permissão atual (acréscimo, nunca relaxa). Módulo desativado ⇒ 403 `MODULO_DESATIVADO`, imediato (sem novo login, pois a checagem é no pedido, não no token).
- Não muda nenhuma URL nem corpo de resposta de rota existente (decisão 11). 403 já é o contrato de "negado".
- **Rotas sem prefixo / sem permissão específica:** um teste enumera todas as rotas do app e exige que cada uma esteja (a) coberta por `require_permissions`/`ensure_user_permission`, ou (b) numa lista explícita versionada (`/auth/*`, `/estilos/*`, rotas públicas `*-api`, saúde, `/core/*`). Rota nova sem declaração falha o CI. Isso evita a "guarda por prefixo" que não funcionaria (R-7).
- **Núcleo protegido:** `PUT /tecnologia/modulos/{chave}` recusa desligar `core`/`tecnologia` (e recusa desligar qualquer módulo se `permissoes` do próprio solicitante deixariam de abrir `tecnologia`); recusa mudar `modulo_dono` de permissões que abrem `tecnologia` para fora dele.
- **Módulos desligáveis:** `rh` e `operacao`. Desligar `rh` bloqueia as rotas de gestão de RH; o app Android (autoatendimento de treinamentos = core) e o portal público do candidato (`*-api`, sem usuário) **continuam**. A UI avisa isso.

### 3.1 Endpoint novo (core)

`GET /core/acesso` → `{ modulos: [{chave, nome, ativo, visivel}], modulo_padrao, permissoes: [...], telas: {...} }` para o usuário logado. `permissoes` = as do token já filtradas (flag WFM incluída). `telas` = mapa tela→{permissao, modulo} que hoje vive duplicado em `controlador-aplicacao.js`. Contrato aditivo; `/auth/me`/`/auth/login` **não mudam** (o app Android os usa).

### 3.2 Escrita (módulo tecnologia, endpoints novos com prefixo `/tecnologia`)

`GET/PUT /tecnologia/modulos`, `GET/PUT /tecnologia/permissoes/{chave}/modulo` (configurabilidade do dono), `GET/PUT /tecnologia/parametros/wfm-participantes`. Todos com permissão `configuracoes.editar` + trava de protegido, e `record_audit_log` (quem, quando, valor antes/depois).

## 4. Flag do WFM → configuração no banco

Chave `sistema_parametros.wfm.liberar_participantes` (`'1'`/`'0'`).

1. **Valor inicial = valor atual em cada ambiente:** na primeira leitura em que a linha não existe, o código a cria com o valor da variável `RH_WFM_LIBERAR_PARTICIPANTES` **do próprio servidor** (mesma interpretação `1/true/sim/yes/on`). Assim não preciso saber o valor de cada ambiente e nada muda no dia da implantação. A criação é `INSERT … WHERE NOT EXISTS` (à prova de requisições simultâneas — lição do `UQ_wfm_contratos`).
2. **Ponto único de leitura:** `acesso.wfm_participantes_liberado()`. As três chamadas atuais de `aplicar_restricao_wfm_em_teste` (`auth.py:167`, `auth.py:284`, `security.py:244`) continuam com a **mesma assinatura** e passam a delegar a ele. O filtro de importação em `rbac.py:755-760` sai: `ROLE_PERMISSIONS` passa a conter **sempre** o desenho completo, e o filtro é aplicado na leitura (`get_role_permissions` incluído, para o fallback sem banco).
3. **Variável de ambiente prevalece enquanto não validado em homologação**; quando definida, é registrada em log (uma vez por processo, nível WARNING, informando valor da env × valor do banco). O botão mostra na UI "controlado pela variável de ambiente" e fica desabilitado enquanto ela existir. Remoção do fallback: apagar a variável do `.env` + reiniciar (documentado no HOMOLOGACAO.md); uma segunda etapa de código (remover o ramo `os.getenv`) só depois de validado, num commit separado.
4. **Token:** as permissões vão no token; para o botão valer sem deslogar todo mundo, o token ganha `wl` (estado da flag na emissão). `validate_access_token` compara: se mudou **e** o perfil é um dos 5 afetados (Operador, Qualidade, Técnico Jr/Pl/Sr) ⇒ 401 "faça login novamente" só para eles. Fechar vale na hora (o filtro roda por pedido); abrir exige 1 novo login só desses perfis. Os demais perfis não são tocados.
5. **Botão:** `PUT /tecnologia/parametros/wfm-participantes {valor, confirmacao}` — exige confirmação explícita no corpo, grava auditoria (`modulo="Sistema"`, `acao="wfm_participantes_alterado"`, antes/depois, usuário), invalida o cache.
6. **Testes (Etapa 4):** 5 estados (env ligada; env desligada; banco ligado; banco desligado; env+banco discordando ⇒ env vence + log) × {Operador, Técnico de TI, Qualidade}, mais a verificação de que Administrador, Gestor, Supervisor, Control Desk, Analista de TI, Analista (rh), DP, Estagiário, Funcionário **não** mudam em nenhum estado. O `conftest.py` deixa de forçar `=1` globalmente onde precisar do estado "fechado" (hoje só o teste em subprocesso testa isso).

## 5. TI no WFM (Etapa 5)

- **Operação:** reaproveitar a `TI` ("Tecnologia (TI)") já existente. Não criar "Suporte TI". Se quiser exibir outro nome, é UPDATE do campo `nome` (a chave `TI` está embutida em `wfm_scope.OPERACOES_SO_TIPOS` e nas chaves `TI::…`, não muda).
- **Tela emprestada:** `modulos/tecnologia` registra o item de menu "Escalas e Plantões" apontando para o mesmo componente `TelaWfm` (importado do módulo `operacao`, via *registro do core* — nenhuma cópia). O filtro por operação TI é passado como parâmetro de tela; o isolamento real continua no servidor (`usuarios_operacoes` + `wfm_scope`), então o parâmetro é só conveniência de UI. Mesmas rotas `/wfm/*`, mesmas tabelas.
- **Testes:** Técnico de TI não vê escalas de outras operações; Supervisor de operação não vê a escala da TI; regra de aprovação do Analista de TI inalterada (suíte `test_wfm_aprovacao_ti.py` roda verde sem edição).
- **Observação a validar (D-11):** com a flag fechada os Técnicos continuam sem WFM (por desenho da fase de teste); o critério "Técnicos veem a própria escala no tecnologia" só vale com a flag aberta.

## 6. Perfis de TI (decisão 2)

"Tudo o que o Administrador pode" é aplicado como: **todas as permissões de `modulo_dono ∈ {tecnologia, core}` que o Administrador tem**, mais as de WFM que cada perfil já tinha (Escalas e Plantões da equipe). **Não** concede permissões de `rh`/`operacao` do Administrador (candidatos, monitoria…) — administração do Conecta, não operação de RH/Monitoria (**D-10** para confirmar). Montar/criar escala continua sendo `wfm.escala.criar`/`editar`: só o Analista de TI por padrão (os Técnicos não recebem). Trava de servidor: atribuir/editar o perfil Administrador (e seus usuários) só por Administrador; toda alteração de usuário/perfil/permissão por perfil de TI auditada.

## 7. Estrutura do frontend

```
apps/frontend/fonte/modulos/
  registro.js                 # {chave, rotulo, carregar: () => import(...)}; lê /core/acesso
  core/       index.js        # início, perfil/ambiente pessoal, notificações, mural, treinamentos de autoatendimento
  rh/         index.js        # manifesto: telas existentes de RH ficam ONDE ESTÃO (features/…); só aponta para elas
  operacao/   index.js + wfm/ # WFM move para cá (git mv) ; Monitoria permanece em features/monitoria e é apontada
  tecnologia/ index.js + inicio.js (centro de administração) + modulos.js + liberar-wfm.js + permissoes-por-modulo.js
```

- **Lazy loading:** cada `index.js` de módulo é um `import()` dinâmico feito só se o módulo está em `modulos` do `/core/acesso` (o usuário só baixa o que pode usar). Mantém o padrão `?v=` de cache-busting (lição já registrada).
- **Seletor de módulo** na navbar (`ui/components/layout.js`): só renderiza com ≥ 2 módulos visíveis; mostra o **nome do módulo ao lado do logo**; sem cor própria (decisão 7); quem tem 1 módulo cai direto nele. Último módulo escolhido em `localStorage` (com try/catch), padrão = `modulo_padrao` do endpoint.
- **Menu** montado do `/core/acesso`; `PERMISSOES_TELAS`/`SESSAO_DA_TELA` de `controlador-aplicacao.js` passam a ser preenchidos pelo endpoint (o objeto atual fica como *fallback* durante a transição, removido numa segunda etapa). Listas de perfis fixas (`ICONE_POR_PERFIL`, literais em Monitoria) **não** são tocadas nesta leva, exceto onde a nova tela precisar — registrado como pendência.
- **Telas novas** (início do tecnologia, ativação de módulos, liberar WFM, Perfis e Permissões por módulo) só depois do **wireframe aprovado (Etapa 6)**, no padrão visual (grade 8 px, sem gradiente, cores sóbrias).
- RH e Monitoria existentes: nenhuma alteração visual ou de rota de tela.

## 8. Plano de testes

1. **Etapa 2 — caracterização (antes de mexer em qualquer coisa):** gerar `apps/backend/tests/snapshots/matriz_acesso.json` = para cada um dos 9 perfis em uso (+ os 6 sem usuário, por conta da matriz de perfis) × {flag fechada, flag aberta}: conjunto de permissões efetivas, conjunto de **rotas** respondendo 2xx/403 (via `TestClient` com dependências sobrescritas; sem tocar dados) e **telas** liberadas (`podeAcessarTela` calculado em Node sobre o mapa do frontend). Teste que compara com o snapshot; o diff final só pode conter os 4 perfis de TI × módulo tecnologia.
2. Unitários de `acesso.py` (visibilidade §2.3, protegido, módulo desativado, flag 5 estados).
3. Teste de enumeração de rotas (§3) e de que **nenhum path/método existente mudou** (snapshot do OpenAPI antes × depois, comparando `paths` — rotas novas permitidas, alteradas/removidas não).
4. Contrato do app Android: respostas de `/auth/login`, `/auth/app/login-email`, `/auth/me`, `/onboarding/meus-treinamentos*` mantêm todos os campos.
5. Migrations: ciclo aplicar → verificar → rollback → verificar → reaplicar em banco descartável; reaplicar duas vezes (idempotência).
6. `services/wfm_regras.py`: `git diff` vazio garantido por teste de hash no CI da tarefa.
7. Frontend: `node --check` em todos os `.js`; smoke dos módulos (monta com cada perfil mockado: 1 módulo ⇒ sem seletor; 2+ ⇒ seletor); Playwright onde já houver estrutura.
8. Suítes pré-existentes: as 10 falhas de baseline são excluídas da comparação (listadas no RECONHECIMENTO).

## 9. Matriz perfil × módulo resultante (para você conferir)

Visibilidade com a regra §2.3. Flag do WFM **fechada** (estado atual do DEV); entre parênteses o que muda com ela aberta. "TI*" = mudança aprovada na decisão 2. Core sempre presente.

| Perfil | rh | operacao | tecnologia | Seletor? | Muda vs. hoje |
|---|---|---|---|---|---|
| Administrador | ✔ | ✔ | ✔ | sim | não |
| Gestor | ✔ | ✔ | — | sim | não |
| Analista (rh) | ✔ | — | — | não | não |
| DP | ✔ | — | — | não | não |
| Estagiário | ✔ | — | — | não | não |
| Supervisor | — (sessões curriculos/processos desligadas por padrão) | ✔ | — | não | não |
| Control Desk | — | ✔ | — | não | não |
| Qualidade | — | ✔ (Monitoria; WFM só com flag aberta) | — | não | não |
| Operador | — (treinamento atribuído é core) | ✔ (Monitoria "Minhas"; WFM com flag aberta) | — | não | não |
| Funcionário | — | — | — | não (só core/app) | não |
| Candidato | — | — | — | — | não (portal público) |
| **Analista de TI** | — | ✔ (WFM) | **✔ TI\*** | **sim** | **TI\*** |
| **Técnico Jr / Pl / Sr** | — | (✔ só com flag aberta) | **✔ TI\*** | com flag aberta | **TI\*** |

Hoje o `operador` e o `funcionario` têm Treinamentos: continuam com a mesma tela, agora classificada como **core**; `supervisor` idem (suas telas de Treinamentos não o fazem entrar em `rh`).

## 10. Plano de deploy (teste e homologação)

1. Branch `modularizacao` → build local verde (suíte + `node --check`).
2. Cópia do DEV restaurada em banco descartável → V055–V058 aplicadas + rollback testado.
3. Subir `PERMISSIONS_VERSION` (novo valor) — **todos fazem login de novo** no deploy; combinar horário.
4. Ambiente de teste: aplicar migrations (`aplicar-migrations.ps1`), subir backend + frontend (bump `?v=`), manter a variável `RH_WFM_LIBERAR_PARTICIPANTES` como está.
5. Roteiro manual por perfil (HOMOLOGACAO.md). Homologação só após seu aceite do teste.
6. Rollback: reverter para o commit anterior + `*.rollback.sql` na ordem inversa (V058→V055); estado de `perfil_permissoes` restaurado pelo log da V058.
7. **Produção: fora desta tarefa.** Branch não vai para a `main`.

## 11. Perguntas para o portão (cada uma com minha recomendação)

- **D-8 (Relatórios → tecnologia):** o Gestor e o Analista (rh) têm `relatorios.visualizar/exportar`. Se `relatorios.*` for de `tecnologia`, a *tela* de análise deles precisa continuar acessível onde está hoje. **Recomendo:** dono = `tecnologia` (como você pediu, e editável), `abre_modulo=0` (não dá módulo tecnologia a ninguém só por isso) e a tela existente não muda de lugar para quem já a usa.
- **D-9 (Supervisor):** tem `onboarding.editar` (marca checklist, aplica treinamentos). **Recomendo** tratar `onboarding.editar` como *autoatendimento de aplicação* (core) e deixar `criar`/`gerenciar`/`configurar_acesso` como gestão (`rh`); assim o Supervisor continua só em `operacao` e sem seletor.
- **D-10 (TI):** o "tudo o que o Administrador pode" vale para `tecnologia` + `core` + WFM (§6), **sem** as permissões operacionais de RH/Monitoria do Administrador? **Recomendo sim.**
- **D-11 (Técnicos × flag):** com a flag fechada os Técnicos de TI veem o módulo tecnologia (administração) mas não a própria escala; com ela aberta, veem. Confere?
- **D-12:** a regra de visibilidade refinada do §2.3 (permissões "que abrem módulo") — de acordo? É o que evita que RH/Gestor vejam a tecnologia.

Entrega sem código: nenhum arquivo do sistema foi alterado nesta etapa.
