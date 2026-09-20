# MONITORIA — Progresso (arquivo de estado; ler antes de qualquer trabalho)

Fonte: `promt.txt` (seção 9 = checklist). Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` concluído.

## Fase atual
- Fase A CONCLUÍDA (3 rodadas; "pode implementar" recebido em 20/set/2026).
- Fase B aprovada (20/set/2026). C1 concluída (b544aac). **C2+C3 backend concluídos** (API+testes); as telas de M14/M15/M17/M18/M19 ([~]) entram na C5. Falta M21 (plano de ação) e C4.
- Depois: Fase C (C1..C5, commit por fase) → Fase D (auditoria).

## Decisões da rodada 3
- Perfis: manter TODOS os existentes no banco/código (nada descartado); listar/criar nas telas só: Administrador, Gestor, Analista (=`rh`, só nome exibido), DP, Estagiário, Supervisor, Operador, Qualidade (novo), Control Desk (novo). `funcionario` e `candidato` continuam existindo (app), ocultos das listas.
- Operador: 1 operação, até 2 supervisores (troca por turno/escala). Reativar operação inativa: só Adm, com log. Nome exibido "Qualidade".
- Plano Cloudflare (share lido): conversa genérica de 3 dias atrás, baseada em premissas erradas (React/Tailwind/Postgres); NÃO é plano concreto. Real: FastAPI + SQL Server + Preact/htm. Diretriz: manter portabilidade (regras puras, storage abstrato, job de SLA chamável externamente, imutabilidade em 2 camadas).

## Descobertas da exploração (Fase A) — não re-explorar
- Stack: FastAPI + SQL Server (pyodbc, SQL puro) em `apps/backend/rh_api/{routers,services,repositories,schemas}`; migrations idempotentes `infra/sql/migrations/V001..V036` + `repositories/bootstrap.py` (`ensure_*`); frontend Preact/htm sem build, rotas em hash (`fonte/rotas.js`, `screen-*`), features em `fonte/features/<pasta>/index.js`; tokens em `estilos/tokens.css` (`--brand*`, com dark); testes `apps/backend/tests` (pytest) + Playwright `tests-e2e`; APScheduler já iniciado em `main.py` (`scheduler.py`); Redis opcional.
- **"Operação" JÁ EXISTE**: catálogo genérico `dbo.operacoes` (id_item, chave, nome, ativo…, CRUD em `/settings/catalog/operacoes`, tela `configuracoes/operacoes`); vínculo `dbo.usuarios_operacoes(id_usuario, operacao NVARCHAR(60))` guarda o NOME como string; token já carrega `operacoes`; `AuthenticatedUser.allows_operacao()` (vazio = sem restrição) usado hoje só em processos/entrevistas. → M01/M03/M04 devem ESTENDER isso.
- Perfis atuais (`rbac.py`): estagiario, dp, gestor, rh, candidato, administrador, funcionario, supervisor, operador. Não existem Control Desk nem Qualidade. Permissões vão dentro do token (relogin após mudar).
- **Operador é bloqueado na web** (`routers/auth.py` `_PERFIS_SEM_ACESSO_WEB`), só app via `/auth/app/login-email` (e-mail sem senha). Supervisor/Operador hoje caem na Central de Treinamentos (`app/aplicacao-raiz.js` ~203-217).
- Login: senha local (`senha_hash`) + Microsoft SSO + MFA opcional; NÃO existe "senha inicial padrão / troca obrigatória"; rate limit em memória; token HMAC próprio com TTL.
- Textos de login com "RH": `features/gestao/index.js:1699` ("Sistema Interno RH") e `:1725` ("Acesso ao ambiente RH"); `tests-e2e/login.spec.js:22` depende do texto.
- Logs: `logs_auditoria` existe mas é mutável e sem IP/estado estruturado. Notificações: `notificacoes` (por papel/usuário, in-app). E-mail: Graph sendMail como app (`services/email_send_service.py`), permissão `emails.enviar_modelo`.
- Zona de risco atual: aba "risco" em `features/administracao/index.js` (só Adm; lista o que será apagado — `repositories/sistema.py`).

## Decisões da rodada 1 (respostas em promt.txt linhas 256-335) — fonte: usuário
- Resumo de Regras vence o docx. Apps móveis NÃO são tocados. Commit por fase (só meus arquivos; `apps/frontend/scripts/` não é meu). Trabalhar SÓ no banco de DEV; produção intocada. Migração futura para Cloudflare deve ser considerada (ver pergunta R2-1).
- Operação = estender catálogo `dbo.operacoes` (hoje: BRAVA, C24H/Central24Horas, CRF/Flamengo, DAVITA, ENDOVIEW, NEWE). Operação inativa = nenhuma edição. Isolamento vale para tudo que tem conteúdo/dado por operação (Monitoria, Treinamento não-padrão, Relatórios…). Operador com ajuste pendente sinalizado.
- Perfis-alvo: Administrador/Gestor/Analista(=ex-Funcionário, renomear)/Supervisor/Operador/Qualidade/Control Desk. Control Desk vê todas as operações separadas por tag. Supervisor acessa Central de Monitoria. Operador libera na web só com vínculo de operação. Toggle on/off por sessão em Perfis e Permissões; Início e menu superior dinâmicos por acesso (todos exceto Gestor/Adm).
- Auth atual mantida; senha definida na criação (se login por senha ativo), troca obrigatória no 1º acesso; "Esqueci a senha" visível porém DESATIVADO. Filtros (operação, status, perfil) + busca na tabela de usuários. Turno (Manhã/Tarde/Noite) no cadastro de Operador e Supervisor.
- Nula = status "Anulado" com justificativa obrigatória. Pilares no formulário; Qualidade tem lista de formulários/monitorias a analisar na inicial. Faixas e escala parametrizáveis por operação; versões antigas do formulário sempre preservadas.
- Top N selecionável 3/5/10/15 (operação inteira, com filtro). Operador: média da operação + ranking/escala. Gráficos: usar `ui/components/charts.js` (bar, donut, radar, funnel, distribution) e criar o que faltar (linha de evolução).
- Login: "Conecta" / "Acesse sua conta". Cor/logo por operação: config em Configurações→Ambiente (só Adm). Multi-operação (máx. 3 p/ supervisor): dados juntos com tag + filtro; usuário escolhe 1 design (troca 1x); supervisor pode ser desvinculado de operação.

## Decisões da rodada 2 (promt.txt linhas 340-372)
- Aceitas todas as sugestões R2 exceto as pendentes na rodada 3. Equipe ≠ Turno (separados por ora; juntar depois se a supervisão pedir). Operador até 2 supervisores. Supervisor máx. 3 operações; Qualidade máx. 2; Control Desk todas (atuais/futuras, separadas por tag). Desvincular supervisor: perde acesso, pendências abertas passam ao substituto, monitorias antigas mantêm o original. Operação inativa: nada editável.
- Login padrão = Microsoft (SSO); senha só em casos específicos (toggle "Login por senha" na criação, default desligado; troca no 1º acesso). Operador entra na web só com vínculo de operação.
- "Baixada" → renomeada "Anulada" em todo o sistema; <3 blocos = Anulada automática com justificativa do avaliador; Supervisor na reanálise: Manter ou Anular (observação obrigatória); "baixar" = só exportar arquivo.
- Operador: escala com a nota dele + média da operação (sem ranking/posição). Ranking Top N (3/5/10/15) é do Supervisor/gestão. Qualidade: fila de acompanhamento na inicial (read-only). Início dinâmico vale p/ todos exceto Gestor/Adm; toggle por sessão (`sessao.<id>.acessar`).
- Imutabilidade em 2 camadas portáveis (trigger SQL Server + bloqueio na camada de dados). Dev DB atual tem só 3 usuários (administrador, operador, supervisor); DDL a verificar em C1.
- Plano Cloudflare: link claude.ai/share/55c9764d-… exige login (não consegui ler; não posso autenticar). Pendente colar o resumo.

## BLOQUEIOS
(nenhum)

## Checklist mestre
### C1 — Fundação de dados e acesso
- [x] M01 Entidade Operação + CRUD (banco, API)
- [x] M02 Perfis Control Desk e Qualidade + permissões granulares
- [x] M03 Vínculo usuário↔operação
- [x] M04 Campo de operação na criação/edição de usuário
- [x] M05 Equipes administráveis
- [x] M06 Middleware/escopo de operação (deny por padrão)
- [x] M07 Tag de operação nos resultados
- [x] M08 Isolamento de treinamentos por operação (aditivo)
### C2 — Motor de matriz e monitoria
- [x] M09 Modelo de matriz/versão/blocos/critérios/pilares/escala
- [x] M10 Seed da matriz 1.0
- [x] M11 Motor de cálculo único
- [x] M12 Snapshot imutável (+ trigger/constraint)
- [x] M13 ID de 8 dígitos único
- [~] M14 Formulário de monitoria no Conecta
- [~] M15 Gestão de formulário versionado
### C3 — Fluxo, SLA e automações
- [x] M16 Máquina de status + linha do tempo
- [~] M17 Feedback
- [~] M18 Confirmação/contestação do operador
- [~] M19 Reanálise do supervisor
- [x] M20 Job de SLA idempotente + log
- [ ] M21 Plano de Ação + revisões + relatório
### C4 — Análise e saída
- [ ] M22 Dashboard
- [ ] M23 Histórico + busca + gráficos
- [ ] M24 Relatórios + XLSX/CSV
- [ ] M25 Exportar + compartilhar por e-mail
- [ ] M26 Logs imutáveis
- [ ] M27 Guia de Processos
### C5 — Interface, tema e configurações
- [ ] M28 Telas iniciais por perfil
- [ ] M29 Menu suspenso reduzido + submenu Monitorias
- [ ] M30 Login sem referências a RH
- [ ] M31 Central de Monitoria nas Configurações + Zona de Risco
- [ ] M32 Cor primária e logo por operação
- [ ] M33 Gestor e Adm com acesso à Central de Monitoria
### D — Auditoria final
- [ ] M34 Não-regressão
- [ ] M35 Vazamento entre operações
- [ ] M36 Imutabilidade
- [ ] M37 Cobertura M01–M33
- [ ] M38 Relatório final

## Notas de implementação C1
- Schema: fonte única `repositories/monitoria_schema.py` → V037 gerada (teste garante igualdade). 12 tabelas imutáveis com trigger INSTEAD OF UPDATE/DELETE.
- Escopo: `services/monitoria_scope.py`; M08 em `services/operacao_escopo.py` (trilhas/assignments/relatórios de treinamento).
- Falhas pré-existentes da suíte (10, dependem do .env: onedrive/e2e prod/microsoft insert) — confirmadas idênticas no HEAD limpo; não são regressão.
- Frontend C1: filtro Operação + perfis ocultos em Configurações→Usuários. Campos turno/equipe/supervisores do usuário e a tela 'Usuários' da Monitoria entram na C5.

## Notas C2/C3
- Backend: `services/monitoria_engine.py` (motor único), `services/monitoria_workflow.py` (status/SLA), `repositories/monitoria.py` (matriz, criação com snapshot, consulta), `repositories/monitoria_fluxo.py` (feedback/confirmar/contestar/réplica/reanálise/anexos/job SLA), job APScheduler a cada 5 min.
- Decisão: Operador só enxerga a monitoria depois do feedback aplicado (disponibilizada para manifestação). 'Baixada' = 'Anulada'. Docx 10.14 tinha exemplo errado (88); correto = 90 (teste cobre).
- Testes de integração criam a operação TESTE_AUTO no banco DEV e a desativam ao final; linhas das tabelas imutáveis permanecem (só dev).
