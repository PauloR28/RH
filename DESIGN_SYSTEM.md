# DESIGN_SYSTEM.md — Conecta

Fonte única de verdade para tokens visuais do Conecta. Qualquer prompt
futuro pode referenciar "siga o DESIGN_SYSTEM.md" em vez de reexplicar
cor/tipografia/espaçamento.

## 0. Stack real (não é o que um prompt genérico presumiria)

- **Não é React+Tailwind+shadcn/ui.** É React + `htm` vendorizado
  (`apps/frontend/vendor/`), sem etapa de build obrigatória, com **CSS
  global customizado** em `apps/frontend/estilos/`: `tokens.css` (tokens),
  `base.css` (componentes-base), `layout.css`, `screens.css` (~15.9k
  linhas — a maior parte das telas), mais CSS por feature.
- **Base de componente**: Bootstrap 5.3.3 via CDN (`index.html`) para a
  grade/classes utilitárias (`.btn`, `.form-control`, `.table`, `.alert`,
  `.badge`), sobrescrito pelos tokens abaixo. Não há shadcn/ui.
- **Ícones**: sistema próprio `IconeSvg` (`fonte/ui/icone.js` +
  `fonte/ui/icones-svg.js`), outline, já cobre o papel do lucide-react.
- **Gráficos**: não havia nenhuma lib (nem recharts, nem d3, nem
  Chart.js). Como o projeto evita dependências pesadas sem bundler
  obrigatório, novos gráficos usam SVG próprio (ver §6) consumindo as
  cores de status/sequenciais abaixo — mesmo resultado visual, zero
  dependência nova.
- **O equivalente ao `tailwind.config`** é `tokens.css`: CSS custom
  properties consumidas por todo o resto via `var(--token)`.

## 1. Cor

Definidas em `apps/frontend/estilos/tokens.css` (`:root`, com overrides em
`:root[data-theme='dark']`). Os tokens semânticos antigos do projeto
(`--color-primary`, `--color-surface`, `--color-border`, `--color-text`,
`--color-success` etc.) foram convertidos em **alias** destes — nenhum
arquivo de tela precisou ser tocado para herdar os novos valores.

| Token | Light | Dark | Papel |
|---|---|---|---|
| `--brand` | `#0A4B8C` | `#3d8bdb` | primária — botões, links, elementos ativos |
| `--brand-ink` | `#00274D` | `#7fb8ff` | hover/active do primário |
| `--brand-soft` | `#E8F0F9` | `#16273f` | fundo selecionado/hover |
| `--ink` | `#14181F` | `#e8edf6` | texto principal |
| `--ink-soft` | `#5B6472` | `#b6c2d6` | texto secundário, legendas |
| `--ink-faint` | `#8B93A1` | `#8a97b0` | desabilitado, placeholder |
| `--paper` | `#FFFFFF` | `#171f2e` | fundo base |
| `--paper-sunken` | `#F7F8FA` | `#1c2536` | sidebar, sub-seções |
| `--line` | `#E4E7EC` | `#2c3a52` | bordas hairline |
| `--line-strong` | `#C9CED8` | `#3a4a67` | borda foco/hover |
| `--status-success` / `-bg` | `#0F7B4A` / `#E7F6EF` | `#3fc793` / `#123227` | sucesso |
| `--status-warning` / `-bg` | `#B7791F` / `#FBF0DD` | `#f0ac4f` / `#3a2b12` | atenção |
| `--status-danger` / `-bg` | `#C0392B` / `#FAEAE8` | `#ea6a7c` / `#3a1b22` | erro |
| `--status-info` / `-bg` | `#0A4B8C` / `#E8F0F9` | `#4fb8e6` / `#12303d` | informativo |
| `--status-neutral` / `-bg` | `#6B7280` / `#F1F2F4` | `#9aa4b2` / `#232e42` | neutro |

Regra: nenhum componente novo/tocado usa cor hardcoded — sempre `var(--token)`.
`--color-accent*` (laranja) e `--color-scheduled*` (roxo) continuam existindo
como tokens à parte, fora da paleta de status padrão (usos pontuais/status
"agendado" já consolidados em rodadas anteriores).

## 2. Tipografia

Fonte única: **Inter** (`--font-sans`, carregada via Google Fonts em
`index.html`). `DM Mono` (`--font-mono`) mantida apenas para os pontos que
já a usavam (não é heading nem corpo). `tabular-nums` obrigatório em
tabelas/contadores/notas/percentuais via `font-variant-numeric: tabular-nums`.

Escala nova (`--text-*`, em `tokens.css`) — fonte da verdade para trabalho
novo:

| Token | Valor | Uso |
|---|---|---|
| `--text-xs` | 12px | metadados, timestamps |
| `--text-sm` | 13px | corpo secundário, labels |
| `--text-base` | 14px | corpo padrão |
| `--text-md` | 16px | corpo destacado, valores importantes |
| `--text-lg` | 20px | títulos de card/seção |
| `--text-xl` | 24px | títulos de página |
| `--text-2xl` | 32px | headline de dashboard (uso raro) |

A escala antiga (`--font-xs/sm/md/lg/xl/display`, em rem) continua ativa —
já era numericamente próxima desta e alimenta ~15k linhas de CSS existente.
As duas coexistem durante a migração; **não** renomeie/rebaixe a antiga
tela por tela, é risco sem ganho. Componentes novos consomem `--text-*`.

## 3. Espaçamento

O projeto **já seguia grade de 8px** antes deste round: `--space-1..8` =
`4·8·12·16·24·32·40·48px`, mais `--space-9: 64px` (respiro entre blocos de
página). Esta escala é mantida como está — é mais completa que uma escala
menor e já é consumida por todo o app; renumerá-la quebraria silenciosamente
milhares de usos. Regras de densidade aplicadas nesta rodada em
`base.css` (componentes compartilhados, efeito automático em todo o app):

- Padding padrão de card: `--space-4` (16px) — já era o padrão dos
  `.rh-section-card`/`.app-card`.
- Altura de botão (`.btn`) e input/select (`.form-control`/`.form-select`):
  **36px** (antes 40px/`auto` com borda de 2px) — compactado conforme pedido.
- Borda de input: 1px (antes 2px).

## 4. Bordas e superfícies

- `--radius` (novo, = `--radius-subtle` = 6px): padrão para cards, inputs,
  botões. Aplicado em `.btn`, `.form-control`/`.form-select`, e no bloco
  compartilhado de cards (`.app-card`, `.rh-section-card` e afins).
- `--radius-sm` (novo = 4px): badges/tags — token adicionado, aplicar em
  badges migrados; badges existentes usam `--radius-full` (pill), sem
  mudança nesta rodada.
- `--radius-standard`/`--radius-prominent`/`--radius-pill` (já existiam):
  mantidos para os casos que já usam essa hierarquia de 3 níveis (ex.
  painel Resumo com `--radius-prominent`), não conflitam com `--radius`.
- Bordas: `1px solid var(--line)` — sem `box-shadow` para separar
  elementos. Removido o `box-shadow` que existia no bloco de card
  compartilhado (`base.css`); exceção mantida para dropdowns/popovers/
  modais (`--elevation-overlay`).

## 5. Ícones

`IconeSvg` (`fonte/ui/icones-svg.js`) — outline, já é o padrão do projeto.
Ícones de navegação/ação primária usam `var(--brand)`/`var(--color-primary)`
(já é o comportamento herdado via alias). Ícones puramente decorativos sem
função devem ser removidos ao encontrar (ver Fase 3, caso a caso).

## 6. Gráficos

Sem lib nova instalada (ver §0). Implementados como SVG/HTML próprio em
`apps/frontend/fonte/ui/components/charts.js` + `estilos/charts.css`,
100% em tokens (sem cor hardcoded), verificados visualmente (harness local,
removido após a verificação):

- `BarComparisonChart` — comparativo entre candidatos (barras horizontais).
- `AcceptanceDonutChart` — % aprovação/reprovação (`--status-success`/`--status-danger`).
- `ScoreRadarChart` — comparativo de notas por dimensão (multi-série).
- `StageFunnelChart` — funil de etapas do processo (paleta sequencial).
- `ScoreDistributionChart` — distribuição de notas (colunas).

Ainda não conectados a nenhuma tela de relatório real (próximo passo:
`screen-analysis-candidates` e afins).

## 7a. Verificação ao vivo (14/set/2026, sessão com backend real)

Diferente das rodadas anteriores (sem SSO Microsoft disponível), esta
sessão teve acesso real ao backend (`python run.py`, já rodando) via
login local (`RH_AUTH_USER`/`RH_AUTH_PASSWORD` do `.env`). Telas
verificadas ao vivo, autenticado, com `getComputedStyle` real (não só
grep/leitura de código): Tela Inicial, Processos Seletivos, Processos
Encerrados, Central de Treinamentos, Configurações › Usuários, Caixa de
Currículos, Relatórios (Ranking Analítico) — sem erros de console em
nenhuma, luz e escuro.

**Bugs reais encontrados só por ter acesso ao vivo** (invisíveis via
grep/leitura estática — precisavam do `getComputedStyle` real):
1. `#screen-menu .rh-page-intro-actions .btn` e um bloco duplicado
   `#screen-menu .rh-section-card` em `screens.css` sobrescreviam a altura
   de 36px e reintroduziam sombra/raio antigo especificamente na Home,
   por terem especificidade maior que as regras novas de `base.css`.
2. **A causa raiz real** do card com sombra/raio antigo não estava na Home
   — era um bloco de 18 classes (`.rh-section-card, .c24-card,
   .compact-dashboard-card, ...`) em `screens.css` (~L11769), carregado
   depois de `base.css` na cascata, que é o verdadeiro "Card" central do
   app (usado em dezenas de telas). Corrigido ali — propaga para todo o
   sistema, não só a Home.
3. `.rh-metric-card` (tiles de KPI, `layout.css`) tinha sombra permanente;
   removida a sombra de repouso, mantida a elevação sutil só no hover
   (interação, não separação de elementos — dentro do espírito da regra).
4. **Bug real de contraste no modo escuro**: `.form-control`/`.form-select`
   nunca teve `background` definido — no claro isso não aparecia (fundo
   branco do navegador coincide com o app), mas no escuro o `<select>`
   ficava com texto claro sobre fundo branco do navegador, ilegível.
   Corrigido com `background: var(--color-surface)`.

**Gráficos conectados a telas reais**: Relatórios › Ranking Analítico
mostra `BarComparisonChart` (comparativo de notas por candidato) e
`AcceptanceDonutChart` (% aprovação) acima da tabela, usando os mesmos
dados já carregados (`rankingAnaliticoFiltrado`); Detalhe de Processo ›
Dossiê mostra `ScoreRadarChart` (Currículo/Prova/Entrevista/Nota final por
candidato, quando há 2+ candidatos). Ambos token-driven, verificados com
dados reais em luz e escuro.

## 7b. Continuação — telas restantes do Processo Seletivo, Treinamentos e
Configurações (15/set/2026)

Seguindo a ordem da Fase 4, verificadas ao vivo (autenticado): wizard de
criação de processo (7 etapas, incluindo a etapa 3 "Disponibilidade de
Horários para Entrevistas" — já implementada, testada com sucesso),
Detalhe de Processo (8 abas), Entrevistas/Calendário, Central de
Treinamentos (lista, wizard de criação, Atribuições), Candidatos, Banco de
Talentos, e as 13 subabas de Configurações (Perfis e permissões,
Operações, LGPD, Motivos de Eliminação, Modelos de E-mail, Etapas do
Processo, Logs, Notificações, Ambiente — incluindo teste real do toggle de
modo escuro via `c24_tema_preferido` no localStorage —, Onboarding, Central
de Documentos, Administração, DISC/Fit Cultural/Raciocínio Lógico).

**Bugs reais encontrados e corrigidos**:
1. **Bug funcional grave, não é de CSS**: `fonte/banco-questoes.js` fazia
   `fetch('../data/bancoQuestoes.json')` — um caminho relativo resolvido
   contra a URL da PÁGINA atual, não do módulo. Em qualquer rota com mais
   de um segmento de path (ex. `/processos/treinamentos/trilhas`), isso
   resolvia para uma URL errada (`/processos/data/bancoQuestoes.json`,
   404) e **quebrava a inicialização inteira da aplicação** nessa rota.
   Corrigido para `fetch(new URL(url, import.meta.url))`, que resolve
   relativo ao arquivo do módulo, correto em qualquer rota. Confirmado via
   `read_network_requests` (era 404, passou a 200 depois do fix).
2. Dois nomes de ícone usados via `IconeSvg(...)` não existiam no conjunto
   (`icones-svg.js` já loga um aviso de console para isso, com fallback
   visual em círculo genérico): `'dashboard'` (empty state do Mural, Home)
   → trocado por `'article'`; `'view_module'` (cabeçalho "Módulos do
   treinamento" no wizard) → trocado por `'grid_view'` (ambos já existem
   no conjunto). Confirmado por varredura de todo `fonte/` comparando
   nomes usados vs. definidos — não sobrou nenhum.
3. Bug de concordância de gênero: botão "Novo etapa" em Configurações ›
   Etapas do Processo (deveria ser "Nova etapa" — "etapa" é feminino).
   `catalogo-dedicado/index.js` tinha um prefixo "Novo" fixo para as 4
   telas de catálogo genérico (documento/motivo/modelo/etapa); adicionado
   `generoFeminino: true` à config de Etapas e o template agora escolhe
   Novo/Nova condicionalmente.

**Achado, não corrigido (fora do escopo desta rodada de design system)**:
Configurações › Logs demorou **26 segundos** para carregar
(`/settings/audit-logs?limit=160`, confirmado via
`performance.getEntriesByType('resource')`) — retornou 200 OK, não é erro,
mas é uma latência de backend/banco que compromete a experiência. Não
investigado a fundo (fora do escopo de UI/tokens desta sessão) — merece
uma sessão dedicada de performance backend.

## 7c. Configurações › Operações — formulário grande + auditoria completa
de ícones (15/set/2026, continuação)

**"O form está muito grande, tem campos desnecessários"** (item já
sinalizado em rodada anterior): o formulário "Nova regra" de Operações
(`configuracoes/index.js`, `renderCatalogos()`) já estava dividido em 5
seções com cabeçalho (Identificação, Cliente e escopo, Sistemas e acesso,
Localização e jornada, Descrição detalhada) desde a rodada de
Correções.txt item 4b, mas todas ficavam sempre visíveis ao mesmo tempo —
um scroll único e longo. Decisão de UI (não de negócio): transformar as 4
seções específicas de Operações em **acordeão** (`<details>`/`<summary>`
nativos, chevron rotacionando via CSS, sem lib nova), todas recolhidas por
padrão — reduz o tamanho percebido do formulário sem remover nenhum campo
(qual campo é "desnecessário" é decisão do RH, não da UI). "Identificação"
continua sempre visível — é a seção curta e compartilhada com outras telas
de catálogo. Verificado: a seção "Geral" (mesmo componente, outro tipo de
catálogo) não é afetada — só ativa para `tipo === 'operacoes'`.

**Auditoria completa de ícones**: a varredura anterior (`IconeSvg('nome')`)
só pegava um dos três jeitos que o código usa para referenciar ícone.
Ampliando para `<${Icone} name="...">`, `icon:`/`icone:` (config objects)
e `icon="..."`/`icone="..."` (atributo JSX), apareceram **18 nomes de
ícone inexistentes** em `icones-svg.js` (176 ícones definidos), todos
caindo no fallback de círculo genérico com aviso de console — corrigidos
com substitutos semanticamente próximos já existentes no conjunto (ex.
`dashboard`→`article`, `route`→`checklist`, `person_off`→`person_search`,
`shield_off`→`shield`, `restore`→`settings_backup_restore`), exceto dois
casos onde nenhum substituto fazia sentido e um ícone novo foi desenhado
do zero seguindo a mesma convenção geométrica do arquivo (formas
compostas simples, viewBox 24×24): **`print`** (impressora — corpo +
papel entrando por cima + bandeja de saída) e **`shield_lock`** (reaproveita
`SHIELD_BASE` já existente + um pequeno cadeado composto por dentro).
Ambos verificados visualmente antes de aplicar. Script de auditoria
reutilizável (fora do repo, no scratchpad da sessão) — vale rodar de novo
após qualquer rodada futura que adicione ícones.

## 7d. Remoção completa do CSS morto `.day-summary-*`/`.day-stat-card`/
`.c24-notification-*`/`.quick-summary-*` (15/set/2026)

O grupo de ~45 ocorrências flagado em §7a como "grande demais para essa
passada" foi totalmente removido nesta rodada. Na varredura, apareceram
**dois outros componentes irmãos igualmente mortos** que não tinham sido
mapeados antes — `.c24-notification-item`/`.c24-notification-icon` (lista
de notificações antiga) e `.quick-summary-*` (grid/item/label/value/
helper/icon/card) — confirmados via grep em toda `fonte/`, zero uso em
JS. Os três formam a mesma "Home antiga" (pré-redesign para
`.home-pillar-*`/`.home-activity-*`), então foram removidos juntos.

Onde os seletores eram combinados com classes **vivas** (principal caso:
`.interview-stat-card`/`.interview-stat-grid`, usadas de verdade em
Entrevistas), só a parte morta foi removida seletor por seletor — nunca a
regra inteira — para não arriscar a tela viva. `screens.css`: -328 linhas
líquidas nesta sessão (83 inserções, 411 remoções, `git diff --stat`).
Verificado ao vivo depois: Home (KPI pillars, acessos rápidos, todas as
seções) e Entrevistas (Visão Executiva com os 7 KPIs coloridos) renderizam
idênticos a antes, sem erros de console.

## 7e. Logs lento (26s) — causa raiz encontrada e corrigida (15/set/2026)

A query de `list_audit_logs` (`apps/backend/rh_api/repositories/security.py`)
faz `SELECT TOP {limit} ... FROM logs_auditoria ORDER BY data_hora DESC,
id_log DESC` **sem nenhum índice em `data_hora`** — a tabela só tem
`id_log INT IDENTITY PRIMARY KEY` (`bootstrap.py`). Sem índice cobrindo o
`ORDER BY`, o SQL Server precisa varrer e ordenar a tabela inteira antes de
aplicar o `TOP`, e o filtro por módulo/ação/usuário ainda acontece depois,
em Python, sobre as linhas já trazidas — o que fica cada vez mais lento
conforme `logs_auditoria` cresce (o app grava um log a cada ação relevante
do sistema).

**Corrigido** (aditivo, mesmo padrão idempotente já usado para todo índice
deste arquivo — `IF NOT EXISTS (SELECT 1 FROM sys.indexes ...)`):
`CREATE INDEX IX_logs_auditoria_data_hora ON dbo.logs_auditoria(data_hora
DESC, id_log DESC)`, adicionado em `bootstrap.py` logo após o bloco que
cria/ajusta a tabela `logs_auditoria`.

**Confirmado**: RH autorizou o restart, backend reiniciado nesta sessão
(sessão de login preservada). `/settings/audit-logs?limit=160`:
**26.420ms → 83,7ms** (medido via `performance.getEntriesByType`,
mesmos 160 eventos, mesmo conteúdo) — melhora de ~316×.

## 7f. Continuação — Provas Geradas, Detalhe de Processo (abas restantes),
Relatório de Candidatos (15/set/2026)

Dois bugs reais de backend encontrados e corrigidos em
`apps/backend/rh_api/repositories/analytics.py` (Relatório de Candidatos):

1. **Mojibake no código-fonte**: `_yes_no()` retornava o literal
   `"NÃƒO"` (bytes corrompidos direto no `.py`, não é um bug de runtime)
   em vez de `"NÃO"`. Corrigido o literal; confirmado que não é a única
   função consultora de "SIM/NÃO" que ficou afetada — é a única do app
   inteiro (`grep` por "ƒ" em todo `apps/backend` e `apps/frontend/fonte`,
   zero outras ocorrências).
2. **Chave interna vazando na coluna "Processo"**: o campo
   `processo_relatorio` priorizava `id_processo_ref` (formato interno
   `CODIGO@@timestamp-ISO`, usado para desambiguar reaberturas do mesmo
   código de processo) sobre `id_processo` (o código limpo, ex.
   `PROC.OPR`) — RH via a chave interna crua na tela. O mesmo arquivo já
   tinha o padrão correto em outro relatório (`nome_relatorio_processo`,
   L426: `id_processo` primeiro) — só este ponto estava com a prioridade
   invertida. Corrigido para bater com o padrão do resto do arquivo.

Ambos confirmados ao vivo após reiniciar o backend (RH aprovou o
restart): "PROC.OPR" limpo e "NÃO" corretos na tabela.

**Achado, sinalizado, não corrigido** (dado — não é claramente um bug de
UI/backend na certeza que eu tenho agora): a aba "Histórico" do Detalhe de
Processo (Operador/Encerrado) mostra a mesma entrada de aprovação da
Sabrina **duas vezes**, com o mesmo timestamp ao segundo
(`09/09/2026, 15:24:58`). Rastreei até `candidatosComFluxo` (mapeamento
1:1 de `candidatos`, sem merge) — ou seja, o array de candidatos vindo da
API já traz a Sabrina duas vezes para este processo. Não investiguei a
query/tabela de origem para confirmar se é linha duplicada no banco ou
problema de JOIN — precisa de uma sessão dedicada olhando o banco
diretamente.

**Achado, não corrigido, não é meu** (mudança concorrente de outra
sessão/pessoa no mesmo repositório, sinalizada ao RH em vez de revertida):
`layout.css` teve `.rh-section-card-header h3` alterado para
`font-weight: 200` (extra-light) — bem mais fino que o resto da hierarquia
tipográfica do sistema (600-700). Confirmado ao vivo (`getComputedStyle`)
que está valendo em produção — títulos de card em toda a aplicação
(Lista de provas, etc.) estão nesse peso agora. Vale o RH confirmar se foi
intencional.

## 7. Status desta rodada (14/set/2026)

**Feito** (arquivo central, efeito automático em todo o app):
`apps/frontend/estilos/tokens.css` (tokens novos + aliases), `base.css`
(altura/borda de botão e input, card sem sombra), `index.html` (fonte
Inter), `estilos.css` (cache-bust).

**Decisão do RH explícita nesta rodada**: usar o azul `#0A4B8C`/Inter deste
prompt, substituindo o azul amostrado do logo (`#086fca`) e a fonte Plus
Jakarta Sans que uma rodada anterior havia fixado como definitivos.

**Também feito nesta rodada — Home (Tela Inicial), Fase 3 pontual**:
`screens.css` tinha, só para `#screen-menu`, duas gerações de CSS morto
sobre a mesma seção (um trio `.rh-modern-page`/`.rh-page-intro`/
`.rh-modern-title` 100% sombreado por uma versão posterior mais específica,
e um KPI tile antigo `.rh-metric-grid`/`.rh-metric-icon` + outro ainda mais
antigo `.day-summary-*`/`.day-stat-card`/`.quick-summary-*`, nenhum
renderizado pelo JSX atual de `TelaInicio` — confirmado por grep em toda
`fonte/`, zero uso). Removido o trio limpo e as classes órfãs em seletores
combinados (preservando `.rh-recent-card`/`.active-process-card`/
`.interview-stat-card`, que são usadas). **Não removido**: o grupo
`.day-summary-*`/`.day-stat-card` tem ~40 ocorrências espalhadas por todo
`screens.css` (não só na Home — parece ter sido copiado/adaptado para
outras seções em algum momento), tirar tudo com segurança é uma tarefa à
parte, maior que cabia nesta passada.

**Ainda não feito** (próximas fases, não travadas por dependência técnica,
só por tempo): auditoria completa de card/input/tabela nas ~49 telas
restantes de `screens.css`; consolidação de Table/Badge por tela (hoje a
consistência vem majoritariamente do CSS compartilhado, não de um único
componente React reutilizado em todo lugar); conectar os gráficos do §6 a
uma tela de relatório real; remoção completa do grupo `.day-summary-*`
morto (~40 ocorrências, ver acima); passe de bugs estruturais nas demais
telas da Fase 4 (Processo Seletivo, Central de Treinamento, Configurações,
Caixa de CV, Relatórios).

## 8. Mural — ativação completa (15/set/2026)

Pedido do RH: "Ative o mural, com todas as configurações e ações de postagem
na Intranet. Textos e imagens". A tela existia como stub desativado; virou
feature full-stack completa (autorizado pela cláusula de trabalho full-stack
explícito do `CLAUDE.md`).

**Backend** (`routers/repositories/schemas/mural.py`, migration
`V033__mural_publicacoes.sql`): CRUD completo de publicações (rascunho →
publicado → arquivado), upload de imagem embutida (reaproveita
`services/training_uploads.py`), publicação para 1+ intranets via
`ambientes_sharepoint` (tabela já existente, criada em rodada anterior
antecipando isto) — cada publicação vira um `.html` autocontido (imagens em
`base64` embutido) gravado em `{biblioteca_destino ou raiz}/Mural/{slug}-
{id}.html` no site SharePoint de cada ambiente, via Graph API
(`PUT /sites/{id}/drive/root:/{path}:/content`). RBAC: 4 permissões novas
(`mural.visualizar/criar/editar/excluir`), atribuídas por perfil em
`rbac.py`.

**Bug crítico encontrado e corrigido nesta rodada**: rota de servir imagem
(`GET /mural/imagens/{arquivo}`) estava atrás de `Depends(get_current_user)`
— como o token do Conecta vive em `sessionStorage` e vai via header
`Authorization: Bearer` (não cookie), uma tag `<img src>` nunca consegue
mandar esse header, então toda imagem embutida quebrava (401), tanto no
editor quanto no feed publicado. Corrigido extraindo essa rota para um
`public_router` sem dependência de auth (mesmo padrão já usado por
`disc_public_router`/`fit_cultural_public_router`), nome de arquivo validado
por regex (token aleatório de 12 chars, não sequencial — sem risco de
enumeração). **O mesmo bug existe em `onboarding.py`** (`secoes-imagens`/
`baixar_secao_imagem`, endpoint mais antigo com o mesmo padrão) — não
corrigido lá, fora do escopo desta rodada, fica registrado aqui como achado
pendente.

**Frontend**: `features/mural/index.js` (reescrita completa do stub),
`ui/components/mural-editor.js` (editor rich-text reaproveitando
`formatarDocumentoRichText` de `regras-prova.js`), `estilos/mural.css`
(feed em cards, badges de status por ambiente, grade de ambientes no
formulário). Preview das 3 publicações mais recentes na Home
(`features/gestao/index.js`, `TelaInicio`), substituindo o placeholder
"Mural desativado" antigo. Selo de status por ambiente (`Enviado`/`Falhou`/
`Pendente`) virou link clicável para o arquivo no SharePoint quando o envio
foi bem-sucedido (`sharepoint_web_url`, já vinha do backend mas não estava
exposto na UI).

**Verificado ao vivo, ponta a ponta** (sessão autenticada real, backend
rodando): criar publicação com imagem embutida via editor real (upload →
inserção inline → renderização confirmada por `naturalWidth/Height`),
editar (prefill correto), publicar para uma intranet real (arquivo
confirmado criado em `https://c24hs.sharepoint.com/sites/Conecta/Documentos
Compartilhados/Mural/`), arquivar, restaurar (volta para rascunho, não para
publicado — decisão de design: reenviar exige publicar de novo), excluir.
RBAC ponta a ponta (permissões novas aparecem em `/auth/me` após
logout/login, gates de backend e frontend consistentes).

**Documentação entregue**: [`docs/MURAL_GUIA_SHAREPOINT.md`](docs/MURAL_GUIA_SHAREPOINT.md)
— guia para RH sobre como encontrar as publicações no SharePoint (pelo link
direto no Conecta ou navegando manualmente pelo site/biblioteca/pasta
`Mural`).

**Não feito nesta rodada**: correção do bug gêmeo em `onboarding.py`
(mencionado acima); telas de configuração de ambientes SharePoint em
`Administração` não foram alteradas (já existiam de rodada anterior, só
consumidas aqui).

**Bug real encontrado após o RH testar**: o módulo "Mural" não aparecia em
`Configurações → Perfis e permissões` para nenhum perfil (nem Administrador),
apesar do backend contar corretamente as 4 permissões novas (111 no total).
Causa: `features/configuracoes/index.js` agrupa os módulos do `rbac.py` numa
lista fixa `SESSOES_PERMISSAO` (7 "sessões" — Caixa de Currículos, Processos,
Provas, Gestão, Drive, Treinamentos, Configurações); um módulo novo só aparece
na tela se for adicionado a um desses grupos. "Mural" não estava em nenhum.
Corrigido adicionando `'Mural'` ao grupo `gestao` (mesmo menu onde a tela
vive). Verificado ao vivo: "Mural 4/4 ativas" aparece agora sob o perfil
Administrador. Esse é um padrão a repetir: qualquer módulo de permissão novo
precisa ser adicionado manualmente a essa lista, ou fica invisível na tela de
administração sem erro nenhum.

**Ajustes pedidos pelo RH após o primeiro teste real (15/set/2026)**:
1. Reportado: "campo de texto trava, ponteiro não fica disponível" no editor
   de conteúdo. Investigado a fundo (digitei via automação os mesmos 127+
   caracteres do post real que o RH criou, sem conseguir reproduzir o
   travamento; nenhuma sobreposição de z-index/CSS encontrada, `pointer-events`
   correto em todo lugar). Causa mais provável não confirmada: extensão de
   navegador (Grammarly e afins são a causa mais comum e documentada desse
   sintoma específico em campos `contenteditable`) — adicionado
   `data-gramm="false"` (e variantes) no editor como mitigação defensiva de
   baixo custo. Se persistir, precisa reproduzir num navegador anônimo/sem
   extensões para isolar.
2. Não havia como visualizar uma publicação já pronta (só editar, ou abrir no
   SharePoint). Adicionado: clicar no título/resumo/capa do card, ou
   "Visualizar" no menu de ações (agora sempre presente, primeiro item),
   abre modal somente leitura com o conteúdo completo renderizado.
3. `.mural-post-body` e vizinhas reduzidas (padding 16→12px, gap 8→4px,
   título 20→16px, resumo limitado a 2 linhas com `line-clamp`, capa do card
   260→180px de altura) para um feed mais compacto.

## 9. Mural — segunda rodada de correções (15/set/2026, mesma noite)

RH testou de verdade e voltou com 5 pontos. Todos endereçados:

1. **Grade/lista + filtros**: botões de alternância (`grid_view`/`view_list`)
   no canto do topo da tela; `.mural-feed--grade` (`repeat(auto-fill,
   minmax(300px,1fr))`) vs `.mural-feed--lista` (card vira uma linha:
   `grid-template-columns: 96px 1fr`, capa vira miniatura à esquerda).
   Filtros novos (categoria/tipo, data, intranet de destino) — client-side,
   sobre a lista já carregada, sem tocar o backend; status continua sendo os
   tabs Publicados/Rascunhos/Arquivados que já existiam (é o filtro de
   status pedido).
2. **Bug real da caixa "Conteúdo" — não confirmado, mas mitigado a fundo**:
   RH relatou que passar o mouse perto da caixa já deixava o botão Negrito
   "ativado" e bloqueava digitar. Testado exaustivamente via automação
   (incluindo replicar o texto real digitado pelo RH, char a char, em
   viewports diferentes) sem reproduzir — `getBoundingClientRect` mostrou
   sempre 16px de vão entre toolbar e caixa, sem overlap. Como o botão
   "Inserir imagem" saiu do toolbar nesta mesma rodada (ver item 4) e os
   atributos anti-Grammarly já tinham sido postos na rodada anterior, a
   correção adicional foi: `tabIndex="-1"` em todos os botões do toolbar
   (evita qualquer estado de foco residual no botão) e o vão toolbar↔caixa
   subiu de 16px para 24px especificamente no Mural
   (`.mural-editor .rh-editor-toolbar`), sem tocar a versão genérica usada
   pelo editor de provas. Se persistir, é praticamente certeza de extensão
   de navegador (testar em aba anônima) — não CSS do Conecta.
3. **Imagem não aparecia na webpart do SharePoint**: causa real — o HTML
   publicado embute a imagem em `base64` dentro do próprio arquivo `.html`,
   e o SharePoint não gera miniatura a partir de `<img>` embutido num
   arquivo HTML (só gera preview nativo para arquivos de imagem de verdade
   soltos na biblioteca). Corrigido em
   `repositories/mural.py::_enviar_imagens_sharepoint` — junto com o
   `.html`, cada imagem da publicação agora também sobe como arquivo
   separado (`{pasta}/{slug}-{id}-imagem-N.{ext}`) na mesma pasta `Mural`,
   best-effort (não derruba a publicação se o upload da imagem falhar).
   Verificado ao vivo: `PUT .../Mural/{...}-imagem-1.png` retornando
   `201 Created` no log do Graph. Isso faz o arquivo de imagem aparecer com
   miniatura real em qualquer webpart (Conteúdo em destaque/Biblioteca de
   documentos) apontado pra pasta — não cria um "card" único texto+imagem
   (isso exigiria reescrever a publicação como página nativa do SharePoint
   via SharePoint REST API, fora do escopo desta rodada).
4. **Seletor de tipo de publicação**: "Nova publicação" agora abre um modal
   com 3 opções (Somente texto / Somente imagem / Texto + imagem) antes do
   formulário. Upload de imagem saiu de dentro do editor rich-text (o botão
   "Inserir imagem" do toolbar foi removido) e virou um uploader dedicado
   fora da caixa de texto (`UploaderImagensMural`, grid de miniaturas com
   botão remover). Para "Somente imagem" a caixa de texto nem aparece — o
   `conteudo_html` enviado ao backend é gerado automaticamente a partir das
   imagens (`montarConteudoSomenteImagem`), já que o schema exige conteúdo
   não vazio. Editar uma publicação existente sempre mostra as duas seções
   (editor + uploader), independente do tipo original, para não perder
   acesso a conteúdo já existente.
5. **Ícones de perfil em Perfis e permissões**: toda linha da árvore de
   perfis usava o mesmo ícone fixo `badge`. Adicionado `ICONE_POR_PERFIL`
   (`features/configuracoes/index.js`) mapeando cada id de perfil do
   `rbac.py` a um ícone distinto (ex.: `estagiario`→`school`,
   `administrador`→`admin_panel_settings`, `operador`→`support_agent`).

## 10. Mural — terceira rodada (15/set/2026, mesma noite): filtros numa
linha só + texto e imagem publicados juntos no SharePoint

Dois pedidos do RH:

1. **Layout dos filtros/toggle grade-lista**: estavam em duas linhas
   (`.mural-toolbar` + `.mural-filtros-bar` separadas). Unificados numa
   única linha (`overflow-x: auto` como rede de segurança em telas
   estreitas): pills de status (Publicados/Rascunhos/Arquivados) →
   divisor vertical → 3 selects de filtro compactos (sem `<label>` empilhado,
   só `aria-label`) → botão "limpar filtros" (ícone, só quando algum filtro
   ativo) → toggle grade/lista empurrado pra direita com `margin-left: auto`.
   Verificado ao vivo via `getBoundingClientRect()` (mesmo `top` em todos os
   filhos de `.mural-toolbar`).

2. **Texto e imagem publicados como itens separados no webpart** — pedido
   real e válido, não um bug de UI. Causa: um webpart do SharePoint
   (Biblioteca de documentos/Conteúdo em destaque) apontado pra uma PASTA
   sempre lista arquivos como itens individuais — o `.html` e o `.png` da
   rodada anterior (§9) sempre apareceriam como dois cards, nunca um só,
   não importa a configuração do webpart. Não tem como "juntar" dois
   arquivos soltos numa pasta.

   **Solução implementada**: publicar cada postagem também como **um item**
   numa lista do SharePoint (`Mural Publicacoes`, criada automaticamente na
   primeira publicação de cada site — `_garantir_lista_mural_sharepoint` em
   `repositories/mural.py`), com colunas `Resumo`, `Imagem` (URL da imagem
   já enviada como arquivo) e `LinkPublicacao` (URL do `.html`). Um web part
   "Lista" apontado pra essa lista mostra título+resumo+imagem **numa linha
   só** por publicação. Republicar atualiza o mesmo item (`PATCH`, id salvo
   em `mural_publicacao_ambientes.sharepoint_list_item_id`, coluna nova
   nesta rodada) em vez de criar duplicado.

   **Achado de plataforma, não da nossa API** (custou ~40 min de
   investigação isolada com scripts Python ad-hoc chamando o Graph
   diretamente, fora do app): o Microsoft Graph API v1.0 **rejeita a
   criação de colunas do tipo `hyperlinkOrPicture`** em qualquer
   configuração (`isPicture: true` OU `false`, coluna nova isolada ou junto
   com outras) — sempre `400 invalidRequest`/`badArgument`, mesmo sendo um
   tipo de coluna nativo e documentado do SharePoint. Colunas de texto
   simples (`text`) funcionam normalmente. Por isso `Imagem`/`LinkPublicacao`
   são colunas de **texto puro** guardando a URL, não o tipo nativo de
   imagem/link do SharePoint — a miniatura visual vem de "formatação de
   coluna" (JSON) aplicada manualmente na coluna `Imagem` pela própria
   interface do SharePoint (passo a passo e o JSON exato estão no
   [guia entregue ao RH](docs/MURAL_GUIA_SHAREPOINT.md)) — Graph não expõe
   essa formatação via API, só a interface do SharePoint tem essa opção.
   Se uma sessão futura tentar usar `hyperlinkOrPicture` de novo (parece a
   escolha "óbvia" à primeira vista), vai bater no mesmo erro — não tentar
   de novo sem reler isto.
