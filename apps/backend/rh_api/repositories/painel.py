"""Painel (14/nov/2026): visão analítica por módulo e unidade, configurada pela Tecnologia. Mixin do DatabaseRepository.

Só leitura sobre os dados dos módulos. Regras de acesso (todas no servidor):
  * ver um painel: `painel.visualizar` + perfil marcado no painel (Administrador vê todos) + escopo de operação
    (`user.allows_operacao`); painel desligado não aparece;
  * cada métrica exige ainda a permissão de BASE do módulo de origem (`painel_regras.METRICAS[...].base`) e a função
    ligada na unidade (tela Módulos / item 16): sem isso o bloco não é montado;
  * configurar: `painel.configurar` (Tecnologia). Toda mudança grava `painel_alteracao` (antes -> depois).
Fontes (nenhuma fórmula nova): Turnos e Plantões = `_wfm_rel_coletar`/`_wfm_rel_agregar` (mesma base dos relatórios);
Monitoria = `_mon_linhas_escopo` + motor único `monitoria_indicadores`; Diário de bordo = tabelas diario_*.
Desempenho: um cache curto por pessoa (30 s) e só as métricas do painel aberto são calculadas.
"""

from __future__ import annotations

import json
import threading
import time as _time
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, get_role_definition
from ..services import acesso
from ..services import monitoria_indicadores as ind
from ..services import monitoria_workflow as wf
from ..services import painel_regras as regras
from ..services.helpers import normalize_text
from ..services.wfm_historico import FUSO_BRASIL
from .painel_metricas import PainelMetricasMixin
from .painel_schema import ensure_painel_schema

CACHE_SEG = 30
_cache: dict[tuple, tuple[float, Any]] = {}
_cache_lock = threading.Lock()

SIGLA = {"PRESENTE": "P", "FALTA": "F", "FALTA_JUSTIFICADA": "FJ", "ATESTADO": "AT", "SERVICO_EXTERNO": "SE", "DAY_OFF": "DO",
         "FOLGA_COMP_BH": "FB", "FOLGA": "FL", "FERIAS": "FE"}
TROCA_PENDENTE = ("AGUARDANDO_B", "AGUARDANDO_APROVACAO")
CONTESTACAO_ABERTA = (wf.CONTESTADA, wf.REANALISE)
_USA_WFM = frozenset({"presenca", "presenca_dia", "faltas_semana", "atestados", "escalas", "trocas_pessoa", "presenca_do_dia", "pausas_mapa",
                      "frequencia", "ranking_equipes", "comparar_equipes", "operadores"})
_USA_MONITORIA = frozenset({"monitorias", "nota_semana", "itens_erro", "distribuicao_notas", "sem_monitoria", "tempo_feedback",
                            "operadores", "ranking_equipes", "comparar_equipes"})
ROTULO_TURNO_DIARIO = {"abertura": "Abertura", "intermediario": "Intermediário", "fechamento": "Fechamento"}


def _hoje() -> date:
    return datetime.now(FUSO_BRASIL).date()


def _nome(user) -> str:
    return (" ".join(p for p in (normalize_text(getattr(user, "nome", "")), normalize_text(getattr(user, "sobrenome", ""))) if p)
            or normalize_text(getattr(user, "username", "")))


def _br(d: Any) -> str:
    if isinstance(d, datetime):
        return d.strftime("%d/%m %H:%M")
    if isinstance(d, date):
        return d.strftime("%d/%m")
    return str(d or "")


def _dia(d: Any) -> str:
    return _br(d.date() if isinstance(d, datetime) else d)


def _http(codigo: int, detalhe: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def limpar_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _do_cache(chave: tuple, produzir):
    agora = _time.monotonic()
    with _cache_lock:
        item = _cache.get(chave)
        if item and agora - item[0] < CACHE_SEG:
            return item[1]
    valor = produzir()
    with _cache_lock:
        if len(_cache) > 500:
            _cache.clear()
        _cache[chave] = (agora, valor)
    return valor


class PainelRepositoryMixin(PainelMetricasMixin):
    # ------------------------------------------------------------------ infraestrutura
    def _pn_abrir(self):
        conn = self._connect()
        cursor = conn.cursor()
        if not getattr(type(self), "_painel_v072_ok", False):
            cursor.execute("SELECT OBJECT_ID('dbo.painel', 'U'), OBJECT_ID('dbo.painel_alteracao', 'U')")
            if any(v is None for v in cursor.fetchone()):
                ensure_painel_schema(cursor)
                conn.commit()
            type(self)._painel_v072_ok = True
        return conn, cursor

    def _pn_paineis(self, cursor, id_painel: int | None = None) -> list[dict]:
        sql = ("SELECT p.id_painel, p.modulo, p.operacao, p.ativo, p.intervalo_seg, p.atualizado_por, p.atualizado_em, o.nome "
               "FROM dbo.painel p LEFT JOIN dbo.operacoes o ON o.chave = p.operacao")
        cursor.execute(sql + (" WHERE p.id_painel = ?" if id_painel else "") + " ORDER BY p.modulo, o.nome", (id_painel,) if id_painel else ())
        paineis = [
            {"id_painel": int(r[0]), "modulo": normalize_text(r[1]), "operacao": normalize_text(r[2]), "ativo": bool(r[3]), "intervalo_seg": int(r[4]),
             "atualizado_por": normalize_text(r[5]), "atualizado_em": r[6].isoformat() if r[6] else None, "operacao_nome": normalize_text(r[7]) or normalize_text(r[2]),
             "metricas": [], "perfis": []}
            for r in cursor.fetchall()
        ]
        if not paineis:
            return paineis
        por_id = {p["id_painel"]: p for p in paineis}
        cursor.execute("SELECT id_painel, metrica, forma, ordem FROM dbo.painel_metrica ORDER BY id_painel, ordem")
        for r in cursor.fetchall():
            if int(r[0]) in por_id and normalize_text(r[1]) in regras.METRICAS:
                por_id[int(r[0])]["metricas"].append({"metrica": normalize_text(r[1]), "forma": normalize_text(r[2]), "ordem": int(r[3])})
        cursor.execute("SELECT id_painel, id_perfil FROM dbo.painel_perfil ORDER BY id_perfil")
        for r in cursor.fetchall():
            if int(r[0]) in por_id:
                por_id[int(r[0])]["perfis"].append(normalize_text(r[1]))
        return paineis

    def _pn_visiveis(self, cursor, user) -> list[dict]:
        permissoes = set(user.permissions)
        return [
            p for p in self._pn_paineis(cursor)
            if regras.pode_ver_painel(perfil=user.perfil, perfis_do_painel=set(p["perfis"]), permissoes=permissoes, ativo=p["ativo"], eh_admin=user.perfil == ROLE_ADMIN)
            and user.allows_operacao(p["operacao"])
        ]

    def _pn_exigir_painel(self, cursor, user, id_painel: int) -> dict:
        for p in self._pn_visiveis(cursor, user):
            if p["id_painel"] == int(id_painel):
                return p
        raise _http(status.HTTP_404_NOT_FOUND, "Painel não encontrado ou sem acesso para o seu perfil.")

    def _pn_metricas_liberadas(self, user, painel: dict) -> list[dict]:
        """Métricas do painel que ESTA pessoa pode ver: base do módulo de origem + função ligada na unidade."""
        permissoes = set(user.permissions)
        saida = []
        for item in painel["metricas"]:
            m = regras.METRICAS[item["metrica"]]
            if not regras.tem_base(m, permissoes):
                continue
            if m.funcao and not acesso.funcao_ligada_na_unidade(m.funcao, painel["operacao"], painel["modulo"]):
                continue
            saida.append({**item, "nome": m.nome, "largura": m.largura, "area": m.area})
        return saida

    # ------------------------------------------------------------------ visualização
    def painel_opcoes(self, user) -> dict:
        conn, cursor = self._pn_abrir()
        try:
            paineis = self._pn_visiveis(cursor, user)
        finally:
            conn.close()
        modulos = [m for m in regras.MODULOS_DO_PAINEL if any(p["modulo"] == m for p in paineis)]
        return {
            "modulos": [{"chave": m, "nome": regras.NOME_MODULO[m]} for m in modulos],
            "paineis": [{"id_painel": p["id_painel"], "modulo": p["modulo"], "operacao": p["operacao"], "operacao_nome": p["operacao_nome"],
                         "intervalo_seg": p["intervalo_seg"]} for p in paineis],
            "periodos": [{"chave": k, "nome": regras.NOME_PERIODO[k]} for k in regras.PERIODOS],
        }

    def painel_dados(self, user, id_painel: int, periodo: str = "mes", equipe: str = "") -> dict:
        periodo = periodo if periodo in regras.PERIODOS else "mes"
        equipe = normalize_text(equipe)
        chave = ("dados", user.id_usuario or user.username, int(id_painel), periodo, equipe, user.perfil)
        return _do_cache(chave, lambda: self._pn_montar(user, int(id_painel), periodo, equipe))

    def _pn_montar(self, user, id_painel: int, periodo: str, equipe: str) -> dict:
        hoje = _hoje()
        ini, fim = regras.intervalo_do_periodo(periodo, hoje)
        conn, cursor = self._pn_abrir()
        try:
            painel = self._pn_exigir_painel(cursor, user, id_painel)
            metricas = self._pn_metricas_liberadas(user, painel)
            ids_metricas = {m["metrica"] for m in metricas}
            ctx: dict[str, Any] = {"painel": painel, "ini": ini, "fim": fim, "hoje": hoje, "periodo": periodo, "equipe": equipe}
            # Só carrega a fonte que alguma métrica do painel usa (desempenho: nada de consulta à toa).
            precisa_wfm = ids_metricas & (_USA_WFM | {"sem_monitoria"})
            if precisa_wfm:
                ctx["wfm"] = self._pn_wfm(cursor, user, painel["operacao"], ini, fim)
                if ids_metricas & {"presenca", "presenca_dia"} and ctx["wfm"].get("dado"):
                    a_ini, a_fim = regras.periodo_anterior(ini, fim)
                    ctx["wfm_anterior"] = self._pn_wfm(cursor, user, painel["operacao"], a_ini, a_fim)
            if ids_metricas & _USA_MONITORIA and regras.tem_base(regras.METRICAS["monitorias"], set(user.permissions)):
                ctx["monitorias"] = self._pn_monitorias(user, painel["operacao"], ini, fim, com_respostas="itens_erro" in ids_metricas)
            blocos = []
            for m in metricas:
                dados = getattr(self, f"_pn_bloco_{m['metrica']}")(cursor, user, ctx)
                blocos.append({"metrica": m["metrica"], "nome": m["nome"], "forma": m["forma"], "largura": m["largura"], "area": m["area"], "dados": dados})
            equipes = sorted({o.get("equipe") or "" for o in (ctx.get("wfm", {}).get("dado") or {}).get("operadores", []) if o.get("equipe")})
        finally:
            conn.close()
        return {
            "painel": {"id_painel": painel["id_painel"], "modulo": painel["modulo"], "modulo_nome": regras.NOME_MODULO.get(painel["modulo"], painel["modulo"]),
                       "operacao": painel["operacao"], "operacao_nome": painel["operacao_nome"], "intervalo_seg": painel["intervalo_seg"]},
            "periodo": {"chave": periodo, "nome": regras.NOME_PERIODO[periodo], "ini": ini.isoformat(), "fim": fim.isoformat()},
            "equipe": equipe, "equipes": equipes, "blocos": blocos,
            "gerado_em": datetime.now(FUSO_BRASIL).replace(tzinfo=None, microsecond=0).isoformat(),
        }

    # ------------------------------------------------------------------ fontes
    def _pn_wfm(self, cursor, user, operacao: str, ini: date, fim: date) -> dict:
        """Mesma base dos relatórios de Turnos e Plantões. Unidade sem escala: devolve o motivo em vez de quebrar o painel."""
        try:
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            cursor.connection.commit()
            return {"dado": self._wfm_rel_coletar(cursor, user, operacao, ini, fim, None)}
        except HTTPException as exc:
            return {"dado": None, "motivo": str(exc.detail)}

    def _pn_monitorias(self, user, operacao: str, ini: date, fim: date, *, com_respostas: bool = False) -> list[dict]:
        return self._mon_linhas_escopo(user, {"operacao": operacao, "data_inicio": ini.isoformat(), "data_fim": fim.isoformat()}, com_respostas=com_respostas)

    @staticmethod
    def _pn_ops_da_equipe(ctx: dict) -> set[int] | None:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not ctx["equipe"] or not dado:
            return None
        return {o["id_usuario"] for o in dado["operadores"] if (o.get("equipe") or "") == ctx["equipe"]}

    def _pn_agregado(self, ctx: dict, chave: str = "wfm") -> dict[int, dict] | None:
        dado = (ctx.get(chave) or {}).get("dado")
        if not dado:
            return None
        por_op = self._wfm_rel_agregar(dado)
        ids = self._pn_ops_da_equipe(ctx)
        return {k: v for k, v in por_op.items() if ids is None or k in ids}

    @staticmethod
    def _pn_sem_dado(ctx: dict) -> dict:
        return {"indisponivel": (ctx.get("wfm") or {}).get("motivo") or "Esta unidade não tem escala em Turnos e Plantões."}

    # ------------------------------------------------------------------ blocos (Operação)
    def _pn_bloco_presenca(self, cursor, user, ctx: dict) -> dict:
        por_op = self._pn_agregado(ctx)
        if por_op is None:
            return self._pn_sem_dado(ctx)
        soma = lambda k, base=por_op: sum(v[k] for v in base.values())  # noqa: E731
        apurados = soma("presentes") + soma("faltas") + soma("justificadas") + soma("atestados")
        presenca = regras.pct(soma("presentes"), apurados)
        anterior = self._pn_agregado(ctx, "wfm_anterior")
        variacao = None
        if anterior is not None and presenca is not None:
            ap_ant = sum(v["presentes"] + v["faltas"] + v["justificadas"] + v["atestados"] for v in anterior.values())
            p_ant = regras.pct(sum(v["presentes"] for v in anterior.values()), ap_ant)
            variacao = round(presenca - p_ant, 1) if p_ant is not None else None
        dado = ctx["wfm"]["dado"]
        ids = self._pn_ops_da_equipe(ctx)
        folgas = sum(1 for d in dado["dias_escala"] if not d["trabalha"] and (ids is None or d["id_operador"] in ids))
        pessoas = sum(1 for v in por_op.values() if v["escalados"])
        return {
            "escalados": soma("escalados"), "pessoas": pessoas, "presentes": soma("presentes"), "presenca_pct": presenca, "variacao_pontos": variacao,
            "faltas": soma("faltas") + soma("justificadas"), "faltas_injustificadas": soma("faltas"), "atestados": soma("atestados"),
            "sem_lancamento": soma("sem_lancamento"), "folgas": folgas, "um_dia": ctx["ini"] == ctx["fim"],
        }

    def _pn_bloco_frequencia(self, cursor, user, ctx: dict) -> dict:
        por_op = self._pn_agregado(ctx)
        if por_op is None:
            return self._pn_sem_dado(ctx)
        grupos: dict[str, dict] = {}
        for v in por_op.values():
            g = grupos.setdefault(v["equipe"] or "Sem equipe", {"equipe": v["equipe"] or "Sem equipe", "presentes": 0, "apurados": 0, "faltas": 0})
            g["presentes"] += v["presentes"]
            g["apurados"] += v["presentes"] + v["faltas"] + v["justificadas"] + v["atestados"]
            g["faltas"] += v["faltas"] + v["justificadas"]
        linhas = [{"equipe": g["equipe"], "presenca_pct": regras.pct(g["presentes"], g["apurados"]), "faltas": g["faltas"]} for g in grupos.values()]
        linhas.sort(key=lambda x: (x["presenca_pct"] is None, -(x["presenca_pct"] or 0), x["equipe"]))
        return {"equipes": linhas}

    def _pn_bloco_escalas(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        if not dado:
            return self._pn_sem_dado(ctx)
        operacao = ctx["painel"]["operacao"]
        cursor.execute(
            "SELECT e.operacao, e.ano_mes FROM dbo.wfm_escalas e WHERE e.aprov_estado = 'EM_APROVACAO' AND e.fechada = 0 "
            "AND (e.operacao = ? OR e.operacao LIKE ?) ORDER BY e.ano_mes",
            (operacao, operacao + "::%"),
        )
        aguardando = [{"escala": normalize_text(r[0]), "mes": normalize_text(r[1])} for r in cursor.fetchall()]
        ids = self._pn_ops_da_equipe(ctx)
        trocas = [t for t in dado["trocas"] if ids is None or t["id_solicitante"] in ids or t["id_alvo"] in ids]

        def linha(t: dict) -> dict:
            return {"quem": t["solicitante"], "com_quem": t["alvo"], "dias": f"{_br(t['data_a'])} ⇄ {_br(t['data_b'])}"}

        return {
            "escalas_aguardando": aguardando,
            "trocas_pendentes": [linha(t) for t in trocas if t["estado"] in TROCA_PENDENTE],
            "trocas_aprovadas": [linha(t) for t in trocas if t["estado"] == "APROVADA"],
        }

    def _pn_bloco_monitorias(self, cursor, user, ctx: dict) -> dict:
        linhas = ctx.get("monitorias") or []
        ids = self._pn_ops_da_equipe(ctx)
        if ids is not None:
            linhas = [l for l in linhas if int(l["id_operador"]) in ids]
        res = ind.resumo(linhas)
        validas = [l for l in linhas if ind.eh_valida(l)]
        abaixo = [l for l in validas if float(l["nota"]) < regras.META_NOTA_PADRAO]
        pendentes = [l for l in linhas if l["status"] == wf.FEEDBACK_PENDENTE]
        contestadas = [l for l in linhas if l["status"] in CONTESTACAO_ABERTA]
        motivos: dict[int, str] = {}
        if contestadas:
            ids_m = [int(l["id_monitoria"]) for l in contestadas]
            cursor.execute(
                f"SELECT id_monitoria, motivo FROM dbo.monitoria_contestacoes WHERE id_monitoria IN ({','.join('?' for _ in ids_m)}) ORDER BY data_contestacao",
                tuple(ids_m),
            )
            for r in cursor.fetchall():
                motivos[int(r[0])] = normalize_text(r[1])
        agora = datetime.now()

        def prazo(l: dict) -> dict:
            lim = l.get("sla_limite")
            if not lim:
                return {"texto": "—", "tom": ""}
            if lim < agora:
                return {"texto": "Vencido", "tom": "perigo"}
            if lim.date() == agora.date():
                return {"texto": "Vence hoje", "tom": "perigo"}
            if lim.date() == agora.date() + timedelta(days=1):
                return {"texto": "Amanhã", "tom": "atencao"}
            return {"texto": _br(lim.date()), "tom": ""}

        def nota(l: dict) -> str:
            return f"{float(l['nota']):.1f}".replace(".", ",")

        return {
            "feitas": res["quantidade_realizadas"], "validas": res["quantidade_validas"], "nota_media": res["nota_media"],
            "meta": regras.META_NOTA_PADRAO, "abaixo_meta": len(abaixo),
            "feedbacks_pendentes": [{"operador": l["operador_nome"], "monitoria": f"{_dia(l['data'])} · nota {nota(l)}", "monitor": l["avaliador_nome"], "prazo": prazo(l)} for l in pendentes],
            "contestacoes": [{"operador": l["operador_nome"], "monitoria": f"{_dia(l['data'])} · nota {nota(l)}", "motivo": motivos.get(int(l["id_monitoria"]), "")} for l in contestadas],
            "abaixo": [{"operador": l["operador_nome"], "data": _dia(l["data"]), "nota": nota(l)} for l in sorted(abaixo, key=lambda x: float(x["nota"]))],
        }

    def _pn_bloco_diario(self, cursor, user, ctx: dict) -> dict:
        operacao, ini, fim = ctx["painel"]["operacao"], ctx["ini"], min(ctx["fim"], ctx["hoje"])
        cursor.execute("SELECT OBJECT_ID('dbo.diario_dia', 'U')")
        if cursor.fetchone()[0] is None:
            return {"indisponivel": "O Diário de bordo ainda não foi usado nesta unidade."}
        cursor.execute(
            "SELECT d.id_dia, d.data, t.turno, t.status FROM dbo.diario_dia d LEFT JOIN dbo.diario_turno t ON t.id_dia = d.id_dia "
            "WHERE d.operacao = ? AND d.data BETWEEN ? AND ?",
            (operacao, ini, fim),
        )
        dias: set = set()
        turnos_status: list[tuple[str, str]] = []
        for r in cursor.fetchall():
            dias.add(r[1])
            if r[2]:
                turnos_status.append((normalize_text(r[2]), normalize_text(r[3])))
        so_intercorrencias = not user.has_permission("diario.visualizar")
        cursor.execute(
            "SELECT turno, inicio, ferramenta, descricao FROM dbo.diario_intercorrencia "
            "WHERE operacao = ? AND excluida = 0 AND CAST(inicio AS DATE) BETWEEN ? AND ? ORDER BY inicio DESC",
            (operacao, ini, fim),
        )
        por_turno: dict[str, list[dict]] = {t: [] for t in ROTULO_TURNO_DIARIO}
        total = 0
        for turno, inicio, ferramenta, descricao in cursor.fetchall():
            total += 1
            por_turno.setdefault(normalize_text(turno), []).append({"quando": _br(inicio), "tipo": normalize_text(ferramenta), "descricao": normalize_text(descricao)})
        dias_periodo = (fim - ini).days + 1 if fim >= ini else 0
        concluidos = sum(1 for _t, s in turnos_status if s == "concluido")
        um_dia = ini == fim
        estado_hoje = {t: s for t, s in turnos_status} if um_dia else {}
        return {
            "so_intercorrencias": so_intercorrencias,
            "dias_registrados": len(dias), "dias_periodo": dias_periodo,
            "turnos_fechados": concluidos, "turnos_total": dias_periodo * len(ROTULO_TURNO_DIARIO),
            "intercorrencias": total, "um_dia": um_dia,
            "turnos": [{"turno": t, "rotulo": r, "estado": estado_hoje.get(t, "vazio") if um_dia else None, "itens": por_turno.get(t, [])}
                       for t, r in ROTULO_TURNO_DIARIO.items()],
        }

    def _pn_bloco_operadores(self, cursor, user, ctx: dict) -> dict:
        dado = (ctx.get("wfm") or {}).get("dado")
        por_op = self._pn_agregado(ctx)
        if por_op is None or not dado:
            return self._pn_sem_dado(ctx)
        notas: dict[int, list[float]] = {}
        qtd_mon: Counter = Counter()
        for l in ctx.get("monitorias") or []:
            qtd_mon[int(l["id_operador"])] += 1
            if ind.eh_valida(l):
                notas.setdefault(int(l["id_operador"]), []).append(float(l["nota"]))
        turno: dict[int, str] = {}
        for d in sorted(dado["dias_escala"], key=lambda x: x["data"]):
            if d["trabalha"]:
                turno[d["id_operador"]] = d.get("codigo") or ""
        proximas = self._pn_proximas_folgas(cursor, user, ctx["painel"]["operacao"], ctx["hoje"], set(por_op))
        mostrar_nota = regras.tem_base(regras.METRICAS["monitorias"], set(user.permissions))
        linhas = []
        for id_op, v in sorted(por_op.items(), key=lambda x: x[1]["operador"]):
            apurados = v["presentes"] + v["faltas"] + v["justificadas"] + v["atestados"]
            ns = notas.get(id_op) or []
            linhas.append({
                "id_operador": id_op, "nome": v["operador"], "equipe": v["equipe"], "turno": turno.get(id_op, ""),
                "dias_trabalhados": v["presentes"], "presenca_pct": regras.pct(v["presentes"], apurados), "faltas": v["faltas"] + v["justificadas"],
                "nota_media": round(sum(ns) / len(ns), 1) if (ns and mostrar_nota) else None,
                "monitorias": qtd_mon.get(id_op, 0) if mostrar_nota else None, "trocas": v["trocas"], "proxima_folga": proximas.get(id_op),
            })
        return {"linhas": linhas, "mostra_nota": mostrar_nota}

    def _pn_proximas_folgas(self, cursor, user, operacao: str, hoje: date, ids: set[int]) -> dict[int, str]:
        """Próxima folga de cada um nos próximos 31 dias (escala publicada)."""
        try:
            futuro = self._wfm_rel_coletar(cursor, user, operacao, hoje, hoje + timedelta(days=31), None)
        except HTTPException:
            return {}
        saida: dict[int, str] = {}
        for d in sorted(futuro["dias_escala"], key=lambda x: x["data"]):
            if not d["trabalha"] and d["id_operador"] in ids and d["id_operador"] not in saida:
                saida[d["id_operador"]] = "Hoje" if d["data"] == hoje else d["data"].isoformat()
        return saida

    # ------------------------------------------------------------------ ficha do operador
    def painel_ficha(self, user, id_painel: int, id_operador: int, periodo: str = "mes") -> dict:
        periodo = periodo if periodo in regras.PERIODOS else "mes"
        hoje = _hoje()
        ini, fim = regras.intervalo_do_periodo(periodo, hoje)
        mes_ini = hoje.replace(day=1)
        mes_fim = (mes_ini + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        conn, cursor = self._pn_abrir()
        try:
            painel = self._pn_exigir_painel(cursor, user, id_painel)
            if not any(m["metrica"] == "operadores" for m in self._pn_metricas_liberadas(user, painel)):
                raise _http(status.HTTP_403_FORBIDDEN, "Este painel não mostra a lista de operadores para o seu perfil.")
            operacao = self._wfm_exigir_operacao(cursor, user, painel["operacao"])
            conn.commit()
            dado = self._wfm_rel_coletar(cursor, user, operacao, ini, fim, int(id_operador))
            if not dado["operadores"]:
                raise _http(status.HTTP_404_NOT_FOUND, "Operador não encontrado nesta unidade ou fora do seu escopo.")
            op = dado["operadores"][0]
            v = self._wfm_rel_agregar(dado)[int(id_operador)]
            mes = self._wfm_rel_coletar(cursor, user, operacao, mes_ini, mes_fim, int(id_operador))
            dias_mes = {d["data"]: d for d in mes["dias_escala"]}
            calendario = []
            for n in range((mes_fim - mes_ini).days + 1):
                d = mes_ini + timedelta(days=n)
                esc = dias_mes.get(d)
                pres = mes["presencas"].get((int(id_operador), d))
                if pres and pres["status"] in SIGLA:
                    sigla = SIGLA[pres["status"]]
                elif esc and not esc["trabalha"]:
                    sigla = "FL"
                elif esc and esc["trabalha"]:
                    sigla = (esc.get("codigo") or "T") if d >= hoje else "·"
                else:
                    sigla = ""
                calendario.append({"data": d.isoformat(), "sigla": sigla, "futuro": d > hoje, "hoje": d == hoje, "status": pres["status"] if pres else None})
            # Hoje: 1º login no Conecta (presença automática; senão o último acesso do dia) e pausas PREVISTAS.
            entrada = None
            cursor.execute(
                "SELECT MIN(criado_em) FROM dbo.wfm_auditoria WHERE acao = 'presenca_automatica' AND operacao = ? AND id_usuario = ? "
                "AND criado_em >= ? AND criado_em < ?",
                (operacao, int(id_operador), hoje, hoje + timedelta(days=1)),
            )
            r = cursor.fetchone()
            if r and r[0]:
                entrada = r[0].strftime("%H:%M")
            else:
                cursor.execute("SELECT ultimo_acesso_em FROM dbo.usuarios WHERE id_usuario = ? AND ultimo_acesso_em >= ?", (int(id_operador), hoje))
                r = cursor.fetchone()
                entrada = r[0].strftime("%H:%M") if r and r[0] else None
            pausas = self._wfm_pausas_programadas(cursor, operacao, hoje).get(int(id_operador), [])
            hoje_esc = dias_mes.get(hoje)
            mon = []
            if regras.tem_base(regras.METRICAS["monitorias"], set(user.permissions)):
                linhas = self._mon_linhas_escopo(user, {"operacao": painel["operacao"], "id_operador": int(id_operador), "data_inicio": ini.isoformat(),
                                                       "data_fim": fim.isoformat()}, com_respostas=False)
                notas = [float(l["nota"]) for l in linhas if ind.eh_valida(l)]
                mon = {"media": round(sum(notas) / len(notas), 1) if notas else None, "quantidade": len(linhas),
                       "itens": [{"data": _dia(l["data"]), "monitor": l["avaliador_nome"], "nota": f"{float(l['nota']):.1f}".replace(".", ","),
                                  "feedback": "Aplicado" if l["feedback_aplicado"] else ("Pendente" if l["status"] == wf.FEEDBACK_PENDENTE else wf.ROTULOS_STATUS.get(l["status"], l["status"]))}
                                 for l in linhas[:20]]}
            trocas = [{"dias": f"{_br(t['data_a'])} ⇄ {_br(t['data_b'])}",
                       "com_quem": t["alvo"] if t["id_solicitante"] == int(id_operador) else t["solicitante"], "estado": t["estado"]}
                      for t in dado["trocas"]]
        finally:
            conn.close()
        apurados = v["presentes"] + v["faltas"] + v["justificadas"] + v["atestados"]
        datas_falta = sorted(d for (i, d), p in dado["presencas"].items() if i == int(id_operador) and p["status"] in ("FALTA", "FALTA_JUSTIFICADA"))
        supervisores = ", ".join(s["nome"] for s in op.get("supervisores") or [])
        return {
            "operador": {"id_usuario": op["id_usuario"], "nome": op["nome"], "equipe": op.get("equipe") or "", "supervisores": supervisores},
            "periodo": {"chave": periodo, "nome": regras.NOME_PERIODO[periodo], "ini": ini.isoformat(), "fim": fim.isoformat()},
            "resumo": {"presenca_pct": regras.pct(v["presentes"], apurados), "presentes": v["presentes"], "apurados": apurados,
                       "faltas": v["faltas"] + v["justificadas"], "datas_falta": [_br(d) for d in datas_falta]},
            "hoje": {"entrada": entrada, "turno": (hoje_esc or {}).get("codigo") if hoje_esc and hoje_esc["trabalha"] else None,
                     "entrada_prevista": (hoje_esc or {}).get("entrada"), "saida_prevista": (hoje_esc or {}).get("saida"),
                     "pausas": [{"inicio": p["inicio"], "duracao_min": p["duracao_min"]} for p in pausas]},
            "mes": {"ini": mes_ini.isoformat(), "dias": calendario},
            "monitorias": mon or None, "trocas": trocas,
        }

    # ------------------------------------------------------------------ configuração (Tecnologia)
    def painel_config(self, user) -> dict:
        conn, cursor = self._pn_abrir()
        try:
            paineis = self._pn_paineis(cursor)
            col_modulo = "modulo" if self._pn_tem_coluna(cursor, "operacoes", "modulo") else "NULL"
            cursor.execute(f"SELECT chave, nome, ativo, {col_modulo} FROM dbo.operacoes ORDER BY nome")
            unidades = [{"chave": normalize_text(r[0]), "nome": normalize_text(r[1]), "ativo": bool(r[2]), "modulo": normalize_text(r[3]) or regras.MODULO_OPERACAO}
                        for r in cursor.fetchall()]
            cursor.execute("SELECT id_perfil, nome FROM dbo.perfis WHERE ativo = 1 ORDER BY nome")
            perfis = [{"id": normalize_text(r[0]), "nome": normalize_text(r[1])} for r in cursor.fetchall()]
        finally:
            conn.close()
        if not perfis:
            perfis = [{"id": p, "nome": get_role_definition(p).name} for p in sorted({x for pn in paineis for x in pn["perfis"]})]
        for p in paineis:
            p["sem_funcao"] = [m.id for m in regras.metricas_do_modulo(p["modulo"])
                               if m.funcao and not acesso.funcao_ligada_na_unidade(m.funcao, p["operacao"], p["modulo"])]
        return {
            "paineis": paineis,
            "metricas": [{"id": m.id, "nome": m.nome, "descricao": m.descricao, "modulo": m.modulo, "funcao": m.funcao, "area": m.area,
                          "formas": [{"id": f, "nome": regras.NOME_FORMA[f]} for f in m.formas]} for m in regras.METRICAS.values()],
            "modulos": [{"chave": k, "nome": regras.NOME_MODULO[k]} for k in regras.MODULOS_DO_PAINEL],
            "unidades": unidades, "perfis": perfis, "intervalos": list(regras.INTERVALOS_SEG),
        }

    @staticmethod
    def _pn_tem_coluna(cursor, tabela: str, coluna: str) -> bool:
        cursor.execute("SELECT COL_LENGTH(?, ?)", (f"dbo.{tabela}", coluna))
        return cursor.fetchone()[0] is not None

    def painel_salvar(self, user, id_painel: int | None, dados: dict) -> dict:
        modulo = normalize_text(dados.get("modulo"))
        operacao = normalize_text(dados.get("operacao"))
        if modulo not in regras.MODULOS_DO_PAINEL:
            raise _http(status.HTTP_400_BAD_REQUEST, "Escolha o módulo do painel.")
        if not operacao:
            raise _http(status.HTTP_400_BAD_REQUEST, "Escolha a unidade (operação ou setor) do painel.")
        intervalo = int(dados.get("intervalo_seg") or regras.INTERVALO_PADRAO)
        if intervalo not in regras.INTERVALOS_SEG:
            raise _http(status.HTTP_400_BAD_REQUEST, "Intervalo de atualização inválido.")
        try:
            metricas = regras.metricas_validas(modulo, list(dados.get("metricas") or []))
        except ValueError as exc:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        if not metricas:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ligue pelo menos uma métrica.")
        perfis = sorted({normalize_text(p) for p in (dados.get("perfis") or []) if normalize_text(p)})
        ativo = bool(dados.get("ativo", True))
        conn, cursor = self._pn_abrir()
        try:
            cursor.execute("SELECT 1 FROM dbo.operacoes WHERE chave = ?", (operacao,))
            if not cursor.fetchone():
                raise _http(status.HTTP_404_NOT_FOUND, "Unidade não encontrada.")
            if perfis:
                cursor.execute(f"SELECT id_perfil FROM dbo.perfis WHERE id_perfil IN ({','.join('?' for _ in perfis)})", tuple(perfis))
                existentes = {normalize_text(r[0]) for r in cursor.fetchall()}
                faltam = [p for p in perfis if p not in existentes]
                if faltam:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Perfil desconhecido: {', '.join(faltam)}.")
            cursor.execute("SELECT id_painel FROM dbo.painel WHERE modulo = ? AND operacao = ?", (modulo, operacao))
            r = cursor.fetchone()
            if r and (id_painel is None or int(r[0]) != int(id_painel)):
                raise _http(status.HTTP_409_CONFLICT, "Já existe um painel para este módulo e esta unidade. Edite o que já existe.")
            antes = None
            quem = _nome(user)
            if id_painel is None:
                cursor.execute(
                    "INSERT INTO dbo.painel (modulo, operacao, ativo, intervalo_seg, criado_por, atualizado_por, atualizado_em) "
                    "OUTPUT INSERTED.id_painel VALUES (?, ?, ?, ?, ?, ?, SYSDATETIME())",
                    (modulo, operacao, 1 if ativo else 0, intervalo, quem, quem),
                )
                id_painel = int(cursor.fetchone()[0])
                acao = "criar"
            else:
                atuais = self._pn_paineis(cursor, int(id_painel))
                if not atuais:
                    raise _http(status.HTTP_404_NOT_FOUND, "Painel não encontrado.")
                antes = {k: atuais[0][k] for k in ("modulo", "operacao", "ativo", "intervalo_seg", "metricas", "perfis")}
                cursor.execute(
                    "UPDATE dbo.painel SET modulo = ?, operacao = ?, ativo = ?, intervalo_seg = ?, atualizado_por = ?, atualizado_em = SYSDATETIME() WHERE id_painel = ?",
                    (modulo, operacao, 1 if ativo else 0, intervalo, quem, int(id_painel)),
                )
                cursor.execute("DELETE FROM dbo.painel_metrica WHERE id_painel = ?", (int(id_painel),))
                cursor.execute("DELETE FROM dbo.painel_perfil WHERE id_painel = ?", (int(id_painel),))
                acao = "editar"
            for m in metricas:
                cursor.execute("INSERT INTO dbo.painel_metrica (id_painel, metrica, forma, ordem) VALUES (?, ?, ?, ?)", (int(id_painel), m["metrica"], m["forma"], m["ordem"]))
            for p in perfis:
                cursor.execute("INSERT INTO dbo.painel_perfil (id_painel, id_perfil) VALUES (?, ?)", (int(id_painel), p))
            depois = {"modulo": modulo, "operacao": operacao, "ativo": ativo, "intervalo_seg": intervalo, "metricas": metricas, "perfis": perfis}
            cursor.execute(
                "INSERT INTO dbo.painel_alteracao (id_painel, acao, antes, depois, usuario_id, usuario_nome) VALUES (?, ?, ?, ?, ?, ?)",
                (int(id_painel), acao, json.dumps(antes, ensure_ascii=False) if antes else None, json.dumps(depois, ensure_ascii=False), getattr(user, "id_usuario", None), quem),
            )
            conn.commit()
            salvo = self._pn_paineis(cursor, int(id_painel))[0]
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        limpar_cache()
        return salvo
