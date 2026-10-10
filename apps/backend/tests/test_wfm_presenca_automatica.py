"""Presença automática no 1º login do dia (WFM): grava só para escalado em turno de TRABALHO sem presença; nunca derruba o login."""
from types import SimpleNamespace

from rh_api.repositories.wfm_escala import PRESENCA_AUTOMATICA, WfmEscalaRepositoryMixin


class _Cursor:
    def __init__(self, operacoes, falhar=False):
        self.operacoes, self.falhar, self.inserts, self.auditorias = operacoes, falhar, [], []
        self._ultimo = ""

    def execute(self, sql, params=()):
        self._ultimo = sql
        if "INSERT INTO dbo.wfm_presencas" in sql:
            if self.falhar:
                raise RuntimeError("falha simulada")
            self.inserts.append(params)

    def fetchall(self):
        return [(o,) for o in self.operacoes] if "FROM dbo.wfm_escala_itens" in self._ultimo else []


class _Conn:
    def __init__(self, cursor):
        self._c, self.commits, self.rollbacks, self.fechada = cursor, 0, 0, False

    def cursor(self): return self._c
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1
    def close(self): self.fechada = True


def _repo(cursor):
    conn = _Conn(cursor)

    class Repo(WfmEscalaRepositoryMixin):
        def _connect(self): return conn
        def wfm_audit(self, cur, user, **kw): cur.auditorias.append(kw)

    return Repo(), conn


def test_grava_presente_automatica_para_escalado_sem_presenca():
    cur = _Cursor(["TI", "SAC"])
    repo, conn = _repo(cur)
    assert repo.wfm_presenca_automatica_login(SimpleNamespace(id_usuario=7)) == 2
    assert [p[0] for p in cur.inserts] == ["TI", "SAC"] and all(p[3] == PRESENCA_AUTOMATICA for p in cur.inserts)
    assert len(cur.auditorias) == 2 and conn.commits == 1 and conn.fechada


def test_sem_escala_hoje_nao_grava():
    cur = _Cursor([])
    repo, _ = _repo(cur)
    assert repo.wfm_presenca_automatica_login(SimpleNamespace(id_usuario=7)) == 0 and not cur.inserts


def test_falha_nao_propaga_e_faz_rollback():
    cur = _Cursor(["TI"], falhar=True)
    repo, conn = _repo(cur)
    assert repo.wfm_presenca_automatica_login(SimpleNamespace(id_usuario=7)) == 0
    assert conn.rollbacks == 1 and conn.fechada


def test_usuario_sem_id_e_ignorado():
    repo, _ = _repo(_Cursor(["TI"]))
    assert repo.wfm_presenca_automatica_login(SimpleNamespace(id_usuario=None)) == 0
