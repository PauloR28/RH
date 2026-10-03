"""Modularização, Etapa 7: contratos entre o frontend (rotas e registro de módulos) e o backend."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONT = Path(__file__).resolve().parents[3] / "apps" / "frontend" / "fonte"


def _rotas_spa() -> dict[str, str]:
    texto = (FRONT / "rotas.js").read_text(encoding="utf-8")
    inicio = texto.index("ROTAS_POR_TELA = {")
    bloco = texto[inicio: texto.index("};", inicio)]
    return dict(re.findall(r"'(screen-[\w-]+)':\s*'([^']+)'", bloco))


def test_rota_de_tela_nao_colide_com_rota_da_api():
    """Recarregar a página (F5) numa rota da SPA que também é rota da API devolveria JSON em vez da tela."""
    from rh_api.main import app

    caminhos = {r.path for r in app.routes if hasattr(r, "path")}
    colisoes = []
    for tela, rota in _rotas_spa().items():
        alvo = "/" + rota
        # Colisão exata, ou (nas telas novas de Tecnologia) qualquer rota da API sob o mesmo prefixo. Colisões antigas por
        # prefixo (ex.: /processos/{id}) já existem e não são tocadas aqui.
        if alvo in caminhos or (tela.startswith("screen-tecnologia") and any(c.startswith(alvo + "/") for c in caminhos)):
            colisoes.append((tela, rota))
    assert not colisoes, f"Rotas da SPA colidem com rotas da API: {colisoes}"


def test_telas_de_tecnologia_estao_mapeadas():
    rotas = _rotas_spa()
    assert rotas["screen-tecnologia"] == "administracao-ti" and rotas["screen-tecnologia-modulos"] == "administracao-ti/modulos"
    js = (FRONT / "app" / "controlador-aplicacao.js").read_text(encoding="utf-8")
    for tela in ("screen-tecnologia", "screen-tecnologia-modulos"):
        assert re.search(rf"'{tela}':\s*'configuracoes\.visualizar'", js)
        assert re.search(rf"'{tela}':\s*'configuracoes'", js)


def test_registro_de_modulos_do_front_espelha_o_catalogo_do_backend():
    from rh_api.modulos_catalogo import MODULOS_PADRAO, OPERACAO_TI

    js = (FRONT / "modulos" / "registro.js").read_text(encoding="utf-8")
    for chave, nome, _o, _p in MODULOS_PADRAO:
        assert f"'{nome}'" in js and f"'{chave}'" in js, chave
    assert f"OPERACAO_BASE_TI = '{OPERACAO_TI}'" in js


def test_wfm_fica_no_modulo_operacao_e_nao_ha_copia_em_features():
    assert (FRONT / "modulos" / "operacao" / "wfm" / "index.js").exists()
    assert not (FRONT / "features" / "wfm").exists()
    raiz = (FRONT / "app" / "aplicacao-raiz.js").read_text(encoding="utf-8")
    assert "modulos/operacao/wfm/index.js" in raiz and "features/wfm" not in raiz


def test_modulos_sao_carregados_sob_demanda():
    raiz = (FRONT / "app" / "aplicacao-raiz.js").read_text(encoding="utf-8")
    assert re.search(r"carregarTela\(\(\) => import\('\.\./modulos/tecnologia/index\.js", raiz)
    assert re.search(r"carregarTela\(\(\) => import\('\.\./modulos/operacao/wfm/index\.js", raiz)


def test_um_unico_especificador_para_estado_registro_e_componentes():
    """Cada especificador (com ?v=) vira um módulo ES distinto no navegador; estado/registro precisam ser UM só."""
    versoes: dict[str, set[str]] = {"estado.js": set(), "registro.js": set(), "componentes.js": set()}
    for arquivo in FRONT.rglob("*.js"):
        texto = arquivo.read_text(encoding="utf-8")
        for nome, conjunto in versoes.items():
            for achado in re.findall(rf"from '((?:[./]+/)*(?:modulos/)?{re.escape(nome)}[^']*)'", texto):
                if "modulos/" in achado or achado.startswith("./") or achado.startswith("../"):
                    conjunto.add(achado.split("?", 1)[1] if "?" in achado else "")
    for nome, conjunto in versoes.items():
        assert len(conjunto) <= 1, f"{nome} importado com versões diferentes: {conjunto}"
    assert all(conjunto and "" not in conjunto for conjunto in versoes.values()), "estado/registro/componentes precisam de ?v="


@pytest.mark.skipif(shutil.which("node") is None, reason="Node não disponível")
def test_regras_puras_do_registro_em_node():
    uri = json.dumps((FRONT / "modulos" / "registro.js").as_uri())
    codigo = (
        "import { grupoNoModulo, itemConfiguracaoNoModulo, montarMenuTecnologia, telaWfmParaTecnologia, filtrarPorOperacaoBase,"
        " operacaoBaseDoModulo, escolherModuloAtual, telaInicialDoModulo } from " + uri + ";\n"
        "const r = {};\n"
        "r.legado = grupoNoModulo('processos', '', false) && grupoNoModulo('wfm', 'rh', false);\n"
        "r.rh = [grupoNoModulo('processos','rh',true), grupoNoModulo('monitoria','rh',true), grupoNoModulo('treinamentos','rh',true)];\n"
        "r.op = [grupoNoModulo('processos','operacao',true), grupoNoModulo('wfm','operacao',true), grupoNoModulo('treinamentos','operacao',true)];\n"
        "r.tec = [grupoNoModulo('processos','tecnologia',true), grupoNoModulo('treinamentos','tecnologia',true)];\n"
        "r.cfg = [itemConfiguracaoNoModulo('screen-settings-users','rh',true), itemConfiguracaoNoModulo('screen-settings-users','tecnologia',true),"
        " itemConfiguracaoNoModulo('screen-settings-monitoria','operacao',true), itemConfiguracaoNoModulo('screen-settings-users','',false)];\n"
        "const pode = (t) => ['screen-tecnologia','screen-settings-users','screen-wfm-minha-escala'].includes(t);\n"
        "r.menu = montarMenuTecnologia(pode, () => true).map((e) => e.id + (e.itens ? ':' + e.itens.length : ''));\n"
        "r.wfm = telaWfmParaTecnologia(pode) + '|' + telaWfmParaTecnologia(() => false);\n"
        "r.filtro = filtrarPorOperacaoBase([{chave:'TI::SOB'},{chave:'CRF'},{chave:'TI'}], 'TI').map((x) => x.chave);\n"
        "r.base = [operacaoBaseDoModulo('tecnologia'), operacaoBaseDoModulo('rh'), operacaoBaseDoModulo('tecnologia', false)];\n"
        "r.escolha = [escolherModuloAtual(['rh','operacao'], 'operacao', 'rh'), escolherModuloAtual(['rh'], 'tecnologia', 'rh'), escolherModuloAtual([], '', 'core')];\n"
        "r.inicio = [telaInicialDoModulo('tecnologia', () => true), telaInicialDoModulo('rh', () => true)];\n"
        "console.log(JSON.stringify(r));\n"
    )
    saida = subprocess.run(["node", "--input-type=module", "-e", codigo], capture_output=True, text=True, check=True)
    r = json.loads(saida.stdout.strip().splitlines()[-1])
    assert r["legado"] is True  # sem módulo carregado, o menu é o de antes
    assert r["rh"] == [True, False, True] and r["op"] == [False, True, True] and r["tec"] == [False, False]
    assert r["cfg"] == [False, True, True, True]
    assert r["menu"] == ["inicio", "acessos:1", "escalas"]
    assert r["wfm"] == "screen-wfm-minha-escala|"
    assert r["filtro"] == ["TI::SOB", "TI"]
    assert r["base"] == ["TI", "", ""]
    assert r["escolha"] == ["operacao", "rh", "core"]
    assert r["inicio"] == ["screen-tecnologia", "screen-menu"]
