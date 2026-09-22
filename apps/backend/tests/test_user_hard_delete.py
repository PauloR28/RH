import pytest
from fastapi import HTTPException

from rh_api.repositories.security import SecurityRepositoryMixin
from rh_api.config import get_settings


class _Cursor:
    def __init__(self, *, perfil="rh", historico=None, outros_admins=1):
        self.perfil = perfil
        self.historico = historico or {}
        self.outros_admins = outros_admins
        self.executions = []
        self._row = None

    def execute(self, sql, params=()):
        s = " ".join(str(sql).split())
        self.executions.append((s, tuple(params or ())))
        self._row = None
        if s.startswith("SELECT OBJECT_ID"):
            self._row = (1,)
        elif "COUNT(*) FROM usuarios WHERE perfil_id" in s:
            self._row = (self.outros_admins,)
        elif s.startswith("SELECT COUNT(*) FROM dbo."):
            table, column = s.split("FROM dbo.")[1].split(" WHERE ")[0], s.split(" WHERE ")[1].split(" =")[0]
            self._row = (self.historico.get((table, column), 0),)
        return self

    def fetchone(self):
        return self._row


class _Conn:
    def __init__(self, cursor):
        self.c = cursor
        self.commits = 0

    def cursor(self):
        return self.c

    def commit(self):
        self.commits += 1

    def close(self):
        pass


class _Repo(SecurityRepositoryMixin):
    def __init__(self, cursor):
        self.conn = _Conn(cursor)
        self.settings = get_settings()

    def _connect(self):
        return self.conn

    def _get_system_user_by_id(self, cursor, id_usuario):
        return {"id_usuario": id_usuario, "perfil_id": cursor.perfil, "nome": "X", "email": "x@x.com", "status": "Ativo"}

    def _insert_audit_log(self, cursor, **kwargs):
        cursor.audit = kwargs


def _deletes(cursor):
    return [s for s, _ in cursor.executions if s.startswith("DELETE FROM")]


def test_exclusao_remove_usuario_e_vinculos():
    cursor = _Cursor()
    repo = _Repo(cursor)
    assert repo.delete_system_user(10, actor={"id_usuario": 1}) == {"success": True}
    deletes = _deletes(cursor)
    assert "DELETE FROM usuarios WHERE id_usuario = ?" in deletes
    assert "DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?" in deletes
    assert cursor.audit["acao"] == "excluir_usuario"
    assert repo.conn.commits == 1


def test_nao_exclui_a_si_mesmo():
    repo = _Repo(_Cursor())
    with pytest.raises(HTTPException) as erro:
        repo.delete_system_user(5, actor={"id_usuario": 5})
    assert erro.value.status_code == 409


def test_bloqueia_usuario_com_historico_de_monitoria():
    cursor = _Cursor(historico={("monitorias", "id_operador"): 3})
    repo = _Repo(cursor)
    with pytest.raises(HTTPException, match="Desative o usuário"):
        repo.delete_system_user(10, actor={"id_usuario": 1})
    assert not _deletes(cursor)
    assert repo.conn.commits == 0


def test_bloqueia_ultimo_administrador_ativo():
    repo = _Repo(_Cursor(perfil="administrador", outros_admins=0))
    with pytest.raises(HTTPException, match="último administrador"):
        repo.delete_system_user(10, actor={"id_usuario": 1})
