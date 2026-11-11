"""Tela inicial configurável por perfil (Correções, rodada 27/set/2026).

A Início "completa" (a do Administrador) passa a valer para todos os perfis,
exceto Supervisor, Qualidade, Operador e Candidato, que seguem na Início por
sessões. Cada bloco só aparece se o perfil tiver a permissão da área; a
configuração em Perfis e Permissões só pode ESCONDER ou reordenar blocos,
nunca liberar uma área que o perfil não acessa.
"""

from __future__ import annotations

import re
from typing import Any

from ..rbac import ROLE_CANDIDATE, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR

# Perfis que continuam na Início por sessões.
PERFIS_INICIO_POR_SESSOES = frozenset({ROLE_SUPERVISOR, ROLE_QUALIDADE, ROLE_OPERATOR, ROLE_CANDIDATE})

# id, rótulo, permissão exigida (None = cada item do bloco tem a sua), coluna.
BLOCOS_TELA_INICIAL: tuple[dict[str, Any], ...] = (
    {"id": "atalhos", "label": "Acessos rápidos", "permissao": None, "coluna": "topo"},
    {"id": "indicadores", "label": "Indicadores do dia", "permissao": None, "coluna": "topo"},
    {"id": "sessoes", "label": "Suas áreas (Treinamentos, Monitoria, Mural...)", "permissao": None, "coluna": "topo"},
    {"id": "caixa_cv", "label": "Caixa de Currículos", "permissao": "candidatos.criar", "coluna": "esquerda"},
    {"id": "movimentacoes", "label": "Movimentações", "permissao": "candidatos.visualizar", "coluna": "esquerda"},
    {"id": "mural", "label": "Mural", "permissao": "mural.visualizar", "coluna": "esquerda"},
    {"id": "entrevistas", "label": "Próximas Entrevistas", "permissao": "entrevistas.visualizar", "coluna": "direita"},
    {"id": "provas_recentes", "label": "Provas recentes", "permissao": "candidatos.consultar_historico", "coluna": "direita"},
    {"id": "processos", "label": "Processos Abertos", "permissao": "vagas.visualizar", "coluna": "direita"},
)
_IDS = tuple(bloco["id"] for bloco in BLOCOS_TELA_INICIAL)
# "Suas áreas" começa oculto: a Início do Administrador continua igual; perfis
# sem nenhum bloco de recrutamento veem as áreas automaticamente (front).
_OCULTOS_POR_PADRAO = frozenset({"sessoes"})

# Início por sessões (item 9 da lista de 10/11/2026, opção B): atalhos que o perfil
# escondeu do Início. Só exibição: a pessoa continua acessando a seção pelo menu,
# e nenhum atalho aparece sem a permissão da área (o front ainda confere).
_ID_ATALHO = re.compile(r"^[a-z0-9-]{1,40}$")
_MAX_ATALHOS_OCULTOS = 40


def normalizar_atalhos_ocultos(bruto: Any) -> list[str]:
    if not isinstance(bruto, list):
        return []
    ids: list[str] = []
    for item in bruto:
        atalho = str(item if item is not None else "").strip().lower()
        if _ID_ATALHO.match(atalho) and atalho not in ids:
            ids.append(atalho)
        if len(ids) >= _MAX_ATALHOS_OCULTOS:
            break
    return ids


def config_padrao() -> dict:
    return {"blocos": [{"id": bloco_id, "visivel": bloco_id not in _OCULTOS_POR_PADRAO} for bloco_id in _IDS], "atalhos_ocultos": [], "personalizado": False}


def normalizar_config(bruto: Any) -> dict:
    """Mantém a ordem salva, descarta ids desconhecidos/duplicados e acrescenta
    no fim os blocos novos que ainda não estavam na configuração."""
    itens = (bruto or {}).get("blocos") if isinstance(bruto, dict) else None
    if not isinstance(itens, list):
        return config_padrao()
    vistos: list[str] = []
    blocos: list[dict] = []
    for item in itens:
        if not isinstance(item, dict):
            continue
        bloco_id = str(item.get("id") or "").strip()
        if bloco_id not in _IDS or bloco_id in vistos:
            continue
        vistos.append(bloco_id)
        blocos.append({"id": bloco_id, "visivel": bool(item.get("visivel", True))})
    for bloco_id in _IDS:
        if bloco_id not in vistos:
            blocos.append({"id": bloco_id, "visivel": bloco_id not in _OCULTOS_POR_PADRAO})
    return {"blocos": blocos, "atalhos_ocultos": normalizar_atalhos_ocultos(bruto.get("atalhos_ocultos")), "personalizado": True}


def catalogo() -> list[dict]:
    return [dict(bloco) for bloco in BLOCOS_TELA_INICIAL]
