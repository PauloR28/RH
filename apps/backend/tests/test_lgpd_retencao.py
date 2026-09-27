"""Retenção LGPD de candidatos: regras (unitário) e exclusão real
(integração contra o banco de desenvolvimento; pulada sem banco)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from rh_api.services.lgpd_retencao import (
    AVISAR,
    EXCLUIR,
    MANTER,
    PROTEGIDO,
    avaliar,
    mensagem_aviso,
    normalizar_config,
    somar_meses,
)

AGORA = datetime(2026, 9, 27, 12, 0)
CONFIG = normalizar_config({"ativo": True})


def _avaliar(**kw):
    base = {"data_candidatura": None, "entrada_banco": None, "contratado": False, "processo_aberto": False, "agora": AGORA, "config": CONFIG}
    base.update(kw)
    return avaliar(**base)


def test_somar_meses_fim_de_mes_e_negativo():
    assert somar_meses(datetime(2026, 8, 31), 6) == datetime(2027, 2, 28)
    assert somar_meses(datetime(2026, 3, 15), -6) == datetime(2025, 9, 15)


def test_seis_meses_da_candidatura():
    assert _avaliar(data_candidatura=AGORA - timedelta(days=190))["situacao"] == EXCLUIR
    assert _avaliar(data_candidatura=somar_meses(AGORA, -6) + timedelta(days=3))["situacao"] == AVISAR
    assert _avaliar(data_candidatura=AGORA - timedelta(days=30))["situacao"] == MANTER


def test_banco_de_talentos_conta_da_entrada():
    r = _avaliar(data_candidatura=AGORA - timedelta(days=400), entrada_banco=AGORA - timedelta(days=20))
    assert r["situacao"] == MANTER and r["origem"] == "banco_talentos"


def test_contratado_e_processo_aberto_nunca_saem():
    antigo = AGORA - timedelta(days=900)
    assert _avaliar(data_candidatura=antigo, contratado=True)["situacao"] == PROTEGIDO
    assert _avaliar(data_candidatura=antigo, processo_aberto=True)["situacao"] == PROTEGIDO


def test_config_nasce_desligada_e_limita_valores():
    assert normalizar_config({})["ativo"] is False
    assert normalizar_config({"meses_candidatura": 0, "dias_aviso": 999}) | {} == {
        **normalizar_config({}), "meses_candidatura": 1, "dias_aviso": 60,
    }


def test_mensagem_de_aviso_do_rh():
    r = _avaliar(entrada_banco=somar_meses(AGORA, -6) + timedelta(days=2))
    texto = mensagem_aviso("Maria", r)
    assert texto.startswith("Candidato Maria está há ") and "no banco de talentos" in texto
    assert "seus dados serão permanentemente excluídos" in texto


# --------------------------------------------------------------- integração
def test_executar_apaga_so_quem_venceu(tmp_path):
    from _integracao_dev import repositorio_dev

    repo = repositorio_dev()
    sufixo = uuid.uuid4().hex[:8]
    velho, novo, contratado = f"lgpd_v_{sufixo}", f"lgpd_n_{sufixo}", f"lgpd_c_{sufixo}"
    antigo = datetime.now() - timedelta(days=400)
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        for id_teste, data, status in ((velho, antigo, "Eliminado"), (novo, datetime.now(), "Analise"), (contratado, antigo, "Aprovado")):
            cursor.execute(
                "INSERT INTO dbo.candidatos_processos (id_processo, id_teste, nome_candidato, status_candidato, data_prova) VALUES (?, ?, ?, ?, ?)",
                (f"PROC_INEXISTENTE_{sufixo}", id_teste, f"Pessoa {id_teste}", status, data),
            )
        cursor.execute("INSERT INTO dbo.banco_talentos (id_teste, nome_candidato, data_movimentacao) VALUES (?, ?, ?)", (velho, "Pessoa velha", antigo))
        conn.commit()
    finally:
        conn.close()

    previa = repo.simular_lgpd_retencao()
    ids_excluir = {linha["id_teste"] for linha in previa["excluir"]}
    assert velho in ids_excluir and novo not in ids_excluir and contratado not in ids_excluir

    anterior = repo.get_lgpd_retencao_config()
    try:
        resultado = repo.executar_lgpd_retencao(forcar=True)
        assert resultado["executado"] and resultado["candidaturas_excluidas"] >= 1
        conn = repo._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM dbo.candidatos_processos WHERE id_teste = ?", (velho,))
            assert cursor.fetchone()[0] == 0
            cursor.execute("SELECT COUNT(*) FROM dbo.banco_talentos WHERE id_teste = ?", (velho,))
            assert cursor.fetchone()[0] == 0
            cursor.execute("SELECT COUNT(*) FROM dbo.candidatos_processos WHERE id_teste IN (?, ?)", (novo, contratado))
            assert cursor.fetchone()[0] == 2
            cursor.execute("SELECT TOP 1 acao FROM dbo.logs_auditoria WHERE acao = 'retencao_lgpd_automatica' ORDER BY id_log DESC")
            assert cursor.fetchone() is not None
        finally:
            conn.close()
        assert repo.get_lgpd_retencao_config()["ultimo_resultado"]["executado"] is True
    finally:
        conn = repo._connect()
        try:
            conn.cursor().execute("DELETE FROM dbo.candidatos_processos WHERE id_teste IN (?, ?)", (novo, contratado))
            conn.commit()
        finally:
            conn.close()
        repo.save_lgpd_retencao_config({k: anterior[k] for k in ("ativo", "meses_candidatura", "meses_banco_talentos", "dias_aviso", "excluir_cvs_nao_vinculados")})


def test_desligada_nao_faz_nada():
    from _integracao_dev import repositorio_dev

    repo = repositorio_dev()
    repo.save_lgpd_retencao_config({"ativo": False})
    assert repo.executar_lgpd_retencao()["executado"] is False
