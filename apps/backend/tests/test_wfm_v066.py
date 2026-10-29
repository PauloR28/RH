"""V066 do WFM (turno especial, limite de escalas, feriado com serviço), código automático do turno e o motivo do erro na tela."""

from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("RH_SESSION_SECRET_KEY", "teste")

import pytest

from rh_api.repositories.wfm import _abreviar_nome_turno
from rh_api.repositories.wfm_escala import _mensagem_conflito
from rh_api.repositories.wfm_schema_v066 import render_migration_sql, render_rollback_sql, schema_statements
from rh_api.services import wfm_dias_semana as d

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_v066_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRATIONS / "V066__wfm_turno_especial_feriado.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V066__wfm_turno_especial_feriado.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_migration_v066_e_aditiva_e_idempotente():
    sql = render_migration_sql()
    assert all(ord(c) < 128 for c in sql)
    assert "DROP " not in sql.upper() and "DELETE" not in sql.upper() and "UPDATE" not in sql.upper()
    assert all(s.lstrip().startswith("IF ") and "COL_LENGTH" in s for s in schema_statements())
    assert "DEFAULT 4" in sql  # escalas existentes seguem com o limite antigo (4)


@pytest.mark.parametrize("nome,codigo", [
    ("Manhã", "MAN"), ("Plantão Sábado", "PS"), ("Escala 6x1 manhã", "E6X1"), ("Turno de Domingo", "TD"),
    ("  ", "TURNO"), ("Tarde 12-20", "T122"),
])
def test_codigo_do_turno_vem_da_abreviacao_do_nome(nome, codigo):
    assert _abreviar_nome_turno(nome) == codigo
    assert _abreviar_nome_turno(nome) == _abreviar_nome_turno(nome).upper()


def test_limite_de_escalas_vem_da_configuracao_e_a_mensagem_explica():
    escalas = [d.EscalaDoOperador(i, f"T{i}", (i - 1,)) for i in range(1, 4)]  # 3 escalas restritas, dias diferentes
    assert d.validar_escalas_do_operador(escalas, "Ana", 3) == []
    erros = d.validar_escalas_do_operador(escalas, "Ana", 2)
    assert len(erros) == 1 and "Ana" in erros[0] and "máximo desta escala é 2" in erros[0] and "Configurações da escala" in erros[0]


def test_mensagem_de_conflito_diz_quem_e_quando():
    msg = _mensagem_conflito([{"id_operador": 1, "data": "2026-10-29", "alterado_por": "Ana"}], {1: "João"})
    assert "João em 29/10 por Ana" in msg and "Nada foi salvo" in msg


def test_http_exception_com_dict_nao_vira_falha_generica():
    from rh_api.main import _mensagem_do_erro_http

    assert _mensagem_do_erro_http("Texto simples.") == "Texto simples."
    assert _mensagem_do_erro_http({"mensagem": "Ana repete Seg.", "erros": ["x"]}) == "Ana repete Seg."
    assert _mensagem_do_erro_http({"erros": ["a", "b"]}) == "a b"
    assert _mensagem_do_erro_http([{"msg": "campo inválido"}]) == "campo inválido"
    assert _mensagem_do_erro_http(None) == "Falha ao processar a requisição."


def test_feriado_sem_servico_da_folga_para_todos():
    from datetime import date

    from rh_api.repositories.wfm import _itens_do_feriado

    itens = _itens_do_feriado([date(2026, 11, 2), date(2026, 11, 3)], [1, 2], None, 99, {(1, date(2026, 11, 2)): 5})
    assert len(itens) == 4 and all(i["id_turno"] == 99 for i in itens)
    assert [i["versao_linha"] for i in itens] == [5, None, None, None]  # linha existente leva a versão lida (trava otimista)


def test_feriado_com_servico_escala_so_quem_foi_escolhido_e_o_resto_folga():
    from datetime import date

    from rh_api.repositories.wfm import _itens_do_feriado

    servico = {"id_turno": 7, "entrada": "09:00", "saida": "15:00", "ids_operadores": [2]}
    itens = {i["id_operador"]: i for i in _itens_do_feriado([date(2026, 11, 2)], [1, 2], servico, 99, {})}
    assert itens[1]["id_turno"] == 99 and "manual" not in itens[1]
    assert itens[2]["id_turno"] == 7 and itens[2]["manual"] is True
    assert itens[2]["ajustar_horario"] is True and (itens[2]["entrada"], itens[2]["saida"]) == ("09:00", "15:00")
    sem_horario = _itens_do_feriado([date(2026, 11, 2)], [2], {**servico, "entrada": None, "saida": None}, 99, {})[0]
    assert "ajustar_horario" not in sem_horario  # sem horário próprio vale o do turno
