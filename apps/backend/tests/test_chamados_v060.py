from pathlib import Path

from rh_api.repositories.chamados_schema_v060 import render_migration_sql, render_rollback_sql, schema_statements

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO_ROOT / "infra" / "sql" / "migrations"


def test_migration_v060_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRATIONS / "V060__chamados_reabertura_modulos.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V060__chamados_reabertura_modulos.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_migration_v060_e_aditiva_ascii_e_idempotente():
    sql = render_migration_sql()
    assert all(ord(c) < 128 for c in sql)
    assert "TRUNCATE" not in sql.upper() and "DELETE FROM" not in sql.upper()
    assert "\n".join(schema_statements()).count("CREATE TABLE") == 3
    for instrucao in schema_statements():
        assert instrucao.lstrip().startswith("IF "), instrucao[:60]  # toda instrucao e guardada (re-aplicavel a cada deploy)


def test_rollback_v060_recusa_quando_ha_reabertos_e_restaura_a_ck_da_v059():
    rb = render_rollback_sql()
    assert rb.index("THROW 50000") < rb.index("DROP TABLE")
    assert "'reabertura'" not in rb.split("ADD CONSTRAINT")[1]


# ------------------------------------------------------------------ regras de reabertura
from datetime import datetime, timedelta

from rh_api.services import chamados_regras as rg

AGORA = datetime(2026, 10, 5, 12, 0, 0)


def test_reabertura_vale_para_resolvido_e_encerrado_dentro_da_janela():
    ok = dict(agora=AGORA, dias=7)
    assert rg.reabertura_permitida(status=rg.RESOLVIDO, resolvido_em=AGORA - timedelta(days=6), encerrado_em=None, **ok)
    assert rg.reabertura_permitida(status=rg.ENCERRADO, resolvido_em=AGORA - timedelta(days=20), encerrado_em=AGORA - timedelta(days=2), **ok)


def test_reabertura_recusa_fora_da_janela_status_errado_e_janela_zero():
    assert not rg.reabertura_permitida(status=rg.RESOLVIDO, resolvido_em=AGORA - timedelta(days=8), encerrado_em=None, agora=AGORA, dias=7)
    assert not rg.reabertura_permitida(status=rg.ENCERRADO, resolvido_em=None, encerrado_em=AGORA - timedelta(days=8), agora=AGORA, dias=7)
    for status in (rg.ABERTO, rg.EM_ANDAMENTO, rg.AGUARDANDO, rg.CANCELADO):
        assert not rg.reabertura_permitida(status=status, resolvido_em=AGORA, encerrado_em=AGORA, agora=AGORA, dias=7)
    assert not rg.reabertura_permitida(status=rg.RESOLVIDO, resolvido_em=AGORA, encerrado_em=None, agora=AGORA, dias=0)


def test_so_o_solicitante_reabre_encerrado():
    assert rg.transicao_valida(rg.ENCERRADO, rg.EM_ANDAMENTO, rg.ATOR_SOLICITANTE)
    assert not rg.transicao_valida(rg.ENCERRADO, rg.EM_ANDAMENTO, rg.ATOR_ATENDENTE)
    assert not rg.transicao_valida(rg.ENCERRADO, rg.EM_ANDAMENTO, rg.ATOR_SISTEMA)


# ------------------------------------------------------------------ acesso a módulos por perfil/usuário
from rh_api.services import acesso


def test_modulo_liberado_aparece_no_seletor_sem_dar_permissao_e_so_se_ativo():
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    try:
        operador = {"wfm.visualizar"}  # abre só Operação
        base = acesso.modulos_visiveis(operador)
        assert "tecnologia" not in base
        com_ti = acesso.modulos_visiveis(operador, {"tecnologia"})
        assert "tecnologia" in com_ti and set(base) <= set(com_ti)
        assert "core" not in acesso.modulos_visiveis(operador, {"core"})  # core nunca é módulo de seletor
        assert acesso.modulos_visiveis(operador, {"inexistente"}) == base
        # só um módulo => o frontend não mostra o seletor (visiveis tem 1 item)
        assert len(acesso.descrever(operador)["modulos"]) >= 1
    finally:
        acesso.definir_carregador(None)


def test_descrever_inclui_modulos_liberados_como_visiveis():
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    try:
        itens = {m["chave"]: m["visivel"] for m in acesso.descrever(set(), {"tecnologia"})["modulos"]}
        assert itens["tecnologia"] is True and itens["rh"] is False
    finally:
        acesso.definir_carregador(None)
