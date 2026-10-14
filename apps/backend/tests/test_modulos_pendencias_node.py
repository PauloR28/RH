"""Tela Módulos: regras puras de rascunho, contagem de pendências e texto da confirmação (rodam em Node, sem navegador)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

FRONT = Path(__file__).resolve().parents[2] / "frontend" / "fonte"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node não disponível")


def _rodar(corpo: str):
    uri = json.dumps((FRONT / "modulos" / "tecnologia" / "pendencias.js").as_uri())
    codigo = (
        "import * as p from " + uri + ";\n"
        "const operacao = { modulo: 'operacao', funcoes: [ {chave:'gestao',ativo:false}, {chave:'drive',ativo:true}, {chave:'monitoria',ativo:true},"
        " {chave:'suporte',ativo:false,indisponivel:true} ] };\n"
        "const wfm = { liberado: false };\n"
        "const funcao = (f, nome) => ({ chave: p.chaveFuncao('operacao', f), tipo: 'funcao', modulo: 'operacao', funcao: f, nome, nomeModulo: 'Operação' });\n"
        + corpo
    )
    saida = subprocess.run(["node", "--input-type=module", "-e", codigo], capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(saida.stdout.strip().splitlines()[-1])


def test_contagem_sobe_e_desce_e_devolver_ao_valor_original_tira_da_conta():
    r = _rodar(
        "let rasc = {};\n"
        "const n = [];\n"
        "rasc = p.alternarRascunho(rasc, funcao('gestao','Gestão'), false); n.push(p.listarPendencias(rasc).length);\n"   # liga Gestão -> 1
        "rasc = p.alternarRascunho(rasc, funcao('drive','Drive'), true); n.push(p.listarPendencias(rasc).length);\n"      # desliga Drive -> 2
        "rasc = p.alternarRascunho(rasc, funcao('gestao','Gestão'), false); n.push(p.listarPendencias(rasc).length);\n"   # devolve Gestão -> 1
        "rasc = p.alternarRascunho(rasc, funcao('drive','Drive'), true); n.push(p.listarPendencias(rasc).length);\n"      # devolve Drive -> 0
        "console.log(JSON.stringify({ n, vazio: Object.keys(rasc).length }));\n"
    )
    assert r == {"n": [1, 2, 1, 0], "vazio": 0}


def test_valor_exibido_e_contagem_de_funcoes_ligadas_consideram_o_rascunho_e_ignoram_indisponiveis():
    r = _rodar(
        "let rasc = p.alternarRascunho({}, funcao('gestao','Gestão'), false);\n"
        "const antes = p.contarLigadas(operacao, {}, wfm);\n"
        "const depois = p.contarLigadas(operacao, rasc, wfm);\n"
        "rasc = p.alternarRascunho(rasc, { chave: p.CHAVE_WFM_PARTICIPANTES, tipo: 'wfm_participantes', nome: 'x' }, false);\n"
        "const comWfm = p.contarLigadas(operacao, rasc, wfm);\n"
        "console.log(JSON.stringify({ antes, depois, comWfm, exibido: p.valorExibido(rasc, p.chaveFuncao('operacao','gestao'), false) }));\n"
    )
    # 3 funções disponíveis (a de área desativada não conta) + a linha de participantes = 4
    assert r["antes"] == {"ligadas": 2, "total": 4} and r["depois"] == {"ligadas": 3, "total": 4} and r["comWfm"] == {"ligadas": 4, "total": 4}
    assert r["exibido"] is True


def test_pendencias_por_modulo_incluem_a_bolinha_do_wfm_em_operacao():
    r = _rodar(
        "let rasc = p.alternarRascunho({}, funcao('gestao','Gestão'), false);\n"
        "rasc = p.alternarRascunho(rasc, { chave: p.chaveModulo('rh'), tipo: 'modulo', modulo: 'rh', nome: 'RH', nomeModulo: 'RH' }, true);\n"
        "rasc = p.alternarRascunho(rasc, { chave: p.CHAVE_WFM_PARTICIPANTES, tipo: 'wfm_participantes', nome: 'x' }, false);\n"
        "console.log(JSON.stringify({ operacao: p.pendenciasDoModulo(rasc, 'operacao'), rh: p.pendenciasDoModulo(rasc, 'rh'), tec: p.pendenciasDoModulo(rasc, 'tecnologia') }));\n"
    )
    assert r == {"operacao": 2, "rh": 1, "tec": 0}


def test_confirmacao_agrupa_por_modulo_e_o_payload_segue_o_contrato_do_endpoint():
    r = _rodar(
        "let rasc = p.alternarRascunho({}, funcao('gestao','Gestão'), false);\n"
        "rasc = p.alternarRascunho(rasc, funcao('drive','Drive'), true);\n"
        "rasc = p.alternarRascunho(rasc, { chave: p.chaveModulo('rh'), tipo: 'modulo', modulo: 'rh', nome: 'RH', nomeModulo: 'RH' }, true);\n"
        "rasc = p.alternarRascunho(rasc, { chave: p.CHAVE_WFM_PARTICIPANTES, tipo: 'wfm_participantes', nome: 'x' }, false);\n"
        "const lista = p.listarPendencias(rasc);\n"
        "console.log(JSON.stringify({ linhas: p.descreverLote(lista, { operacao: 'Operação', rh: 'RH' }), payload: p.paraPayloadLote(lista), frases: p.consequenciasDoLote(lista).length }));\n"
    )
    assert r["linhas"] == [
        {"modulo": "rh", "nomeModulo": "RH", "texto": "desativar o módulo"},
        {"modulo": "operacao", "nomeModulo": "Operação", "texto": "ligar Gestão, desligar Drive, liberar Turnos e Plantões para participantes"},
    ]
    assert r["payload"] == [
        {"tipo": "modulo", "modulo": "rh", "funcao": "", "ativo": False},
        {"tipo": "funcao", "modulo": "operacao", "funcao": "gestao", "ativo": True},
        {"tipo": "funcao", "modulo": "operacao", "funcao": "drive", "ativo": False},
        {"tipo": "wfm_participantes", "modulo": "", "funcao": "", "ativo": True},
    ]
    assert r["frases"] == 5  # módulo desativado, função desligada, função ligada, WFM e vigência (uma frase por tipo presente)
