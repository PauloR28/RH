from __future__ import annotations

from datetime import datetime

from pydantic import field_validator, model_validator

from .common import BaseSchema


DEFAULT_TEXTO_ENCERRAMENTO = (
    "Chegamos ao final deste treinamento. Agradecemos sua participação e atenção — o conteúdo "
    "apresentado é parte importante do seu desenvolvimento e do trabalho realizado no dia a dia. "
    "Em caso de dúvidas sobre o que foi tratado, procure seu supervisor ou o RH."
)

TIPOS_SAIBA_MAIS = ("dica", "link")


class SaibaMaisItemInput(BaseSchema):
    """Item da lista "Saiba +" (nível módulo ou treinamento): uma dica de texto OU um link externo."""

    tipo: str = "dica"
    texto: str = ""
    url: str = ""

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, value: str) -> str:
        safe_value = str(value or "dica").strip().lower()
        if safe_value not in TIPOS_SAIBA_MAIS:
            raise ValueError(f"Tipo de item \"Saiba +\" inválido: {safe_value}.")
        return safe_value


class TabelaModuloInput(BaseSchema):
    colunas: list[str] = []
    linhas: list[list[str]] = []


class LinkExternoInput(BaseSchema):
    titulo: str = ""
    url: str = ""


class SaibaMaisTreinamentoInput(BaseSchema):
    texto_breve: str = ""
    links: list[LinkExternoInput] = []


class SecaoModuloInput(BaseSchema):
    """Bloco de conteúdo dentro do módulo: um subtítulo com seu texto e, opcionalmente,
    uma ou mais imagens — ao contrário do vídeo (um por módulo), o módulo pode ter
    nenhuma, uma ou várias imagens, distribuídas em vários subtítulos ao longo do
    conteúdo (Correções.txt, rodada de 08/set/2026)."""

    subtitulo: str = ""
    texto: str = ""
    imagens: list[str] = []

    @field_validator("imagens")
    @classmethod
    def validate_imagens(cls, value: list[str]) -> list[str]:
        safe_urls = [str(item or "").strip() for item in (value or [])]
        safe_urls = [item for item in safe_urls if item]
        if len(safe_urls) > 20:
            raise ValueError("Limite de 20 imagens por seção do módulo.")
        return safe_urls


class OnboardingTrilhaItemInput(BaseSchema):
    id_item: int | None = None
    titulo: str = ""
    descricao: str = ""
    ordem: int = 0
    obrigatorio: bool = True
    tipo_conteudo: str = ""
    conteudo_url: str = ""
    # Prompt.txt (rodada 06/set/2026): campos ricos do módulo — ver
    # docs/central-treinamentos/01-plano-tecnico.md §1.2.
    subtitulo: str = ""
    texto_principal: str = ""
    tabela: TabelaModuloInput | None = None
    dica_texto: str = ""
    saiba_mais: list[SaibaMaisItemInput] = []
    # Correções.txt (rodada de 08/set/2026): imagens do módulo — zero, uma ou
    # várias, distribuídas em vários subtítulos ao longo do conteúdo (não um
    # único anexo no final, como o vídeo).
    secoes: list[SecaoModuloInput] = []

    @field_validator("titulo")
    @classmethod
    def validate_titulo(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o título do item da trilha.")
        if len(safe_value) > 255:
            raise ValueError("O título do item deve ter no máximo 255 caracteres.")
        return safe_value


class ModuloImportSchema(OnboardingTrilhaItemInput):
    """Schema do JSON de módulo importável (botão "Baixar modelo JSON" / upload).

    Mesmos campos de `OnboardingTrilhaItemInput` — documentado separadamente em
    docs/central-treinamentos/schema-modulo.json para o usuário final."""


class OcorrenciaTreinamentoInput(BaseSchema):
    """Uma data/horário programado do treinamento (recorrência simples: N ocorrências
    explícitas, sem motor de RRULE — ver plano técnico §1.4)."""

    data_prevista: datetime | None = None
    sem_horario_definido: bool = False
    local: str = ""
    ministrante: str = ""

    @model_validator(mode="after")
    def validate_data_ou_sem_horario(self) -> "OcorrenciaTreinamentoInput":
        if not self.data_prevista and not self.sem_horario_definido:
            raise ValueError("Informe a data/horário da ocorrência ou marque \"sem horário definido\".")
        return self


class OnboardingTrilhaCreateRequest(BaseSchema):
    nome: str = ""
    descricao: str = ""
    ativo: bool = True
    categoria: str = "Onboarding"
    id_operacao: int | None = None
    modalidade: str = ""
    local_padrao: str = ""
    conteudo_json: str | None = None
    itens: list[OnboardingTrilhaItemInput] = []
    texto_encerramento: str = ""
    saiba_mais_treinamento: SaibaMaisTreinamentoInput | None = None
    tipo_obrigatorio: bool = False

    @field_validator("nome")
    @classmethod
    def validate_nome(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o nome da trilha de onboarding.")
        if len(safe_value) > 255:
            raise ValueError("O nome da trilha deve ter no máximo 255 caracteres.")
        return safe_value

    @field_validator("conteudo_json")
    @classmethod
    def validate_conteudo_json(cls, value: str | None) -> str | None:
        if value is None:
            return value
        safe_value = str(value or "").strip()
        if len(safe_value) > 200000:
            raise ValueError("O conteúdo do treinamento é muito longo.")
        return safe_value

    @field_validator("texto_encerramento")
    @classmethod
    def validate_texto_encerramento(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        return safe_value or DEFAULT_TEXTO_ENCERRAMENTO


class OnboardingTrilhaUpdateRequest(OnboardingTrilhaCreateRequest):
    pass


class TreinamentoWizardCreateRequest(OnboardingTrilhaCreateRequest):
    """Publicação final do wizard de criação de treinamento (todas as etapas).

    Cria a trilha + módulos e, para cada (ocorrência × participante), uma linha
    de atribuição (`onboarding_candidatos`) — ver plano técnico §1.4."""

    ocorrencias: list[OcorrenciaTreinamentoInput] = []
    participantes: list[int] = []

    @field_validator("ocorrencias")
    @classmethod
    def validate_ocorrencias(cls, value: list[OcorrenciaTreinamentoInput]) -> list[OcorrenciaTreinamentoInput]:
        if not value:
            raise ValueError("Informe ao menos uma data/ocorrência programada para o treinamento.")
        return value

    @field_validator("participantes")
    @classmethod
    def validate_participantes(cls, value: list[int]) -> list[int]:
        safe_ids = [int(item) for item in (value or []) if item]
        # Participantes esperados é opcional (Correcoes.txt, item Central de
        # Treinamentos): o treinamento fica cadastrado sem nenhuma atribuição
        # (onboarding_candidatos) e reaparece como opção ao criar um novo
        # processo seletivo — não há "sessão" própria sem tabela dedicada
        # (plano técnico §1.4), então sem participantes a(s) ocorrência(s)
        # informada(s) não geram atribuição alguma agora; podem ser criadas
        # depois pela aba Atribuições ou ao liberar vagas de um processo.
        if len(safe_ids) > 500:
            raise ValueError("Limite de 500 participantes por treinamento.")
        return safe_ids


class OnboardingStartRequest(BaseSchema):
    id_registro: int
    trilha_id: int
    data_prevista: datetime | None = None
    local: str = ""
    ministrante: str = ""

    @field_validator("id_registro", "trilha_id")
    @classmethod
    def validate_ids(cls, value: int) -> int:
        if not value or int(value) <= 0:
            raise ValueError("Identificador inválido.")
        return int(value)


class OnboardingItemToggleRequest(BaseSchema):
    concluido: bool = True


class OnboardingAssignmentUpdateRequest(BaseSchema):
    data_prevista: datetime | None = None
    local: str = ""
    ministrante: str = ""
    status: str = "em_andamento"
    acesso_plataforma: bool = False
    metodo_login: str = ""


class OnboardingAttendanceEntry(BaseSchema):
    id_onboarding: int
    presente: bool = False


class OnboardingAttendanceRequest(BaseSchema):
    presencas: list[OnboardingAttendanceEntry] = []


class ProcessTrainingReleaseRequest(BaseSchema):
    candidatos: list[int] = []

    @field_validator("candidatos")
    @classmethod
    def validate_candidatos(cls, value: list[int]) -> list[int]:
        safe_ids = [int(item) for item in (value or []) if item]
        if not safe_ids:
            raise ValueError("Selecione ao menos um candidato para liberar o treinamento.")
        if len(safe_ids) > 200:
            raise ValueError("Limite de 200 candidatos por liberação.")
        return safe_ids


TERMO_LGPD_ANEXO_TREINAMENTO_VERSAO = "1.0-2026-09"
TERMO_LGPD_ANEXO_TREINAMENTO_TEXTO = (
    "Ao liberar este documento para download pelos alunos do treinamento, declaro que: (1) o "
    "arquivo não contém dados sensíveis, pessoais ou confidenciais da empresa em desacordo com a "
    "LGPD; (2) sou responsável pelo conteúdo publicado; (3) esta ação será registrada, com meu "
    "usuário e o horário, para fins de auditoria."
)


class AnexoDownloadToggleRequest(BaseSchema):
    permite_download: bool = False
    termo_aceito: bool = False

    @model_validator(mode="after")
    def validate_aceite(self) -> "AnexoDownloadToggleRequest":
        if self.permite_download and not self.termo_aceito:
            raise ValueError(
                "É necessário aceitar o termo de responsabilidade para liberar o download deste documento."
            )
        return self
