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
# Início por módulo (reestruturação, Etapa 8 — amostra aprovada em 17/nov/2026): cada módulo tem os seus blocos e a
# configuração fica em Configurações › Início dos módulos. RH = os blocos de sempre (nada muda para quem já configurou).
MODULO_RH = "rh"
MODULOS_INICIO = (MODULO_RH, "operacao", "tecnologia")
BLOCOS_POR_MODULO: dict[str, tuple[dict[str, Any], ...]] = {
    MODULO_RH: BLOCOS_TELA_INICIAL,
    "operacao": (
        {"id": "atalhos", "label": "Acessos rápidos", "permissao": None},
        {"id": "escala_hoje", "label": "Escala de hoje", "permissao": None},
        {"id": "precisa_de_voce", "label": "Precisa de você (pendências)", "permissao": None},
        {"id": "suas_operacoes", "label": "Suas operações (só quem vê mais de uma)", "permissao": None},
    ),
    "tecnologia": (
        {"id": "resumo", "label": "Números (módulos e usuários)", "permissao": None},
        {"id": "situacao", "label": "Situação do sistema (backup e inatividade)", "permissao": "configuracoes.visualizar"},
        {"id": "atalhos", "label": "Acessos rápidos", "permissao": None},
    ),
}
# "Suas áreas" começa oculto: a Início do Administrador continua igual; perfis
# sem nenhum bloco de recrutamento veem as áreas automaticamente (front).
_OCULTOS_POR_MODULO = {MODULO_RH: frozenset({"sessoes"})}
_IDS = tuple(bloco["id"] for bloco in BLOCOS_TELA_INICIAL)


def _ids(modulo: str) -> tuple[str, ...]:
    return tuple(bloco["id"] for bloco in BLOCOS_POR_MODULO[modulo])


def _ocultos(modulo: str) -> frozenset[str]:
    return _OCULTOS_POR_MODULO.get(modulo, frozenset())

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


def config_padrao(modulo: str = MODULO_RH) -> dict:
    ocultos = _ocultos(modulo)
    return {"blocos": [{"id": bloco_id, "visivel": bloco_id not in ocultos} for bloco_id in _ids(modulo)], "atalhos_ocultos": [], "personalizado": False}


def normalizar_config(bruto: Any, modulo: str = MODULO_RH) -> dict:
    """Mantém a ordem salva, descarta ids desconhecidos/duplicados e acrescenta
    no fim os blocos novos que ainda não estavam na configuração."""
    itens = (bruto or {}).get("blocos") if isinstance(bruto, dict) else None
    if not isinstance(itens, list):
        return config_padrao(modulo)
    ids = _ids(modulo)
    ocultos = _ocultos(modulo)
    vistos: list[str] = []
    blocos: list[dict] = []
    for item in itens:
        if not isinstance(item, dict):
            continue
        bloco_id = str(item.get("id") or "").strip()
        if bloco_id not in ids or bloco_id in vistos:
            continue
        vistos.append(bloco_id)
        blocos.append({"id": bloco_id, "visivel": bool(item.get("visivel", True))})
    for bloco_id in ids:
        if bloco_id not in vistos:
            blocos.append({"id": bloco_id, "visivel": bloco_id not in ocultos})
    return {"blocos": blocos, "atalhos_ocultos": normalizar_atalhos_ocultos(bruto.get("atalhos_ocultos")), "personalizado": True}


def catalogo(modulo: str = MODULO_RH) -> list[dict]:
    return [dict(bloco) for bloco in BLOCOS_POR_MODULO[modulo]]


def configs_por_modulo(bruto: Any) -> dict[str, dict]:
    """Configuração salva (JSON da tabela) aberta por módulo. RH fica na raiz (formato antigo); os outros em "modulos"."""
    bruto = bruto if isinstance(bruto, dict) else {}
    outros = bruto.get("modulos") if isinstance(bruto.get("modulos"), dict) else {}
    saida = {MODULO_RH: normalizar_config(bruto, MODULO_RH) if bruto.get("blocos") is not None else config_padrao(MODULO_RH)}
    for modulo in MODULOS_INICIO[1:]:
        saida[modulo] = normalizar_config(outros[modulo], modulo) if isinstance(outros.get(modulo), dict) else config_padrao(modulo)
    if bruto.get("blocos") is None and isinstance(bruto.get("atalhos_ocultos"), list):
        saida[MODULO_RH]["atalhos_ocultos"] = normalizar_atalhos_ocultos(bruto["atalhos_ocultos"])
    return saida


def gravar_modulo(bruto: Any, modulo: str, config: dict) -> dict:
    """JSON novo da tabela com a parte de UM módulo trocada (as outras ficam como estavam)."""
    bruto = dict(bruto) if isinstance(bruto, dict) else {}
    parte = {"blocos": config["blocos"], "atalhos_ocultos": config["atalhos_ocultos"]}
    if modulo == MODULO_RH:
        bruto.update(parte)
    else:
        outros = dict(bruto.get("modulos")) if isinstance(bruto.get("modulos"), dict) else {}
        outros[modulo] = parte
        bruto["modulos"] = outros
    return bruto
