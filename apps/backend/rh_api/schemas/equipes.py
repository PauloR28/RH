from __future__ import annotations

from .common import BaseSchema


class EquipeOperadorRequest(BaseSchema):
    id_operador: int


class EquipeRemoverRequest(BaseSchema):
    # Obrigatório quando o supervisor é o único responsável pelo operador.
    id_novo_supervisor: int | None = None
