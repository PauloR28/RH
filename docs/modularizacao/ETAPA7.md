# Etapa 7 — Frontend (relatório)

## Estrutura criada
```
apps/frontend/fonte/modulos/
  registro.js        regras e dados PUROS dos módulos (grupo do menu -> módulo, menu da Tecnologia, filtro da operação TI) — testado em Node
  estado.js          estado em tempo de execução: carrega GET /core/acesso uma vez por sessão; módulo atual (lembrado no navegador)
  componentes.js     SeletorModulo (navbar) e NavTecnologia (menu superior da Tecnologia)
  tecnologia/index.js  centro de administração: início, ativação de módulos, botão do WFM
  operacao/wfm/*     o WFM (git mv de features/wfm, imports ajustados; nenhuma linha de regra alterada)
apps/frontend/estilos/modulos.css   (grade de 8 px, bordas 1 px, sem gradiente; a cor vem da operação)
apps/frontend/fonte/services/api/modulos.js   chamadas dos endpoints das Etapas 3/4
```
- **Lazy loading:** `modulos/tecnologia` e `modulos/operacao/wfm` entram por `import()` dinâmico em `aplicacao-raiz.js`; só carregam quando a tela é aberta. `estado/registro/componentes` são pequenos e entram com o menu.
- **Telas de RH e Monitoria continuam onde estavam** (`features/*`); só o menu passou a saber a que módulo cada grupo pertence.

## O que cada peça faz
- **Seletor de módulo** (`SeletorModulo`, entre o logo e o menu): só renderiza com ≥ 2 módulos visíveis; nome do módulo ao lado do logo; sem cor própria. Trocar leva ao início do módulo.
- **Menu montado do endpoint:** `GET /core/acesso` decide os módulos; o menu de cada módulo filtra os grupos por módulo (`grupoNoModulo`). **Se o endpoint falhar ou ainda não tiver carregado, o menu é exatamente o de antes** (sem filtro) — rollback implícito. Nenhuma lista de perfis foi criada; as existentes (`ICONE_POR_PERFIL`, literais da Monitoria) não foram tocadas.
- **Tecnologia:** início = indicadores (módulos ativos, usuários ativos, WFM), áreas de administração, **ativação de módulos** (interruptores; Núcleo e Tecnologia travados; confirmação com justificativa) e **botão do WFM** (confirmação; desabilitado e explicado quando a variável de ambiente prevalece). Quem só tem esse módulo (Técnicos de TI) cai direto nele.
- **Escalas e Plantões na Tecnologia:** a mesma tela do WFM (mesmas rotas e tabelas). O filtro pela operação TI é aplicado em `services/api/wfm.js` (contexto e lista de escalas) quando o módulo atual é Tecnologia; o isolamento real continua no servidor.
- **Perfis e Permissões por módulo:** a árvore existente ganhou cabeçalhos de módulo (RH · Operação · Tecnologia · Núcleo) agrupando as sessões, o resumo "Este perfil enxerga os módulos: …" (regra das permissões que abrem módulo, calculada sobre o rascunho) e, em cada permissão, o módulo dono (editável por quem pode, com auditoria). `GET /settings/security/permissions` ganhou `modulo_dono` e `abre_modulo` (aditivo).

## Verificação (feita de verdade, com o servidor rodando contra a cópia `RH_Provas_modularizacao`)
Sessões montadas com tokens reais assinados pelo backend (perfis de teste e usuários reais de TI/Administrador da cópia):
| Perfil | Resultado |
|---|---|
| Administrador | seletor RH · Operação · Tecnologia; abre em RH com o menu completo de RH |
| Gestor | seletor RH · Operação |
| Analista (RH) | **sem seletor**, menu completo igual ao de antes |
| Supervisor | **sem seletor**; Início · Treinamentos · Monitoria · Turnos e Plantões (igual ao de antes) |
| Analista de TI (real) | seletor Operação · Tecnologia; Tecnologia: Início · Acessos · Sistema · Auditoria · Escalas e Plantões |
| Técnico Pleno (real, WFM fechado) | **cai direto na Tecnologia, sem seletor**, sem "Escalas e Plantões" (D-11) |
- Administrador em **Tecnologia** vê só a escala da TI em Escalas e Plantões; em **Operação** vê todas.
- **Ativar/desativar módulo pela tela**: RH desligado → `/core/acesso` mostra RH inativo e sem `candidatos.visualizar`, `GET /processes` responde 403, o WFM segue 200; religado → 200. Registrado em `logs_auditoria` (`modulo_ativacao_alterada`, antes/depois).
- **Botão do WFM** pela tela: liberar → banco `1`; fechar → `0`; auditoria `wfm_participantes_alterado` com antes/depois.
- Perfis e Permissões: cabeçalhos por módulo e resumo corretos (Supervisor → "Operação").
- Testes: `test_modulos_frontend_contract.py` (7: rotas da SPA não colidem com a API, telas mapeadas, registro espelha o catálogo do backend, WFM só em `modulos/operacao`, carregamento sob demanda, **um único especificador `?v=`** para estado/registro/componentes, regras puras executadas em Node). `node --check` em todo `fonte/**/*.js`. Backend: ver resultado da suíte abaixo.

## Desvios do wireframe aprovado (e por quê)
1. **Perfis e Permissões:** em vez de abas por módulo, cabeçalhos de módulo dentro da árvore perfil → sessão já existente. Motivo: a tela atual é uma árvore com rascunho/comparação/justificativa; trocar o padrão de navegação seria redesenhar uma tela existente (CLAUDE.md proíbe). O agrupamento por módulo, o chip de módulo dono e o resumo foram mantidos.
2. **Início da Tecnologia:** sem "Atividade recente" e sem o indicador "Acessos negados (24 h)" — não há endpoint para isso e eu não criei um só para a tela. A trilha completa está em Auditoria.
3. **Menu da Tecnologia:** "Configurações globais" virou "Catálogos e modelos" + "LGPD e retenção" (as telas que de fato existem).
4. **Rota da SPA:** `/administracao-ti` (e `/administracao-ti/modulos`), não `/tecnologia`, porque `/tecnologia/*` é prefixo da API e recarregar a página devolveria JSON.
5. **Ícones:** `apps`, `view_module` e `cable` não existem no conjunto de ícones do projeto (cairiam num círculo); usei `grid_view` e `verified_user`.

## Descobertas e correções durante a etapa
- **V057 estava errada** (corrigida): a tela de Perfis grava uma linha para *toda* permissão (0 = não marcada). Num perfil já editado (o Analista de TI do DEV), "inserir só o que falta" não concedia nada. Agora a V057 também **liga as linhas negadas** (registrando o valor anterior no log), **uma única vez por (perfil, permissão)** — as migrations são reaplicadas a cada deploy e não podem desfazer decisão posterior. Rollback restaura exatamente (897 linhas, mesmo checksum, nos dois sentidos) e a reaplicação não religa o que o Administrador desligou depois. Teste novo cobre o desenho.
- **Mojibake em migration:** o `sqlcmd` do deploy lê o arquivo na página de código do console; "Operação" foi gravado como "OperaÃ§Ã£o" no banco. A V055 agora é 100% ASCII (acentos como `NCHAR(código)`); teste garante.
- **Cache/módulos ES duplicados:** cada `?v=` distinto vira outro módulo no navegador. `estado.js`/`registro.js`/`componentes.js` usam um único especificador em todos os importadores (teste); `layout.js` foi unificado em `componentes-compartilhados`, `monitoria/index.js` e `aplicacao-raiz`. Todas as versões foram levadas para `20261003-modulos-c`.

## Fronteiras de módulo já violadas (apenas registradas, como pedido)
`operacao/wfm` importa `features/monitoria/comum.js` (`baixarArquivo`); `features/configuracoes` importa `modulos/registro.js`; `ui/components/layout.js` importa `modulos/*`. Todos passam por arquivos compartilhados/utilitários; nenhum módulo importa tela de outro módulo.

## Pendente / fora desta leva
- Mover fisicamente RH/Monitoria/Provas/Treinamentos para `modulos/` (leva futura). `PERMISSOES_TELAS`/`SESSAO_DA_TELA` em `controlador-aplicacao.js` continuam como fonte do mapa tela→permissão (o endpoint ainda não devolve esse mapa).
- O "Guia rápido" (tour) mostra o texto genérico de telas sem roteiro próprio (igual às telas do WFM hoje).
- Não testei: dark mode, largura mobile, Playwright E2E, nem usuários reais de RH/Supervisor/Operador (usei tokens de perfil sem usuário no banco para o menu).
- **CI do frontend:** 5 dos 6 *smoke tests* de `ci.yml` já falham antes desta tarefa (expectativas antigas, ex.: `principal.js?v=20260901-nav-topo-home` que o `index.html` do HEAD já não tem); só `run-excel-correction-smoke.cjs` passa. Não alterei.

## Suíte do backend ao final da etapa (contra a cópia)
755 passam, 11 falham (as mesmas pré-existentes das Etapas 0/3: 8 OneDrive, e2e login, lgpd retenção, tipos de atendimento) e 5 desselecionados (trigger de monitoria, lento no SQL Express). A única falha nova durante a etapa (`test_telas_liberadas_por_perfil_nao_mudaram`) era o teste de caracterização enxergando as telas NOVAS da Tecnologia; ele agora compara só o universo de telas anterior e há um teste próprio garantindo que as telas novas só abrem para quem tem `configuracoes.visualizar`.
