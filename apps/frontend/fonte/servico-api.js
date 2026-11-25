/**
 * @typedef {import('./types/api').SaveAnswerFileRequest} SaveAnswerFileRequest
 * @typedef {import('./types/api').UpdateCandidateStatusRequest} UpdateCandidateStatusRequest
 * @typedef {import('./types/models').HistoryRecord} HistoryRecord
 * @typedef {import('./types/models').Process} Process
 */


import { requisitar, invalidarCacheApi } from './services/api/core.js?v=20261125-tela-grande';

export async function criarBancoTalentos(dadosCandidato) {
  const { id_banco, ...payload } = dadosCandidato || {};
  const resultado = await requisitar('/talent-bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi(
    'banco-talentos',
    'candidatos-processos',
    'processos',
    'pipeline-candidatos',
  );
  return resultado;
}

export {
  EVENTO_AUTENTICACAO_EXPIRADA,
  invalidarCacheApi,
  limparSessaoAutenticacao,
  lerSessaoAutenticacao,
  possuiSessaoAutenticada,
  salvarSessaoAutenticacao,
} from './services/api/core.js?v=20261125-tela-grande';
export {
  aprovarSolicitacaoAlteracaoEmailApi,
  ativarLoginLocalApi,
  atualizarAvatarUsuarioApi,
  atualizarCargoUsuarioApi,
  atualizarNomeUsuarioApi,
  atualizarProvedorAutenticacaoApi,
  atualizarSenhaUsuarioApi,
  atualizarSobrenomeUsuarioApi,
  concluirLoginMicrosoftApi,
  encerrarSessaoApi,
  fazerLoginApi,
  listarSolicitacoesAlteracaoEmailApi,
  rejeitarSolicitacaoAlteracaoEmailApi,
  solicitarAlteracaoEmailApi,
  verificarSessaoApi,
} from './services/api/auth.js?v=20261125-tela-grande';
export {
  lerArquivosResposta,
  lerHistorico,
  lerHistoricoPaginado,
  salvarArquivoResposta,
  salvarHistorico,
} from './services/api/history.js?v=20261125-tela-grande';
export {
  acessarProvaPorCodigo,
  acessarProvaPorEmail,
  acessarProvaPorTelefone,
  atualizarProvaGerada,
  cancelarProvaGerada,
  confirmarDadosConectaProvas,
  concluirEtapaConectaProvas,
  criarProvaGerada,
  deletarProvaGerada,
  finalizarConectaProvas,
  iniciarConectaProvas,
  iniciarEtapaConectaProvas,
  interromperEtapaConectaProvas,
  lerHeatmapQuestoes,
  lerProvaGerada,
  lerReplayProvaGerada,
  lerSessaoPreviaProvaGerada,
  lerSessaoConectaProvas,
  listarProvasGeradas,
  marcarRevisaoConectaProvas,
  reabrirProvaGerada,
  recalcularScoreProva,
  registrarDecisaoRhProva,
  salvarAvaliacaoManualProva,
  salvarRespostasConectaProvas,
} from './services/api/generated-exams.js?v=20261125-tela-grande';
export {
  atualizarBlocoDisc,
  criarAplicacaoDisc,
  criarBlocoDisc,
  finalizarAplicacaoDiscPublica,
  lerAplicacaoDisc,
  lerAplicacaoDiscPublica,
  lerResultadoDiscCandidato,
  listarBlocosDisc,
} from './services/api/disc.js?v=20261125-tela-grande';
export {
  atualizarValorEmpresa,
  criarValorEmpresa,
  enviarRespostasFitCulturalPublicas,
  lerResultadoFitCultural,
  listarFrasesFitCulturalPublicas,
  listarValoresEmpresa,
} from './services/api/fit-cultural.js?v=20261125-tela-grande';
export {
  atualizarPerguntaRaciocinio,
  avancarRaciocinioAdaptativoPublico,
  criarAplicacaoRaciocinio,
  criarPerguntaRaciocinio,
  excluirPerguntaRaciocinio,
  finalizarAplicacaoRaciocinioPublica,
  lerAplicacaoRaciocinio,
  lerAplicacaoRaciocinioPublica,
  lerResultadoRaciocinioCandidato,
  listarPerguntasRaciocinio,
} from './services/api/raciocinio-logico.js?v=20261125-tela-grande';
export {
  adicionarCvManualCaixaEmail,
  adicionarPreAnaliseAoProcesso,
  analisarCvCandidatoInscrito,
  analisarCurriculoIa,
  criarCurriculoManualCaixaEmail,
  analisarCvEmailRecebido,
  analisarCvEmailRecebidoGeral,
  analisarCvProcesso,
  atualizarAnotacaoDossieProcesso,
  atualizarFichaCandidato,
  atualizarPerfilCandidato,
  atualizarPreAnaliseCv,
  atualizarProcesso,
  atualizarStatusCandidato,
  atualizarStatusCandidatoAvulso,
  baixarCvCandidato,
  baixarAnexoEmailRecebido,
  criarCandidatoNoProcesso,
  criarAnotacaoDossieProcesso,
  criarProcesso,
  desativarLinkPublicoCandidatura,
  dispensarPreAnaliseCv,
  encerrarProcesso,
  excluirPreAnaliseCv,
  enviarEmailRecebidoBancoTalentos,
  gerarLinkPublicoCandidatura,
  enviarPreAnaliseParaBancoTalentos,
  enviarEmailAprovacao,
  ignorarEmailRecebido,
  lerBancoTalentos,
  lerCandidatosSugeridosProcesso,
  lerAnotacoesDossieProcesso,
  lerCandidatosProcessos,
  lerDetalheProcesso,
  lerDetalheEmailRecebido,
  lerEmailsRecebidos,
  lerEmailsRecebidosProcesso,
  lerFichaCandidato,
  lerConfiguracaoAnaliseCurriculoIa,
  lerUltimaAnaliseCurriculoIa,
  lerPreAnalisesCv,
  lerProcessos,
  lerScorecardCandidato,
  salvarScorecardCandidato,
  limparListaPreAnalisesCv,
  pausarProcesso,
  marcarAnaliseCurriculoIaRevisada,
  marcarEmailRecebidoComoLido,
  reconsiderarEliminacaoCandidato,
  registrarWhatsappAprovacao,
  registrarWhatsappContatoManual,
  retomarProcesso,
  removerBancoTalentos,
  revalidarBancoTalentos,
  listarMotivosEliminacao,
  uploadCvCandidato,
  usarCandidatoDoBancoTalentos,
  cancelarProcesso,
  excluirEmailRecebido,
  vincularEmailRecebidoProcesso,
} from './services/api/processes.js?v=20261125-tela-grande';
export {
  enviarCandidaturaPublica,
  lerPaginaPublicaCandidatura,
} from './services/api/public-candidacy.js?v=20261125-tela-grande';
export {
  baixarRelatorioCandidatos,
  baixarRelatorioProcessos,
  lerAnalisesCandidatos,
  lerDetalheAnaliseCandidato,
  lerFunilDashboard,
  lerRelatorioCandidatos,
  lerRelatorioProcessos,
} from './services/api/analytics.js?v=20261125-tela-grande';
export {
  compararResultadosAnaliticos,
  lerConfiguracaoResultadosAnaliticosProcesso,
  lerDetalheResultadoAnalitico,
  lerStatusResultadosAnaliticosProcesso,
  listarResultadosAnaliticosProcesso,
  salvarPerfilIdealResultadosAnaliticos,
  salvarPesosResultadosAnaliticos,
  salvarMapeamentosResultadosAnaliticos,
} from './services/api/exam-analytics.js?v=20261125-tela-grande';
export {
  criarCardPipeline,
  excluirCardPipeline,
  lerPipelineCandidatos,
  moverCardPipeline,
} from './services/api/pipeline.js?v=20261125-tela-grande';
export {
  agendarEntrevista,
  atualizarEntrevista,
  atualizarSlotEntrevista,
  criarSlotsEntrevista,
  excluirSlotEntrevista,
  lerEntrevistas,
  lerSlotsEntrevista,
} from './services/api/interviews.js?v=20261125-tela-grande';
export {
  baixarArquivoOneDrive,
  criarPastaOneDrive,
  enviarArquivoOneDrive,
  excluirItemOneDrive,
  listarArquivosOneDrive,
  obterPreviewOneDrive,
} from './services/api/onedrive.js?v=20261125-tela-grande';
export {
  enviarEmail,
  listarModelosEmail,
} from './services/api/email-send.js?v=20261125-tela-grande';
export {
  alterarStatusUsuario,
  atualizarAutomacaoNotificacoes,
  atualizarItemConfiguracao,
  atualizarPermissoesPerfil,
  atualizarUsuario,
  baixarLogsAuditoria,
  criarItemConfiguracao,
  criarUsuario,
  criarUsuarioRapido,
  desativarItemConfiguracao,
  excluirUsuario,
  lerAutomacaoNotificacoes,
  listarCatalogoConfiguracoes,
  listarLogsAuditoria,
  listarPerfis,
  listarPermissoes,
  listarUsuarios,
  redefinirSenhaUsuario,
  registrarSolicitacaoLgpd,
} from './services/api/settings.js?v=20261125-tela-grande';
export {
  atualizarPolitica,
  buscarPoliticaPendente,
  confirmarLeituraPolitica,
  criarPolitica,
  listarPoliticas,
} from './services/api/policies.js?v=20261125-tela-grande';
export {
  atualizarDataComemorativa,
  buscarEnderecoEmpresaCalendario,
  criarDataComemorativa,
  listarAmbientesCalendario,
  listarDatasComemorativas,
  listarEventosCalendario,
  removerDataComemorativa,
  uploadImagemCalendario,
} from './services/api/calendar.js?v=20261125-tela-grande';
export {
  atualizarAgendaTreinamento,
  atualizarTrilhaOnboarding,
  alternarDownloadAnexo,
  baixarAnexoTreinamento,
  baixarModeloModulo,
  baixarPdfSlideTreinamento,
  buscarCandidatosTreinamento,
  criarTrilhaOnboarding,
  criarTreinamentoWizard,
  excluirAnexoTreinamento,
  excluirAtribuicaoTreinamento,
  excluirTrilhaOnboarding,
  iniciarOnboardingCandidato,
  lerProgressoOnboardingCandidato,
  lerTrilhaOnboarding,
  liberarVagasTreinamento,
  listarAtribuicoesTreinamento,
  listarCandidatosLiberacaoTreinamento,
  listarTreinamentosProcesso,
  listarTrilhasOnboarding,
  marcarItemOnboarding,
  obterSchemaModulo,
  relatorioConclusaoOperacao,
  relatorioPresencaColaborador,
  relatorioTreinamentosStatus,
  salvarPresencaTreinamento,
  uploadAnexoTreinamento,
  uploadSlideTreinamento,
  uploadVideoModulo,
  validarModuloJson,
} from './services/api/onboarding.js?v=20261125-tela-grande';
export {
  excluirNotificacao,
  excluirTodasNotificacoes,
  listarNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
} from './services/api/notifications.js?v=20261125-tela-grande';
export {
  atualizarTemplateDocumento,
  criarTemplateDocumento,
  excluirTemplateDocumento,
  gerarDocumentoPorTemplate,
  listarTemplatesDocumentos,
  listarVariaveisTemplatesDocumentos,
} from './services/api/document-templates.js?v=20261125-tela-grande';
