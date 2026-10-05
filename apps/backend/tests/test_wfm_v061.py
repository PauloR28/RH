from datetime import date, datetime, timedelta
from pathlib import Path

from rh_api.repositories.wfm_schema_v061 import render_migration_sql, render_rollback_sql, schema_statements
from rh_api.services import wfm_regras as r

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_v061_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRATIONS / "V061__wfm_semana_personalizacao.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V061__wfm_semana_personalizacao.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_migration_v061_e_aditiva_ascii_e_idempotente():
    sql = render_migration_sql()
    assert all(ord(c) < 128 for c in sql)
    assert "DROP " not in sql.upper() and "DELETE" not in sql.upper()
    assert all(s.lstrip().startswith("IF ") for s in schema_statements())
    assert "THROW 50000" in render_rollback_sql()


def _contrato(semanal=None):
    return r.ParametrosContrato(codigo="CLT", jornada_diaria_max_min=600, interjornada_min_min=0, max_dias_consecutivos=7,
                                jornada_semanal_max_min=semanal)


def _dia(data, contrato, h_ini="08:00", h_fim="14:00"):
    ini = datetime.combine(data, datetime.strptime(h_ini, "%H:%M").time())
    fim = datetime.combine(data, datetime.strptime(h_fim, "%H:%M").time())
    return r.DiaEscala(data=data, contrato=contrato, inicio=ini, fim=fim)


def test_limite_semanal_viola_quando_a_soma_da_semana_passa():
    segunda = date(2026, 10, 5)  # segunda-feira
    dias = [_dia(segunda + timedelta(days=i), _contrato(semanal=30 * 60)) for i in range(6)]  # 6 x 6h = 36h
    v = r.validar_jornada_semanal(dias)
    assert len(v) == 1 and v[0].codigo == r.JORNADA_SEMANAL and v[0].data == segunda + timedelta(days=5)
    assert v[0].detalhe["total_min"] == 36 * 60 and v[0].detalhe["limite_min"] == 30 * 60


def test_limite_semanal_ok_sem_limite_e_semanas_separadas():
    segunda = date(2026, 10, 5)
    seis = [_dia(segunda + timedelta(days=i), _contrato(semanal=36 * 60)) for i in range(6)]
    assert r.validar_jornada_semanal(seis) == []  # exatamente no limite
    sem_limite = [_dia(segunda + timedelta(days=i), _contrato()) for i in range(7)]
    assert r.validar_jornada_semanal(sem_limite) == []
    # 3 dias numa semana e 3 na outra não somam
    duas = [_dia(segunda + timedelta(days=i), _contrato(semanal=20 * 60)) for i in (4, 5, 6, 7, 8, 9)]
    assert r.validar_jornada_semanal(duas) == []


def test_validar_escala_inclui_o_limite_semanal():
    segunda = date(2026, 10, 5)
    dias = [_dia(segunda + timedelta(days=i), _contrato(semanal=20 * 60)) for i in range(5)]
    v = r.validar_escala(dias, periodo=(segunda, segunda + timedelta(days=6)))
    assert any(x.codigo == r.JORNADA_SEMANAL for x in v)
