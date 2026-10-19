"""Dias da semana do turno do WFM (escala por dia da semana) — módulo PURO, sem I/O.

Uma escala do operador = um turno + os dias da semana em que ele vale (0 = segunda ... 6 = domingo). O banco guarda
`wfm_turnos.weekdays` como texto de 7 posições ('1111111' = todos os dias, posição 0 = segunda).

Regras (seção 4 do pedido do RH):
  * até `MAX_ESCALAS_OPERADOR` escalas por operador ao mesmo tempo (no período);
  * os dias não se repetem entre as escalas do mesmo operador;
  * dia fora dos weekdays do turno só existe como ajuste manual (o ajuste manual vence o padrão).

Decisão de compatibilidade: turno com os 7 dias é o padrão da migração ("não mudar nada no que já está publicado") e
sobrepõe qualquer outro turno. Por isso ele NÃO entra no limite de 4 nem na checagem de repetição — senão todo operador
que hoje alterna turnos ficaria bloqueado até o gestor restringir os dias. Só turnos com dias restritos formam "escalas".
"""

from __future__ import annotations

from dataclasses import dataclass

MAX_ESCALAS_OPERADOR = 4
TODOS_DIAS = (0, 1, 2, 3, 4, 5, 6)
SEG_A_SEX = (0, 1, 2, 3, 4)
FIM_DE_SEMANA = (5, 6)
NOMES_CURTOS = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")


def dias_de_texto(texto: str | None) -> tuple[int, ...]:
    """'1011000' -> (0, 2, 3). Vazio/None/inválido = todos os dias (turno anterior à migração)."""
    if not texto or len(texto) != 7 or set(texto) - {"0", "1"}:
        return TODOS_DIAS
    return tuple(i for i, c in enumerate(texto) if c == "1")


def texto_de_dias(dias) -> str:
    conjunto = set(dias)
    return "".join("1" if i in conjunto else "0" for i in range(7))


def normalizar_dias(dias, *, tipo_trabalho: bool, padrao=None) -> tuple[int, ...]:
    """Valida a lista vinda da API. Turno de trabalho exige ao menos 1 dia; Folga/DSR pode ficar sem dias.
    `dias=None` (cliente que não conhece o campo) devolve `padrao` — a tela de turno sempre envia os dias explicitamente."""
    if dias is None:
        return tuple(padrao) if padrao is not None else TODOS_DIAS
    try:
        valores = {int(d) for d in dias}
    except (TypeError, ValueError):
        raise ValueError("Dias da semana inválidos.")
    if any(v < 0 or v > 6 for v in valores):
        raise ValueError("Dias da semana inválidos (use 0 = segunda a 6 = domingo).")
    if tipo_trabalho and not valores:
        raise ValueError("Escolha pelo menos um dia da semana para o turno.")
    return tuple(sorted(valores))


def rotulo_dias(dias) -> str:
    """Texto curto: 'Todos os dias', 'Seg a Sex', 'Seg, Ter, Qui' ou '—' (sem dias)."""
    d = tuple(sorted(set(dias)))
    if not d:
        return "—"
    if d == TODOS_DIAS:
        return "Todos os dias"
    if len(d) > 2 and d == tuple(range(d[0], d[0] + len(d))):
        return f"{NOMES_CURTOS[d[0]]} a {NOMES_CURTOS[d[-1]]}"
    return ", ".join(NOMES_CURTOS[i] for i in d)


@dataclass(frozen=True)
class EscalaDoOperador:
    """Um turno (com os dias em que vale) usado pelo operador no período."""

    id_turno: int
    codigo: str
    dias: tuple[int, ...]


def eh_restrita(escala: EscalaDoOperador) -> bool:
    return 0 < len(escala.dias) < 7


def validar_escalas_do_operador(escalas: list[EscalaDoOperador], nome: str = "O colaborador") -> list[str]:
    """Mensagens de bloqueio (vazio = ok) para o conjunto de escalas de um operador no período."""
    restritas = [e for e in {e.id_turno: e for e in escalas}.values() if eh_restrita(e)]
    erros: list[str] = []
    if len(restritas) > MAX_ESCALAS_OPERADOR:
        erros.append(f"{nome} já tem {MAX_ESCALAS_OPERADOR} escalas (turnos em dias diferentes); o máximo é {MAX_ESCALAS_OPERADOR}.")
    dono: dict[int, EscalaDoOperador] = {}
    for e in sorted(restritas, key=lambda x: x.id_turno):
        repetidos: dict[str, list[str]] = {}
        for d in e.dias:
            if d in dono:
                repetidos.setdefault(dono[d].codigo, []).append(NOMES_CURTOS[d])
            else:
                dono[d] = e
        for codigo, dias in repetidos.items():
            erros.append(f"{nome}: o turno {e.codigo} repete {' e '.join(dias) if len(dias) < 3 else ', '.join(dias)}, que já {'é' if len(dias) == 1 else 'são'} do turno {codigo}.")
    return erros


def dia_tem_escala(dia_semana: int, escalas: list[EscalaDoOperador]) -> EscalaDoOperador | None:
    """Turno (entre as escalas do operador) cujos dias contêm `dia_semana`; None = sem escala naquele dia."""
    for e in escalas:
        if dia_semana in e.dias:
            return e
    return None
