from __future__ import annotations

import pytest

from rh_api import areas
from rh_api.services import acesso


@pytest.fixture
def ambiente(monkeypatch):
    def definir(valor):
        if valor is None:
            monkeypatch.delenv(areas.VARIAVEL, raising=False)
        else:
            monkeypatch.setenv(areas.VARIAVEL, valor)

    return definir


def test_padrao_desliga_as_duas_areas(ambiente):
    ambiente(None)
    assert areas.areas_inativas() == {areas.SUPORTE_TI, areas.TREINAMENTOS}
    assert not areas.area_ativa(areas.SUPORTE_TI)


def test_vazio_reativa_tudo_e_valor_invalido_e_ignorado(ambiente):
    ambiente("")
    assert areas.areas_inativas() == frozenset()
    ambiente("treinamentos, qualquer_coisa")
    assert areas.areas_inativas() == {areas.TREINAMENTOS}


def test_suporte_ti_inativo_remove_permissoes_chamados_e_informa_o_frontend(ambiente):
    permissoes = {"chamados.abrir", "chamados.atender", "onboarding.visualizar"}
    ambiente("")
    assert "chamados.abrir" in acesso.filtrar_permissoes(permissoes)
    ambiente(areas.SUPORTE_TI)
    assert acesso.filtrar_permissoes(permissoes) == {"onboarding.visualizar"}
    payload = acesso.descrever(permissoes)
    assert payload["areas_inativas"] == [areas.SUPORTE_TI]
    assert not any(p.startswith("chamados.") for p in payload["permissoes"])
