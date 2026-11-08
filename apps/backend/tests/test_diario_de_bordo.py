"""Diário de bordo (V068, 08/nov/2026): cálculos do turno e do dia, vazio != 0, NS do dia, ABS e correção, encerrar o dia,
importação dos .json do protótipo, permissões iniciais e migration gerada do mesmo DDL do bootstrap."""

from __future__ import annotations

import os
from datetime import date, datetime, time
from pathlib import Path

os.environ.setdefault("RH_SESSION_SECRET_KEY", "teste")

import pytest

from rh_api.repositories.diario_schema import (
    CADASTROS_PADRAO,
    render_migration_sql,
    render_rollback_sql,
    schema_statements,
)
from rh_api.services import diario_regras as r

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


# ------------------------------------------------------------------ migration
def test_migration_v068_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRATIONS / "V068__diario_de_bordo.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V068__diario_de_bordo.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_migration_v068_e_aditiva_idempotente_e_ascii():
    sql = render_migration_sql()
    assert all(ord(c) < 128 for c in sql)
    assert "DROP " not in sql.upper() and "DELETE " not in sql.upper() and "TRUNCATE" not in sql.upper()
    assert all(s.lstrip().startswith("IF ") for s in schema_statements())
    for tabela in ("diario_dia", "diario_turno", "diario_demanda", "diario_intercorrencia", "diario_parcial", "diario_abs_correcao",
                   "diario_alteracao", "diario_cadastro", "diario_aceite"):
        assert f"CREATE TABLE dbo.{tabela}" in sql, tabela


def test_rollback_recusa_quando_ha_dias_registrados():
    assert "THROW 50000" in render_rollback_sql()


def test_semente_tem_os_7_tipos_do_prototipo():
    tipos = [n for t, n, _c, _o in CADASTROS_PADRAO if t == "demanda"]
    assert tipos == ["Formulário", "Fale Conosco", "Reclame Aqui (e-mails)", "Reclame Aqui (portal)", "Biometria", "Chargeback (CBK)", "Call Back"]
    assert {n for t, n, _c, _o in CADASTROS_PADRAO if t == "canal_ns"} == {"Digital", "Voz"}
    assert {n for t, n, _c, _o in CADASTROS_PADRAO if t == "canal_parcial"} == {"Web Chat", "WhatsApp", "Telefone"}


# ------------------------------------------------------------------ tratadas e vazio != 0
@pytest.mark.parametrize("inicio,fim,esperado", [(18, 6, 12), (3, 5, 0), (5, 5, 0), (0, 0, 0), (None, 3, None), (4, None, None), (None, None, None)])
def test_tratadas_e_inicio_menos_fim_sem_negativo_e_vazio_continua_vazio(inicio, fim, esperado):
    assert r.tratadas(inicio, fim) == esperado


@pytest.mark.parametrize("valor,esperado", [(None, None), ("", None), ("  ", None), ("0", 0), (0, 0), ("12", 12), ("7,0", 7), (-3, 0), ("abc", None)])
def test_numero_vazio_nunca_vira_zero(valor, esperado):
    assert r.numero_ou_vazio(valor) == esperado


def test_percentual_aceita_virgula_e_recusa_fora_de_0_a_100():
    assert r.percentual_ou_vazio("95,8") == 95.8
    assert r.percentual_ou_vazio("") is None
    with pytest.raises(ValueError):
        r.percentual_ou_vazio("101")


def test_soma_de_tudo_vazio_e_vazio_nao_zero():
    assert r.soma_ou_vazio([None, None]) is None
    assert r.soma_ou_vazio([None, 0]) == 0


# ------------------------------------------------------------------ dia consolidado (dados da amostra aprovada)
DEM = {  # id 1..7 = 7 tipos; (início, fim)
    "abertura": {1: (18, 6), 2: (22, 9), 3: (5, 2), 4: (4, 1), 5: (9, 3), 6: (3, 1), 7: (12, 4)},
    "intermediario": {1: (15, 5), 2: (20, 8), 3: (4, 1), 4: (3, 3), 5: (7, 2), 6: (2, 2), 7: (10, 3)},
    "fechamento": {1: (11, 2), 2: (14, 3), 3: (3, 0), 4: (3, 5), 5: (4, 1), 6: (2, None), 7: (6, 1)},
}
NS = {"abertura": {10: 97.2, 11: 93.5}, "intermediario": {10: 95.8, 11: 89.1}, "fechamento": {10: 96.4, 11: None}}


def _turnos():
    return {t: {"demandas": DEM[t], "ns": NS[t]} for t in r.TURNOS}


def test_consolidado_do_dia_igual_a_amostra():
    c = r.consolidar_dia(_turnos(), range(1, 8), (10, 11))
    assert c["totais"] == {"inicio": 73, "tratadas": 115, "pendente": 14}
    cbk = next(l for l in c["demandas"] if l["id_item"] == 6)
    assert cbk["pendente"] == 2 and cbk["pendente_de"] == "intermediario"  # Fechamento sem fim: vale o do Intermediário
    assert cbk["tratadas"] == 2  # o turno com fim vazio não entra na soma (não vira 0 nem some o dia)


def test_ns_do_dia_e_o_ultimo_turno_preenchido_nao_a_media():
    ns = {x["id_item"]: x for x in r.consolidar_dia(_turnos(), range(1, 8), (10, 11))["ns"]}
    assert ns[10]["valor"] == 96.4 and ns[10]["de"] == "fechamento"
    assert ns[11]["valor"] == 89.1 and ns[11]["de"] == "intermediario"


def test_dia_sem_nada_fica_vazio():
    c = r.consolidar_dia({}, (1, 2), (10,))
    assert c["totais"] == {"inicio": None, "tratadas": None, "pendente": None}
    assert c["ns"][0]["valor"] is None


def test_inicio_do_dia_vem_do_primeiro_turno_que_tem_o_inicio():
    c = r.consolidar_dia({"abertura": {"demandas": {1: (None, 4)}, "ns": {}}, "intermediario": {"demandas": {1: (9, 2)}, "ns": {}}}, (1,), ())
    assert c["demandas"][0]["inicio"] == 9 and c["demandas"][0]["inicio_de"] == "intermediario"


# ------------------------------------------------------------------ avisos e conclusão
def test_avisos_fim_maior_e_campo_vazio():
    linhas = [{"id_item": 4, "nome": "Reclame Aqui (portal)", "inicio": 3, "fim": 5}, {"id_item": 6, "nome": "Chargeback (CBK)", "inicio": 2, "fim": None},
              {"id_item": 1, "nome": "Formulário", "inicio": 11, "fim": 2}]
    avisos = r.avisos_do_turno(linhas)
    assert [(a["nome"], a["tipo"]) for a in avisos] == [("Reclame Aqui (portal)", "fim_maior"), ("Chargeback (CBK)", "vazio")]
    ok, motivo = r.pode_concluir_turno(avisos, "")
    assert not ok and "Observações" in motivo and "Chargeback" in motivo
    assert r.pode_concluir_turno(avisos, "Entraram 4 novos às 18:20; CBK sem fim no sistema.") == (True, "")
    assert r.pode_concluir_turno([], None) == (True, "")


# ------------------------------------------------------------------ encerrar o dia
def test_encerrar_o_dia_exige_os_3_turnos_concluidos():
    ok, motivo = r.pode_encerrar_dia({"abertura": "concluido", "intermediario": "concluido", "fechamento": "rascunho"})
    assert not ok and "Fechamento" in motivo
    assert r.pode_encerrar_dia(dict.fromkeys(r.TURNOS, "concluido")) == (True, "")


# ------------------------------------------------------------------ ABS
def test_abs_da_presenca_usa_as_siglas_do_wfm():
    status = ["PRESENTE"] * 46 + ["FALTA"] * 2 + ["FALTA_JUSTIFICADA", "ATESTADO"] + ["FOLGA"] * 6 + ["DAY_OFF"] * 2 + ["FOLGA_COMP_BH", "FERIAS", "FERIAS", "FERIAS"]
    a = r.abs_da_presenca(status)
    assert (a["presentes"], a["faltas"], a["justificadas"], a["folgas"], a["ferias"], a["escalados"]) == (46, 2, 2, 9, 3, 50)
    assert a["abs"] == 8.0 and a["abs_faltas"] == 4.0 and a["abs_justificadas"] == 4.0


def test_servico_externo_conta_como_presente_e_sem_escalados_o_abs_e_vazio():
    assert r.abs_da_presenca(["SERVICO_EXTERNO", "FALTA"])["abs"] == 50.0
    assert r.abs_da_presenca([])["abs"] is None
    assert r.abs_da_presenca(["FOLGA", "FERIAS"])["abs"] is None  # folga e férias não são escalados


def test_correcao_do_abs_vale_sobre_a_presenca():
    presenca = r.abs_da_presenca(["PRESENTE"] * 9 + ["FALTA"])
    assert r.abs_vigente(presenca, None)["origem"] == "presenca" and r.abs_vigente(presenca, None)["abs"] == 10.0
    v = r.abs_vigente(presenca, {"presentes": 8, "faltas": 1, "justificadas": 1, "folgas": 0, "ferias": 0})
    assert v["origem"] == "correcao" and v["escalados"] == 10 and v["abs"] == 20.0


# ------------------------------------------------------------------ turno pela hora
@pytest.mark.parametrize("hora,turno", [(time(8, 12), "abertura"), (time(11, 59), "abertura"), (time(12, 0), "intermediario"), (time(14, 10), "intermediario"),
                                        (time(17, 35), "fechamento"), (time(23, 50), "fechamento")])
def test_turno_pela_hora_de_inicio(hora, turno):
    assert r.turno_pela_hora(hora) == turno
    assert r.turno_pela_hora(datetime.combine(date(2026, 11, 5), hora)) == turno


# ------------------------------------------------------------------ importação do protótipo (D7)
CHAVES = {"demanda": {"formulario": 1, "chargeback": 6}, "canal_ns": {"digital": 10, "voz": 11}, "canal_parcial": {"webChat": 20, "whatsapp": 21, "telefone": 22}}
ARQ_A = {"tipo": "diario-bordo-sync", "versao": "diarioBordo_registros_v4", "dados": {
    "2026-07-22": {
        "abertura": {"demandas": {"formulario": {"inicio": 15, "fim": 2}, "inventado": {"inicio": 1, "fim": 1}}, "sla": {"digital": 96.4, "voz": 91.2},
                     "atualizadoPor": "Ana", "atualizadoEm": 100},
        "falhas": [{"id": "f1", "turno": "abertura", "ferramenta": "CRM", "data": "2026-07-22", "hora": "09:10", "texto": "Lento", "atualizadoEm": 100},
                   {"id": "f2", "turno": "geral", "ferramenta": "URA", "data": "2026-07-22", "hora": "18:00", "dataEncerramento": "2026-07-22",
                    "horaEncerramento": "18:40", "texto": "Caiu", "atualizadoEm": 100},
                   {"id": "f3", "texto": "apagada", "excluido": True}],
        "parciais": [{"id": "p1", "horario": "13:00", "webChat": 412, "whatsapp": 503, "telefone": 289}],
        "absenteismo": {"presentes": 46, "faltasInjustificadas": 2, "faltasJustificadas": 2, "folgas": 9, "ferias": 3},
        "encerramento": {"status": "com_pendencias", "observacoes": "5 RA do portal"},
    },
    "lixo": {"x": 1},
}}
ARQ_B = {"2026-07-22": {"abertura": {"demandas": {"formulario": {"inicio": 99, "fim": 1}}, "atualizadoEm": 50},
                        "fechamento": {"demandas": {"chargeback": {"inicio": 2, "fim": None}}, "atualizadoEm": 300}},
         "2026-07-23": {"intermediario": {"demandas": {}, "sla": {"voz": ""}, "atualizadoEm": 10}}}


def test_mesclar_arquivos_vale_o_turno_mais_recente_e_junta_falhas():
    m = r.mesclar_arquivos([r.registros_do_arquivo(ARQ_A), r.registros_do_arquivo(ARQ_B)])
    assert set(m["dias"]) == {"2026-07-22", "2026-07-23"} and m["repetidos"] == {"2026-07-22"}
    dia = m["dias"]["2026-07-22"]
    assert dia["abertura"]["demandas"]["formulario"]["inicio"] == 15  # ARQ_B é mais antigo nesse turno
    assert "fechamento" in dia and len(dia["falhas"]) == 3


def test_normalizar_dia_do_prototipo():
    dia = r.mesclar_arquivos([r.registros_do_arquivo(ARQ_A), r.registros_do_arquivo(ARQ_B)])["dias"]["2026-07-22"]
    n = r.normalizar_dia_prototipo("2026-07-22", dia, CHAVES)
    assert n["turnos"]["abertura"]["demandas"] == {1: (15, 2)}
    assert n["turnos"]["fechamento"]["demandas"] == {6: (2, None)}  # fim vazio continua vazio
    assert n["turnos"]["abertura"]["ns"] == {10: 96.4, 11: 91.2}
    assert n["desconhecidos"] == ["demanda:inventado"]
    assert len(n["intercorrencias"]) == 2  # a excluída não entra
    ura = next(i for i in n["intercorrencias"] if i["ferramenta"] == "URA")
    assert ura["turno"] == "fechamento" and ura["inicio"] == "2026-07-22T18:00" and ura["fim"] == "2026-07-22T18:40"
    crm = next(i for i in n["intercorrencias"] if i["ferramenta"] == "CRM")
    assert crm["fim"] is None  # sem hora de fim = em aberto
    assert n["parciais"] == [{"hora": "13:00", "valores": {"20": 412, "21": 503, "22": 289}}]
    assert n["abs"] == {"presentes": 46, "faltas": 2, "justificadas": 2, "folgas": 9, "ferias": 3}
    assert n["encerramento"] == {"tipo": "com_pendencias", "passagem": "5 RA do portal"}


def test_arquivo_sem_registros_e_recusado():
    with pytest.raises(ValueError):
        r.registros_do_arquivo([1, 2])


# ------------------------------------------------------------------ permissões iniciais (D2)
def test_permissoes_iniciais_do_diario():
    from rh_api.rbac import get_role_permissions

    sup, ges, qua, adm = (get_role_permissions(p) for p in ("supervisor", "gestor", "qualidade", "administrador"))
    assert {"diario.visualizar", "diario.preencher"} <= sup and not {"diario.reabrir", "diario.administrar"} & sup
    assert {"diario.visualizar", "diario.reabrir", "diario.exportar"} <= ges and "diario.preencher" not in ges
    assert {p for p in qua if p.startswith("diario.")} == {"diario.intercorrencias"}
    assert all("sessao.diario.acessar" in x for x in (sup, ges, qua, adm))
    assert "diario.administrar" in adm
    for ti in ("tecnico_junior", "tecnico_pleno", "tecnico_senior", "analista_ti"):
        assert not {p for p in get_role_permissions(ti) if p.startswith(("diario.", "sessao.diario."))}, ti  # TI mantém o sistema sem ver o conteúdo
