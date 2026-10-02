"""WFM — Relatórios (Supervisor, Control Desk, Gestor/RH, Analista de TI). Mixin do DatabaseRepository.

Somente leitura. Cinco relatórios sobre um período (até 366 dias) de UMA escala, sempre limitados ao escopo de quem pede
(Supervisor vê só a equipe; Control Desk/Gestor veem a operação):

  resumo      — por operador: dias e horas escalados, presença, faltas, atestados, horas trabalhadas, horas extras, trocas
  escalas     — histórico de versões publicadas por mês (quem publicou, quem aprovou, violação, justificativa)
  presencas   — dia a dia: turno, horário, status lançado, quem lançou, horas
  trocas      — pedidos de troca com estado final, quem decidiu, quando e a justificativa
  aprovacoes  — envios, aprovações, declínios (com justificativa) e publicações da escala

Fonte da escala: a ÚLTIMA VERSÃO PUBLICADA de cada mês (o que valeu de fato), com feriado/dia/horário especial e horário
combinado aplicados. Meses sem publicação não entram nas horas. Horas trabalhadas = horas líquidas dos dias com presença
lançada como PRESENTE + horas extras lançadas; dias sem lançamento aparecem à parte ("Sem lançamento"), nunca como presença.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_SUPERVISOR
from ..services import wfm_scope
from ..services.helpers import normalize_text
from ..services.monitoria_export import gerar_csv, gerar_xlsx
from ..services.wfm_montagem import EventoCalendario, horario_efetivo

MAX_DIAS = 366
TIPOS = ("resumo", "escalas", "presencas", "trocas", "aprovacoes")  # relatórios em tabela (exportáveis)
SEMANA = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")
ROTULO_STATUS = {"PRESENTE": "Presente", "FALTA": "Falta", "FALTA_JUSTIFICADA": "Falta justificada", "ATESTADO": "Atestado", "SEM_LANCAMENTO": "Sem lançamento"}
ROTULO_TROCA = {
    "AGUARDANDO_B": "Aguardando o colega", "AGUARDANDO_APROVACAO": "Aguardando aprovação", "APROVADA": "Aprovada", "REPROVADA": "Reprovada",
    "RECUSADA": "Recusada pelo colega", "CANCELADA": "Cancelada", "EXPIRADA": "Expirada", "INVALIDADA": "Invalidada", "BLOQUEADA": "Bloqueada", "DESFEITA": "Desfeita",
}
ROTULO_ACAO = {
    "enviar_aprovacao": "Enviada para aprovação", "aprovar_escala": "Aprovada", "declinar_escala": "Declinada",
    "cancelar_envio_aprovacao": "Envio cancelado", "publicar_escala": "Publicada", "publicar_com_violacao": "Publicada com violação",
}
CALCULO_COMUM = (
    "Escala considerada: a última versão publicada de cada mês do período.",
    "Horas: jornada líquida do dia (descontadas as pausas), já com feriado, dia/horário especial e horário combinado.",
)


def _http(codigo: int, detalhe: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def _data(valor: Any, rotulo: str) -> date:
    try:
        return date.fromisoformat(str(valor))
    except ValueError:
        raise _http(status.HTTP_400_BAD_REQUEST, f"{rotulo} inválida (AAAA-MM-DD).")


def _br(d: date | datetime | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def _brh(d: datetime | None) -> str:
    return d.strftime("%d/%m/%Y %H:%M") if d else ""


def _horas(minutos: int | float) -> float:
    return round(minutos / 60, 2)


def _meses(ini: date, fim: date) -> list[str]:
    out, atual = [], date(ini.year, ini.month, 1)
    while atual <= fim:
        out.append(f"{atual.year}-{atual.month:02d}")
        atual = date(atual.year + (atual.month == 12), (atual.month % 12) + 1, 1)
    return out


def _col(chave: str, rotulo: str, tipo: str = "texto") -> dict:
    return {"chave": chave, "rotulo": rotulo, "tipo": tipo}


class WfmRelatoriosRepositoryMixin:
    # ------------------------------------------------------------------
    # Coleta (uma vez por pedido) — respeita o escopo do usuário
    # ------------------------------------------------------------------
    def _wfm_rel_coletar(self, cursor, user, operacao: str, ini: date, fim: date, id_operador: int | None) -> dict:
        operadores = self._wfm_operadores_visiveis(cursor, user, operacao)
        if id_operador is not None:
            operadores = [o for o in operadores if o["id_usuario"] == id_operador]
        ids = [o["id_usuario"] for o in operadores]
        nomes = {o["id_usuario"]: o["nome"] for o in operadores}
        modelos = self._wfm_turnos_modelo(cursor, operacao)
        cursor.execute(
            "SELECT tipo, data_ini, data_fim, id_turno, entrada, saida FROM dbo.wfm_calendario_especial "
            "WHERE operacao = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?",
            (operacao, fim, ini),
        )
        eventos = [EventoCalendario(normalize_text(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in cursor.fetchall()]

        # Última versão publicada de cada mês
        dias_escala: list[dict] = []
        versoes: list[dict] = []
        for ano_mes in _meses(ini, fim):
            cursor.execute(
                "SELECT v.versao, v.publicado_em, v.publicado_por_nome, v.com_violacao, v.justificativa, v.snapshot_json, "
                "(SELECT TOP 1 a.usuario_nome FROM dbo.wfm_auditoria a WHERE a.operacao = v.operacao AND a.acao = 'aprovar_escala' "
                "AND a.entidade_id = v.ano_mes AND a.criado_em <= v.publicado_em ORDER BY a.criado_em DESC) "
                "FROM dbo.wfm_escala_versoes v WHERE v.operacao = ? AND v.ano_mes = ? ORDER BY v.versao DESC",
                (operacao, ano_mes),
            )
            linhas = cursor.fetchall()
            for n, r in enumerate(linhas):
                try:
                    itens = json.loads(r[5] or "{}").get("itens", [])
                except ValueError:
                    itens = []
                versoes.append({
                    "ano_mes": ano_mes, "versao": int(r[0]), "vigente": n == 0, "publicado_em": r[1], "publicado_por": normalize_text(r[2]),
                    "com_violacao": bool(r[3]), "justificativa": normalize_text(r[4]), "aprovado_por": normalize_text(r[6]), "itens": len(itens),
                })
                if n != 0:
                    continue
                for i in itens:
                    if i["id_operador"] not in nomes:
                        continue
                    d = date.fromisoformat(i["data"])
                    if not (ini <= d <= fim) or i["id_turno"] not in modelos:
                        continue
                    ajuste = (i.get("entrada_ajuste"), i.get("saida_ajuste")) if i.get("entrada_ajuste") and i.get("saida_ajuste") else None
                    h = horario_efetivo(d, modelos[i["id_turno"]], modelos, eventos, ajuste)
                    dias_escala.append({"id_operador": i["id_operador"], "data": d, **h})

        presencas: dict[tuple[int, date], dict] = {}
        extras: dict[tuple[int, date], int] = {}
        if ids:
            marc = ",".join("?" for _ in ids)
            cursor.execute(
                f"SELECT id_operador, data, status, observacao, lancado_por FROM dbo.wfm_presencas WHERE operacao = ? AND data BETWEEN ? AND ? AND id_operador IN ({marc})",
                (operacao, ini, fim, *ids),
            )
            for r in cursor.fetchall():
                presencas[(int(r[0]), r[1])] = {"status": normalize_text(r[2]), "observacao": normalize_text(r[3]), "lancado_por": normalize_text(r[4])}
            cursor.execute(
                f"SELECT id_operador, data, minutos FROM dbo.wfm_horas_extras WHERE operacao = ? AND data BETWEEN ? AND ? AND id_operador IN ({marc})",
                (operacao, ini, fim, *ids),
            )
            for r in cursor.fetchall():
                extras[(int(r[0]), r[1])] = int(r[2])

        # Trocas: Supervisor só as da própria equipe; filtro por operador vale para solicitante ou colega.
        cursor.execute(
            "SELECT t.id_troca, t.id_solicitante, t.id_alvo, t.data_a, t.data_b, t.estado, t.motivo, t.criado_em, t.decidido_por, t.decidido_em, t.justificativa, "
            "us.nome, us.sobrenome, ua.nome, ua.sobrenome FROM dbo.wfm_trocas t "
            "LEFT JOIN dbo.usuarios us ON us.id_usuario = t.id_solicitante LEFT JOIN dbo.usuarios ua ON ua.id_usuario = t.id_alvo "
            "WHERE t.operacao = ? AND ((t.data_a BETWEEN ? AND ?) OR (t.data_b BETWEEN ? AND ?)) ORDER BY t.criado_em DESC",
            (operacao, ini, fim, ini, fim),
        )
        equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
        trocas = []
        for r in cursor.fetchall():
            id_a, id_b = int(r[1]), int(r[2])
            if not wfm_scope.pode_ver_troca(perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao, id_a=id_a, id_b=id_b, equipe_supervisor=equipe):
                continue
            if id_operador is not None and id_operador not in (id_a, id_b):
                continue
            trocas.append({
                "id_troca": int(r[0]), "id_solicitante": id_a, "id_alvo": id_b, "data_a": r[3], "data_b": r[4], "estado": normalize_text(r[5]), "motivo": normalize_text(r[6]),
                "criado_em": r[7], "decidido_por": normalize_text(r[8]), "decidido_em": r[9], "justificativa": normalize_text(r[10]),
                "solicitante": f"{normalize_text(r[11])} {normalize_text(r[12])}".strip(), "alvo": f"{normalize_text(r[13])} {normalize_text(r[14])}".strip(),
            })

        # Aprovações da escala (envio, aprovação, declínio, publicação) dos meses do período
        meses = set(_meses(ini, fim))
        cursor.execute(
            "SELECT criado_em, usuario_nome, perfil, acao, entidade_id, justificativa, depois_json FROM dbo.wfm_auditoria "
            "WHERE operacao = ? AND entidade = 'escala' AND acao IN ('enviar_aprovacao','aprovar_escala','declinar_escala','cancelar_envio_aprovacao','publicar_escala','publicar_com_violacao') "
            "ORDER BY criado_em DESC",
            (operacao,),
        )
        aprovacoes = [
            {"quando": r[0], "quem": normalize_text(r[1]), "perfil": normalize_text(r[2]), "acao": normalize_text(r[3]), "ano_mes": normalize_text(r[4])[:7],
             "justificativa": normalize_text(r[5]), "depois": normalize_text(r[6])}
            for r in cursor.fetchall()
            if normalize_text(r[4])[:7] in meses
        ]
        return {
            "operadores": operadores, "nomes": nomes, "dias_escala": dias_escala, "presencas": presencas, "extras": extras,
            "versoes": versoes, "trocas": trocas, "aprovacoes": aprovacoes,
        }

    # ------------------------------------------------------------------
    # Montagem de cada relatório
    # ------------------------------------------------------------------
    @staticmethod
    def _wfm_rel_status(dado: dict, id_operador: int, d: date) -> str:
        p = dado["presencas"].get((id_operador, d))
        return p["status"] if p and p["status"] in ROTULO_STATUS else "SEM_LANCAMENTO"

    def _wfm_rel_agregar(self, dado: dict) -> dict[int, dict]:
        """Totais brutos por operador (minutos e contagens) — base do resumo, do painel e das comparações."""
        por_op: dict[int, dict] = {o["id_usuario"]: {"operador": o["nome"], "equipe": o.get("equipe") or "", "escalados": 0, "horas_escaladas": 0, "presentes": 0, "faltas": 0,
                                                    "justificadas": 0, "atestados": 0, "sem_lancamento": 0, "horas_trabalhadas": 0, "extras": 0, "trocas": 0}
                                    for o in dado["operadores"]}
        for d in dado["dias_escala"]:
            if not d["trabalha"]:
                continue
            linha = por_op[d["id_operador"]]
            linha["escalados"] += 1
            linha["horas_escaladas"] += d["minutos"]
            situacao = self._wfm_rel_status(dado, d["id_operador"], d["data"])
            if situacao == "PRESENTE":
                linha["presentes"] += 1
                linha["horas_trabalhadas"] += d["minutos"]
            elif situacao == "FALTA":
                linha["faltas"] += 1
            elif situacao == "FALTA_JUSTIFICADA":
                linha["justificadas"] += 1
            elif situacao == "ATESTADO":
                linha["atestados"] += 1
            else:
                linha["sem_lancamento"] += 1
        for (id_op, _d), minutos in dado["extras"].items():
            if id_op in por_op:
                por_op[id_op]["extras"] += minutos
        for t in dado["trocas"]:
            if t["estado"] == "APROVADA":
                for id_op in (t["id_solicitante"], t["id_alvo"]):
                    if id_op in por_op:
                        por_op[id_op]["trocas"] += 1
        return por_op

    def _wfm_rel_resumo(self, dado: dict, anterior: dict | None = None) -> tuple[list[dict], list[dict], list[dict], list[str]]:
        por_op = self._wfm_rel_agregar(dado)
        antes = {nome: v for v in (self._wfm_rel_agregar(anterior).values() if anterior else []) for nome in [v["operador"]]}
        linhas = []
        for id_op, linha in sorted(por_op.items(), key=lambda x: x[1]["operador"]):
            ant = antes.get(linha["operador"])
            horas_ant = (ant["horas_trabalhadas"] + ant["extras"]) if ant else None
            apurados = linha["presentes"] + linha["faltas"] + linha["justificadas"] + linha["atestados"]
            linhas.append({
                "_id_operador": id_op,
                "operador": linha["operador"], "equipe": linha["equipe"], "dias_escalados": linha["escalados"], "horas_escaladas": _horas(linha["horas_escaladas"]),
                "presencas": linha["presentes"], "faltas": linha["faltas"], "faltas_justificadas": linha["justificadas"], "atestados": linha["atestados"],
                "sem_lancamento": linha["sem_lancamento"], "horas_trabalhadas": _horas(linha["horas_trabalhadas"]), "horas_extras": _horas(linha["extras"]),
                "total_horas": _horas(linha["horas_trabalhadas"] + linha["extras"]), "trocas_aprovadas": linha["trocas"],
                "variacao_horas": _horas((linha["horas_trabalhadas"] + linha["extras"]) - horas_ant) if horas_ant is not None else None,
                "absenteismo": round(100 * (linha["faltas"] + linha["justificadas"]) / apurados, 1) if apurados else None,
            })
        colunas = [
            _col("operador", "Operador"), _col("equipe", "Equipe"), _col("dias_escalados", "Dias escalados", "numero"), _col("horas_escaladas", "Horas escaladas", "horas"),
            _col("presencas", "Presenças", "numero"), _col("faltas", "Faltas", "numero"), _col("faltas_justificadas", "Faltas justificadas", "numero"),
            _col("atestados", "Atestados", "numero"), _col("sem_lancamento", "Sem lançamento", "numero"), _col("horas_trabalhadas", "Horas trabalhadas", "horas"),
            _col("horas_extras", "Horas extras", "horas"), _col("total_horas", "Total de horas", "horas"), _col("trocas_aprovadas", "Trocas aprovadas", "numero"),
            _col("absenteismo", "Absenteísmo (%)", "percentual"), _col("variacao_horas", "Δ horas vs. período anterior", "variacao"),
        ]
        soma = lambda k: sum(l[k] for l in linhas)  # noqa: E731
        apur = soma("presencas") + soma("faltas") + soma("faltas_justificadas") + soma("atestados")
        resumo = [
            {"rotulo": "Operadores que trabalharam", "valor": sum(1 for l in linhas if l["dias_escalados"]), "dica": "Com pelo menos um dia de trabalho na escala publicada."},
            {"rotulo": "Horas escaladas", "valor": round(soma("horas_escaladas"), 2), "unidade": "h"},
            {"rotulo": "Horas trabalhadas", "valor": round(soma("total_horas"), 2), "unidade": "h", "dica": "Presenças + horas extras lançadas."},
            {"rotulo": "Faltas", "valor": soma("faltas") + soma("faltas_justificadas"), "dica": "Injustificadas e justificadas."},
            {"rotulo": "Absenteísmo", "valor": round(100 * (soma("faltas") + soma("faltas_justificadas")) / apur, 1) if apur else None, "unidade": "%", "dica": "Faltas ÷ dias com presença apurada."},
            {"rotulo": "Sem lançamento", "valor": soma("sem_lancamento"), "dica": "Dias de trabalho sem presença lançada."},
        ]
        calculo = [
            *CALCULO_COMUM,
            "Horas trabalhadas = horas dos dias lançados como Presente; atestado e falta não contam como trabalhadas. Total = trabalhadas + horas extras.",
            "Absenteísmo = (faltas + faltas justificadas) ÷ dias de trabalho com presença apurada. Dias sem lançamento não entram na conta.",
        ]
        return colunas, linhas, resumo, calculo

    def _wfm_rel_totais(self, dado: dict) -> dict:
        """Indicadores do período (base das comparações do painel)."""
        por_op = list(self._wfm_rel_agregar(dado).values())
        soma = lambda k: sum(v[k] for v in por_op)  # noqa: E731
        apurados = soma("presentes") + soma("faltas") + soma("justificadas") + soma("atestados")
        faltas = soma("faltas") + soma("justificadas")
        escalados = soma("escalados")
        return {
            "horas_escaladas": _horas(soma("horas_escaladas")), "horas_trabalhadas": _horas(soma("horas_trabalhadas") + soma("extras")), "horas_extras": _horas(soma("extras")),
            "faltas": faltas, "absenteismo": round(100 * faltas / apurados, 1) if apurados else None,
            "cobertura": round(100 * apurados / escalados, 1) if escalados else None, "sem_lancamento": soma("sem_lancamento"),
            "trocas": sum(1 for t in dado["trocas"] if t["estado"] == "APROVADA"), "operadores": sum(1 for v in por_op if v["escalados"]), "dias_escalados": escalados,
            "presencas": soma("presentes"), "atestados": soma("atestados"), "faltas_injustificadas": soma("faltas"), "faltas_justificadas": soma("justificadas"),
        }

    def _wfm_rel_painel(self, dado: dict, anterior: dict, ini: date, fim: date) -> dict:
        atual, antes = self._wfm_rel_totais(dado), self._wfm_rel_totais(anterior)
        # (chave, rótulo, unidade, melhor quando, dica) — "melhor" só orienta a cor da variação.
        definicao = [
            ("horas_trabalhadas", "Horas trabalhadas", "h", "alta", "Presenças + horas extras."),
            ("horas_escaladas", "Horas escaladas", "h", "neutra", "Jornada líquida da escala publicada."),
            ("absenteismo", "Absenteísmo", "%", "baixa", "Faltas ÷ dias com presença apurada."),
            ("faltas", "Faltas", "", "baixa", "Injustificadas e justificadas."),
            ("cobertura", "Presenças apuradas", "%", "alta", "Dias de trabalho com presença lançada ÷ dias escalados."),
            ("trocas", "Trocas aprovadas", "", "neutra", "Pedidos aprovados no período."),
        ]
        kpis = []
        for chave, rotulo, unidade, melhor, dica in definicao:
            v, a = atual[chave], antes[chave]
            variacao = round(100 * (v - a) / a, 1) if v is not None and a not in (None, 0) else None
            kpis.append({"chave": chave, "rotulo": rotulo, "valor": v, "anterior": a, "variacao": variacao, "unidade": unidade, "melhor": melhor, "dica": dica})

        # Série diária, distribuição por dia da semana, horas por turno e comparação entre equipes
        dias: dict[date, dict] = {}
        d = ini
        while d <= fim:
            dias[d] = {"escalados": 0, "presentes": 0, "faltas": 0, "atestados": 0, "sem": 0, "horas": 0}
            d += timedelta(days=1)
        semana = [{"apurados": 0, "faltas": 0} for _ in range(7)]
        por_turno: dict[str, int] = {}
        equipes: dict[str, dict] = {}
        nomes_equipe = {o["id_usuario"]: (o.get("equipe") or "Sem equipe") for o in dado["operadores"]}
        for x in dado["dias_escala"]:
            if not x["trabalha"] or x["data"] not in dias:
                continue
            situacao = self._wfm_rel_status(dado, x["id_operador"], x["data"])
            linha = dias[x["data"]]
            linha["escalados"] += 1
            sem = semana[x["data"].weekday()]
            por_turno[x["codigo"]] = por_turno.get(x["codigo"], 0) + x["minutos"]
            eq = equipes.setdefault(nomes_equipe.get(x["id_operador"], "Sem equipe"), {"escalados": 0, "apurados": 0, "faltas": 0, "horas": 0})
            eq["escalados"] += 1
            if situacao == "PRESENTE":
                linha["presentes"] += 1
                linha["horas"] += x["minutos"]
                eq["horas"] += x["minutos"]
            elif situacao in ("FALTA", "FALTA_JUSTIFICADA"):
                linha["faltas"] += 1
                sem["faltas"] += 1
                eq["faltas"] += 1
            elif situacao == "ATESTADO":
                linha["atestados"] += 1
            else:
                linha["sem"] += 1
            if situacao != "SEM_LANCAMENTO":
                sem["apurados"] += 1
                eq["apurados"] += 1
        serie = [{"data": k.isoformat(), "rotulo": f"{k.day:02d}/{k.month:02d}", **{kk: (_horas(vv) if kk == "horas" else vv) for kk, vv in v.items()}} for k, v in dias.items()]

        por_op = sorted(self._wfm_rel_agregar(dado).values(), key=lambda v: v["horas_trabalhadas"] + v["extras"], reverse=True)
        top = [{"operador": v["operador"], "trabalhadas": _horas(v["horas_trabalhadas"] + v["extras"]), "escaladas": _horas(v["horas_escaladas"]), "faltas": v["faltas"] + v["justificadas"]}
               for v in por_op if v["escalados"]][:10]
        trocas_estado: dict[str, int] = {}
        for t in dado["trocas"]:
            rotulo = ROTULO_TROCA.get(t["estado"], t["estado"])
            trocas_estado[rotulo] = trocas_estado.get(rotulo, 0) + 1
        dias_periodo = (fim - ini).days + 1
        return {
            "kpis": kpis, "totais": atual,
            "anterior": {"ini": (ini - timedelta(days=dias_periodo)).isoformat(), "fim": (ini - timedelta(days=1)).isoformat()},
            "graficos": {
                "serie_diaria": serie,
                "presenca": [{"rotulo": "Presente", "valor": atual["presencas"]}, {"rotulo": "Falta", "valor": atual["faltas_injustificadas"]},
                             {"rotulo": "Falta justificada", "valor": atual["faltas_justificadas"]}, {"rotulo": "Atestado", "valor": atual["atestados"]},
                             {"rotulo": "Sem lançamento", "valor": atual["sem_lancamento"]}],
                "top_operadores": top,
                "absenteismo_semana": [{"rotulo": SEMANA[i], "valor": round(100 * v["faltas"] / v["apurados"], 1) if v["apurados"] else None, "faltas": v["faltas"], "apurados": v["apurados"]}
                                       for i, v in enumerate(semana)],
                "trocas_estado": [{"rotulo": k, "valor": v} for k, v in sorted(trocas_estado.items(), key=lambda kv: -kv[1])],
                "horas_turno": [{"rotulo": k, "valor": _horas(v)} for k, v in sorted(por_turno.items(), key=lambda kv: -kv[1])][:8],
                "equipes": [{"rotulo": k, "escalados": v["escalados"], "faltas": v["faltas"], "horas": _horas(v["horas"]),
                             "absenteismo": round(100 * v["faltas"] / v["apurados"], 1) if v["apurados"] else None} for k, v in sorted(equipes.items(), key=lambda kv: kv[0])],
            },
        }

    def _wfm_rel_escalas(self, dado: dict) -> tuple[list[dict], list[dict], list[dict], list[str]]:
        linhas = [
            {"mes": f"{v['ano_mes'][5:]}/{v['ano_mes'][:4]}", "versao": f"v{v['versao']}", "situacao": "Vigente" if v["vigente"] else "Substituída", "publicado_em": _brh(v["publicado_em"]),
             "publicado_por": v["publicado_por"], "aprovado_por": v["aprovado_por"] or "—", "itens": v["itens"], "violacao": "Sim" if v["com_violacao"] else "Não", "justificativa": v["justificativa"]}
            for v in sorted(dado["versoes"], key=lambda x: (x["ano_mes"], x["versao"]), reverse=True)
        ]
        colunas = [_col("mes", "Mês"), _col("versao", "Versão"), _col("situacao", "Situação", "estado"), _col("publicado_em", "Publicada em"), _col("publicado_por", "Publicada por"),
                   _col("aprovado_por", "Aprovada por"), _col("itens", "Lançamentos", "numero"), _col("violacao", "Com violação"), _col("justificativa", "Justificativa")]
        por_mes = {v["ano_mes"] for v in dado["versoes"]}
        resumo = [{"rotulo": "Meses com escala publicada", "valor": len(por_mes)}, {"rotulo": "Versões publicadas", "valor": len(dado["versoes"])},
                  {"rotulo": "Publicadas com violação", "valor": sum(1 for v in dado["versoes"] if v["com_violacao"])}]
        calculo = ["Cada linha é uma publicação (versão) da escala do mês; só a mais recente do mês é a vigente.",
                   "\"Aprovada por\" é a última aprovação registrada antes da publicação; a publicação com violação exige justificativa."]
        return colunas, linhas, resumo, calculo

    def _wfm_rel_presencas(self, dado: dict) -> tuple[list[dict], list[dict], list[dict], list[str]]:
        linhas = []
        for d in sorted(dado["dias_escala"], key=lambda x: (x["data"], dado["nomes"][x["id_operador"]])):
            if not d["trabalha"]:
                continue
            situacao = self._wfm_rel_status(dado, d["id_operador"], d["data"])
            p = dado["presencas"].get((d["id_operador"], d["data"])) or {}
            linhas.append({
                "data": _br(d["data"]), "operador": dado["nomes"][d["id_operador"]], "turno": d["codigo"], "horario": f"{d['entrada']}–{d['saida']}", "horas_escaladas": _horas(d["minutos"]),
                "status": ROTULO_STATUS[situacao], "horas_trabalhadas": _horas(d["minutos"]) if situacao == "PRESENTE" else 0,
                "horas_extras": _horas(dado["extras"].get((d["id_operador"], d["data"]), 0)), "observacao": p.get("observacao", ""), "lancado_por": p.get("lancado_por", ""),
            })
        colunas = [_col("data", "Data"), _col("operador", "Operador"), _col("turno", "Turno"), _col("horario", "Horário"), _col("horas_escaladas", "Horas escaladas", "horas"),
                   _col("status", "Presença", "estado"), _col("horas_trabalhadas", "Horas trabalhadas", "horas"), _col("horas_extras", "Horas extras", "horas"),
                   _col("observacao", "Observação"), _col("lancado_por", "Lançado por")]
        cont = lambda s: sum(1 for l in linhas if l["status"] == ROTULO_STATUS[s])  # noqa: E731
        resumo = [{"rotulo": "Dias de trabalho", "valor": len(linhas)}, {"rotulo": "Presenças", "valor": cont("PRESENTE")},
                  {"rotulo": "Faltas", "valor": cont("FALTA") + cont("FALTA_JUSTIFICADA")}, {"rotulo": "Atestados", "valor": cont("ATESTADO")}, {"rotulo": "Sem lançamento", "valor": cont("SEM_LANCAMENTO")}]
        calculo = [*CALCULO_COMUM, "Só aparecem dias de trabalho (folga e DSR ficam de fora). Sem presença lançada = \"Sem lançamento\"."]
        return colunas, linhas, resumo, calculo

    def _wfm_rel_trocas(self, dado: dict) -> tuple[list[dict], list[dict], list[dict], list[str]]:
        linhas = [
            {"pedido": _brh(t["criado_em"]), "solicitante": t["solicitante"], "colega": t["alvo"],
             "dias": _br(t["data_a"]) if t["data_a"] == t["data_b"] else f"{_br(t['data_a'])} ⇄ {_br(t['data_b'])}",
             "estado": ROTULO_TROCA.get(t["estado"], t["estado"]), "decidido_por": t["decidido_por"] or "—", "decidido_em": _brh(t["decidido_em"]),
             "justificativa": t["justificativa"], "motivo": t["motivo"]}
            for t in dado["trocas"]
        ]
        colunas = [_col("pedido", "Pedido em"), _col("solicitante", "Solicitante"), _col("colega", "Colega"), _col("dias", "Dia(s)"), _col("estado", "Situação", "estado"),
                   _col("decidido_por", "Decidido por"), _col("decidido_em", "Decidido em"), _col("justificativa", "Justificativa da decisão"), _col("motivo", "Motivo do pedido")]
        cont = lambda e: sum(1 for t in dado["trocas"] if t["estado"] == e)  # noqa: E731
        resumo = [{"rotulo": "Pedidos", "valor": len(dado["trocas"])}, {"rotulo": "Aprovadas", "valor": cont("APROVADA")}, {"rotulo": "Reprovadas", "valor": cont("REPROVADA")},
                  {"rotulo": "Em andamento", "valor": cont("AGUARDANDO_B") + cont("AGUARDANDO_APROVACAO")}]
        calculo = ["Pedidos cujo dia (de qualquer das duas partes) cai no período.", "Supervisor vê só os pedidos que envolvem alguém da sua equipe."]
        return colunas, linhas, resumo, calculo

    def _wfm_rel_aprovacoes(self, dado: dict) -> tuple[list[dict], list[dict], list[dict], list[str]]:
        linhas = [
            {"quando": _brh(a["quando"]), "mes": f"{a['ano_mes'][5:]}/{a['ano_mes'][:4]}", "acao": ROTULO_ACAO.get(a["acao"], a["acao"]), "quem": a["quem"], "perfil": a["perfil"], "justificativa": a["justificativa"]}
            for a in dado["aprovacoes"]
        ]
        colunas = [_col("quando", "Quando"), _col("mes", "Mês da escala"), _col("acao", "Ação", "estado"), _col("quem", "Quem"), _col("perfil", "Perfil"), _col("justificativa", "Justificativa")]
        cont = lambda a: sum(1 for x in dado["aprovacoes"] if x["acao"] == a)  # noqa: E731
        resumo = [{"rotulo": "Enviadas", "valor": cont("enviar_aprovacao")}, {"rotulo": "Aprovadas", "valor": cont("aprovar_escala")}, {"rotulo": "Declinadas", "valor": cont("declinar_escala")},
                  {"rotulo": "Publicadas", "valor": cont("publicar_escala") + cont("publicar_com_violacao")}]
        calculo = ["Trilha de auditoria da escala: quem enviou, aprovou, declinou (com a justificativa) e publicou, mês a mês."]
        return colunas, linhas, resumo, calculo

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------
    def _wfm_rel_montar(self, user, operacao: str, tipo: str, data_ini: Any, data_fim: Any, id_operador: int | None, *, auditar: str = "") -> dict:
        tipo = normalize_text(tipo) or "resumo"
        if tipo not in TIPOS + ("painel",):
            raise _http(status.HTTP_400_BAD_REQUEST, "Relatório inválido.")
        ini, fim = _data(data_ini, "Data inicial"), _data(data_fim, "Data final")
        if fim < ini:
            raise _http(status.HTTP_400_BAD_REQUEST, "A data final não pode ser anterior à inicial.")
        if (fim - ini).days + 1 > MAX_DIAS:
            raise _http(status.HTTP_400_BAD_REQUEST, f"Período máximo de {MAX_DIAS} dias.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)  # escalas desativadas continuam consultáveis (histórico)
            conn.commit()
            dado = self._wfm_rel_coletar(cursor, user, operacao, ini, fim, id_operador)
            anterior = None
            if tipo in ("resumo", "painel"):  # comparação com o período imediatamente anterior, de mesma duração
                dias_periodo = (fim - ini).days + 1
                anterior = self._wfm_rel_coletar(cursor, user, operacao, ini - timedelta(days=dias_periodo), ini - timedelta(days=1), id_operador)
            if auditar:
                self.wfm_audit(cursor, user, operacao=operacao, acao="exportar_relatorio", entidade="relatorio", entidade_id=tipo,
                               depois={"formato": auditar, "periodo": f"{ini.isoformat()}..{fim.isoformat()}"}, ip="")
                conn.commit()
        finally:
            conn.close()
        titulos = {"resumo": "Resumo por operador", "escalas": "Histórico de escalas", "presencas": "Presenças e faltas", "trocas": "Trocas de plantão", "aprovacoes": "Aprovações da escala"}
        if tipo == "painel":
            return {
                "operacao": operacao, "tipo": tipo, "titulo": "Painel", "periodo": {"ini": ini.isoformat(), "fim": fim.isoformat()},
                "operadores": [{"id_usuario": o["id_usuario"], "nome": o["nome"]} for o in dado["operadores"]] if id_operador is None else [],
                "colunas": [], "linhas": [], "resumo": [], "painel": self._wfm_rel_painel(dado, anterior, ini, fim), "gerado_em": datetime.now().replace(microsecond=0).isoformat(),
                "calculo": [*CALCULO_COMUM, "Comparação: período imediatamente anterior, com a mesma duração. Variação = (atual − anterior) ÷ anterior.",
                            "Absenteísmo por dia da semana e por equipe = faltas ÷ dias com presença apurada. Dias sem lançamento ficam de fora."],
            }
        colunas, linhas, resumo, calculo = self._wfm_rel_resumo(dado, anterior) if tipo == "resumo" else getattr(self, f"_wfm_rel_{tipo}")(dado)
        return {
            "operacao": operacao, "tipo": tipo, "titulo": titulos[tipo], "periodo": {"ini": ini.isoformat(), "fim": fim.isoformat()},
            "operadores": [{"id_usuario": o["id_usuario"], "nome": o["nome"]} for o in dado["operadores"]] if id_operador is None else [],
            "colunas": colunas, "linhas": linhas, "resumo": resumo, "calculo": calculo, "gerado_em": datetime.now().replace(microsecond=0).isoformat(),
        }

    def wfm_relatorio(self, user, operacao: str, tipo: str, data_ini: Any, data_fim: Any, id_operador: int | None = None) -> dict:
        return self._wfm_rel_montar(user, operacao, tipo, data_ini, data_fim, id_operador)

    def wfm_relatorio_exportar(self, user, operacao: str, tipo: str, data_ini: Any, data_fim: Any, id_operador: int | None = None, formato: str = "xlsx") -> tuple[bytes, str, str]:
        """XLSX (aba do relatório escolhido + aba "Como é calculado") ou CSV. `tipo=completo` gera todas as abas no XLSX."""
        formato = "csv" if normalize_text(formato).lower() == "csv" else "xlsx"
        escolhido = normalize_text(tipo) or "resumo"
        escolhido = "resumo" if escolhido == "painel" else escolhido  # o painel é visual: exporta-se o resumo que o alimenta
        tipos = list(TIPOS) if normalize_text(tipo) == "completo" and formato == "xlsx" else [escolhido]
        relatorios = [self._wfm_rel_montar(user, operacao, t, data_ini, data_fim, id_operador, auditar=formato if n == 0 else "") for n, t in enumerate(tipos)]
        base = re.sub(r"[^A-Za-z0-9]+", "_", relatorios[0]["operacao"]).strip("_")
        sufixo = "completo" if len(tipos) > 1 else relatorios[0]["tipo"]
        nome = f"wfm_{sufixo}_{base}_{relatorios[0]['periodo']['ini']}_{relatorios[0]['periodo']['fim']}.{formato}"

        def tabela(rel: dict) -> tuple[list[str], list[list]]:
            return [c["rotulo"] for c in rel["colunas"]], [[l.get(c["chave"], "") if l.get(c["chave"]) is not None else "" for c in rel["colunas"]] for l in rel["linhas"]]

        if formato == "csv":
            colunas, linhas = tabela(relatorios[0])
            return gerar_csv(colunas, linhas), nome, "text/csv; charset=utf-8"
        abas = []
        for rel in relatorios:
            colunas, linhas = tabela(rel)
            abas.append({"nome": rel["titulo"], "colunas": colunas, "linhas": linhas})
        regras = [[r["titulo"], linha] for r in relatorios for linha in r["calculo"]]
        regras.insert(0, ["Período", f"{_br(date.fromisoformat(relatorios[0]['periodo']['ini']))} a {_br(date.fromisoformat(relatorios[0]['periodo']['fim']))}"])
        abas.append({"nome": "Como é calculado", "colunas": ["Relatório", "Regra"], "linhas": regras})
        return gerar_xlsx(abas), nome, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
