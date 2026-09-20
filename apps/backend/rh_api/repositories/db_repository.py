from __future__ import annotations

from .analytics import AnalyticsRepositoryMixin
from .analises_curriculo_ia_repository import AnalisesCurriculoIaRepositoryMixin
from .base import BaseRepository
from .candidate_sheet import CandidateSheetRepositoryMixin
from .celebratory_dates import CelebratoryDateRepositoryMixin
from .bootstrap import (
    bootstrap_runtime_schema,
    describe_database_error,
    is_deadlock_error,
)
from .cv_analysis import CvAnalysisRepositoryMixin
from .disc import DiscRepositoryMixin
from .document_templates import DocumentTemplateRepositoryMixin
from .documentos_biblioteca import DocumentosBibliotecaRepositoryMixin
from .email_inbox import EmailInboxRepositoryMixin
from .exam_analytics import ExamAnalyticsRepositoryMixin
from .communications import CommunicationRepositoryMixin
from .fit_cultural import FitCulturalRepositoryMixin
from .generated_exams import GeneratedExamRepositoryMixin
from .history import HistoryRepositoryMixin
from .interviews import InterviewRepositoryMixin
from .monitoria import MonitoriaRepositoryMixin
from .monitoria_analise import MonitoriaAnaliseRepositoryMixin
from .monitoria_fluxo import MonitoriaFluxoRepositoryMixin
from .monitoria_planos import MonitoriaPlanosRepositoryMixin
from .monitoria_org import MonitoriaOrgRepositoryMixin
from .mural import MuralRepositoryMixin
from .onboarding import OnboardingRepositoryMixin
from .pipeline import PipelineRepositoryMixin
from .policies import PolicyRepositoryMixin
from .processes import ProcessRepositoryMixin
from .profiles import CandidateProfileRepositoryMixin
from .public_candidacy import PublicCandidacyRepositoryMixin
from .raciocinio_logico import RaciocinioLogicoRepositoryMixin
from .scorecards import ScorecardRepositoryMixin
from .security import SecurityRepositoryMixin
from .sistema import SistemaRepositoryMixin
from .talent_bank import TalentBankRepositoryMixin


class DatabaseRepository(
    SecurityRepositoryMixin,
    AnalisesCurriculoIaRepositoryMixin,
    HistoryRepositoryMixin,
    ProcessRepositoryMixin,
    TalentBankRepositoryMixin,
    CandidateProfileRepositoryMixin,
    CandidateSheetRepositoryMixin,
    CvAnalysisRepositoryMixin,
    EmailInboxRepositoryMixin,
    CommunicationRepositoryMixin,
    GeneratedExamRepositoryMixin,
    ExamAnalyticsRepositoryMixin,
    AnalyticsRepositoryMixin,
    PipelineRepositoryMixin,
    InterviewRepositoryMixin,
    PublicCandidacyRepositoryMixin,
    PolicyRepositoryMixin,
    CelebratoryDateRepositoryMixin,
    OnboardingRepositoryMixin,
    DocumentTemplateRepositoryMixin,
    DocumentosBibliotecaRepositoryMixin,
    DiscRepositoryMixin,
    FitCulturalRepositoryMixin,
    RaciocinioLogicoRepositoryMixin,
    ScorecardRepositoryMixin,
    SistemaRepositoryMixin,
    MuralRepositoryMixin,
    MonitoriaRepositoryMixin,
    MonitoriaFluxoRepositoryMixin,
    MonitoriaPlanosRepositoryMixin,
    MonitoriaAnaliseRepositoryMixin,
    MonitoriaOrgRepositoryMixin,
    BaseRepository,
):
    """Fachada de compatibilidade que agrega os repositorios por dominio."""


__all__ = [
    "DatabaseRepository",
    "bootstrap_runtime_schema",
    "describe_database_error",
    "is_deadlock_error",
]
