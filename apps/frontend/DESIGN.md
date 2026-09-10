# DESIGN.md — Redesign visual do Conecta (linguagem Slack-inspired)

> Resposta a `promt.txt` (rodada de 08/set/2026). Este documento é o entregável
> "1. Design tokens" + "2. Guia de componentes redesenhados" do prompt. A
> aplicação prática (item 4 do prompt) está em andamento por fases — ver
> "Status da aplicação" no final.

> **Correção pós-aprovação (mesma rodada):** a fase 1 originalmente definiu
> laranja/âmbar como cor de ação primária (conforme o texto original do
> prompt). Ao aprovar, o RH pediu para manter o **azul da logo** como cor
> principal dos botões/elementos. Seção 1.1 abaixo já reflete o valor
> corrigido — laranja passou a ser reservado como acento pontual (ex.: o
> símbolo "∞" da logo em si), não mais para CTAs.

## 0. Stack confirmada (obrigatório antes de qualquer token)

O prompt pediu para não presumir Tailwind. Inspecionado o código-fonte:

- **Não é Tailwind, não é MUI/Chakra/Ant/nenhum UI kit.** É React + `htm`
  vendorizados (`vendor/react-dom@18.3.1.mjs`, ver `vendor/README.md`),
  servidos como módulos ES nativos (`<script type="module">`), sem etapa de
  build obrigatória — Vite existe só como dev-server opcional
  (`apps/frontend/README.md`).
- **CSS é global e customizado**, em `apps/frontend/estilos/`: `tokens.css`
  (106 linhas — já existia um sistema de tokens light/dark), `base.css` (662),
  `layout.css` (1889), `screens.css` (**15 880 linhas** — a maior parte da
  UI vive aqui), mais arquivos por feature (`process-details.css`,
  `exam-steps.css`, `exam-analytics.css`, `dashboard-funil.css`).
- **Já existe uma configuração de tema parcial** que deve ser **estendida**,
  não recriada: `tokens.css` já tem paleta light/dark, escala de espaçamento,
  radius, sombra e fonte (`Plus Jakarta Sans` — já foge do default de
  framework, isso é bom e foi preservado).
- Conclusão: item 3 do prompt ("Especificação de configuração técnica") não
  se aplica a Tailwind config — o equivalente aqui é **CSS custom
  properties em `tokens.css`**, consumidas por todo o resto do CSS via
  `var(--token)`.

## 1. Design tokens

### 1.1 Cores — hierarquia cromática (o problema #3 do diagnóstico)

O sistema antigo usava `--color-primary` (azul genérico `#0f5be8`, sem
relação direta com a logo) para **tudo**: botão primário, estado ativo do
menu, foco, links. Isso é o "azul onipresente" citado no diagnóstico — o
problema nunca foi "é azul", foi "é um azul genérico, sem identidade".

Correção (pedido explícito do RH ao aprovar a fase 1): o **azul da logo
continua sendo a cor principal** do sistema — o que muda é que agora é o
**azul certo**. O valor de `--color-primary` foi recalibrado a partir de uma
amostragem de pixel real do arquivo `logo_conecta_padrao.png` (não mais um
azul de SaaS genérico "chutado"):

| Amostra na logo (pixel real) | Hex | Papel |
|---|---|---|
| Trecho mais claro do gradiente "necta" | `#086fca` | base de `--color-primary` |
| Trecho mais escuro/petróleo do gradiente | `#014a8a` | base de `--color-primary-strong` (hover/active) |

| Token semântico | Papel | Light | Dark |
|---|---|---|---|
| `--color-primary` | Cor de marca — base de toda ação/navegação | `#086fca` (antes `#0f5be8`) | `#3d8bdb` (antes `#4f8dff`) |
| `--color-primary-strong` | Hover/active | `#014a8a` (antes `#0b3fa9`) | `#7fb8ff` |
| `--color-action-primary` | Ação principal (CTA, "salvar", "avançar") — alias de `--color-primary` | `#086fca` | `#3d8bdb` |
| `--color-action-primary-hover` | Hover/active do CTA — alias de `--color-primary-strong` | `#014a8a` | `#7fb8ff` |
| `--color-action-primary-text` | Texto sobre o CTA | `#ffffff` | `#ffffff` |
| `--color-action-secondary` | Navegação, estado ativo de menu, links, info — **mesmo azul**, hierarquia vem do preenchimento (sólido = primário) vs. contorno (secundário), não de uma segunda cor | `#086fca` | `#3d8bdb` |

Laranja/âmbar (`--color-accent*`) deixou de ser usado em botão/CTA; continua
disponível como token para o símbolo "∞" da logo em si e eventuais acentos
pontuais, mas não é mais consumido por nenhum componente interativo desta
rodada.

`--ring-primary` (foco global) e ~7 ocorrências de azul genérico
hardcoded (`#0f5be8`, `#0758f0`, `rgba(15, 91, 232, …)`) espalhadas em
`screens.css`, `process-details.css` (`--process-blue`) e `exam-steps.css`
foram corrigidas para o mesmo azul — essas eram inconsistências reais
(a maioria do app já usava corretamente uma variação de `rgba(21, 61, 138, …)`,
muito próxima do valor amostrado da logo; só um punhado de regras usava o
azul genérico antigo por engano/copy-paste).

`--color-accent*` continuam existindo (nada quebra por retrocompatibilidade)
— os tokens semânticos são a camada que os componentes devem consumir.

### 1.2 Superfície, borda e texto (nomenclatura semântica, não literal)

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--color-surface-sunken` | `#f6f8fc` | `#1c2536` | fundo de área rebaixada (ex: dentro de um card, um sub-bloco) |
| `--color-surface` | `#ffffff` | `#171f2e` | superfície padrão (cards, navbar) |
| `--color-surface-elevated` | `#ffffff` + `--elevation-overlay` | `#1c2536` + `--elevation-overlay` | modais, dropdowns, popovers |
| `--color-border-subtle` | `rgba(219,228,240,.7)` | `rgba(44,58,82,.7)` | divisores internos, linhas discretas |
| `--color-border-default` | `#dbe4f0` | `#2c3a52` | borda padrão de card/input (= antigo `--color-border`) |
| `--color-border-strong` | `#c7d3e3` | `#3a4a67` | ênfase, hover de borda (já existia) |
| `--color-text-primary` | `#101d33` | `#e8edf6` | texto principal (= antigo `--color-text`) |
| `--color-text-secondary` | `#4d5f79` | `#b6c2d6` | corpo secundário (= antigo `--color-text-soft`) |
| `--color-text-tertiary` | `#7a8aa3` | `#8a97b0` | legendas, metadados (= antigo `--color-text-muted`) |

### 1.3 Estados (hover, active, disabled, focus, error, success, warning)

Já existiam `--color-success/-danger/-warning/-info` com par `-soft` — mantidos.
Adicionado o que faltava:

| Token | Light | Dark |
|---|---|---|
| `--color-focus-ring` | `0 0 0 3px rgba(8,111,202,.28)` (anel no azul da logo) | `0 0 0 3px rgba(61,139,219,.34)` |
| `--state-disabled-opacity` | `0.55` | `0.5` |
| `--state-hover-overlay` | `rgba(16,29,51,.04)` | `rgba(232,237,246,.06)` |

### 1.4 Tipografia

`Plus Jakarta Sans` mantida (já tem identidade própria — trocar a fonte
não era pedido e pioraria a consistência visual do que já existe). O que
faltava era **escala com papel definido**, não só tamanhos soltos:

| Nível | Token | Tamanho | Peso | Uso |
|---|---|---|---|---|
| Display | `--font-display` | 1.75rem / 28px | 700 | título de tela (1 por página, ex: "Novo processo seletivo") |
| Heading | `--font-xl` | 1.48rem | 700 | título de seção principal (já existia) |
| Subheading | `--font-lg` | 1rem | 600 | título de card/bloco (já existia) |
| Body | `--font-md` | 0.92rem | 400/500 | texto corrido (já existia) |
| Caption | `--font-sm` | 0.82rem | 500 | metadado, legenda (já existia) |
| Label | `--font-xs` | 0.72rem | 600, uppercase opcional | rótulo de campo, tag (já existia) |

Único gap real: faltava um nível **display** acima do `--font-xl` para dar
peso real ao título de página (hoje página e seção usam o mesmo tamanho,
uma causa do "peso visual uniforme" citado no diagnóstico #8).

### 1.5 Espaçamento — grade de 8px (já era a convenção do projeto)

A escala já seguia 8px com um meio-passo de 4px para micro-ajustes:
`4·8·12·16·24·32·40·48`. Isso está de acordo com a regra de grade de 8px do
`CLAUDE.md` (o 4px e o 12px são meios-passos aceitos em qualquer sistema de
8px — Slack e Material fazem o mesmo). Adicionado apenas o degrau que faltava
para respiro macro entre seções (diagnóstico #2, "espaço em branco"):

- `--space-9: 64px` — gap entre blocos de página (ex: header da tela e o
  conteúdo abaixo), não usado dentro de componentes.

### 1.6 Border-radius — 3 níveis com propósito (problema: `xs` e `sm` eram
ambos 6px, redundante e "genérico")

| Token | Valor | Uso |
|---|---|---|
| `--radius-subtle` | 6px | inputs, botões pequenos, chips |
| `--radius-standard` | 8px | cards, botões padrão |
| `--radius-prominent` | 14px | elementos de destaque: painel Resumo, modais, hero cards — deliberadamente maior que o padrão para sinalizar hierarquia, não é o mesmo raio "aplicado em tudo" |
| `--radius-pill` | 999px | badges, stepper, toggle |

(`--radius-xs/sm/md/lg/full` antigos continuam existindo como alias.)

### 1.7 Elevação — 4 níveis (3 pedidos + 1 para overlay)

| Token | Valor (light) | Uso |
|---|---|---|
| `--elevation-1` | `0 1px 2px rgba(15,33,57,.04)` | card em repouso |
| `--elevation-2` | `0 4px 16px rgba(14,33,61,.06)` | card em hover / destaque |
| `--elevation-3` | `0 8px 32px rgba(12,31,58,.08)` | painel de destaque (Resumo) |
| `--elevation-overlay` | `0 12px 40px rgba(12,31,58,.14)` | modal, dropdown, popover — acima de tudo |

---

## 2. Componentes-chave — antes / depois

### 2.1 Stepper (`process-create-step`, `screens.css:3164`) — o mais citado no diagnóstico

**Antes:** círculo numerado 32px + linha de 2px conectando + label centralizada
embaixo, cor de estado = `--color-primary` genérico. É literalmente o padrão
de qualquer UI kit sem customização (diagnóstico #4).

**Depois:** badge quadrado-arredondado (`--radius-subtle`, não círculo) em vez
do círculo genérico, trilho conector mais grosso (4px, pill) em vez da linha
fina de 2px, e a etapa ativa ganha peso real (`transform: scale(1.12)` +
`--elevation-2`) — algo que nenhum stepper de biblioteca pronta faz por
padrão. Cor de estado = `--color-action-primary` (o azul da marca).
Implementado em `screens.css`.

### 2.2 Botões — nova lógica cromática

**Antes:** `.btn-primary` = `--color-primary` (azul), igual à navegação ativa,
igual a link, igual a foco — zero hierarquia entre "isto é a ação principal
da tela" e "isto é onde eu estou navegando".

**Depois:** hierarquia agora vem do **preenchimento**, não de uma segunda cor
(o RH pediu para manter o azul da logo como cor principal em tudo):
- **Primário** (`.btn-primary`): preenchimento sólido em `--color-action-primary`
  (azul da logo) — reservado para a ação principal de cada tela.
- **Secundário** (`.btn-outline-secondary`): contorno (não preenchido) no
  mesmo azul (`--color-action-secondary`) — é uma ação de navegação/suporte,
  distinguida do primário pelo estilo (outline vs. sólido), não pela cor.
- **Terciário/ghost, destrutivo**: já existem parcialmente
  (`.btn-link`, `.btn-danger-soft`) — mantidos como estão, apenas migrados
  para os tokens semânticos de estado (`--color-danger`) em vez de hex
  soltos onde havia.

### 2.3 Painel "Resumo" (`process-summary-panel`, `screens.css:4620`)

**Antes:** reusa exatamente `.rh-section-card` com só um `padding` diferente
— por isso parece um componente genérico encaixado depois (diagnóstico #7).

**Depois:** ganha tratamento próprio: `--radius-prominent` (14px, maior que
o padrão de 8px dos outros cards), `--elevation-3` (mais elevado que os
cards ao redor) e uma barra de destaque de 3px em `--color-action-primary`
(azul da marca) na borda superior — o mesmo vocabulário visual do resto da
tela, mas com peso suficiente para justificar por que ele "flutua" ao lado
do conteúdo principal em vez de competir com ele.

### 2.4 Navbar superior (`rh-modern-topnav`, `layout.css:65`)

Já está correta na decisão estrutural (navbar superior, sem sidebar — como
o prompt exige) e o estado ativo do menu (`is-active`, `layout.css:209`) já
usava `--color-primary-soft/-strong`, que é exatamente o papel "navegação/
informativo" — **mapeado para `--color-action-secondary`, sem mudança de
valor**. A sobrecarga citada no diagnóstico #6 (busca + notificações + perfil
competindo) não foi tocada nesta rodada — precisa de inspeção do componente
React (`fonte/ui/`, não só CSS) para redistribuir hierarquia, fora do escopo
"só tokens/CSS" desta primeira fase. Ver "Próximos passos".

### 2.5 Cards, inputs, tabelas, estados vazio/erro/carregamento

Documentados aqui como direção, **ainda não aplicados no CSS** (ver
"Status da aplicação"):
- **Cards:** 3 variações por hierarquia — `elevation-1` + `radius-standard`
  (conteúdo padrão), `elevation-2` no hover (interativo/clicável),
  `elevation-3` + `radius-prominent` reservado para elementos de destaque
  únicos por tela (como o painel Resumo).
- **Inputs/selects:** manter `--radius-subtle`; o anel de foco já usava uma
  variação do azul da logo (`rgba(21, 61, 138, …)`) na maior parte do app —
  mantido, apenas os pontos com azul genérico foram corrigidos (ver 2.7).
- **Estados vazio/erro/carregamento:** `.rh-empty-state-icon` já usava
  `--color-primary` — nenhuma mudança necessária, herda o azul corrigido
  automaticamente via token.
- **Tabelas/listagens:** usar `--color-border-subtle` para linhas internas
  e `--color-border-default` só na borda externa — hoje usam a mesma
  borda em tudo (parte do diagnóstico #5, "cards uniformes demais"). Ainda
  não aplicado.

### 2.6 Acessos rápidos (`home-quick-action`, `screens.css:4562`)

**Antes:** grade (`grid-template-columns: repeat(auto-fit, minmax(132px,1fr))`)
que quebrava em várias linhas dependendo da largura — e o componente tinha
**8 blocos de CSS diferentes e conflitantes** espalhados pelo arquivo
(`#screen-menu .home-quick-grid`/`.home-quick-action` redefinidos em pelo
menos 6 breakpoints distintos, alguns fora de qualquer `@media`, um deles
com `flex-wrap`/`gap` comentados — resíduo de uma tentativa anterior de
correção nunca finalizada). Na cascata, a última regra de mesma
especificidade vencia, produzindo comportamento inconsistente conforme a
largura da tela.

**Depois:** removidas as 8 sobreposições; uma única regra
(`display:flex; flex-wrap:nowrap`) com os itens em `flex:1 1 76px` —
sempre em **1 linha**, encolhendo juntos para caber, com `overflow-x:auto`
como rede de segurança em telas muito estreitas em vez de quebrar para a
linha de baixo. Tiles reduzidos (56px de altura em vez de 66-76px, ícone e
label menores) para caber melhor os até 6 atalhos.

### 2.7 Correção de azul inconsistente em todo o app

Fora dos componentes acima, uma varredura encontrou ~11 pontos com azul
genérico hardcoded (`#0f5be8`, `#0758f0`, `rgba(15, 91, 232, …)`) misturados
com o azul correto da logo (`rgba(21, 61, 138, …)`, já usado em ~25 outros
lugares) — resíduo de copy-paste. Todos corrigidos para o mesmo azul
(`#086fca`/`rgba(8, 111, 202, …)`), incluindo a variável local
`--process-blue` de `process-details.css` (usada em ~20 seletores daquela
tela — um só ponto de correção resolveu a tela inteira) e os 7 usos
diretos em `exam-steps.css`.

---

## 3. Princípios não negociáveis — como foram respeitados

- **Logo e avatares:** não tocados (nenhum arquivo em `estilos/avatares/`
  ou `logo*` foi alterado).
- **Navbar superior:** preservada, nenhuma sidebar proposta.
- **Zero mudança de comportamento:** todas as alterações desta rodada são
  CSS puro (seletores, `var()`, valores) — nenhum arquivo `.js` foi tocado,
  nenhuma rota/estado/validação mudou.
- **Consistência entre telas:** os tokens novos são globais em `tokens.css`;
  qualquer componente que já usa `var(--color-primary)` etc. continua
  funcionando (nada foi removido), então não há tela quebrada mesmo nas
  ~15 800 linhas de `screens.css` não tocadas ainda.

---

## 4. Status da aplicação

**Fase 1 (aprovada pelo RH):**
1. ✅ Tokens globais (seção 1 completa, luz + escuro).
2. ✅ Botões primário/secundário (`base.css`).
3. ✅ Stepper de criação de processo (`screens.css`).
4. ✅ Painel Resumo (`screens.css`).

**Fase 1.1 — correções pedidas após aprovação:**
5. ✅ Paleta recalibrada para o azul real da logo (amostrado por pixel),
   substituindo o azul genérico em `--color-primary`/`--color-action-primary`
   — cascade automática corrige nav, foco, empty states, etc. sem precisar
   tocar cada componente individualmente.
6. ✅ ~11 pontos de azul genérico hardcoded corrigidos para o mesmo azul
   (`screens.css`, `process-details.css`, `exam-steps.css`).
7. ✅ Acessos rápidos: removidas 8 regras de breakpoint conflitantes,
   consolidado em uma única regra flexível — sempre 1 linha, responsivo.

**Não aplicado ainda, de propósito** — ver seção 2.5:
- Navbar (redistribuição de hierarquia — precisa de componente React, não
  só CSS).
- Cards genéricos, inputs, tabelas, estados vazio/erro/carregamento em todo
  o restante de `screens.css` (ainda ~15 700 linhas, dezenas de telas).

## 5. Pontos sinalizados

1. **Verificação visual ao vivo é parcial neste ambiente**: o app usa SSO
   Microsoft para login, e a sandbox não tem essas credenciais — telas atrás
   de login (`#screen-menu`, wizards, painel Resumo) não puderam ser
   fotografadas rodando de verdade. O que pôde ser verificado ao vivo (tela
   pública de login, tour guiado, botões `.btn-primary`/`.btn-outline-secondary`
   nela) foi checado no navegador nesta rodada e confirmou o azul correto
   nos dois temas, sem erros de console. O restante foi validado por revisão
   de código + grep de todos os seletores tocados + balanceamento de chaves.
   Recomendo conferir visualmente o dashboard e o wizard de processo antes
   da próxima fase.
2. **Escopo de "100% das telas" em uma rodada só não é seguro às cegas**:
   `screens.css` tem quase 16 mil linhas cobrindo dezenas de telas. A
   correção de cor desta rodada foi seletiva e rastreável (grep de cada
   valor hardcoded antes de trocar); uma varredura de cards/tabelas/inputs
   em todo o restante do arquivo já revelou, só no componente de acessos
   rápidos, 8 blocos de CSS conflitantes acumulados — sinal de que o
   restante do arquivo provavelmente tem cruft parecido, e merece o mesmo
   cuidado (encontrar cada duplicata antes de mexer), não uma passada única.

---

## 6. Rodada de 10/set/2026 — redesign completo (processo de 5 fases)

`promt.txt` foi reescrito pedindo um redesign estrutural completo (não
só tokens), com processo obrigatório: pesquisa → auditoria → sistema de
design → wireframes aprovados → implementação. Detalhes completos em:

- `docs/connecta-evolution/02-findings/05_REDESIGN_COMPLETO_AUDITORIA_2026-09-10.md`
  — auditoria das 23 features / ~50 telas, achados transversais (base de
  componentes é Bootstrap puro, KPI tile ícone-círculo repetido 4×,
  duplicações estruturais reais).
- `docs/connecta-evolution/00-governance/DECISION_LOG.md` (D-09) — decisão
  de escopo (lote 1 de 4 telas, resto mapeado para lotes futuros).
- `design/wireframes/README.md` — wireframes do lote 1 (Candidatos,
  Provas Geradas, Dashboard de Funil, folha de sistema) com a cadeia
  problema → referência → decisão por tela, link do canvas publicado.

**Tokens novos adicionados nesta rodada** (`tokens.css`, aditivo, nada
consumido em produção ainda): `--color-chart-sequential-1..6` (paleta
sequencial de matiz único para gráficos de ranking — cor funcional, não
decorativa) e a convenção `font-variant-numeric: tabular-nums` para
qualquer número que precise alinhar (nota, score, contador, moeda).

**Status**: Fases 1-3 completas para o sistema inteiro. Fase 4
(wireframes) completa para o lote 1. Fase 5 (implementação) do lote 1
**concluída** após aprovação conceitual do RH — ver D-09 (atualização)
em `DECISION_LOG.md` para o que mudou de exatamente o wireframe durante
a implementação (funil de conversão limitado às 3 etapas progressivas;
Provas Geradas reorganizado em abas dentro do modal existente em vez de
um workspace mestre-detalhe completo, por risco de regressão maior que
o esperado). Recomenda-se verificação visual do RH (luz e escuro) nas 3
telas antes do próximo lote.
