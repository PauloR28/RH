"""Diário de bordo (08/nov/2026): registro do dia da operação por turno. Ver services/diario_regras.py (regras puras) e
repositories/diario_schema.py (V068).

Regras de acesso (todas no servidor):
  * escopo de operação = `user.allows_operacao` (sem operação atribuída vê tudo, como no resto do Conecta);
  * `diario.visualizar` lê tudo; `diario.intercorrencias` (Qualidade) lê só as intercorrências;
  * `diario.preencher` escreve; `diario.reabrir` reabre (com motivo); `diario.administrar` mexe nas listas e importa.
Toda criação/edição/conclusão/reabertura/exportação grava `diario_alteracao` (antes -> depois).
Concorrência: cada turno tem `versao`; quem salva com versão velha recebe 409 com o nome de quem salvou antes.
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

import pyodbc
from fastapi import HTTPException, status

from ..rbac import ACCESS_DENIED_MESSAGE
from ..services import diario_regras as r
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.wfm_historico import FUSO_BRASIL
from .diario_schema import ensure_diario_schema

VERSAO_TERMOS = "2026-11-08"
MINUTOS_EDITANDO = 2  # "Fulano está editando": vale enquanto a pessoa salvou/abriu o turno nos últimos 2 minutos


def _nome(user) -> str:
    return (" ".join(p for p in (normalize_text(getattr(user, "nome", "")), normalize_text(getattr(user, "sobrenome", ""))) if p)
            or normalize_text(getattr(user, "username", "")))


def _hoje() -> date:
    return datetime.now(FUSO_BRASIL).date()


def _agora() -> datetime:
    return datetime.now(FUSO_BRASIL).replace(tzinfo=None, microsecond=0)


def _iso(valor: Any) -> Any:
    if isinstance(valor, datetime):
        return valor.replace(microsecond=0).isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, time):
        return valor.strftime("%H:%M")
    if isinstance(valor, Decimal):
        return float(valor)
    return valor


def _limpo(linha: dict) -> dict:
    return {k: _iso(v) for k, v in linha.items()}


def _data(texto: Any) -> date:
    try:
        return date.fromisoformat(str(texto or "").strip()[:10])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data inválida (use AAAA-MM-DD).") from exc


def _momento(texto: Any, campo: str) -> datetime:
    try:
        return datetime.fromisoformat(str(texto or "").strip()[:16]).replace(second=0, microsecond=0)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{campo}: data e hora inválidas.") from exc


def _txt(valor: Any, limite: int) -> str | None:
    t = str(valor or "").strip()
    return t[:limite] if t else None


def _json(valor: Any) -> str:
    return json.dumps(valor, ensure_ascii=False, default=str)


def _vazio(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return "—" if v is None or v == "" else str(v)


def _conflito(detalhe: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalhe)


class DiarioRepositoryMixin:
    # ------------------------------------------------------------------ infraestrutura
    def _db_garantir_schema(self, cursor) -> None:
        """Se a V068 ainda não rodou neste ambiente (servidor ligado antes do deploy), aplica na primeira necessidade."""
        if getattr(type(self), "_diario_v068_ok", False):
            return
        cursor.execute("SELECT OBJECT_ID('dbo.diario_aceite', 'U'), OBJECT_ID('dbo.diario_cadastro', 'U')")
        if any(v is None for v in cursor.fetchone()):
            ensure_diario_schema(cursor)
            cursor.connection.commit()
        type(self)._diario_v068_ok = True

    def _db_abrir(self):
        conn = self._connect()
        cursor = conn.cursor()
        self._db_garantir_schema(cursor)
        return conn, cursor

    def _db_operacoes_do_diario(self, cursor, user) -> list[dict]:
        """Operações que têm Diário de bordo (alguma lista cadastrada) e estão no escopo do usuário."""
        cursor.execute(
            "SELECT o.chave, o.nome FROM dbo.operacoes o WHERE o.ativo = 1 "
            "AND EXISTS (SELECT 1 FROM dbo.diario_cadastro c WHERE c.operacao = o.chave) ORDER BY o.nome"
        )
        return [{"chave": normalize_text(c), "nome": normalize_text(n)} for c, n in cursor.fetchall() if user.allows_operacao(normalize_text(c))]

    def _db_exigir_operacao(self, cursor, user, operacao: str) -> str:
        chave = normalize_text(operacao)
        if not chave or not any(o["chave"] == chave for o in self._db_operacoes_do_diario(cursor, user)):
            if chave and not user.allows_operacao(chave):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta operação está fora do seu escopo de acesso.")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Esta operação não tem Diário de bordo.")
        return chave

    def _db_alteracao(self, cursor, user, *, dia: dict | None, operacao: str, entidade: str, acao: str, turno: str | None = None,
                      campo: str | None = None, antes: Any = None, depois: Any = None, motivo: str | None = None) -> None:
        cursor.execute(
            "INSERT INTO dbo.diario_alteracao (id_dia, operacao, data, turno, entidade, acao, campo, antes, depois, motivo, usuario_id, usuario_nome) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                dia["id_dia"] if dia else None, operacao, dia["data"] if dia else None, turno, entidade, acao, campo,
                None if antes is None else (antes if isinstance(antes, str) else _json(antes)),
                None if depois is None else (depois if isinstance(depois, str) else _json(depois)),
                motivo, getattr(user, "id_usuario", None), _nome(user),
            ),
        )

    def _db_cadastros(self, cursor, operacao: str) -> list[dict]:
        cursor.execute(
            "SELECT id_item, tipo, nome, chave_prototipo, ordem, ativo FROM dbo.diario_cadastro WHERE operacao = ? ORDER BY tipo, ordem, nome",
            (operacao,),
        )
        return [{**_limpo(x), "ativo": bool(x["ativo"])} for x in rows_to_dicts(cursor, cursor.fetchall())]

    def _db_dia_linha(self, cursor, operacao: str, data: date) -> dict | None:
        cursor.execute("SELECT * FROM dbo.diario_dia WHERE operacao = ? AND data = ?", (operacao, data))
        linhas = rows_to_dicts(cursor, cursor.fetchall())
        return linhas[0] if linhas else None

    def _db_criar_dia(self, cursor, user, operacao: str, data: date, importado: bool = False) -> dict:
        try:
            cursor.execute(
                "INSERT INTO dbo.diario_dia (operacao, data, importado, criado_por) VALUES (?, ?, ?, ?)",
                (operacao, data, 1 if importado else 0, _nome(user)),
            )
        except pyodbc.IntegrityError:
            cursor.connection.rollback()  # outra pessoa abriu o mesmo dia no mesmo instante: usa o dela
            dia = self._db_dia_linha(cursor, operacao, data)
            if dia:
                return dia
            raise
        dia = self._db_dia_linha(cursor, operacao, data)
        for t in r.TURNOS:
            cursor.execute("INSERT INTO dbo.diario_turno (id_dia, turno) VALUES (?, ?)", (dia["id_dia"], t))
        if not importado:
            self._db_alteracao(cursor, user, dia=dia, operacao=operacao, entidade="dia", acao="criou")
        return dia

    def _db_dia_por_id(self, cursor, user, id_dia: int) -> dict:
        cursor.execute("SELECT * FROM dbo.diario_dia WHERE id_dia = ?", (id_dia,))
        linhas = rows_to_dicts(cursor, cursor.fetchall())
        if not linhas:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dia do diário não encontrado.")
        dia = linhas[0]
        if not user.allows_operacao(dia["operacao"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta operação está fora do seu escopo de acesso.")
        return dia

    def _db_turno_por_id(self, cursor, user, id_turno: int) -> tuple[dict, dict]:
        cursor.execute("SELECT * FROM dbo.diario_turno WHERE id_turno = ?", (id_turno,))
        linhas = rows_to_dicts(cursor, cursor.fetchall())
        if not linhas:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turno não encontrado.")
        return linhas[0], self._db_dia_por_id(cursor, user, linhas[0]["id_dia"])

    @staticmethod
    def _db_exigir_dia_aberto(dia: dict) -> None:
        if dia["status"] == "encerrado":
            raise _conflito("Este dia já foi encerrado e está travado. Para corrigir, quem tem permissão reabre o dia com motivo.")

    def _db_turnos_do_dia(self, cursor, id_dia: int) -> dict[str, dict]:
        cursor.execute("SELECT * FROM dbo.diario_turno WHERE id_dia = ?", (id_dia,))
        turnos = {x["turno"]: x for x in rows_to_dicts(cursor, cursor.fetchall())}
        ids = [t["id_turno"] for t in turnos.values()]
        demandas: dict[int, dict] = {i: {} for i in ids}
        ns: dict[int, dict] = {i: {} for i in ids}
        if ids:
            marc = ",".join("?" for _ in ids)
            cursor.execute(f"SELECT id_turno, id_item, inicio, fim FROM dbo.diario_demanda WHERE id_turno IN ({marc})", ids)
            for id_turno, id_item, ini, fim in cursor.fetchall():
                demandas[id_turno][int(id_item)] = (ini, fim)
            cursor.execute(f"SELECT id_turno, id_item, valor FROM dbo.diario_nivel_servico WHERE id_turno IN ({marc})", ids)
            for id_turno, id_item, valor in cursor.fetchall():
                ns[id_turno][int(id_item)] = None if valor is None else float(valor)
        for t in turnos.values():
            t["_demandas"] = demandas[t["id_turno"]]
            t["_ns"] = ns[t["id_turno"]]
        return turnos

    def _db_presenca_do_dia(self, cursor, operacao: str, data: date) -> dict:
        # As escalas de uma operação podem ter chave própria ("CRF::ESCALA-CRF"): o ABS soma a operação e todas as escalas
        # dela. Cada operador conta uma vez no dia (se aparecer em mais de uma escala, vale o status mais "presente").
        try:
            cursor.execute(
                "SELECT id_operador, status FROM dbo.wfm_presencas WHERE data = ? AND (operacao = ? OR operacao LIKE ?)",
                (data, operacao, f"{operacao}::%"),
            )
            ordem = {s: i for i, s in enumerate((*r.PRESENCA_PRESENTE, *r.PRESENCA_JUSTIFICADA, *r.PRESENCA_FALTA))}
            por_operador: dict[int, str] = {}
            for id_operador, status_op in cursor.fetchall():
                atual = por_operador.get(int(id_operador))
                if atual is None or ordem.get(status_op, 99) < ordem.get(atual, 99):
                    por_operador[int(id_operador)] = status_op
            status_dia = list(por_operador.values())
        except pyodbc.Error:  # WFM ausente no ambiente: ABS fica sem presença (não inventa número)
            status_dia = []
        return {**r.abs_da_presenca(status_dia), "lancamentos": len(status_dia)}

    def _db_correcoes_abs(self, cursor, id_dia: int) -> list[dict]:
        cursor.execute(
            "SELECT id_correcao, origem, presenca_json, corrigido_json, motivo, corrigido_por, corrigido_em FROM dbo.diario_abs_correcao "
            "WHERE id_dia = ? ORDER BY id_correcao DESC",
            (id_dia,),
        )
        saida = []
        for x in rows_to_dicts(cursor, cursor.fetchall()):
            saida.append({**_limpo(x), "presenca_json": None, "corrigido_json": None,
                          "presenca": json.loads(x["presenca_json"]) if x["presenca_json"] else None,
                          "corrigido": json.loads(x["corrigido_json"])})
        return saida

    def _db_intercorrencias(self, cursor, *, operacao: str, id_dia: int | None = None, data: date | None = None) -> list[dict]:
        """Intercorrências do dia + as que ficaram em aberto de dias anteriores ("passa para o dia seguinte")."""
        if id_dia is not None:
            cursor.execute(
                "SELECT i.*, d.data AS data_dia FROM dbo.diario_intercorrencia i JOIN dbo.diario_dia d ON d.id_dia = i.id_dia "
                "WHERE i.operacao = ? AND (i.id_dia = ? OR (i.fim IS NULL AND i.excluida = 0 AND d.data < ?)) ORDER BY i.inicio",
                (operacao, id_dia, data),
            )
        else:
            cursor.execute(
                "SELECT i.*, d.data AS data_dia FROM dbo.diario_intercorrencia i JOIN dbo.diario_dia d ON d.id_dia = i.id_dia "
                "WHERE i.operacao = ? AND i.fim IS NULL AND i.excluida = 0 AND d.data <= ? ORDER BY i.inicio",
                (operacao, data),
            )
        return [{**_limpo(x), "excluida": bool(x["excluida"]), "aberta": x["fim"] is None,
                 "de_outro_dia": id_dia is not None and x["id_dia"] != id_dia} for x in rows_to_dicts(cursor, cursor.fetchall())]

    def _db_parciais(self, cursor, id_dia: int) -> list[dict]:
        cursor.execute("SELECT * FROM dbo.diario_parcial WHERE id_dia = ? AND excluida = 0 ORDER BY hora", (id_dia,))
        saida = []
        for x in rows_to_dicts(cursor, cursor.fetchall()):
            valores = {int(k): v for k, v in json.loads(x["valores_json"] or "{}").items()}
            total = r.soma_ou_vazio(valores.values())
            saida.append({**_limpo(x), "valores_json": None, "valores": valores, "total": total})
        return saida

    def _db_turno_saida(self, t: dict, user) -> dict:
        editando = None
        if (t.get("editando_id") and t["editando_id"] != getattr(user, "id_usuario", None) and t.get("editando_em")
                and t["editando_em"] >= _agora() - timedelta(minutes=MINUTOS_EDITANDO)):
            editando = {"nome": t["editando_por"], "desde": _iso(t["editando_em"])}
        estado = "concluido" if t["status"] == "concluido" else ("rascunho" if t.get("salvo_em") else "vazio")
        if estado == "rascunho" and t.get("reaberto_vezes"):
            estado = "reaberto"
        return {
            "id_turno": t["id_turno"], "turno": t["turno"], "rotulo": r.ROTULO_TURNO[t["turno"]], "status": t["status"], "estado": estado,
            "observacoes": t.get("observacoes") or "", "versao": t["versao"],
            "salvo_por": t.get("salvo_por"), "salvo_em": _iso(t.get("salvo_em")),
            "concluido_por": t.get("concluido_por"), "concluido_em": _iso(t.get("concluido_em")),
            "reaberto_vezes": t.get("reaberto_vezes") or 0, "editando": editando,
            "demandas": {str(k): {"inicio": a, "fim": b, "tratadas": r.tratadas(a, b)} for k, (a, b) in t["_demandas"].items()},
            "ns": {str(k): v for k, v in t["_ns"].items()},
        }

    def _db_montar_dia(self, cursor, user, operacao: str, data: date, dia: dict | None) -> dict:
        cadastros = self._db_cadastros(cursor, operacao)
        presenca = self._db_presenca_do_dia(cursor, operacao, data)
        saida: dict[str, Any] = {
            "operacao": operacao, "data": data.isoformat(), "hoje": _hoje().isoformat(), "turno_atual": r.turno_pela_hora(_agora()),
            "cadastros": cadastros, "dia": None, "turnos": [], "intercorrencias": [], "parciais": [], "abs": None,
            "consolidado": None, "passagem_anterior": None,
        }
        # Passagem do dia anterior (aparece no topo do dia seguinte).
        cursor.execute(
            "SELECT TOP 1 data, encerramento_tipo, passagem, encerrado_por, encerrado_em FROM dbo.diario_dia "
            "WHERE operacao = ? AND data < ? AND status = 'encerrado' ORDER BY data DESC",
            (operacao, data),
        )
        ant = rows_to_dicts(cursor, cursor.fetchall())
        if ant and ant[0]["data"] == data - timedelta(days=1):
            saida["passagem_anterior"] = _limpo(ant[0])
        if not dia:
            saida["abs"] = {"presenca": presenca, "vigente": r.abs_vigente(presenca, None), "correcoes": []}
            saida["intercorrencias"] = self._db_intercorrencias(cursor, operacao=operacao, data=data - timedelta(days=1)) if data <= _hoje() else []
            for x in saida["intercorrencias"]:
                x["de_outro_dia"] = True
            return saida
        turnos = self._db_turnos_do_dia(cursor, dia["id_dia"])
        ids_dem = [c["id_item"] for c in cadastros if c["tipo"] == "demanda" and (c["ativo"] or any(c["id_item"] in t["_demandas"] for t in turnos.values()))]
        ids_ns = [c["id_item"] for c in cadastros if c["tipo"] == "canal_ns" and (c["ativo"] or any(c["id_item"] in t["_ns"] for t in turnos.values()))]
        consolidado = r.consolidar_dia(
            {t: {"demandas": x["_demandas"], "ns": x["_ns"]} for t, x in turnos.items() if x.get("salvo_em")}, ids_dem, ids_ns
        )
        correcoes = self._db_correcoes_abs(cursor, dia["id_dia"])
        saida.update({
            "dia": {**_limpo(dia), "importado": bool(dia["importado"])},
            "turnos": [self._db_turno_saida(turnos[t], user) for t in r.TURNOS if t in turnos],
            "intercorrencias": self._db_intercorrencias(cursor, operacao=operacao, id_dia=dia["id_dia"], data=data),
            "parciais": self._db_parciais(cursor, dia["id_dia"]),
            "abs": {"presenca": presenca, "vigente": r.abs_vigente(presenca, correcoes[0]["corrigido"] if correcoes else None), "correcoes": correcoes},
            "consolidado": consolidado,
            "ids_demanda": ids_dem, "ids_ns": ids_ns,
        })
        return saida

    # ------------------------------------------------------------------ contexto e termos (D8)
    def diario_contexto(self, user) -> dict:
        conn, cursor = self._db_abrir()
        try:
            cursor.execute("SELECT aceito_em FROM dbo.diario_aceite WHERE username = ? AND versao_termos = ?", (user.username, VERSAO_TERMOS))
            aceite = cursor.fetchone()
            return {
                "operacoes": self._db_operacoes_do_diario(cursor, user), "hoje": _hoje().isoformat(), "turno_atual": r.turno_pela_hora(_agora()),
                "termos_versao": VERSAO_TERMOS, "termos_aceitos_em": _iso(aceite[0]) if aceite else None,
                "pode": {
                    "ver": user.has_permission("diario.visualizar"), "intercorrencias": user.has_any_permission("diario.visualizar", "diario.intercorrencias"),
                    "preencher": user.has_permission("diario.preencher"), "reabrir": user.has_permission("diario.reabrir"),
                    "exportar": user.has_permission("diario.exportar"), "administrar": user.has_permission("diario.administrar"),
                },
            }
        finally:
            conn.close()

    def diario_aceitar_termos(self, user, ip: str = "") -> dict:
        conn, cursor = self._db_abrir()
        try:
            cursor.execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.diario_aceite WHERE username = ? AND versao_termos = ?) "
                "INSERT INTO dbo.diario_aceite (username, id_usuario, versao_termos, ip) VALUES (?, ?, ?, ?)",
                (user.username, VERSAO_TERMOS, user.username, getattr(user, "id_usuario", None), VERSAO_TERMOS, (ip or "")[:64]),
            )
            conn.commit()
            cursor.execute("SELECT aceito_em FROM dbo.diario_aceite WHERE username = ? AND versao_termos = ?", (user.username, VERSAO_TERMOS))
            return {"termos_versao": VERSAO_TERMOS, "termos_aceitos_em": _iso(cursor.fetchone()[0])}
        finally:
            conn.close()

    def _db_exigir_aceite(self, cursor, user) -> None:
        cursor.execute("SELECT 1 FROM dbo.diario_aceite WHERE username = ? AND versao_termos = ?", (user.username, VERSAO_TERMOS))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_428_PRECONDITION_REQUIRED, detail="Aceite os termos de uso do Diário de bordo para continuar.")

    # ------------------------------------------------------------------ dia
    def diario_dia(self, user, operacao: str, data_txt: str) -> dict:
        data = _data(data_txt)
        conn, cursor = self._db_abrir()
        try:
            operacao = self._db_exigir_operacao(cursor, user, operacao)
            dia = self._db_dia_linha(cursor, operacao, data)
            # Quem preenche abre o dia ao entrar nele (hoje ou dias passados); dia futuro nunca é criado.
            if not dia and data <= _hoje() and user.has_permission("diario.preencher"):
                self._db_exigir_aceite(cursor, user)
                dia = self._db_criar_dia(cursor, user, operacao, data)
                conn.commit()
            if not user.has_permission("diario.visualizar"):
                if not user.has_permission("diario.intercorrencias"):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCESS_DENIED_MESSAGE)
                # Qualidade: só as intercorrências (sem demandas, NS, ABS nem passagem).
                cad = [c for c in self._db_cadastros(cursor, operacao) if c["tipo"] == "ferramenta"]
                interc = (self._db_intercorrencias(cursor, operacao=operacao, id_dia=dia["id_dia"], data=data) if dia else [])
                return {"operacao": operacao, "data": data.isoformat(), "hoje": _hoje().isoformat(), "so_intercorrencias": True,
                        "cadastros": cad, "intercorrencias": [x for x in interc if not x["excluida"]]}
            return self._db_montar_dia(cursor, user, operacao, data, dia)
        finally:
            conn.close()

    # ------------------------------------------------------------------ turno
    def diario_marcar_edicao(self, user, id_turno: int, forcar: bool = False) -> dict:
        """Abre o turno para edição. Se outra pessoa está editando, só entra com `forcar` (fica no histórico)."""
        conn, cursor = self._db_abrir()
        try:
            turno, dia = self._db_turno_por_id(cursor, user, id_turno)
            saida = self._db_turno_saida({**turno, "_demandas": {}, "_ns": {}}, user)
            if saida["editando"] and not forcar:
                return {"ok": False, "editando": saida["editando"]}
            if saida["editando"] and forcar:
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="turno", acao="editou_mesmo_assim", turno=turno["turno"],
                                   motivo=f"{saida['editando']['nome']} estava editando")
            cursor.execute("UPDATE dbo.diario_turno SET editando_por = ?, editando_id = ?, editando_em = SYSDATETIME() WHERE id_turno = ?",
                           (_nome(user), getattr(user, "id_usuario", None), id_turno))
            conn.commit()
            return {"ok": True, "editando": None}
        finally:
            conn.close()

    def diario_salvar_turno(self, user, id_turno: int, versao: int, demandas: list[dict], ns: list[dict], observacoes: str | None) -> dict:
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            turno, dia = self._db_turno_por_id(cursor, user, id_turno)
            self._db_exigir_dia_aberto(dia)
            if turno["status"] == "concluido":
                raise _conflito(f"O turno {r.ROTULO_TURNO[turno['turno']]} já foi concluído e está só leitura. Para mudar, reabra com motivo.")
            if int(versao) != int(turno["versao"]):
                raise _conflito(f"{turno.get('salvo_por') or 'Outra pessoa'} salvou este turno às {_iso(turno.get('salvo_em'))[11:16] if turno.get('salvo_em') else '—'}. "
                                "Recarregue para ver a versão atual; nada do que você digitou foi gravado.")
            cad = {c["id_item"]: c for c in self._db_cadastros(cursor, dia["operacao"])}
            atual = self._db_turnos_do_dia(cursor, dia["id_dia"])[turno["turno"]]
            nome_t = turno["turno"]
            for d in demandas:
                id_item = int(d.get("id_item") or 0)
                if cad.get(id_item, {}).get("tipo") != "demanda":
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de demanda desconhecido.")
                novo = (r.numero_ou_vazio(d.get("inicio")), r.numero_ou_vazio(d.get("fim")))
                antigo = atual["_demandas"].get(id_item)
                if antigo == novo or (antigo is None and novo == (None, None)):
                    continue
                cursor.execute(
                    "IF EXISTS (SELECT 1 FROM dbo.diario_demanda WHERE id_turno = ? AND id_item = ?) "
                    "UPDATE dbo.diario_demanda SET inicio = ?, fim = ? WHERE id_turno = ? AND id_item = ? "
                    "ELSE INSERT INTO dbo.diario_demanda (id_turno, id_item, inicio, fim) VALUES (?, ?, ?, ?)",
                    (id_turno, id_item, novo[0], novo[1], id_turno, id_item, id_turno, id_item, novo[0], novo[1]),
                )
                ant = antigo or (None, None)
                for k, rot in ((0, "início do turno"), (1, "fim do turno")):
                    if ant[k] != novo[k]:
                        self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="demanda", acao="alterou", turno=nome_t,
                                           campo=f"{cad[id_item]['nome']} · {rot}", antes=_vazio(ant[k]), depois=_vazio(novo[k]))
            for n in ns:
                id_item = int(n.get("id_item") or 0)
                if cad.get(id_item, {}).get("tipo") != "canal_ns":
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Canal de nível de serviço desconhecido.")
                try:
                    novo_v = r.percentual_ou_vazio(n.get("valor"))
                except ValueError as exc:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{cad[id_item]['nome']}: {exc}") from exc
                antigo_v = atual["_ns"].get(id_item)
                if antigo_v == novo_v or (id_item not in atual["_ns"] and novo_v is None):
                    continue
                cursor.execute(
                    "IF EXISTS (SELECT 1 FROM dbo.diario_nivel_servico WHERE id_turno = ? AND id_item = ?) "
                    "UPDATE dbo.diario_nivel_servico SET valor = ? WHERE id_turno = ? AND id_item = ? "
                    "ELSE INSERT INTO dbo.diario_nivel_servico (id_turno, id_item, valor) VALUES (?, ?, ?)",
                    (id_turno, id_item, novo_v, id_turno, id_item, id_turno, id_item, novo_v),
                )
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="nivel_servico", acao="alterou", turno=nome_t,
                                   campo=f"Nível de serviço {cad[id_item]['nome']}", antes=_vazio(antigo_v), depois=_vazio(novo_v))
            obs = _txt(observacoes, 1000)
            if (turno.get("observacoes") or None) != obs:
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="turno", acao="alterou", turno=nome_t,
                                   campo="Observações do turno", antes=_vazio(turno.get("observacoes")), depois=_vazio(obs))
            cursor.execute(
                "UPDATE dbo.diario_turno SET observacoes = ?, versao = versao + 1, salvo_por = ?, salvo_por_id = ?, salvo_em = SYSDATETIME(), "
                "editando_por = ?, editando_id = ?, editando_em = SYSDATETIME() WHERE id_turno = ? AND versao = ?",
                (obs, _nome(user), getattr(user, "id_usuario", None), _nome(user), getattr(user, "id_usuario", None), id_turno, int(versao)),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                raise _conflito("Outra pessoa salvou este turno agora há pouco. Recarregue para ver a versão atual; nada do que você digitou foi gravado.")
            conn.commit()
            cursor.execute("SELECT versao, salvo_em FROM dbo.diario_turno WHERE id_turno = ?", (id_turno,))
            v, em = cursor.fetchone()
            return {"versao": v, "salvo_em": _iso(em)}
        finally:
            conn.close()

    def diario_concluir_turno(self, user, id_turno: int, versao: int) -> dict:
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            turno, dia = self._db_turno_por_id(cursor, user, id_turno)
            self._db_exigir_dia_aberto(dia)
            if turno["status"] == "concluido":
                raise _conflito("Este turno já está concluído.")
            if int(versao) != int(turno["versao"]):
                raise _conflito("Este turno mudou desde que você abriu. Recarregue antes de concluir.")
            if not turno.get("salvo_em"):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Preencha e salve o turno antes de concluir.")
            cad = {c["id_item"]: c for c in self._db_cadastros(cursor, dia["operacao"])}
            atual = self._db_turnos_do_dia(cursor, dia["id_dia"])[turno["turno"]]
            linhas = [{"id_item": i, "nome": c["nome"], "inicio": atual["_demandas"].get(i, (None, None))[0], "fim": atual["_demandas"].get(i, (None, None))[1]}
                      for i, c in cad.items() if c["tipo"] == "demanda" and (c["ativo"] or i in atual["_demandas"])]
            ok, motivo = r.pode_concluir_turno(r.avisos_do_turno(linhas), turno.get("observacoes"))
            if not ok:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=motivo)
            cursor.execute(
                "UPDATE dbo.diario_turno SET status = 'concluido', concluido_por = ?, concluido_em = SYSDATETIME(), versao = versao + 1, "
                "editando_por = NULL, editando_id = NULL, editando_em = NULL WHERE id_turno = ? AND versao = ?",
                (_nome(user), id_turno, int(versao)),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                raise _conflito("Este turno mudou desde que você abriu. Recarregue antes de concluir.")
            self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="turno", acao="concluiu", turno=turno["turno"])
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()

    def diario_reabrir_turno(self, user, id_turno: int, motivo: str) -> dict:
        motivo = _txt(motivo, 1000)
        if not motivo:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escreva o motivo para reabrir.")
        conn, cursor = self._db_abrir()
        try:
            turno, dia = self._db_turno_por_id(cursor, user, id_turno)
            if turno["status"] != "concluido":
                raise _conflito("Este turno não está concluído.")
            if dia["status"] == "encerrado":
                cursor.execute("UPDATE dbo.diario_dia SET status = 'aberto', versao = versao + 1, atualizado_por = ?, atualizado_em = SYSDATETIME() WHERE id_dia = ?",
                               (_nome(user), dia["id_dia"]))
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="dia", acao="reabriu", motivo=motivo)
            cursor.execute(
                "UPDATE dbo.diario_turno SET status = 'rascunho', reaberto_vezes = reaberto_vezes + 1, versao = versao + 1 WHERE id_turno = ?",
                (id_turno,),
            )
            self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="turno", acao="reabriu", turno=turno["turno"], motivo=motivo)
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------ encerramento do dia (D6)
    def diario_salvar_encerramento(self, user, id_dia: int, versao: int, tipo: str | None, passagem: str | None, encerrar: bool) -> dict:
        if tipo is not None and tipo not in r.ENCERRAMENTOS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Escolha como o dia termina.")
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            dia = self._db_dia_por_id(cursor, user, id_dia)
            self._db_exigir_dia_aberto(dia)
            if int(versao) != int(dia["versao"]):
                raise _conflito(f"{dia.get('atualizado_por') or 'Outra pessoa'} mudou o encerramento agora há pouco. Recarregue para ver.")
            passagem = _txt(passagem, 2000)
            if encerrar:
                turnos = self._db_turnos_do_dia(cursor, id_dia)
                ok, motivo = r.pode_encerrar_dia({t: x["status"] for t, x in turnos.items()})
                if not ok:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=motivo)
                if not tipo:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escolha como o dia termina antes de encerrar.")
            for campo, rot, antes, depois in (("encerramento_tipo", "Como o dia termina", dia.get("encerramento_tipo"), tipo),
                                              ("passagem", "Passagem para o próximo dia", dia.get("passagem"), passagem)):
                if (antes or None) != (depois or None):
                    self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="encerramento", acao="alterou", campo=rot,
                                       antes=_vazio(r.ROTULO_ENCERRAMENTO.get(antes, antes)), depois=_vazio(r.ROTULO_ENCERRAMENTO.get(depois, depois)))
            cursor.execute(
                "UPDATE dbo.diario_dia SET encerramento_tipo = ?, passagem = ?, versao = versao + 1, atualizado_por = ?, atualizado_em = SYSDATETIME()"
                + (", status = 'encerrado', encerrado_por = ?, encerrado_em = SYSDATETIME()" if encerrar else "")
                + " WHERE id_dia = ? AND versao = ?",
                (tipo, passagem, _nome(user), *((_nome(user),) if encerrar else ()), id_dia, int(versao)),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                raise _conflito("O encerramento mudou agora há pouco. Recarregue para ver.")
            if encerrar:
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="dia", acao="encerrou")
            conn.commit()
            return {"ok": True, "versao": int(dia["versao"]) + 1}
        finally:
            conn.close()

    def diario_reabrir_dia(self, user, id_dia: int, motivo: str) -> dict:
        motivo = _txt(motivo, 1000)
        if not motivo:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escreva o motivo para reabrir.")
        conn, cursor = self._db_abrir()
        try:
            dia = self._db_dia_por_id(cursor, user, id_dia)
            if dia["status"] != "encerrado":
                raise _conflito("Este dia não está encerrado.")
            cursor.execute("UPDATE dbo.diario_dia SET status = 'aberto', versao = versao + 1, atualizado_por = ?, atualizado_em = SYSDATETIME() WHERE id_dia = ?",
                           (_nome(user), id_dia))
            self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="dia", acao="reabriu", motivo=motivo)
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------ ABS (D3)
    def diario_corrigir_abs(self, user, id_dia: int, valores: dict, motivo: str) -> dict:
        motivo = _txt(motivo, 500)
        if not motivo:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O motivo da correção é obrigatório.")
        corrigido = {c: r.numero_ou_vazio(valores.get(c)) for c in r.CAMPOS_ABS}
        if any(v is None for v in corrigido.values()):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Preencha todos os números da correção (use 0 quando não houver).")
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            dia = self._db_dia_por_id(cursor, user, id_dia)
            self._db_exigir_dia_aberto(dia)
            presenca = self._db_presenca_do_dia(cursor, dia["operacao"], dia["data"])
            anteriores = self._db_correcoes_abs(cursor, id_dia)
            antes = anteriores[0]["corrigido"] if anteriores else {c: presenca[c] for c in r.CAMPOS_ABS}
            cursor.execute(
                "INSERT INTO dbo.diario_abs_correcao (id_dia, origem, presenca_json, corrigido_json, motivo, corrigido_por, corrigido_por_id) "
                "VALUES (?, 'correcao', ?, ?, ?, ?, ?)",
                (id_dia, _json({c: presenca[c] for c in (*r.CAMPOS_ABS, "escalados", "abs")}), _json(corrigido), motivo, _nome(user), getattr(user, "id_usuario", None)),
            )
            self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="abs", acao="corrigiu", campo="ABS",
                               antes={**antes, "abs": r.abs_de_contagem(antes)["abs"]}, depois={**corrigido, "abs": r.abs_de_contagem(corrigido)["abs"]}, motivo=motivo)
            conn.commit()
            return {"ok": True, "vigente": r.abs_vigente(presenca, corrigido)}
        finally:
            conn.close()

    # ------------------------------------------------------------------ intercorrências
    def _db_validar_intercorrencia(self, cursor, operacao: str, dados: dict) -> dict:
        id_ferr = int(dados.get("id_ferramenta") or 0)
        cursor.execute("SELECT nome FROM dbo.diario_cadastro WHERE id_item = ? AND operacao = ? AND tipo = 'ferramenta'", (id_ferr, operacao))
        ferr = cursor.fetchone()
        if not ferr:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escolha a ferramenta.")
        canal = str(dados.get("canal") or "").strip()
        if canal not in r.CANAIS_INTERCORRENCIA:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escolha o canal afetado.")
        inicio = _momento(dados.get("inicio"), "Começou")
        fim = _momento(dados.get("fim"), "Terminou") if str(dados.get("fim") or "").strip() else None
        if fim is not None and fim < inicio:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O fim não pode ser antes do começo.")
        if inicio > _agora() + timedelta(minutes=5):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O começo não pode estar no futuro.")
        descricao = _txt(dados.get("descricao"), 1000)
        if not descricao:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escreva o que aconteceu.")
        return {"id_ferramenta": id_ferr, "ferramenta": normalize_text(ferr[0]), "canal": canal, "inicio": inicio, "fim": fim,
                "turno": r.turno_pela_hora(inicio), "descricao": descricao, "acao": _txt(dados.get("acao"), 1000), "chamado": _txt(dados.get("chamado"), 40)}

    def diario_criar_intercorrencia(self, user, operacao: str, dados: dict) -> dict:
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            operacao = self._db_exigir_operacao(cursor, user, operacao)
            v = self._db_validar_intercorrencia(cursor, operacao, dados)
            data = v["inicio"].date()  # a intercorrência pertence ao dia em que começou
            dia = self._db_dia_linha(cursor, operacao, data) or self._db_criar_dia(cursor, user, operacao, data)
            self._db_exigir_dia_aberto(dia)
            cursor.execute(
                "INSERT INTO dbo.diario_intercorrencia (id_dia, operacao, turno, id_ferramenta, ferramenta, canal, inicio, fim, descricao, acao, chamado, criado_por) "
                "OUTPUT INSERTED.id_intercorrencia VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (dia["id_dia"], operacao, v["turno"], v["id_ferramenta"], v["ferramenta"], v["canal"], v["inicio"], v["fim"], v["descricao"], v["acao"], v["chamado"], _nome(user)),
            )
            novo_id = int(cursor.fetchone()[0])
            self._db_alteracao(cursor, user, dia=dia, operacao=operacao, entidade="intercorrencia", acao="registrou", turno=v["turno"],
                               campo=v["ferramenta"], depois={k: _iso(x) for k, x in v.items()})
            conn.commit()
            return {"id_intercorrencia": novo_id, "turno": v["turno"]}
        finally:
            conn.close()

    def diario_editar_intercorrencia(self, user, id_interc: int, versao: int, dados: dict) -> dict:
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            cursor.execute("SELECT * FROM dbo.diario_intercorrencia WHERE id_intercorrencia = ?", (id_interc,))
            atual = (rows_to_dicts(cursor, cursor.fetchall()) or [None])[0]
            if not atual or atual["excluida"]:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Intercorrência não encontrada.")
            dia = self._db_dia_por_id(cursor, user, atual["id_dia"])
            if int(versao) != int(atual["versao"]):
                raise _conflito(f"{atual.get('atualizado_por') or atual.get('criado_por') or 'Outra pessoa'} mudou esta intercorrência agora há pouco. Recarregue para ver.")
            v = self._db_validar_intercorrencia(cursor, atual["operacao"], dados)
            if v["inicio"].date() != dia["data"]:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O começo precisa ficar no mesmo dia em que a intercorrência foi registrada.")
            # Dia encerrado: ainda dá para pôr a hora de fim numa intercorrência que ficou em aberto (ela passa para o dia seguinte).
            if dia["status"] == "encerrado" and not (atual["fim"] is None and v["fim"] is not None):
                self._db_exigir_dia_aberto(dia)
            mudou = {k: (_iso(atual.get(k)), _iso(x)) for k, x in v.items() if _iso(atual.get(k)) != _iso(x)}
            cursor.execute(
                "UPDATE dbo.diario_intercorrencia SET turno = ?, id_ferramenta = ?, ferramenta = ?, canal = ?, inicio = ?, fim = ?, descricao = ?, acao = ?, chamado = ?, "
                "versao = versao + 1, atualizado_por = ?, atualizado_em = SYSDATETIME() WHERE id_intercorrencia = ? AND versao = ?",
                (v["turno"], v["id_ferramenta"], v["ferramenta"], v["canal"], v["inicio"], v["fim"], v["descricao"], v["acao"], v["chamado"], _nome(user), id_interc, int(versao)),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                raise _conflito("Esta intercorrência mudou agora há pouco. Recarregue para ver.")
            if mudou:
                self._db_alteracao(cursor, user, dia=dia, operacao=atual["operacao"], entidade="intercorrencia",
                                   acao="encerrou" if atual["fim"] is None and v["fim"] is not None else "alterou", turno=v["turno"], campo=v["ferramenta"],
                                   antes={k: a for k, (a, _b) in mudou.items()}, depois={k: b for k, (_a, b) in mudou.items()})
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()

    def diario_excluir_intercorrencia(self, user, id_interc: int, motivo: str) -> dict:
        motivo = _txt(motivo, 500)
        if not motivo:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escreva o motivo da exclusão.")
        conn, cursor = self._db_abrir()
        try:
            cursor.execute("SELECT * FROM dbo.diario_intercorrencia WHERE id_intercorrencia = ?", (id_interc,))
            atual = (rows_to_dicts(cursor, cursor.fetchall()) or [None])[0]
            if not atual or atual["excluida"]:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Intercorrência não encontrada.")
            dia = self._db_dia_por_id(cursor, user, atual["id_dia"])
            self._db_exigir_dia_aberto(dia)
            cursor.execute(
                "UPDATE dbo.diario_intercorrencia SET excluida = 1, excluida_por = ?, excluida_em = SYSDATETIME(), motivo_exclusao = ?, versao = versao + 1 "
                "WHERE id_intercorrencia = ?",
                (_nome(user), motivo, id_interc),
            )
            self._db_alteracao(cursor, user, dia=dia, operacao=atual["operacao"], entidade="intercorrencia", acao="excluiu", turno=atual["turno"],
                               campo=atual["ferramenta"], motivo=motivo)
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()

    def diario_intercorrencias_no_horario(self, user, operacao: str, momento_txt: str) -> list[dict]:
        """Monitoria: intercorrências (não excluídas) que estavam acontecendo no horário da ligação. Só a data (AAAA-MM-DD,
        a Monitoria guarda apenas o dia do contato) = todas as que tocaram aquele dia."""
        texto = str(momento_txt or "").strip()
        if len(texto) == 10:
            ini = datetime.combine(_data(texto), time(0, 0))
            janela = (ini + timedelta(days=1) - timedelta(seconds=1), ini)
        else:
            momento = _momento(texto, "Horário")
            janela = (momento, momento)
        conn, cursor = self._db_abrir()
        try:
            chave = normalize_text(operacao)
            if not chave or not user.allows_operacao(chave):
                return []
            cursor.execute(
                "SELECT id_intercorrencia, id_dia, turno, ferramenta, canal, inicio, fim, descricao FROM dbo.diario_intercorrencia "
                "WHERE operacao = ? AND excluida = 0 AND inicio <= ? AND (fim IS NULL OR fim >= ?) ORDER BY inicio",
                (chave, *janela),
            )
            return [{**_limpo(x), "aberta": x["fim"] is None} for x in rows_to_dicts(cursor, cursor.fetchall())]
        finally:
            conn.close()

    # ------------------------------------------------------------------ parciais
    def _db_valores_parcial(self, cursor, operacao: str, valores: dict) -> dict:
        canais = {c["id_item"] for c in self._db_cadastros(cursor, operacao) if c["tipo"] == "canal_parcial"}
        saida = {}
        for k, v in (valores or {}).items():
            if int(k) not in canais:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Canal da parcial desconhecido.")
            saida[str(int(k))] = r.numero_ou_vazio(v)
        return saida

    def diario_salvar_parcial(self, user, id_dia: int, id_parcial: int | None, hora: str, valores: dict) -> dict:
        try:
            h = time.fromisoformat(str(hora or "").strip()[:5])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Informe o horário da parcial (HH:MM).") from exc
        conn, cursor = self._db_abrir()
        try:
            self._db_exigir_aceite(cursor, user)
            dia = self._db_dia_por_id(cursor, user, id_dia)
            self._db_exigir_dia_aberto(dia)
            vals = self._db_valores_parcial(cursor, dia["operacao"], valores)
            if id_parcial:
                cursor.execute("SELECT hora, valores_json FROM dbo.diario_parcial WHERE id_parcial = ? AND id_dia = ? AND excluida = 0", (id_parcial, id_dia))
                ant = cursor.fetchone()
                if not ant:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcial não encontrada.")
                cursor.execute("UPDATE dbo.diario_parcial SET hora = ?, valores_json = ?, atualizado_por = ?, atualizado_em = SYSDATETIME() WHERE id_parcial = ?",
                               (h, _json(vals), _nome(user), id_parcial))
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="parcial", acao="alterou", campo=f"Parcial {h.strftime('%H:%M')}",
                                   antes={"hora": _iso(ant[0]), **json.loads(ant[1])}, depois={"hora": h.strftime("%H:%M"), **vals})
            else:
                cursor.execute("INSERT INTO dbo.diario_parcial (id_dia, hora, valores_json, criado_por) OUTPUT INSERTED.id_parcial VALUES (?, ?, ?, ?)",
                               (id_dia, h, _json(vals), _nome(user)))
                id_parcial = int(cursor.fetchone()[0])
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="parcial", acao="registrou", campo=f"Parcial {h.strftime('%H:%M')}",
                                   depois={"hora": h.strftime("%H:%M"), **vals})
            conn.commit()
            return {"id_parcial": id_parcial}
        finally:
            conn.close()

    def diario_excluir_parcial(self, user, id_dia: int, id_parcial: int) -> dict:
        conn, cursor = self._db_abrir()
        try:
            dia = self._db_dia_por_id(cursor, user, id_dia)
            self._db_exigir_dia_aberto(dia)
            cursor.execute("UPDATE dbo.diario_parcial SET excluida = 1, atualizado_por = ?, atualizado_em = SYSDATETIME() OUTPUT INSERTED.hora "
                           "WHERE id_parcial = ? AND id_dia = ? AND excluida = 0", (_nome(user), id_parcial, id_dia))
            linha = cursor.fetchone()
            if not linha:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcial não encontrada.")
            self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="parcial", acao="excluiu", campo=f"Parcial {_iso(linha[0])}")
            conn.commit()
            return {"ok": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------ fechamento para o grupo (D9)
    def diario_registrar_envio(self, user, id_dia: int, passo: str) -> dict:
        colunas = {"gerado": "envio_gerado_em = SYSDATETIME(), envio_gerado_por = ?", "copiado": "envio_copiado_em = SYSDATETIME()",
                   "baixado": "envio_baixado_em = SYSDATETIME()", "enviado": "envio_enviado_em = SYSDATETIME(), envio_enviado_por = ?"}
        if passo not in colunas:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passo do envio desconhecido.")
        conn, cursor = self._db_abrir()
        try:
            dia = self._db_dia_por_id(cursor, user, id_dia)
            params = (_nome(user),) if passo in ("gerado", "enviado") else ()
            cursor.execute(f"UPDATE dbo.diario_dia SET {colunas[passo]} WHERE id_dia = ?", (*params, id_dia))
            if passo != "gerado":
                self._db_alteracao(cursor, user, dia=dia, operacao=dia["operacao"], entidade="envio",
                                   acao={"copiado": "copiou_texto", "baixado": "baixou_imagem", "enviado": "marcou_enviado"}[passo])
            conn.commit()
            cursor.execute("SELECT envio_gerado_em, envio_gerado_por, envio_copiado_em, envio_baixado_em, envio_enviado_em, envio_enviado_por FROM dbo.diario_dia WHERE id_dia = ?", (id_dia,))
            return _limpo(rows_to_dicts(cursor, cursor.fetchall())[0])
        finally:
            conn.close()

    # ------------------------------------------------------------------ histórico e alterações
    def diario_historico(self, user, operacao: str, ano_mes: str) -> list[dict]:
        try:
            ini = date.fromisoformat(f"{ano_mes}-01")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mês inválido (use AAAA-MM).") from exc
        fim = (ini.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        conn, cursor = self._db_abrir()
        try:
            operacao = self._db_exigir_operacao(cursor, user, operacao)
            cursor.execute("SELECT id_dia, data FROM dbo.diario_dia WHERE operacao = ? AND data BETWEEN ? AND ? ORDER BY data DESC", (operacao, ini, fim))
            dias = cursor.fetchall()
            saida = []
            for id_dia, data in dias:
                d = self._db_montar_dia(cursor, user, operacao, data, self._db_dia_linha(cursor, operacao, data))
                cad = {c["id_item"]: c for c in d["cadastros"]}
                ns = {cad[x["id_item"]]["nome"]: x["valor"] for x in d["consolidado"]["ns"]}
                dia = d["dia"]
                autores = sorted({t["salvo_por"] for t in d["turnos"] if t.get("salvo_por")} | {t["concluido_por"] for t in d["turnos"] if t.get("concluido_por")})
                envio = "enviado" if dia.get("envio_enviado_em") else "copiado" if dia.get("envio_copiado_em") else "baixado" if dia.get("envio_baixado_em") else "nao_marcado"
                saida.append({
                    "id_dia": id_dia, "data": _iso(data), "status": dia["status"], "importado": dia["importado"],
                    "turnos": ["reaberto" if t["reaberto_vezes"] and t["estado"] != "vazio" else t["estado"] for t in d["turnos"]], "tratadas": d["consolidado"]["totais"]["tratadas"],
                    "pendentes": d["consolidado"]["totais"]["pendente"], "ns": ns, "abs": d["abs"]["vigente"]["abs"],
                    "abs_origem": d["abs"]["vigente"]["origem"],
                    "intercorrencias": len([i for i in d["intercorrencias"] if not i["excluida"] and not i["de_outro_dia"]]),
                    "encerramento_tipo": dia.get("encerramento_tipo"), "envio": envio, "autores": autores,
                })
            return saida
        finally:
            conn.close()

    def diario_alteracoes(self, user, id_dia: int) -> list[dict]:
        conn, cursor = self._db_abrir()
        try:
            self._db_dia_por_id(cursor, user, id_dia)
            cursor.execute(
                "SELECT id_alteracao, turno, entidade, acao, campo, antes, depois, motivo, usuario_nome, criado_em FROM dbo.diario_alteracao "
                "WHERE id_dia = ? ORDER BY criado_em DESC, id_alteracao DESC",
                (id_dia,),
            )
            return [_limpo(x) for x in rows_to_dicts(cursor, cursor.fetchall())]
        finally:
            conn.close()

    def diario_registrar_exportacao(self, user, operacao: str, id_dia: int | None, descricao: str) -> None:
        conn, cursor = self._db_abrir()
        try:
            dia = self._db_dia_por_id(cursor, user, id_dia) if id_dia else None
            self._db_alteracao(cursor, user, dia=dia, operacao=operacao, entidade="exportacao", acao="exportou", campo=descricao)
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------ resumo (Painel do dia e Início)
    def diario_resumo_hoje(self, user) -> list[dict]:
        hoje = _hoje()
        conn, cursor = self._db_abrir()
        try:
            saida = []
            for op in self._db_operacoes_do_diario(cursor, user):
                dia = self._db_dia_linha(cursor, op["chave"], hoje)
                turnos = self._db_turnos_do_dia(cursor, dia["id_dia"]) if dia else {}
                estados = []
                for t in r.TURNOS:
                    x = turnos.get(t)
                    estados.append({"turno": t, "rotulo": r.ROTULO_TURNO[t],
                                    "estado": (self._db_turno_saida(x, user)["estado"] if x else "vazio"),
                                    "concluido_em": _iso(x.get("concluido_em")) if x else None})
                abertas = self._db_intercorrencias(cursor, operacao=op["chave"], data=hoje)
                saida.append({"operacao": op["chave"], "nome": op["nome"], "data": hoje.isoformat(), "turnos": estados,
                              "status_dia": dia["status"] if dia else None, "intercorrencias_abertas": len(abertas),
                              "turno_atual": r.turno_pela_hora(_agora()), "prazo_fechamento": r.FIM_FECHAMENTO.strftime("%H:%M")})
            return saida
        finally:
            conn.close()

    # ------------------------------------------------------------------ cadastros (D5)
    def diario_cadastros(self, user, operacao: str) -> list[dict]:
        conn, cursor = self._db_abrir()
        try:
            return self._db_cadastros(cursor, self._db_exigir_operacao(cursor, user, operacao))
        finally:
            conn.close()

    def diario_salvar_cadastro(self, user, operacao: str, id_item: int | None, tipo: str, nome: str, ativo: bool, ordem: int | None) -> dict:
        nome = _txt(nome, 120)
        if not nome:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escreva o nome.")
        if tipo not in r.TIPOS_CADASTRO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lista desconhecida.")
        conn, cursor = self._db_abrir()
        try:
            operacao = normalize_text(operacao)
            cursor.execute("SELECT chave FROM dbo.operacoes WHERE chave = ?", (operacao,))
            if not cursor.fetchone() or not user.allows_operacao(operacao):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operação não encontrada.")
            cursor.execute("SELECT id_item FROM dbo.diario_cadastro WHERE operacao = ? AND tipo = ? AND nome = ? AND id_item <> ?", (operacao, tipo, nome, id_item or 0))
            if cursor.fetchone():
                raise _conflito("Já existe um item com esse nome nesta lista.")
            if id_item:
                cursor.execute("SELECT nome, ativo, ordem FROM dbo.diario_cadastro WHERE id_item = ? AND operacao = ? AND tipo = ?", (id_item, operacao, tipo))
                ant = cursor.fetchone()
                if not ant:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item não encontrado.")
                cursor.execute("UPDATE dbo.diario_cadastro SET nome = ?, ativo = ?, ordem = ?, atualizado_por = ?, atualizado_em = SYSDATETIME() WHERE id_item = ?",
                               (nome, 1 if ativo else 0, ordem if ordem is not None else ant[2], _nome(user), id_item))
                self._db_alteracao(cursor, user, dia=None, operacao=operacao, entidade="cadastro", acao="alterou", campo=tipo,
                                   antes={"nome": ant[0], "ativo": bool(ant[1])}, depois={"nome": nome, "ativo": bool(ativo)})
            else:
                cursor.execute("SELECT ISNULL(MAX(ordem), 0) + 10 FROM dbo.diario_cadastro WHERE operacao = ? AND tipo = ?", (operacao, tipo))
                proxima = int(cursor.fetchone()[0])
                cursor.execute("INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, ordem, ativo, criado_por) OUTPUT INSERTED.id_item VALUES (?, ?, ?, ?, ?, ?)",
                               (operacao, tipo, nome, ordem if ordem is not None else proxima, 1 if ativo else 0, _nome(user)))
                id_item = int(cursor.fetchone()[0])
                self._db_alteracao(cursor, user, dia=None, operacao=operacao, entidade="cadastro", acao="criou", campo=tipo, depois={"nome": nome})
            conn.commit()
            return {"id_item": id_item}
        finally:
            conn.close()

    # ------------------------------------------------------------------ importação dos .json do protótipo (D7)
    def diario_importar(self, user, operacao: str, arquivos: list[Any], gravar: bool) -> dict:
        try:
            registros = r.mesclar_arquivos([r.registros_do_arquivo(a) for a in arquivos])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        conn, cursor = self._db_abrir()
        try:
            operacao = self._db_exigir_operacao(cursor, user, operacao)
            cad = self._db_cadastros(cursor, operacao)
            chaves: dict[str, dict[str, int]] = {}
            for c in cad:
                if c.get("chave_prototipo"):
                    chaves.setdefault(c["tipo"], {})[c["chave_prototipo"]] = c["id_item"]
            ferramentas = {c["nome"].lower(): c["id_item"] for c in cad if c["tipo"] == "ferramenta"}
            dias = [r.normalizar_dia_prototipo(d, registros["dias"][d], chaves) for d in sorted(registros["dias"])]
            cursor.execute("SELECT data FROM dbo.diario_dia WHERE operacao = ?", (operacao,))
            existentes = {_iso(x[0]) for x in cursor.fetchall()}
            previa = [{
                "data": d["data"], "ja_existe": d["data"] in existentes, "repetido_nos_arquivos": d["data"] in registros["repetidos"],
                "turnos": sorted(d["turnos"]), "intercorrencias": len(d["intercorrencias"]), "parciais": len(d["parciais"]),
                "tem_abs": d["abs"] is not None, "tem_encerramento": d["encerramento"] is not None, "nao_reconhecidos": d["desconhecidos"],
            } for d in dias]
            if not gravar:
                return {"dias": previa, "novos": sum(1 for p in previa if not p["ja_existe"]), "ja_existem": sum(1 for p in previa if p["ja_existe"])}
            gravados = 0
            for d in dias:
                if d["data"] in existentes:
                    continue  # dia que já existe no Conecta nunca é sobrescrito
                dia = self._db_criar_dia(cursor, user, operacao, date.fromisoformat(d["data"]), importado=True)
                for t, reg in d["turnos"].items():
                    cursor.execute("SELECT id_turno FROM dbo.diario_turno WHERE id_dia = ? AND turno = ?", (dia["id_dia"], t))
                    id_turno = cursor.fetchone()[0]
                    for id_item, (a, b) in reg["demandas"].items():
                        cursor.execute("INSERT INTO dbo.diario_demanda (id_turno, id_item, inicio, fim) VALUES (?, ?, ?, ?)", (id_turno, id_item, a, b))
                    for id_item, v in reg["ns"].items():
                        cursor.execute("INSERT INTO dbo.diario_nivel_servico (id_turno, id_item, valor) VALUES (?, ?, ?)", (id_turno, id_item, v))
                    autor = reg["autor"] or "registro antigo"
                    cursor.execute(
                        "UPDATE dbo.diario_turno SET status = 'concluido', salvo_por = ?, salvo_em = SYSDATETIME(), concluido_por = ?, concluido_em = SYSDATETIME(), "
                        "observacoes = N'Importado do diário antigo (arquivo .json).' WHERE id_turno = ?",
                        (autor, autor, id_turno),
                    )
                for i in d["intercorrencias"]:
                    inicio = datetime.fromisoformat(i["inicio"])
                    cursor.execute(
                        "INSERT INTO dbo.diario_intercorrencia (id_dia, operacao, turno, id_ferramenta, ferramenta, canal, inicio, fim, descricao, criado_por) "
                        "VALUES (?, ?, ?, ?, ?, 'interno', ?, ?, ?, ?)",
                        (dia["id_dia"], operacao, i["turno"], ferramentas.get(i["ferramenta"].lower()), i["ferramenta"], inicio,
                         datetime.fromisoformat(i["fim"]) if i["fim"] else None, i["descricao"], i["autor"] or "registro antigo"),
                    )
                for p in d["parciais"]:
                    cursor.execute("INSERT INTO dbo.diario_parcial (id_dia, hora, valores_json, criado_por) VALUES (?, ?, ?, ?)",
                                   (dia["id_dia"], time.fromisoformat(p["hora"]), _json(p["valores"]), "registro antigo"))
                if d["abs"]:
                    cursor.execute(
                        "INSERT INTO dbo.diario_abs_correcao (id_dia, origem, corrigido_json, motivo, corrigido_por) VALUES (?, 'importacao', ?, ?, ?)",
                        (dia["id_dia"], _json({k: v or 0 for k, v in d["abs"].items()}), "ABS digitado no diário antigo (importação).", _nome(user)),
                    )
                if d["encerramento"]:
                    cursor.execute("UPDATE dbo.diario_dia SET encerramento_tipo = ?, passagem = ? WHERE id_dia = ?",
                                   (d["encerramento"]["tipo"], d["encerramento"]["passagem"] or None, dia["id_dia"]))
                if len(d["turnos"]) == 3:
                    cursor.execute("UPDATE dbo.diario_dia SET status = 'encerrado', encerrado_por = N'importação', encerrado_em = SYSDATETIME() WHERE id_dia = ?", (dia["id_dia"],))
                self._db_alteracao(cursor, user, dia=dia, operacao=operacao, entidade="dia", acao="importou",
                                   campo=f"{len(d['turnos'])} turno(s), {len(d['intercorrencias'])} intercorrência(s), {len(d['parciais'])} parcial(is)")
                gravados += 1
            conn.commit()
            return {"dias": previa, "gravados": gravados, "ignorados": sum(1 for p in previa if p["ja_existe"])}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
