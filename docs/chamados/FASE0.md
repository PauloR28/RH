# Conecta Tecnologia — Módulo de Chamados (Suporte TI) · Fase 0

Data: 03/out/2026 · Branch: `modularizacao` · **Nenhum código de produção foi alterado.** Escritas: este arquivo e `docs/wireframes/chamados/wireframes.html`. Consultas somente leitura.

> ⚠ `docs/` está inteiro no `.gitignore`; nada daqui aparece no `git status`. Se quiser versionar, preciso de `git add -f` ou de uma exceção no `.gitignore` (dúvida D-14).

---

## 0. Resumo executivo (o que muda em relação ao prompt)

1. **A stack real não é React + Tailwind + shadcn.** É **FastAPI + `pyodbc` (SQL puro, sem ORM, SQL Server)** no backend e **JavaScript puro com `htm` + React vendorizado, sem bundler, CSS próprio com tokens** no frontend. Vou seguir a stack real (regra do projeto: não introduzir design novo).
2. **Quase tudo que o prompt pede para reaproveitar existe**: RBAC com tela Perfis e Permissões, vínculo usuário↔operação, central de notificações, upload com validação por magic bytes, módulo **Tecnologia** com menu próprio, scheduler (APScheduler) e rotina de backup com teste semanal de restauração.
3. **Três coisas não existem e exigem decisão sua**: **matrícula** (não está no banco), **cargo/unidade vindos da Microsoft** (o login só lê `name`/`email`/`oid`/`tid`) e **página genérica de personalização de tags** (só há cor por categoria de notificação e cor da tag de operação).
4. **Recomendação de anexos:** disco local do servidor (`D:\ConectaDados\chamados`) atrás de uma interface `StorageProvider`, com exclusão lógica por 30 dias. Custo adicional: R$ 0. Detalhes na §3.
5. **Ponto de atenção de permissão:** se `chamados.abrir` "abrir" o módulo Tecnologia (regra D-12 da modularização), o Supervisor passa a ver o seletor de módulos com Tecnologia, mostrando só "Suporte TI". Decisão em D-1.

---

## 1. Reconhecimento

### 1.1 Estrutura, ORM, banco e rotas

| Item | Realidade |
|---|---|
| Backend | `apps/backend/rh_api/` com `routers/ services/ repositories/ schemas/` + `workers/`. Pacote irmão `apps/backend/conecta/` (hexagonal; hoje só `AuthorizationPolicy`). Python 3.13, FastAPI, pydantic 2. |
| ORM / banco | **Sem ORM.** SQL puro via `pyodbc`; repositórios são *mixins* de `DatabaseRepository` (`repositories/*.py`). Banco **SQL Server Express** (`localhost\SQLEXPRESS`, `RH_Provas_C24H`). |
| Migrations | `infra/sql/migrations/V0NN__nome.sql`, idempotentes, reaplicadas todo deploy por `aplicar-migrations.ps1` (sem tabela de versões). **Última: V058.** Próxima: **V059**. Schemas novos nascem de `repositories/<x>_schema.py` (padrão WFM/Monitoria) com teste de drift. |
| Padrão de rotas | `APIRouter(prefix="/x", dependencies=[Depends(get_current_user)])`; cada rota com `Depends(require_permissions("grupo.acao"))`; auditoria com `audit_action(...)`. Exemplo mais recente e parecido: `routers/tecnologia.py`, `routers/wfm.py`. |
| Frontend | `apps/frontend/fonte/`: `features/<tela>/index.js` carregado sob demanda (`carregarTela(() => import(...))`), `modulos/registro.js` (módulos e menus), `modulos/tecnologia/index.js`, `app/controlador-aplicacao.js` (`PERMISSOES_TELAS`, `SESSAO_DA_TELA`), `rotas.js`, `ui/components/*`, `shared/*`. Cache-busting manual por `?v=` (preciso lembrar de subir a versão em cada import). |
| Gráficos | **Não há Recharts nem outra lib.** Há `ui/components/charts.js` (barras e rosca em HTML/SVG com tokens `--color-chart-*`). Vou usá-lo e estendê-lo (barras horizontais, rosca com tooltip). |
| Testes | pytest (`apps/backend/tests`, 676 testes; integrações usam o banco DEV real) + Playwright. |

### 1.2 Perfis, permissões e vínculo usuário ↔ operação

- **Fonte no código:** `rbac.py` — `PERMISSION_DEFINITIONS` (chave `grupo.acao`, grupo de exibição, descrição, `critical`) e `ROLE_PERMISSIONS` por perfil. O **bootstrap faz seed em `permissoes`/`perfil_permissoes` só com `IF NOT EXISTS`**: nunca remove nem sobrescreve o que o admin editou na tela Perfis e Permissões. Isso atende "valor inicial editável".
- **Padrão de nome:** `grupo.acao` (`wfm.escala.criar`, `usuarios.editar`). As chaves `chamados.abrir`, `chamados.ver_operacao`, … **já seguem o padrão**; nenhuma renomeação necessária.
- **Token:** as permissões vão embutidas no token. Permissão nova ⇒ subir `PERMISSIONS_VERSION` (`rbac.py:30`) ⇒ todo mundo é deslogado no deploy. Registrado como risco.
- **Tela Perfis e Permissões:** o agrupamento visível vem de `SESSOES_PERMISSAO` em `features/configuracoes/index.js`; permissão de grupo novo **fica invisível na tela até entrar nessa lista** (já me custou uma vez). Entra como grupo "Chamados".
- **Módulos (modularização, já na branch):** `modulos_catalogo.py` define dono (`modulo_dono`) e `abre_modulo` por permissão; `services/acesso.py` decide o que cada usuário enxerga (`GET /core/acesso`); `Tecnologia` e `core` são protegidos (nunca desligáveis). Permissão nova precisa de dono: **grupo "Chamados" → `tecnologia`**.
- **Vínculo com operação:** tabela `dbo.usuarios_operacoes` (V018); `AuthenticatedUser.operacoes` traz as chaves. Supervisor/Qualidade podem ter várias; Operador, uma. Perfis globais: Administrador e Gestor (`PERFIS_GLOBAIS`).
- ⚠ **Armadilha herdada:** a regra do Conecta é "usuário **sem** operações vinculadas vê tudo" (`operacao_escopo.usuario_restrito`). Para chamados isso seria um vazamento (Supervisor sem vínculo veria chamados de todas as operações). No módulo, **escopo exige vínculo explícito**; sem operação = não abre chamado e não vê chamado de operação (exceto perfis globais).
- **Perfis de TI já existem:** `tecnico_junior/pleno/senior` e `analista_ti`, vinculados à operação `TI` (usada pelo WFM). Serão a base do seed de `atender/atribuir/dashboard`.

### 1.3 Central de notificações — **existe**

- Tabela `dbo.notificacoes` (V027): `destinatario_papel` (perfil) ou `destinatario_usuario`, `titulo`, `mensagem`, `categoria`, `entidade`, `entidade_id`, `lida`, `criado_em`. Rotas em `routers/notifications.py` (`/notifications`, marcar lida, por entidade, etc.), sino no topo do Conecta com **cor por categoria personalizável** na aba Ambiente.
- **Como disparar:** `_criar_notificacao(cursor, destinatario_papel=…, destinatario_usuario=…, titulo=…, mensagem=…, categoria=…, entidade=…, entidade_id=…)` (hoje método estático em `repositories/onboarding.py:2283`). Vou extrair um helper fino reutilizável sem mudar o existente.
- **Limitação:** destino é *perfil* **ou** *usuário*, não "quem tem a permissão X". Para "equipe de TI" vou resolver permissão → perfis (via `perfil_permissoes`) → uma linha por perfil; para solicitante/responsável uso `destinatario_usuario`.
- ⚠ **Bug conhecido registrado antes:** casamento de `destinatario_usuario` entre *e-mail* e *username* já deu notificação que não chegava (Monitoria). Vou gravar o mesmo identificador que a leitura filtra e cobrir com teste.
- Categoria nova `chamados` (cor própria no catálogo de cores do sino).

### 1.4 Upload de arquivos hoje

- **Disco local do servidor**, não banco, não bucket. Pasta configurada por `RH_TRAINING_UPLOAD_DIR` (`D:\ConectaDados\training-uploads` em produção; subpastas por funcionalidade, ex.: evidências e logos da Monitoria). Metadados em tabela; arquivo servido **pela API com checagem de permissão** (`monitoria_fluxo.py:325`).
- Validação (`services/training_uploads.py`): allowlist de extensão + **magic bytes** + limite de tamanho (configurável por categoria) + nome interno gerado (`generate_public_token`).
- Lacunas para o módulo: vídeo `.mp4/.webm` e imagens já cobertos; faltam `.xls/.xlsx/.txt` e `.mov`; magic bytes de `.xlsx` (zip) e `.txt` (UTF-8 sem NUL) são triviais de adicionar. Hoje o arquivo inteiro é lido em memória (`content_bytes`) — aceitável para 25 MB, não para vídeos maiores (streaming em `StorageProvider.upload`).
- O SharePoint via Graph **também** já é usado (Mural, Calendário; `sharepoint_drive_id` em `config.py`), então a opção B é tecnicamente viável.

### 1.5 Hospedagem, deploy e backup

- **Produção:** servidor **Windows** próprio, com *self-hosted runner* do GitHub; aplicação roda como tarefa agendada `Conecta-RH` (uvicorn em `:8000`); SQL Server Express local; dados em `D:\ConectaDados`. (`compose.prod.yml` existe, mas `deploy-producao.yml` e `infra/BACKUP.md` descrevem o Windows — **confirme que é o Windows** (D-13).)
- ⚠ **Deploy automático em produção a cada push na `main`** (`deploy-producao.yml`). Trabalho será na branch `chamados`, saindo de `modularizacao`; **nenhum merge/push na main sem sua ordem.**
- **Backup (`infra/BACKUP.md`):** `Conecta-Backup-Diario` 02:00 (`.bak` com CHECKSUM + `RESTORE VERIFYONLY`, **zip da pasta de dados inteira**, cópia para destino externo com hash); `Conecta-Backup-TesteRestauracao` domingo 04:00 (restaura como `RH_Restore_Teste`, `DBCC CHECKDB`, confere arquivos referenciados no banco). Retenção: servidor 14 dias; externo = 14 dias + 1/semana por 8 semanas + 1/mês por 12 meses. Alertas no Log de Eventos e e-mail.
- ⚠ **Express limita o banco a 10 GB** — mais um motivo para anexo fora do banco.

### 1.6 Busca de usuários e matrícula

- `GET /settings/users?search=` (`list_system_users`, exige `usuarios.visualizar`) — **não serve** para o módulo (retorna dados de gestão de usuários, sem escopo por operação, permissão errada).
- **Matrícula: não existe** (nenhuma coluna ou referência em `infra/` ou `rh_api/`). `dbo.usuarios` tem `login, nome, email, perfil_id, status, cargo, microsoft_oid, …`. Busca por matrícula exige coluna nova — e você já rejeitou antes um campo pessoal novo não solicitado. **Decisão em D-3.**
- Os "agentes impactados" são `usuarios` de perfil **Operador** vinculados à operação. Vou criar `GET /chamados/agentes` próprio, com `chamados.abrir`, restrito às operações do solicitante, `limit` (10) e só campos mínimos (id, nome, e-mail, [matrícula]).

### 1.7 Dados do perfil vindos da Microsoft

- O login lê do ID token apenas `oid`, `tid`, `email`/`preferred_username` e `name` (`routers/auth.py:484-516`); escopo `User.Read`.
- **Cargo** já existe em `usuarios.cargo`, mas é **editado pelo próprio usuário** (`PUT /auth/me/cargo`), não vem da Microsoft. **Unidade/site não existe.**
- `User.Read` já permite `GET https://graph.microsoft.com/v1.0/me?$select=jobTitle,officeLocation` no login (sem permissão nova), **mas só se o RH/TI preenche esses campos no Entra** (a verificar).
- Proposta (D-4): "site/unidade" = operação(ões) do usuário; cargo = `usuarios.cargo`. Opcional: enriquecer com Graph `/me`.

### 1.8 Jobs agendados e fila — **existem**

- `rh_api/scheduler.py`: **APScheduler `BackgroundScheduler` dentro do processo do backend** (UTC), com 5 jobs (inatividade 1 h, SLA da Monitoria **a cada 5 min**, arquivamento de logs, LGPD…). Cada job: função `_run_*_job(settings)` que cria o próprio repositório e **nunca deixa exceção escapar**. Desligável por `RH_SCHEDULER_ENABLED`; degrada se faltar a lib.
- **Modelo a copiar:** `mon_processar_slas` (Monitoria) — idempotente, mesmo caso de "encerrar após 48 h".
- `task_queue.py`: RQ + Redis **opcional** (dependências comentadas em `requirements.txt`; sem Redis cai em execução síncrona). **Não preciso de fila**; os 2 jobs de 15 min cabem no APScheduler.
- ⚠ Se o backend for iniciado com mais de um worker/processo, o job roda duplicado — por isso ambos serão **idempotentes** e a notificação de SLA usa marcadores (`sla_vencido_notificado_em`, `sla_aviso_notificado_em`).

---

## 2. Como as permissões entram

| Permissão | Dono (`modulo_dono`) | Abre módulo? | `critical` |
|---|---|---|---|
| `chamados.abrir` | tecnologia | **sim** (ver D-1) | não |
| `chamados.ver_operacao` | tecnologia | não | não |
| `chamados.atender` | tecnologia | sim | sim |
| `chamados.atribuir` | tecnologia | não | sim |
| `chamados.dashboard` | tecnologia | não | não |
| `chamados.configurar` | tecnologia | não | sim |

**Pontos de edição (Fase 1):**
`rbac.py` (definições + seed: Supervisor `abrir`; `tecnico_*` e `analista_ti` `atender`+`atribuir`+`dashboard`; Administrador todas — o Administrador já recebe o catálogo inteiro) · `modulos_catalogo.py` (`_DONO_POR_GRUPO["Chamados"]`, `ABRE_MODULO_PADRAO`) · `PERMISSIONS_VERSION` · migration que insere em `permissoes`/`perfil_permissoes` com `IF NOT EXISTS` · `features/configuracoes/index.js` (`SESSOES_PERMISSAO`) · `controlador-aplicacao.js` (`PERMISSOES_TELAS`).

**Regras de acesso a um chamado (no service, não no router):**
`pode_ver` = solicitante **OU** `atender` **OU** responsável **OU** (`ver_operacao` **E** operação do chamado ∈ operações do usuário). Solicitante nunca perde acesso ao próprio chamado. Comentar = mesma regra, exceto chamados `Encerrado`/`Cancelado`. Sem nenhuma permissão `chamados.*` e sem ser solicitante ⇒ **403**, e a rota do frontend mostra "Acesso restrito".

---

## 3. Estratégia de armazenamento de anexos

**Princípio:** banco guarda só metadados (nome original, mime, tamanho, SHA-256, chave interna, quem enviou, quando). Arquivo fora do banco. Interface `StorageProvider` (`put(stream, chave) → ref`, `open(ref) → stream`, `delete(ref)`, `exists(ref)`; `get_download_url` só em provedores que suportam URL assinada). Download **sempre pela API** (checa acesso ao chamado, grava evento de auditoria).

| | **A. Disco local `D:\ConectaDados\chamados`** (recomendada) | **B. SharePoint/OneDrive via Graph** | **C. Bucket S3-compatível** (R2 / B2 / S3) |
|---|---|---|---|
| Custo | **R$ 0** (usa o disco existente) | Incluso na licença M365 (cota do tenant) | R2: 10 GB grátis, sem custo de saída; B2: 10 GB grátis, ~US$ 6/TB/mês depois; S3: ~US$ 0,023/GB/mês. Valores públicos, a conferir. |
| Backup | **Já coberto** pela rotina diária + teste semanal (pasta `D:\ConectaDados` inteira) | Lixeira/versões do M365 (~93 dias); **não é backup de verdade** (proteção contra exclusão acidental, não contra admin malicioso/ransomware/retention mal configurada) | Versionamento + *lifecycle* resolvem exclusão acidental; DR é do provedor |
| Já usado no Conecta | Sim (padrão consolidado, com magic bytes) | Sim, para Mural/Calendário | Não |
| Privacidade | Arquivo nunca sai do servidor | Dentro do tenant; app com `Sites.ReadWrite.All` amplia superfície | Dado fora do tenant: LGPD, contrato, credenciais novas |
| Contras | Servidor único (o backup externo mitiga); o zip diário cresce com vídeos; sem versionamento nativo | Upload >4 MB exige *upload session*; latência; dependência de token/cota; download ainda precisa de proxy pela API | Novo fornecedor, nova credencial, nova aprovação |
| Esforço | Baixo | Médio | Médio |

**Recomendação:** **A agora**, com `StorageProvider` permitindo B ou C depois sem mexer no módulo. Para cumprir "restaurar arquivo apagado por engano" **sem depender do backup**, anexo apagado vira **exclusão lógica** (`excluido_em`, arquivo fica no disco) e um job só remove fisicamente após 30 dias. A retenção externa existente (14 dias + semanal) fica como segunda camada.

**Estimativa de crescimento (premissa minha, ajuste com dados reais):** 200 chamados/mês × 2 anexos × média 5 MB ≈ **2 GB/mês ≈ 24 GB/ano**. Limites sugeridos: 25 MB por arquivo, 100 MB por chamado.

**Teste de backup/restauração de um anexo (entregável da Fase 1):** (1) subir anexo de teste; (2) rodar `Start-ScheduledTask Conecta-Backup-Diario`; (3) apagar o arquivo físico e o registro; (4) rodar `Conecta-Backup-TesteRestauracao` e conferir que a verificação de arquivos referenciados inclui `chamados/`; (5) extrair do zip e comparar SHA-256. Preciso **adicionar `chamados` às conferências do `teste-restauracao`** (hoje confere CVs e anexos da Monitoria).

**Upload:** reaproveitar `training_uploads.py` ampliando a allowlist (`.xls .xlsx .txt .mov .gif`), mime por magic bytes (nunca pela extensão), nome interno UUID, caminho `chamados/AAAA/MM/<uuid>`, limites lidos de `chamado_config`.

---

## 4. Modelo de dados (SQL Server, migration `V059__chamados.sql` + `.rollback.sql`)

> Datas em **`DATETIME2` UTC com `SYSUTCDATETIME()`**, como você pediu. **O restante do Conecta grava `GETDATE()` (hora local do servidor)**; por isso a API serializa com sufixo `Z` e o frontend converte para America/Sao_Paulo. Convenção nova só neste módulo — ver P-5.

| Tabela | Campos principais |
|---|---|
| `chamados` | `id_chamado BIGINT IDENTITY`, `numero INT` (de `SEQUENCE dbo.seq_chamado_numero`, **UNIQUE**), `titulo NVARCHAR(160)`, `descricao NVARCHAR(MAX)`, `categoria_id`, `operacao_id` (FK `operacoes.id_item`), `solicitante_id` (FK `usuarios`), `responsavel_id NULL`, `tipo_impacto` (`agente`/`celula`), `pa_posto NVARCHAR(40) NULL`, `pa_parada BIT`, `urgencia` (`baixa/media/alta/critica`), `urgencia_solicitada`, `status`, `prazo_sla`, `sla_pausado_seg INT`, `sla_pausa_inicio NULL`, `resolvido_em`, `encerrado_em`, `encerramento_automatico BIT`, `sla_aviso_notificado_em`, `sla_vencido_notificado_em`, `criado_em`, `atualizado_em`, **`solicitante_nome/email/cargo/unidade`** (instantâneo no momento da abertura, nunca do payload). `CHECK` em status/urgência/impacto. |
| `chamado_agentes` | `chamado_id`, `usuario_id` — PK composta (N:N). |
| `chamado_eventos` | `id_evento`, `chamado_id`, `autor_id NULL` (sistema), `tipo` (`mensagem/status/atribuicao/anexo/urgencia/sistema`), `conteudo`, `dados_json`, `criado_em`. |
| `chamado_anexos` | `id_anexo`, `chamado_id`, `evento_id NULL`, `nome_original`, `mime`, `tamanho`, `sha256`, `chave_storage`, `provider`, `enviado_por`, `criado_em`, `excluido_em NULL`, `excluido_por NULL`. |
| `chamado_categorias` | `id`, `nome`, `ativo`, `ordem` — seed: Hardware, Software/Sistemas, Rede/Internet, Telefonia, Acessos/Login, Outros. |
| `chamado_config` | chave/valor tipado: `sla_horas_critica/alta/media/baixa` (2/4/8/24), `encerramento_auto_horas` (48), `anexo_max_mb` (25), `anexo_max_mb_chamado` (100), `anexo_retencao_exclusao_dias` (30). |
| `chamado_observadores` | `chamado_id`, `usuario_id` — só a tabela. |

**Índices:** `IX_chamados_status(status, prazo_sla)` · `IX_chamados_responsavel(responsavel_id, status)` · `IX_chamados_solicitante(solicitante_id, status)` · `IX_chamados_operacao(operacao_id, status)` · `IX_chamados_prazo(prazo_sla) WHERE status NOT IN ('Encerrado','Cancelado')` (filtrado, para o job) · `IX_eventos_chamado(chamado_id, criado_em)` · `IX_anexos_chamado(chamado_id)` · `UQ_chamados_numero`.

**Migrations:** idempotentes, com transação e `THROW` (padrão V027). Seed por `IF NOT EXISTS`. Rollback só dropa se vazio (padrão V018). Primeiro aplico em **banco DEV descartável**, não no DEV compartilhado.

---

## 5. Regras de negócio (resumo executável)

**Transições (validadas em `services/chamados_workflow.py`; qualquer outra ⇒ 409):**

| De → Para | Quem | Observação |
|---|---|---|
| Aberto → Em andamento | `atender` | "Assumir" ou responder já assume. |
| Aberto → Cancelado | solicitante | só em `Aberto`. |
| Em andamento → Aguardando solicitante | `atender` | **inicia pausa do SLA.** |
| Aguardando → Em andamento | automático (resposta do solicitante) ou `atender` | **encerra pausa**: soma em `sla_pausado_seg`, empurra `prazo_sla`. |
| Em andamento → Resolvido | `atender` | grava `resolvido_em`, notifica validação. |
| Resolvido → Encerrado | solicitante (confirmar) ou job (48 h) | job marca `encerramento_automatico=1` e evento `sistema`. |
| Resolvido → Em andamento | solicitante (reabrir, **motivo obrigatório**) | zera `resolvido_em`, notifica TI. |

**Urgência:** piso **Alta** se `pa_parada=1` **ou** `tipo_impacto='celula'`, aplicado no service (solicitar menor é corrigido para o piso e registrado na timeline; ver P-6). `prazo_sla = criado_em + horas(urgência) + sla_pausado_seg`; mudou urgência ⇒ recalcula a partir de `criado_em` (P-7). `sla_horas_*` lidos de `chamado_config`; alterar vale só para chamados novos.

**Criação:** operação única ⇒ preenchida; várias ⇒ obrigatória e ∈ vínculos; agentes devem pertencer à operação; `pa_posto` obrigatório se `agente`; dados do solicitante vêm do servidor; todo timestamp do servidor.

**Jobs (APScheduler, a cada 15 min, `_run_chamados_*_job` com a mesma blindagem):** (1) `Resolvido` há mais que `encerramento_auto_horas` ⇒ `Encerrado` + evento + notificação, idempotente por `status`; (2) SLA estourado agora / vencendo na próxima hora ⇒ notificar uma vez (marcadores). Chamados em `Aguardando solicitante` **não** estouram (SLA pausado).

---

## 6. Endpoints (`/chamados`, router com `get_current_user`)

`A`=acesso ao recurso (regra §2). Permissão sempre validada no backend.

| Método | Rota | Permissão | Payload / resposta resumida |
|---|---|---|---|
| GET | `/chamados/meta` | qualquer `chamados.*` | categorias ativas, urgências + prazos, limites de anexo, operações do usuário |
| GET | `/chamados` | `abrir` (escopo `meus`) / `ver_operacao` (`operacao`) | filtros `status, urgencia, categoria_id, operacao_id, vencidos, de, ate, q`, `page, page_size` → itens + totais por status |
| GET | `/chamados/fila` | `atender` | idem + `sem_responsavel, responsavel_id`; ordenação SLA vencido → urgência → prazo |
| POST | `/chamados` | `abrir` | multipart: `dados` (JSON: `titulo, descricao, categoria_id, operacao_id?, tipo_impacto, agentes_ids[], pa_posto?, pa_parada, urgencia`) + `arquivos[]` |
| GET | `/chamados/{id}` | A | cabeçalho, SLA calculado (`vencido`, `pausado`), responsável, agentes |
| GET | `/chamados/{id}/eventos` | A | timeline paginada por cursor (`antes_de`, `limite`) |
| POST | `/chamados/{id}/mensagens` | A | `{conteudo}` + `arquivos[]`; se solicitante em `Aguardando` ⇒ volta a `Em andamento` |
| POST | `/chamados/{id}/assumir` | `atender` | — |
| POST | `/chamados/{id}/atribuir` | `atribuir` | `{responsavel_id}` (precisa ter `atender`) |
| PUT | `/chamados/{id}/status` | `atender` | `{status, justificativa?}` (só destinos permitidos) |
| PUT | `/chamados/{id}/urgencia` | `atender` | `{urgencia, justificativa}` |
| POST | `/chamados/{id}/cancelar` | solicitante | `{motivo?}` |
| POST | `/chamados/{id}/confirmar-encerramento` | solicitante | — |
| POST | `/chamados/{id}/reabrir` | solicitante | `{motivo}` obrigatório |
| GET | `/chamados/anexos/{id}/download` | A | stream (`Content-Disposition`, `X-Content-Type-Options: nosniff`) |
| DELETE | `/chamados/anexos/{id}` | autor ou `atender`; **bloqueado** se chamado `Encerrado` | exclusão lógica |
| GET | `/chamados/agentes` | `abrir` | `?operacao_id&q&limit=10` ⇒ `[ {id, nome, email[, matricula]} ]`, só Operadores da operação |
| GET | `/chamados/atendentes` | `atribuir` | `?q` ⇒ usuários com `atender` |
| GET | `/chamados/dashboard` | `dashboard` | `?dias=7|30|90` ⇒ KPIs + séries (rosca por status, barras por operação/urgência/categoria) |
| GET/PUT | `/chamados/config` | `configurar` | SLA, auto-encerramento, limites |
| GET/POST/PUT | `/chamados/config/categorias[/{id}]` | `configurar` | CRUD (desativar em vez de excluir) |

Frontend: rota `/suporte/chamados` (abas) e `/suporte/chamados/:id`, item "Suporte TI" no `MENU_TECNOLOGIA`, `PERMISSOES_TELAS`/`SESSAO_DA_TELA` atualizados, tela carregada sob demanda.

---

## 7. Wireframes

`docs/wireframes/chamados/wireframes.html` — baixa fidelidade, abas para: **Visão geral · Novo chamado · Detalhe · Fila · Dashboard · Acesso restrito**. Mostram a navbar superior com o seletor de módulo e o item "Suporte TI" dentro de Tecnologia. Sem sidebar.

---

## 7.1 Decisões já tomadas (rodada 2, 03/out/2026)

- **D-1 ✔** `chamados.abrir` abre o módulo Tecnologia. O Supervisor tem a página com **Em aberto · Resolvidos · Histórico** da operação (escopo "Da operação", `chamados.ver_operacao`).
- **D-2 ✔** Busca de agentes só por nome ou e-mail (sem matrícula; D-3 do plano anterior fechado).
- **D-5** Verifiquei o código: **não existe** tela de personalização de tags/cores de status. Uso tokens semânticos do `status-catalog.js`, sem tela nova.
- **D-13 (corrigido)** `D:\ConectaDados` é só recomendação do runbook; o deploy protege `C:\Conecta\data\private`. Anexos irão para uma pasta nova `RH_CHAMADOS_UPLOAD_DIR` (padrão `data/private/chamados`, ao lado dos demais uploads). **A conferir no servidor:** em qual pasta os uploads realmente estão e se a tarefa `Conecta-Backup-Diario` está registrada cobrindo essa pasta.
- **D-14 ✔** `docs/` pode ser versionado com `git add -f` (na branch `chamados`).
- **D-15** em aberto: ver §8.
- **Abas por permissão (rodada 3):** o Supervisor (`abrir` + `ver_operacao`) vê **só a página Chamados**; Fila, Dashboard e Configurações aparecem apenas com `atender`, `dashboard` e `configurar`. Seed do Supervisor não inclui `dashboard` nem `configurar` (já era o plano; agora explícito no wireframe).
- **Compartilhar chamado (rodada 3):** na confirmação de abertura e no detalhe, botões **WhatsApp** (link `wa.me` com texto pronto), **E-mail** (`mailto:` com assunto e texto) e **Copiar link**. Só frontend, sem endpoint e sem envio pelo servidor. Texto com número, título, urgência e link; nunca descrição, agentes ou anexos. O link exige login e acesso ao chamado.
- **Estado do git:** árvore limpa na `modularizacao` (só `trilha-qa-conecta.html` não rastreado); último commit `b1065ac1` de hoje 14:41. Não há `origin/modularizacao` local, então nada dessa branch foi publicado.
- **Padrão visual:** wireframes v2 com grade de 8px, ícones, alinhamento por colunas fixas, um bloco por função (ver `wireframes.html`).

## 8. Dúvidas (preciso de resposta antes da Fase 1)

| # | Dúvida | Minha recomendação |
|---|---|---|
| D-1 | `chamados.abrir` abre o módulo Tecnologia? Se sim, o Supervisor passa a ver o seletor de módulos com "Tecnologia", e dentro dele só "Suporte TI". | Sim (segue sua definição: item dentro de Tecnologia), menu filtrado por permissão. Alternativa: "Suporte TI" no módulo Operação, mudando dono de `abrir/ver_operacao` para `operacao`. |
| D-2 | O Supervisor abre chamado **por** operadores que têm usuário no Conecta? Todo operador tem conta em `usuarios`? | Assumo que sim. Se não, preciso de cadastro leve ou agente "texto livre". |
| D-3 | **Matrícula:** criar coluna `usuarios.matricula` (nullable, preenchida por importação/edição pelo RH) ou buscar só por nome/e-mail? | Só nome/e-mail agora; matrícula numa tarefa separada, aprovada por você (campo pessoal novo). |
| D-4 | "Cargo e site/unidade": usar `usuarios.cargo` + operação(ões), ou enriquecer com Graph `/me` (`jobTitle`, `officeLocation`) se o Entra estiver preenchido? | Cargo + operação agora; Graph como melhoria. |
| D-5 | Cores de status/urgência: não achei página genérica de "personalização de tags". Existe alguma que me escapou? | Usar tokens semânticos de `status-catalog.js` (success/warning/danger/info) sem tela nova. |
| D-6 | O SLA conta horas **corridas** (24×7) ou comerciais? TI atende 24 h? | Corridas, como no prompt (Crítica 2 h etc.). |
| D-7 | Aberto → Aguardando solicitante é permitido (TI pede informação antes de assumir)? O diagrama só tem Em andamento → Aguardando. | Seguir o diagrama: pedir informação exige assumir (um clique). |
| D-8 | Chamado `Encerrado` pode ser reaberto? O diagrama só reabre `Resolvido`. | Não; abre-se um novo chamado referenciando o anterior (fora do escopo). |
| D-9 | Haverá nota interna (visível só à TI)? Não está no prompt. | Não agora. |
| D-10 | O piso de urgência (PA parada/célula) vale também para a TI ao alterar urgência? | Sim, ninguém desce de Alta nesses casos. |
| D-11 | `ver_operacao` pode **comentar** em chamado de outro solicitante da operação (sim, pelo prompt) mas **não** confirmar/reabrir/cancelar. Correto? | Sim. |
| D-12 | Quem recebe "novo chamado/SLA estourado": toda a TI (por permissão `atender`) ou só quem está de plantão (WFM)? | Toda a TI por permissão; integrar plantão depois. |
| D-13 | Produção é mesmo o servidor Windows com `Conecta-RH` e `D:\ConectaDados`? Quanto de disco livre? | Preciso confirmar para dimensionar anexos. |
| D-14 | Posso forçar o versionamento de `docs/chamados` e `docs/wireframes/chamados` (`git add -f`)? | Sim, na branch `chamados`. |
| D-15 | Autorização de escopo: o `CLAUDE.md` exige autorização expressa para trabalho full-stack. Este prompt basta como a "rodada" de Chamados (novas tabelas V059, rotas, RBAC, menu)? Registro no `CLAUDE.md` entra na Fase 1. | Sim, com a mesma ressalva: aditivo, sem alterar rotas/telas existentes. |

## 9. Premissas adotadas

- **P-1** Stack real (FastAPI + pyodbc + JS puro) no lugar de React/Tailwind/shadcn; UI com os componentes existentes (`ui/components`, grade de 8px, sem gradiente, cores sóbrias).
- **P-2** Branch `chamados` a partir de `modularizacao`; nada na `main`.
- **P-3** Migrations V059+ idempotentes com rollback; testadas em banco descartável.
- **P-4** Sem fila/Redis: jobs no APScheduler existente, idempotentes.
- **P-5** Timestamps novos em UTC (`DATETIME2`/`SYSUTCDATETIME`), API em ISO-8601 com `Z`, exibição em America/Sao_Paulo; só neste módulo.
- **P-6** Na **abertura**, urgência abaixo do piso é corrigida para o piso (com evento na timeline). Na **alteração pela TI**, descer abaixo do piso é recusado (422), porque é uma ação explícita.
- **P-7** Recalculo de SLA por mudança de urgência parte de `criado_em`, somando as pausas já acumuladas.
- **P-8** Sem permissão `ver_operacao` o Supervisor só vê os próprios chamados; Operador não vê o módulo.
- **P-9** Escopo de operação exige vínculo explícito (contrário ao "sem vínculo vê tudo" usado em outros módulos); Administrador e Gestor são globais.
- **P-10** Anexos em disco local (opção A), exclusão lógica 30 dias; limites 25 MB/arquivo e 100 MB/chamado, editáveis.
- **P-11** Notificação para a "equipe de TI" resolvida por permissão → perfis; categoria `chamados` nova no sino.
- **P-12** `chamado_observadores` criada e sem uso; sem base de conhecimento, e-mail, pesquisa de satisfação ou tempo médio.
- **P-13** Permissão nova ⇒ `PERMISSIONS_VERSION` sobe ⇒ relogin geral no deploy; avisar antes.

## 10. Plano de commits da Fase 1 (para aprovar)

1. `feat(chamados): permissões, módulo dono e seed de perfis` · 2. `feat(chamados): migration V059 (tabelas, sequence, índices, seed)` · 3. `feat(chamados): StorageProvider e upload de anexos` · 4. `feat(chamados): máquina de estados, urgência e SLA` · 5. `feat(chamados): rotas de criação, listagem e detalhe` · 6. `feat(chamados): ações (assumir, atribuir, status, reabrir) e notificações` · 7. `feat(chamados): jobs de encerramento automático e SLA` · 8. `feat(chamados): dashboard e configurações` · 9. `test(chamados): transições, piso de urgência, permissões, pausa de SLA, auto-encerramento, backup de anexo`.
