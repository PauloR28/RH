from __future__ import annotations

from .common import BaseSchema


class EquipeOperadorRequest(BaseSchema):
    id_operador: int


class EquipeRemoverRequest(BaseSchema):
    # Obrigatório quando o supervisor é o único responsável pelo operador.
    id_novo_supervisor: int | None = None


# ---- Equipes na Tecnologia (V076) ----
class EquipeAdminSalvarRequest(BaseSchema):
    nome: str
    operacao: str = ""
    id_supervisor: int | None = None
    id_apoio: int | None = None
    ativo: bool = True


class EquipeMoverRequest(BaseSchema):
    ids_operadores: list[int]
    id_equipe_destino: int
    # turno antigo -> turno do novo supervisor (só os que não têm turno com o mesmo horário).
    turnos: dict[int, int] = {}
