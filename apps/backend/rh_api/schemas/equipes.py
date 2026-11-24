from __future__ import annotations

from typing import Literal

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
    # O que fazer com a escala de amanhã em diante: levar | manter | outro | refazer (24/11: mover é uma fusão).
    modo_escala: Literal["levar", "manter", "outro", "refazer"] = "outro"
    # Só no modo "outro": turno antigo -> turno do novo supervisor (id) ou "novo" (cópia do antigo).
    turnos: dict[int, int | Literal["novo"]] = {}
    excluir_origem: bool = False
