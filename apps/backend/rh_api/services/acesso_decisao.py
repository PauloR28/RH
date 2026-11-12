"""Regra ÚNICA de decisão de acesso (Central de Acessos, Etapa 1 — modo sombra).

Responde uma pergunta só: "esta pessoa pode fazer isto, nesta unidade?". As camadas vão de fora para dentro e cada uma
só FECHA a porta; nenhuma camada de dentro reabre o que uma de fora fechou (desenho aprovado em 12/nov/2026):

  1. módulo   — módulo dono da permissão ativo (inclui áreas inativas e sessões de funções do módulo desligado);
  2. unidade  — usuário restrito precisa estar vinculado à unidade (operação/setor) do recurso, quando houver unidade;
  3. função   — ligada no módulo e na unidade (entra na Etapa 4; hoje função é só visibilidade de menu);
  4. perfil   — a permissão do perfil, depois das exceções (exceções entram na Etapa 5).

Nesta etapa a função NÃO decide nada de verdade: `dependencies.require_permissions` continua usando a regra de hoje e
chama `comparar_em_sombra`, que só registra no log quando as duas respostas divergem. Desligar: RH_ACESSO_SOMBRA=0.
Tudo aqui é em memória (usa o cache de `services/acesso.py`): nenhuma ida ao banco por pedido.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import AbstractSet, Iterable

from . import acesso

logger = logging.getLogger(__name__)

CAMADA_MODULO = "modulo"
CAMADA_UNIDADE = "unidade"
CAMADA_FUNCAO = "funcao"
CAMADA_PERFIL = "perfil"


@dataclass(frozen=True)
class Decisao:
    pode: bool
    camada: str  # camada que decidiu (a que fechou a porta, ou "perfil" quando liberou)
    motivo: str


def decidir(
    permissoes: AbstractSet[str],
    permissao: str,
    *,
    unidade: int | None = None,
    unidades_do_usuario: AbstractSet[int] | None = None,
    restrito: bool = False,
) -> Decisao:
    """Decide UMA permissão. `permissoes` = conjunto do perfil (do token). `unidade` = operação/setor do recurso, se houver."""
    # 1. Módulo: o filtro de hoje já cobre módulo desativado, áreas inativas e sessões das funções do módulo desligado.
    if permissao not in acesso.filtrar_permissoes({permissao}):
        modulo = acesso.modulo_da_permissao(permissao)
        return Decisao(False, CAMADA_MODULO, f"Módulo '{modulo}' ou área desligada.")
    # 2. Unidade: só vale para quem é restrito ao escopo de operações e quando o recurso tem unidade.
    if unidade is not None and restrito and unidade not in (unidades_do_usuario or frozenset()):
        return Decisao(False, CAMADA_UNIDADE, f"Sem vínculo com a unidade {unidade}.")
    # 3. Função: Etapa 4 (unidade_funcoes). Hoje não fecha nada.
    # 4. Perfil (exceções na Etapa 5).
    if permissao in permissoes:
        return Decisao(True, CAMADA_PERFIL, "Permitido pelo perfil.")
    return Decisao(False, CAMADA_PERFIL, "O perfil não tem esta permissão.")


def decidir_rota(permissoes: AbstractSet[str], requeridas: Iterable[str], *, exigir_todas: bool = False) -> bool:
    """Mesma semântica de `require_permissions`: uma das requeridas basta, ou todas com `exigir_todas`."""
    lista = tuple(p for p in requeridas if p)
    if not lista:
        return True
    verificar = all if exigir_todas else any
    return verificar(decidir(permissoes, p).pode for p in lista)


# ---------------------------------------------------------------- modo sombra
_lock = threading.Lock()
_contagem = {"comparacoes": 0, "divergencias": 0}


def sombra_ligada() -> bool:
    return os.environ.get("RH_ACESSO_SOMBRA", "1").strip().lower() not in {"0", "false", "nao", "não", "off"}


def comparar_em_sombra(
    permissoes: AbstractSet[str],
    requeridas: Iterable[str],
    *,
    exigir_todas: bool,
    resposta_atual: bool,
    rota: str = "",
    usuario: str = "",
) -> bool | None:
    """Roda a regra nova ao lado da atual. Nunca muda a resposta e nunca levanta erro. Devolve a resposta nova (ou None)."""
    if not sombra_ligada():
        return None
    try:
        lista = tuple(requeridas)
        nova = decidir_rota(permissoes, lista, exigir_todas=exigir_todas)
    except Exception:  # noqa: BLE001 - a sombra jamais pode derrubar um pedido
        logger.exception("acesso_sombra_erro rota=%s", rota)
        return None
    with _lock:
        _contagem["comparacoes"] += 1
        if nova != resposta_atual:
            _contagem["divergencias"] += 1
    if nova != resposta_atual:
        logger.warning(
            "acesso_sombra_divergencia rota=%s usuario=%s requeridas=%s atual=%s nova=%s",
            rota, usuario, ",".join(lista), resposta_atual, nova,
        )
    return nova


def situacao_sombra() -> dict:
    with _lock:
        return {"ligada": sombra_ligada(), **_contagem}


def zerar_sombra() -> None:
    with _lock:
        _contagem.update(comparacoes=0, divergencias=0)
