const PROCESS_STATUS_CLOSED = 'Encerrado';
const PROCESS_STATUS_PAUSED = 'Pausado';
const PROCESS_STATUS_CANCELED = 'Cancelado';
// Pedido do RH: vagas preenchidas / candidato aprovado não encerram mais o
// processo — ele vira "Em treinamento" e continua fora de isProcessClosed().
export const PROCESS_STATUS_TRAINING = 'Em treinamento';

const CANDIDATE_STATUS_ANALYSIS = 'Em análise';
const CANDIDATE_STATUS_QUALIFIED = 'Qualificado';
const CANDIDATE_STATUS_NOT_QUALIFIED = 'Não qualificado';
const CANDIDATE_STATUS_PENDING_CONFIRMATION = 'Pendente';
const CANDIDATE_STATUS_SCHEDULED = 'Agendado';
const CANDIDATE_STATUS_CONFIRMED = 'Confirmado';
const CANDIDATE_STATUS_RESCHEDULED = 'Reagendado';
const CANDIDATE_STATUS_NO_RESPONSE = 'Não respondeu';
const CANDIDATE_STATUS_CANCELED = 'Cancelado';
const CANDIDATE_STATUS_ATTENDED = 'Compareceu';
const CANDIDATE_STATUS_MISSED = 'Faltou';
const CANDIDATE_STATUS_WITHDREW = 'Desistente';
const CANDIDATE_STATUS_APPROVED = 'Aprovado';
const CANDIDATE_STATUS_ELIMINATED = 'Eliminado';
const CANDIDATE_STATUS_TALENT_BANK = 'Banco de Talentos';

const INTERVIEW_STATUSES = new Set([
  CANDIDATE_STATUS_PENDING_CONFIRMATION,
  CANDIDATE_STATUS_SCHEDULED,
  CANDIDATE_STATUS_CONFIRMED,
  CANDIDATE_STATUS_RESCHEDULED,
  CANDIDATE_STATUS_NO_RESPONSE,
  CANDIDATE_STATUS_CANCELED,
  CANDIDATE_STATUS_ATTENDED,
  CANDIDATE_STATUS_MISSED,
]);

const TERMINAL_STATUSES = new Set([
  CANDIDATE_STATUS_NOT_QUALIFIED,
  CANDIDATE_STATUS_WITHDREW,
  CANDIDATE_STATUS_APPROVED,
  CANDIDATE_STATUS_ELIMINATED,
  CANDIDATE_STATUS_TALENT_BANK,
]);

const ACTIVE_STATUSES = new Set([
  CANDIDATE_STATUS_ANALYSIS,
  CANDIDATE_STATUS_QUALIFIED,
  CANDIDATE_STATUS_PENDING_CONFIRMATION,
  CANDIDATE_STATUS_SCHEDULED,
  CANDIDATE_STATUS_CONFIRMED,
  CANDIDATE_STATUS_RESCHEDULED,
  CANDIDATE_STATUS_NO_RESPONSE,
  CANDIDATE_STATUS_CANCELED,
  CANDIDATE_STATUS_ATTENDED,
]);

function normalizeCompareText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeProcessStatus(status) {
  const value = normalizeCompareText(status);
  if (value === 'pausado' || value === 'pausa') return PROCESS_STATUS_PAUSED;
  if (value === 'cancelado' || value === 'cancelada') return PROCESS_STATUS_CANCELED;
  if (['encerrado', 'arquivado', 'fechado', 'inativo', 'finalizado'].includes(value)) {
    return PROCESS_STATUS_CLOSED;
  }
  return String(status || '').trim() || 'Aberto';
}

export function isProcessClosed(statusOrProcess) {
  if (typeof statusOrProcess === 'object' && statusOrProcess !== null) {
    const status = normalizeProcessStatus(
      statusOrProcess.status || statusOrProcess.status_processo,
    );
    return [PROCESS_STATUS_CLOSED, PROCESS_STATUS_PAUSED, PROCESS_STATUS_CANCELED].includes(status);
  }

  return [PROCESS_STATUS_CLOSED, PROCESS_STATUS_PAUSED, PROCESS_STATUS_CANCELED].includes(
    normalizeProcessStatus(statusOrProcess),
  );
}

export function canonicalizeCandidateStatus(status) {
  const value = normalizeCompareText(status);

  if (!value) return CANDIDATE_STATUS_ANALYSIS;
  if (value === 'analise' || value === 'em analise') return CANDIDATE_STATUS_ANALYSIS;
  if (
    value === 'em processo' ||
    value === 'sem processo vinculado' ||
    value === 'processo unico' ||
    value === 'processo_unico' ||
    value === 'finalizado'
  ) {
    return CANDIDATE_STATUS_ANALYSIS;
  }
  if (value === 'qualificado') return CANDIDATE_STATUS_QUALIFIED;
  if (value === 'nao qualificado') return CANDIDATE_STATUS_NOT_QUALIFIED;
  if (value === 'pendente de confirmacao' || value === 'pendente confirmacao') {
    return CANDIDATE_STATUS_PENDING_CONFIRMATION;
  }
  if (value === 'agendado') return CANDIDATE_STATUS_SCHEDULED;
  if (value === 'entrevista agendada') return CANDIDATE_STATUS_SCHEDULED;
  if (value === 'confirmado') return CANDIDATE_STATUS_CONFIRMED;
  if (value === 'reagendado') return CANDIDATE_STATUS_RESCHEDULED;
  if (value === 'nao respondeu') return CANDIDATE_STATUS_NO_RESPONSE;
  if (value === 'cancelado') return CANDIDATE_STATUS_CANCELED;
  if (value === 'compareceu') return CANDIDATE_STATUS_ATTENDED;
  if (value === 'faltou') return CANDIDATE_STATUS_MISSED;
  if (value === 'desistiu' || value === 'desistente') return CANDIDATE_STATUS_WITHDREW;
  if (value === 'aprovado') return CANDIDATE_STATUS_APPROVED;
  if (value === 'banco de talentos') return CANDIDATE_STATUS_TALENT_BANK;
  if (value === 'reprovado' || value.includes('eliminado')) {
    return CANDIDATE_STATUS_ELIMINATED;
  }

  return String(status || '').trim();
}

export function getCandidateVisibleStatus(candidateOrStatus, statusEntrevista = '') {
  if (
    candidateOrStatus &&
    typeof candidateOrStatus === 'object' &&
    !Array.isArray(candidateOrStatus)
  ) {
    if (candidateOrStatus.status_fluxo) {
      return canonicalizeCandidateStatus(candidateOrStatus.status_fluxo);
    }

    return getCandidateVisibleStatus(
      candidateOrStatus.status_candidato,
      candidateOrStatus.status_entrevista,
    );
  }

  const candidateStatus = canonicalizeCandidateStatus(candidateOrStatus);
  const interviewStatus = String(statusEntrevista || '').trim()
    ? canonicalizeCandidateStatus(statusEntrevista)
    : '';

  if (TERMINAL_STATUSES.has(candidateStatus)) {
    return candidateStatus;
  }

  if (INTERVIEW_STATUSES.has(interviewStatus)) {
    return interviewStatus;
  }

  return candidateStatus;
}

export function isTerminalCandidateStatus(status) {
  return TERMINAL_STATUSES.has(canonicalizeCandidateStatus(status));
}

export function isActiveCandidateStatus(status) {
  return ACTIVE_STATUSES.has(canonicalizeCandidateStatus(status));
}

export function isStandaloneCandidate(candidate) {
  const reference = normalizeCompareText(
    candidate?.id_processo_ref ||
      candidate?.id_processo ||
      candidate?.processo_nome ||
      '',
  );
  const origin = normalizeCompareText(
    candidate?.origem_cadastro || candidate?.origem || '',
  );

  if (!reference) return true;
  if (reference === 'processo_unico' || reference === 'processo unico') {
    return true;
  }
  return origin.includes('avulso') || origin.includes('historico');
}

export function getCandidateActionState(candidate, processStatus = '') {
  if (!candidate) {
    return {
      visibleStatus: CANDIDATE_STATUS_ANALYSIS,
      processClosed: false,
      isActive: true,
      isStandalone: true,
      isFinalized: false,
      canScheduleInterview: false,
      canApprove: false,
      canEliminate: false,
      canSendToTalentBank: false,
      canAttach: false,
      canEdit: false,
      canUseFromTalentBank: false,
      canMoveCandidate: false,
    };
  }

  const visibleStatus = getCandidateVisibleStatus(candidate);
  const closed = isProcessClosed(processStatus || candidate?.status_processo);
  const approved = visibleStatus === CANDIDATE_STATUS_APPROVED;
  const inactive =
    isTerminalCandidateStatus(visibleStatus) ||
    visibleStatus === CANDIDATE_STATUS_MISSED;
  const schedule = !closed && visibleStatus === CANDIDATE_STATUS_QUALIFIED;
  const standalone = isStandaloneCandidate(candidate);
  const finalDecision =
    !closed &&
    !inactive &&
    (visibleStatus === CANDIDATE_STATUS_ANALYSIS ||
      visibleStatus === CANDIDATE_STATUS_ATTENDED ||
      standalone);
  const canMove = !closed && !inactive;

  return {
    visibleStatus,
    processClosed: closed,
    isActive: isActiveCandidateStatus(visibleStatus),
    isStandalone: standalone,
    isFinalized:
      isTerminalCandidateStatus(visibleStatus) ||
      visibleStatus === CANDIDATE_STATUS_MISSED,
    canScheduleInterview: schedule,
    canApprove: !closed && finalDecision,
    canEliminate: !closed && !inactive && finalDecision,
    canSendToTalentBank: !closed && !inactive && finalDecision,
    canAttach: canMove && (standalone || visibleStatus === CANDIDATE_STATUS_TALENT_BANK),
    canEdit: canMove && isActiveCandidateStatus(visibleStatus),
    canUseFromTalentBank: canMove,
    canMoveCandidate: canMove,
  };
}

export function getCandidateFlowGroup(candidate) {
  const status = getCandidateVisibleStatus(candidate);

  if (status === CANDIDATE_STATUS_QUALIFIED) {
    return 'Qualificação';
  }

  if (INTERVIEW_STATUSES.has(status)) {
    return 'Entrevista';
  }

  if (TERMINAL_STATUSES.has(status)) {
    return 'Finalizado';
  }

  return 'Análise';
}

export function getPipelineStageLabel(stage) {
  const value = String(stage || '').trim();

  if (value === 'Triagem') return 'Em análise';
  if (value === 'Prova') return 'Qualificados';
  if (value === 'Entrevista') return 'Entrevistas';
  if (value === 'Aprovado') return 'Aprovados';
  if (value === 'Reprovado') return 'Finalizados';
  return value || 'Etapa';
}

export {
  CANDIDATE_STATUS_ANALYSIS,
  CANDIDATE_STATUS_APPROVED,
  CANDIDATE_STATUS_ATTENDED,
  CANDIDATE_STATUS_CONFIRMED,
  CANDIDATE_STATUS_CANCELED,
  CANDIDATE_STATUS_ELIMINATED,
  CANDIDATE_STATUS_MISSED,
  CANDIDATE_STATUS_NO_RESPONSE,
  CANDIDATE_STATUS_NOT_QUALIFIED,
  CANDIDATE_STATUS_PENDING_CONFIRMATION,
  CANDIDATE_STATUS_QUALIFIED,
  CANDIDATE_STATUS_RESCHEDULED,
  CANDIDATE_STATUS_SCHEDULED,
  CANDIDATE_STATUS_TALENT_BANK,
  CANDIDATE_STATUS_WITHDREW,
  PROCESS_STATUS_CLOSED,
  PROCESS_STATUS_PAUSED,
  PROCESS_STATUS_CANCELED,
};
