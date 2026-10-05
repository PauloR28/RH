"""Regras puras dos Chamados (Suporte TI): status, urgência, SLA. Sem banco e sem HTTP, para testar de forma isolada.

Status e urgência são códigos ASCII no banco; o rótulo acentuado é só apresentação (`ROTULO_STATUS` / `ROTULO_URGENCIA`).
"""

from __future__ import annotations

from datetime import datetime, timedelta

ABERTO = "aberto"
EM_ANDAMENTO = "em_andamento"
AGUARDANDO = "aguardando_solicitante"
RESOLVIDO = "resolvido"
ENCERRADO = "encerrado"
CANCELADO = "cancelado"

STATUS = (ABERTO, EM_ANDAMENTO, AGUARDANDO, RESOLVIDO, ENCERRADO, CANCELADO)
STATUS_FINAIS = frozenset({ENCERRADO, CANCELADO})
STATUS_ATIVOS = tuple(s for s in STATUS if s not in STATUS_FINAIS)
ROTULO_STATUS = {
    ABERTO: "Aberto",
    EM_ANDAMENTO: "Em andamento",
    AGUARDANDO: "Aguardando solicitante",
    RESOLVIDO: "Resolvido",
    ENCERRADO: "Encerrado",
    CANCELADO: "Cancelado",
}

BAIXA, MEDIA, ALTA, CRITICA = "baixa", "media", "alta", "critica"
URGENCIAS = (BAIXA, MEDIA, ALTA, CRITICA)  # ordem crescente de gravidade
ROTULO_URGENCIA = {BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta", CRITICA: "Crítica"}
ORDEM_URGENCIA = {u: i for i, u in enumerate(URGENCIAS)}

IMPACTO_AGENTE = "agente"
IMPACTO_CELULA = "celula"
IMPACTOS = (IMPACTO_AGENTE, IMPACTO_CELULA)

# Atores: quem executa a transição. `sistema` = job agendado ou efeito automático.
ATOR_ATENDENTE = "atendente"
ATOR_SOLICITANTE = "solicitante"
ATOR_SISTEMA = "sistema"

# (origem, destino) -> atores permitidos. Qualquer par fora desta tabela é rejeitado (409).
_TRANSICOES: dict[tuple[str, str], frozenset[str]] = {
    (ABERTO, EM_ANDAMENTO): frozenset({ATOR_ATENDENTE}),
    (ABERTO, CANCELADO): frozenset({ATOR_SOLICITANTE}),
    (EM_ANDAMENTO, AGUARDANDO): frozenset({ATOR_ATENDENTE}),
    (AGUARDANDO, EM_ANDAMENTO): frozenset({ATOR_ATENDENTE, ATOR_SOLICITANTE, ATOR_SISTEMA}),
    (EM_ANDAMENTO, RESOLVIDO): frozenset({ATOR_ATENDENTE}),
    (RESOLVIDO, ENCERRADO): frozenset({ATOR_SOLICITANTE, ATOR_SISTEMA}),
    (RESOLVIDO, EM_ANDAMENTO): frozenset({ATOR_SOLICITANTE}),
    # Reabertura de chamado já encerrado (V060): mesma regra e mesmo chamado; limitada pela janela `reabertura_dias`.
    (ENCERRADO, EM_ANDAMENTO): frozenset({ATOR_SOLICITANTE}),
}


def transicao_valida(origem: str, destino: str, ator: str) -> bool:
    return ator in _TRANSICOES.get((origem, destino), frozenset())


def transicao_existe(origem: str, destino: str) -> bool:
    return (origem, destino) in _TRANSICOES


def destinos_do_atendente(origem: str) -> list[str]:
    return [d for (o, d), atores in _TRANSICOES.items() if o == origem and ATOR_ATENDENTE in atores]


def reabertura_permitida(*, status: str, resolvido_em: datetime | None, encerrado_em: datetime | None, agora: datetime, dias: float) -> bool:
    """Só chamados Resolvidos ou Encerrados podem ser reabertos, dentro de `dias` desde que foram resolvidos/encerrados.
    `dias` <= 0 desliga a reabertura. Cancelado nunca reabre."""
    if status not in (RESOLVIDO, ENCERRADO) or float(dias or 0) <= 0:
        return False
    referencia = (encerrado_em or resolvido_em) if status == ENCERRADO else resolvido_em
    if referencia is None:
        return False
    return agora - referencia <= timedelta(days=float(dias))


# ---------------------------------------------------------------- urgência
def urgencia_minima(*, pa_parada: bool, tipo_impacto: str) -> str:
    """PA parada ou impacto em célula/operação inteira => piso Alta. Pode subir para Crítica, nunca descer de Alta."""
    if pa_parada or tipo_impacto == IMPACTO_CELULA:
        return ALTA
    return BAIXA


def aplicar_piso_urgencia(solicitada: str, *, pa_parada: bool, tipo_impacto: str) -> tuple[str, bool]:
    """Devolve (urgência efetiva, foi_elevada). Corrige para o piso em vez de recusar (a API não precisa conhecer a regra)."""
    piso = urgencia_minima(pa_parada=pa_parada, tipo_impacto=tipo_impacto)
    if ORDEM_URGENCIA[solicitada] < ORDEM_URGENCIA[piso]:
        return piso, True
    return solicitada, False


# ---------------------------------------------------------------- SLA
def calcular_prazo(criado_em: datetime, horas: float, pausado_seg: int = 0) -> datetime:
    return criado_em + timedelta(hours=float(horas)) + timedelta(seconds=int(pausado_seg or 0))


def encerrar_pausa(prazo: datetime, pausa_inicio: datetime, agora: datetime) -> tuple[datetime, int]:
    """Fim da pausa do SLA: devolve (novo prazo, segundos pausados nesta pausa). O prazo é empurrado pelo tempo parado."""
    segundos = max(0, int((agora - pausa_inicio).total_seconds()))
    return prazo + timedelta(seconds=segundos), segundos


def estado_sla(*, status: str, prazo_sla: datetime, pausa_inicio: datetime | None, agora: datetime) -> dict:
    """`pausado`: aguardando o solicitante. `vencido`: passou do prazo e ainda não foi resolvido/encerrado.
    Chamados já resolvidos, encerrados ou cancelados deixam de contar SLA."""
    if status in STATUS_FINAIS or status == RESOLVIDO:
        return {"pausado": False, "vencido": False, "restante_seg": None, "contando": False}
    if status == AGUARDANDO:
        # Prazo "congelado": o restante é medido a partir do início da pausa.
        ref = pausa_inicio or agora
        return {"pausado": True, "vencido": False, "restante_seg": int((prazo_sla - ref).total_seconds()), "contando": False}
    restante = int((prazo_sla - agora).total_seconds())
    return {"pausado": False, "vencido": restante < 0, "restante_seg": restante, "contando": True}
