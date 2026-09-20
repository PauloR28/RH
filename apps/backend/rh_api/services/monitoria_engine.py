"""Motor de cálculo ÚNICO da Monitoria (promt.txt §5.1–5.4, 5.14, 5.15).

Funções puras, sem SQL e sem I/O: o mesmo código alimenta o formulário, o
Dashboard, os relatórios, o ranking e as exportações XLSX/CSV — nunca existem
duas fórmulas. A "configuração" de uma versão de matriz é um dicionário
serializável (JSON) e é exatamente esse dicionário que vira o snapshot
imutável guardado em cada monitoria.

Regras (Resumo de Regras vence o docx):
  * Resposta por critério: SIM / NAO / NCG / NA.
  * Prioridade: NCG > menos de 3 blocos > N/A > cálculo normal.
  * NCG em qualquer critério => nota 0 (monitoria segue o fluxo, marcada NCG).
  * N/A em qualquer critério => o bloco inteiro é NULO e seu peso é
    redistribuído: nota = soma dos SIM x (100 / soma dos valores dos blocos
    avaliados).
  * Menos de `min_blocos` (3) blocos avaliados => monitoria ANULADA
    (fora dos indicadores de desempenho, mantida no histórico).
"""

from __future__ import annotations

import copy
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

RESPOSTAS_VALIDAS = ("SIM", "NAO", "NCG", "NA")
MIN_BLOCOS_PADRAO = 3

_ALIASES_RESPOSTA = {
    "SIM": "SIM",
    "S": "SIM",
    "NAO": "NAO",
    "NÃO": "NAO",
    "N": "NAO",
    "NCG": "NCG",
    "NA": "NA",
    "N/A": "NA",
}


def normalizar_resposta(valor: Any) -> str:
    return _ALIASES_RESPOSTA.get(str(valor or "").strip().upper(), "")


def _dec(valor: Any) -> Decimal:
    try:
        return Decimal(str(valor if valor not in (None, "") else 0))
    except Exception:
        return Decimal(0)


def arredondar(valor: Decimal | float | int, casas: int = 2) -> Decimal:
    quantum = Decimal(1).scaleb(-casas)
    return _dec(valor).quantize(quantum, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Matriz padrão (versão 1.0) — espelha defaultBlocks() do HTML de referência.
# ---------------------------------------------------------------------------

_BLOCOS_PADRAO: list[tuple[str, int, list[tuple[str, float]]]] = [
    ("Acolhimento", 10, [
        ("Prontidão no Atendimento?", 2.5),
        ("Saudação Inicial Correta?", 2.5),
        ("Identificação do Atendente?", 2.5),
        ("Disponibilidade em Ajudar?", 2.5),
    ]),
    ("Escuta ativa", 15, [
        ("Op. Segue sem Interromper?", 5),
        ("Op. Demonstra Atenção?", 5),
        ("Op. Compreende Contexto?", 5),
    ]),
    ("Sondagem", 15, [
        ("Sondagem Realizada?", 5),
        ("Necessidade foi Identificada?", 5),
        ("Operador é Objetivo?", 5),
    ]),
    ("Solução", 20, [
        ("Solução Correta?", 10),
        ("Procedimento e Prazo Corretos?", 10),
    ]),
    ("Comunicação", 15, [
        ("Atendimento com Clareza?", 5),
        ("Cordialidade?", 5),
        ("Linguagem Adequada?", 5),
    ]),
    ("Condução", 10, [
        ("Controle do Contato?", 2.5),
        ("Segurança no Atendimento?", 2.5),
        ("Atendimento Resolutivo?", 2.5),
        ("Direcionamento Correto?", 2.5),
    ]),
    ("Encerramento", 5, [
        ("Confirmações Finais?", 2.5),
        ("Finalização Positiva?", 2.5),
    ]),
    ("Conformidades", 10, [
        ("Tabulação Correta?", 5),
        ("Informações Necessárias?", 5),
    ]),
]

PILARES_ENCANTAMENTO_PADRAO = [
    {"chave": "Empatia", "desc": "O cliente percebe que está sendo realmente ouvido."},
    {"chave": "Conformidade", "desc": "O operador segue processos, políticas e informações corretas."},
    {"chave": "Experiência", "desc": "Além de resolver, o atendimento deve deixar o cliente com uma percepção positiva."},
]
PILARES_CONHECIMENTO_PADRAO = [
    {"chave": "Agilidade", "desc": "Agilidade do operador em chegar a conclusão correta."},
    {"chave": "Segurança", "desc": "Segurança do operador ao informar e aplicar os procedimentos."},
    {"chave": "Complexidade", "desc": "Complexidade da tratativa e dificuldade de aplicação."},
]

FAIXAS_PADRAO = [
    {"min": 95, "max": 100, "label": "Excelência", "cor": "#1f7a4d", "acao": "Referência para a operação"},
    {"min": 90, "max": 94.99, "label": "Muito bom", "cor": "#2f8f5b", "acao": "Alta qualidade, pequenos ajustes"},
    {"min": 80, "max": 89.99, "label": "Bom", "cor": "#0a4b8c", "acao": "Dentro do esperado"},
    {"min": 70, "max": 79.99, "label": "Desenvolvimento", "cor": "#b7791f", "acao": "Necessita plano de ação"},
    {"min": 0, "max": 69.99, "label": "Crítico", "cor": "#b42318", "acao": "Necessita intervenção e acompanhamento"},
]


def config_padrao() -> dict[str, Any]:
    """Configuração da matriz 1.0 (blocos, pilares, escala e faixas)."""
    blocos = []
    for indice, (nome, valor, criterios) in enumerate(_BLOCOS_PADRAO, start=1):
        blocos.append(
            {
                "id": f"b{indice}",
                "nome": nome,
                "valor": valor,
                "criterios": [
                    {"id": f"b{indice}c{n}", "texto": texto, "peso": peso}
                    for n, (texto, peso) in enumerate(criterios, start=1)
                ],
            }
        )
    return {
        "blocos": blocos,
        "pilares": {
            "encantamento": copy.deepcopy(PILARES_ENCANTAMENTO_PADRAO),
            "conhecimento": copy.deepcopy(PILARES_CONHECIMENTO_PADRAO),
        },
        "escala": {"min": 1, "max": 10},
        "faixas": copy.deepcopy(FAIXAS_PADRAO),
        "min_blocos": MIN_BLOCOS_PADRAO,
    }


# ---------------------------------------------------------------------------
# Validação da configuração (matriz versionada)
# ---------------------------------------------------------------------------


def validar_config(config: dict[str, Any]) -> list[str]:
    """Erros de uma configuração de matriz. Lista vazia = válida.

    Bloqueia (não só avisa, ao contrário do HTML) quando a soma dos pesos dos
    critérios de um bloco difere do valor do bloco."""
    erros: list[str] = []
    blocos = config.get("blocos") or []
    if not blocos:
        return ["A matriz precisa ter ao menos um bloco."]
    ids_blocos: set[str] = set()
    ids_criterios: set[str] = set()
    total = Decimal(0)
    for bloco in blocos:
        nome = str(bloco.get("nome") or "").strip()
        bid = str(bloco.get("id") or "").strip()
        if not nome:
            erros.append("Todo bloco precisa de um nome.")
        if not bid or bid in ids_blocos:
            erros.append(f"Bloco '{nome or bid}' com identificador ausente ou repetido.")
        ids_blocos.add(bid)
        valor = _dec(bloco.get("valor"))
        if valor <= 0:
            erros.append(f"O bloco '{nome}' precisa ter valor maior que zero.")
        total += valor
        criterios = bloco.get("criterios") or []
        if not criterios:
            erros.append(f"O bloco '{nome}' precisa ter ao menos um critério.")
        soma = Decimal(0)
        for criterio in criterios:
            cid = str(criterio.get("id") or "").strip()
            if not str(criterio.get("texto") or "").strip():
                erros.append(f"Há critério sem texto no bloco '{nome}'.")
            if not cid or cid in ids_criterios:
                erros.append(f"Critério '{criterio.get('texto')}' com identificador ausente ou repetido.")
            ids_criterios.add(cid)
            peso = _dec(criterio.get("peso"))
            if peso <= 0:
                erros.append(f"O critério '{criterio.get('texto')}' precisa ter peso maior que zero.")
            soma += peso
        if criterios and soma != valor:
            erros.append(
                f"Bloco '{nome}': a soma dos pesos dos critérios ({soma}) deve ser igual ao valor do bloco ({valor})."
            )
    if total <= 0:
        erros.append("O total dos blocos precisa ser maior que zero.")
    min_blocos = int(config.get("min_blocos") or MIN_BLOCOS_PADRAO)
    if min_blocos < 1 or min_blocos > len(blocos):
        erros.append("O mínimo de blocos avaliados deve estar entre 1 e a quantidade de blocos.")
    escala = config.get("escala") or {}
    if int(escala.get("min", 1)) >= int(escala.get("max", 10)):
        erros.append("A escala dos pilares precisa ter mínimo menor que o máximo.")
    return erros


# ---------------------------------------------------------------------------
# Cálculo da nota
# ---------------------------------------------------------------------------


def calcular_nota(config: dict[str, Any], respostas: dict[str, Any]) -> dict[str, Any]:
    """Calcula a nota de UMA monitoria com base na configuração (snapshot) e nas
    respostas `{criterio_id: SIM|NAO|NCG|NA}`.

    Devolve um dicionário com nota (2 casas), flags e o detalhe por bloco.
    Não levanta exceção para respostas ausentes: critério sem resposta é
    tratado como NAO no cálculo, mas a validação de obrigatoriedade fica em
    `criterios_sem_resposta`."""
    normalizadas = {cid: normalizar_resposta(valor) for cid, valor in (respostas or {}).items()}
    blocos = config.get("blocos") or []
    min_blocos = int(config.get("min_blocos") or MIN_BLOCOS_PADRAO)

    possui_ncg = any(valor == "NCG" for valor in normalizadas.values())

    detalhe: list[dict[str, Any]] = []
    for bloco in blocos:
        criterios = bloco.get("criterios") or []
        respostas_bloco = [normalizadas.get(str(c.get("id")), "") for c in criterios]
        nulo = any(valor == "NA" for valor in respostas_bloco)
        pontos = Decimal(0)
        if not nulo:
            for criterio, valor in zip(criterios, respostas_bloco):
                if valor == "SIM":
                    pontos += _dec(criterio.get("peso"))
        detalhe.append(
            {
                "id": bloco.get("id"),
                "nome": bloco.get("nome"),
                "valor": _dec(bloco.get("valor")),
                "status": "NULO" if nulo else "AVALIADO",
                "pontos_brutos": pontos,
            }
        )

    avaliados = [item for item in detalhe if item["status"] == "AVALIADO"]
    soma_valores = sum((item["valor"] for item in avaliados), Decimal(0))
    fator = (Decimal(100) / soma_valores) if soma_valores > 0 else Decimal(0)

    for item in detalhe:
        if item["status"] == "AVALIADO":
            item["pontos"] = arredondar(item["pontos_brutos"] * fator)
            item["valor_efetivo"] = arredondar(item["valor"] * fator)
        else:
            item["pontos"] = Decimal(0)
            item["valor_efetivo"] = Decimal(0)

    nota_normal = arredondar(sum((item["pontos_brutos"] for item in avaliados), Decimal(0)) * fator)
    anulada = False
    if possui_ncg:
        nota = Decimal("0.00")
    else:
        nota = nota_normal
        anulada = len(avaliados) < min_blocos

    return {
        "nota": nota,
        "possui_ncg": possui_ncg,
        "anulada": anulada,
        "blocos_avaliados": len(avaliados),
        "blocos_nulos": len(detalhe) - len(avaliados),
        "min_blocos": min_blocos,
        "fator": arredondar(fator, 6),
        "blocos": [
            {
                "id": item["id"],
                "nome": item["nome"],
                "valor": float(item["valor"]),
                "status": item["status"],
                "pontos": float(item["pontos"]),
                "valor_efetivo": float(item["valor_efetivo"]),
            }
            for item in detalhe
        ],
    }


def criterios_sem_resposta(config: dict[str, Any], respostas: dict[str, Any]) -> list[str]:
    """IDs de critérios ativos sem resposta válida (validação de obrigatórios)."""
    faltando = []
    for bloco in config.get("blocos") or []:
        for criterio in bloco.get("criterios") or []:
            if normalizar_resposta((respostas or {}).get(str(criterio.get("id")))) not in RESPOSTAS_VALIDAS:
                faltando.append(str(criterio.get("id")))
    return faltando


def faixa_da_nota(nota: Any, faixas: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Faixa (rótulo/cor/ação) de uma nota. `faixas` vem do snapshot da monitoria
    (o rótulo exibido numa monitoria antiga é sempre o da época)."""
    valor = float(_dec(nota))
    candidatas = faixas or FAIXAS_PADRAO
    for faixa in sorted(candidatas, key=lambda item: float(item.get("min", 0)), reverse=True):
        if valor >= float(faixa.get("min", 0)):
            return {
                "label": faixa.get("label", ""),
                "cor": faixa.get("cor", ""),
                "acao": faixa.get("acao", ""),
            }
    menor = min(candidatas, key=lambda item: float(item.get("min", 0)))
    return {"label": menor.get("label", ""), "cor": menor.get("cor", ""), "acao": menor.get("acao", "")}


def validar_pilares(config: dict[str, Any], pilares: dict[str, Any]) -> tuple[dict[str, dict[str, int]], list[str]]:
    """Valida notas de pilares (dentro da escala) e devolve
    `({'conhecimento': {indicador: nota}, 'encantamento': {...}}, erros)`."""
    escala = config.get("escala") or {}
    minimo, maximo = int(escala.get("min", 1)), int(escala.get("max", 10))
    resultado: dict[str, dict[str, int]] = {"conhecimento": {}, "encantamento": {}}
    erros: list[str] = []
    for tipo in ("conhecimento", "encantamento"):
        enviados = (pilares or {}).get(tipo) or {}
        for indicador in (config.get("pilares") or {}).get(tipo) or []:
            chave = indicador.get("chave")
            valor = enviados.get(chave)
            try:
                numero = int(valor)
            except (TypeError, ValueError):
                erros.append(f"Informe a nota de '{chave}' (pilar de {tipo}).")
                continue
            if numero < minimo or numero > maximo:
                erros.append(f"A nota de '{chave}' deve estar entre {minimo} e {maximo}.")
                continue
            resultado[tipo][chave] = numero
    return resultado, erros


def media_pilar(notas: dict[str, int]) -> float | None:
    if not notas:
        return None
    return float(arredondar(sum(notas.values()) / len(notas)))


# ---------------------------------------------------------------------------
# Normalização da configuração vinda do editor de matriz
# ---------------------------------------------------------------------------


def _num(valor: Any) -> float | int:
    numero = _dec(valor)
    return int(numero) if numero == numero.to_integral_value() else float(numero)


def normalizar_config(bruto: dict[str, Any]) -> dict[str, Any]:
    """Limpa e completa a configuração recebida do editor: textos aparados,
    números coerentes e identificadores estáveis atribuídos a blocos/critérios
    novos. Não valida regras de negócio (ver `validar_config`)."""
    padrao = config_padrao()
    usados_blocos: set[str] = set()
    usados_criterios: set[str] = set()
    blocos: list[dict[str, Any]] = []
    for indice, bloco in enumerate(bruto.get("blocos") or [], start=1):
        bid = str(bloco.get("id") or "").strip()
        if not bid or bid in usados_blocos:
            n = indice
            while f"b{n}" in usados_blocos:
                n += 1
            bid = f"b{n}"
        usados_blocos.add(bid)
        criterios = []
        for pos, criterio in enumerate(bloco.get("criterios") or [], start=1):
            cid = str(criterio.get("id") or "").strip()
            if not cid or cid in usados_criterios:
                n = pos
                while f"{bid}c{n}" in usados_criterios:
                    n += 1
                cid = f"{bid}c{n}"
            usados_criterios.add(cid)
            criterios.append(
                {"id": cid, "texto": str(criterio.get("texto") or "").strip(), "peso": _num(criterio.get("peso"))}
            )
        blocos.append({"id": bid, "nome": str(bloco.get("nome") or "").strip(), "valor": _num(bloco.get("valor")), "criterios": criterios})

    pilares_bruto = bruto.get("pilares") or {}
    pilares = {}
    for tipo in ("encantamento", "conhecimento"):
        lista = pilares_bruto.get(tipo) or padrao["pilares"][tipo]
        pilares[tipo] = [
            {"chave": str(item.get("chave") or "").strip(), "desc": str(item.get("desc") or "").strip()}
            for item in lista
            if str(item.get("chave") or "").strip()
        ]
    escala_bruta = bruto.get("escala") or padrao["escala"]
    faixas = [
        {
            "min": float(_dec(item.get("min"))),
            "max": float(_dec(item.get("max"))),
            "label": str(item.get("label") or "").strip(),
            "cor": str(item.get("cor") or "").strip(),
            "acao": str(item.get("acao") or "").strip(),
        }
        for item in (bruto.get("faixas") or padrao["faixas"])
    ]
    return {
        "blocos": blocos,
        "pilares": pilares,
        "escala": {"min": int(escala_bruta.get("min", 1)), "max": int(escala_bruta.get("max", 10))},
        "faixas": faixas,
        "min_blocos": int(bruto.get("min_blocos") or MIN_BLOCOS_PADRAO),
    }
