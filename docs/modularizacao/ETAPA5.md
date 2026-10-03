# Etapa 5 — TI dentro do WFM (relatório)

## Decisão: reaproveitar, não criar
A operação interna da TI **já existe**: chave `TI`, "Tecnologia (TI)", ativa, semeada pela V051 (`wfm_schema.py:486`), com os tipos de escala `TI::PLANTAO-SABADO` e `TI::SOBREAVISO`; `wfm_scope.OPERACOES_SO_TIPOS = {"TI"}`. Não criei "Suporte TI" (seria uma segunda operação para a mesma equipe, e a chave `TI` está embutida nas chaves virtuais `TI::…`). Se preferir outro nome de exibição, é só um UPDATE no campo `nome`.

## O que entrou
- `modulos_catalogo.OPERACAO_TI = "TI"` e o campo `operacao_ti` em `GET /core/acesso`: é o filtro que a tela emprestada usa. Aditivo.
- **Nenhuma rota, tabela ou linha de código de WFM nova ou duplicada**: o módulo tecnologia reutilizará `/wfm/*` (há teste garantindo que não existe rota de escala sob `/tecnologia`). `services/wfm_regras.py`: `git diff` contra o início da tarefa vazio.
- **O item de menu "Escalas e Plantões" dentro do módulo tecnologia é frontend**; fica para a Etapa 7, junto com a estrutura de módulos e depois do wireframe aprovado (Etapa 6). O backend já está pronto para ele: um Técnico/Analista de TI já tem `sessao.wfm`/`wfm.*` (Técnico só com a flag aberta) e o servidor já isola pela operação.

## Testes (`test_wfm_ti_isolamento_integration.py`, 7, contra o banco)
- Técnico de TI só enxerga a operação TI; operação de atendimento e turnos dela → 403.
- Analista de TI não enxerga a operação de atendimento; sua lista de escalas só tem a TI.
- **Supervisor de outra operação não vê a escala da TI** (contexto, `TI`, tipo `TI::…` → 403; lista de gestão sem TI). Idem Control Desk.
- Gestor (global) enxerga a TI e as demais.
- A operação `TI` padrão existe (pula se a V051 ainda não foi semeada no banco).
- As regras de aprovação (incluindo a exceção do Analista de TI) continuam validadas por `test_wfm_aprovacao_ti.py`, que rodou **sem nenhuma edição**: 53 testes verdes junto com os de acesso e a matriz.

## Observação
O Administrador, mesmo não tendo permissões operacionais de WFM, vê a TI nos relatórios/cadastros como já via antes; nada mudou.
