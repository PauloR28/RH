import { useEffect, useMemo, useState } from '../infraestrutura-react.js';
import { montarHashDaTela, obterTelaPorHash, obterRotaAtual } from '../rotas.js';
import {
  baixarBlob,
  gerarIdResultado,
  sanitizarNomeArquivo,
} from '../utilitarios.js';
import {
  EVENTO_AUTENTICACAO_EXPIRADA,
  agendarEntrevista,
  adicionarCvManualCaixaEmail,
  adicionarPreAnaliseAoProcesso,
  analisarCvCandidatoInscrito,
  analisarCvEmailRecebido,
  analisarCvEmailRecebidoGeral,
  atualizarEntrevista,
  atualizarAnotacaoDossieProcesso,
  aprovarSolicitacaoAlteracaoEmailApi,
  ativarLoginLocalApi,
  atualizarAvatarUsuarioApi,
  atualizarCargoUsuarioApi,
  atualizarNomeUsuarioApi,
  atualizarProvedorAutenticacaoApi,
  atualizarSenhaUsuarioApi,
  atualizarSobrenomeUsuarioApi,
  criarCurriculoManualCaixaEmail,
  listarSolicitacoesAlteracaoEmailApi,
  rejeitarSolicitacaoAlteracaoEmailApi,
  solicitarAlteracaoEmailApi,
  atualizarFichaCandidato,
  atualizarSlotEntrevista,
  atualizarPerfilCandidato,
  atualizarPreAnaliseCv,
  atualizarProcesso,
  atualizarStatusCandidato,
  atualizarStatusCandidatoAvulso,
  analisarCvProcesso,
  baixarAnexoEmailRecebido,
  marcarEmailRecebidoComoLido,
  baixarCvCandidato,
  criarBancoTalentos,
  criarCandidatoNoProcesso,
  criarAnotacaoDossieProcesso,
  criarCardPipeline,
  criarSlotsEntrevista,
  criarProcesso,
  desativarLinkPublicoCandidatura,
  dispensarPreAnaliseCv,
  concluirLoginMicrosoftApi,
  encerrarSessaoApi,
  encerrarProcesso,
  excluirCardPipeline,
  excluirPreAnaliseCv,
  excluirSlotEntrevista,
  enviarEmailRecebidoBancoTalentos,
  enviarPreAnaliseParaBancoTalentos,
  enviarEmailAprovacao,
  fazerLoginApi,
  gerarLinkPublicoCandidatura,
  invalidarCacheApi,
  baixarRelatorioCandidatos,
  baixarRelatorioProcessos,
  ignorarEmailRecebido,
  lerAnalisesCandidatos,
  lerAnotacoesDossieProcesso,
  lerArquivosResposta,
  lerBancoTalentos,
  lerCandidatosSugeridosProcesso,
  lerCandidatosProcessos,
  lerDetalheAnaliseCandidato,
  lerDetalheEmailRecebido,
  lerDetalheProcesso,
  lerEmailsRecebidos,
  lerEmailsRecebidosProcesso,
  lerEntrevistas,
  lerFichaCandidato,
  lerHistorico,
  lerHistoricoPaginado,
  listarProvasGeradas,
  lerPipelineCandidatos,
  lerSessaoAutenticacao,
  limparSessaoAutenticacao,
  lerPreAnalisesCv,
  lerRelatorioCandidatos,
  lerRelatorioProcessos,
  lerProcessos,
  lerScorecardCandidato,
  salvarScorecardCandidato,
  lerSlotsEntrevista,
  limparListaPreAnalisesCv,
  moverCardPipeline,
  reconsiderarEliminacaoCandidato,
  registrarWhatsappAprovacao,
  registrarWhatsappContatoManual,
  vincularEmailRecebidoProcesso,
  possuiSessaoAutenticada,
  removerBancoTalentos,
  revalidarBancoTalentos,
  listarMotivosEliminacao,
  salvarArquivoResposta,
  salvarHistorico,
  uploadCvCandidato,
  usarCandidatoDoBancoTalentos,
  excluirEmailRecebido,
  verificarSessaoApi,
  alterarStatusUsuario,
  atualizarAutomacaoNotificacoes,
  atualizarItemConfiguracao,
  atualizarPermissoesPerfil,
  atualizarUsuario,
  baixarLogsAuditoria,
  criarItemConfiguracao,
  criarUsuario,
  desativarItemConfiguracao,
  excluirUsuario,
  lerAutomacaoNotificacoes,
  listarCatalogoConfiguracoes,
  listarLogsAuditoria,
  listarPerfis,
  listarPermissoes,
  listarUsuarios,
  pausarProcesso,
  redefinirSenhaUsuario,
  registrarSolicitacaoLgpd,
  retomarProcesso,
  cancelarProcesso,
} from '../servico-api.js?v=20260902-perfil-drive-nav';
import { criarLogger } from '../logger.js';
import {
  montarProvaPorBlueprint,
  resolverBlueprintProva,
} from '../perguntas.js';
import {
  baixarPacoteDaProva,
  converterBase64ParaUint8Array,
  finalizarProva,
  montarResumoHistoricoDaProva,
  montarPayloadGabarito,
  montarResumoRegrasDoCandidato,
  validarEntregaObrigatoriaDaProva,
} from '../regras-prova.js';
import {
  CANDIDATE_STATUS_ANALYSIS,
  CANDIDATE_STATUS_ELIMINATED,
  CANDIDATE_STATUS_TALENT_BANK,
  CANDIDATE_STATUS_WITHDREW,
  canonicalizeCandidateStatus,
  getCandidateVisibleStatus,
} from '../shared/process-flow.js';
import { encontrarProcessoPorReferencia } from '../shared/process-reference.js';

const CHAVE_ESTADO = 'rh_react_state_v1';
const CHAVE_BARRA_LATERAL = 'rh_sidebar_collapsed_v1';
const CHAVE_DETALHE_CANDIDATO_RH = 'rh_candidate_detail';
export const TAMANHO_RECENTES = 6;
export const TAMANHO_HISTORICO = 10;
export const TAMANHO_ANALISE = 5;
export const TAMANHO_DETALHE_PROCESSO = 5;
export const MENSAGEM_ACESSO_NEGADO =
  'Você não possui permissão para acessar esta área ou executar esta ação.';
export const PERMISSOES_TELAS = {
  'screen-menu': 'inicio.visualizar',
  'screen-email-inbox': 'candidatos.criar',
  'screen-history': 'candidatos.consultar_historico',
  'screen-process-create': 'vagas.criar',
  'screen-processes': 'vagas.visualizar',
  'screen-processes-closed': 'vagas.visualizar',
  'screen-process-decisions': 'vagas.visualizar',
  'screen-candidates': 'candidatos.visualizar',
  'screen-candidate-details': 'candidatos.visualizar',
  'screen-candidate-pipeline': 'candidatos.mover_etapa',
  'screen-process-details': 'processos.visualizar',
  'screen-interviews': 'entrevistas.visualizar',
  'screen-analysis-candidates': 'relatorios.visualizar',
  'screen-dashboard-funil': 'relatorios.visualizar',
  'screen-talent-bank': 'candidatos.visualizar',
  'screen-training': 'onboarding.visualizar',
  'screen-training-trilhas': 'onboarding.visualizar',
  'screen-training-assignments': 'onboarding.visualizar',
  'screen-onedrive-files': 'onedrive.visualizar',
  'screen-settings': 'configuracoes.visualizar',
  'screen-settings-users': 'usuarios.visualizar',
  'screen-settings-profiles': 'configuracoes.visualizar',
  'screen-settings-operations': 'configuracoes.visualizar',
  'screen-settings-catalog': 'configuracoes.visualizar',
  'screen-settings-logs': 'logs.visualizar',
  'screen-settings-notifications': 'notificacoes.configurar',
  'screen-settings-policies': 'politicas.editar',
  'screen-settings-onboarding': 'onboarding.editar',
  'screen-settings-document-templates': 'documentos_templates.editar',
  'screen-settings-disc': 'provas.questoes_criar',
  'screen-settings-fit-cultural': 'fit_cultural.editar',
  'screen-settings-raciocinio-logico': 'provas.questoes_criar',
  'screen-settings-administracao': 'configuracoes.visualizar',
  'screen-settings-sharepoint-ambiente': 'configuracoes.editar',
  'screen-provas-configuracao': 'configuracoes.visualizar',
  'screen-generated-exams': 'provas.visualizar',
  'screen-process-analytical-results': 'provas.visualizar',
  'screen-config': 'provas.enviar',
  'screen-candidate': 'provas.enviar',
  'screen-exam': 'provas.enviar',
  'screen-result': 'provas.visualizar',
  'screen-thanks': 'provas.enviar',
};
const logger = criarLogger('controlador-aplicacao');

function lerPreferenciaBarraLateral(valorPadrao = false) {
  try {
    const valor = window.localStorage.getItem(CHAVE_BARRA_LATERAL);
    if (valor === '1') return true;
    if (valor === '0') return false;
  } catch (error) {
    logger.debug?.('Não foi possível ler a preferência da barra lateral.', error);
  }

  return Boolean(valorPadrao);
}

function salvarPreferenciaBarraLateral(recolhida) {
  try {
    window.localStorage.setItem(CHAVE_BARRA_LATERAL, recolhida ? '1' : '0');
  } catch (error) {
    logger.debug?.('Não foi possível salvar a preferência da barra lateral.', error);
  }
}

function validarEmailContatoCandidato(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
}

function validarWhatsappContatoCandidato(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 13;
}

/**
 * @typedef {import('../types/models').ApplicationState} ApplicationState
 */

export function criarEstadoInicial() {
  const sessao = lerSessaoAutenticacao();
  const autenticado = Boolean(sessao.token);

  return {
    autenticado,
    validandoSessao: autenticado,
    usuarioAutenticado: sessao.usuario || '',
    nomeUsuarioAutenticado: sessao.nome || sessao.usuario || '',
    sobrenomeUsuarioAutenticado: sessao.sobrenome || '',
    cargoUsuarioAutenticado: sessao.cargo || '',
    emailUsuarioAutenticado: sessao.email || '',
    perfilUsuario: sessao.perfil || '',
    perfilUsuarioNome: sessao.perfil_nome || '',
    nivelPerfilUsuario: sessao.nivel || '',
    permissoesUsuario: Array.isArray(sessao.permissoes) ? sessao.permissoes : [],
    avatarUsuario: sessao.avatar_ilustrado || '',
    provedorAutenticacaoUsuario: sessao.provedor_autenticacao || '',
    avisoAcessoNegado: '',
    barraLateralRecolhida: lerPreferenciaBarraLateral(false),
    candidato: {
      id_processo: '',
      id_processo_ref: '',
      id_registro: '',
      id_entrevista: '',
      id_teste: '',
      role: '',
      level: '',
      track: '',
      time: 40,
      name: '',
      email: '',
      whatsapp: '',
      contatoConfirmado: false,
    },
    processoSelecionado: '',
    personalizacaoProva: {
      enabled: false,
      status: 'Não personalizada',
      questoes: [],
      historico: null,
    },
    questoes: [],
    indiceAtual: 0,
    respostas: [],
    timestampTermino: null,
    segundosRestantes: 0,
    provaFinalizada: false,
    resultados: [],
    totalScore: 0,
    totalMax: 0,
    notaFinalPonderada: 0,
    resumoEtapas: [],
    pendenciasManuais: [],
    idResultadoAtual: null,
    observacaoRh: '',
    statusFinalizacao: 'Finalizado',
    modoFinalizacao: 'normal',
    excelNaoEnviadoConfirmado: false,
    salvandoResultado: false,
    resultadoSalvo: false,
    acessoRhLiberadoAposProva: false,
  };
}

export function hidratarEstado() {
  try {
    const bruto = sessionStorage.getItem(CHAVE_ESTADO);
    if (!bruto) {
      return criarEstadoInicial();
    }

    const salvo = JSON.parse(bruto);
    const estado = {
      ...criarEstadoInicial(),
      ...salvo,
      candidato: {
        ...criarEstadoInicial().candidato,
        ...(salvo?.candidato || {}),
      },
      personalizacaoProva: {
        ...criarEstadoInicial().personalizacaoProva,
        ...(salvo?.personalizacaoProva || {}),
      },
      autenticado: criarEstadoInicial().autenticado,
      validandoSessao: criarEstadoInicial().validandoSessao,
      usuarioAutenticado: criarEstadoInicial().usuarioAutenticado,
      barraLateralRecolhida: lerPreferenciaBarraLateral(salvo?.barraLateralRecolhida),
      salvandoResultado: false,
    };

    if (estado.timestampTermino) {
      estado.segundosRestantes = Math.max(
        0,
        Math.floor((Number(estado.timestampTermino) - Date.now()) / 1000),
      );
    }

    return estado;
  } catch (error) {
    logger.warn('Não foi possível restaurar o estado salvo.', error);
    return criarEstadoInicial();
  }
}

export function persistirEstado(estado) {
  try {
    const {
      autenticado: _autenticado,
      validandoSessao: _validandoSessao,
      usuarioAutenticado: _usuarioAutenticado,
      nomeUsuarioAutenticado: _nomeUsuarioAutenticado,
      sobrenomeUsuarioAutenticado: _sobrenomeUsuarioAutenticado,
      cargoUsuarioAutenticado: _cargoUsuarioAutenticado,
      emailUsuarioAutenticado: _emailUsuarioAutenticado,
      perfilUsuario: _perfilUsuario,
      perfilUsuarioNome: _perfilUsuarioNome,
      nivelPerfilUsuario: _nivelPerfilUsuario,
      permissoesUsuario: _permissoesUsuario,
      avisoAcessoNegado: _avisoAcessoNegado,
      provedorAutenticacaoUsuario: _provedorAutenticacaoUsuario,
      ...estadoPersistivel
    } = estado;

    sessionStorage.setItem(
      CHAVE_ESTADO,
      JSON.stringify({
        ...estadoPersistivel,
        salvandoResultado: false,
      }),
    );
  } catch (error) {
    logger.warn('Não foi possível persistir o estado da aplicação.', error);
  }
}

export function limparEstadoPersistido() {
  try {
    sessionStorage.removeItem(CHAVE_ESTADO);
  } catch (error) {
    logger.warn('Não foi possível limpar o estado persistido.', error);
  }
}

export function navegarParaTela(tela, opcoes = {}) {
  const caminho = montarHashDaTela(tela);
  const eventoNavegacao =
    typeof PopStateEvent === 'function'
      ? new PopStateEvent('popstate')
      : new Event('popstate');
  if (opcoes?.replace) {
    window.history.replaceState(null, '', caminho);
    window.dispatchEvent(eventoNavegacao);
    return;
  }

  window.history.pushState(null, '', caminho);
  window.dispatchEvent(eventoNavegacao);
}

function rotaAtualEhPublica() {
  const telaAtual = obterTelaPorHash(obterRotaAtual());
  return telaAtual === 'screen-public-candidacy' || telaAtual === 'screen-conecta-provas';
}

export function usarTelaAtual(autenticado) {
  const [telaAtual, setTelaAtual] = useState(() =>
    obterTelaPorHash(obterRotaAtual()),
  );

  useEffect(() => {
    const caminhoAtual = String(window.location.pathname || '').replace(/\/+$/, '');
    if (window.location.hash) {
      const rotaLegada = window.location.hash.replace(/^#\/?/, '').trim();
      if (rotaLegada) {
        window.history.replaceState(null, '', `/${rotaLegada}`);
        setTelaAtual(obterTelaPorHash(rotaLegada));
        return;
      }
    }

    if (!obterRotaAtual() && caminhoAtual !== '/conecta-provas') {
      navegarParaTela(autenticado ? 'screen-menu' : 'screen-login');
    }
  }, [autenticado]);

  useEffect(() => {
    const handleRouteChange = () =>
      setTelaAtual(obterTelaPorHash(obterRotaAtual()));
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  return telaAtual;
}

export function obterRegrasFormularioProcesso(vaga) {
  const vagaSegura = String(vaga || '').trim();
  const vagaNormalizada = vagaSegura
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (vagaNormalizada === 'operador' || vagaNormalizada === 'jovem aprendiz') {
    return { exigeOperacao: true, exigeTrilha: false, trilhaFixa: 'Operação' };
  }

  if (vagaNormalizada === 'supervisor') {
    return { exigeOperacao: true, exigeTrilha: false, trilhaFixa: 'Operação / Gestão' };
  }

  if (vagaNormalizada === 'control desk') {
    return { exigeOperacao: false, exigeTrilha: false, trilhaFixa: 'TI' };
  }

  if (vagaNormalizada === 'estagiario') {
    return { exigeOperacao: false, exigeTrilha: true, trilhaFixa: '' };
  }

  if (vagaNormalizada.startsWith('suporte tecnico') || vagaNormalizada === 'ti') {
    return { exigeOperacao: false, exigeTrilha: false, trilhaFixa: 'TI' };
  }

  if (vagaNormalizada === 'planejamento') {
    return { exigeOperacao: false, exigeTrilha: false, trilhaFixa: 'Operação / Gestão' };
  }

  if (vagaNormalizada === 'analista' || vagaNormalizada === 'outros') {
    return { exigeOperacao: false, exigeTrilha: false, trilhaFixa: 'ADM / Gestão' };
  }

  return { exigeOperacao: false, exigeTrilha: false, trilhaFixa: '' };
}

function obterAbreviacaoVaga(vaga) {
  const mapa = {
    'Jovem Aprendiz': 'JV.AP',
    Supervisor: 'SUP',
    Operador: 'OPR',
    Analista: 'ANL',
    Estagiario: 'ESTG',
    Estagiário: 'ESTG',
    'Suporte Técnico Júnior': 'SUP.TI.JR',
    'Suporte Técnico Pleno': 'SUP.TI.PL',
    'Suporte Técnico Sênior': 'SUP.TI.SR',
    Outros: 'OUT',
    'Control Desk': 'CTRL',
    Planejamento: 'PLAN',
    Qualidade: 'QUAL',
    TI: 'TI',
  };

  return mapa[String(vaga || '').trim()] || 'OUT';
}

export function montarIdProcesso(vaga) {
  return `PROC.${obterAbreviacaoVaga(vaga)}`;
}

export function obterClasseSituacaoAtual(rotulo) {
  const normalizado = String(rotulo || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalizado.includes('APROVADO')) return 'is-finished';
  if (normalizado.includes('ELIMINADO')) return 'is-unsaved';
  return 'is-neutral';
}

export async function construirMapaStatusAtual() {
  const [candidatosProcesso, bancoTalentos] = await Promise.all([
    lerCandidatosProcessos().catch(() => []),
    lerBancoTalentos().catch(() => []),
  ]);

  const mapa = {};

  candidatosProcesso.forEach((candidato) => {
    const idTeste = String(candidato.id_teste || '').trim();
    if (!idTeste) return;

    const idProcesso = String(candidato.id_processo || '').trim();
    const idProcessoRef = String(
      candidato.id_processo_ref || candidato.id_processo || '',
    ).trim();
    const status = getCandidateVisibleStatus(candidato);
    mapa[idTeste] = {
      status,
      processId: idProcessoRef,
      label: idProcesso ? `${status} • ${idProcesso}` : status,
    };
  });

  bancoTalentos.forEach((candidato) => {
    const idTeste = String(candidato.id_teste || '').trim();
    if (!idTeste) return;

    const existente = mapa[idTeste];
    const statusExistente = canonicalizeCandidateStatus(existente?.status);

    if (
      !existente ||
      statusExistente === CANDIDATE_STATUS_ANALYSIS ||
      !statusExistente
    ) {
      const idProcesso = String(candidato.id_processo || '').trim();
      const idProcessoRef = String(
        candidato.id_processo_ref || candidato.id_processo || '',
      ).trim();
      mapa[idTeste] = {
        status: CANDIDATE_STATUS_TALENT_BANK,
        processId: idProcessoRef,
        label: idProcesso
          ? `${CANDIDATE_STATUS_TALENT_BANK} • ${idProcesso}`
          : CANDIDATE_STATUS_TALENT_BANK,
      };
    }
  });

  return mapa;
}

export function obterRotuloSituacaoAtual(linha, mapaStatus) {
  const idTeste = String(linha?.id_teste || '').trim();
  const idProcessoHistorico = String(linha?.id_processo || '').trim();
  const mapeado = mapaStatus?.[idTeste];

  if (mapeado?.label) return mapeado.label;
  if (idProcessoHistorico)
    return `${CANDIDATE_STATUS_ANALYSIS} • ${idProcessoHistorico}`;
  return 'Processo individual';
}

export function lerJsonSeguro(texto, fallback = null) {
  try {
    return JSON.parse(texto);
  } catch (error) {
    return fallback;
  }
}

export async function carregarDetalhesProva(idTeste, idProcessoRef = '') {
  const [historico, arquivos, mapaStatus] = await Promise.all([
    lerHistorico(),
    lerArquivosResposta().catch(() => ({})),
    construirMapaStatusAtual(),
  ]);

  const linhasMesmoId = (Array.isArray(historico) ? historico : []).filter(
    (item) =>
      String(item.id_teste || '').trim() === String(idTeste || '').trim(),
  );
  const processoFiltro = String(idProcessoRef || '').trim();
  const linha = processoFiltro
    ? linhasMesmoId.find((item) => {
      const ref = String(item.id_processo_ref || item.id_processo || '').trim();
      return (
        ref === processoFiltro ||
        ref === processoFiltro.split('@@', 1)[0] ||
        ref.split('@@', 1)[0] === processoFiltro.split('@@', 1)[0]
      );
    })
    : linhasMesmoId[0];

  if (!linha) {
    throw new Error('Prova não encontrada.');
  }

  const arquivoSalvo = arquivos[idTeste];
  const payload = arquivoSalvo?.content
    ? lerJsonSeguro(arquivoSalvo.content, null)
    : null;
  const etapasHistorico = linha.etapas_json
    ? lerJsonSeguro(linha.etapas_json, [])
    : [];

  return {
    linha,
    payload,
    resumoEtapas: Array.isArray(payload?.stageSummary)
      ? payload.stageSummary
      : Array.isArray(etapasHistorico)
        ? etapasHistorico
        : [],
    situacaoAtual: obterRotuloSituacaoAtual(linha, mapaStatus),
  };
}

function normalizarComparacao(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizarDigitos(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.startsWith('55') && [12, 13].includes(digitos.length)) {
    return digitos.slice(2);
  }
  return digitos;
}

function valoresNormalizados(...valores) {
  return valores.map((valor) => String(valor || '').trim()).filter(Boolean);
}

function datasMesmoDia(a, b) {
  const dataA = String(a || '').slice(0, 10);
  const dataB = String(b || '').slice(0, 10);
  return Boolean(dataA && dataB && dataA === dataB);
}

function montarReferenciasCandidatoProva(detalhe) {
  const linha = detalhe?.linha || detalhe || {};
  const payload = detalhe?.payload || {};
  const candidato = payload?.candidate || payload?.candidato || {};

  return {
    idsCandidato: valoresNormalizados(
      linha.id_candidato,
      linha.candidato_id,
      candidato.id_candidato,
      candidato.candidato_id,
      candidato.id,
      linha.id_teste,
      payload.id_teste,
    ),
    emails: valoresNormalizados(
      linha.email,
      linha.email_acesso,
      candidato.email,
      candidato.email_acesso,
    ).map(normalizarComparacao),
    telefones: valoresNormalizados(
      linha.telefone,
      linha.telefone_acesso,
      linha.whatsapp,
      candidato.phone,
      candidato.telefone,
      candidato.telefone_acesso,
      candidato.whatsapp,
    ).map(normalizarDigitos).filter(Boolean),
    codigos: valoresNormalizados(
      linha.codigo_acesso,
      linha.codigo_cp,
      linha.codigo_prova,
      payload.codigo_acesso,
      payload.codigo_cp,
      candidato.codigo_acesso,
    ).map((valor) => valor.toUpperCase()),
    idsProva: valoresNormalizados(
      linha.id_prova,
      linha.id_resultado,
      linha.id_historico,
      payload.id_prova,
      payload.id_resultado,
      payload.id_historico,
    ),
    nome: normalizarComparacao(
      linha.nome_candidato || candidato.name || candidato.nome_candidato,
    ),
    data: linha.data_iso || linha.data_exibicao || linha.data || payload.finishedAt || payload.createdAt,
  };
}

function itemCorrespondePorTelefone(item, telefones) {
  if (!telefones.length) return false;
  const telefonesItem = [
    item.telefone,
    item.telefone_acesso,
    item.whatsapp,
    item.celular,
  ]
    .map(normalizarDigitos)
    .filter(Boolean);
  return telefonesItem.some((telefone) => telefones.includes(telefone));
}

function itemCorrespondePorNomeData(item, referencias) {
  const nomeItem = normalizarComparacao(
    item.nome_candidato || item.nome || item.candidato || '',
  );
  const dataItem =
    item.data_iso ||
    item.data_exibicao ||
    item.data_prova ||
    item.data_movimentacao ||
    item.data_entrevista ||
    item.gerada_em ||
    item.atualizado_em;
  return Boolean(
    referencias.nome &&
      nomeItem === referencias.nome &&
      datasMesmoDia(dataItem, referencias.data),
  );
}

function montarCandidatoFichaPorFonte(item) {
  return {
    ...item,
    nome_candidato: item.nome_candidato || item.nome || item.candidato || '',
    email: item.email || item.email_acesso || '',
    telefone: item.telefone || item.telefone_acesso || '',
    whatsapp: item.whatsapp || '',
    id_teste: item.id_teste || item.candidato_id || '',
    data_exibicao:
      item.data_exibicao ||
      item.data_iso ||
      item.data_prova ||
      item.gerada_em ||
      item.data_movimentacao ||
      '',
  };
}

export async function localizarFichaCandidatoPorProva(detalhe) {
  const referencias = montarReferenciasCandidatoProva(detalhe);
  const [historico, candidatosProcessos, bancoTalentos, entrevistas, provasGeradas] =
    await Promise.all([
      lerHistorico().catch(() => []),
      lerCandidatosProcessos().catch(() => []),
      lerBancoTalentos().catch(() => []),
      lerEntrevistas().catch(() => []),
      listarProvasGeradas().catch(() => []),
    ]);

  const fontes = [
    ...(Array.isArray(candidatosProcessos) ? candidatosProcessos : []),
    ...(Array.isArray(bancoTalentos) ? bancoTalentos : []),
    ...(Array.isArray(entrevistas) ? entrevistas : []),
    ...(Array.isArray(provasGeradas) ? provasGeradas : []),
    ...(Array.isArray(historico) ? historico : []),
  ];

  const porIdCandidato = fontes.find((item) =>
    referencias.idsCandidato.some((id) =>
      [
        item.id_candidato,
        item.candidato_id,
        item.id_teste,
        item.id_registro,
      ].some((valor) => String(valor || '').trim() === id),
    ),
  );
  if (porIdCandidato) return montarCandidatoFichaPorFonte(porIdCandidato);

  const porEmail = fontes.find((item) =>
    referencias.emails.includes(
      normalizarComparacao(item.email || item.email_acesso),
    ),
  );
  if (porEmail) return montarCandidatoFichaPorFonte(porEmail);

  const porTelefone = fontes.find((item) =>
    itemCorrespondePorTelefone(item, referencias.telefones),
  );
  if (porTelefone) return montarCandidatoFichaPorFonte(porTelefone);

  const porCodigo = fontes.find((item) =>
    referencias.codigos.some((codigo) =>
      [
        item.codigo_acesso,
        item.codigo_cp,
        item.codigo_prova,
        item.id_teste,
      ].some((valor) => String(valor || '').trim().toUpperCase() === codigo),
    ),
  );
  if (porCodigo) return montarCandidatoFichaPorFonte(porCodigo);

  const porIdProva = fontes.find((item) =>
    referencias.idsProva.some((id) =>
      [
        item.id_prova,
        item.id_resultado,
        item.id_historico,
        item.id_teste,
      ].some((valor) => String(valor || '').trim() === id),
    ),
  );
  if (porIdProva) return montarCandidatoFichaPorFonte(porIdProva);

  const porNomeData = fontes.find((item) =>
    itemCorrespondePorNomeData(item, referencias),
  );
  if (porNomeData) return montarCandidatoFichaPorFonte(porNomeData);

  throw new Error('Não foi possível localizar a ficha deste candidato.');
}

export async function abrirFichaCandidatoDaProva(detalhe) {
  const candidato = await localizarFichaCandidatoPorProva(detalhe);
  sessionStorage.setItem(
    CHAVE_DETALHE_CANDIDATO_RH,
    JSON.stringify(candidato || {}),
  );
  navegarParaTela('screen-candidate-details');
  return candidato;
}

export async function baixarPacoteHistorico(
  idTeste,
  nomeCandidato = 'candidato',
) {
  if (!window.JSZip) {
    throw new Error('A biblioteca JSZip não foi carregada.');
  }

  const arquivos = await lerArquivosResposta();
  const salvo = arquivos[idTeste];

  if (!salvo?.content) {
    throw new Error('Prova não encontrada para este registro.');
  }

  const payload = lerJsonSeguro(salvo.content, null);
  const zip = new window.JSZip();
  const nomeBase = `${sanitizarNomeArquivo(nomeCandidato)}_${sanitizarNomeArquivo(idTeste)}`;
  zip.file(`gabarito_${nomeBase}.txt`, payload?.textContent || salvo.content);

  (payload?.uploadedFiles || []).forEach((arquivo) => {
    const bytes = converterBase64ParaUint8Array(arquivo.contentBase64);
    if (!bytes) return;

    zip.file(
      `excel_respondido_${sanitizarNomeArquivo(arquivo.filename || arquivo.taskId || 'anexo.xlsx')}`,
      bytes,
    );
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  baixarBlob(`prova_${nomeBase}.zip`, blob);
}

export function useControladorAplicacao() {
  const [estado, setEstado] = useState(() => hidratarEstado());
  const blueprint = useMemo(() => {
    if (!estado.candidato?.role || !estado.candidato?.level) {
      return null;
    }

    return resolverBlueprintProva(
      estado.candidato.role,
      estado.candidato.level,
      estado.candidato.track || '',
    );
  }, [estado.candidato]);

  useEffect(() => {
    persistirEstado(estado);
  }, [estado]);

  useEffect(() => {
    let ativo = true;

    const validarSessao = async () => {
      if (!possuiSessaoAutenticada()) {
        if (!ativo) return;

        setEstado((anterior) => ({
          ...anterior,
          autenticado: false,
          validandoSessao: false,
          usuarioAutenticado: '',
          nomeUsuarioAutenticado: '',
          sobrenomeUsuarioAutenticado: '',
          cargoUsuarioAutenticado: '',
          emailUsuarioAutenticado: '',
          perfilUsuario: '',
          perfilUsuarioNome: '',
          nivelPerfilUsuario: '',
          permissoesUsuario: [],
          avatarUsuario: '',
          provedorAutenticacaoUsuario: '',
          avisoAcessoNegado: '',
        }));
        return;
      }

      try {
        const sessao = await verificarSessaoApi();
        if (!ativo) return;

        setEstado((anterior) => ({
          ...anterior,
          autenticado: true,
          validandoSessao: false,
          usuarioAutenticado:
            sessao?.usuario || lerSessaoAutenticacao().usuario,
          nomeUsuarioAutenticado:
            sessao?.nome || lerSessaoAutenticacao().nome || sessao?.usuario || '',
          sobrenomeUsuarioAutenticado:
            sessao?.sobrenome || lerSessaoAutenticacao().sobrenome || '',
          cargoUsuarioAutenticado:
            sessao?.cargo || lerSessaoAutenticacao().cargo || '',
          emailUsuarioAutenticado:
            sessao?.email || lerSessaoAutenticacao().email || '',
          perfilUsuario: sessao?.perfil || lerSessaoAutenticacao().perfil || '',
          perfilUsuarioNome:
            sessao?.perfil_nome || lerSessaoAutenticacao().perfil_nome || '',
          nivelPerfilUsuario: sessao?.nivel || lerSessaoAutenticacao().nivel || '',
          permissoesUsuario: Array.isArray(sessao?.permissoes)
            ? sessao.permissoes
            : lerSessaoAutenticacao().permissoes || [],
          avatarUsuario:
            sessao?.avatar_ilustrado || lerSessaoAutenticacao().avatar_ilustrado || '',
          provedorAutenticacaoUsuario:
            sessao?.provedor_autenticacao || lerSessaoAutenticacao().provedor_autenticacao || '',
          avisoAcessoNegado: '',
        }));
      } catch (error) {
        if (!ativo) return;

        limparEstadoPersistido();
        setEstado(criarEstadoInicial());
        if (!rotaAtualEhPublica()) {
          navegarParaTela('screen-login', { replace: true });
        }
      }
    };

    validarSessao();

    const aoExpirarSessao = () => {
      limparEstadoPersistido();
      setEstado(criarEstadoInicial());
      if (!rotaAtualEhPublica()) {
        navegarParaTela('screen-login', { replace: true });
      }
    };

    window.addEventListener(EVENTO_AUTENTICACAO_EXPIRADA, aoExpirarSessao);

    return () => {
      ativo = false;
      window.removeEventListener(EVENTO_AUTENTICACAO_EXPIRADA, aoExpirarSessao);
    };
  }, []);

  const telaAtual = usarTelaAtual(estado.autenticado);

  useEffect(() => {
    document.body.dataset.screen = telaAtual;
  }, [telaAtual]);

  useEffect(() => {
    if (
      !estado.timestampTermino ||
      estado.provaFinalizada ||
      !estado.questoes.length
    ) {
      return undefined;
    }

    const intervalo = window.setInterval(() => {
      setEstado((anterior) => {
        if (
          !anterior.timestampTermino ||
          anterior.provaFinalizada ||
          !anterior.questoes.length
        ) {
          return anterior;
        }

        const segundosRestantes = Math.max(
          0,
          Math.floor((Number(anterior.timestampTermino) - Date.now()) / 1000),
        );

        if (segundosRestantes <= 0) {
          const blueprintAtual = resolverBlueprintProva(
            anterior.candidato.role,
            anterior.candidato.level,
            anterior.candidato.track || '',
          );
          const resultadoFinal = finalizarProva({
            questoes: anterior.questoes,
            respostas: anterior.respostas,
            blueprint: blueprintAtual,
          });

          navegarParaTela('screen-thanks');

          return {
            ...anterior,
            segundosRestantes: 0,
            provaFinalizada: true,
            timestampTermino: null,
            statusFinalizacao: 'Encerrado automaticamente',
            modoFinalizacao: 'normal',
            excelNaoEnviadoConfirmado: true,
            resultados: resultadoFinal.resultados,
            totalScore: resultadoFinal.totalScore,
            totalMax: resultadoFinal.totalMax,
            notaFinalPonderada: resultadoFinal.notaFinalPonderada,
            resumoEtapas: resultadoFinal.resumoEtapas,
            pendenciasManuais: resultadoFinal.pendenciasManuais,
          };
        }

        return {
          ...anterior,
          segundosRestantes,
        };
      });
    }, 1000);

    return () => window.clearInterval(intervalo);
  }, [estado.timestampTermino, estado.provaFinalizada, estado.questoes.length]);

  const atualizarEstado = (atualizador) => {
    setEstado((anterior) =>
      typeof atualizador === 'function' ? atualizador(anterior) : atualizador,
    );
  };

  const possuiPermissao = (permissao) => {
    if (!permissao) return true;
    return (estado.permissoesUsuario || []).includes(permissao);
  };

  const possuiAlgumaPermissao = (...permissoes) =>
    permissoes.some((permissao) => possuiPermissao(permissao));

  const podeAcessarTela = (tela) => {
    const permissao = PERMISSOES_TELAS[tela];
    return !permissao || possuiPermissao(permissao);
  };

  const registrarAcessoNegado = (mensagem = MENSAGEM_ACESSO_NEGADO) => {
    atualizarEstado((anterior) => ({
      ...anterior,
      avisoAcessoNegado: mensagem,
    }));
  };

  const limparAcessoNegado = () => {
    if (!estado.avisoAcessoNegado) return;
    atualizarEstado((anterior) => ({
      ...anterior,
      avisoAcessoNegado: '',
    }));
  };

  const irParaTelaProtegida = (tela) => {
    if (!estado.autenticado && tela !== 'screen-login') {
      navegarParaTela('screen-login');
      return;
    }

    if (!podeAcessarTela(tela)) {
      registrarAcessoNegado();
      navegarParaTela('screen-forbidden');
      return;
    }

    limparAcessoNegado();
    navegarParaTela(tela);
  };

  const irParaMenu = () => {
    if (!estado.autenticado) {
      navegarParaTela('screen-login');
      return;
    }

    navegarParaTela('screen-menu');
  };

  const atualizarAvatarUsuario = async (avatarIlustrado) => {
    const resultado = await atualizarAvatarUsuarioApi(avatarIlustrado);
    atualizarEstado((anterior) => ({
      ...anterior,
      avatarUsuario: resultado?.avatar_ilustrado || '',
    }));
    return resultado;
  };

  const atualizarNomeUsuario = async (nome) => {
    const resultado = await atualizarNomeUsuarioApi(nome);
    atualizarEstado((anterior) => ({
      ...anterior,
      nomeUsuarioAutenticado: resultado?.nome || anterior.nomeUsuarioAutenticado,
    }));
    return resultado;
  };

  const atualizarSenhaUsuario = async (senhaAtual, novaSenha) =>
    atualizarSenhaUsuarioApi(senhaAtual, novaSenha);

  const atualizarSobrenomeUsuario = async (sobrenome) => {
    const resultado = await atualizarSobrenomeUsuarioApi(sobrenome);
    atualizarEstado((anterior) => ({
      ...anterior,
      sobrenomeUsuarioAutenticado: resultado?.sobrenome || '',
    }));
    return resultado;
  };

  const atualizarCargoUsuario = async (cargo) => {
    const resultado = await atualizarCargoUsuarioApi(cargo);
    atualizarEstado((anterior) => ({
      ...anterior,
      cargoUsuarioAutenticado: resultado?.cargo || '',
    }));
    return resultado;
  };

  const solicitarAlteracaoEmail = async (emailNovo) => solicitarAlteracaoEmailApi(emailNovo);

  const ativarLoginLocal = async (novaSenha, confirmarSenha) => {
    const resultado = await ativarLoginLocalApi(novaSenha, confirmarSenha);
    atualizarEstado((anterior) => ({
      ...anterior,
      provedorAutenticacaoUsuario: resultado?.provedor_autenticacao || 'local',
    }));
    return resultado;
  };

  const atualizarProvedorAutenticacao = async (provedor) => {
    const resultado = await atualizarProvedorAutenticacaoApi(provedor);
    atualizarEstado((anterior) => ({
      ...anterior,
      provedorAutenticacaoUsuario: resultado?.provedor_autenticacao || provedor,
    }));
    return resultado;
  };

  const alternarBarraLateral = () => {
    atualizarEstado((anterior) => {
      const recolhida = !anterior.barraLateralRecolhida;
      salvarPreferenciaBarraLateral(recolhida);
      return {
        ...anterior,
        barraLateralRecolhida: recolhida,
      };
    });
  };

  const aplicarSessaoAutenticada = (sessao, usuarioFallback = '', estadoExtra = {}) => {
    atualizarEstado((anterior) => ({
      ...anterior,
      autenticado: true,
      validandoSessao: false,
      usuarioAutenticado: sessao?.usuario || usuarioFallback,
      nomeUsuarioAutenticado: sessao?.nome || sessao?.usuario || usuarioFallback,
      sobrenomeUsuarioAutenticado: sessao?.sobrenome || '',
      cargoUsuarioAutenticado: sessao?.cargo || '',
      emailUsuarioAutenticado: sessao?.email || '',
      perfilUsuario: sessao?.perfil || '',
      perfilUsuarioNome: sessao?.perfil_nome || '',
      nivelPerfilUsuario: sessao?.nivel || '',
      permissoesUsuario: Array.isArray(sessao?.permissoes)
        ? sessao.permissoes
        : [],
      avatarUsuario: sessao?.avatar_ilustrado || '',
      provedorAutenticacaoUsuario: sessao?.provedor_autenticacao || '',
      avisoAcessoNegado: '',
      ...estadoExtra,
    }));
  };

  const fazerLogin = async (usuario, senha, mfaCode = '') => {
    try {
      const sessao = await fazerLoginApi(usuario, senha, mfaCode);
      aplicarSessaoAutenticada(sessao, usuario);
      navegarParaTela('screen-menu');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        mensagem: error?.message || 'Usuário ou senha inválidos.',
      };
    }
  };

  const concluirLoginMicrosoft = async () => {
    try {
      const sessao = await concluirLoginMicrosoftApi();
      aplicarSessaoAutenticada(sessao);
      navegarParaTela('screen-menu', { replace: true });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        mensagem: error?.message || 'A autenticação Microsoft não foi concluída.',
      };
    }
  };

  const autenticarAcessoAdministrativo = async (usuario, senha) => {
    try {
      const sessao = await fazerLoginApi(usuario, senha);
      aplicarSessaoAutenticada(sessao, usuario, { acessoRhLiberadoAposProva: true });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        mensagem: error?.message || 'Usuário ou senha inválidos.',
      };
    }
  };

  const sair = () => {
    encerrarSessaoApi().catch(() => null);
    limparSessaoAutenticacao();
    limparEstadoPersistido();
    setEstado(criarEstadoInicial());
    navegarParaTela('screen-login', { replace: true });
  };

  const exigirNovoLogin = () => {
    sair();
  };

  const iniciarNovoFluxo = () => {
    if (!possuiPermissao('provas.enviar')) {
      registrarAcessoNegado();
      navegarParaTela('screen-forbidden');
      return;
    }

    atualizarEstado((anterior) => ({
      ...anterior,
      candidato: {
        ...anterior.candidato,
        id_processo: '',
        id_processo_ref: '',
        id_registro: '',
        id_entrevista: '',
        id_teste: '',
        role: '',
        level: '',
        track: '',
        time: 40,
        name: '',
        email: '',
        whatsapp: '',
        contatoConfirmado: false,
      },
      processoSelecionado: '',
      personalizacaoProva: {
        enabled: false,
        status: 'Não personalizada',
        questoes: [],
        historico: null,
      },
      questoes: [],
      indiceAtual: 0,
      respostas: [],
      timestampTermino: null,
      segundosRestantes: 0,
      provaFinalizada: false,
      resultados: [],
      totalScore: 0,
      totalMax: 0,
      notaFinalPonderada: 0,
      resumoEtapas: [],
      pendenciasManuais: [],
      idResultadoAtual: null,
      observacaoRh: '',
      statusFinalizacao: 'Finalizado',
      modoFinalizacao: 'normal',
      excelNaoEnviadoConfirmado: false,
      salvandoResultado: false,
      resultadoSalvo: false,
      acessoRhLiberadoAposProva: false,
    }));

    navegarParaTela('screen-config');
  };

  const configurarFluxo = ({
    role,
    level,
    track,
    time,
    processId,
    scheduledCandidate = null,
    personalizacaoProva = null,
  }) => {
    const resolvedProcessRef = processId === 'PROCESSO_UNICO' ? '' : processId;
    const resolvedProcessId = resolvedProcessRef
      ? String(resolvedProcessRef).split('@@', 1)[0]
      : '';

    atualizarEstado((anterior) => ({
      ...anterior,
      candidato: {
        ...anterior.candidato,
        id_processo: resolvedProcessId,
        id_processo_ref: resolvedProcessRef,
        id_registro: scheduledCandidate?.id_registro || '',
        id_entrevista: scheduledCandidate?.id_entrevista || '',
        id_teste: scheduledCandidate?.id_teste || '',
        role,
        level,
        time,
        track: track || 'automatico',
        name:
          scheduledCandidate?.nome_candidato || anterior.candidato.name || '',
        email: scheduledCandidate?.email || anterior.candidato.email || '',
        whatsapp:
          scheduledCandidate?.whatsapp ||
          scheduledCandidate?.telefone ||
          anterior.candidato.whatsapp ||
          '',
        contatoConfirmado: false,
      },
      processoSelecionado: resolvedProcessRef,
      personalizacaoProva: personalizacaoProva || {
        enabled: false,
        status: 'Não personalizada',
        questoes: [],
        historico: null,
      },
    }));

    navegarParaTela('screen-candidate');
  };

  const atualizarNomeCandidato = (name) => {
    atualizarEstado((anterior) => ({
      ...anterior,
      candidato: {
        ...anterior.candidato,
        name,
        contatoConfirmado: false,
      },
    }));
  };

  const atualizarDadosContatoCandidato = (dadosContato = {}) => {
    atualizarEstado((anterior) => ({
      ...anterior,
      candidato: {
        ...anterior.candidato,
        name:
          dadosContato.name !== undefined
            ? dadosContato.name
            : anterior.candidato.name,
        email:
          dadosContato.email !== undefined
            ? dadosContato.email
            : anterior.candidato.email,
        whatsapp:
          dadosContato.whatsapp !== undefined
            ? dadosContato.whatsapp
            : anterior.candidato.whatsapp,
        contatoConfirmado: false,
      },
    }));
  };

  const confirmarDadosContatoCandidato = async (dadosContato = {}) => {
    const nome = String(
      dadosContato.name !== undefined
        ? dadosContato.name
        : estado.candidato.name || '',
    ).trim();
    const email = String(
      dadosContato.email !== undefined
        ? dadosContato.email
        : estado.candidato.email || '',
    ).trim();
    const whatsapp = String(
      dadosContato.whatsapp !== undefined
        ? dadosContato.whatsapp
        : estado.candidato.whatsapp || '',
    ).trim();

    if (!nome) {
      return {
        ok: false,
        mensagem: 'Informe o nome do candidato para iniciar a prova.',
      };
    }
    if (!validarEmailContatoCandidato(email)) {
      return {
        ok: false,
        mensagem: 'Informe um e-mail válido antes de iniciar a prova.',
      };
    }
    if (!validarWhatsappContatoCandidato(whatsapp)) {
      return {
        ok: false,
        mensagem: 'Informe um WhatsApp válido antes de iniciar a prova.',
      };
    }

    atualizarEstado((anterior) => ({
      ...anterior,
      candidato: {
        ...anterior.candidato,
        name: nome,
        email,
        whatsapp,
        contatoConfirmado: true,
      },
    }));

    if (estado.candidato.id_teste) {
      await atualizarFichaCandidato(estado.candidato.id_teste, {
        nome_candidato: nome,
        email,
        whatsapp,
        telefone: whatsapp,
      });
    }

    return { ok: true, dados: { name: nome, email, whatsapp } };
  };

  const iniciarProva = (nomeCandidato, dadosContatoConfirmados = null) => {
    const nome = String(nomeCandidato || '').trim();
    const email = String(
      dadosContatoConfirmados?.email ?? estado.candidato.email ?? '',
    ).trim();
    const whatsapp = String(
      dadosContatoConfirmados?.whatsapp ?? estado.candidato.whatsapp ?? '',
    ).trim();
    const contatoConfirmado =
      Boolean(dadosContatoConfirmados) ||
      Boolean(estado.candidato.contatoConfirmado);

    if (!nome || !blueprint) {
      return {
        ok: false,
        mensagem: 'Informe o nome do candidato para iniciar a prova.',
      };
    }
    if (!contatoConfirmado) {
      return {
        ok: false,
        mensagem: 'Confirme nome, e-mail e WhatsApp antes de iniciar a prova.',
      };
    }
    if (!validarEmailContatoCandidato(email)) {
      return {
        ok: false,
        mensagem: 'Informe um e-mail válido antes de iniciar a prova.',
      };
    }
    if (!validarWhatsappContatoCandidato(whatsapp)) {
      return {
        ok: false,
        mensagem: 'Informe um WhatsApp válido antes de iniciar a prova.',
      };
    }

    const questoesPersonalizadas = estado.personalizacaoProva?.enabled
      ? estado.personalizacaoProva.questoes
      : null;
    const questoes = Array.isArray(questoesPersonalizadas) &&
      questoesPersonalizadas.length
      ? questoesPersonalizadas
      : montarProvaPorBlueprint(blueprint);
    const tempoMinutos = Number(estado.candidato.time || 40);
    const timestampTermino = Date.now() + tempoMinutos * 60 * 1000;

    atualizarEstado((anterior) => ({
      ...anterior,
      candidato: {
        ...anterior.candidato,
        name: nome,
        email,
        whatsapp,
        contatoConfirmado: true,
      },
      questoes,
      respostas: new Array(questoes.length).fill(null),
      indiceAtual: 0,
      timestampTermino,
      segundosRestantes: tempoMinutos * 60,
      provaFinalizada: false,
      resultados: [],
      totalScore: 0,
      totalMax: 0,
      notaFinalPonderada: 0,
      resumoEtapas: [],
      pendenciasManuais: [],
      idResultadoAtual: null,
      observacaoRh: '',
      statusFinalizacao: 'Finalizado',
      modoFinalizacao: 'normal',
      excelNaoEnviadoConfirmado: false,
      resultadoSalvo: false,
      acessoRhLiberadoAposProva: false,
    }));

    navegarParaTela('screen-exam');
    return { ok: true };
  };

  const atualizarResposta = (indice, resposta) => {
    atualizarEstado((anterior) => {
      const respostas = [...anterior.respostas];
      respostas[indice] = resposta;
      return {
        ...anterior,
        respostas,
      };
    });
  };

  const definirIndiceAtual = (indice) => {
    atualizarEstado((anterior) => ({
      ...anterior,
      indiceAtual: indice,
    }));
  };

  const encerrarProva = (statusFinalizacao = 'Finalizado', opcoes = {}) => {
    if (!blueprint) return;

    const modoDesistencia = opcoes?.modo === 'desistencia';
    if (!modoDesistencia) {
      const validacaoFinalizacao = validarEntregaObrigatoriaDaProva({
        questoes: estado.questoes,
        respostas: estado.respostas,
      });
      if (
        !validacaoFinalizacao?.ok &&
        !(
          validacaoFinalizacao?.tipo === 'excel_nao_enviado' &&
          opcoes?.permitirExcelZero
        )
      ) {
        return validacaoFinalizacao;
      }
    }

    const resultadoFinal = finalizarProva({
      questoes: estado.questoes,
      respostas: estado.respostas,
      blueprint,
    });

    atualizarEstado((anterior) => ({
      ...anterior,
      provaFinalizada: true,
      timestampTermino: null,
      segundosRestantes: 0,
      statusFinalizacao,
      modoFinalizacao: modoDesistencia ? 'desistencia' : 'normal',
      excelNaoEnviadoConfirmado:
        Boolean(opcoes?.permitirExcelZero) || anterior.excelNaoEnviadoConfirmado,
      resultados: resultadoFinal.resultados,
      totalScore: resultadoFinal.totalScore,
      totalMax: resultadoFinal.totalMax,
      notaFinalPonderada: resultadoFinal.notaFinalPonderada,
      resumoEtapas: resultadoFinal.resumoEtapas,
      pendenciasManuais: resultadoFinal.pendenciasManuais,
    }));

    navegarParaTela('screen-thanks');
    return { ok: true };
  };

  const atualizarObservacaoRh = (observacaoRh) => {
    atualizarEstado((anterior) => ({
      ...anterior,
      observacaoRh,
    }));
  };

  const salvarResultado = async () => {
    if (estado.salvandoResultado || estado.resultadoSalvo || !blueprint) {
      return null;
    }

    const modoDesistencia = estado.modoFinalizacao === 'desistencia';
    if (!modoDesistencia) {
      const validacaoFinalizacao = validarEntregaObrigatoriaDaProva({
        questoes: estado.questoes,
        respostas: estado.respostas,
      });
      if (
        !validacaoFinalizacao?.ok &&
        !(
          validacaoFinalizacao?.tipo === 'excel_nao_enviado' &&
          estado.excelNaoEnviadoConfirmado
        )
      ) {
        return validacaoFinalizacao;
      }
    }

    atualizarEstado((anterior) => ({
      ...anterior,
      salvandoResultado: true,
    }));

    try {
      const idResultado =
        estado.idResultadoAtual ||
        estado.candidato.id_teste ||
        gerarIdResultado();
      const agora = new Date();
      const processoSelecionadoNormalizado =
        estado.processoSelecionado === 'PROCESSO_UNICO'
          ? ''
          : estado.processoSelecionado || '';

      const processoVinculado =
        estado.candidato.id_processo_ref ||
        processoSelecionadoNormalizado ||
        '';

      const processoVinculadoBaseBruto =
        estado.candidato.id_processo ||
        (processoVinculado ? String(processoVinculado).split('@@', 1)[0] : '');

      const processoVinculadoBase =
        processoVinculadoBaseBruto === 'PROCESSO_UNICO'
          ? ''
          : processoVinculadoBaseBruto;

      let statusInicialCandidato = modoDesistencia
        ? CANDIDATE_STATUS_WITHDREW
        : CANDIDATE_STATUS_ANALYSIS;

      if (processoVinculado && !modoDesistencia) {
        const processos = await lerProcessos();
        const processo =
          encontrarProcessoPorReferencia(processos, processoVinculado) ||
          processos.find(
            (item) =>
              String(item.id_processo || '').trim() ===
              String(processoVinculadoBase).trim(),
          );

        const usaNotaCorte = Number(processo?.usa_nota_corte || 0) === 1;
        const notaCorte = Number(processo?.nota_corte || 0);

        if (
          usaNotaCorte &&
          !Number.isNaN(notaCorte) &&
          Number(estado.notaFinalPonderada || 0) < notaCorte
        ) {
          statusInicialCandidato = CANDIDATE_STATUS_ELIMINATED;
        }
      }

      const payloadGabarito = montarPayloadGabarito({
        idResultado,
        candidato: estado.candidato,
        blueprint,
        resumoEtapas: estado.resumoEtapas,
        totalScore: estado.totalScore,
        totalMax: estado.totalMax,
        notaFinalPonderada: estado.notaFinalPonderada,
        observacaoRh: estado.observacaoRh,
        questoes: estado.questoes,
        respostas: estado.respostas,
        resultados: estado.resultados,
        personalizacaoProva: estado.personalizacaoProva,
      });

      const linhaHistorico = {
        id_teste: idResultado,
        nome_candidato: estado.candidato.name,
        id_processo: processoVinculadoBase,
        id_processo_ref: processoVinculado,
        vaga: estado.candidato.role,
        nivel: estado.candidato.level,
        trilha: blueprint.label,
        pontuacao_final: estado.notaFinalPonderada.toFixed(1).replace('.', ','),
        pontuacao_bruta: `${estado.totalScore}/${estado.totalMax}`,
        arquivo_gabarito: montarResumoHistoricoDaProva({
          questoes: estado.questoes,
          respostas: estado.respostas,
          totalScore: estado.totalScore,
          totalMax: estado.totalMax,
        }),
        tempo_minutos: estado.candidato.time,
        data_iso: agora.toISOString(),
        data_exibicao: agora.toLocaleString('pt-BR'),
        status: estado.statusFinalizacao || 'Finalizado',
        etapas_json: JSON.stringify(estado.resumoEtapas || []),
      };

      await salvarHistorico(linhaHistorico);
      await salvarArquivoResposta({
        recordId: idResultado,
        payload: JSON.stringify(payloadGabarito),
      });
      if (processoVinculadoBase || processoVinculado) {
        await criarCandidatoNoProcesso({
          id_registro: estado.candidato.id_registro || null,
          id_entrevista: estado.candidato.id_entrevista || null,
          id_processo: processoVinculadoBase,
          id_processo_ref: processoVinculado,
          id_teste: idResultado,
          nome_candidato: estado.candidato.name,
          vaga: estado.candidato.role,
          status_candidato: statusInicialCandidato,
          pontuacao_final: estado.notaFinalPonderada
            .toFixed(1)
            .replace('.', ','),
          data_prova: agora.toISOString(),
          origem: 'Prova',
          etapa_pipeline: modoDesistencia ? 'Reprovado' : undefined,
        });
      }

      if (estado.candidato.email || estado.candidato.whatsapp) {
        try {
          await atualizarFichaCandidato(idResultado, {
            nome_candidato: estado.candidato.name,
            email: estado.candidato.email,
            whatsapp: estado.candidato.whatsapp,
            telefone: estado.candidato.whatsapp,
          });
        } catch (contactError) {
          logger.warn(
            'A prova foi salva, mas os dados de contato não foram sincronizados com a ficha.',
            contactError,
          );
        }
      }

      atualizarEstado((anterior) => ({
        ...anterior,
        idResultadoAtual: idResultado,
        salvandoResultado: false,
        resultadoSalvo: true,
        candidato: {
          ...anterior.candidato,
          id_teste: idResultado,
        },
      }));

      invalidarCacheApi(
        'historico',
        'gabaritos',
        'candidatos-processos',
        'pipeline-candidatos',
      );
      return { ok: true };
    } catch (error) {
      atualizarEstado((anterior) => ({
        ...anterior,
        salvandoResultado: false,
      }));
      return {
        ok: false,
        mensagem:
          error?.message ||
          'Não foi possível salvar a prova no servidor. Verifique a API e tente novamente.',
      };
    }
  };

  const baixarPacoteAtual = async () =>
    baixarPacoteDaProva({
      candidato: estado.candidato,
      questoes: estado.questoes,
      respostas: estado.respostas,
      resultados: estado.resultados,
      notaFinalPonderada: estado.notaFinalPonderada,
      observacaoRh: estado.observacaoRh,
    });

  return {
    estado,
    blueprint,
    regrasCandidato: montarResumoRegrasDoCandidato(blueprint, estado.candidato),
    fazerLogin,
    concluirLoginMicrosoft,
    autenticarAcessoAdministrativo,
    sair,
    exigirNovoLogin,
    alternarBarraLateral,
    atualizarAvatarUsuario,
    atualizarNomeUsuario,
    atualizarSenhaUsuario,
    atualizarSobrenomeUsuario,
    atualizarCargoUsuario,
    solicitarAlteracaoEmail,
    ativarLoginLocal,
    atualizarProvedorAutenticacao,
    possuiPermissao,
    possuiAlgumaPermissao,
    podeAcessarTela,
    registrarAcessoNegado,
    irParaMenu,
    irParaTelaProtegida,
    iniciarNovoFluxo,
    configurarFluxo,
    atualizarNomeCandidato,
    atualizarDadosContatoCandidato,
    confirmarDadosContatoCandidato,
    iniciarProva,
    atualizarResposta,
    definirIndiceAtual,
    encerrarProva,
    atualizarObservacaoRh,
    salvarResultado,
    baixarPacoteAtual,
  };
}

export {
  agendarEntrevista,
  adicionarCvManualCaixaEmail,
  adicionarPreAnaliseAoProcesso,
  analisarCvCandidatoInscrito,
  analisarCvEmailRecebido,
  analisarCvEmailRecebidoGeral,
  atualizarEntrevista,
  atualizarAnotacaoDossieProcesso,
  aprovarSolicitacaoAlteracaoEmailApi,
  ativarLoginLocalApi,
  atualizarAvatarUsuarioApi,
  atualizarCargoUsuarioApi,
  atualizarNomeUsuarioApi,
  atualizarProvedorAutenticacaoApi,
  atualizarSenhaUsuarioApi,
  atualizarSobrenomeUsuarioApi,
  criarCurriculoManualCaixaEmail,
  listarSolicitacoesAlteracaoEmailApi,
  rejeitarSolicitacaoAlteracaoEmailApi,
  solicitarAlteracaoEmailApi,
  atualizarFichaCandidato,
  atualizarSlotEntrevista,
  atualizarPerfilCandidato,
  atualizarPreAnaliseCv,
  atualizarProcesso,
  atualizarStatusCandidato,
  atualizarStatusCandidatoAvulso,
  analisarCvProcesso,
  baixarAnexoEmailRecebido,
  marcarEmailRecebidoComoLido,
  baixarCvCandidato,
  baixarRelatorioCandidatos,
  baixarRelatorioProcessos,
  criarBancoTalentos,
  criarCardPipeline,
  criarAnotacaoDossieProcesso,
  criarSlotsEntrevista,
  criarProcesso,
  desativarLinkPublicoCandidatura,
  dispensarPreAnaliseCv,
  encerrarProcesso,
  excluirCardPipeline,
  excluirPreAnaliseCv,
  excluirSlotEntrevista,
  enviarEmailAprovacao,
  enviarEmailRecebidoBancoTalentos,
  enviarPreAnaliseParaBancoTalentos,
  gerarLinkPublicoCandidatura,
  ignorarEmailRecebido,
  lerAnalisesCandidatos,
  lerAnotacoesDossieProcesso,
  lerBancoTalentos,
  lerCandidatosSugeridosProcesso,
  lerCandidatosProcessos,
  lerDetalheAnaliseCandidato,
  lerDetalheEmailRecebido,
  lerDetalheProcesso,
  lerEmailsRecebidos,
  lerEmailsRecebidosProcesso,
  lerEntrevistas,
  lerFichaCandidato,
  lerHistorico,
  lerHistoricoPaginado,
  lerPipelineCandidatos,
  lerPreAnalisesCv,
  lerRelatorioCandidatos,
  lerRelatorioProcessos,
  lerProcessos,
  lerScorecardCandidato,
  salvarScorecardCandidato,
  lerSlotsEntrevista,
  limparListaPreAnalisesCv,
  moverCardPipeline,
  reconsiderarEliminacaoCandidato,
  registrarWhatsappAprovacao,
  registrarWhatsappContatoManual,
  removerBancoTalentos,
  revalidarBancoTalentos,
  listarMotivosEliminacao,
  excluirEmailRecebido,
  uploadCvCandidato,
  usarCandidatoDoBancoTalentos,
  vincularEmailRecebidoProcesso,
  alterarStatusUsuario,
  atualizarAutomacaoNotificacoes,
  atualizarItemConfiguracao,
  atualizarPermissoesPerfil,
  atualizarUsuario,
  baixarLogsAuditoria,
  criarItemConfiguracao,
  criarUsuario,
  desativarItemConfiguracao,
  excluirUsuario,
  lerAutomacaoNotificacoes,
  listarCatalogoConfiguracoes,
  listarLogsAuditoria,
  listarPerfis,
  listarPermissoes,
  listarUsuarios,
  pausarProcesso,
  redefinirSenhaUsuario,
  registrarSolicitacaoLgpd,
  retomarProcesso,
  cancelarProcesso,
};
