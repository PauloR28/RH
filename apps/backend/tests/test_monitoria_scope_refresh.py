from types import SimpleNamespace

from rh_api import dependencies
from rh_api.auth import AuthenticatedUser


class _Cursor:
    def __init__(self, operacoes):
        self.operacoes = operacoes

    def execute(self, sql, params=()):
        return self

    def fetchall(self):
        return [(op,) for op in self.operacoes]


class _Conn:
    def __init__(self, operacoes):
        self._cursor = _Cursor(operacoes)

    def cursor(self):
        return self._cursor

    def close(self):
        pass


def _request(path):
    return SimpleNamespace(url=SimpleNamespace(path=path))


def _user(perfil, operacoes):
    return AuthenticatedUser(username="u", id_usuario=7, perfil=perfil, operacoes=frozenset(operacoes))


def _patch_db(monkeypatch, operacoes=None, falha=False):
    def _repo():
        def _connect():
            if falha:
                raise RuntimeError("banco fora")
            return _Conn(operacoes or [])

        return SimpleNamespace(_connect=_connect)

    monkeypatch.setattr(dependencies, "get_repository", _repo)


def test_supervisor_usa_operacoes_atuais_do_banco_e_nao_as_do_token(monkeypatch):
    _patch_db(monkeypatch, ["CRF"])
    user = dependencies._refresh_monitoria_scope(_user("supervisor", ["BRAVA", "CRF"]), _request("/monitoria/contexto"))
    assert user.operacoes == frozenset({"CRF"})


def test_qualidade_sem_vinculo_no_banco_fica_sem_nenhuma_operacao(monkeypatch):
    _patch_db(monkeypatch, [])
    user = dependencies._refresh_monitoria_scope(_user("qualidade", ["BRAVA"]), _request("/monitoria/monitorias"))
    assert user.operacoes == frozenset()


def test_falha_ao_reler_o_escopo_nega_acesso(monkeypatch):
    _patch_db(monkeypatch, falha=True)
    user = dependencies._refresh_monitoria_scope(_user("supervisor", ["CRF"]), _request("/monitoria/dashboard"))
    assert user.operacoes == frozenset()


def test_perfil_global_e_rotas_fora_da_monitoria_nao_sao_alterados(monkeypatch):
    _patch_db(monkeypatch, ["CRF"])
    admin = _user("administrador", [])
    assert dependencies._refresh_monitoria_scope(admin, _request("/monitoria/contexto")) is admin
    sup = _user("supervisor", ["BRAVA"])
    assert dependencies._refresh_monitoria_scope(sup, _request("/settings/users")) is sup
