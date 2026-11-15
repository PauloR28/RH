"""Motor de correcao do teste de raciocinio logico/numerico.

Questoes de multipla escolha com gabarito fixo, dificuldade
(facil/medio/dificil) e tipo (sequencia_logica / interpretacao_numerica /
problema_matematico). Correcao automatica: acerto = alternativa marcada
igual ao gabarito.

Este modulo tambem concentra a logica PURA (sem I/O) de duas features do
roadmap aprovado (respostas.txt):

1. Selecao adaptativa de dificuldade dentro da MESMA aplicacao (modo
   opcional `modo_adaptativo`): ver `proxima_dificuldade_adaptativa` e
   `escolher_proxima_pergunta_adaptativa`.
2. Balanceamento de composicao de dificuldade por nivel de vaga (modo
   fixo, quando a vaga tem `nivel_vaga` definido): ver
   `COMPOSICAO_POR_NIVEL` e `montar_prova_balanceada_por_nivel`.

Isoladas em funcoes puras e testadas separadamente para nao interferir na
logica de embaralhamento/correcao ja existente em `generated_exams.py`.
"""

from __future__ import annotations

import random

ORDEM_DIFICULDADE = ["facil", "medio", "dificil"]


# ----------------------------------------------------------------------
# Feature 1: teste adaptativo simples (sobe/desce 1 nivel por acerto/erro)
# ----------------------------------------------------------------------
def proxima_dificuldade_adaptativa(dificuldade_atual: str, acertou: bool) -> str:
    """Regra de transicao do modo adaptativo simples:

    - Acertou a questao -> tenta subir 1 nivel de dificuldade
      (facil -> medio -> dificil). Se ja estiver em "dificil", permanece.
    - Errou a questao -> tenta descer 1 nivel de dificuldade
      (dificil -> medio -> facil). Se ja estiver em "facil", permanece.

    Esta funcao apenas calcula o nivel-ALVO da proxima questao; a escolha
    efetiva (dentro do que ainda resta no banco/pool daquela aplicacao)
    e feita por `escolher_proxima_pergunta_adaptativa`, que cai para o
    nivel atual (e depois para qualquer nivel disponivel) quando o nivel
    alvo nao tiver questao restante — nunca interrompe a aplicacao por
    falta de questao em um nivel especifico.
    """
    dificuldade_atual = dificuldade_atual if dificuldade_atual in ORDEM_DIFICULDADE else "medio"
    idx = ORDEM_DIFICULDADE.index(dificuldade_atual)
    if acertou:
        idx = min(idx + 1, len(ORDEM_DIFICULDADE) - 1)
    else:
        idx = max(idx - 1, 0)
    return ORDEM_DIFICULDADE[idx]


def escolher_proxima_pergunta_adaptativa(pool_por_dificuldade: dict, dificuldade_alvo: str) -> tuple[dict | None, str | None]:
    """Escolhe (e remove) a proxima pergunta do `pool_por_dificuldade`
    (dict dificuldade -> list[pergunta]), preferindo `dificuldade_alvo`.

    Fallback, em ordem, quando o nivel alvo estiver esgotado dentro
    daquela aplicacao (perguntas ja mostradas nao voltam a aparecer):
    1. mantem o nivel alvo;
    2. tenta os demais niveis, do mais proximo ao mais distante do alvo;
    3. se o pool inteiro estiver vazio, retorna (None, None) — fim do teste.

    Retorna (pergunta_escolhida_ou_None, dificuldade_efetiva_ou_None).
    Nao possui efeitos colaterais fora da mutacao do dict `pool_por_dificuldade`
    recebido (o chamador e responsavel por persistir o estado atualizado).
    """
    if dificuldade_alvo not in ORDEM_DIFICULDADE:
        dificuldade_alvo = "medio"

    if pool_por_dificuldade.get(dificuldade_alvo):
        candidatos = pool_por_dificuldade[dificuldade_alvo]
        escolhida = candidatos.pop(random.randrange(len(candidatos)))
        return escolhida, dificuldade_alvo

    idx_alvo = ORDEM_DIFICULDADE.index(dificuldade_alvo)
    ordem_fallback = sorted(
        (d for d in ORDEM_DIFICULDADE if d != dificuldade_alvo),
        key=lambda d: abs(ORDEM_DIFICULDADE.index(d) - idx_alvo),
    )
    for dificuldade in ordem_fallback:
        candidatos = pool_por_dificuldade.get(dificuldade) or []
        if candidatos:
            escolhida = candidatos.pop(random.randrange(len(candidatos)))
            return escolhida, dificuldade

    return None, None


# ----------------------------------------------------------------------
# Feature 2: balanceamento de composicao de dificuldade por nivel de vaga
# ----------------------------------------------------------------------
# Composicao-alvo (proporcao de facil/medio/dificil) por nivel de vaga.
# Constante nomeada, facil de ajustar depois sem tocar a logica de montagem.
COMPOSICAO_POR_NIVEL: dict[str, dict[str, float]] = {
    "estagiario": {"facil": 0.60, "medio": 0.30, "dificil": 0.10},
    "junior": {"facil": 0.50, "medio": 0.35, "dificil": 0.15},
    "pleno": {"facil": 0.25, "medio": 0.50, "dificil": 0.25},
    "senior": {"facil": 0.15, "medio": 0.35, "dificil": 0.50},
}
# Usada quando a vaga nao informa nivel (ou informa um nivel nao mapeado
# acima) — mantem o fluxo funcionando sem quebrar, com uma composicao
# neutra entre os tres niveis de dificuldade.
COMPOSICAO_PADRAO: dict[str, float] = {"facil": 0.33, "medio": 0.33, "dificil": 0.34}


def _distribuir_quantidade(composicao: dict[str, float], quantidade: int) -> dict[str, int]:
    """Converte proporcoes (que somam ~1.0) em quantidades inteiras de
    questoes por dificuldade, somando exatamente `quantidade`.

    Usa o metodo do maior resto (Hamilton/Largest Remainder): calcula a
    parte inteira de cada fatia e distribui as unidades restantes (por
    causa do arredondamento) para as dificuldades com maior resto
    fracionario, na ordem facil/medio/dificil em caso de empate.
    """
    if quantidade <= 0:
        return {d: 0 for d in ORDEM_DIFICULDADE}

    brutos = {d: composicao.get(d, 0.0) * quantidade for d in ORDEM_DIFICULDADE}
    inteiros = {d: int(brutos[d]) for d in ORDEM_DIFICULDADE}
    faltam = quantidade - sum(inteiros.values())

    restos = sorted(ORDEM_DIFICULDADE, key=lambda d: (brutos[d] - inteiros[d]), reverse=True)
    for d in restos[:faltam]:
        inteiros[d] += 1

    return inteiros


def montar_prova_balanceada_por_nivel(
    perguntas_por_dificuldade: dict[str, list[dict]],
    quantidade: int,
    nivel_vaga: str | None,
) -> list[dict]:
    """Monta a lista de questoes de uma aplicacao (modo fixo) respeitando
    a composicao-alvo de dificuldade do `nivel_vaga` (ou a composicao
    padrao 33/33/34 quando o nivel nao for informado/reconhecido).

    `perguntas_por_dificuldade`: dict dificuldade -> list[pergunta], cada
    lista ja deve estar embaralhada pelo chamador (esta funcao nao chama
    random.shuffle para manter o comportamento determinista/testavel;
    quem monta o pool decide a aleatoriedade da ordem).

    Quando a quantidade-alvo de uma dificuldade excede o que existe no
    banco, o excedente e redistribuido para as demais dificuldades (nunca
    quebra a montagem por falta de questoes num nivel especifico).
    """
    nivel_normalizado = (nivel_vaga or "").strip().lower()
    composicao = COMPOSICAO_POR_NIVEL.get(nivel_normalizado, COMPOSICAO_PADRAO)
    alvo = _distribuir_quantidade(composicao, quantidade)

    disponiveis = {d: list(perguntas_por_dificuldade.get(d) or []) for d in ORDEM_DIFICULDADE}
    selecionadas: list[dict] = []
    sobra = 0

    for dificuldade in ORDEM_DIFICULDADE:
        quantidade_desejada = alvo.get(dificuldade, 0) + 0
        pool = disponiveis[dificuldade]
        pega = min(quantidade_desejada, len(pool))
        selecionadas.extend(pool[:pega])
        disponiveis[dificuldade] = pool[pega:]
        sobra += quantidade_desejada - pega

    if sobra > 0:
        restante_geral = [p for d in ORDEM_DIFICULDADE for p in disponiveis[d]]
        selecionadas.extend(restante_geral[:sobra])

    return selecionadas[:quantidade] if quantidade > 0 else selecionadas


def corrigir_raciocinio(perguntas: list[dict], respostas: dict[int, int]) -> dict:
    """Corrige as respostas do candidato contra o gabarito.

    `perguntas`: lista de perguntas (snapshot), cada uma com pelo menos
        {"id_pergunta"/"id", "gabarito", "tipo", "dificuldade", "feedback_erro"}
    `respostas`: mapa id_pergunta -> indice da alternativa marcada
    """
    detalhes = []
    acertos = 0
    por_tipo: dict[str, dict[str, int]] = {}
    por_dificuldade: dict[str, dict[str, int]] = {}

    for pergunta in perguntas or []:
        pergunta_id = pergunta.get("id_pergunta", pergunta.get("id"))
        gabarito = pergunta.get("gabarito")
        tipo = pergunta.get("tipo") or "indefinido"
        dificuldade = pergunta.get("dificuldade") or "indefinido"
        marcada = respostas.get(pergunta_id)
        correta = marcada is not None and gabarito is not None and int(marcada) == int(gabarito)

        if correta:
            acertos += 1

        por_tipo.setdefault(tipo, {"acertos": 0, "total": 0})
        por_tipo[tipo]["total"] += 1
        if correta:
            por_tipo[tipo]["acertos"] += 1

        por_dificuldade.setdefault(dificuldade, {"acertos": 0, "total": 0})
        por_dificuldade[dificuldade]["total"] += 1
        if correta:
            por_dificuldade[dificuldade]["acertos"] += 1

        feedback = None
        if not correta:
            feedback = pergunta.get("feedback_erro") or _feedback_padrao(pergunta)

        detalhes.append(
            {
                "id_pergunta": pergunta_id,
                "tipo": tipo,
                "dificuldade": dificuldade,
                "alternativa_marcada": marcada,
                "gabarito": gabarito,
                "correta": correta,
                "feedback_qualitativo": feedback,
            }
        )

    total = len(perguntas or [])
    nota = round((acertos / total) * 100, 1) if total else 0.0

    return {
        "total_questoes": total,
        "acertos": acertos,
        "nota": nota,
        "detalhes": detalhes,
        "por_tipo": por_tipo,
        "por_dificuldade": por_dificuldade,
    }


def _feedback_padrao(pergunta: dict) -> str:
    enunciado = (pergunta.get("enunciado") or "").strip()
    resumo = enunciado[:80] + ("..." if len(enunciado) > 80 else "")
    if resumo:
        return f"Resposta incorreta — reveja o tópico: {resumo}"
    return "Resposta incorreta — reveja o conteúdo desta questão."
