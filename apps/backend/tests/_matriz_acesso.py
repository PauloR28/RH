"""Gera a matriz de acesso (perfil x permissões x rotas x telas) para os testes de caracterização.

Modularização do Conecta, Etapa 2: o snapshot versionado em `tests/snapshots/` é a fotografia do
acesso ANTES da modularização. O teste compara a matriz atual com ela; qualquer diferença que não
seja a mudança aprovada dos perfis de TI (decisão 2) é regressão.

Sem banco e sem efeitos colaterais: as permissões vêm do catálogo em código (`rbac.py`), as rotas são
inspecionadas na árvore de dependências do FastAPI e as telas são lidas do mapa do frontend.

Uso para regenerar o snapshot (só de propósito, ao aprovar uma mudança de matriz):
    python apps/backend/tests/_matriz_acesso.py --gravar
"""

from __future__ import annotations

import hashlib
import inspect
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
API_DIR = TESTS_DIR.parent
REPO_ROOT = API_DIR.parents[1]
SNAPSHOT_DIR = TESTS_DIR / "snapshots"
CONTROLADOR_JS = REPO_ROOT / "apps" / "frontend" / "fonte" / "app" / "controlador-aplicacao.js"

# Perfis cuja diferença é a mudança aprovada (decisão 2). Só eles podem divergir do snapshot.
PERFIS_TI = ("analista_ti", "tecnico_junior", "tecnico_pleno", "tecnico_senior")

_INLINE_RE = re.compile(r"""(?:ensure_user_permission\(\s*[\w.]+\s*,\s*|has_permission\(\s*)["']([\w.]+)["']""")


def _permissoes_efetivas_em_subprocesso(flag: str) -> dict[str, list[str]]:
    """Permissões efetivas por perfil com a flag do WFM no estado `flag` ('1' ou '').

    A flag é lida na importação do módulo; por isso um subprocesso por estado."""
    codigo = (
        "import json,sys\n"
        f"sys.path.insert(0, {str(API_DIR)!r})\n"
        "from rh_api import rbac\n"
        "out={}\n"
        "for rid in rbac.ROLE_DEFINITIONS:\n"
        "    out[rid]=sorted(rbac.aplicar_restricao_wfm_em_teste(rid, rbac.get_role_permissions(rid)))\n"
        "print(json.dumps(out))\n"
    )
    env = {k: v for k, v in os.environ.items() if k != "RH_WFM_LIBERAR_PARTICIPANTES"}
    env["RH_WFM_LIBERAR_PARTICIPANTES"] = flag
    saida = subprocess.run([sys.executable, "-c", codigo], env=env, capture_output=True, text=True, check=True)
    return json.loads(saida.stdout.strip().splitlines()[-1])


def _permissoes_da_dependencia(chamavel) -> tuple[tuple[str, ...], bool] | None:
    """Se `chamavel` é a dependência criada por `require_permissions`, devolve (permissões, require_all)."""
    codigo = getattr(chamavel, "__code__", None)
    fechamento = getattr(chamavel, "__closure__", None)
    if codigo is None or not fechamento:
        return None
    livres = dict(zip(codigo.co_freevars, (c.cell_contents for c in fechamento)))
    if "required_permissions" in livres:
        return tuple(livres["required_permissions"]), bool(livres.get("require_all", False))
    return None


def _percorrer(dependant, acumulado: list) -> None:
    for sub in dependant.dependencies:
        achado = _permissoes_da_dependencia(sub.call)
        if achado is not None:
            acumulado.append(achado)
        _percorrer(sub, acumulado)


def tabela_de_rotas() -> dict[str, dict]:
    """`METODO /caminho` -> {perms: [...], todas: bool, inline: [...]} para todas as rotas da API."""
    sys.path.insert(0, str(API_DIR))
    from fastapi.routing import APIRoute

    from rh_api.main import app

    tabela: dict[str, dict] = {}
    for rota in app.routes:
        if not isinstance(rota, APIRoute):
            continue
        achados: list = []
        _percorrer(rota.dependant, achados)
        try:
            fonte = inspect.getsource(rota.endpoint)
        except (OSError, TypeError):
            fonte = ""
        inline = sorted(set(_INLINE_RE.findall(fonte)))
        perms = sorted({p for conjunto, _ in achados for p in conjunto})
        todas = any(exigir_todas for _, exigir_todas in achados)
        for metodo in sorted(rota.methods - {"HEAD", "OPTIONS"}):
            tabela[f"{metodo} {rota.path}"] = {"perms": perms, "todas": todas, "inline": inline}
    return dict(sorted(tabela.items()))


def _objeto_js(nome: str) -> dict[str, str]:
    texto = CONTROLADOR_JS.read_text(encoding="utf-8")
    inicio = texto.index(f"export const {nome} = {{")
    fim = texto.index("\n};", inicio)
    return dict(re.findall(r"'([\w-]+)':\s*'([\w.]+)'", texto[inicio:fim]))


def mapas_de_telas() -> dict[str, dict[str, str]]:
    return {"permissao": _objeto_js("PERMISSOES_TELAS"), "sessao": _objeto_js("SESSAO_DA_TELA")}


def _rota_liberada(perms: list[str], todas: bool, concedidas: set[str]) -> bool:
    if not perms:
        return True
    return all(p in concedidas for p in perms) if todas else any(p in concedidas for p in perms)


def _telas_liberadas(mapas: dict, concedidas: set[str], perfil: str) -> list[str]:
    """Replica `podeAcessarTela` de controlador-aplicacao.js."""
    tem_chave_sessao = any(p.startswith("sessao.") for p in concedidas)
    telas = set(mapas["permissao"]) | set(mapas["sessao"])
    liberadas = []
    for tela in sorted(telas):
        perm = mapas["permissao"].get(tela)
        minhas = tela == "screen-monitoria-minhas" and perfil == "supervisor" and "monitoria.visualizar" in concedidas
        ok_perm = (not perm) or perm in concedidas or minhas
        sessao = mapas["sessao"].get(tela)
        ok_sessao = (not sessao) or (not tem_chave_sessao) or f"sessao.{sessao}.acessar" in concedidas
        if ok_perm and ok_sessao:
            liberadas.append(tela)
    return liberadas


def gerar_matriz() -> dict:
    rotas = tabela_de_rotas()
    mapas = mapas_de_telas()
    estados = {"flag_fechada": _permissoes_efetivas_em_subprocesso(""), "flag_aberta": _permissoes_efetivas_em_subprocesso("1")}
    matriz: dict = {"estados": {}}
    for estado, por_perfil in estados.items():
        perfis = {}
        for perfil, perms in por_perfil.items():
            concedidas = set(perms)
            liberadas = sorted(r for r, d in rotas.items() if _rota_liberada(d["perms"], d["todas"], concedidas))
            telas = _telas_liberadas(mapas, concedidas, perfil)
            perfis[perfil] = {
                "permissoes": perms,
                "rotas_liberadas": liberadas,
                "telas_liberadas": telas,
            }
        matriz["estados"][estado] = perfis
    matriz["rotas"] = rotas
    matriz["telas"] = mapas
    return matriz


def resumo(matriz: dict) -> dict:
    """Versão enxuta para leitura humana: contagens e hashes por perfil/estado."""
    out = {}
    for estado, perfis in matriz["estados"].items():
        out[estado] = {
            p: {
                "permissoes": len(d["permissoes"]),
                "rotas": len(d["rotas_liberadas"]),
                "telas": len(d["telas_liberadas"]),
                "hash": hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()[:12],
            }
            for p, d in perfis.items()
        }
    return out


def paths_openapi() -> dict[str, list[str]]:
    sys.path.insert(0, str(API_DIR))
    from rh_api.main import app

    return {caminho: sorted(m.upper() for m in ops) for caminho, ops in sorted(app.openapi()["paths"].items())}


def gravar() -> None:
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    matriz = gerar_matriz()
    (SNAPSHOT_DIR / "matriz_acesso.json").write_text(json.dumps(matriz, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    (SNAPSHOT_DIR / "matriz_acesso_resumo.json").write_text(json.dumps(resumo(matriz), indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    (SNAPSHOT_DIR / "openapi_paths.json").write_text(json.dumps(paths_openapi(), indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    print("snapshots gravados em", SNAPSHOT_DIR)


if __name__ == "__main__":
    if "--gravar" in sys.argv:
        gravar()
    else:
        print(json.dumps(resumo(gerar_matriz()), indent=1, ensure_ascii=False))
