"""Painel (V072, 14/nov/2026): migração = bootstrap, permissões, catálogo de métricas, períodos e quem vê."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from rh_api import acesso_catalogo as cat
from rh_api.modulos_catalogo import MODULO_CORE, MODULO_TECNOLOGIA, modulo_dono_padrao
from rh_api.rbac import PERMISSION_DEFINITIONS, ROLE_ADMIN, ROLE_ANALISTA_TI, ROLE_MANAGER, ROLE_OPERATOR, ROLE_SUPERVISOR, SCREEN_PERMISSIONS, get_role_permissions
from rh_api.repositories.painel_schema import render_migration_sql, render_rollback_sql
from rh_api.services import painel_regras as r

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migracao_igual_ao_bootstrap():
    assert (MIGRATIONS / "V072__painel.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V072__painel.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_permissoes_e_donos():
    for chave in ("sessao.painel.acessar", "painel.visualizar", "painel.configurar"):
        assert chave in PERMISSION_DEFINITIONS
        assert cat.funcao_de(chave).id == "indicadores"
    assert PERMISSION_DEFINITIONS["painel.configurar"].critical
    assert modulo_dono_padrao("painel.visualizar", "Painel") == MODULO_CORE
    assert modulo_dono_padrao("painel.configurar", "Painel") == MODULO_TECNOLOGIA
    assert SCREEN_PERMISSIONS["screen-painel"] == "painel.visualizar"
    assert SCREEN_PERMISSIONS["screen-settings-paineis"] == "painel.configurar"


def test_valores_iniciais_dos_perfis():
    gestor = get_role_permissions(ROLE_MANAGER)
    assert {"sessao.painel.acessar", "painel.visualizar"} <= gestor and "painel.configurar" not in gestor
    ti = get_role_permissions(ROLE_ANALISTA_TI)
    assert "painel.configurar" in ti and "painel.visualizar" not in ti  # a TI monta, não assiste
    assert {"painel.visualizar", "painel.configurar"} <= get_role_permissions(ROLE_ADMIN)
    for perfil in (ROLE_SUPERVISOR, ROLE_OPERATOR):
        assert not any(p.startswith("painel.") for p in get_role_permissions(perfil))


@pytest.mark.parametrize(
    ("periodo", "esperado"),
    [
        ("hoje", (date(2026, 11, 14), date(2026, 11, 14))),
        ("semana", (date(2026, 11, 9), date(2026, 11, 14))),
        ("mes", (date(2026, 11, 1), date(2026, 11, 14))),
        ("passado", (date(2026, 10, 1), date(2026, 10, 31))),
    ],
)
def test_periodos(periodo, esperado):
    assert r.intervalo_do_periodo(periodo, date(2026, 11, 14)) == esperado


def test_periodo_anterior_tem_a_mesma_duracao():
    assert r.periodo_anterior(date(2026, 11, 1), date(2026, 11, 14)) == (date(2026, 10, 18), date(2026, 10, 31))


def test_metricas_validas_normaliza_e_recusa():
    saida = r.metricas_validas("operacao", [{"metrica": "operadores"}, {"metrica": "frequencia", "forma": "tabela"}])
    assert saida == [{"metrica": "operadores", "forma": "tabela", "ordem": 1}, {"metrica": "frequencia", "forma": "tabela", "ordem": 2}]
    with pytest.raises(ValueError):
        r.metricas_validas("operacao", [{"metrica": "rh_entrevistas"}])  # métrica de outro módulo
    with pytest.raises(ValueError):
        r.metricas_validas("operacao", [{"metrica": "presenca"}, {"metrica": "presenca"}])
    with pytest.raises(ValueError):
        r.metricas_validas("operacao", [{"metrica": "presenca", "forma": "pizza"}])


def test_quem_ve_o_painel():
    base = {"perfis_do_painel": {"gestor"}, "permissoes": {"painel.visualizar"}, "ativo": True, "eh_admin": False}
    assert r.pode_ver_painel(perfil="gestor", **base)
    assert not r.pode_ver_painel(perfil="supervisor", **base)
    assert not r.pode_ver_painel(perfil="gestor", **{**base, "permissoes": set()})
    assert not r.pode_ver_painel(perfil="gestor", **{**base, "ativo": False})
    assert r.pode_ver_painel(perfil="administrador", **{**base, "eh_admin": True})


def test_metrica_exige_permissao_de_base():
    assert r.tem_base(r.METRICAS["monitorias"], {"monitoria.dashboard"})
    assert not r.tem_base(r.METRICAS["diario"], {"wfm.relatorios"})


def test_periodo_comparado():
    ini, fim = date(2026, 11, 1), date(2026, 11, 14)
    assert r.periodo_comparado(ini, fim, "anterior") == (date(2026, 10, 18), date(2026, 10, 31))
    assert r.periodo_comparado(ini, fim, "mes") == (date(2026, 10, 1), date(2026, 10, 14))
    assert r.periodo_comparado(ini, fim, "ano") == (date(2025, 11, 1), date(2025, 11, 14))
    assert r.periodo_comparado(date(2026, 3, 1), date(2026, 3, 31), "mes") == (date(2026, 2, 1), date(2026, 2, 28))
    assert r.periodo_comparado(date(2026, 1, 1), date(2026, 1, 31), "mes") == (date(2025, 12, 1), date(2025, 12, 31))
    assert r.periodo_comparado(ini, fim, "nenhum") is None


def test_semana_comeca_no_domingo():
    assert r.dia_da_semana_domingo(date(2026, 11, 15)) == 0  # domingo
    assert r.dia_da_semana_domingo(date(2026, 11, 14)) == 6  # sábado


def test_ranking_por_posicoes():
    itens = [
        {"equipe": "A", "presenca_pct": 96, "nota_media": 89.4, "faltas": 2},
        {"equipe": "B", "presenca_pct": 93, "nota_media": 84.1, "faltas": 5},
        {"equipe": "C", "presenca_pct": 91, "nota_media": 88.7, "faltas": 7},
        {"equipe": "D", "presenca_pct": 86, "nota_media": None, "faltas": 11},
    ]
    assert [i["equipe"] for i in r.ranking_por_posicoes(itens)] == ["A", "B", "C", "D"]
    assert [i["posicao"] for i in itens if i["equipe"] == "A"] == [1]


def test_slots_da_pausa():
    assert r.slots_da_pausa("09:10", 10) == [18]
    assert r.slots_da_pausa("09:25", 10) == [18, 19]
    assert r.slots_da_pausa("23:50", 20) == [47]
    assert r.slots_da_pausa("xx", 10) == []


def test_toda_metrica_tem_area_e_forma_conhecida():
    for m in r.METRICAS.values():
        assert m.area in r.ORDEM_AREAS, m.id
        assert all(f in r.NOME_FORMA for f in m.formas), m.id


# ---------------------------------------------------------------- 16/nov/2026: escala própria da operação ("CRF::ESCALA-CRF")
def _coleta(ops, dias, presencas=None):
    return {"operadores": [{"id_usuario": i, "nome": f"Op {i}", "equipe": ""} for i in ops], "nomes": {}, "dias_escala": dias,
            "presencas": presencas or {}, "extras": {}, "versoes": [], "trocas": [], "aprovacoes": []}


def test_painel_soma_a_operacao_e_as_escalas_dela():
    """Bug do Painel zerado: a escala de novembro estava só em "CRF::ESCALA-CRF" e o painel lia só "CRF"."""
    from rh_api.repositories.painel import juntar_coletas

    hoje = date(2026, 11, 16)
    base = _coleta([1, 2], [])  # a chave da operação não tem escala no mês
    escala = _coleta([1, 2, 9], [{"id_operador": 1, "data": hoje, "trabalha": True}, {"id_operador": 2, "data": hoje, "trabalha": False}],
                     {(1, hoje): {"status": "PRESENTE"}})
    dado = juntar_coletas([base, escala])
    assert sorted(o["id_usuario"] for o in dado["operadores"]) == [1, 2]  # o 9 (sem dia na escala) não entra
    assert len(dado["dias_escala"]) == 2 and dado["presencas"][(1, hoje)]["status"] == "PRESENTE"


def test_painel_operador_em_duas_escalas_conta_uma_vez():
    from rh_api.repositories.painel import juntar_coletas

    hoje = date(2026, 11, 16)
    a = _coleta([1], [{"id_operador": 1, "data": hoje, "trabalha": False}], {(1, hoje): {"status": "FALTA"}})
    b = _coleta([1], [{"id_operador": 1, "data": hoje, "trabalha": True}], {(1, hoje): {"status": "PRESENTE"}})
    dado = juntar_coletas([a, b])
    assert dado["dias_escala"] == [{"id_operador": 1, "data": hoje, "trabalha": True}]
    assert dado["presencas"][(1, hoje)]["status"] == "PRESENTE"


def test_like_das_escalas_escapa_curinga():
    from rh_api.repositories.painel_metricas import like_escalas

    assert like_escalas("CRF") == "CRF::%"
    assert like_escalas("WFMTI_01") == "WFMTI[_]01::%"
