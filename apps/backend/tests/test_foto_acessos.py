"""Etapa 2 da reestruturação (16/nov/2026): foto de "quem vê o quê" com os padrões do código.

O snapshot `snapshots/foto_acessos_padrao.json` é a foto do Conecta ANTES das próximas etapas. Se uma mudança fizer
algum perfil ganhar ou perder módulo, módulo de entrada ou permissão, este teste falha e diz o quê, em frases.
Mudança aprovada pelo Paulo: regravar com `RH_FOTO_GRAVAR=1 pytest apps/backend/tests/test_foto_acessos.py`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from rh_api.services import acesso, acesso_cache, foto_acessos

SNAPSHOT = Path(__file__).parent / "snapshots" / "foto_acessos_padrao.json"


@pytest.fixture()
def padroes_do_codigo(monkeypatch):
    monkeypatch.delenv("RH_AREAS_INATIVAS", raising=False)
    monkeypatch.setenv("RH_ACESSO_REGRA_UNICA", "1")  # produção (confirmado pelo Paulo em 16/11/2026)
    monkeypatch.setenv("RH_WFM_LIBERAR_PARTICIPANTES", "0")
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    acesso_cache.definir_carregador(lambda: acesso_cache.FotoAcessos())
    acesso.invalidar_cache_wfm()
    yield
    acesso.definir_carregador(None)
    acesso_cache.definir_carregador(None)
    acesso.invalidar_cache_wfm()


def test_foto_bate_com_o_snapshot(padroes_do_codigo):
    atual = json.loads(json.dumps(foto_acessos.montar_foto(), sort_keys=True))
    if os.environ.get("RH_FOTO_GRAVAR") == "1":
        SNAPSHOT.write_text(json.dumps(atual, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    antes = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    diferencas = foto_acessos.comparar(antes, atual)
    assert not diferencas, "Acesso mudou:\n" + "\n".join(diferencas)
    assert atual == antes


def test_comparar_descreve_ganho_e_perda():
    base = {"modulos": ["rh"], "modulo_padrao": "rh", "funcoes": {"processos": ["vagas.visualizar"]}}
    depois = {"modulos": ["operacao"], "modulo_padrao": "operacao", "funcoes": {"wfm": ["wfm.escala.visualizar"]}}
    frases = foto_acessos.comparar({"perfis": {"rh": base}}, {"perfis": {"rh": depois}})
    assert "rh: passou a ver o módulo operacao." in frases
    assert "rh: deixou de ver o módulo rh." in frases
    assert "rh: ganhou wfm.escala.visualizar." in frases
    assert "rh: perdeu vagas.visualizar." in frases


def test_tabela_tem_uma_linha_por_perfil(padroes_do_codigo):
    foto = foto_acessos.montar_foto()
    linhas = foto_acessos.tabela_markdown(foto).strip().splitlines()
    assert len(linhas) == 2 + len(foto["perfis"])
