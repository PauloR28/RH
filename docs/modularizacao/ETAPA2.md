# Etapa 2 — Rede de segurança (relatório)

## O que foi criado
- `apps/backend/tests/_matriz_acesso.py` — gera a matriz perfil × (permissões efetivas, rotas liberadas, telas liberadas) com a flag do WFM **fechada** e **aberta** (um subprocesso por estado, pois a flag é lida na importação). Sem banco, sem efeito colateral: rotas são lidas da árvore de dependências do FastAPI (`require_permissions` + chamadas inline `ensure_user_permission/has_permission` registradas à parte) e telas do mapa `PERMISSOES_TELAS`/`SESSAO_DA_TELA` do frontend.
- `apps/backend/tests/test_matriz_acesso_caracterizacao.py` — 7 testes: permissões efetivas, exigência de permissão por rota, rotas liberadas e telas liberadas por perfil (tudo igual ao snapshot), rotas OpenAPI nunca renomeadas/removidas (decisão 11), e a fase de teste do WFM só afeta Operador/Qualidade/Técnicos. Tem a tabela `DIFERENCAS_APROVADAS` (vazia) onde a Etapa 3 registra a mudança dos perfis de TI.
- `apps/backend/tests/snapshots/` — `matriz_acesso.json` (completo), `matriz_acesso_resumo.json` (contagens + hash por perfil, para leitura humana), `openapi_paths.json`, `permissoes_db_dev.json` (o que o login realmente entrega no banco DEV hoje).
- `tools/snapshot_permissoes_db.py` — gera a foto do banco (somente leitura).
- Banco descartável `RH_Provas_modularizacao` (cópia do DEV na mesma instância SQL Express). Uso: `RH_SQL_DATABASE=RH_Provas_modularizacao`.

## Prova de que a rede funciona
Mutação temporária (dar `logs.visualizar` ao Operador em `rbac.py`) → os testes de permissões e de rotas falharam; revertida (`git checkout`), suíte verde. Matriz determinística (gerada duas vezes, mesmo resultado).

## Baseline
- Sem integração: 577 passam, 10 falham (pré-existentes: 9 em `test_onedrive_upload_guardrails.py` e `test_e2e_login_bypass.py`) + os 7 novos.
- Integração (89 testes, contra a cópia): **88 passam, 1 falha pré-existente** (`test_monitoria_fluxo_integration.py::test_tipos_de_atendimento_pertencem_a_operacao_e_canal`), 5 min 13 s. Não era travamento (como supus no reconhecimento): a suíte é só lenta.

## Achado importante: o banco diverge do código
Comparando `permissoes_db_dev.json` com o snapshot de código (flag fechada):
- **Gestor** no banco **não tem 10 permissões WFM** que o código lhe dá (`wfm.escala.editar/publicar/fechar/corrigir_fechada/publicar_com_violacao`, `wfm.auditoria`, `wfm.cadastros.visualizar`, `wfm.troca.*`). Hoje, no DEV, o Gestor não consegue aprovar/publicar como o desenho prevê.
- **Supervisor** no banco não tem 6 (`candidatos.visualizar`, `processos.visualizar`, `entrevistas.visualizar`, `entrevistas.marcar_presenca`, `dashboard.visualizar`, `operacoes.visualizar`) — edição do Administrador.
- **Administrador** no banco tem `wfm.escala.propria` (resíduo; o código a tira).
Consequência: o bootstrap só insere o que falta e nunca remove; "o que o perfil pode" em cada ambiente é o **banco** daquele ambiente. A migration V058 (TI) e o seed de `modulo_dono` não podem assumir que o banco = código. Não corrigi nada disso (fora de escopo); registro para você decidir se o Gestor do DEV está assim de propósito.

## Limitações conhecidas da rede
- Rotas com checagem inline são registradas (`inline`), mas a matriz de rotas liberadas só usa as dependências declarativas; as 18 rotas com `ensure_user_permission` ficam no campo `inline` para a Etapa 3 (teste de enumeração).
- A matriz de telas replica `podeAcessarTela` em Python; o Playwright/Node não foi usado.
- A matriz do banco é informativa (varia por ambiente), não é teste automático.
