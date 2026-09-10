# Wireframes — Redesign Completo do Conecta

Fase 4 do processo definido em `promt.txt` (rodada de 10/set/2026):
wireframes por tela, aprovação do RH obrigatória antes de qualquer
implementação em produção (Fase 5). Nenhum arquivo de código de produção
foi alterado para gerar estes wireframes — são mockups estáticos
isolados, publicados via Claude Design (canvas multi-artboard).

## Lote 1 — link do canvas

**https://claude.ai/code/artifact/80620e10-b4ba-4d5c-9759-51d19902bc85**

Fonte: `batch-1/Main.dc.html` (Candidatos), `batch-1/ProvasResultados.dc.html`,
`batch-1/DashboardFunil.dc.html`, `batch-1/ComponentSheet.dc.html`,
`batch-1/canvas.json` (layout + anotações com o raciocínio de cada tela).
Arquivo publicado: `batch-1/conecta-redesign-lote-1.html`.

Light mode apenas nesta rodada de wireframe — os tokens semânticos já
resolvem o par escuro automaticamente (ver `tokens.css`); confirmação
visual do dark mode fica para a Fase 5 de cada tela aprovada.

---

## 1. Candidatos — Listagem (`screenId="screen-candidates"`)

**Diagnóstico**: tabela hoje tem 12 colunas de peso visual idêntico
(Candidato, Contato, Cidade, Bairro, Vaga, Processo, Nota, Status,
Origem, Data, CV, Ações) — Cidade e Bairro chegam a ser colunas
separadas. A Nota, provavelmente o dado mais decisório para quem
avalia candidatos, senta como texto simples sem nenhum destaque. O
card "Filtros" fica sempre visível acima da tabela com 3 selects fixos.
O resumo usa `MetricGrid`, o tile ícone-círculo genérico.

**Por que isso é "cara de IA"**: pesquisa de mercado desta rodada
(Superdesign, SmoothUI — ver auditoria) aponta "nenhuma hierarquia de
importância, todo elemento com o mesmo peso visual" como o sintoma
nº1 mais citado de interface gerada por IA. Uma tabela de 12 colunas
iguais é exatamente isso aplicado a dados.

**Referência buscada**: prática de tabela densa ao estilo Stripe
("right-aligned numerals, tabular figures... alignment and density,
not styling" — pesquisa de dashboard/data-table 2026) e o padrão de
filtro busca-primeiro + chips colapsáveis já aprovado e implementado em
Processos na rodada Z-pattern anterior (`.rh-filter-bar`).

**Decisão estrutural**: Cidade+Bairro fundidos numa linha secundária
sob o nome do candidato (mesmo padrão já usado para Processo/id
abaixo); Nota promovida a badge tabular colorido por faixa
(alta/média/baixa), alinhado à direita; card de filtros substituído
pela barra de busca + chips colapsáveis (consistência com Processos,
que já tem esse padrão aprovado); KPIs migrados para o sistema de peso
`rh-metric-card--is-*` já existente (crítico/atenção/neutro/positivo)
em vez do tile ícone-círculo.

---

## 2. Provas Geradas — Lista + Resultado (`screenId="screen-generated-exams"`)

**Diagnóstico**: o resultado de uma prova corrigida vive hoje num modal
de ~1.500 linhas de CSS (`generated-exam-detail-dialog`) — resumo,
heatmap de questões, replay, duração por etapa, respostas, alertas,
síntese qualitativa, tudo empilhado num único diálogo com scroll
extenso. A lista principal tem 10 campos de filtro simultâneos.

**Por que isso é "cara de IA"**: não é um problema de cor — é um modal
que cresceu até virar uma página inteira sem que o continente fosse
replanejado. É reconhecível porque o padrão "hoje eu preciso de mais
uma seção, vou empilhar mais um card dentro do modal" é exatamente
como uma IA generativa (ou um dev sob pressão) resolve escopo crescente
sem parar para redesenhar.

**Referência buscada**: padrão de inbox/lista-com-drill-down (Intercom:
"conversation counts shown; single-click drill-down reveals full ticket
details" — pesquisa de dashboards B2B 2026) e o princípio de densidade
por camadas (Linear: "5-9 core elements visible; complexity hidden
behind tabs").

**Decisão estrutural**: promover de modal para **workspace
mestre-detalhe** — lista compacta a esquerda (com a mesma barra de
filtro colapsável do item 1), ficha completa à direita organizada em
abas (Resumo / Respostas / Heatmap de questões / Replay) usando o
componente `Tabs`/`TabPanel` já existente no app. Elimina o modal
gigante sem remover nenhuma informação — só reorganiza onde ela mora.

---

## 3. Dashboard de Funil (`screenId="screen-dashboard-funil"`)

**Diagnóstico**: apesar do nome, a tela não desenha nenhum funil —
`BarraFunil`/`BarraOrigem` são barras de progresso horizontais de cor
única (`funnel-stage-fill`), sem indicar visualmente queda proporcional
entre etapas. KPIs no mesmo tile ícone-círculo genérico do resto do
sistema.

**Por que isso é "cara de IA"**: nome da funcionalidade promete uma
visualização de dado real e entrega uma barra de progresso reaproveitada
— "data slop" no sentido inverso (visualização de menos do que os dados
pedem), e o uso de cor sem função (barras da mesma cor para valores
completamente diferentes) contraria o princípio "cor funcional, não
decorativa" citado por toda a pesquisa de dashboards 2026 (Stripe,
Datadog, Sentry).

**Referência buscada**: funil em degraus (larguras decrescentes,
trapézios) com anotação de queda percentual entre etapas — formato
padrão de funil de conversão em produtos de analytics B2B; e cor
sequencial de matiz único para ranking (não arco-íris) — princípio
"functional not decorative" da mesma pesquisa.

**Decisão estrutural**: funil real com trapézios decrescentes por
etapa e "↓ X% de queda" anotado entre cada uma; ranking de origem como
barras horizontais em degradê de um único matiz (do mais escuro/maior
volume ao mais claro/menor); KPI "Candidatos no funil" tratado como
hero (maior hierarquia, seguindo o padrão "single trusted number
leading" de produtos fintech/analytics).

---

## 4. Folha de sistema — Fase 3 (não é uma tela do produto)

Documenta a base implementada nesta rodada: tipografia (papel de cada
nível, já existia desde a rodada S-37), paleta (azul da logo confirmado
como principal — decisão já tomada pelo RH em rodada anterior, ver
`apps/frontend/DESIGN.md`), hierarquia de 3 níveis de cartão, densidade
de tabela (compact vs. comfortable), linguagem de ícone (conjunto SVG
próprio já existe, a regra agora é de curadoria consistente), e o
achado mais estrutural desta auditoria: **os componentes-base
(`primitives.js`) usam literalmente classes do Bootstrap 5.3**, que é
citado pelo próprio `CLAUDE.md` do projeto como o exemplo canônico de
"visual padrão genérico" a evitar. A folha mostra lado a lado o botão/
badge atual (Bootstrap puro) e a proposta (classes próprias, mesmo azul
da logo, mesma tipografia do resto do app).

**Importante**: nada disso foi trocado em produção ainda. A troca dos
componentes-base é um item de alto alcance (afeta toda tela que usa
`Button`/`Badge`/`Table` hoje) e só deve ser feita quando um lote de
telas que os usa for aprovado — não como parte "escondida" da
aprovação desta folha.
