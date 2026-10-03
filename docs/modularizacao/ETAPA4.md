# Etapa 4 — Flag do WFM no banco (relatório)

## O que mudou
| Item | Detalhe |
|---|---|
| Configuração | `dbo.parametros_sistema`, chave `wfm.liberar_participantes`, categoria `sistema_interno` (a tela de parâmetros não lista nem edita essa categoria — `repositories/sistema.py:200/226`). Nenhuma migration nova: a tabela já existe; a linha é criada pelo código. |
| Valor inicial = valor atual | Na primeira leitura sem linha, o código insere com o valor da variável `RH_WFM_LIBERAR_PARTICIPANTES` **do próprio servidor** (ausente = `0`, que é o comportamento de hoje). INSERT com `UPDLOCK, HOLDLOCK` (seguro contra requisições simultâneas). Não preciso saber o valor de cada ambiente. |
| Ponto único de leitura | `services/acesso.wfm_participantes_liberado()`. `rbac.aplicar_restricao_wfm_em_teste` (chamada em `auth.py` ×2 e `security.py`) manteve a assinatura e delega a ele; `get_role_permissions` agora também aplica o filtro. O filtro de **importação** do `rbac.py` saiu: `ROLE_PERMISSIONS` guarda o desenho completo e o filtro é na leitura (o bloqueio já funcionava assim para o que estava gravado no banco). |
| Precedência | Variável de ambiente **definida (mesmo vazia)** prevalece sobre o banco; quando prevalece, um WARNING (uma vez por processo) registra os dois valores. Para devolver o controle ao botão: apagar a variável do `.env` e reiniciar. Remoção definitiva do fallback: apagar o ramo `_ler_ambiente()` de `acesso.py` num commit à parte, depois de validado em homologação. |
| Falha do banco | **Fechado** (o desenho de hoje sem a variável). Cache de 5 s; invalidado na escrita (no processo que alterou). |
| Token | O token ganha `wl` (estado da flag na emissão). Se a flag for **aberta** depois da emissão, só Operador/Qualidade/Técnicos de TI recebem 401 "faça login novamente"; os demais perfis não são tocados. Fechar vale na hora (o filtro roda a cada pedido), sem derrubar ninguém. |
| Botão | `GET/PUT /tecnologia/parametros/wfm-participantes` (`configuracoes.visualizar` / `configuracoes.editar`). O PUT exige `confirmar: true`, grava auditoria (`Sistema` / `wfm_participantes_alterado`, quem, quando, `{liberado: antes}` → `{liberado: depois}`, justificativa) e **recusa (409) enquanto a variável de ambiente prevalecer** (a mudança não teria efeito). `GET` informa valor efetivo, origem (`ambiente`/`banco`), os dois valores e se é editável. O botão na tela vem na Etapa 7. |

## Testes
- `test_wfm_flag.py` (34): 7 cenários — env ligada, env desligada, env 0 × banco ligado, env 1 × banco desligado, banco ligado, banco desligado, banco indisponível — para Operador, Qualidade e Técnico de TI; **nenhum dos outros 10 perfis muda em nenhum estado**; semente = valor do ambiente; log de prevalência; token (abrir força relogin só dos 3 perfis afetados, fechar vale sem relogin, token novo traz o WFM); botão (confirmação, recusa com env, auditoria, só `configuracoes.editar`).
- `test_wfm_flag_integration.py` (6, contra o banco, restaura a linha): semeio 1/0/0, persistência pelo botão, recusa com env, a tela de parâmetros não lista a chave.
- Regressão: matriz de caracterização (9), `test_acesso_modulos`, `test_wfm_aprovacao_ti` (inclui o teste em subprocesso da fase de teste) continuam verdes sem edição.

## Riscos
- **Vários processos/workers:** a mudança vale na hora no processo que gravou e em até 5 s nos demais.
- Enquanto a variável existir no `.env` de um ambiente, o botão fica desabilitado nele (por desenho).
- `conftest.py` continua definindo `RH_WFM_LIBERAR_PARTICIPANTES=1` para a suíte (o desenho completo do WFM); os testes novos controlam env/banco explicitamente.
