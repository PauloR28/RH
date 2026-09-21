"""Arquivamento de logs do sistema em ZIP (Correções.txt, 21/set/2026)."""

from __future__ import annotations

import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.services import log_archiver
from rh_api.services.log_archiver import COLUNAS, arquivar_logs, configuracao


class _Cursor:
    def __init__(self, banco):
        self.banco = banco
        self.linhas = []

    def execute(self, sql, params=()):
        if sql.startswith("SELECT TOP"):
            lote, corte = params
            self.linhas = [l for l in self.banco.tabela if l[6] < corte][:lote]
        elif sql.startswith("DELETE"):
            if self.banco.falhar_delete:
                raise RuntimeError("falha simulada no DELETE")
            self.banco.tabela = [l for l in self.banco.tabela if l[0] not in set(params)]

    def fetchall(self):
        return list(self.linhas)


class _Banco:
    def __init__(self, tabela):
        self.tabela = tabela
        self.falhar_delete = False
        self.commits = 0

    def conexao(self):
        banco = self

        class Conn:
            def cursor(self):
                return _Cursor(banco)

            def commit(self):
                banco.commits += 1

            def rollback(self):
                pass

            def close(self):
                pass

        return Conn()


def _linha(id_log, quando, texto="acao"):
    valores = [None] * len(COLUNAS)
    valores[0], valores[6], valores[8] = id_log, quando, texto
    return tuple(valores)


def _settings(tmp_path):
    return SimpleNamespace(training_upload_dir=str(tmp_path / "training-uploads"))


def test_arquiva_apenas_logs_mais_antigos_que_a_retencao(tmp_path, monkeypatch):
    monkeypatch.setenv("RH_LOG_ARCHIVE_DIR", str(tmp_path / "zips"))
    monkeypatch.setenv("RH_LOG_ARCHIVE_DAYS", "90")
    agora = datetime(2026, 9, 21, 3, 0, 0)
    banco = _Banco([
        _linha(1, agora - timedelta(days=200), "=HYPERLINK(x)"),
        _linha(2, agora - timedelta(days=91)),
        _linha(3, agora - timedelta(days=10)),
    ])
    resultado = arquivar_logs(banco.conexao, _settings(tmp_path), agora=agora)
    assert resultado["arquivados"] == 2
    assert [l[0] for l in banco.tabela] == [3]  # o recente continua no banco
    zips = list((tmp_path / "zips").glob("*.zip"))
    assert len(zips) == 1
    with zipfile.ZipFile(zips[0]) as arquivo:
        conteudo = arquivo.read(arquivo.namelist()[0]).decode("utf-8-sig")
    assert conteudo.count("\n") == 3  # cabeçalho + 2 linhas
    assert "'=HYPERLINK(x)" in conteudo  # fórmula neutralizada para o Excel


def test_falha_ao_remover_nao_perde_nada_e_o_zip_permanece(tmp_path, monkeypatch):
    monkeypatch.setenv("RH_LOG_ARCHIVE_DIR", str(tmp_path / "zips"))
    agora = datetime(2026, 9, 21, 3, 0, 0)
    banco = _Banco([_linha(1, agora - timedelta(days=200))])
    banco.falhar_delete = True
    try:
        arquivar_logs(banco.conexao, _settings(tmp_path), agora=agora)
    except RuntimeError:
        pass
    assert len(banco.tabela) == 1  # nada foi apagado do banco
    assert banco.commits == 0


def test_desligado_por_variavel_de_ambiente(tmp_path, monkeypatch):
    monkeypatch.setenv("RH_LOG_ARCHIVE_ENABLED", "false")
    banco = _Banco([_linha(1, datetime(2020, 1, 1))])
    assert arquivar_logs(banco.conexao, _settings(tmp_path))["executado"] is False
    assert len(banco.tabela) == 1


def test_retencao_minima_de_30_dias(tmp_path, monkeypatch):
    monkeypatch.setenv("RH_LOG_ARCHIVE_DAYS", "3")
    assert configuracao(_settings(tmp_path))["dias"] == 30
    monkeypatch.delenv("RH_LOG_ARCHIVE_DAYS")
    assert configuracao(_settings(tmp_path))["dias"] == 90
    assert log_archiver.TABELA == "dbo.logs_auditoria"
