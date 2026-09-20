"""Monitoria — análise e saída: dashboard, relatórios, exportação/e-mail, logs,
guia, configurações e identidade por operação (promt.txt §5.15–5.21, §4).

Tudo usa o motor único `services/monitoria_indicadores` e o mesmo escopo
(`_mon_condicoes_escopo`) das consultas — nenhum indicador é recalculado por
fora e nada é devolvido fora do escopo do perfil."""

from __future__ import annotations

import base64
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPERVISOR, get_role_definition, get_role_permissions
from ..services import monitoria_indicadores as ind
from ..services import monitoria_workflow as wf
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_engine import FAIXAS_PADRAO, config_padrao
from ..services.monitoria_export import gerar_csv, gerar_xlsx, sim_nao
from ..services.monitoria_scope import operacoes_permitidas, pode_ver_detalhe_monitoria
from ..services.monitoria_tema import derivar_tokens, validar_cor_primaria
from ..services.training_uploads import CATEGORIA_IMAGEM, save_training_upload, validate_training_upload
from .monitoria import _http, _iso, _json
from .monitoria_org import GUIA_PADRAO

SUBPASTA_LOGOS = "monitoria-logos"
MAX_LOGO_MB = 1
MAX_LINHAS_EXPORT = 20000


class MonitoriaAnaliseRepositoryMixin:
    # ------------------------------------------------------------------
    # Carregamento de linhas (mesmo escopo das consultas)
    # ------------------------------------------------------------------
    def _mon_where_filtros(self, filtros: dict, condicoes: list[str], params: list, alias: str = "m") -> None:
        if normalize_text(filtros.get("operacao")):
            condicoes.append(f"{alias}.operacao = ?")
            params.append(normalize_text(filtros["operacao"]))
        for chave, coluna in (("id_equipe", "id_equipe"), ("id_operador", "id_operador"), ("id_avaliador", "id_avaliador")):
            if filtros.get(chave):
                condicoes.append(f"{alias}.{coluna} = ?")
                params.append(int(filtros[chave]))
        if normalize_text(filtros.get("data_inicio")):
            condicoes.append(f"CAST({alias}.data_monitoria AS DATE) >= ?")
            params.append(normalize_text(filtros["data_inicio"])[:10])
        if normalize_text(filtros.get("data_fim")):
            condicoes.append(f"CAST({alias}.data_monitoria AS DATE) <= ?")
            params.append(normalize_text(filtros["data_fim"])[:10])

    def _mon_linhas(self, cursor, condicoes: list[str], params: list, *, com_respostas: bool = True) -> list[dict]:
        where = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
        base = "FROM dbo.monitorias m JOIN dbo.monitoria_estado e ON e.id_monitoria = m.id_monitoria"
        cursor.execute(
            f"""
            SELECT m.id_monitoria, m.codigo, m.operacao, m.operacao_nome, m.id_equipe, m.equipe_nome, m.turno, m.id_operador,
                   m.operador_nome, m.id_avaliador, m.avaliador_nome, m.data_monitoria, m.data_contato, m.nota, m.nivel, m.possui_ncg,
                   m.anulada, m.canal, m.tipo_atendimento, e.status, e.resultado, e.sla_limite,
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.monitoria_feedbacks f WHERE f.id_monitoria = m.id_monitoria) THEN 1 ELSE 0 END AS feedback_aplicado,
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.monitoria_contestacoes c WHERE c.id_monitoria = m.id_monitoria) THEN 1 ELSE 0 END AS contestada,
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.monitoria_planos_acao p WHERE p.id_monitoria = m.id_monitoria) THEN 1 ELSE 0 END AS tem_plano
            {base} {where}
            ORDER BY m.data_monitoria DESC, m.id_monitoria DESC
            """,
            tuple(params),
        )
        linhas = []
        for r in rows_to_dicts(cursor, cursor.fetchall()):
            linhas.append(
                {
                    "id_monitoria": r["id_monitoria"], "codigo": r["codigo"], "operacao": normalize_text(r["operacao"]),
                    "operacao_nome": normalize_text(r["operacao_nome"]), "id_equipe": r["id_equipe"],
                    "equipe_nome": normalize_text(r["equipe_nome"]), "turno": normalize_text(r["turno"]),
                    "id_operador": r["id_operador"], "operador_nome": normalize_text(r["operador_nome"]),
                    "id_avaliador": r["id_avaliador"], "avaliador_nome": normalize_text(r["avaliador_nome"]),
                    "data": r["data_monitoria"], "data_contato": r["data_contato"], "nota": float(r["nota"]),
                    "nivel": normalize_text(r["nivel"]), "possui_ncg": bool(r["possui_ncg"]), "anulada": bool(r["anulada"]),
                    "canal": normalize_text(r["canal"]), "tipo_atendimento": normalize_text(r["tipo_atendimento"]),
                    "status": normalize_text(r["status"]), "resultado": normalize_text(r["resultado"]), "sla_limite": r["sla_limite"],
                    "feedback_aplicado": bool(r["feedback_aplicado"]), "contestada": bool(r["contestada"]), "tem_plano": bool(r["tem_plano"]),
                    "pilares": {"conhecimento": {}, "encantamento": {}}, "respostas": [],
                }
            )
        if not linhas:
            return linhas
        indice = {l["id_monitoria"]: l for l in linhas}
        where_join = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
        cursor.execute(
            f"SELECT x.id_monitoria, x.tipo, x.indicador, x.nota FROM dbo.monitoria_pilares x "
            f"JOIN dbo.monitorias m ON m.id_monitoria = x.id_monitoria JOIN dbo.monitoria_estado e ON e.id_monitoria = m.id_monitoria {where_join}",
            tuple(params),
        )
        for id_m, tipo, indicador, nota in cursor.fetchall():
            if id_m in indice:
                indice[id_m]["pilares"][normalize_text(tipo)][normalize_text(indicador)] = int(nota)
        if com_respostas:
            cursor.execute(
                f"SELECT x.id_monitoria, x.id_bloco, x.bloco_nome, x.bloco_status, x.id_criterio, x.pergunta, x.peso, x.resposta "
                f"FROM dbo.monitoria_respostas x JOIN dbo.monitorias m ON m.id_monitoria = x.id_monitoria "
                f"JOIN dbo.monitoria_estado e ON e.id_monitoria = m.id_monitoria {where_join}",
                tuple(params),
            )
            for id_m, id_b, nome_b, st_b, id_c, pergunta, peso, resposta in cursor.fetchall():
                if id_m in indice:
                    indice[id_m]["respostas"].append(
                        {"id_bloco": normalize_text(id_b), "bloco_nome": normalize_text(nome_b), "bloco_status": normalize_text(st_b),
                         "id_criterio": normalize_text(id_c), "pergunta": normalize_text(pergunta), "peso": float(peso), "resposta": normalize_text(resposta)}
                    )
        return linhas

    def _mon_linhas_escopo(self, user, filtros: dict, *, so_operacao: bool = False, com_respostas: bool = True) -> list[dict]:
        """`so_operacao=True`: linhas de TODA a operação permitida (base do consolidado
        do Supervisor, do Top N e da média da operação do Operador) — nunca devolvidas cruas."""
        if so_operacao:
            permitidas = operacoes_permitidas(user.perfil, user.operacoes)
            condicoes: list[str] = []
            params: list = []
            if permitidas is not None:
                if not permitidas:
                    return []
                condicoes.append(f"m.operacao IN ({','.join('?' for _ in permitidas)})")
                params.extend(sorted(permitidas))
        else:
            escopo = self._mon_condicoes_escopo(user)
            if escopo is None:
                return []
            condicoes, params = escopo
        self._mon_where_filtros({k: v for k, v in filtros.items() if not (so_operacao and k in ("id_operador", "id_equipe"))}, condicoes, params)
        conn = self._connect()
        try:
            return self._mon_linhas(conn.cursor(), condicoes, params, com_respostas=com_respostas)
        finally:
            conn.close()

    def _mon_faixas(self, operacao: str = "") -> list[dict]:
        if operacao:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT v.config_json FROM dbo.monitoria_matrizes m JOIN dbo.monitoria_matriz_versoes v ON v.id_versao = m.id_versao_ativa WHERE m.operacao = ?",
                    (operacao,),
                )
                row = cursor.fetchone()
                if row:
                    return json.loads(row[0]).get("faixas") or FAIXAS_PADRAO
            finally:
                conn.close()
        return FAIXAS_PADRAO

    # ------------------------------------------------------------------
    # Dashboard (4 modos: geral, equipe, período, operador)
    # ------------------------------------------------------------------
    def mon_dashboard(self, user, filtros: dict | None = None, *, modo: str = "geral", top: int = 5, granularidade: str = "mes") -> dict:
        filtros = dict(filtros or {})
        modo = modo if modo in ("geral", "equipe", "periodo", "operador") else "geral"
        granularidade = granularidade if granularidade in ind.GRANULARIDADES else "mes"
        top = int(top) if int(top or 0) in ind.TOPS_PERMITIDOS else 5
        faixas = self._mon_faixas(normalize_text(filtros.get("operacao")))
        linhas = self._mon_linhas_escopo(user, filtros)
        agora = datetime.now()
        resposta: dict = {
            "modo": modo, "filtros": filtros, "granularidade": granularidade, "top_n": top, "faixas": faixas,
            "resumo": ind.resumo(linhas, faixas=faixas, agora=agora),
            "evolucao": ind.evolucao(linhas, granularidade),
            "desempenho_blocos": ind.desempenho_por_bloco(linhas),
            "criterios_erro": ind.criterios_com_maior_erro(linhas, 10),
            "por_operacao": ind.agrupar(linhas, "operacao", faixas=faixas),
            "por_equipe": ind.agrupar(linhas, "equipe", faixas=faixas),
            "por_operador": ind.agrupar(linhas, "operador", faixas=faixas),
            "papel": user.perfil,
        }
        if user.perfil == ROLE_OPERATOR:
            # Operador: os próprios dados + apenas a MÉDIA da operação (sem rankings/nomes).
            base = self._mon_linhas_escopo(user, {k: v for k, v in filtros.items() if k not in ("id_operador", "id_equipe")}, so_operacao=True, com_respostas=False)
            validas = [float(l["nota"]) for l in base if ind.eh_valida(l)]
            media_op = round(sum(validas) / len(validas), 2) if validas else None
            resposta["por_equipe"], resposta["por_operador"] = [], []
            resposta["media_operacao"] = media_op
            resposta["escala"] = {
                "faixas": faixas, "nota_operador": resposta["resumo"]["nota_media"], "media_operacao": media_op,
                "faixa_operador": resposta["resumo"]["faixa"],
            }
            resposta["top"] = []
        else:
            base_op = linhas
            if user.perfil == ROLE_SUPERVISOR:
                # Detalhe só da(s) própria(s) equipe(s); visão geral consolidada da operação inteira.
                base_op = self._mon_linhas_escopo(user, filtros, so_operacao=True)
                resposta["visao_operacao"] = ind.resumo(base_op, faixas=faixas, agora=agora)
                resposta["visao_operacao"].pop("distribuicao_faixas", None)
            resposta["top"] = ind.top_n(base_op, top)
            if user.perfil == ROLE_SUPERVISOR:
                resposta["por_operacao"] = ind.agrupar(base_op, "operacao", faixas=faixas)
        return resposta

    # ------------------------------------------------------------------
    # Relatórios (mesmo motor; base do XLSX/CSV)
    # ------------------------------------------------------------------
    def mon_relatorio(self, user, tipo: str, filtros: dict | None = None) -> dict:
        filtros = dict(filtros or {})
        if tipo == "planos":
            dados = self.mon_plano_listar(user, filtros, por_pagina=MAX_LINHAS_EXPORT)["itens"]
            colunas = ["OPERAÇÃO", "OPERADOR", "ORIGEM", "RESPONSÁVEL", "PROBLEMA", "CRITÉRIO", "OBJETIVO", "AÇÃO", "PRAZO", "STATUS",
                       "DATA_REVISÃO", "RESULTADO", "OBSERVAÇÕES", "NOTA_ANTES", "NOTA_DEPOIS", "VENCIDO"]
            linhas = [[p["operacao_nome"] or p["operacao"], p["operador_nome"], p["origem"], p["responsavel"], p["problema"], p["criterio"],
                       p["objetivo"], p["acao"], p["prazo"], p["status_rotulo"], p["data_revisao"], p["resultado"], p["observacoes"],
                       p["nota_antes"], p["nota_depois"], sim_nao(p["vencido"])] for p in dados]
            return {"tipo": tipo, "colunas": colunas, "linhas": linhas}
        linhas_base = self._mon_linhas_escopo(user, filtros, com_respostas=False)
        if tipo == "monitorias":
            colunas = ["ID_MONITORIA", "DATA_MONITORIA", "DATA_CONTATO", "OPERADOR", "EQUIPE", "OPERAÇÃO", "AVALIADOR", "NOTA", "NCG",
                       "FEEDBACK_APLICADO", "CONTESTAÇÃO", "ANULADA", "CONFIRMAÇÃO", "PL_AÇÃO", "STATUS"]
            linhas = []
            for l in linhas_base:
                anulada = not ind.eh_valida(l)
                confirmada = l["resultado"] == wf.RESULTADO_CONFIRMADA
                linhas.append([l["codigo"], _iso(l["data"]), _iso(l["data_contato"]), l["operador_nome"], l["equipe_nome"],
                               l["operacao_nome"] or l["operacao"], l["avaliador_nome"], l["nota"], sim_nao(l["possui_ncg"]),
                               sim_nao(l["feedback_aplicado"]), sim_nao(l["contestada"]), sim_nao(anulada), sim_nao(confirmada),
                               sim_nao(l["tem_plano"]), wf.ROTULOS_STATUS.get(l["status"], l["status"])])
            return {"tipo": tipo, "colunas": colunas, "linhas": linhas}
        if tipo == "qualidade":
            inicio = normalize_text(filtros.get("data_inicio"))[:10] or (min((_iso(l["data"])[:10] for l in linhas_base), default=""))
            fim = normalize_text(filtros.get("data_fim"))[:10] or (max((_iso(l["data"])[:10] for l in linhas_base), default=""))
            linhas_base_p = self._mon_linhas_escopo(user, filtros, com_respostas=False)
            grupos = ind.agrupar(linhas_base_p, "operador")
            operacao_de = {l["id_operador"]: l["operacao_nome"] or l["operacao"] for l in linhas_base_p}
            equipe_de = {l["id_operador"]: l["equipe_nome"] for l in linhas_base_p}
            colunas = ["PERIODO_INICIAL", "PERIODO_FINAL", "OPERAÇÃO", "EQUIPE", "OPERADOR", "NOTA_PERIODO", "QNT_MONITORIAS",
                       "QNT_VÁLIDAS", "NCG", "PILAR_CONHECIMENTO", "PILAR_ENCANTAMENTO"]
            linhas = [[inicio, fim, operacao_de.get(g["chave"], ""), equipe_de.get(g["chave"], ""), g["rotulo"], g["nota_media"],
                       g["quantidade_realizadas"], g["quantidade_validas"], g["ncg"], g["pilar_conhecimento"], g["pilar_encantamento"]] for g in grupos]
            return {"tipo": tipo, "colunas": colunas, "linhas": linhas}
        raise _http(status.HTTP_404_NOT_FOUND, "Relatório não encontrado.")

    def mon_exportar(self, user, tipo: str, formato: str, filtros: dict | None = None, *, ip: str = "") -> tuple[bytes, str, str]:
        relatorio = self.mon_relatorio(user, tipo, filtros)
        if len(relatorio["linhas"]) > MAX_LINHAS_EXPORT:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Refine os filtros: o relatório excede o limite de linhas.")
        carimbo = datetime.now().strftime("%Y%m%d_%H%M%S")
        nomes = {"monitorias": "monitorias", "qualidade": "qualidade", "planos": "planos_de_acao"}
        formato = normalize_text(formato).lower()
        if formato == "csv":
            conteudo, mime, ext = gerar_csv(relatorio["colunas"], relatorio["linhas"]), "text/csv; charset=utf-8", "csv"
        elif formato == "xlsx":
            conteudo = gerar_xlsx([{"nome": nomes.get(tipo, tipo).title(), "colunas": relatorio["colunas"], "linhas": relatorio["linhas"]}])
            mime, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        else:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Formato inválido (use xlsx ou csv).")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self.mon_log(cursor, user, acao="exportar_relatorio", operacao=normalize_text((filtros or {}).get("operacao")), entidade=tipo,
                         detalhes={"formato": formato, "linhas": len(relatorio["linhas"]), "filtros": filtros}, ip=ip)
            conn.commit()
        finally:
            conn.close()
        return conteudo, f"monitoria_{nomes.get(tipo, tipo)}_{carimbo}.{ext}", mime

    def _mon_xlsx_monitorias(self, user, ids: list[int]) -> tuple[bytes, list[dict]]:
        """XLSX de monitorias individuais (resumo, critérios, pilares, linha do tempo).
        Cada id passa pela checagem de escopo do detalhe (404 fora dele)."""
        detalhes = [self.mon_detalhe(user, str(i)) for i in ids]
        resumo_linhas, criterios_linhas, pilares_linhas, tempo_linhas = [], [], [], []
        for d in detalhes:
            resumo_linhas.append([d["codigo"], d["operacao_nome"], d["equipe_nome"], d["operador_nome"], d["avaliador_nome"],
                                  d["data_contato"], d["data_monitoria"], d["canal"], d["tipo_atendimento"], d["nota"], d["nivel"],
                                  sim_nao(d["possui_ncg"]), d["motivo_ncg"], d["numero_versao"], d["status_rotulo"], d["observacao"],
                                  d["sugestao_feedback"]])
            for bloco in d["config"]["blocos"]:
                for c in bloco["criterios"]:
                    criterios_linhas.append([d["codigo"], bloco["nome"], c["texto"], c["peso"], d["respostas"].get(c["id"], "")])
            for tipo, notas in d["pilares"].items():
                for indicador, nota in notas.items():
                    pilares_linhas.append([d["codigo"], tipo.title(), indicador, nota])
            for e in d["eventos"]:
                tempo_linhas.append([d["codigo"], e["em"], e["para_rotulo"], e["usuario"], "Automático" if e["automatico"] else "", e["observacao"]])
        conteudo = gerar_xlsx([
            {"nome": "Resumo", "colunas": ["ID", "OPERAÇÃO", "EQUIPE", "OPERADOR", "AVALIADOR", "DATA_CONTATO", "DATA_MONITORIA", "CANAL", "TIPO",
                                            "NOTA", "NÍVEL", "NCG", "MOTIVO_NCG", "VERSÃO_MATRIZ", "STATUS", "OBSERVAÇÃO", "SUGESTÃO_FEEDBACK"], "linhas": resumo_linhas},
            {"nome": "Critérios", "colunas": ["ID", "BLOCO", "CRITÉRIO", "PESO", "RESPOSTA"], "linhas": criterios_linhas},
            {"nome": "Pilares", "colunas": ["ID", "PILAR", "INDICADOR", "NOTA"], "linhas": pilares_linhas},
            {"nome": "Linha do tempo", "colunas": ["ID", "QUANDO", "STATUS", "QUEM", "AUTOMÁTICO", "OBSERVAÇÃO"], "linhas": tempo_linhas},
        ])
        return conteudo, detalhes

    def mon_exportar_monitorias(self, user, ids: list[int], *, ip: str = "") -> tuple[bytes, str, str]:
        if not ids:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Selecione ao menos uma monitoria.")
        conteudo, detalhes = self._mon_xlsx_monitorias(user, [int(i) for i in ids][:500])
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self.mon_log(cursor, user, acao="exportar_monitorias", entidade="monitoria",
                         detalhes={"codigos": [d["codigo"] for d in detalhes]}, ip=ip)
            conn.commit()
        finally:
            conn.close()
        nome = f"monitoria_{detalhes[0]['codigo']}.xlsx" if len(detalhes) == 1 else f"monitorias_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return conteudo, nome, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def mon_compartilhar(self, user, ids: list[int], destinatarios: list[int], mensagem: str = "", *, ip: str = "") -> dict:
        """Compartilha por e-mail (anexo XLSX): destinatários só entre usuários ativos do Conecta que
        PODEM ver TODAS as monitorias enviadas; quem envia só compartilha o que pode ver."""
        if not ids or not destinatarios:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Selecione as monitorias e os destinatários.")
        conteudo, detalhes = self._mon_xlsx_monitorias(user, [int(i) for i in ids][:100])
        conn = self._connect()
        try:
            cursor = conn.cursor()
            emails = []
            for id_dest in {int(d) for d in destinatarios}:
                cursor.execute("SELECT nome, email, perfil_id, status FROM dbo.usuarios WHERE id_usuario = ?", (id_dest,))
                u = cursor.fetchone()
                if not u or normalize_text(u[3]).lower() != "ativo":
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Destinatário inválido ou inativo.")
                perfil = get_role_definition(u[2]).id
                cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_dest,))
                ops = [normalize_text(r[0]) for r in cursor.fetchall()]
                supervisionados = set()
                if perfil == ROLE_SUPERVISOR:
                    cursor.execute("SELECT id_operador FROM dbo.usuarios_supervisores WHERE id_supervisor = ?", (id_dest,))
                    supervisionados = {int(r[0]) for r in cursor.fetchall()}
                if "monitoria.visualizar" not in get_role_permissions(perfil):
                    raise _http(status.HTTP_403_FORBIDDEN, f"{normalize_text(u[0])} não tem acesso à Monitoria.")
                for d in detalhes:
                    if not pode_ver_detalhe_monitoria(perfil=perfil, id_usuario=id_dest, operacoes_usuario=ops, operacao=d["operacao"],
                                                      id_operador=int(d["id_operador"]), operadores_supervisionados=supervisionados):
                        raise _http(status.HTTP_403_FORBIDDEN, f"{normalize_text(u[0])} não tem permissão para ver a monitoria #{d['codigo']}.")
                emails.append(normalize_text(u[1]))
        finally:
            conn.close()
        from ..services.email_send_service import EmailSendService

        servico = EmailSendService(self.settings)
        if not servico.configured:
            raise _http(status.HTTP_503_SERVICE_UNAVAILABLE, "O envio de e-mail ainda não está configurado no Conecta.")
        import html as _html

        corpo = (f"<p>{_html.escape(normalize_text(user.nome))} compartilhou {len(detalhes)} monitoria(s) com você pelo Conecta.</p>"
                 + (f"<p>{_html.escape(normalize_text(mensagem))}</p>" if normalize_text(mensagem) else "") + "<p>Os detalhes estão na planilha anexa.</p>")
        servico.send_mail(
            destinatarios=emails, assunto=f"Monitoria: {len(detalhes)} monitoria(s) compartilhada(s)", corpo_html=corpo,
            anexos=[{"nome": "monitorias.xlsx", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     "conteudo_base64": base64.b64encode(conteudo).decode("ascii")}],
        )
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self.mon_log(cursor, user, acao="compartilhar_email", entidade="monitoria",
                         detalhes={"codigos": [d["codigo"] for d in detalhes], "destinatarios": sorted(emails)}, ip=ip)
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "enviados": len(emails)}

    def mon_destinatarios_elegiveis(self, user, ids: list[int]) -> list[dict]:
        """Usuários ativos que PODEM ver todas as monitorias informadas (base do
        seletor de destinatários do compartilhamento por e-mail)."""
        detalhes = [self.mon_detalhe(user, str(i)) for i in ids[:100]]
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_usuario, nome, sobrenome, email, perfil_id FROM dbo.usuarios WHERE status = 'Ativo' ORDER BY nome")
            usuarios = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT id_usuario, operacao FROM dbo.usuarios_operacoes")
            ops: dict[int, list[str]] = {}
            for id_u, operacao in cursor.fetchall():
                ops.setdefault(int(id_u), []).append(normalize_text(operacao))
            cursor.execute("SELECT id_supervisor, id_operador FROM dbo.usuarios_supervisores")
            sup: dict[int, set[int]] = {}
            for id_s, id_o in cursor.fetchall():
                sup.setdefault(int(id_s), set()).add(int(id_o))
        finally:
            conn.close()
        elegiveis = []
        for u in usuarios:
            perfil = get_role_definition(u["perfil_id"]).id
            if "monitoria.visualizar" not in get_role_permissions(perfil) or int(u["id_usuario"]) == user.id_usuario:
                continue
            id_u = int(u["id_usuario"])
            if all(
                pode_ver_detalhe_monitoria(perfil=perfil, id_usuario=id_u, operacoes_usuario=ops.get(id_u, []), operacao=d["operacao"],
                                           id_operador=int(d["id_operador"]), operadores_supervisionados=sup.get(id_u, set()))
                for d in detalhes
            ):
                elegiveis.append({"id_usuario": id_u, "nome": " ".join(x for x in (normalize_text(u["nome"]), normalize_text(u.get("sobrenome"))) if x),
                                  "email": normalize_text(u["email"]), "perfil": get_role_definition(perfil).name})
        return elegiveis

    # ------------------------------------------------------------------
    # Logs (imutáveis) — Adm: tudo; Supervisor: só o escopo das suas operações
    # ------------------------------------------------------------------
    def mon_logs(self, user, filtros: dict | None = None, *, pagina: int = 1, por_pagina: int = 50) -> dict:
        filtros = filtros or {}
        condicoes: list[str] = []
        params: list = []
        if user.perfil != ROLE_ADMIN:
            permitidas = operacoes_permitidas(user.perfil, user.operacoes)
            if not permitidas:
                return {"itens": [], "total": 0, "pagina": 1, "por_pagina": por_pagina}
            condicoes.append(f"operacao IN ({','.join('?' for _ in permitidas)})")
            params.extend(sorted(permitidas))
        for chave, coluna in (("acao", "acao"), ("entidade", "entidade"), ("operacao", "operacao"), ("resultado", "resultado"), ("perfil", "perfil")):
            if normalize_text(filtros.get(chave)):
                condicoes.append(f"{coluna} = ?")
                params.append(normalize_text(filtros[chave]))
        if normalize_text(filtros.get("usuario")):
            condicoes.append("usuario_nome LIKE ?")
            params.append(f"%{normalize_text(filtros['usuario'])}%")
        if normalize_text(filtros.get("data_inicio")):
            condicoes.append("CAST(criado_em AS DATE) >= ?")
            params.append(normalize_text(filtros["data_inicio"])[:10])
        if normalize_text(filtros.get("data_fim")):
            condicoes.append("CAST(criado_em AS DATE) <= ?")
            params.append(normalize_text(filtros["data_fim"])[:10])
        where = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
        pagina = max(1, int(pagina))
        por_pagina = self._clamp_limit(por_pagina, 50, 500)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) FROM dbo.monitoria_logs {where}", tuple(params))
            total = int(cursor.fetchone()[0])
            cursor.execute(
                f"SELECT id_log, usuario_nome, perfil, operacao, acao, modulo, entidade, entidade_id, ip, resultado, detalhes, estado_anterior, "
                f"estado_posterior, criado_em FROM dbo.monitoria_logs {where} ORDER BY id_log DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",
                (*params, (pagina - 1) * por_pagina, por_pagina),
            )
            itens = [
                {"id_log": r["id_log"], "usuario": normalize_text(r["usuario_nome"]), "perfil": normalize_text(r["perfil"]),
                 "operacao": normalize_text(r["operacao"]), "acao": normalize_text(r["acao"]), "entidade": normalize_text(r["entidade"]),
                 "entidade_id": normalize_text(r["entidade_id"]), "ip": normalize_text(r["ip"]), "resultado": normalize_text(r["resultado"]),
                 "detalhes": normalize_text(r["detalhes"]), "estado_anterior": normalize_text(r["estado_anterior"]),
                 "estado_posterior": normalize_text(r["estado_posterior"]), "em": _iso(r["criado_em"])}
                for r in rows_to_dicts(cursor, cursor.fetchall())
            ]
            return {"itens": itens, "total": total, "pagina": pagina, "por_pagina": por_pagina}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Guia de processos e configurações
    # ------------------------------------------------------------------
    def mon_guia_listar(self, *, incluir_inativos: bool = False) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT id_guia, titulo, conteudo, ordem, ativo FROM dbo.monitoria_guia {'' if incluir_inativos else 'WHERE ativo = 1'} ORDER BY ordem, id_guia"
            )
            return [{"id_guia": r[0], "titulo": normalize_text(r[1]), "conteudo": normalize_text(r[2]), "ordem": r[3], "ativo": bool(r[4])} for r in cursor.fetchall()]
        finally:
            conn.close()

    def mon_guia_salvar(self, user, dados: dict, id_guia: int | None = None, *, ip: str = "") -> dict:
        titulo, conteudo = normalize_text(dados.get("titulo")), normalize_text(dados.get("conteudo"))
        if not titulo or not conteudo:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o título e o conteúdo.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if id_guia:
                cursor.execute("UPDATE dbo.monitoria_guia SET titulo = ?, conteudo = ?, ordem = ?, ativo = ?, atualizado_em = GETDATE() WHERE id_guia = ?",
                               (titulo, conteudo, int(dados.get("ordem") or 0), 1 if dados.get("ativo", True) else 0, int(id_guia)))
                resolved = int(id_guia)
            else:
                cursor.execute("INSERT INTO dbo.monitoria_guia (titulo, conteudo, ordem, ativo) OUTPUT INSERTED.id_guia VALUES (?, ?, ?, ?)",
                               (titulo, conteudo, int(dados.get("ordem") or 0), 1 if dados.get("ativo", True) else 0))
                resolved = int(cursor.fetchone()[0])
            self.mon_log(cursor, user, acao="salvar_guia", entidade="guia", entidade_id=resolved, ip=ip)
            conn.commit()
            return {"success": True, "id_guia": resolved}
        finally:
            conn.close()

    def mon_config_obter(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            limiar = int(self._mon_config_valor(cursor, "limiar_alerta_pct", "75"))
        finally:
            conn.close()
        return {"limiar_alerta_pct": limiar, "prazos_oficiais_horas": dict(wf.HORAS_SLA_OFICIAIS),
                "prazos_editaveis": False}

    def mon_config_salvar(self, user, dados: dict, *, ip: str = "") -> dict:
        limiar = int(dados.get("limiar_alerta_pct") or 0)
        if limiar < 10 or limiar > 99:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O limiar de alerta deve ficar entre 10% e 99% do prazo.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            anterior = self._mon_config_valor(cursor, "limiar_alerta_pct", "75")
            cursor.execute("UPDATE dbo.monitoria_config SET valor = ?, atualizado_em = GETDATE() WHERE chave = 'limiar_alerta_pct'", (str(limiar),))
            self.mon_log(cursor, user, acao="alterar_limiar_alerta", entidade="config", anterior=anterior, posterior=limiar, ip=ip)
            conn.commit()
            return {"success": True, "limiar_alerta_pct": limiar}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Zona de risco — só CONFIGURAÇÃO, nunca histórico (imutabilidade)
    # ------------------------------------------------------------------
    def mon_risco_executar(self, user, acao: str, operacao: str, confirmacao: str, justificativa: str, *, ip: str = "") -> dict:
        if normalize_text(confirmacao) != normalize_text(operacao) or len(normalize_text(justificativa)) < 5:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY,
                        "Confirme digitando a chave da operação e informe uma justificativa (mín. 5 caracteres).")
        operacao = normalize_text(operacao)
        if acao == "restaurar_matriz":
            res = self.mon_save_versao(user, operacao, config_padrao(), f"Restauração do padrão: {normalize_text(justificativa)}", ip=ip)
            return {"success": True, "acao": acao, "nova_versao": res["numero"]}
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if acao == "remover_identidade":
                self._mon_exigir_operacao_ativa(cursor, operacao)
                cursor.execute("UPDATE dbo.operacoes SET cor_primaria = NULL, logo_arquivo = NULL WHERE chave = ?", (operacao,))
            elif acao == "redefinir_guia":
                cursor.execute("UPDATE dbo.monitoria_guia SET ativo = 0")
                for ordem, (titulo, conteudo) in enumerate(GUIA_PADRAO, start=1):
                    cursor.execute("INSERT INTO dbo.monitoria_guia (titulo, conteudo, ordem) VALUES (?, ?, ?)", (titulo, conteudo, ordem))
            elif acao == "desativar_operacao":
                cursor.execute("UPDATE dbo.operacoes SET ativo = 0, atualizado_em = GETDATE() WHERE chave = ? AND ativo = 1", (operacao,))
                if cursor.rowcount == 0:
                    raise _http(status.HTTP_409_CONFLICT, "A operação já está inativa ou não existe.")
            else:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ação de risco inválida.")
            self.mon_log(cursor, user, acao=f"risco_{acao}", operacao=operacao, entidade="operacao", entidade_id=operacao,
                         detalhes={"justificativa": normalize_text(justificativa)}, ip=ip)
            conn.commit()
            return {"success": True, "acao": acao}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Identidade visual por operação (cor primária e logo — só Administrador)
    # ------------------------------------------------------------------
    def mon_identidade_listar(self, user) -> list[dict]:
        itens = []
        for op in self.mon_operacoes_do_usuario(user):
            tokens = derivar_tokens(op["cor_primaria"]) if op["cor_primaria"] else None
            itens.append({**op, "tokens": tokens})
        return itens

    def mon_identidade_salvar(self, user, operacao: str, cor: str, *, ip: str = "") -> dict:
        operacao = normalize_text(operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._mon_exigir_operacao_ativa(cursor, operacao)
            if not normalize_text(cor):
                nova = None
            else:
                nova, erros = validar_cor_primaria(cor)
                if erros:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, " ".join(erros))
            cursor.execute("SELECT cor_primaria FROM dbo.operacoes WHERE chave = ?", (operacao,))
            anterior = cursor.fetchone()[0]
            cursor.execute("UPDATE dbo.operacoes SET cor_primaria = ?, atualizado_em = GETDATE() WHERE chave = ?", (nova, operacao))
            self.mon_log(cursor, user, acao="alterar_cor_operacao", operacao=operacao, entidade="operacao", entidade_id=operacao,
                         anterior=anterior, posterior=nova, ip=ip)
            conn.commit()
            return {"success": True, "cor_primaria": nova, "tokens": derivar_tokens(nova) if nova else None}
        finally:
            conn.close()

    def mon_logo_salvar(self, user, operacao: str, *, nome: str, conteudo: bytes, ip: str = "") -> dict:
        operacao = normalize_text(operacao)
        validado = validate_training_upload(original_filename=nome, content=conteudo, categoria=CATEGORIA_IMAGEM, max_bytes=MAX_LOGO_MB * 1024 * 1024)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._mon_exigir_operacao_ativa(cursor, operacao)
            caminho = save_training_upload(validado, upload_dir=self.settings.training_upload_dir, subpasta=SUBPASTA_LOGOS)
            cursor.execute("UPDATE dbo.operacoes SET logo_arquivo = ?, atualizado_em = GETDATE() WHERE chave = ?", (caminho.name, operacao))
            self.mon_log(cursor, user, acao="alterar_logo_operacao", operacao=operacao, entidade="operacao", entidade_id=operacao,
                         posterior=caminho.name, ip=ip)
            conn.commit()
            return {"success": True, "logo_arquivo": caminho.name}
        finally:
            conn.close()

    def mon_logo_arquivo(self, arquivo: str) -> tuple[Path, str]:
        """Logo pública por nome aleatório (uma tag <img> não envia o Bearer)."""
        arquivo = normalize_text(arquivo)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT TOP 1 1 FROM dbo.operacoes WHERE logo_arquivo = ?", (arquivo,))
            if not cursor.fetchone():
                raise _http(status.HTTP_404_NOT_FOUND, "Logo não encontrada.")
        finally:
            conn.close()
        caminho = Path(self.settings.training_upload_dir) / SUBPASTA_LOGOS / arquivo
        if not caminho.exists():
            raise _http(status.HTTP_404_NOT_FOUND, "Logo não encontrada.")
        return caminho, "image/png" if arquivo.endswith(".png") else "image/jpeg"
