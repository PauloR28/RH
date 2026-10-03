"""Caracterização do acesso ANTES da modularização (Etapa 2).

Compara a matriz atual (perfil x permissões efetivas x rotas x telas, com a flag do WFM fechada e
aberta) com o snapshot versionado em tests/snapshots/. Qualquer diferença fora de
`DIFERENCAS_APROVADAS` é regressão de acesso. Regenerar o snapshot: ver `_matriz_acesso.py`.
"""

from __future__ import annotations

import json

import pytest

import _matriz_acesso as m

# Mudança aprovada (decisão 2 do RH, com D-10): os perfis de TI GANHAM administração completa dos módulos core e
# tecnologia. Só podem ganhar (nunca perder) e só permissões desses dois módulos; nenhum outro perfil pode mudar.
PERFIS_APROVADOS = frozenset(m.PERFIS_TI)


def _esperado_para_ti(antes: set[str]) -> set[str]:
    from rh_api.rbac import PERMISSOES_ADMINISTRACAO_TI

    return set(antes) | set(PERMISSOES_ADMINISTRACAO_TI)


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
            esperado = _esperado_para_ti(antes) if perfil in PERFIS_APROVADOS else antes
            if depois != esperado:
                divergencias.append(f"{estado}/{perfil}: +{sorted(depois - esperado)} -{sorted(esperado - depois)}")
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
            if perfil in PERFIS_APROVADOS:
                if not antes <= depois:
                    divergencias.append(f"{estado}/{perfil}: perdeu {sorted(antes - depois)}")
            elif antes != depois:
                divergencias.append(f"{estado}/{perfil}: +{sorted(depois - antes)} -{sorted(antes - depois)}")
    assert not divergencias, "Regressão de rotas:\n" + "\n".join(divergencias)


def test_telas_liberadas_por_perfil_nao_mudaram(atual, base):
    divergencias = []
    # Telas NOVAS (ex.: as do módulo Tecnologia) não existiam no snapshot: só se compara o universo de telas de antes.
    universo = set(base["telas"]["permissao"]) | set(base["telas"]["sessao"])
    for estado, perfis in base["estados"].items():
        for perfil, dados in perfis.items():
            antes = set(dados["telas_liberadas"])
            depois = {t for t in atual["estados"][estado][perfil]["telas_liberadas"] if t in universo}
            if perfil in PERFIS_APROVADOS:
                # Os perfis de TI passam a ter chaves `sessao.*`; antes não tinham nenhuma e, por isso, o frontend não
                # restringia sessão alguma (telas SEM permissão própria ficavam abertas, ex.: screen-processes-open, que
                # só mostra uma tela vazia). Perdem só essas telas "abertas por falta de chave", nunca uma com permissão.
                perdidas = antes - depois
                com_permissao = [t for t in perdidas if base["telas"]["permissao"].get(t)]
                if com_permissao:
                    divergencias.append(f"{estado}/{perfil}: perdeu tela com permissão {sorted(com_permissao)}")
            elif antes != depois:
                divergencias.append(f"{estado}/{perfil}: +{sorted(depois - antes)} -{sorted(antes - depois)}")
    assert not divergencias, "Regressão de telas:\n" + "\n".join(divergencias)


def test_rotas_da_api_nao_foram_renomeadas_nem_removidas():
    """Decisão 11: nenhuma rota existente muda de endereço (o app Android consome a mesma API)."""
    antes, depois = _carregar("openapi_paths.json"), m.paths_openapi()
    faltando = {c: sorted(set(ms) - set(depois.get(c, []))) for c, ms in antes.items() if set(ms) - set(depois.get(c, []))}
    assert not faltando, f"Rotas/métodos ausentes: {faltando}"


def test_perfis_de_ti_nao_ganham_permissao_de_rh_nem_operacao(atual, base):
    """D-10: a TI controla QUEM tem o quê, mas não recebe as permissões operacionais de RH/Operação."""
    from rh_api.modulos_catalogo import MODULO_CORE, MODULO_TECNOLOGIA, modulo_dono_padrao
    from rh_api.rbac import PERMISSION_DEFINITIONS

    for estado, perfis in base["estados"].items():
        for perfil in PERFIS_APROVADOS:
            novas = set(atual["estados"][estado][perfil]["permissoes"]) - set(perfis[perfil]["permissoes"])
            fora = [p for p in novas if modulo_dono_padrao(p, PERMISSION_DEFINITIONS[p].module) not in (MODULO_CORE, MODULO_TECNOLOGIA)]
            assert not fora, f"{estado}/{perfil} ganhou permissão de outro módulo: {fora}"


def test_so_o_analista_de_ti_cria_escala_por_padrao(atual):
    for estado, perfis in atual["estados"].items():
        for perfil in ("tecnico_junior", "tecnico_pleno", "tecnico_senior"):
            assert "wfm.escala.criar" not in perfis[perfil]["permissoes"], f"{estado}/{perfil}"
        assert "wfm.escala.criar" in perfis["analista_ti"]["permissoes"]


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


def test_telas_novas_da_tecnologia_so_abrem_para_quem_pode_configurar(atual):
    for estado, perfis in atual["estados"].items():
        for perfil, dados in perfis.items():
            for tela in ("screen-tecnologia", "screen-tecnologia-modulos"):
                assert (tela in dados["telas_liberadas"]) == ("configuracoes.visualizar" in dados["permissoes"]), f"{estado}/{perfil}/{tela}"
