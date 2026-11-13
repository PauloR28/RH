"""Central de Acessos, Etapa 6: catálogo das 49 funções e regras da API."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from rh_api import acesso_catalogo as cat
from rh_api.rbac import PERMISSION_DEFINITIONS
from rh_api.services import acesso_cache, central_acessos


def test_catalogo_tem_49_funcoes_unicas():
    assert len(cat.FUNCOES_CATALOGO) == 49
    assert len({f.id for f in cat.FUNCOES_CATALOGO}) == 49
    assert [f.n for f in sorted(cat.FUNCOES_CATALOGO, key=lambda f: f.n)] == list(range(1, 50))


def test_toda_permissao_esta_em_uma_funcao_so():
    sem_funcao = [k for k in PERMISSION_DEFINITIONS if cat.funcao_de(k) is None]
    assert sem_funcao == []
    total = sum(len(cat.permissoes_da_funcao(f)) for f in cat.FUNCOES_CATALOGO)
    assert total == len(PERMISSION_DEFINITIONS)


def test_base_da_tecnologia_e_futuras():
    assert {f.id for f in cat.FUNCOES_CATALOGO if f.base} == {"usuarios", "perfis", "modulos"}
    assert {f.id for f in cat.FUNCOES_CATALOGO if f.futura} == {"chat", "certificados"}


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
