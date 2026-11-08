from __future__ import annotations

from pydantic import field_validator

from .common import BaseSchema

TIPOS_VALIDOS = {"sequencia_logica", "interpretacao_numerica", "problema_matematico"}
DIFICULDADES_VALIDAS = {"facil", "medio", "dificil"}


class RaciocinioPerguntaCreateRequest(BaseSchema):
    enunciado: str = ""
    tipo: str = ""
    alternativas: list[str] = []
    gabarito: int = 0
    dificuldade: str = ""
    feedback_erro: str = ""
    ativo: bool = True

    @field_validator("enunciado")
    @classmethod
    def validate_enunciado(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o enunciado da questão.")
        return safe_value

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, value: str) -> str:
        safe_value = str(value or "").strip().lower()
        if safe_value not in TIPOS_VALIDOS:
            raise ValueError("Tipo inválido. Use sequencia_logica, interpretacao_numerica ou problema_matematico.")
        return safe_value

    @field_validator("dificuldade")
    @classmethod
    def validate_dificuldade(cls, value: str) -> str:
        safe_value = str(value or "").strip().lower()
        if safe_value not in DIFICULDADES_VALIDAS:
            raise ValueError("Dificuldade inválida. Use facil, medio ou dificil.")
        return safe_value

    @field_validator("alternativas")
    @classmethod
    def validate_alternativas(cls, value: list[str]) -> list[str]:
        limpo = [str(item or "").strip() for item in value if str(item or "").strip()]
        if len(limpo) < 2:
            raise ValueError("Cadastre pelo menos 2 alternativas.")
        return limpo


class RaciocinioPerguntaUpdateRequest(RaciocinioPerguntaCreateRequest):
    pass


class RaciocinioAplicacaoCreateRequest(BaseSchema):
    id_teste: str = ""
    id_processo_ref: int | None = None
    quantidade_questoes: int = 10
    tempo_limite_minutos: int | None = None
    # Roadmap (respostas.txt): modo adaptativo opcional (default False =
    # modo fixo, comportamento existente inalterado) e nivel da vaga
    # opcional, usado para balancear a composicao de dificuldade no modo
    # fixo (ver COMPOSICAO_POR_NIVEL em services/raciocinio_engine.py).
    modo_adaptativo: bool = False
    nivel_vaga: str = ""

    @field_validator("id_teste")
    @classmethod
    def validate_id_teste(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o identificador do candidato (id_teste).")
        return safe_value

    @field_validator("nivel_vaga")
    @classmethod
    def validate_nivel_vaga(cls, value: str) -> str:
        return str(value or "").strip().lower()


class RaciocinioRespostaInput(BaseSchema):
    pergunta_id: int
    alternativa_marcada: int | None = None


class RaciocinioFinalizarRequest(BaseSchema):
    respostas: list[RaciocinioRespostaInput] = []


class RaciocinioProximaAdaptativaRequest(BaseSchema):
    """Modo adaptativo: informa a resposta dada a ultima questao exibida
    (ou nenhuma, na primeira chamada) para que o backend escolha a proxima
    questao com dificuldade adjacente."""

    pergunta_id: int | None = None
    alternativa_marcada: int | None = None
