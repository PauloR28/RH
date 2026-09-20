"""Máquina de status e SLAs da Monitoria (promt.txt §5.8–5.9; Resumo de Regras).

Funções puras. Toda transição registra quem/quando/status anterior→posterior
(tabela `monitoria_eventos`, append-only). "Baixada" do documento original
passou a se chamar ANULADA (decisão do RH, 20/set/2026).

Ciclo:
  REALIZADA → FEEDBACK_PENDENTE → FEEDBACK_APLICADO → AGUARDANDO_CONFIRMACAO →
     (CONFIRMADA → FINALIZADA)
   | (CONTESTADA → REANALISE → CONFIRMADA | ANULADA → FINALIZADA)
  Condição especial (menos de 3 blocos avaliados):
     REALIZADA → ANULADA → FINALIZADA
SLAs em horas corridas (24x7): feedback 72h, operador 48h, reanálise 72h.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

REALIZADA = "REALIZADA"
FEEDBACK_PENDENTE = "FEEDBACK_PENDENTE"
FEEDBACK_APLICADO = "FEEDBACK_APLICADO"
AGUARDANDO_CONFIRMACAO = "AGUARDANDO_CONFIRMACAO"
CONFIRMADA = "CONFIRMADA"
CONTESTADA = "CONTESTADA"
REANALISE = "REANALISE"
ANULADA = "ANULADA"
FINALIZADA = "FINALIZADA"

ROTULOS_STATUS = {
    REALIZADA: "Monitoria realizada",
    FEEDBACK_PENDENTE: "Feedback pendente",
    FEEDBACK_APLICADO: "Feedback aplicado",
    AGUARDANDO_CONFIRMACAO: "Aguardando confirmação/contestação",
    CONFIRMADA: "Confirmada",
    CONTESTADA: "Contestada",
    REANALISE: "Em reanálise",
    ANULADA: "Anulada",
    FINALIZADA: "Finalizada",
}

SLA_FEEDBACK = "FEEDBACK"
SLA_CONFIRMACAO = "CONFIRMACAO"
SLA_REANALISE = "REANALISE"

# Prazos OFICIAIS (horas). Os limiares de alerta são configuráveis (monitoria_config)
# sem alterar estes valores.
HORAS_SLA_OFICIAIS = {SLA_FEEDBACK: 72, SLA_CONFIRMACAO: 48, SLA_REANALISE: 72}

RESULTADO_CONFIRMADA = "CONFIRMADA"
RESULTADO_ANULADA = "ANULADA"

# Ação → (status de origem permitidos)
ORIGENS_PERMITIDAS: dict[str, frozenset[str]] = {
    "aplicar_feedback": frozenset({FEEDBACK_PENDENTE}),
    "confirmar": frozenset({AGUARDANDO_CONFIRMACAO}),
    "contestar": frozenset({AGUARDANDO_CONFIRMACAO}),
    "replicar": frozenset({REANALISE}),
    "reanalisar": frozenset({REANALISE}),
}

PASSO = tuple[str, str | None]  # (status, sla_tipo iniciado nesse status)


class TransicaoInvalida(Exception):
    """Ação não permitida a partir do status atual."""


def validar_transicao(acao: str, status_atual: str) -> None:
    permitidas = ORIGENS_PERMITIDAS.get(acao)
    if permitidas is None or status_atual not in permitidas:
        raise TransicaoInvalida(
            f"A ação '{acao}' não é permitida com a monitoria em '{ROTULOS_STATUS.get(status_atual, status_atual)}'."
        )


def passos_criacao(anulada: bool) -> list[PASSO]:
    if anulada:
        return [(REALIZADA, None), (ANULADA, None), (FINALIZADA, None)]
    return [(REALIZADA, None), (FEEDBACK_PENDENTE, SLA_FEEDBACK)]


def passos_feedback_aplicado() -> list[PASSO]:
    return [(FEEDBACK_APLICADO, None), (AGUARDANDO_CONFIRMACAO, SLA_CONFIRMACAO)]


def passos_confirmacao() -> list[PASSO]:
    return [(CONFIRMADA, None), (FINALIZADA, None)]


def passos_contestacao() -> list[PASSO]:
    return [(CONTESTADA, None), (REANALISE, SLA_REANALISE)]


def passos_reanalise(resultado: str) -> list[PASSO]:
    if resultado == RESULTADO_CONFIRMADA:
        return [(CONFIRMADA, None), (FINALIZADA, None)]
    if resultado == RESULTADO_ANULADA:
        return [(ANULADA, None), (FINALIZADA, None)]
    raise TransicaoInvalida("Resultado de reanálise inválido: use 'CONFIRMADA' (manter) ou 'ANULADA'.")


def resultado_final(passos: list[PASSO]) -> str | None:
    estados = {status for status, _ in passos}
    if ANULADA in estados:
        return RESULTADO_ANULADA
    if CONFIRMADA in estados:
        return RESULTADO_CONFIRMADA
    return None


def sla_limite(inicio: datetime, sla_tipo: str, horas: dict[str, int] | None = None) -> datetime:
    tabela = {**HORAS_SLA_OFICIAIS, **(horas or {})}
    return inicio + timedelta(hours=int(tabela[sla_tipo]))


ESTADO_DENTRO = "DENTRO_DO_PRAZO"
ESTADO_PROXIMO = "PROXIMO_DO_VENCIMENTO"
ESTADO_VENCIDO = "VENCIDO"
ESTADO_CONCLUIDO_NO_PRAZO = "CONCLUIDO_NO_PRAZO"
ESTADO_CONCLUIDO_FORA = "CONCLUIDO_FORA_DO_PRAZO"


def estado_sla(
    inicio: datetime,
    limite: datetime,
    *,
    agora: datetime,
    concluido_em: datetime | None = None,
    limiar_alerta_pct: int = 75,
) -> dict[str, Any]:
    """Estado do prazo. `limiar_alerta_pct` = % do prazo consumido a partir do qual
    o item fica "próximo do vencimento" (configurável, sem mexer no prazo oficial)."""
    total = (limite - inicio).total_seconds() or 1
    if concluido_em is not None:
        usado = (concluido_em - inicio).total_seconds()
        estado = ESTADO_CONCLUIDO_NO_PRAZO if concluido_em <= limite else ESTADO_CONCLUIDO_FORA
        atraso = max(0.0, (concluido_em - limite).total_seconds())
        return {"estado": estado, "tempo_decorrido_h": round(usado / 3600, 2), "atraso_h": round(atraso / 3600, 2), "restante_h": 0.0}
    decorrido = (agora - inicio).total_seconds()
    restante = (limite - agora).total_seconds()
    if agora > limite:
        estado = ESTADO_VENCIDO
    elif decorrido / total * 100 >= limiar_alerta_pct:
        estado = ESTADO_PROXIMO
    else:
        estado = ESTADO_DENTRO
    return {
        "estado": estado,
        "tempo_decorrido_h": round(decorrido / 3600, 2),
        "atraso_h": round(max(0.0, -restante) / 3600, 2),
        "restante_h": round(max(0.0, restante) / 3600, 2),
    }


def acao_automatica_por_vencimento(status: str, sla_limite_dt: datetime | None, agora: datetime) -> str | None:
    """Ação do job de SLA quando o prazo oficial vence:
      * AGUARDANDO_CONFIRMACAO vencido → confirmação automática;
      * REANALISE vencida → anulação automática;
      * FEEDBACK_PENDENTE vencido → só sinalização (nenhuma mudança de status)."""
    if sla_limite_dt is None or agora <= sla_limite_dt:
        return None
    if status == AGUARDANDO_CONFIRMACAO:
        return "confirmar_automatico"
    if status == REANALISE:
        return "anular_automatico"
    return None
