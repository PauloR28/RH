from pathlib import Path

import pytest

from rh_api.repositories.wfm_schema_v064 import render_migration_sql, render_rollback_sql, schema_statements
from rh_api.services import wfm_dias_semana as d

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"

TARDE_II = d.EscalaDoOperador(1, "Tarde II", (0, 1, 3))      # Seg, Ter, Qui
SABADO = d.EscalaDoOperador(2, "Sábado", (5,))
MANHA = d.EscalaDoOperador(3, "Manhã", (0, 1, 2, 3, 4))      # Seg a Sex
TARDE_I = d.EscalaDoOperador(4, "Tarde I", (3, 4))           # Qui, Sex
QUI, SAB, SEX = 3, 5, 4


# ---- migration -------------------------------------------------------------------------------------------------
def test_migration_v064_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRATIONS / "V064__wfm_dias_semana.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V064__wfm_dias_semana.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_migration_v064_e_aditiva_idempotente_e_todo_turno_comeca_com_7_dias():
    sql = render_migration_sql()
    assert all(ord(c) < 128 for c in sql)
    assert "DROP " not in sql.upper() and "DELETE" not in sql.upper() and "UPDATE" not in sql.upper()
    assert all(s.lstrip().startswith("IF ") and "COL_LENGTH" in s for s in schema_statements())
    assert "DEFAULT '1111111'" in sql  # turnos existentes ficam com os 7 dias


# ---- texto <-> dias ---------------------------------------------------------------------------------------------
def test_texto_e_dias_ida_e_volta():
    assert d.dias_de_texto("1011000") == (0, 2, 3)
    assert d.texto_de_dias((0, 2, 3)) == "1011000"
    assert d.dias_de_texto(None) == d.TODOS_DIAS and d.dias_de_texto("xx") == d.TODOS_DIAS


@pytest.mark.parametrize("dias,rotulo", [
    ((0, 1, 2, 3, 4, 5, 6), "Todos os dias"), ((0, 1, 2, 3, 4), "Seg a Sex"), ((0,), "Seg"),
    ((0, 1, 3), "Seg, Ter, Qui"), ((5,), "Sáb"), ((), "—"),
])
def test_rotulo_dias(dias, rotulo):
    assert d.rotulo_dias(dias) == rotulo


def test_turno_de_trabalho_exige_ao_menos_um_dia_e_folga_pode_ficar_sem():
    with pytest.raises(ValueError):
        d.normalizar_dias([], tipo_trabalho=True)
    with pytest.raises(ValueError):
        d.normalizar_dias([7], tipo_trabalho=True)
    assert d.normalizar_dias([], tipo_trabalho=False) == ()
    assert d.normalizar_dias(None, tipo_trabalho=True) == d.TODOS_DIAS  # cliente antigo: 7 dias, nada muda
    assert d.normalizar_dias(None, tipo_trabalho=True, padrao=(1, 2)) == (1, 2)  # edição sem o campo mantém os dias


# ---- cenário A, B, C e D (seção 4) -------------------------------------------------------------------------------
def test_cenario_a_tarde_ii_mais_sabado_sem_conflito_e_sexta_sem_escala():
    escalas = [TARDE_II, SABADO]
    assert d.validar_escalas_do_operador(escalas) == []
    assert d.dia_tem_escala(QUI, escalas).codigo == "Tarde II"
    assert d.dia_tem_escala(SAB, escalas).codigo == "Sábado"
    assert d.dia_tem_escala(SEX, escalas) is None


def test_cenario_b_manha_seg_a_sex_sem_sabado():
    escalas = [MANHA]
    assert d.validar_escalas_do_operador(escalas) == []
    assert d.dia_tem_escala(QUI, escalas).codigo == "Manhã" and d.dia_tem_escala(SEX, escalas).codigo == "Manhã"
    assert d.dia_tem_escala(SAB, escalas) is None


def test_cenario_c_sem_escala_nenhuma():
    assert d.validar_escalas_do_operador([]) == []
    assert all(d.dia_tem_escala(dia, []) is None for dia in (QUI, SAB, SEX))


def test_cenario_d_manha_mais_tarde_i_bloqueia_qui_e_sex_dizendo_qual_turno_ocupa():
    erros = d.validar_escalas_do_operador([MANHA, TARDE_I], "D")
    assert len(erros) == 1
    assert "Qui e Sex" in erros[0] and "Tarde I" in erros[0] and "Manhã" in erros[0]


# ---- limite de 4 e compatibilidade ----------------------------------------------------------------------------------
def test_limite_de_4_escalas():
    cinco = [d.EscalaDoOperador(i, f"T{i}", (i,)) for i in range(5)]
    assert d.validar_escalas_do_operador(cinco[:4]) == []
    erros = d.validar_escalas_do_operador(cinco)
    assert len(erros) == 1 and "máximo é 4" in erros[0]


def test_turno_de_7_dias_da_migracao_nao_bloqueia_quem_alterna_turnos():
    legado = [d.EscalaDoOperador(i, f"L{i}", d.TODOS_DIAS) for i in range(6)]
    assert d.validar_escalas_do_operador(legado) == []
    assert d.validar_escalas_do_operador(legado + [SABADO]) == []
