"""Central de Acessos, Etapa 6: catálogo das 49 funções e regras da API."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from rh_api import acesso_catalogo as cat
from rh_api.rbac import PERMISSION_DEFINITIONS
from rh_api.services import acesso_cache, central_acessos


def test_catalogo_unico_tem_66_funcoes():
    assert len(cat.FUNCOES_CATALOGO) == 66
    assert len({f.id for f in cat.FUNCOES_CATALOGO}) == 66
    assert [f.n for f in sorted(cat.FUNCOES_CATALOGO, key=lambda f: f.n)] == list(range(1, 67))
    assert {f.id for f in cat.FUNCOES_CATALOGO if f.descartada} == {"zona_risco", "analise_ia"}
    assert len(cat.FUNCOES_VISIVEIS) == 64
    assert cat.POR_ID["unidades"].nome == "Operação"


def test_prefixos_da_funcao_vem_do_catalogo():
    from rh_api import modulos_catalogo as mc
    assert mc.PREFIXOS_DA_FUNCAO == cat.prefixos_do_motor()
    assert set(mc.PREFIXOS_DA_FUNCAO) == set(mc.FUNCOES)


def test_toda_permissao_esta_em_uma_funcao_so():
    sem_funcao = [k for k in PERMISSION_DEFINITIONS if cat.funcao_de(k) is None]
    assert sem_funcao == []
    total = sum(len(cat.permissoes_da_funcao(f)) for f in cat.FUNCOES_CATALOGO)
    assert total == len(PERMISSION_DEFINITIONS)


def test_base_da_tecnologia_e_futuras():
    assert {f.id for f in cat.FUNCOES_CATALOGO if f.base} == {"usuarios", "perfis", "modulos"}
    assert {f.id for f in cat.FUNCOES_CATALOGO if f.futura} == {
        "chat", "certificados", "backup", "emails_admin", "pastas", "telefonia"}


@pytest.fixture
def unidades():
    acesso_cache.definir_carregador(lambda: acesso_cache.FotoAcessos(ok=True, unidades={
        "CRF": acesso_cache.Unidade("CRF", "CRF", "operacao", "operacao", True),
        "TI": acesso_cache.Unidade("TI", "TI", "setor", "tecnologia", True),
    }))
    yield
    acesso_cache.definir_carregador(None)


def test_escopo_de_unidade_de_outro_modulo_e_recusado(unidades):
    assert central_acessos._ler_escopo("unidade:CRF", "operacao") == ("unidade", "CRF")
    with pytest.raises(HTTPException):
        central_acessos._ler_escopo("unidade:TI", "operacao")
    with pytest.raises(HTTPException):
        central_acessos._ler_escopo("qualquer", "operacao")
    with pytest.raises(HTTPException):
        central_acessos._modulo_valido("core")


def test_base_da_tecnologia_nao_desliga(unidades):
    with pytest.raises(HTTPException) as erro:
        central_acessos.salvar_lote("tecnologia", "padrao", [{"tipo": "funcao", "funcao": "usuarios", "ligada": False}], autor="teste")
    assert erro.value.status_code == 409


def test_salvar_alcance_nao_quebra_a_auditoria(monkeypatch):
    """Bug 25/11: salvar o Alcance (ex.: Supervisor = Unidade) dava "Erro interno do servidor"."""
    from types import SimpleNamespace

    from rh_api.routers import tecnologia

    aplicadas = [
        {"tipo": "alcance", "perfil": "supervisor", "area": "wfm", "nivel": "unidade"},
        {"tipo": "perm", "chave": "wfm.visualizar", "perfil": "supervisor", "valor": True, "padrao": True},
        {"tipo": "funcao", "funcao": "wfm", "ligada": True},
    ]
    monkeypatch.setattr(tecnologia.central_acessos, "salvar_lote", lambda *a, **k: {"aplicadas": aplicadas})
    auditados = []
    monkeypatch.setattr(tecnologia, "audit_action", lambda *a, **k: auditados.append(k["entidade_id"]))
    payload = SimpleNamespace(modulo="operacao", escopo="padrao", justificativa=None,
                              mudancas=[])
    r = tecnologia.salvar_acessos(payload, request=None, user=SimpleNamespace(username="ti"), repository=None)
    assert r["aplicadas"] == aplicadas
    assert auditados == ["operacao|padrao|supervisor|alcance:wfm", "operacao|padrao|supervisor|wfm.visualizar",
                         "operacao|padrao|wfm"]
