"""Foto de "quem vê o quê" (reestruturação da configuração, Etapa 2 — 16/nov/2026).

Somente leitura. Para cada perfil, monta o que ele enxerga HOJE, pela mesma regra que decide os acessos de verdade:
módulos do seletor, módulo de entrada, funções do catálogo (as 49 de `acesso_catalogo`) e permissões efetivas.

Serve de rede de segurança: antes de mexer em módulos, funções ou perfis, tira-se uma foto; depois, outra; a diferença
mostra quem ganhou ou perdeu acesso. Nada aqui grava no banco.

  * `montar_foto()` usa o estado vigente (banco, quando há conexão; senão os padrões do código).
  * `comparar(antes, depois)` lista as diferenças em frases curtas.
  * `tabela_markdown(foto)` gera a tabela perfil x função para leitura humana.
"""

from __future__ import annotations

from typing import Any

from ..acesso_catalogo import FUNCOES_CATALOGO, funcao_de
from ..rbac import ROLE_CANDIDATE, ROLE_DEFINITIONS, get_role_permissions
from . import acesso, acesso_cache, acesso_decisao

VERSAO = 1


def _permissoes_do_perfil(perfil: str) -> tuple[frozenset[str], str]:
    """Permissões gravadas do perfil (banco) ou, sem banco, as do código. Devolve também a origem."""
    atuais = acesso_cache.permissoes_atuais(perfil)
    if atuais is not None:
        return frozenset(atuais), "banco"
    return frozenset(get_role_permissions(perfil)), "codigo"


def foto_do_perfil(perfil: str) -> dict[str, Any]:
    gravadas, origem = _permissoes_do_perfil(perfil)
    efetivas = acesso.filtrar_permissoes(gravadas)
    efetivas = acesso_decisao.permissoes_efetivas(efetivas, perfil=perfil, id_usuario=None, unidades_do_usuario=frozenset())
    extras = acesso.modulos_liberados(None, perfil)
    retirados = acesso.modulos_retirados(None, perfil)
    visiveis = acesso.modulos_visiveis(efetivas, extras, retirados)
    funcoes: dict[str, list[str]] = {}
    for chave in sorted(efetivas):
        f = funcao_de(chave)
        funcoes.setdefault(f.id if f else "sem_funcao", []).append(chave)
    return {
        "perfil": perfil,
        "nome": ROLE_DEFINITIONS[perfil].name,
        "origem": origem,
        "modulos": visiveis,
        "modulo_padrao": acesso.modulo_padrao(visiveis, efetivas, extras),
        "funcoes": funcoes,
        "total_permissoes": len(efetivas),
        "perdidas_por_regra": sorted(gravadas - efetivas),
    }


def montar_foto(perfis: list[str] | None = None) -> dict[str, Any]:
    lista = perfis or sorted(p for p in ROLE_DEFINITIONS if p != ROLE_CANDIDATE)
    return {
        "versao": VERSAO,
        "regra_unica": True,  # sempre (Etapa 10); a chave fica na foto para comparar com fotos antigas
        "modulos_ativos": sorted(acesso.estado().ativos),
        "funcoes_menu": {m: acesso.funcoes_ativas(m) for m in ("rh", "operacao", "tecnologia")},
        "perfis": {p: foto_do_perfil(p) for p in lista},
    }


def comparar(antes: dict[str, Any], depois: dict[str, Any]) -> list[str]:
    """Diferenças em frases curtas, por perfil. Lista vazia = ninguém ganhou nem perdeu nada."""
    saida: list[str] = []
    pa, pd = antes.get("perfis", {}), depois.get("perfis", {})
    for perfil in sorted(set(pa) | set(pd)):
        a, d = pa.get(perfil), pd.get(perfil)
        if a is None or d is None:
            saida.append(f"{perfil}: perfil {'novo' if a is None else 'removido'}.")
            continue
        for m in sorted(set(d["modulos"]) - set(a["modulos"])):
            saida.append(f"{perfil}: passou a ver o módulo {m}.")
        for m in sorted(set(a["modulos"]) - set(d["modulos"])):
            saida.append(f"{perfil}: deixou de ver o módulo {m}.")
        if a["modulo_padrao"] != d["modulo_padrao"]:
            saida.append(f"{perfil}: entra em {d['modulo_padrao']} (antes {a['modulo_padrao']}).")
        ka = {k for ks in a["funcoes"].values() for k in ks}
        kd = {k for ks in d["funcoes"].values() for k in ks}
        for k in sorted(kd - ka):
            saida.append(f"{perfil}: ganhou {k}.")
        for k in sorted(ka - kd):
            saida.append(f"{perfil}: perdeu {k}.")
    return saida


def tabela_markdown(foto: dict[str, Any]) -> str:
    """Tabela perfil x função (✓ = vê ao menos uma ação da função). Só as funções que algum perfil vê."""
    perfis = list(foto["perfis"].values())
    usadas = [f for f in FUNCOES_CATALOGO if any(f.id in p["funcoes"] for p in perfis)]
    linhas = [
        "| Perfil | Módulos | Entra em | " + " | ".join(f.nome for f in usadas) + " |",
        "|---|---|---|" + "---|" * len(usadas),
    ]
    for p in perfis:
        marcas = " | ".join(str(len(p["funcoes"][f.id])) if f.id in p["funcoes"] else "–" for f in usadas)
        linhas.append(f"| {p['nome']} | {', '.join(p['modulos']) or '–'} | {p['modulo_padrao']} | {marcas} |")
    return "\n".join(linhas) + "\n"
