from __future__ import annotations

from .analises_curriculo_ia_repository import AnalisesCurriculoIaRepositoryMixin
from .analytics import AnalyticsRepositoryMixin
from .base import BaseRepository
from .bootstrap import (
    bootstrap_runtime_schema,
    describe_database_error,
    is_deadlock_error,
)
from .candidate_sheet import CandidateSheetRepositoryMixin
from .celebratory_dates import CelebratoryDateRepositoryMixin
from .chamados import ChamadosRepositoryMixin
from .chamados_admin import ChamadosAdminRepositoryMixin
from .communications import CommunicationRepositoryMixin
from .cv_analysis import CvAnalysisRepositoryMixin
from .disc import DiscRepositoryMixin
from .document_templates import DocumentTemplateRepositoryMixin
from .documentos_biblioteca import DocumentosBibliotecaRepositoryMixin
from .email_inbox import EmailInboxRepositoryMixin
from .equipes_controle import EquipesControleRepositoryMixin
from .exam_analytics import ExamAnalyticsRepositoryMixin
from .fit_cultural import FitCulturalRepositoryMixin
from .generated_exams import GeneratedExamRepositoryMixin
from .history import HistoryRepositoryMixin
from .interviews import InterviewRepositoryMixin
from .lgpd_retencao import LgpdRetencaoRepositoryMixin
from .monitoria import MonitoriaRepositoryMixin
from .monitoria_analise import MonitoriaAnaliseRepositoryMixin
from .monitoria_fluxo import MonitoriaFluxoRepositoryMixin
from .monitoria_org import MonitoriaOrgRepositoryMixin
from .monitoria_planos import MonitoriaPlanosRepositoryMixin
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
from .tela_inicial import TelaInicialRepositoryMixin
from .usuarios_massa import UsuariosMassaRepositoryMixin
from .wfm import WfmRepositoryMixin
from .wfm_aprovacao import WfmAprovacaoRepositoryMixin
from .wfm_escala import WfmEscalaRepositoryMixin
from .wfm_gestao import WfmGestaoRepositoryMixin
from .wfm_historico import WfmHistoricoRepositoryMixin
from .wfm_pausas_repo import WfmPausasRepositoryMixin
from .wfm_personalizacao import WfmPersonalizacaoRepositoryMixin
from .wfm_relatorios import WfmRelatoriosRepositoryMixin
from .wfm_trocas import WfmTrocasRepositoryMixin


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
    EquipesControleRepositoryMixin,
    TelaInicialRepositoryMixin,
    LgpdRetencaoRepositoryMixin,
    ChamadosRepositoryMixin,
    ChamadosAdminRepositoryMixin,
    WfmRepositoryMixin,
    WfmEscalaRepositoryMixin,
    WfmPersonalizacaoRepositoryMixin,
    WfmAprovacaoRepositoryMixin,
    WfmGestaoRepositoryMixin,
    WfmHistoricoRepositoryMixin,
    WfmRelatoriosRepositoryMixin,
    UsuariosMassaRepositoryMixin,
    WfmTrocasRepositoryMixin,
    WfmPausasRepositoryMixin,
    BaseRepository,
):
    """Fachada de compatibilidade que agrega os repositorios por dominio."""


__all__ = [
    "DatabaseRepository",
    "bootstrap_runtime_schema",
    "describe_database_error",
    "is_deadlock_error",
]
