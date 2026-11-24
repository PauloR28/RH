"""Nome e sobrenome de usuário são sempre gravados em MAIÚSCULAS."""

from rh_api.repositories.security import _nome_maiusculo


def test_nome_vira_maiusculo():
    assert _nome_maiusculo("fulano de tal") == "FULANO DE TAL"


def test_acentos_e_espacos():
    assert _nome_maiusculo("  joão da conceição ") == "JOÃO DA CONCEIÇÃO"


def test_vazio():
    assert _nome_maiusculo(None) == ""
    assert _nome_maiusculo("") == ""
