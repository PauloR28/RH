"""Motor ÚNICO de indicadores da Monitoria (promt.txt §5.15).

Dashboard, relatórios, ranking, gráficos e exportações XLSX/CSV usam estas
mesmas funções — nunca existem duas fórmulas. Funções puras sobre linhas
(dicionários) já filtradas por permissão/escopo pelo repositório.

Regras:
  * Nota média = soma das notas VÁLIDAS ÷ quantidade de monitorias VÁLIDAS.
  * Realizadas = todas (inclui NCG e Anuladas); Válidas = exclui Anuladas.
  * Monitoria com NCG conta como válida com nota 0.
  * Evolução, ranking, pilares e critérios com erro usam só monitorias válidas.
  * Critérios com maior erro: só entre critérios efetivamente avaliados
    (SIM/NÃO/NCG); N/A não é erro e sai do denominador; NÃO ≠ NCG.
  * Top N: desempate por mais monitorias válidas e depois nome.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from . import monitoria_workflow as wf
from .monitoria_engine import faixa_da_nota

TOPS_PERMITIDOS = (3, 5, 10, 15)
GRANULARIDADES = ("dia", "semana", "mes")


def eh_valida(linha: dict[str, Any]) -> bool:
    return not (bool(linha.get("anulada")) or linha.get("resultado") == wf.RESULTADO_ANULADA)


def _media(valores: list[float]) -> float | None:
    return round(sum(valores) / len(valores), 2) if valores else None


def _como_data(valor: Any) -> date:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    return date.fromisoformat(str(valor)[:10])


def chave_periodo(valor: Any, granularidade: str) -> str:
    d = _como_data(valor)
    if granularidade == "dia":
        return d.isoformat()
    if granularidade == "semana":
        segunda = d - timedelta(days=d.weekday())
        return segunda.isoformat()
    return f"{d.year:04d}-{d.month:02d}"


def evolucao(linhas: Iterable[dict], granularidade: str = "mes") -> list[dict]:
    grupos: dict[str, list[float]] = defaultdict(list)
    for linha in linhas:
        if eh_valida(linha):
            grupos[chave_periodo(linha["data"], granularidade)].append(float(linha["nota"]))
    return [{"periodo": chave, "nota_media": _media(v), "quantidade": len(v)} for chave, v in sorted(grupos.items())]


def top_n(linhas: Iterable[dict], n: int = 5) -> list[dict]:
    """Top N por nota média (só válidas). Desempate: mais monitorias válidas, depois nome."""
    n = n if n in TOPS_PERMITIDOS else 5
    por_operador: dict[int, dict[str, Any]] = {}
    for linha in linhas:
        if not eh_valida(linha):
            continue
        item = por_operador.setdefault(
            int(linha["id_operador"]),
            {"id_operador": int(linha["id_operador"]), "operador_nome": linha["operador_nome"], "operacao": linha.get("operacao"), "notas": []},
        )
        item["notas"].append(float(linha["nota"]))
    ranking = [
        {"id_operador": i["id_operador"], "operador_nome": i["operador_nome"], "operacao": i["operacao"],
         "nota_media": _media(i["notas"]), "quantidade_validas": len(i["notas"])}
        for i in por_operador.values()
    ]
    ranking.sort(key=lambda r: (-r["nota_media"], -r["quantidade_validas"], str(r["operador_nome"]).lower()))
    for posicao, item in enumerate(ranking[:n], start=1):
        item["posicao"] = posicao
    return ranking[:n]


def criterios_com_maior_erro(linhas: Iterable[dict], limite: int = 10) -> list[dict]:
    contagem: dict[str, dict[str, Any]] = {}
    for linha in linhas:
        if not eh_valida(linha):
            continue
        for r in linha.get("respostas") or []:
            resposta = r["resposta"]
            if resposta == "NA":
                continue  # não avaliado: fora do numerador e do denominador
            item = contagem.setdefault(
                r["id_criterio"], {"id_criterio": r["id_criterio"], "pergunta": r["pergunta"], "bloco": r["bloco_nome"], "avaliados": 0, "nao": 0, "ncg": 0}
            )
            item["avaliados"] += 1
            if resposta == "NAO":
                item["nao"] += 1
            elif resposta == "NCG":
                item["ncg"] += 1
    resultado = []
    for item in contagem.values():
        item["pct_erro"] = round(item["nao"] / item["avaliados"] * 100, 2) if item["avaliados"] else 0.0
        item["pct_ncg"] = round(item["ncg"] / item["avaliados"] * 100, 2) if item["avaliados"] else 0.0
        resultado.append(item)
    resultado.sort(key=lambda i: (-i["pct_erro"], -i["nao"], i["pergunta"]))
    return [i for i in resultado if i["nao"] > 0][:limite]


def desempenho_por_bloco(linhas: Iterable[dict]) -> list[dict]:
    """% médio de acerto por bloco (só monitorias válidas e blocos avaliados)."""
    blocos: dict[str, dict[str, Any]] = {}
    for linha in linhas:
        if not eh_valida(linha):
            continue
        por_bloco: dict[str, dict[str, Any]] = {}
        for r in linha.get("respostas") or []:
            if r["bloco_status"] != "AVALIADO":
                continue
            b = por_bloco.setdefault(r["id_bloco"], {"nome": r["bloco_nome"], "peso": 0.0, "ganho": 0.0})
            b["peso"] += float(r["peso"])
            if r["resposta"] == "SIM":
                b["ganho"] += float(r["peso"])
        for bid, b in por_bloco.items():
            if b["peso"] <= 0:
                continue
            acumulado = blocos.setdefault(bid, {"id_bloco": bid, "bloco": b["nome"], "percentuais": []})
            acumulado["percentuais"].append(0.0 if linha.get("possui_ncg") else b["ganho"] / b["peso"] * 100)
    return [
        {"id_bloco": v["id_bloco"], "bloco": v["bloco"], "percentual_medio": _media(v["percentuais"]), "quantidade": len(v["percentuais"])}
        for v in blocos.values()
    ]


def pilares(linhas: Iterable[dict]) -> dict[str, Any]:
    """Médias por pilar e por indicador (independentes da nota de 0–100)."""
    acumulado: dict[str, dict[str, list[float]]] = {"conhecimento": defaultdict(list), "encantamento": defaultdict(list)}
    for linha in linhas:
        if not eh_valida(linha):
            continue
        for tipo in ("conhecimento", "encantamento"):
            for indicador, nota in ((linha.get("pilares") or {}).get(tipo) or {}).items():
                acumulado[tipo][indicador].append(float(nota))
    saida: dict[str, Any] = {}
    for tipo, indicadores in acumulado.items():
        medias = {nome: _media(v) for nome, v in indicadores.items()}
        todas = [x for v in indicadores.values() for x in v]
        saida[tipo] = {"media": _media(todas), "indicadores": medias}
    return saida


def pendencias(linhas: Iterable[dict], agora: datetime | None = None) -> dict[str, int]:
    agora = agora or datetime.now()
    contagem = {
        "feedbacks_pendentes": 0, "feedbacks_aplicados": 0, "confirmacoes_e_contestacoes_pendentes": 0,
        "baixas_ou_confirmacoes_pendentes": 0, "feedbacks_vencidos": 0,
    }
    for linha in linhas:
        status = linha.get("status")
        if status == wf.FEEDBACK_PENDENTE:
            contagem["feedbacks_pendentes"] += 1
            if linha.get("sla_limite") and agora > linha["sla_limite"]:
                contagem["feedbacks_vencidos"] += 1
        elif status == wf.AGUARDANDO_CONFIRMACAO:
            contagem["confirmacoes_e_contestacoes_pendentes"] += 1
        elif status == wf.REANALISE:
            contagem["baixas_ou_confirmacoes_pendentes"] += 1
        if linha.get("feedback_aplicado"):
            contagem["feedbacks_aplicados"] += 1
    return contagem


def distribuicao_por_faixa(linhas: Iterable[dict], faixas: list[dict] | None = None) -> list[dict]:
    """Quantidade por faixa. Usa o rótulo GUARDADO na monitoria (`nivel`, o da época);
    só recalcula quando a linha não o traz."""
    cores = {f.get("label"): f.get("cor", "") for f in (faixas or [])}
    contagem: dict[str, dict[str, Any]] = {}
    for linha in linhas:
        if not eh_valida(linha):
            continue
        rotulo = linha.get("nivel")
        cor = cores.get(rotulo, "")
        if not rotulo:
            faixa = faixa_da_nota(linha["nota"], faixas)
            rotulo, cor = faixa["label"], faixa["cor"]
        item = contagem.setdefault(rotulo, {"label": rotulo, "cor": cor, "quantidade": 0})
        item["quantidade"] += 1
    return sorted(contagem.values(), key=lambda i: -i["quantidade"])


def resumo(linhas: list[dict], *, faixas: list[dict] | None = None, agora: datetime | None = None) -> dict[str, Any]:
    """KPIs + indicadores de um conjunto de linhas."""
    validas = [l for l in linhas if eh_valida(l)]
    notas = [float(l["nota"]) for l in validas]
    nota_media = _media(notas)
    return {
        "quantidade_realizadas": len(linhas),
        "quantidade_validas": len(validas),
        "quantidade_anuladas": len(linhas) - len(validas),
        "nota_media": nota_media,
        "faixa": faixa_da_nota(nota_media, faixas) if nota_media is not None else None,
        "melhor_nota": max(notas) if notas else None,
        "operadores_avaliados": len({int(l["id_operador"]) for l in validas}),
        "ncg": sum(1 for l in linhas if l.get("possui_ncg")),
        "monitorias_ncg_pct": round(sum(1 for l in linhas if l.get("possui_ncg")) / len(linhas) * 100, 2) if linhas else 0.0,
        "pilares": pilares(linhas),
        "pendencias": pendencias(linhas, agora),
        "distribuicao_faixas": distribuicao_por_faixa(linhas, faixas),
    }


def agrupar(linhas: list[dict], dimensao: str, *, faixas: list[dict] | None = None) -> list[dict]:
    """Resumo por operação / equipe / operador / avaliador (comparativos)."""
    chave_de = {
        "operacao": lambda l: (l.get("operacao"), l.get("operacao_nome")),
        "equipe": lambda l: (l.get("equipe_nome") or "Sem equipe", l.get("equipe_nome") or "Sem equipe"),
        "operador": lambda l: (l.get("id_operador"), l.get("operador_nome")),
        "avaliador": lambda l: (l.get("avaliador_nome"), l.get("avaliador_nome")),
    }[dimensao]
    grupos: dict[Any, dict[str, Any]] = {}
    for linha in linhas:
        chave, rotulo = chave_de(linha)
        grupos.setdefault(chave, {"chave": chave, "rotulo": rotulo, "linhas": []})["linhas"].append(linha)
    saida = []
    for g in grupos.values():
        r = resumo(g["linhas"], faixas=faixas)
        saida.append({"chave": g["chave"], "rotulo": g["rotulo"], "quantidade_realizadas": r["quantidade_realizadas"],
                      "quantidade_validas": r["quantidade_validas"], "nota_media": r["nota_media"], "ncg": r["ncg"],
                      "pilar_conhecimento": r["pilares"]["conhecimento"]["media"], "pilar_encantamento": r["pilares"]["encantamento"]["media"]})
    saida.sort(key=lambda i: (-(i["nota_media"] if i["nota_media"] is not None else -1), str(i["rotulo"]).lower()))
    return saida
