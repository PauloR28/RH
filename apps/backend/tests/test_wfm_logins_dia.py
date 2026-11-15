"""Painel do dia: 1º login do dia no Conecta (auditoria da presença automática; senão, último acesso do dia). Só leitura."""
from datetime import datetime
from types import SimpleNamespace

from rh_api.repositories.wfm_escala import WfmEscalaRepositoryMixin


class _Cursor:
    def __init__(self, auditoria, acessos):
        self.auditoria, self.acessos, self.sqls, self._ultimo = auditoria, acessos, [], ""

    def execute(self, sql, params=()):
        self._ultimo = sql
        self.sqls.append((sql, params))

    def fetchall(self):
        if "FROM dbo.wfm_auditoria" in self._ultimo:
            return self.auditoria
        if "FROM dbo.usuarios" in self._ultimo:
            return self.acessos
        return []


class _Conn:
    def __init__(self, cursor):
        self._c, self.fechada = cursor, False

    def cursor(self): return self._c
    def commit(self): pass
    def close(self): self.fechada = True


def _repo(cursor, visiveis=(1, 2, 3)):
    conn = _Conn(cursor)
    chamadas = {}

    class Repo(WfmEscalaRepositoryMixin):
        def _connect(self): return conn
        def _wfm_exigir_operacao(self, cur, user, operacao, **kw): return operacao
        def _wfm_operadores_visiveis(self, cur, user, operacao, *, todos_da_escala=False):
            chamadas["todos"] = todos_da_escala
            return [{"id_usuario": i} for i in visiveis]

    return Repo(), conn, chamadas


def test_auditoria_vence_ultimo_acesso_e_so_le():
    cur = _Cursor([(1, datetime(2026, 11, 5, 5, 57, 12))], [(1, datetime(2026, 11, 5, 9, 0)), (2, datetime(2026, 11, 5, 6, 14))])
    repo, conn, _ = _repo(cur)
    r = repo.wfm_logins_dia(SimpleNamespace(perfil="control_desk"), "SAC", "2026-11-05")
    assert r["fonte"] == "login_conecta" and r["data"] == "2026-11-05"
    assert r["itens"] == [
        {"id_operador": 1, "primeiro_login": "2026-11-05T05:57", "origem": "presenca_automatica"},
        {"id_operador": 2, "primeiro_login": "2026-11-05T06:14", "origem": "ultimo_acesso"},
    ]
    assert all(sql.lstrip().upper().startswith("SELECT") for sql, _ in cur.sqls) and conn.fechada


def test_sem_visiveis_nao_consulta():
    cur = _Cursor([], [])
    repo, _, _ = _repo(cur, visiveis=())
    assert repo.wfm_logins_dia(SimpleNamespace(perfil="supervisor"), "SAC", "2026-11-05")["itens"] == [] and not cur.sqls


def test_todas_equipes_so_para_supervisor():
    repo, _, chamadas = _repo(_Cursor([], []))
    repo.wfm_logins_dia(SimpleNamespace(perfil="supervisor"), "SAC", "2026-11-05", todas_equipes=True)
    assert chamadas["todos"] is True
    repo.wfm_logins_dia(SimpleNamespace(perfil="operador"), "SAC", "2026-11-05", todas_equipes=True)
    assert chamadas["todos"] is False
