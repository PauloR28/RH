"""Painel — métricas da amostra v6 (aprovada pelo Paulo em 15/nov/2026), abas por área.

Mixin usado por `PainelRepositoryMixin` (repositories/painel.py): cada `_pn_bloco_<id>` recebe o `ctx` já montado (dados de
Turnos e Plantões e da Monitoria do período, só quando alguma métrica precisa) e devolve o JSON do bloco. Nenhuma fórmula
nova de presença ou nota: tudo sai de `_wfm_rel_agregar` / presenças lançadas e do motor único `monitoria_indicadores`.
Pausas são as PREVISTAS na escala (o Conecta não guarda pausa real).
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status

from ..services import monitoria_indicadores as ind
from ..services import monitoria_workflow as wf
from ..services import painel_regras as regras
from ..services.helpers import normalize_text
from ..services.interviews import normalize_interview_status
from ..services.wfm_historico import FUSO_BRASIL
from .monitoria_schema import SQL_MONITORIA_NAO_EXCLUIDA

LIMITE_LISTA = 300
ROTULO_TROCA_RECUSA = {"RECUSADA": "Recusada pelo colega", "REPROVADA": "Reprovada"}
STATUS_FALTA = ("FALTA", "FALTA_JUSTIFICADA")


def _dm(d: Any) -> str:
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime("%d/%m") if isinstance(d, date) else str(d or "")


def _hm(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _faixas_de_datas(datas: list[date]) -> str:
    """[10,11,12,14] -> '10/11 a 12/11, 14/11'."""
    datas = sorted(set(datas))
    partes, ini, ant = [], None, None
    for d in datas:
        if ini is None:
            ini = ant = d
        elif d - ant == timedelta(days=1):
            ant = d
        else:
            partes.append(_dm(ini) if ini == ant else f"{_dm(ini)} a {_dm(ant)}")
            ini = ant = d
    if ini is not None:
        partes.append(_dm(ini) if ini == ant else f"{_dm(ini)} a {_dm(ant)}")
    return ", ".join(partes)


class PainelMetricasMixin:
    # ------------------------------------------------------------------ apoio
    def _pn_ops(self, ctx: dict) -> dict[int, dict]:
        """Operadores da escala no escopo de quem vê, já filtrados pela equipe escolhida: id -> {nome, equipe}."""
        dado = (ctx.get("wfm") or {}).get("dado") or {}
        ids = self._pn_ops_da_equipe(ctx)
        return {o["id_usuario"]: {"nome": o["nome"], "equipe": o.get("equipe") or ""} for o in dado.get("operadores", []) if ids is None or o["id_usuario"] in ids}

    def _pn_serie_presenca(self, dado: dict, ids: set[int] | None, ini: date, fim: date) -> list[dict]:
        """Presença de cada dia = presentes ÷ dias com presença apurada (mesma regra do relatório Resumo)."""
        apurados: Counter = Counter()
        presentes: Counter = Counter()
        for d in dado["dias_escala"]:
            if not d["trabalha"] or (ids is not None and d["id_operador"] not in ids):
                continue
            st = self._wfm_rel_status(dado, d["id_operador"], d["data"])
            if st in ("PRESENTE", "FALTA", "FALTA_JUSTIFICADA", "ATESTADO"):
                apurados[d["data"]] += 1
                if st == "PRESENTE":
                    presentes[d["data"]] += 1
        saida = []
        for n in range((fim - ini).days + 1):
            dia = ini + timedelta(days=n)
            saida.append({"data": dia.isoformat(), "pct": regras.pct(presentes[dia], apurados[dia])})
        return saida

    # ------------------------------------------------------------------ Turnos e Plantões
    def _pn_bloco_presenca_dia(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not dado:
            return self._pn_sem_dado(ctx)
        ids = self._pn_ops_da_equipe(ctx)
        fim = min(ctx["fim"], ctx["hoje"])
        base = None
        anterior = (ctx.get("wfm_anterior") or {}).get("dado")
        if anterior:
            a_ini, a_fim = regras.periodo_anterior(ctx["ini"], ctx["fim"])
            base = {"como": "anterior", "ini": a_ini.isoformat(), "fim": a_fim.isoformat(),
                    "dias": self._pn_serie_presenca(anterior, ids, a_ini, a_ini + (fim - ctx["ini"]))}
        return {"dias": self._pn_serie_presenca(dado, ids, ctx["ini"], fim), "comparacao": base}

    def painel_serie_comparada(self, user, id_painel: int, periodo: str, equipe: str, como: str) -> dict:
        """Linha de comparação da "Presença dia a dia" (mini filtro do cartão): carrega só o período pedido."""
        periodo = periodo if periodo in regras.PERIODOS else "mes"
        como = como if como in regras.COMPARACOES else "anterior"
        hoje = datetime.now(FUSO_BRASIL).date()
        ini, fim = regras.intervalo_do_periodo(periodo, hoje)
        alvo = regras.periodo_comparado(ini, min(fim, hoje), como)
        if alvo is None:
            return {"como": como, "dias": []}
        conn, cursor = self._pn_abrir()
        try:
            painel = self._pn_exigir_painel(cursor, user, id_painel)
            if not any(m["metrica"] == "presenca_dia" for m in self._pn_metricas_liberadas(user, painel)):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Este painel não mostra a presença dia a dia para o seu perfil.")
            fonte = self._pn_wfm(cursor, user, painel["operacao"], alvo[0], alvo[1])
            if not fonte.get("dado"):
                return {"como": como, "dias": [], "indisponivel": fonte.get("motivo")}
            ctx = {"wfm": fonte, "equipe": normalize_text(equipe)}
            return {"como": como, "ini": alvo[0].isoformat(), "fim": alvo[1].isoformat(),
                    "dias": self._pn_serie_presenca(fonte["dado"], self._pn_ops_da_equipe(ctx), alvo[0], alvo[1])}
        finally:
            conn.close()

    def _pn_bloco_faltas_semana(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not dado:
            return self._pn_sem_dado(ctx)
        ops = self._pn_ops(ctx)
        contagem = [0] * 7
        lista = []
        for (id_op, dia), p in sorted(dado["presencas"].items(), key=lambda x: x[0][1]):
            if id_op not in ops or p["status"] not in STATUS_FALTA:
                continue
            ds = regras.dia_da_semana_domingo(dia)
            contagem[ds] += 1
            lista.append({"dia_semana": ds, "operador": ops[id_op]["nome"], "equipe": ops[id_op]["equipe"], "data": _dm(dia),
                          "justificada": p["status"] == "FALTA_JUSTIFICADA"})
        return {"contagem": contagem, "faltas": lista[:LIMITE_LISTA * 3]}

    def _pn_bloco_atestados(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not dado:
            return self._pn_sem_dado(ctx)
        ops = self._pn_ops(ctx)
        por_op: dict[int, list[date]] = {}
        for (id_op, dia), p in dado["presencas"].items():
            if id_op in ops and p["status"] == "ATESTADO":
                por_op.setdefault(id_op, []).append(dia)
        total = sum(len(v) for v in por_op.values())
        lista = sorted(({"operador": ops[i]["nome"], "equipe": ops[i]["equipe"], "dias": len(v), "periodo": _faixas_de_datas(v)} for i, v in por_op.items()),
                       key=lambda x: (-x["dias"], x["operador"]))
        return {"dias": total, "pessoas": len(por_op), "media": round(total / len(por_op), 1) if por_op else None, "lista": lista[:LIMITE_LISTA]}

    def _pn_bloco_trocas_pessoa(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not dado:
            return self._pn_sem_dado(ctx)
        ops = self._pn_ops(ctx)
        trocas = [t for t in dado["trocas"] if t["id_solicitante"] in ops]
        pedidos = Counter(t["solicitante"] for t in trocas)
        recusadas = [{"quem": t["solicitante"], "com_quem": t["alvo"], "dias": f"{_dm(t['data_a'])} ⇄ {_dm(t['data_b'])}", "situacao": ROTULO_TROCA_RECUSA[t["estado"]]}
                     for t in trocas if t["estado"] in ROTULO_TROCA_RECUSA]
        return {"mais_pedem": [{"nome": n, "pedidos": q} for n, q in sorted(pedidos.items(), key=lambda x: (-x[1], x[0]))[:5]], "recusadas": recusadas[:LIMITE_LISTA]}

    def _pn_bloco_presenca_do_dia(self, cursor, user, ctx: dict) -> dict:
        fim = min(ctx["fim"], ctx["hoje"])
        dias = [fim - timedelta(days=n) for n in range(min((fim - ctx["ini"]).days + 1, 62))] if fim >= ctx["ini"] else []
        if not dias:
            return {"indisponivel": "O período escolhido ainda não começou."}
        return {"dias": [d.isoformat() for d in dias], **self._pn_dia(cursor, user, ctx["painel"], dias[0], ctx["equipe"])}

    def painel_dia(self, user, id_painel: int, data: str, equipe: str = "") -> dict:
        """Presença do dia (cartão de Turnos e Plantões): troca de dia sem recarregar o painel inteiro."""
        try:
            dia = date.fromisoformat(str(data or "")[:10])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data inválida (use AAAA-MM-DD).") from exc
        conn, cursor = self._pn_abrir()
        try:
            painel = self._pn_exigir_painel(cursor, user, id_painel)
            if not any(m["metrica"] == "presenca_do_dia" for m in self._pn_metricas_liberadas(user, painel)):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Este painel não mostra a presença do dia para o seu perfil.")
            return self._pn_dia(cursor, user, painel, dia, normalize_text(equipe))
        finally:
            conn.close()

    def _pn_dia(self, cursor, user, painel: dict, dia: date, equipe: str) -> dict:
        fonte = self._pn_wfm(cursor, user, painel["operacao"], dia, dia)
        dado = fonte.get("dado")
        if not dado:
            return {"indisponivel": fonte.get("motivo") or "Esta unidade não tem escala em Turnos e Plantões."}
        ctx = {"wfm": fonte, "equipe": equipe}
        ops = self._pn_ops(ctx)
        operacao = painel["operacao"]
        escalados = [d for d in dado["dias_escala"] if d["trabalha"] and d["data"] == dia and d["id_operador"] in ops]
        entrada: dict[int, str] = {}
        if escalados:
            ids = [d["id_operador"] for d in escalados]
            marc = ",".join("?" for _ in ids)
            cursor.execute(
                f"SELECT id_usuario, MIN(criado_em) FROM dbo.wfm_auditoria WHERE acao = 'presenca_automatica' AND operacao = ? "
                f"AND criado_em >= ? AND criado_em < ? AND id_usuario IN ({marc}) GROUP BY id_usuario",
                (operacao, dia, dia + timedelta(days=1), *ids),
            )
            entrada = {int(r[0]): r[1].strftime("%H:%M") for r in cursor.fetchall() if r[1]}
        pausas = self._wfm_pausas_programadas(cursor, operacao, dia)
        grupos: dict[str, list[dict]] = {"presentes": [], "faltaram": [], "atestado": [], "sem_lancamento": []}
        for d in sorted(escalados, key=lambda x: ops[x["id_operador"]]["nome"]):
            i = d["id_operador"]
            st = self._wfm_rel_status(dado, i, dia)
            base = {"operador": ops[i]["nome"], "equipe": ops[i]["equipe"]}
            if st == "PRESENTE":
                grupos["presentes"].append({**base, "entrada": entrada.get(i), "pausas": [p["inicio"] for p in pausas.get(i, [])]})
            elif st in STATUS_FALTA:
                grupos["faltaram"].append({**base, "justificada": st == "FALTA_JUSTIFICADA"})
            elif st == "ATESTADO":
                grupos["atestado"].append(base)
            elif st == "SEM_LANCAMENTO":
                grupos["sem_lancamento"].append({**base, "turno": d.get("codigo") or "", "entrada_prevista": d.get("entrada")})
        return {"data": dia.isoformat(), "escalados": len(escalados), **{k: v[:LIMITE_LISTA] for k, v in grupos.items()},
                "contagem": {k: len(v) for k, v in grupos.items()}}

    def _pn_bloco_pausas_mapa(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not dado:
            return self._pn_sem_dado(ctx)
        ops = self._pn_ops(ctx)
        operacao = ctx["painel"]["operacao"]
        fim = min(ctx["fim"], ctx["hoje"]) if ctx["ini"] <= ctx["hoje"] else ctx["fim"]
        cursor.execute(
            "SELECT id_operador, data, tipo, inicio, duracao_min FROM dbo.wfm_pausas WHERE operacao = ? AND data BETWEEN ? AND ? ORDER BY data, inicio",
            (operacao, ctx["ini"], fim),
        )
        contagem: Counter = Counter()
        pessoas: dict[int, list[dict]] = {}
        dias: set = set()
        for id_op, dia, tipo, inicio, duracao in cursor.fetchall():
            id_op = int(id_op)
            if id_op not in ops:
                continue
            dias.add(dia)
            ini_txt = normalize_text(inicio)[:5]
            try:
                h, m = (int(x) for x in ini_txt.split(":"))
            except ValueError:
                continue
            a = h * 60 + m
            for s in regras.slots_da_pausa(ini_txt, int(duracao or 0)):
                contagem[s] += 1
                lista = pessoas.setdefault(s, [])
                if len(lista) < 100:
                    lista.append({"operador": ops[id_op]["nome"], "equipe": ops[id_op]["equipe"], "data": _dm(dia),
                                  "horario": f"{_hm(a)} às {_hm(min(a + int(duracao or 0), 24 * 60))}", "tipo": normalize_text(tipo)})
        n_dias = max(len(dias), 1)
        ocupados = sorted(contagem)
        primeiro = min([12] + ocupados[:1])
        ultimo = max([47] + ocupados[-1:])
        return {
            "capacidade": self._wfm_capacidade(cursor, operacao), "dias": len(dias), "media_por_dia": len(dias) > 1,
            "slots": [{"slot": s, "inicio": _hm(s * 30), "fim": _hm(s * 30 + 30), "valor": round(contagem[s] / n_dias, 1), "pessoas": pessoas.get(s, [])}
                      for s in range(primeiro, ultimo + 1)],
        }

    # ------------------------------------------------------------------ Monitoria
    def _pn_linhas_mon(self, ctx: dict) -> list[dict]:
        linhas = ctx.get("monitorias") or []
        ids = self._pn_ops_da_equipe(ctx)
        return linhas if ids is None else [l for l in linhas if int(l["id_operador"]) in ids]

    def _pn_bloco_nota_semana(self, cursor, user, ctx: dict) -> dict:
        return {"semanas": ind.evolucao(self._pn_linhas_mon(ctx), "semana"), "meta": regras.META_NOTA_PADRAO}

    def _pn_bloco_itens_erro(self, cursor, user, ctx: dict) -> dict:
        return {"itens": [{"item": i["pergunta"], "bloco": i["bloco"], "pct": i["pct_erro"], "avaliados": i["avaliados"]}
                          for i in ind.criterios_com_maior_erro(self._pn_linhas_mon(ctx), 5)]}

    def _pn_bloco_distribuicao_notas(self, cursor, user, ctx: dict) -> dict:
        faixas = self._mon_faixas(ctx["painel"]["operacao"])
        dist = {d["label"]: d["quantidade"] for d in ind.distribuicao_por_faixa(self._pn_linhas_mon(ctx), faixas)}
        total = sum(dist.values())
        return {"total": total, "faixas": [
            {"faixa": f["label"], "min": f.get("min"), "max": f.get("max"), "quantidade": dist.get(f["label"], 0),
             "pct": regras.pct(dist.get(f["label"], 0), total), "atencao": float(f.get("min") or 0) < regras.META_NOTA_PADRAO}
            for f in faixas]}

    def _pn_bloco_sem_monitoria(self, cursor, user, ctx: dict) -> dict:
        ops = self._pn_ops(ctx)
        if not ops:
            return self._pn_sem_dado(ctx)
        com = {int(l["id_operador"]) for l in self._pn_linhas_mon(ctx)}
        sem = [i for i in ops if i not in com]
        ultima: dict[int, Any] = {}
        if sem:
            marc = ",".join("?" for _ in sem)
            cursor.execute(
                f"SELECT m.id_operador, MAX(m.data_monitoria) FROM dbo.monitorias m WHERE m.operacao = ? AND m.id_operador IN ({marc}) "
                f"AND {SQL_MONITORIA_NAO_EXCLUIDA} GROUP BY m.id_operador",
                (ctx["painel"]["operacao"], *sem),
            )
            ultima = {int(r[0]): r[1] for r in cursor.fetchall()}
        lista = sorted(({"operador": ops[i]["nome"], "equipe": ops[i]["equipe"], "ultima": _dm(ultima[i]) if ultima.get(i) else "Nunca"} for i in sem),
                       key=lambda x: x["operador"])
        return {"total": len(ops), "sem": len(sem), "cobertura_pct": regras.pct(len(ops) - len(sem), len(ops)), "lista": lista[:LIMITE_LISTA]}

    def _pn_bloco_tempo_feedback(self, cursor, user, ctx: dict) -> dict:
        linhas = {int(l["id_monitoria"]): l for l in self._pn_linhas_mon(ctx) if l["feedback_aplicado"]}
        horas, no_prazo, com_prazo, itens = [], 0, 0, []
        if linhas:
            ids = list(linhas)
            for i in range(0, len(ids), 900):
                parte = ids[i:i + 900]
                cursor.execute(
                    f"SELECT id_monitoria, MIN(data_aplicacao), MAX(CAST(dentro_sla AS INT)) FROM dbo.monitoria_feedbacks "
                    f"WHERE id_monitoria IN ({','.join('?' for _ in parte)}) GROUP BY id_monitoria",
                    tuple(parte),
                )
                for id_m, aplicado, dentro in cursor.fetchall():
                    l = linhas[int(id_m)]
                    inicio = l["data"] if isinstance(l["data"], datetime) else datetime.combine(l["data"], datetime.min.time())
                    h = max((aplicado - inicio).total_seconds() / 3600, 0)
                    horas.append(h)
                    if dentro is not None:
                        com_prazo += 1
                        no_prazo += int(dentro)
                    itens.append({"operador": l["operador_nome"], "monitoria": _dm(l["data"]), "monitor": l["avaliador_nome"], "horas": round(h, 1)})
        itens.sort(key=lambda x: -x["horas"])
        return {"media_horas": round(sum(horas) / len(horas), 1) if horas else None, "no_prazo_pct": regras.pct(no_prazo, com_prazo),
                "fora_prazo": com_prazo - no_prazo, "prazo_horas": wf.HORAS_SLA_OFICIAIS[wf.SLA_FEEDBACK], "mais_demorados": itens[:20]}

    # ------------------------------------------------------------------ Equipes
    def _pn_por_equipe(self, ctx: dict) -> list[dict]:
        por_op = self._pn_agregado(ctx) or {}
        notas: dict[int, list[float]] = {}
        qtd: Counter = Counter()
        abaixo: Counter = Counter()
        pendentes: Counter = Counter()
        for l in self._pn_linhas_mon(ctx):
            i = int(l["id_operador"])
            qtd[i] += 1
            if l["status"] == wf.FEEDBACK_PENDENTE:
                pendentes[i] += 1
            if ind.eh_valida(l):
                notas.setdefault(i, []).append(float(l["nota"]))
                if float(l["nota"]) < regras.META_NOTA_PADRAO:
                    abaixo[i] += 1
        grupos: dict[str, dict] = {}
        for i, v in por_op.items():
            g = grupos.setdefault(v["equipe"] or "Sem equipe", {"equipe": v["equipe"] or "Sem equipe", "operadores": 0, "presentes": 0, "apurados": 0, "faltas": 0,
                                                                  "atestados": 0, "sem_lancamento": 0, "trocas": 0, "notas": [], "monitorias": 0, "abaixo_meta": 0,
                                                                  "feedbacks_pendentes": 0})
            g["operadores"] += 1
            g["presentes"] += v["presentes"]
            g["apurados"] += v["presentes"] + v["faltas"] + v["justificadas"] + v["atestados"]
            g["faltas"] += v["faltas"] + v["justificadas"]
            g["atestados"] += v["atestados"]
            g["sem_lancamento"] += v["sem_lancamento"]
            g["trocas"] += v["trocas"]
            g["notas"] += notas.get(i, [])
            g["monitorias"] += qtd[i]
            g["abaixo_meta"] += abaixo[i]
            g["feedbacks_pendentes"] += pendentes[i]
        saida = []
        for g in grupos.values():
            saida.append({"equipe": g["equipe"], "operadores": g["operadores"], "presenca_pct": regras.pct(g["presentes"], g["apurados"]), "faltas": g["faltas"],
                          "atestados": g["atestados"], "sem_lancamento": g["sem_lancamento"], "nota_media": round(sum(g["notas"]) / len(g["notas"]), 1) if g["notas"] else None,
                          "monitorias": g["monitorias"], "abaixo_meta": g["abaixo_meta"], "feedbacks_pendentes": g["feedbacks_pendentes"], "trocas": g["trocas"],
                          "_presentes": g["presentes"], "_apurados": g["apurados"], "_notas": g["notas"]})
        return saida

    def _pn_bloco_ranking_equipes(self, cursor, user, ctx: dict) -> dict:
        if not (ctx.get("wfm") or {}).get("dado"):
            return self._pn_sem_dado(ctx)
        itens = [{k: v for k, v in g.items() if not k.startswith("_")} for g in self._pn_por_equipe(ctx)]
        mostra_nota = regras.tem_base(regras.METRICAS["monitorias"], set(user.permissions))
        if not mostra_nota:
            for i in itens:
                i["nota_media"] = None
        return {"equipes": regras.ranking_por_posicoes(itens), "mostra_nota": mostra_nota}

    def _pn_bloco_comparar_equipes(self, cursor, user, ctx: dict) -> dict:
        if not (ctx.get("wfm") or {}).get("dado"):
            return self._pn_sem_dado(ctx)
        grupos = self._pn_por_equipe(ctx)
        mostra_nota = regras.tem_base(regras.METRICAS["monitorias"], set(user.permissions))
        n = max(len(grupos), 1)
        notas = [x for g in grupos for x in g["_notas"]]
        contagens = ("operadores", "faltas", "atestados", "sem_lancamento", "monitorias", "abaixo_meta", "feedbacks_pendentes", "trocas")
        media = {k: round(sum(g[k] for g in grupos) / n, 1) for k in contagens}
        media["presenca_pct"] = regras.pct(sum(g["_presentes"] for g in grupos), sum(g["_apurados"] for g in grupos))
        media["nota_media"] = round(sum(notas) / len(notas), 1) if notas else None
        equipes = [{k: v for k, v in g.items() if not k.startswith("_")} for g in sorted(grupos, key=lambda x: x["equipe"])]
        if not mostra_nota:
            for e in [*equipes, media]:
                for k in ("nota_media", "monitorias", "abaixo_meta", "feedbacks_pendentes"):
                    e[k] = None
        return {"equipes": equipes, "media": media, "mostra_nota": mostra_nota}

    # ------------------------------------------------------------------ Diário de Bordo
    def _pn_bloco_interc_tipo(self, cursor, user, ctx: dict) -> dict:
        cursor.execute("SELECT OBJECT_ID('dbo.diario_intercorrencia', 'U')")
        if cursor.fetchone()[0] is None:
            return {"indisponivel": "O Diário de bordo ainda não foi usado nesta unidade."}
        cursor.execute(
            "SELECT ferramenta, COUNT(1) FROM dbo.diario_intercorrencia WHERE operacao = ? AND excluida = 0 AND CAST(inicio AS DATE) BETWEEN ? AND ? "
            "GROUP BY ferramenta ORDER BY COUNT(1) DESC, ferramenta",
            (ctx["painel"]["operacao"], ctx["ini"], min(ctx["fim"], ctx["hoje"])),
        )
        return {"tipos": [{"tipo": normalize_text(t) or "Sem tipo", "quantidade": int(q)} for t, q in cursor.fetchall()]}

    # ------------------------------------------------------------------ RH
    def _pn_bloco_rh_entrevistas(self, cursor, user, ctx: dict) -> dict:
        ini, fim = ctx["ini"], ctx["fim"]
        cursor.execute("SELECT OBJECT_ID('dbo.entrevistas_agendadas', 'U')")
        if cursor.fetchone()[0] is None:
            return {"indisponivel": "Ainda não há entrevistas no Conecta."}
        cursor.execute(
            "SELECT nome_candidato, vaga, data_entrevista, status_entrevista FROM dbo.entrevistas_agendadas "
            "WHERE data_entrevista >= ? AND data_entrevista < ? ORDER BY data_entrevista",
            (ini, fim + timedelta(days=1)),
        )
        cont: Counter = Counter()
        semanas: dict[str, Counter] = {}
        faltaram = []
        for nome, vaga, quando, st in cursor.fetchall():
            grupo = {"Compareceu": "compareceram", "Faltou": "faltaram", "Cancelado": "canceladas"}.get(normalize_interview_status(st), "marcadas")
            cont[grupo] += 1
            cont["total"] += 1
            semana = (quando.date() - timedelta(days=quando.weekday())).isoformat()
            semanas.setdefault(semana, Counter())["marcadas"] += 1
            if grupo == "compareceram":
                semanas[semana]["compareceram"] += 1
            if grupo == "faltaram":
                faltaram.append({"candidato": normalize_text(nome), "vaga": normalize_text(vaga), "quando": quando.strftime("%d/%m %H:%M")})
        return {"total": cont["total"], "compareceram": cont["compareceram"], "faltaram": cont["faltaram"], "canceladas": cont["canceladas"],
                "a_acontecer": cont["marcadas"], "lista_faltaram": faltaram[:LIMITE_LISTA],
                "semanas": [{"semana": s, "marcadas": c["marcadas"], "compareceram": c["compareceram"]} for s, c in sorted(semanas.items())]}

    def _pn_bloco_rh_tempo_admissao(self, cursor, user, ctx: dict) -> dict:
        """Do início da admissão (onboarding aberto no Conecta) até a data marcada para o 1º dia. Só candidatos (não colaboradores)."""
        cursor.execute("SELECT OBJECT_ID('dbo.onboarding_candidatos', 'U')")
        if cursor.fetchone()[0] is None:
            return {"indisponivel": "Ainda não há admissões no Conecta."}
        cursor.execute(
            "SELECT COALESCE(cp.nome_candidato, N''), oc.iniciado_em, oc.data_prevista FROM dbo.onboarding_candidatos oc "
            "LEFT JOIN dbo.candidatos_processos cp ON cp.id_registro = oc.id_registro "
            "WHERE oc.id_usuario IS NULL AND oc.iniciado_em IS NOT NULL AND oc.data_prevista >= ? AND oc.data_prevista < ? ORDER BY oc.data_prevista",
            (ctx["ini"], ctx["fim"] + timedelta(days=1)),
        )
        itens = []
        for nome, inicio, primeiro in cursor.fetchall():
            dias = max((primeiro.date() - inicio.date()).days, 0)
            itens.append({"pessoa": normalize_text(nome) or "—", "inicio": _dm(inicio), "primeiro_dia": _dm(primeiro), "dias": dias})
        if not itens:
            return {"media_dias": None, "mais_rapida": None, "mais_demorada": None, "lista": []}
        ordem = sorted(itens, key=lambda x: x["dias"])
        return {"media_dias": round(sum(i["dias"] for i in itens) / len(itens), 1), "mais_rapida": ordem[0], "mais_demorada": ordem[-1],
                "lista": sorted(itens, key=lambda x: -x["dias"])[:LIMITE_LISTA]}
