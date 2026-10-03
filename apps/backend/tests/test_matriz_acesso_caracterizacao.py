"""Caracterização do acesso ANTES da modularização (Etapa 2).

Compara a matriz atual (perfil x permissões efetivas x rotas x telas, com a flag do WFM fechada e
aberta) com o snapshot versionado em tests/snapshots/. Qualquer diferença fora de
`DIFERENCAS_APROVADAS` é regressão de acesso. Regenerar o snapshot: ver `_matriz_acesso.py`.
"""

from __future__ import annotations

import json

import pytest

import _matriz_acesso as m

# Mudança aprovada (decisão 2 do RH): perfis de TI ganham administração completa no módulo tecnologia.
# Vazio enquanto a mudança não foi implementada; a Etapa 3 preenche com o que for aprovado.
DIFERENCAS_APROVADAS: dict[str, set[str]] = {}


def _carregar(nome: str):
    return json.loads((m.SNAPSHOT_DIR / nome).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def atual():
    return m.gerar_matriz()


@pytest.fixture(scope="module")
def base():
    return _carregar("matriz_acesso.json")


def _perfis_a_comparar(base):
    return sorted(base["estados"]["flag_fechada"])


def test_permissoes_efetivas_nao_mudaram(atual, base):
    divergencias = []
    for estado, perfis in base["estados"].items():
        for perfil, dados in perfis.items():
            antes, depois = set(dados["permissoes"]), set(atual["estados"][estado][perfil]["permissoes"])
            if antes == depois:
                continue
            tolerado = DIFERENCAS_APROVADAS.get(perfil, set())
            novas = (depois - antes) - tolerado
            perdidas = antes - depois
            if novas or perdidas:
                divergencias.append(f"{estado}/{perfil}: +{sorted(novas)} -{sorted(perdidas)}")
    assert not divergencias, "Regressão de permissões:\n" + "\n".join(divergencias)


def test_rotas_existentes_mantem_a_exigencia_de_permissao(atual, base):
    alteradas = [r for r, d in base["rotas"].items() if r in atual["rotas"] and atual["rotas"][r] != d]
    removidas = [r for r in base["rotas"] if r not in atual["rotas"]]
    assert not removidas, f"Rotas removidas/renomeadas: {removidas}"
    assert not alteradas, f"Rotas com exigência de permissão alterada: {alteradas}"


def test_rotas_liberadas_por_perfil_nao_mudaram(atual, base):
    divergencias = []
    for estado, perfis in base["estados"].items():
        for perfil, dados in perfis.items():
            antes = set(dados["rotas_liberadas"])
            depois = {r for r in atual["estados"][estado][perfil]["rotas_liberadas"] if r in base["rotas"]}
            if antes != depois and perfil not in DIFERENCAS_APROVADAS:
                divergencias.append(f"{estado}/{perfil}: +{sorted(depois - antes)} -{sorted(antes - depois)}")
    assert not divergencias, "Regressão de rotas:\n" + "\n".join(divergencias)


def test_telas_liberadas_por_perfil_nao_mudaram(atual, base):
    divergencias = []
    for estado, perfis in base["estados"].items():
        for perfil, dados in perfis.items():
            antes, depois = set(dados["telas_liberadas"]), set(atual["estados"][estado][perfil]["telas_liberadas"])
            if antes != depois and perfil not in DIFERENCAS_APROVADAS:
                divergencias.append(f"{estado}/{perfil}: +{sorted(depois - antes)} -{sorted(antes - depois)}")
    assert not divergencias, "Regressão de telas:\n" + "\n".join(divergencias)


def test_rotas_da_api_nao_foram_renomeadas_nem_removidas():
    """Decisão 11: nenhuma rota existente muda de endereço (o app Android consome a mesma API)."""
    antes, depois = _carregar("openapi_paths.json"), m.paths_openapi()
    faltando = {c: sorted(set(ms) - set(depois.get(c, []))) for c, ms in antes.items() if set(ms) - set(depois.get(c, []))}
    assert not faltando, f"Rotas/métodos ausentes: {faltando}"


def test_fase_de_teste_do_wfm_fecha_so_os_perfis_previstos(base):
    """Flag fechada: Operador, Qualidade e Técnicos de TI sem nenhuma permissão WFM; quem gere continua com acesso."""
    fechada, aberta = base["estados"]["flag_fechada"], base["estados"]["flag_aberta"]
    fechados = {"operador", "qualidade", "tecnico_junior", "tecnico_pleno", "tecnico_senior"}
    for perfil, dados in fechada.items():
        tem_wfm = any(p.startswith("wfm.") or p == "sessao.wfm.acessar" for p in dados["permissoes"])
        if perfil in fechados:
            assert not tem_wfm, perfil
            assert any(p.startswith("wfm.") for p in aberta[perfil]["permissoes"]), perfil
        else:
            assert dados["permissoes"] == aberta[perfil]["permissoes"], f"{perfil} não deveria depender da flag"


def test_matriz_sem_banco_cobre_todos_os_perfis(base):
    assert len(_perfis_a_comparar(base)) == 15
