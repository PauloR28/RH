import { IconeSvg } from '../../ui/icone.js';
import { listarMural } from '../../services/api/mural.js';

import {
  html,
  useEffect,
  useMemo,
  useRef,
  useState,
} from '../../infraestrutura-react.js';
import {
  OPCOES_OPERACOES,
  OPCOES_VAGAS_PROVA,
  OPCOES_TRILHAS_PROCESSO,
  OPCOES_VAGAS_PROCESSO,
  SUGESTOES_NIVEL_POR_VAGA,
  montarProvaPorBlueprint,
  resolverBlueprintProva,
} from '../../perguntas.js';
import {
  NIVEIS_PERSONALIZACAO,
  TIPOS_ATENDIMENTO_PERSONALIZACAO,
  gerarPersonalizacaoProva,
  inferirPerfilAtendimentoPersonalizacao,
} from '../prova/services/personalizacao-inteligente.js';
import {
  TAMANHO_HISTORICO,
  TAMANHO_RECENTES,
  atualizarStatusCandidato,
  abrirFichaCandidatoDaProva,
  baixarCvCandidato,
  baixarPacoteHistorico,
  carregarDetalhesProva,
  construirMapaStatusAtual,
  criarProcesso,
  criarSlotsEntrevista,
  lerAnalisesCandidatos,
  lerBancoTalentos,
  lerCandidatosProcessos,
  lerDetalheAnaliseCandidato,
  lerHistorico,
  lerHistoricoPaginado,
  lerEntrevistas,
  lerProcessos,
  montarIdProcesso,
  obterClasseSituacaoAtual,
  obterRegrasFormularioProcesso,
  obterRotuloSituacaoAtual,
  atualizarPerfilCandidato,
  adicionarCvManualCaixaEmail,
  criarCurriculoManualCaixaEmail,
  baixarAnexoEmailRecebido,
  analisarCvEmailRecebidoGeral,
  enviarEmailRecebidoBancoTalentos,
  ignorarEmailRecebido,
  lerDetalheEmailRecebido,
  marcarEmailRecebidoComoLido,
  excluirEmailRecebido,
  lerEmailsRecebidos,
  lerCandidatosSugeridosProcesso,
  removerBancoTalentos,
  revalidarBancoTalentos,
  usarCandidatoDoBancoTalentos,
  vincularEmailRecebidoProcesso,
  lerRelatorioCandidatos,
  lerRelatorioProcessos,
} from '../../app/controlador-aplicacao.js';
import {
  baixarBlob,
  formatarDataParaInput,
  formatarNotaAnalise,
  formatarPercentualAfinidade,
  formatarPontuacaoDetalhada,
  obterItensPaginados,
} from '../../utilitarios.js';
import { abrirBlobEmNovaGuia } from '../../shared/browser-utils.js';
import { resolverAvatarUrl } from '../../shared/avatares.js';
import {
  formatarDataHora,
  obterClasseAderencia,
  obterClasseFaixaNota,
  obterClasseStatusEntrevista,
} from '../../shared/helpers-visuais.js';
import { ModalComporEmail } from '../../shared/components/compose-email-modal.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  ModalCompartilharVaga,
  REQUISITOS_PUBLICOS_PADRAO,
  RESPONSABILIDADES_PUBLICAS_PADRAO,
  montarItensPublicosPadrao,
  montarTextoCompartilhamentoVaga,
} from '../../shared/components/share-job-modal.js?v=20260906-central-treinamentos';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import {
  getCandidateActionState,
  getCandidateVisibleStatus,
  isProcessClosed,
} from '../../shared/process-flow.js';
import { CHAVE_DUPLICAR_PROCESSO, CHAVE_PROCESSO_DETALHE } from '../processos-estado.js';
import { obterTourLogin } from '../../shared/tour-config.js';
import {
  obterChaveProcesso,
  obterReferenciaProcessoDoCandidato,
  obterReferenciaProcesso,
} from '../../shared/process-reference.js';
import {
  quebrarListaTexto,
  validarFormularioProcesso,
  validarPerfilCandidato,
} from '../../shared/validacoes.js';
import { BlocoFiltro, CampoFiltro } from './components/filtros.js';
import { listarOperacoes } from '../../services/api/operations.js';
import { listarTrilhasOnboarding } from '../../services/api/onboarding.js?v=20260904-correcoes-txt3';
import { CHAVE_COMANDO_NOVO_PROCESSO } from '../../ui/busca-global.js';
import {
  AcceptanceDonutChart,
  AvatarUsuario,
  BarComparisonChart,
  EmptyState,
  GrupoPaginacao,
  LoadingState,
  MetricGrid,
  ModalDetalhesProva,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
  WizardStepper,
  WizardSummaryStrip,
} from '../../ui/componentes-compartilhados.js';
import { BotaoAjudaTour, TourGuiado } from '../../ui/tour-guiado.js';

const MENSAGEM_EMAIL_NAO_CONFIGURADO =
  'Caixa de e-mail corporativa ainda não configurada. Informe TENANT_ID, CLIENT_ID e CLIENT_SECRET no servidor.';

const TAMANHO_RELATORIO = 8;
const LIMITE_CACHE_EMAILS_RECEBIDOS = 80;
const TEMPO_CACHE_SECAO_EMAIL_MS = 60 * 60 * 1000;
const cacheSecoesEmail = new Map();

const COLUNAS_RELATORIO_PROCESSOS = [
  { label: 'ID do processo', key: 'id_processo_relatorio' },
  { label: 'Processo', key: 'processo_relatorio' },
  { label: 'Data de abertura', key: 'data_abertura_relatorio' },
  { label: 'Data de encerramento', key: 'data_encerramento_relatorio' },
  { label: 'Status', key: 'status_relatorio' },
  { label: 'Total de vagas', key: 'total_vagas_relatorio' },
  { label: 'Vagas preenchidas', key: 'vagas_preenchidas_relatorio' },
  { label: 'Candidatos', key: 'candidatos_relatorio' },
  { label: 'Aprovados', key: 'aprovados_relatorio' },
  { label: 'Eliminados', key: 'eliminados_relatorio' },
];

const COLUNAS_RELATORIO_CANDIDATOS = [
  { label: 'ID do Candidato', key: 'id_candidato' },
  { label: 'Nome', key: 'nome' },
  { label: 'Telefone', key: 'telefone' },
  { label: 'E-mail', key: 'e_mail' },
  { label: 'Processo', key: 'processo_relatorio' },
  { label: 'Vaga', key: 'vaga_relatorio' },
  { label: 'Data de Entrada', key: 'data_entrada' },
  { label: 'Movimentações', key: 'movimentacoes_completas' },
  { label: 'Nota de Perfil', key: 'nota_perfil' },
  { label: 'Score do CV', key: 'score_cv' },
  { label: 'CV', key: 'cv' },
  { label: 'Justificativa', key: 'justificativa' },
  { label: 'Prova', key: 'prova' },
  { label: 'Data da Prova', key: 'data_da_prova' },
  { label: 'Nota no Word', key: 'nota_word' },
  { label: 'Nota no Excel', key: 'nota_excel' },
  { label: 'Nota nos Conhecimentos Gerais', key: 'nota_conhecimentos_gerais' },
  { label: 'Nota nos Conhecimentos Técnicos', key: 'nota_conhecimentos_tecnicos' },
  { label: 'Nota da Redação', key: 'nota_redacao' },
  { label: 'Aprovação', key: 'aprovacao' },
  { label: 'Eliminação', key: 'eliminacao' },
  { label: 'Motivo da Eliminação', key: 'motivo_da_eliminacao' },
  { label: 'Banco de Talentos', key: 'banco_de_talentos' },
  { label: 'Data de Saída', key: 'data_saida' },
];

const COLUNAS_RANKING_ANALITICO = [
  { label: 'Processo', key: 'id_processo' },
  { label: 'Candidato', key: 'nome_candidato' },
  { label: 'Vaga', key: 'vaga' },
  { label: 'Nota', key: 'nota_final' },
  { label: 'Afinidade', key: 'afinidade_percentual' },
  { label: 'Recomendação', key: 'recomendacao' },
  { label: 'Status', key: 'status_visual' },
];

const OPCOES_NIVEL_PROVA_PROCESSO = [
  { value: '1', label: 'Nível 1' },
  { value: '2', label: 'Nível 2' },
  { value: '3', label: 'Nível 3' },
  { value: '4', label: 'Nível 4' },
  { value: '5', label: 'Nível 5' },
  { value: 'personalizado', label: 'Personalizado' },
];

const OPCOES_AREAS_PROVA_PROCESSO = [
  'Atendimento',
  'Administrativo',
  'Operação',
  'Comercial',
  'Financeiro',
  'RH',
  'TI',
  'Suporte Técnico',
  'Planejamento',
  'Estágio',
  'Gestão',
];

const OPCOES_TOM_PROVA_PROCESSO = [
  'Formal',
  'Corporativo',
  'Humanizado',
  'Técnico',
  'Simples e objetivo',
  'Atendimento ao cliente',
  'Operacional',
];

const OPCAO_OUTRO_PROCESSO = 'Outro';
const ETAPAS_PERSONALIZADAS_PROCESSO = [
  { key: 'word', label: 'Word', termos: ['word'] },
  { key: 'excel', label: 'Excel', termos: ['excel', 'planilha'] },
  { key: 'redacao', label: 'Redação', termos: ['redacao', 'essay'] },
  { key: 'conhecimentos_gerais', label: 'Conhecimentos Gerais', termos: ['geral', 'general'] },
  { key: 'conhecimentos_tecnicos', label: 'Conhecimentos Técnicos', termos: ['tecnico', 'tech', 'sistema', 'ti'] },
];
const ETAPAS_BASE_PERSONALIZADAS_PROCESSO = ['word', 'excel', 'redacao'];

const TIPOS_CONTRATACAO_PROCESSO = ['CLT', 'Temporário', 'PJ', 'Outro'];

const MODELOS_TRABALHO_PROCESSO = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'homeoffice', label: 'Home Office Total (Remoto)' },
  { value: 'hibrido', label: 'Híbrido' },
];

const JORNADAS_TRABALHO_PROCESSO = [
  { value: '6x1', label: '6x1 (6 horas e 20 minutos diárias / 36 horas semanais)' },
  { value: '5x2', label: '5x2 (8 horas e 48 minutos diárias / 44 horas semanais)' },
  { value: '12x36', label: 'Escala 12x36' },
  { value: 'outro', label: 'Outro' },
];

const ESCOLARIDADES_PROCESSO = [
  { value: 'fundamental', label: 'Ensino Fundamental Completo' },
  { value: 'medio', label: 'Ensino Médio Completo' },
  { value: 'superior', label: 'Ensino Superior Completo' },
];

const EXPERIENCIAS_PREVIAS_PROCESSO = [
  { value: 'nenhuma', label: 'Sem Experiência Prévia' },
  { value: 'generica', label: 'Exige experiência genérica em Call Center (mínimo 6 meses)' },
  { value: 'especificas', label: 'Experiências específicas' },
];

const DIAS_SEMANA_JORNADA_PROCESSO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const BENEFICIOS_PROCESSO_PADRAO = [
  'Vale Transporte',
  'Vale Refeição',
  'Vale Alimentação',
  'Plano de Saúde',
  'Cartão Flash',
  'Plano odontológico',
  'Gympass',
];

function mapearNivelDificuldadeProcesso(valor) {
  const nivel = Number(valor) || 3;
  if (nivel <= 2) return 'facil';
  if (nivel === 3) return 'media';
  return 'dificil';
}

const REDES_COMPARTILHAMENTO_PROCESSO = [
  { chave: 'linkedin', label: 'LinkedIn' },
  { chave: 'facebook', label: 'Facebook' },
  { chave: 'instagram', label: 'Instagram' },
  { chave: 'telegram', label: 'Telegram' },
  { chave: 'whatsapp', label: 'WhatsApp' },
  { chave: 'catho', label: 'Catho (em breve)', desativado: true },
];

function normalizarTextoPainel(valor) {
  return String(valor || '').trim();
}

function normalizarBuscaPainel(valor) {
  return normalizarTextoPainel(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function vagaPermiteTipoAtendimentoProcesso(vaga) {
  return ['operador', 'jovem aprendiz'].includes(normalizarBuscaPainel(vaga));
}

function montarChaveCacheSecaoEmail({ mostrarIgnorados = false, query = '' } = {}) {
  return JSON.stringify({
    limite: LIMITE_CACHE_EMAILS_RECEBIDOS,
    mostrarIgnorados: Boolean(mostrarIgnorados),
    query: normalizarTextoPainel(query),
    apenasComAnexos: true,
  });
}

function cacheSecaoEmailEhDeOutroDia(timestamp) {
  const data = new Date(Number(timestamp || 0));
  if (Number.isNaN(data.getTime())) return true;
  return data.toDateString() !== new Date().toDateString();
}

function lerCacheSecaoEmail(chave) {
  const entrada = cacheSecoesEmail.get(chave) || null;
  if (!entrada) return null;
  if (
    cacheSecaoEmailEhDeOutroDia(entrada.timestamp) ||
    Date.now() - Number(entrada.timestamp || 0) > TEMPO_CACHE_SECAO_EMAIL_MS
  ) {
    cacheSecoesEmail.delete(chave);
    return null;
  }
  return entrada;
}

function gravarCacheSecaoEmail(chave, estado) {
  cacheSecoesEmail.set(chave, {
    timestamp: Date.now(),
    payloadEmail: estado?.payloadEmail || null,
    emails: Array.isArray(estado?.emails) ? estado.emails : [],
    processosAbertos: Array.isArray(estado?.processosAbertos) ? estado.processosAbertos : [],
  });
}

function normalizarTrilhaProvaProcesso(valor) {
  const chave = normalizarBuscaPainel(valor);
  if (!chave) return '';
  if (chave.includes('atendimento')) return 'operacao';
  if (chave.includes('comercial')) return 'comercial';
  if (chave.includes('financeiro')) return 'financeiro';
  if (chave.includes('rh')) return 'rh';
  if (chave.includes('ti') || chave.includes('suporte tecnico')) return 'ti';
  if (chave.includes('adm') || chave.includes('administrativo') || chave.includes('gestao')) return 'adm';
  if (chave.includes('operacao') || chave.includes('padrao')) return 'operacao';
  return chave;
}

function normalizarNivelProvaProcesso(valor) {
  const texto = normalizarTextoPainel(valor);
  if (!texto) return '';
  const chave = normalizarBuscaPainel(texto);
  const numero = chave.match(/[1-5]/)?.[0];
  if (numero) return numero;
  if (chave.includes('basico') || chave.includes('junior') || chave.includes('aprendiz')) return '1';
  if (chave.includes('intermediario') || chave.includes('pleno')) return '3';
  if (chave.includes('avancado') || chave.includes('senior') || chave.includes('supervisor')) return '4';
  return texto;
}

function obterOpcaoVagaProvaProcesso(vaga) {
  const chave = normalizarBuscaPainel(vaga);
  if (!chave) return null;
  return (
    OPCOES_VAGAS_PROVA.find((item) => normalizarBuscaPainel(item.label) === chave) ||
    OPCOES_VAGAS_PROVA.find((item) => {
      const label = normalizarBuscaPainel(item.label);
      return label && (chave.includes(label) || label.includes(chave));
    }) ||
    null
  );
}

function montarOpcoesComValorProcesso(opcoes = [], valor = '') {
  const atual = normalizarTextoPainel(valor);
  if (!atual || opcoes.some((opcao) => normalizarBuscaPainel(opcao) === normalizarBuscaPainel(atual))) {
    return opcoes;
  }
  return [atual, ...opcoes];
}

function lerValoresMultiselectProcesso(event) {
  return Array.from(event.target.selectedOptions || [])
    .map((opcao) => normalizarTextoPainel(opcao.value))
    .filter(Boolean);
}

function montarListaComOutroProcesso(lista = [], outro = '') {
  return [
    ...lista.filter((item) => item !== OPCAO_OUTRO_PROCESSO),
    normalizarTextoPainel(outro),
  ].filter(Boolean);
}

function montarEtapasBlueprintProcesso(blueprint) {
  return (blueprint?.stages || []).map((stage) => ({
    key: stage.key || '',
    label: stage.label || stage.key || 'Etapa',
    weight: Number(stage.weight || 0),
    questionCount:
      typeof stage.questions === 'function'
        ? stage.questions().length
        : Array.isArray(stage.questions)
          ? stage.questions.length
          : 0,
  }));
}

function obterCategoriasQuestoesProcesso(questoes = []) {
  return Array.from(
    new Set(
      questoes
        .map((questao) => questao.stage || questao.category || questao.stageKey)
        .filter(Boolean),
    ),
  );
}

function obterChaveEtapaPersonalizadaQuestao(questao = {}) {
  const tipo = normalizarBuscaPainel(questao.type || '');
  const texto = normalizarBuscaPainel([
    questao.stageKey,
    questao.stage,
    questao.category,
    questao.title,
    questao.description,
  ].join(' '));
  if (tipo.includes('essay') || tipo.includes('redacao') || texto.includes('redacao')) return 'redacao';
  if (tipo === 'excel_external' || texto.includes('excel') || texto.includes('planilha')) return 'excel';
  if (tipo === 'word' || texto.includes('word')) return 'word';
  if (texto.includes('tecnico') || texto.includes('tech') || texto.includes('sistema') || texto.includes(' ti ')) {
    return 'conhecimentos_tecnicos';
  }
  if (texto.includes('geral') || texto.includes('general') || texto.includes('conhecimento')) {
    return 'conhecimentos_gerais';
  }
  return 'conhecimentos_gerais';
}

function contextoVagaEtapasPersonalizadas(formulario = {}, trilhaBlueprint = '') {
  const texto = normalizarBuscaPainel([
    formulario.vaga,
    formulario.areaProva,
    formulario.trilha,
    trilhaBlueprint,
  ].join(' '));
  const tokens = texto.split(/[^a-z0-9]+/).filter(Boolean);
  const possuiTokenTi = tokens.includes('ti');
  return {
    texto,
    ti: possuiTokenTi || texto.includes('suporte tecnico') || trilhaBlueprint === 'ti',
    estagiario: texto.includes('estagi'),
    supervisor: texto.includes('supervisor'),
    qualidade: texto.includes('qualidade'),
    planejamento: texto.includes('planejamento'),
  };
}

function obterEtapasDisponiveisPersonalizacaoProcesso(formulario = {}, trilhaBlueprint = '') {
  const contexto = contextoVagaEtapasPersonalizadas(formulario, trilhaBlueprint);
  const permiteGerais =
    contexto.estagiario ||
    contexto.supervisor ||
    contexto.qualidade ||
    contexto.planejamento ||
    contexto.ti;
  const permiteTecnicos =
    contexto.qualidade ||
    contexto.planejamento ||
    contexto.ti ||
    (contexto.estagiario && contexto.ti);
  const permitidas = new Set([
    ...ETAPAS_BASE_PERSONALIZADAS_PROCESSO,
    ...(permiteGerais ? ['conhecimentos_gerais'] : []),
    ...(permiteTecnicos ? ['conhecimentos_tecnicos'] : []),
  ]);
  const etapasOrdenadas = contexto.qualidade
    ? ['word', 'excel', 'redacao', 'conhecimentos_tecnicos', 'conhecimentos_gerais']
      .map((chave) => ETAPAS_PERSONALIZADAS_PROCESSO.find((etapa) => etapa.key === chave))
      .filter(Boolean)
    : ETAPAS_PERSONALIZADAS_PROCESSO;
  return etapasOrdenadas.filter((etapa) => permitidas.has(etapa.key));
}

function montarQuestoesEtapasPersonalizadasProcesso({
  formulario,
  trilhaBlueprint,
  questoesPadrao = [],
}) {
  if (!formulario.personalizacaoInteligente) return questoesPadrao;
  const dificuldade = mapearNivelDificuldadeProcesso(formulario.nivelDificuldade);
  const selecionadas = Array.isArray(formulario.etapasPersonalizadas)
    ? formulario.etapasPersonalizadas
    : [];
  return selecionadas.flatMap((etapaKey) => {
    const nivelEtapa = formulario.manterNivelPadraoEtapas
      ? formulario.nivelProva
      : formulario.niveisEtapas?.[etapaKey];
    const blueprintEtapa = resolverBlueprintProva(formulario.vaga, nivelEtapa, trilhaBlueprint);
    const questoesEtapa = blueprintEtapa ? montarProvaPorBlueprint(blueprintEtapa, dificuldade) : [];
    return questoesEtapa.filter((questao) => obterChaveEtapaPersonalizadaQuestao(questao) === etapaKey);
  });
}

function montarEtapasPersonalizadasProcesso(questoesSelecionadas = [], selecionadas = []) {
  return selecionadas
    .map((etapaKey) => {
      const meta = ETAPAS_PERSONALIZADAS_PROCESSO.find((item) => item.key === etapaKey);
      const questionCount = questoesSelecionadas.filter(
        (questao) => obterChaveEtapaPersonalizadaQuestao(questao) === etapaKey,
      ).length;
      if (!questionCount) return null;
      return {
        key: etapaKey,
        label: meta?.label || etapaKey,
        weight: selecionadas.length ? Number((100 / selecionadas.length).toFixed(2)) : 0,
        questionCount,
      };
    })
    .filter(Boolean);
}

function inferirPerfilOperacaoProcesso(formulario = {}) {
  const base = normalizarBuscaPainel([
    formulario.operacao,
    formulario.areaProva,
    formulario.vaga,
  ].join(' '));
  if (base.includes('davita') || base.includes('endoview') || base.includes('saude')) {
    return 'atendimento_saude';
  }
  if (base.includes('suporte') || base.includes('ti') || base.includes('tecnico')) {
    return 'suporte_ti';
  }
  if (base.includes('financeiro') || base.includes('administrativo') || base.includes('backoffice')) {
    return 'backoffice';
  }
  if (base.includes('rh')) return 'rh_dp';
  return 'call_center';
}

function formatarDataResumoProcesso(valor) {
  if (!valor) return '-';
  const data = new Date(`${valor}T00:00:00`);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function mascararEmailContato(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '-';
  const [usuario, dominio] = texto.split('@');
  if (!usuario || !dominio) return '***';
  const prefixoUsuario = usuario.slice(0, Math.min(2, usuario.length));
  const partesDominio = dominio.split('.');
  const dominioBase = partesDominio.shift() || '';
  const sufixoDominio = partesDominio.length ? `.${partesDominio.join('.')}` : '';
  return `${prefixoUsuario}${'*'.repeat(Math.max(3, usuario.length - prefixoUsuario.length))}@${dominioBase.slice(0, 1)}***${sufixoDominio}`;
}

function mascararTelefoneContato(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '-';
  if (digitos.length <= 4) return '****';
  const ultimos = digitos.slice(-4);
  const ddd = digitos.length >= 10 ? `(${digitos.slice(-11, -9)}) ` : '';
  return `${ddd}*****-${ultimos}`;
}

function obterIntervaloPaginacao(paginacao) {
  const total = Number(paginacao?.totalItens || 0);
  if (!total) return '0-0';

  const inicio = (Number(paginacao.paginaAtual || 1) - 1) * Number(paginacao.tamanhoPagina || paginacao.itens?.length || 1) + 1;
  const fim = Math.min(total, inicio + Number(paginacao.itens?.length || 0) - 1);
  return `${inicio}-${fim}`;
}

function formatarDataRelatorio(valor) {
  if (!valor) return '-';
  const texto = String(valor || '').trim();
  const data = /^\d{4}-\d{2}-\d{2}$/.test(texto)
    ? new Date(`${texto}T00:00:00`)
    : new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor || '-');
  return data.toLocaleDateString('pt-BR');
}

function formatarAtualizacaoRelatorio(valor) {
  if (!valor) return 'Última atualização: aguardando atualização';
  return `Última atualização: hoje às ${valor.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function obterPrimeiroValorRelatorio(linha, campos = [], fallback = '-') {
  for (const campo of campos) {
    const valor = linha?.[campo];
    if (valor !== undefined && valor !== null && valor !== '') {
      return valor;
    }
  }
  return fallback;
}

function obterIdRelatorioProcesso(linha) {
  return String(
    obterPrimeiroValorRelatorio(linha, [
      'id_processo_ref',
      'id_processo',
      'nome_relatorio_processo',
    ], ''),
  ).trim();
}

function obterNomeRelatorioProcesso(linha) {
  return obterPrimeiroValorRelatorio(linha, [
    'processo',
    'nome_processo',
    'vaga',
    'nome_relatorio_processo',
  ]);
}

function obterStatusRelatorioProcesso(linha) {
  return obterPrimeiroValorRelatorio(linha, ['status_processo', 'status'], 'Aberto');
}

function obterClasseStatusRelatorioProcesso(status) {
  const texto = normalizarBuscaPainel(status);
  if (texto.includes('encerr')) return 'is-muted';
  if (texto.includes('cancel') || texto.includes('reprov') || texto.includes('elimin')) return 'is-eliminated';
  if (texto.includes('abert') || texto.includes('ativo')) return 'is-approved';
  return 'is-analysis';
}

function formatarNumeroRelatorio(valor, fallback = '0') {
  if (valor === undefined || valor === null || valor === '') return fallback;
  return valor;
}

function textoBuscaRelatorioProcesso(linha) {
  return [
    obterIdRelatorioProcesso(linha),
    obterNomeRelatorioProcesso(linha),
    linha?.vaga,
    linha?.operacao,
    linha?.trilha,
  ].join(' ');
}

function formatarDataArquivoHoje() {
  const data = new Date();
  const pad = (valor) => String(valor).padStart(2, '0');
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}

function normalizarValorExportacao(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor);
}

function escaparCampoCsv(valor) {
  const texto = normalizarValorExportacao(valor);
  if (/[;"\n\r]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function baixarCsvRelatorio(nomeBase, colunas, linhas) {
  const conteudo = [
    colunas.map((coluna) => escaparCampoCsv(coluna.label)).join(';'),
    ...linhas.map((linha) =>
      colunas.map((coluna) => escaparCampoCsv(linha[coluna.key])).join(';'),
    ),
  ].join('\n');
  baixarBlob(`${nomeBase}_${formatarDataArquivoHoje()}.csv`, new Blob([`\ufeff${conteudo}`], {
    type: 'text/csv;charset=utf-8',
  }));
}

function baixarXlsxRelatorio(nomeBase, nomePlanilha, colunas, linhas) {
  const XLSX = window.XLSX;
  if (!XLSX) {
    throw new Error('A biblioteca XLSX não foi carregada.');
  }
  const matriz = [
    colunas.map((coluna) => coluna.label),
    ...linhas.map((linha) => colunas.map((coluna) => linha[coluna.key] ?? '')),
  ];
  const planilha = XLSX.utils.aoa_to_sheet(matriz);
  const range = XLSX.utils.decode_range(planilha['!ref'] || 'A1:A1');
  planilha['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  planilha['!freeze'] = { xSplit: 0, ySplit: 1 };
  planilha['!cols'] = colunas.map((coluna) => {
    const maior = Math.max(
      coluna.label.length,
      ...linhas.slice(0, 250).map((linha) => normalizarValorExportacao(linha[coluna.key]).length),
    );
    return { wch: Math.min(Math.max(maior + 2, 10), coluna.key.includes('moviment') || coluna.key.includes('justific') ? 48 : 28) };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, nomePlanilha.slice(0, 31));
  const dados = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  baixarBlob(`${nomeBase}_${formatarDataArquivoHoje()}.xlsx`, new Blob([dados], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
}

function montarLinhaProcessoRelatorio(linha) {
  const status = obterStatusRelatorioProcesso(linha);
  return {
    ...linha,
    id_processo_relatorio: obterIdRelatorioProcesso(linha) || '-',
    processo_relatorio: obterNomeRelatorioProcesso(linha),
    data_abertura_relatorio: formatarDataRelatorio(linha.data_abertura),
    data_encerramento_relatorio: formatarDataRelatorio(linha.data_encerramento),
    status_relatorio: status || '-',
    total_vagas_relatorio: formatarNumeroRelatorio(linha.quantidade_vagas, '-'),
    vagas_preenchidas_relatorio: formatarNumeroRelatorio(obterPrimeiroValorRelatorio(linha, ['vagas_preenchidas', 'quantidade_vagas_preenchidas', 'quantidade_aprovados'], 0)),
    candidatos_relatorio: formatarNumeroRelatorio(obterPrimeiroValorRelatorio(linha, ['quantidade_candidatos', 'total_candidatos', 'candidatos'], '-'), '-'),
    aprovados_relatorio: formatarNumeroRelatorio(linha.quantidade_aprovados),
    eliminados_relatorio: formatarNumeroRelatorio(linha.quantidade_eliminados_reprovados),
  };
}

function montarLinhaRankingRelatorio(linha) {
  return {
    ...linha,
    nota_final: formatarNotaAnalise(linha.nota_final),
    afinidade_percentual: `${formatarPercentualAfinidade(linha.afinidade_percentual)}%`,
    status_visual: getCandidateVisibleStatus(linha) || '-',
  };
}

function resumirTextoTabela(valor, limite = 72) {
  const texto = String(valor || '').trim();
  if (texto.length <= limite) return texto || '-';
  return `${texto.slice(0, limite - 1)}…`;
}

function PaginacaoCompacta({
  paginacao,
  onChange,
  label,
  onVerTodos = null,
  maxBotoes = 4,
}) {
  const totalPaginas = Math.max(1, Number(paginacao?.totalPaginas || 1));
  const paginaAtual = Math.min(
    Math.max(1, Number(paginacao?.paginaAtual || 1)),
    totalPaginas,
  );
  const limiteBotoes = Math.max(1, Number(maxBotoes || 4));
  const inicioJanela = Math.min(
    Math.max(1, paginaAtual - Math.floor(limiteBotoes / 2)),
    Math.max(1, totalPaginas - limiteBotoes + 1),
  );
  const fimJanela = Math.min(totalPaginas, inicioJanela + limiteBotoes - 1);
  const paginas = Array.from(
    { length: fimJanela - inicioJanela + 1 },
    (_, indice) => inicioJanela + indice,
  );

  return html`
    <footer class="c24-pagination">
      <span>${label}</span>
      <div class="c24-pagination-actions">
        <button
          type="button"
          class="c24-page-btn"
          aria-label="Página anterior"
          disabled=${paginaAtual <= 1}
          onClick=${() => onChange(paginaAtual - 1)}
        >
          <span class="material-symbols-outlined">${IconeSvg('chevron_left')}</span>
        </button>
        ${paginas.map(
    (pagina) => html`
            <button
              key=${pagina}
              type="button"
              class=${`c24-page-btn ${pagina === paginaAtual ? 'is-active' : ''}`}
              onClick=${() => onChange(pagina)}
            >
              ${pagina}
            </button>
          `,
  )}
        <button
          type="button"
          class="c24-page-btn"
          aria-label="Próxima página"
          disabled=${paginaAtual >= totalPaginas}
          onClick=${() => onChange(paginaAtual + 1)}
        >
          <span class="material-symbols-outlined">${IconeSvg('chevron_right')}</span>
        </button>
        ${onVerTodos
      ? html`
              <button type="button" class="c24-page-link" onClick=${onVerTodos}>
                Ver todos
              </button>
            `
      : null}
      </div>
    </footer>
  `;
}

function obterClasseStatusEmail(status) {
  const texto = normalizarTextoPainel(status).toLowerCase();
  if (texto.includes('banco')) return 'is-talent';
  if (texto.includes('vinculado') || texto.includes('analisado')) return 'is-highlight';
  if (texto.includes('erro') || texto.includes('ignorado')) return 'is-eliminated';
  if (texto.includes('sem anexo')) return 'is-pending';
  return 'is-analysis';
}

function obterClasseAlertaEmail(payload) {
  const status = normalizarTextoPainel(payload?.status).toLowerCase();
  if (status === 'error' || payload?.error) return 'alert-danger';
  if (payload && payload.configured === false) return 'alert-warning';
  return 'alert-info';
}

function formatarExperienciaEmail(item) {
  const valor = String(item?.experiencia_detectada || item?.campos_formulario?.experiencia || '').trim().toLowerCase();
  if (valor === 'sim') return 'Sim';
  if (valor === 'nao' || valor === 'não') return 'Não';
  return 'Não identificado';
}

function formatarPartesDataHoraEmail(valor) {
  if (!valor) return { data: '-', hora: '' };
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return { data: String(valor), hora: '' };
  return {
    data: data.toLocaleDateString('pt-BR'),
    hora: data.toLocaleTimeString('pt-BR'),
  };
}

function SecaoCurriculosRecebidosEmail({ modo = 'resumo', controlador = null } = {}) {
  const { showToast, ToastHost } = useToast();
  const compacto = modo !== 'completo';
  const chaveInicialEmail = montarChaveCacheSecaoEmail();
  const cacheInicialEmail = lerCacheSecaoEmail(chaveInicialEmail);
  const [aberta, setAberta] = useState(true);
  const [carregando, setCarregando] = useState(!cacheInicialEmail);
  const [payloadEmail, setPayloadEmail] = useState(cacheInicialEmail?.payloadEmail || null);
  const [emails, setEmails] = useState(cacheInicialEmail?.emails || []);
  const [processosAbertos, setProcessosAbertos] = useState(cacheInicialEmail?.processosAbertos || []);
  const [selecoesProcesso, setSelecoesProcesso] = useState({});
  const [acaoEmAndamento, setAcaoEmAndamento] = useState('');
  const [detalheEmail, setDetalheEmail] = useState(null);
  const [mostrarIgnorados, setMostrarIgnorados] = useState(false);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [tamanhoPagina, setTamanhoPagina] = useState(compacto ? 2 : 10);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [idsSelecionados, setIdsSelecionados] = useState([]);

  const paginacaoEmails = useMemo(
    () => obterItensPaginados(emails, paginaAtual, tamanhoPagina),
    [emails, paginaAtual, tamanhoPagina],
  );

  const itensSelecionados = useMemo(() => {
    const selecionados = new Set(idsSelecionados.map(String));
    return emails.filter((item) => selecionados.has(String(item.id)));
  }, [emails, idsSelecionados]);

  const idsPaginaAtual = useMemo(
    () => paginacaoEmails.itens.map((item) => String(item.id)),
    [paginacaoEmails.itens],
  );

  const todosDaPaginaSelecionados = idsPaginaAtual.length > 0 && idsPaginaAtual.every(
    (id) => idsSelecionados.includes(id),
  );

  const aplicarEstadoEmail = (estado) => {
    setPayloadEmail(estado.payloadEmail || null);
    setEmails(Array.isArray(estado.emails) ? estado.emails : []);
    setProcessosAbertos(Array.isArray(estado.processosAbertos) ? estado.processosAbertos : []);
  };

  const carregarEmails = async ({ forcar = false } = {}) => {
    const query = filtroTexto.trim();
    const chaveCacheEmail = montarChaveCacheSecaoEmail({ mostrarIgnorados, query });
    if (forcar) cacheSecoesEmail.clear();
    const cacheEmail = !forcar ? lerCacheSecaoEmail(chaveCacheEmail) : null;

    if (cacheEmail) {
      aplicarEstadoEmail(cacheEmail);
      setCarregando(false);
      return;
    }

    const possuiDadosEmTela = Boolean(payloadEmail || emails.length || processosAbertos.length);
    setCarregando(forcar || !possuiDadosEmTela);
    try {
      const [resultadoEmails, resultadoProcessos] = await Promise.allSettled([
        lerEmailsRecebidos({
          limite: LIMITE_CACHE_EMAILS_RECEBIDOS,
          mostrarIgnorados,
          query,
          apenasComAnexos: true,
          refresh: forcar,
        }),
        lerProcessos({ forcar }),
      ]);
      const proximoEstado = {
        payloadEmail: null,
        emails: [],
        processosAbertos: [],
      };

      if (resultadoEmails.status === 'fulfilled') {
        const payload = resultadoEmails.value || {};
        proximoEstado.payloadEmail = payload;
        proximoEstado.emails = Array.isArray(payload.items) ? payload.items : [];
      } else {
        proximoEstado.payloadEmail = {
          configured: false,
          message:
            resultadoEmails.reason?.message || MENSAGEM_EMAIL_NAO_CONFIGURADO,
        };
      }

      if (resultadoProcessos.status === 'fulfilled') {
        proximoEstado.processosAbertos =
          (Array.isArray(resultadoProcessos.value)
            ? resultadoProcessos.value
            : []
          ).filter((processo) => !isProcessClosed(processo));
      }

      gravarCacheSecaoEmail(chaveCacheEmail, proximoEstado);
      aplicarEstadoEmail(proximoEstado);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    setPaginaAtual(1);
    carregarEmails();
  }, [mostrarIgnorados]);

  useEffect(() => {
    const intervalo = window.setInterval(() => {
      carregarEmails();
    }, TEMPO_CACHE_SECAO_EMAIL_MS);
    return () => window.clearInterval(intervalo);
  }, [mostrarIgnorados, filtroTexto]);

  useEffect(() => {
    const idsDisponiveis = new Set(emails.map((item) => String(item.id)));
    setIdsSelecionados((atuais) => atuais.filter((id) => idsDisponiveis.has(id)));
  }, [emails]);

  const registrarErroAcao = (error, fallback) => {
    setPayloadEmail((atual) => ({
      ...(atual || {}),
      configured: atual?.configured !== false,
      status: 'error',
      message: error?.message || fallback,
    }));
  };

  const executarAcao = async (chave, acao) => {
    setAcaoEmAndamento(chave);
    try {
      await acao();
      await carregarEmails({ forcar: true });
    } finally {
      setAcaoEmAndamento('');
    }
  };

  const analisarEmail = async (item) => {
    if (!item?.possui_anexo) {
      registrarErroAcao(null, 'Este e-mail não possui anexo de currículo.');
      return;
    }
    try {
      await executarAcao(`analisar:${item.id}`, () =>
        analisarCvEmailRecebidoGeral(item.id),
      );
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível analisar o CV recebido.');
    }
  };

  const vincularEmail = async (item) => {
    const idProcesso = selecoesProcesso[item.id] || '';
    if (!idProcesso) {
      registrarErroAcao(null, 'Selecione um processo aberto para vincular.');
      return;
    }
    try {
      await executarAcao(`vincular:${item.id}`, () =>
        vincularEmailRecebidoProcesso(item.id, { id_processo: idProcesso }),
      );
      setSelecoesProcesso((anteriores) => ({ ...anteriores, [item.id]: '' }));
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível vincular este candidato.');
    }
  };

  const enviarParaBanco = async (item) => {
    try {
      await executarAcao(`banco:${item.id}`, () =>
        enviarEmailRecebidoBancoTalentos(item.id),
      );
    } catch (error) {
      registrarErroAcao(
        null,
        'Não foi possível enviar o candidato para o Banco de Talentos. Verifique os dados do candidato e tente novamente.',
      );
    }
  };

  const abrirCvEmail = async (item) => {
    if (!item?.possui_anexo) {
      registrarErroAcao(null, 'Este e-mail não possui anexo de currículo.');
      return;
    }
    try {
      setAcaoEmAndamento(`cv:${item.id}`);
      const anexo = Array.isArray(item.anexos) ? item.anexos[0] : null;
      const resposta = await baixarAnexoEmailRecebido(item.id, anexo?.id || '');
      abrirBlobEmNovaGuia(resposta.blob);
      await carregarEmails({ forcar: true });
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível abrir o CV recebido.');
    } finally {
      setAcaoEmAndamento('');
    }
  };

  const ignorarEmail = async (item) => {
    try {
      await executarAcao(`ignorar:${item.id}`, () =>
        ignorarEmailRecebido(item.id),
      );
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível ignorar este e-mail.');
    }
  };

  const excluirEmail = async (item) => {
    const confirmar = window.confirm(
      `Deseja excluir este e-mail?\n\nAssunto: ${item.assunto || 'Sem assunto'}\n\nEsta ação remove o e-mail da caixa configurada quando o IMAP permitir e também oculta o item no sistema.`,
    );

    if (!confirmar) return;

    try {
      await executarAcao(`excluir:${item.id}`, () =>
        excluirEmailRecebido(item.id),
      );
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível excluir este e-mail.');
    }
  };

  const alternarSelecaoEmail = (item) => {
    const id = String(item.id);
    setIdsSelecionados((atuais) => (
      atuais.includes(id)
        ? atuais.filter((itemId) => itemId !== id)
        : [...atuais, id]
    ));
  };

  const alternarSelecaoPagina = () => {
    setIdsSelecionados((atuais) => {
      if (todosDaPaginaSelecionados) {
        return atuais.filter((id) => !idsPaginaAtual.includes(id));
      }
      return [...new Set([...atuais, ...idsPaginaAtual])];
    });
  };

  const ignorarEmailsSelecionados = async () => {
    if (!itensSelecionados.length) return;
    try {
      await executarAcao('ignorar:massa', () => Promise.all(
        itensSelecionados.map((item) => ignorarEmailRecebido(item.id)),
      ));
      setIdsSelecionados([]);
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível ignorar os e-mails selecionados.');
    }
  };

  const excluirEmailsSelecionados = async () => {
    if (!itensSelecionados.length) return;
    const quantidade = itensSelecionados.length;
    const confirmar = window.confirm(
      `Deseja excluir ${quantidade === 1 ? 'este e-mail' : `os ${quantidade} e-mails selecionados`}?\n\nEsta ação remove os e-mails da caixa configurada quando o IMAP permitir e também oculta os itens no sistema.`,
    );
    if (!confirmar) return;

    try {
      await executarAcao('excluir:massa', () => Promise.all(
        itensSelecionados.map((item) => excluirEmailRecebido(item.id)),
      ));
      setIdsSelecionados([]);
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível excluir os e-mails selecionados.');
    }
  };

  const abrirDetalhesEmail = async (item) => {
    try {
      const resposta = await lerDetalheEmailRecebido(item.id);
      setDetalheEmail(resposta?.item || item);
      setEmails((atuais) =>
        atuais.map((atual) => (String(atual.id) === String(item.id) ? { ...atual, lido: true } : atual)),
      );
    } catch (error) {
      setDetalheEmail(item);
      registrarErroAcao(error, 'Não foi possível carregar os detalhes do e-mail.');
    }
  };

  const marcarComoLidoSemAbrir = async (item, event) => {
    event?.stopPropagation?.();
    if (item.lido) return;
    try {
      await marcarEmailRecebidoComoLido(item.id);
      setEmails((atuais) =>
        atuais.map((atual) => (String(atual.id) === String(item.id) ? { ...atual, lido: true } : atual)),
      );
    } catch (error) {
      registrarErroAcao(error, 'Não foi possível marcar o e-mail como lido.');
    }
  };

  const enviarFiltro = (event) => {
    event.preventDefault();
    setPaginaAtual(1);
    carregarEmails();
  };

  const itemSelecionado = itensSelecionados.length === 1 ? itensSelecionados[0] : null;

  return html`
    <div class=${`mailbox-layout ${compacto ? 'is-compact' : 'is-full'} ${itensSelecionados.length ? 'has-selection' : ''}`}>
      <${ToastHost} />
      <${SectionCard}
        className=${`mailbox-card ${compacto ? 'mailbox-card-compact' : 'mailbox-card-full'}`}
        title=${compacto ? 'Cx de Currículos' : ''}
        actions=${html`
          <div class=${`mailbox-toolbar rh-email-panel-actions ${compacto ? 'mailbox-toolbar-compact' : 'mailbox-toolbar-full'}`}>
            ${!compacto
        ? html`
                  <form class="mailbox-filter-form" onSubmit=${enviarFiltro}>
                    <label class="email-search-control">
                      <span class="material-symbols-outlined">${IconeSvg('search')}</span>
                      <input
                        class="form-control form-control-sm rh-email-filter-input email-filter-input"
                        aria-label="Filtrar e-mails"
                        placeholder="Filtrar por assunto, nome, experiência ou contato"
                        value=${filtroTexto}
                        onInput=${(event) => setFiltroTexto(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      class="btn btn-outline-primary btn-sm rh-action-btn email-toolbar-btn"
                      disabled=${carregando}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('filter_alt')}</span>
                      Filtrar
                    </button>
                  </form>
                `
        : controlador
          ? html`
                    <button
                      type="button"
                      class="btn btn-outline-primary btn-sm rh-action-btn email-toolbar-btn"
                      onClick=${() => controlador.irParaTelaProtegida('screen-email-inbox')}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('mail')}</span>
                      Abrir caixa completa
                    </button>
                  `
          : null}

            <div class="mailbox-toolbar-options">
              <label class="form-check rh-email-toggle-ignored">
                <input
                  class="form-check-input"
                  type="checkbox"
                  checked=${mostrarIgnorados}
                  onChange=${(event) => setMostrarIgnorados(event.target.checked)}
                />
                <span class="form-check-label">Mostrar ignorados/excluídos</span>
              </label>

              <label class="email-page-size-label">
                <span class="visually-hidden">Itens por página</span>
                <select
                  class="form-select form-select-sm rh-email-page-size email-page-size"
                  value=${String(tamanhoPagina)}
                  onChange=${(event) => setTamanhoPagina(Number(event.target.value) || 5)}
                >
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="5">5</option>
                  <option value="10">10</option>
                </select>
              </label>

              <button
                type="button"
                class="btn btn-outline-primary btn-sm rh-action-btn email-toolbar-btn"
                disabled=${carregando}
                onClick=${() => carregarEmails({ forcar: true })}
              >
                <span class="material-symbols-outlined">${IconeSvg('refresh')}</span>
                ${carregando ? 'Atualizando...' : 'Atualizar'}
              </button>

              ${compacto
        ? html`
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm rh-action-btn email-toolbar-btn"
                      onClick=${() => setAberta((valor) => !valor)}
                    >
                      <span class="material-symbols-outlined">${IconeSvg(aberta ? 'expand_less' : 'expand_more')}</span>
                      ${aberta ? 'Recolher' : 'Expandir'}
                    </button>
                  `
        : null}
            </div>
          </div>
        `}
        tourId="home-email-inbox"
      >
        ${aberta
      ? html`
              ${payloadEmail && !payloadEmail.configured
          ? html`
                    <div class="alert alert-warning mailbox-config-alert">
                      <span class="material-symbols-outlined">${IconeSvg('error')}</span>
                      <div>
                        <strong>Caixa de e-mail corporativa ainda não configurada.</strong>
                        <span>Informe TENANT_ID, CLIENT_ID e CLIENT_SECRET no servidor.</span>
                      </div>
                    </div>
                  `
          : payloadEmail?.message
            ? html`<div class=${`alert ${obterClasseAlertaEmail(payloadEmail)}`}>${payloadEmail.message}</div>`
            : null}

              <div class="table-responsive email-table-shell">
                <table class="table align-middle rh-modern-history-table rh-email-inbox-table email-table">
                  <thead>
                    <tr>
                      ${compacto
          ? null
          : html`
                            <th class="email-select-cell">
                              <input
                                class="form-check-input"
                                type="checkbox"
                                aria-label="Selecionar e-mails desta página"
                                checked=${todosDaPaginaSelecionados}
                                onChange=${alternarSelecaoPagina}
                              />
                            </th>
                          `}
                      <th>Data</th>
                      <th>Assunto</th>
                      ${compacto
          ? null
          : html`
                            <th>Nome</th>
                            <th>Experiência</th>
                            <th>Contato detectado</th>
                          `}
                      <th>Anexo/CV</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${paginacaoEmails.itens.length
          ? paginacaoEmails.itens.map((item) => {
            const dataHora = formatarPartesDataHoraEmail(item.data_recebimento);
            const selecionado = idsSelecionados.includes(String(item.id));
            return html`
                            <tr key=${item.id} class=${`email-row ${selecionado ? 'is-selected' : ''} ${item.lido ? '' : 'is-unread'}`}>
                              ${compacto
                ? null
                : html`
                                    <td class="email-select-cell" data-label="Selecionar">
                                      <input
                                        class="form-check-input"
                                        type="checkbox"
                                        aria-label=${`Selecionar e-mail ${item.assunto || 'sem assunto'}`}
                                        checked=${selecionado}
                                        onChange=${() => alternarSelecaoEmail(item)}
                                      />
                                    </td>
                                  `}
                              <td class="email-date-cell" data-label="Data">
                                <span>${dataHora.data}</span>
                                <small>${dataHora.hora}</small>
                              </td>
                              <td class="email-subject-cell" data-label="Assunto">
                                <div>
                                  ${!item.lido
                ? html`
                                        <button
                                          type="button"
                                          class="email-unread-dot"
                                          title="Marcar como lido"
                                          aria-label="Marcar como lido"
                                          onClick=${(event) => marcarComoLidoSemAbrir(item, event)}
                                        ></button>
                                      `
                : null}
                                  ${item.assunto || 'Sem assunto'}
                                  ${item.origem === 'Upload manual'
                ? html`<span class="rh-chip email-origin-chip">Manual</span>`
                : null}
                                </div>
                              </td>
                              ${compacto
                ? null
                : html`
                                    <td data-label="Nome">${item.nome_detectado || '-'}</td>
                                    <td data-label="Experiência">${formatarExperienciaEmail(item)}</td>
                                    <td class="email-contact-cell" data-label="Contato detectado">
                                      <div>${item.telefone_detectado || 'Não identificado'}</div>
                                      <small>${item.email_detectado || '-'}</small>
                                    </td>
                                  `}
                              <td class="email-attachment-cell" data-label="Anexo/CV">
                                ${item.possui_anexo ? item.nome_anexo || 'Anexo recebido' : 'Sem anexo'}
                              </td>
                              <td class="email-status-cell" data-label="Status">
                                <span class=${`process-candidate-status-badge email-status-pill ${obterClasseStatusEmail(item.status)}`}>
                                  ${item.status || 'Recebido'}
                                </span>
                              </td>
                            </tr>
                          `;
          })
          : html`
                          <tr class="email-empty-row">
                            <td class="text-center text-muted py-4" colSpan=${compacto ? 4 : 8}>
                              ${carregando
              ? html`
                                    <${LoadingState}
                                      titulo="Carregando currículos recebidos"
                                      descricao="Buscando e-mails e anexos da caixa monitorada."
                                    />
                                  `
              : html`
                                    <span class="material-symbols-outlined">${IconeSvg('inbox')}</span>
                                    <span>Nenhum currículo recebido por e-mail para listar.</span>
                                  `}
                            </td>
                          </tr>
                        `}
                  </tbody>
                </table>
              </div>

              ${compacto
          ? html`
                    <${PaginacaoCompacta}
                      paginacao=${{ ...paginacaoEmails, tamanhoPagina }}
                      onChange=${setPaginaAtual}
                      label=${`Mostrando ${obterIntervaloPaginacao({ ...paginacaoEmails, tamanhoPagina })} de ${paginacaoEmails.totalItens} e-mail(s)`}
                    />
                  `
          : html`
                    <div class="email-pagination-row">
                      <small>Exibindo ${paginacaoEmails.itens.length} de ${paginacaoEmails.totalItens} e-mail(s).</small>
                      <${GrupoPaginacao}
                        paginaAtual=${paginacaoEmails.paginaAtual}
                        totalPaginas=${paginacaoEmails.totalPaginas}
                        onChange=${setPaginaAtual}
                      />
                    </div>
                  `}
            `
      : null}
      </${SectionCard}>

      ${!compacto && itensSelecionados.length
      ? html`
            <aside class="email-quick-actions" aria-live="polite">
              <header>
                <div>
                  <h3>Ações rápidas</h3>
                  <span>${itensSelecionados.length} ${itensSelecionados.length === 1 ? 'item selecionado' : 'itens selecionados'}</span>
                </div>
                <button
                  type="button"
                  class="email-quick-actions-close"
                  aria-label="Fechar ações rápidas"
                  onClick=${() => setIdsSelecionados([])}
                >
                  <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                </button>
              </header>

              ${itemSelecionado
          ? html`
                    <div class="email-quick-actions-list">
                      <button type="button" onClick=${() => abrirDetalhesEmail(itemSelecionado)}>
                        <span class="material-symbols-outlined">${IconeSvg('mail')}</span>
                        Ver e-mail
                      </button>
                      <button
                        type="button"
                        disabled=${!itemSelecionado.possui_anexo || acaoEmAndamento === `cv:${itemSelecionado.id}` || !controlador?.possuiPermissao?.('candidatos.baixar_curriculo')}
                        onClick=${() => abrirCvEmail(itemSelecionado)}
                      >
                        <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                        Ver CV
                      </button>
                      <button
                        type="button"
                        disabled=${!itemSelecionado.possui_anexo || acaoEmAndamento === `analisar:${itemSelecionado.id}` || !controlador?.possuiPermissao?.('candidatos.avaliar_curriculo')}
                        onClick=${() => analisarEmail(itemSelecionado)}
                      >
                        <span class="material-symbols-outlined">${IconeSvg('auto_awesome')}</span>
                        Analisar CV
                      </button>

                      <div class="email-quick-process-action">
                        <select
                          class="form-select form-select-sm"
                          aria-label="Processo para vínculo"
                          value=${selecoesProcesso[itemSelecionado.id] || ''}
                          onChange=${(event) => setSelecoesProcesso((anteriores) => ({
            ...anteriores,
            [itemSelecionado.id]: event.target.value,
          }))}
                        >
                          <option value="">Selecione o processo</option>
                          ${processosAbertos.map((processo) => html`
                            <option key=${obterChaveProcesso(processo)} value=${obterReferenciaProcesso(processo)}>
                              ${processo.id_processo || processo.vaga || 'Processo'}
                            </option>
                          `)}
                        </select>
                        <button
                          type="button"
                          disabled=${!selecoesProcesso[itemSelecionado.id] || acaoEmAndamento === `vincular:${itemSelecionado.id}` || !controlador?.possuiPermissao?.('candidatos.criar')}
                          onClick=${() => vincularEmail(itemSelecionado)}
                        >
                          <span class="material-symbols-outlined">${IconeSvg('link')}</span>
                          Vincular ao processo
                        </button>
                      </div>

                      ${controlador?.possuiPermissao?.('candidatos.mover_etapa')
              ? html`
                            <button
                              type="button"
                              disabled=${acaoEmAndamento === `banco:${itemSelecionado.id}`}
                              onClick=${() => enviarParaBanco(itemSelecionado)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('group')}</span>
                              Banco de Talentos
                            </button>
                          `
              : null}
                    </div>
                  `
          : null}

              <div class="email-quick-actions-danger">
                ${controlador?.possuiPermissao?.('candidatos.mover_etapa')
          ? html`
                      <button
                        type="button"
                        class="is-danger"
                        disabled=${!!acaoEmAndamento}
                        onClick=${itemSelecionado ? () => ignorarEmail(itemSelecionado) : ignorarEmailsSelecionados}
                      >
                        <span class="material-symbols-outlined">${IconeSvg('visibility_off')}</span>
                        Ignorar
                      </button>
                    `
          : null}
                ${controlador?.possuiPermissao?.('candidatos.excluir')
          ? html`
                      <button
                        type="button"
                        class="is-danger"
                        disabled=${!!acaoEmAndamento}
                        onClick=${itemSelecionado ? () => excluirEmail(itemSelecionado) : excluirEmailsSelecionados}
                      >
                        <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                        Excluir
                      </button>
                    `
          : null}
              </div>
            </aside>
          `
      : null}

      <${ModalPadrao}
        aberto=${!!detalheEmail}
        titulo=${`E-mail recebido | ${detalheEmail?.assunto || 'Sem assunto'}`}
        subtitulo=${detalheEmail?.remetente || 'Remetente não informado'}
        onClose=${() => setDetalheEmail(null)}
      >
        <div class="rh-details-body">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label">Data de recebimento</label>
              <div>${formatarDataHora(detalheEmail?.data_recebimento)}</div>
            </div>
            <div class="col-md-6">
              <label class="form-label">Anexo/CV</label>
              <div>${detalheEmail?.nome_anexo || 'Sem anexo'}</div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Nome</label>
              <div>${detalheEmail?.nome_detectado || '-'}</div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Experiência</label>
              <div>${formatarExperienciaEmail(detalheEmail)}</div>
            </div>
            <div class="col-md-4">
              <label class="form-label">Telefone detectado</label>
              <div>${detalheEmail?.telefone_detectado || '-'}</div>
            </div>
            <div class="col-md-4">
              <label class="form-label">E-mail detectado</label>
              <div>${detalheEmail?.email_detectado || '-'}</div>
            </div>
            ${Array.isArray(detalheEmail?.inconsistencias) && detalheEmail.inconsistencias.length
      ? html`
                  <div class="col-12">
                    <label class="form-label">Inconsistências</label>
                    <div class="alert alert-warning mb-0">${detalheEmail.inconsistencias.join(' ')}</div>
                  </div>
                `
      : null}
            ${Array.isArray(detalheEmail?.campos_formulario?.experiencias) && detalheEmail.campos_formulario.experiencias.length
      ? html`
                  <div class="col-12">
                    <label class="form-label">Experiência profissional</label>
                    <div class="rh-details-card-stack">
                      ${detalheEmail.campos_formulario.experiencias.map(
        (experiencia, indice) => html`
                          <div class="c24-card" key=${indice}>
                            <strong>${[experiencia.cargo, experiencia.empresa].filter(Boolean).join(' — ') || 'Experiência'}</strong>
                            ${experiencia.periodo ? html`<div><small>${experiencia.periodo}</small></div>` : null}
                            ${experiencia.descricao ? html`<div>${experiencia.descricao}</div>` : null}
                          </div>
                        `,
      )}
                    </div>
                  </div>
                `
      : null}
            ${Array.isArray(detalheEmail?.campos_formulario?.formacao) && detalheEmail.campos_formulario.formacao.length
      ? html`
                  <div class="col-12">
                    <label class="form-label">Formação acadêmica</label>
                    <div class="rh-details-card-stack">
                      ${detalheEmail.campos_formulario.formacao.map(
        (formacao, indice) => html`
                          <div class="c24-card" key=${indice}>
                            <strong>${[formacao.curso, formacao.instituicao].filter(Boolean).join(' — ') || 'Formação'}</strong>
                            <div><small>${[formacao.nivel, formacao.periodo, formacao.status].filter(Boolean).join(' · ')}</small></div>
                          </div>
                        `,
      )}
                    </div>
                  </div>
                `
      : null}
            <div class="col-12">
              <label class="form-label">Corpo do e-mail</label>
              <pre class="rh-email-body-preview">${detalheEmail?.corpo || detalheEmail?.resumo_corpo || ''}</pre>
            </div>
          </div>
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => setDetalheEmail(null)}
          >
            Fechar
          </button>
        </footer>
      </${ModalPadrao}>
    </div>
  `;
}

const CHAVE_CACHE_EMAIL_LOGIN = 'rh_login_email_cache';
const DURACAO_CACHE_EMAIL_LOGIN_MS = 60000;

function lerEmailLoginCacheado() {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_CACHE_EMAIL_LOGIN);
    if (!bruto) return '';
    const { valor, timestamp } = JSON.parse(bruto);
    if (!valor || !timestamp || Date.now() - timestamp > DURACAO_CACHE_EMAIL_LOGIN_MS) {
      return '';
    }
    return valor;
  } catch (erro) {
    return '';
  }
}

function salvarEmailLoginCache(valor) {
  try {
    window.sessionStorage.setItem(
      CHAVE_CACHE_EMAIL_LOGIN,
      JSON.stringify({ valor, timestamp: Date.now() }),
    );
  } catch (erro) {
    // sessionStorage indisponível (modo privado, quota, etc.)
  }
}

export function TelaLogin({ controlador }) {
  const [usuario, setUsuario] = useState(() => lerEmailLoginCacheado());
  const [senha, setSenha] = useState('');
  const [mensagemErro, setMensagemErro] = useState('');
  const [autenticandoMicrosoft, setAutenticandoMicrosoft] = useState(false);
  const [exibirLoginLocal, setExibirLoginLocal] = useState(false);
  const [tourReopenSignal, setTourReopenSignal] = useState(0);
  const tourLogin = obterTourLogin();

  const atualizarUsuario = (valor) => {
    setUsuario(valor);
    salvarEmailLoginCache(valor);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('microsoft') !== 'complete') return undefined;

    let ativo = true;
    setAutenticandoMicrosoft(true);
    window.history.replaceState({}, '', '/login');
    controlador.concluirLoginMicrosoft().then((resultado) => {
      if (!ativo) return;
      if (!resultado.ok) {
        setMensagemErro(resultado.mensagem);
        setExibirLoginLocal(true);
      }
      setAutenticandoMicrosoft(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const enviar = async () => {
    const resultado = await controlador.fazerLogin(
      usuario.trim(),
      senha.trim(),
    );

    if (!resultado.ok) {
      setMensagemErro(resultado.mensagem);
    }
  };

  return html`
    <section class="active screen" id="screen-login">
      <div class="rh-login-page">
        <div class="rh-login-hero" data-tour-id="login-hero">
          <div class="rh-login-hero-badge">Conecta</div>
          <h1 class="rh-login-hero-title">Uma plataforma para RH e operação.</h1>
          <p class="rh-login-hero-text">
            Provas, processos seletivos, treinamentos e monitoria de qualidade em um fluxo
            único — do recrutamento ao dia a dia operacional.
          </p>
          <div class="rh-login-hero-points">
            <span>Processos seletivos</span>
            <span>Treinamentos</span>
            <span>Monitoria de qualidade</span>
          </div>
        </div>

        <div
          class="rh-login-panel rh-login-panel-modern"
          data-tour-id="login-panel"
        >
          <div class="rh-login-brand-block rh-login-brand-block-centered">
            <img
              alt="Central 24h"
              class="rh-login-brand-image"
              src="/estilos/logo_conecta_padrao.png"
            />
          </div>

          <div class="rh-login-copy-block">
            <h2 class="rh-login-welcome-title">Acesse sua conta</h2>
            <p class="rh-login-welcome-text">
              ${mensagemErro
      ? 'A autenticação Microsoft não foi concluída. Use seu acesso local para continuar.'
      : exibirLoginLocal
        ? 'Use seu login e senha para continuar.'
        : 'Entre com sua conta Microsoft para continuar.'}
            </p>
          </div>

          ${mensagemErro
      ? html`<div class="alert alert-danger mb-3">${mensagemErro}</div>`
      : null}

          <a
            class="rh-login-microsoft-btn"
            data-tour-id="login-submit"
            href="/auth/microsoft/login"
            aria-busy=${autenticandoMicrosoft}
          >
            <svg aria-hidden="true" class="rh-login-microsoft-icon" viewBox="0 0 24 24">
              <path fill="#f35325" d="M1 1h10v10H1z"></path>
              <path fill="#81bc06" d="M13 1h10v10H13z"></path>
              <path fill="#05a6f0" d="M1 13h10v10H1z"></path>
              <path fill="#ffba08" d="M13 13h10v10H13z"></path>
            </svg>
            <span>${autenticandoMicrosoft ? 'Validando conta Microsoft...' : 'Entrar com a Microsoft'}</span>
          </a>

          ${!exibirLoginLocal
      ? html`
                <div class="rh-login-alt-row">
                  <button
                    class="rh-login-link-btn rh-login-alt-btn"
                    type="button"
                    onClick=${() => {
          setMensagemErro('');
          setExibirLoginLocal(true);
        }}
                  >
                    Entrar com login e senha
                  </button>
                </div>
              `
      : null}

          ${exibirLoginLocal
      ? html`
                <div class="rh-login-local-fallback">
                  <div class="rh-login-divider" role="separator" aria-label="ou">
                    <span>ou</span>
                  </div>

                  <div class="mb-3">
                    <label class="form-label rh-login-label">Login</label>
                    <div class="rh-login-input-wrap">
                      <span class="material-symbols-outlined rh-login-input-icon">${IconeSvg('alternate_email')}</span>
                      <input
                        autocomplete="username"
                        class="form-control rh-login-input rh-login-input-modern"
                        placeholder="nome@empresa.com.br"
                        value=${usuario}
                        onInput=${(event) => atualizarUsuario(event.target.value)}
                        type="text"
                      />
                    </div>
                  </div>

                  <div class="mb-2">
                    <div class="rh-login-label-row">
                      <label class="form-label rh-login-label mb-0">Senha</label>
                      <button
                        class="rh-login-link-btn"
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="Recurso em breve"
                      >
                        Esqueci a senha
                      </button>
                    </div>
                    <div class="rh-login-input-wrap">
                      <span class="material-symbols-outlined rh-login-input-icon">${IconeSvg('lock')}</span>
                      <input
                        autocomplete="current-password"
                        class="form-control rh-login-input rh-login-input-modern"
                        placeholder="••••••••"
                        value=${senha}
                        onInput=${(event) => setSenha(event.target.value)}
                        type="password"
                      />
                    </div>
                  </div>

                  <button
                    class="btn rh-login-btn rh-login-btn-modern w-100"
                    onClick=${enviar}
                  >
                    <span>Acessar sistema</span>
                    <span class="material-symbols-outlined">${IconeSvg('arrow_forward')}</span>
                  </button>
                </div>
              `
      : null}

          <div class="rh-login-help-row">
            <${BotaoAjudaTour}
              compact=${true}
              label="Ver orientações"
              onClick=${() => setTourReopenSignal((valor) => valor + 1)}
            />
          </div>

          <div class="rh-login-footer-meta">
            <span>© 2026 Central 24h</span>
            <span>Privacidade</span>
            <span>Termos</span>
            <span>Suporte</span>
          </div>
        </div>
      </div>

      <${TourGuiado}
        screenId="screen-login"
        userId=""
        steps=${tourLogin.steps}
        reopenSignal=${tourReopenSignal}
      />
    </section>
  `;
}

// Correções.txt (24/set/2026, item 12.3): "Movimentações" e "Provas recentes" no
// painel inicial só devem refletir o que aconteceu nos últimos N dias — antes não
// havia corte nenhum e ambas listavam qualquer registro histórico.
const JANELA_RECENTES_DIAS = 3;

function formatarQuandoMovimentacao(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '';
  const dois = (numero) => String(numero).padStart(2, '0');
  return `${dois(data.getDate())}/${dois(data.getMonth() + 1)} - ${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

export function TelaInicio({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [recentes, setRecentes] = useState([]);
  const [processos, setProcessos] = useState([]);
  const [candidatosProcessos, setCandidatosProcessos] = useState([]);
  const [entrevistas, setEntrevistas] = useState([]);
  const [muralRecente, setMuralRecente] = useState([]);
  const [paginaRecentes, setPaginaRecentes] = useState(1);
  const [detalheAberto, setDetalheAberto] = useState(null);
  const nomeUsuarioLogado = normalizarTextoPainel(
    controlador?.estado?.nomeUsuarioAutenticado ||
    controlador?.estado?.usuarioAutenticado ||
    'usuário',
  );

  const carregar = async ({ forcar = false } = {}) => {
    setCarregando(true);
    try {
      const [
        resultadoHistorico,
        resultadoProcessos,
        resultadoCandidatos,
        resultadoEntrevistas,
        resultadoMural,
      ] =
        await Promise.allSettled([
          lerHistorico(),
          lerProcessos({ forcar }),
          lerCandidatosProcessos({ forcar }),
          lerEntrevistas(),
          controlador.possuiPermissao('mural.visualizar') ? listarMural('') : Promise.resolve({ itens: [] }),
        ]);
      setMuralRecente(
        resultadoMural.status === 'fulfilled' && Array.isArray(resultadoMural.value?.itens)
          ? resultadoMural.value.itens.slice(0, 3)
          : [],
      );
      const historico =
        resultadoHistorico.status === 'fulfilled'
          ? resultadoHistorico.value
          : [];
      const corteRecentesMs = Date.now() - JANELA_RECENTES_DIAS * 24 * 60 * 60 * 1000;
      const ordenado = (Array.isArray(historico) ? historico : [])
        .filter((item) => {
          const tempo = new Date(item.data_iso || '').getTime();
          return Number.isFinite(tempo) && tempo >= corteRecentesMs;
        })
        .sort((a, b) =>
          String(b.data_iso || '').localeCompare(String(a.data_iso || '')),
        )
        .slice(0, TAMANHO_RECENTES);
      setRecentes(ordenado);
      setProcessos(
        resultadoProcessos.status === 'fulfilled' &&
          Array.isArray(resultadoProcessos.value)
          ? resultadoProcessos.value
          : [],
      );
      setCandidatosProcessos(
        resultadoCandidatos.status === 'fulfilled' &&
          Array.isArray(resultadoCandidatos.value)
          ? resultadoCandidatos.value
          : [],
      );
      setEntrevistas(
        resultadoEntrevistas.status === 'fulfilled' &&
          Array.isArray(resultadoEntrevistas.value)
          ? resultadoEntrevistas.value
          : [],
      );
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const processosAtivos = useMemo(
    () => (Array.isArray(processos) ? processos : []).filter(
      (processo) => !isProcessClosed(processo.status),
    ),
    [processos],
  );

  const processosAndamento = useMemo(
    () =>
      processosAtivos
        .slice(0, 4)
        .map((processo) => {
          const referencia = obterReferenciaProcesso(processo);
          const idProcesso = String(processo.id_processo || '').trim();
          const candidatosVinculados = (Array.isArray(candidatosProcessos)
            ? candidatosProcessos
            : []
          ).filter((candidato) => {
            const referenciaCandidato = obterReferenciaProcessoDoCandidato(candidato);
            const idCandidato = String(candidato.id_processo || '').trim();
            return (
              (referencia && referenciaCandidato === referencia) ||
              (idProcesso && idCandidato === idProcesso)
            );
          });
          const candidatosAtivos = candidatosVinculados.filter(
            (candidato) => getCandidateVisibleStatus(candidato) !== 'Banco de Talentos',
          );
          const aprovados = Number(processo.vagas_preenchidas || 0) || candidatosVinculados.filter(
            (candidato) => getCandidateVisibleStatus(candidato) === 'Aprovado',
          ).length;
          const totalVagas = Number(processo.quantidade_vagas || 0);
          const percentual = totalVagas > 0
            ? Math.min(100, Math.round((aprovados / totalVagas) * 100))
            : Math.min(100, candidatosAtivos.length * 10);

          return {
            id: referencia || idProcesso || processo.vaga,
            nome: processo.nome_processo || processo.id_processo || processo.vaga || 'Processo',
            candidatos: candidatosAtivos.length,
            percentual,
          };
        }),
    [processosAtivos, candidatosProcessos],
  );

  const recentesPaginados = useMemo(
    () => obterItensPaginados(recentes, paginaRecentes, 3),
    [recentes, paginaRecentes],
  );

  const hojeIso = formatarDataParaInput(new Date());
  const entrevistasHoje = useMemo(
    () =>
      (Array.isArray(entrevistas) ? entrevistas : []).filter(
        (item) => formatarDataParaInput(item.data_entrevista) === hojeIso,
      ),
    [entrevistas, hojeIso],
  );
  const candidatosEmAnalise = useMemo(
    () =>
      (Array.isArray(candidatosProcessos) ? candidatosProcessos : []).filter(
        (candidato) =>
          normalizarTextoPainel(getCandidateVisibleStatus(candidato))
            .toLowerCase()
            .includes('analise'),
      ),
    [candidatosProcessos],
  );
  const alertasOperacionais = useMemo(
    () =>
      (Array.isArray(entrevistas) ? entrevistas : []).filter((item) => {
        const status = normalizarTextoPainel(item.status_entrevista).toLowerCase();
        return status.includes('falt') || status.includes('cancel');
      }),
    [entrevistas],
  );
  const candidatosAtivosResumo = useMemo(
    () =>
      (Array.isArray(candidatosProcessos) ? candidatosProcessos : []).filter((candidato) => {
        const status = normalizarTextoPainel(getCandidateVisibleStatus(candidato)).toLowerCase();
        return (
          !status.includes('banco') &&
          !status.includes('elimin') &&
          !status.includes('reprov') &&
          !status.includes('desist')
        );
      }),
    [candidatosProcessos],
  );
  const contratacoesResumo = useMemo(
    () =>
      (Array.isArray(candidatosProcessos) ? candidatosProcessos : []).filter(
        (candidato) => getCandidateVisibleStatus(candidato) === 'Aprovado',
      ),
    [candidatosProcessos],
  );
  const pendenciasResumo =
    candidatosEmAnalise.length + alertasOperacionais.length;
  const indicadoresPainel = useMemo(
    () => [
      {
        icon: 'groups',
        label: 'Candidatos ativos',
        value: candidatosAtivosResumo.length,
        helper: 'Em acompanhamento',
        variant: '',
      },
      {
        icon: 'folder_open',
        label: 'Processos abertos',
        value: processosAtivos.length,
        helper: 'Abertos agora',
        variant: '',
      },
      {
        icon: 'calendar_month',
        label: 'Entrevistas hoje',
        value: entrevistasHoje.length,
        helper: 'Agenda do dia',
        variant: '',
      },
      {
        icon: 'warning',
        label: 'Pendências',
        value: pendenciasResumo,
        helper: pendenciasResumo ? 'Requer atenção' : 'Sem alertas',
        variant: pendenciasResumo ? 'is-attention' : '',
      },
      {
        icon: 'star',
        label: 'Contratações',
        value: contratacoesResumo.length,
        helper: 'Aprovados',
        variant: 'is-positive',
      },
    ],
    [
      candidatosAtivosResumo.length,
      contratacoesResumo.length,
      entrevistasHoje.length,
      pendenciasResumo,
      processosAtivos.length,
    ],
  );
  const notificacoesDia = useMemo(() => {
    // Correções.txt (24/set/2026, item 12): antes disto, a caixa "Movimentações"
    // sempre mostrava "Candidato aprovado para X" contanto que existisse QUALQUER
    // candidato aprovado na lista carregada — mesmo que a ação mais recente do
    // usuário tivesse sido eliminar outro candidato. Agora cada evento é real
    // (aprovado_em/eliminado_em do próprio candidato), tem data/hora (item 12.2) e
    // só entra na lista se aconteceu dentro da janela de ${JANELA_RECENTES_DIAS}
    // dias (item 12.3).
    const corteMs = Date.now() - JANELA_RECENTES_DIAS * 24 * 60 * 60 * 1000;
    const dentroDaJanela = (quando) => {
      const tempo = new Date(quando || '').getTime();
      return Number.isFinite(tempo) && tempo >= corteMs;
    };

    const eventos = [];

    (Array.isArray(candidatosProcessos) ? candidatosProcessos : []).forEach((candidato) => {
      const statusVisivel = getCandidateVisibleStatus(candidato);
      const statusNormalizado = normalizarTextoPainel(statusVisivel).toLowerCase();
      const nome = candidato.nome_candidato || 'Candidato';
      if (statusVisivel === 'Aprovado' && dentroDaJanela(candidato.aprovado_em)) {
        eventos.push({
          quando: candidato.aprovado_em,
          icon: 'check_circle',
          variant: 'is-success',
          text: `${nome} aprovado para ${candidato.vaga || 'vaga aberta'}`,
        });
      } else if (
        (statusNormalizado.includes('elimin') || statusNormalizado.includes('reprov')) &&
        dentroDaJanela(candidato.eliminado_em)
      ) {
        eventos.push({
          quando: candidato.eliminado_em,
          icon: 'cancel',
          variant: 'is-danger',
          text: `${nome} eliminado${candidato.vaga ? ` de ${candidato.vaga}` : ''}`,
        });
      }
    });

    (Array.isArray(processosAtivos) ? processosAtivos : []).forEach((processo) => {
      if (!dentroDaJanela(processo.data_criacao)) return;
      eventos.push({
        quando: processo.data_criacao,
        icon: 'folder_open',
        variant: 'is-info',
        text: `Processo seletivo aberto para ${processo.vaga || processo.nome_processo || processo.id_processo || 'vaga'}`,
      });
    });

    alertasOperacionais.forEach((item) => {
      if (!dentroDaJanela(item.data_entrevista)) return;
      const status = normalizarTextoPainel(item.status_entrevista).toLowerCase();
      eventos.push({
        quando: item.data_entrevista,
        icon: 'cancel',
        variant: 'is-danger',
        text: `Entrevista de ${item.nome_candidato || 'candidato'} ${status.includes('falt') ? 'com falta' : 'cancelada'}`,
      });
    });

    eventos.sort((a, b) => new Date(b.quando || 0).getTime() - new Date(a.quando || 0).getTime());
    const notificacoes = eventos
      .slice(0, 8)
      .map((evento) => ({ ...evento, quandoTexto: formatarQuandoMovimentacao(evento.quando) }));

    if (entrevistasHoje.length) {
      notificacoes.push({
        icon: 'groups',
        variant: 'is-purple',
        text: `${entrevistasHoje.length} candidatos agendados para hoje`,
        quandoTexto: '',
      });
    }

    return notificacoes;
  }, [alertasOperacionais, candidatosProcessos, entrevistasHoje.length, processosAtivos]);

  return html`
    <${PainelRh}
      screenId="screen-menu"
      navAtiva="screen-menu"
      subtituloMarca="Plataforma de Recrutamento e Seleção"
      placeholderBusca="Buscar candidatos, processos, vagas ou provas..."
      controlador=${controlador}
    >
      <${ToastHost} />
      <${PageIntro}
        title=${html`
          <div class="d-flex align-items-center gap-3">
            <${AvatarUsuario}
              avatar=${resolverAvatarUrl(controlador?.estado?.avatarUsuario)}
              nome=${nomeUsuarioLogado}
              tamanho=${48}
            />
            <span>Olá, ${nomeUsuarioLogado}!</span>
          </div>
        `}
        description=""
        actions=${html`
          <span title="Em breve">
            <button
              type="button"
              class="btn btn-outline-secondary rh-action-btn"
              disabled
            >
              <span class="material-symbols-outlined">${IconeSvg('support_agent')}</span>
              Suporte
            </button>
          </span>
          <button
            type="button"
            class="btn btn-outline-secondary rh-action-btn c24-top-refresh-btn"
            onClick=${() => carregar({ forcar: true })}
          >
            <span class="material-symbols-outlined">${IconeSvg('refresh')}</span>
            Atualizar
          </button>
        `}
      />

      <${SectionCard}
        title="Acessos rápidos"
        className="home-quick-card"
        tourId="home-shortcuts"
      >
        <div class="home-quick-grid">
          ${[
      {
        label: 'Gerar prova',
        icon: 'assignment_add',
        permissao: 'provas.enviar',
        onClick: () => {
          try {
            sessionStorage.setItem('rh_open_generated_exam_modal_v1', '1');
          } catch (error) {
            // Navegacao ainda funciona se o navegador bloquear sessionStorage.
          }
          controlador.irParaTelaProtegida('screen-generated-exams');
        },
      },
      {
        label: 'Nova vaga',
        icon: 'work',
        permissao: 'vagas.criar',
        onClick: () => controlador.irParaTelaProtegida('screen-process-create'),
      },
      /*
      {
        label: 'Adicionar candidato',
        icon: 'person_add',
        permissao: 'candidatos.criar',
        onClick: () => controlador.irParaTelaProtegida('screen-candidates'),
      },
      */

      {
        label: 'Agendar entrevista',
        icon: 'calendar_month',
        permissao: 'entrevistas.visualizar',
        onClick: () => controlador.irParaTelaProtegida('screen-interviews'),
      },
      {
        label: 'Cx de Currículos',
        icon: 'send',
        permissao: 'candidatos.criar',
        onClick: () => controlador.irParaTelaProtegida('screen-email-inbox'),
      },
      {
        label: 'Relatórios',
        icon: 'bar_chart',
        permissao: 'relatorios.visualizar',
        onClick: () => controlador.irParaTelaProtegida('screen-analysis-candidates'),
      },
      {
        label: 'Configurações',
        icon: 'more_horiz',
        permissao: 'configuracoes.visualizar',
        onClick: () => controlador.irParaTelaProtegida('screen-settings'),
      },
    ]
      .filter((item) => !item.permissao || controlador.possuiPermissao(item.permissao))
      .map(
        (item) => html`
                <button
                  key=${item.label}
                  type="button"
                  class="home-quick-action"
                  onClick=${item.onClick}
                >
                  <span class="material-symbols-outlined">${IconeSvg(item.icon)}</span>
                  <strong>${item.label}</strong>
                </button>
              `,
      )}
        </div>
      </${SectionCard}>

      <div class="home-pillar-row">
        ${[
      ...indicadoresPainel,
      {
        icon: 'notifications',
        label: 'Notificações do dia',
        value: notificacoesDia.length,
        variant: notificacoesDia.length ? 'is-attention' : '',
      },
    ].map(
      (item) => html`
              <article class=${`home-pillar-card ${item.variant || ''}`} key=${item.label}>
                <span class="home-pillar-icon material-symbols-outlined">${IconeSvg(item.icon)}</span>
                <div>
                  <strong>${item.value}</strong>
                  <span>${item.label}</span>
                </div>
              </article>
            `,
    )}
      </div>

      ${carregando
      ? html`
            <${LoadingState}
              titulo="Carregando painel"
              descricao="Preparando as informações do seu painel."
            />
          `
      : html`
      <div class="home-dashboard-grid home-dashboard-main-grid">
        <div class="home-dashboard-stack home-dashboard-stack--left">
          <${SecaoCurriculosRecebidosEmail} modo="resumo" controlador=${controlador} />

          <${SectionCard}
            title="Movimentações"
            className="home-activity-card compact-dashboard-card"
          >
            ${notificacoesDia.length
          ? html`
                  <ul class="home-activity-list">
                    ${notificacoesDia.map(
            (item, indice) => html`
                        <li class=${`home-activity-item ${item.variant || ''}`} key=${`${item.icon}-${indice}`}>
                          <span>${item.text}</span>
                          ${item.quandoTexto ? html`<span class="home-activity-item-quando">${item.quandoTexto}</span>` : null}
                        </li>
                      `,
          )}
                  </ul>
                `
          : html`
                  <div class="home-empty-state">
                    <span class="material-symbols-outlined">${IconeSvg('history')}</span>
                    <h3>Nenhuma movimentação por aqui</h3>
                    <p>Aprovações, novos processos e alertas do dia aparecerão aqui.</p>
                  </div>
                `}
          </${SectionCard}>

          <${SectionCard}
            title="Mural"
            className="home-mural-card compact-dashboard-card"
            actions=${muralRecente.length
          ? html`
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm"
                    onClick=${() => controlador.irParaTelaProtegida('screen-mural')}
                  >
                    Ver todos
                  </button>
                `
          : null}
          >
            ${muralRecente.length
          ? html`
                  <div class="mural-home-preview">
                    ${muralRecente.map(
            (publicacao) => html`
                        <button
                          key=${publicacao.id_publicacao}
                          type="button"
                          class="mural-home-preview-item"
                          onClick=${() => controlador.irParaTelaProtegida('screen-mural')}
                        >
                          <strong>${publicacao.titulo}</strong>
                          <span>${publicacao.categoria || 'Aviso'} · ${formatarDataHora(publicacao.publicado_em || publicacao.criado_em)}</span>
                        </button>
                      `,
          )}
                  </div>
                `
          : html`
                  <div class="home-empty-state">
                    <span class="material-symbols-outlined">${IconeSvg('article')}</span>
                    <h3>Nenhuma publicação ainda</h3>
                    <p>Avisos, comunicados, fotos e vídeos do RH aparecem aqui.</p>
                  </div>
                `}
          </${SectionCard}>
        </div>

        <div class="home-dashboard-stack home-dashboard-stack--right">
          <${SectionCard}
            title="Próximas Entrevistas"
            className="processes-today-card compact-dashboard-card"
          >
            ${entrevistasHoje.length
          ? html`
                  <div class="processes-today-list">
                    ${entrevistasHoje.slice(0, 5).map(
            (item) => html`
                        <article class="processes-today-item" key=${`${item.id_entrevista || item.id_slot || item.nome_candidato}-${item.data_entrevista}`}>
                          <span class="material-symbols-outlined">${IconeSvg('event_available')}</span>
                          <div>
                            <strong>${item.nome_candidato || 'Entrevista'}</strong>
                            <small>${item.vaga || item.id_processo || 'Processo'} • ${formatarDataHora(item.data_entrevista)}</small>
                          </div>
                          <span class=${`rh-status-pill ${obterClasseStatusEntrevista(item.status_entrevista)}`}>
                            ${item.status_entrevista || 'Agendada'}
                          </span>
                        </article>
                      `,
          )}
                  </div>
                `
          : html`
                  <div class="home-empty-state">
                    <span class="material-symbols-outlined">${IconeSvg('calendar_month')}</span>
                    <h3>Nenhuma entrevista hoje</h3>
                    <p>As entrevistas agendadas para hoje aparecerão aqui.</p>
                  </div>
                `}
          </${SectionCard}>

          <${SectionCard}
            title="Processos Abertos"
            className="process-progress-card compact-dashboard-card"
          >
            ${processosAndamento.length
          ? html`
                  <div class="process-progress-list active-process-list">
                    ${processosAndamento.map(
            (item) => html`
                        <article class="process-progress-item active-process-card" key=${item.id}>
                          <div class="active-process-info">
                            <strong>${item.nome}</strong>
                            <div class="active-process-meta">
                              <span>${item.candidatos} candidatos</span>
                              <span>${item.percentual}% preenchido</span>
                            </div>
                            <div class="active-process-progress" aria-hidden="true">
                              <span style=${{ width: `${item.percentual}%` }}></span>
                            </div>
                          </div>
                          <div class="active-process-actions">
                            <button
                              type="button"
                              class="btn-soft-primary"
                              onClick=${() => controlador.irParaTelaProtegida('screen-processes')}
                            >
                              Ver processos
                            </button>
                          </div>
                        </article>
                      `,
          )}
                  </div>
                `
          : html`
                  <${EmptyState}
                    title="Nenhum processo em andamento"
                    text="Os processos abertos aparecerão aqui assim que forem cadastrados."
                  />
                `}
          </${SectionCard}>

          <${SectionCard}
            title="Provas recentes"
            className="recent-records-card compact-dashboard-card"
            tourId="home-recent"
            actions=${html`
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                onClick=${() => controlador.irParaTelaProtegida('screen-history')}
              >
                Ver todos
              </button>
            `}
          >
            ${recentes.length
          ? html`
                    <div class="rh-recent-grid">
                      ${recentesPaginados.itens.map(
            (item) => html`
                          <button
                            key=${item.id_teste}
                            type="button"
                            class="rh-recent-card"
                            onClick=${async () =>
                setDetalheAberto(
                  await carregarDetalhesProva(item.id_teste),
                )}
                          >
                            <div class="rh-recent-avatar-wrap">
                              <span class="rh-recent-avatar">
                                ${String(item.nome_candidato || 'T')
                .trim()
                .slice(0, 1)
                .toUpperCase()}
                              </span>
                            </div>
                            <div class="rh-recent-card-body">
                              <strong>${item.nome_candidato || '-'}</strong>
                              <span>${item.vaga || '-'}</span>
                              <span>${item.data_exibicao || '-'}</span>
                            </div>
                            <span class="material-symbols-outlined">${IconeSvg('arrow_forward')}</span>
                          </button>
                        `,
          )}
                    </div>
                    <${PaginacaoCompacta}
                      paginacao=${{ ...recentesPaginados, tamanhoPagina: 3 }}
                      onChange=${setPaginaRecentes}
                      label=${`Mostrando ${obterIntervaloPaginacao({
            ...recentesPaginados,
            tamanhoPagina: 3,
          })} de ${recentesPaginados.totalItens}`}
                    />
                  `
          : html`
                    <${EmptyState}
                      title="Nenhum registro salvo"
                      text="Assim que uma prova for concluída e salva, ela aparecerá aqui."
                    />
                  `}
          </${SectionCard}>
        </div>
      </div>
          `}

      <${ModalDetalhesProva}
        detalhe=${detalheAberto}
        onClose=${() => setDetalheAberto(null)}
        onDownload=${() =>
      baixarPacoteHistorico(
        detalheAberto?.linha?.id_teste,
        detalheAberto?.linha?.nome_candidato || 'candidato',
      )}
        onCandidateDetails=${async () => {
      try {
        await abrirFichaCandidatoDaProva(detalheAberto);
      } catch (error) {
        showToast('Não foi possível localizar a ficha deste candidato.', 'error');
      }
    }}
      />
    </${PainelRh}>
  `;
}

const FORM_CURRICULO_MANUAL_INICIAL = {
  nome: '',
  email: '',
  telefone: '',
  cidade: '',
  bairro: '',
  endereco: '',
  data_nascimento: '',
  vaga_pretendida: '',
  experiencia_ativa: false,
  experiencias: [],
  formacao_ativa: false,
  formacao: [],
};

export function TelaCaixaEmail({ controlador }) {
  const [modalComporAberto, setModalComporAberto] = useState(false);
  const [modalCvManualAberto, setModalCvManualAberto] = useState(false);
  const [arquivoCvManual, setArquivoCvManual] = useState(null);
  const [enviandoCvManual, setEnviandoCvManual] = useState(false);
  const [erroCvManual, setErroCvManual] = useState('');
  const [modalCriarCurriculoAberto, setModalCriarCurriculoAberto] = useState(false);
  const [formCurriculoManual, setFormCurriculoManual] = useState(FORM_CURRICULO_MANUAL_INICIAL);
  const [criandoCurriculoManual, setCriandoCurriculoManual] = useState(false);
  const [erroCurriculoManual, setErroCurriculoManual] = useState('');
  const [chaveRecarregarEmails, setChaveRecarregarEmails] = useState(0);
  const podeComporEmail =
    controlador?.possuiPermissao?.('emails.enviar_modelo') ||
    controlador?.possuiPermissao?.('emails.enviar_livre');
  const podeAdicionarCvManual = controlador?.possuiPermissao?.('candidatos.criar');

  const fecharModalCvManual = () => {
    if (enviandoCvManual) return;
    setModalCvManualAberto(false);
    setArquivoCvManual(null);
    setErroCvManual('');
  };

  const enviarCvManual = async () => {
    if (!arquivoCvManual) return;
    setEnviandoCvManual(true);
    setErroCvManual('');
    try {
      await adicionarCvManualCaixaEmail(arquivoCvManual);
      cacheSecoesEmail.clear();
      setChaveRecarregarEmails((valor) => valor + 1);
      setModalCvManualAberto(false);
      setArquivoCvManual(null);
    } catch (error) {
      setErroCvManual(error?.message || 'Não foi possível adicionar o currículo.');
    } finally {
      setEnviandoCvManual(false);
    }
  };

  const fecharModalCriarCurriculo = () => {
    if (criandoCurriculoManual) return;
    setModalCriarCurriculoAberto(false);
    setFormCurriculoManual(FORM_CURRICULO_MANUAL_INICIAL);
    setErroCurriculoManual('');
  };

  const atualizarCampoCurriculoManual = (campo, valor) => {
    setFormCurriculoManual((atual) => ({ ...atual, [campo]: valor }));
  };

  const adicionarExperienciaCurriculoManual = () => {
    setFormCurriculoManual((atual) => ({
      ...atual,
      experiencias: [...atual.experiencias, { empresa: '', cargo: '', periodo: '', descricao: '' }],
    }));
  };

  const atualizarExperienciaCurriculoManual = (indice, campo, valor) => {
    setFormCurriculoManual((atual) => ({
      ...atual,
      experiencias: atual.experiencias.map((item, indiceAtual) =>
        indiceAtual === indice ? { ...item, [campo]: valor } : item,
      ),
    }));
  };

  const removerExperienciaCurriculoManual = (indice) => {
    setFormCurriculoManual((atual) => ({
      ...atual,
      experiencias: atual.experiencias.filter((_, indiceAtual) => indiceAtual !== indice),
    }));
  };

  const adicionarFormacaoCurriculoManual = () => {
    setFormCurriculoManual((atual) => ({
      ...atual,
      formacao: [...atual.formacao, { instituicao: '', curso: '', nivel: '', periodo: '', status: '' }],
    }));
  };

  const atualizarFormacaoCurriculoManual = (indice, campo, valor) => {
    setFormCurriculoManual((atual) => ({
      ...atual,
      formacao: atual.formacao.map((item, indiceAtual) => (indiceAtual === indice ? { ...item, [campo]: valor } : item)),
    }));
  };

  const removerFormacaoCurriculoManual = (indice) => {
    setFormCurriculoManual((atual) => ({
      ...atual,
      formacao: atual.formacao.filter((_, indiceAtual) => indiceAtual !== indice),
    }));
  };

  const enviarCurriculoManual = async () => {
    if (!formCurriculoManual.nome.trim()) return;
    setCriandoCurriculoManual(true);
    setErroCurriculoManual('');
    try {
      await criarCurriculoManualCaixaEmail(formCurriculoManual);
      cacheSecoesEmail.clear();
      setChaveRecarregarEmails((valor) => valor + 1);
      fecharModalCriarCurriculo();
    } catch (error) {
      setErroCurriculoManual(error?.message || 'Não foi possível criar o currículo.');
    } finally {
      setCriandoCurriculoManual(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-email-inbox"
      navAtiva="screen-email-inbox"
      subtituloMarca="Central 24h"
      placeholderBusca="Cx de Currículos"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Currículos recebidos"
        title="Cx de Currículos"
        description=""
        actions=${html`
          <div class="d-flex gap-2">
            ${podeAdicionarCvManual
        ? html`
                  <button type="button" class="btn btn-outline-primary" onClick=${() => setModalCvManualAberto(true)}>
                    <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('upload_file')}</span> Adicionar currículo manualmente
                  </button>
                  <button type="button" class="btn btn-outline-primary" onClick=${() => setModalCriarCurriculoAberto(true)}>
                    <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('person_add')}</span> Criar currículo
                  </button>
                `
        : null}
            ${podeComporEmail
        ? html`
                  <button type="button" class="btn btn-primary" onClick=${() => setModalComporAberto(true)}>
                    <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('edit_note')}</span> Compor e-mail
                  </button>
                `
        : null}
          </div>
        `}
      />

      <${SecaoCurriculosRecebidosEmail}
        key=${chaveRecarregarEmails}
        modo="completo"
        controlador=${controlador}
      />

      ${podeComporEmail
      ? html`
            <${ModalComporEmail}
              aberto=${modalComporAberto}
              controlador=${controlador}
              onClose=${() => setModalComporAberto(false)}
            />
          `
      : null}

      ${podeAdicionarCvManual
      ? html`
            <${ModalPadrao}
              aberto=${modalCvManualAberto}
              titulo="Adicionar currículo manualmente"
              subtitulo="O arquivo entra na lista abaixo como um item avulso, pronto para analisar e vincular a um processo."
              onClose=${fecharModalCvManual}
            >
              <div class="rh-details-body">
                ${erroCvManual ? html`<div class="alert alert-warning">${erroCvManual}</div>` : null}
                <label class="process-cv-picker">
                  <input
                    key=${arquivoCvManual?.name || 'cv-manual-vazio'}
                    type="file"
                    class="process-cv-native-input"
                    accept=".pdf,.doc,.docx"
                    disabled=${enviandoCvManual}
                    onChange=${(event) => setArquivoCvManual(event.target.files?.[0] || null)}
                  />
                  <span class="material-symbols-outlined">${IconeSvg('upload_file')}</span>
                  <span class="process-cv-picker-copy">
                    <strong>Selecionar arquivo</strong>
                    <small title=${arquivoCvManual?.name || ''}>
                      ${arquivoCvManual?.name || 'PDF, DOC ou DOCX'}
                    </small>
                  </span>
                </label>
              </div>
              <footer class="rh-modal-footer">
                <div class="rh-modal-footer-actions">
                  <button type="button" class="btn btn-outline-secondary" disabled=${enviandoCvManual} onClick=${fecharModalCvManual}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled=${!arquivoCvManual || enviandoCvManual}
                    onClick=${enviarCvManual}
                  >
                    ${enviandoCvManual ? 'Adicionando...' : 'Adicionar'}
                  </button>
                </div>
              </footer>
            </${ModalPadrao}>
          `
      : null}

      ${podeAdicionarCvManual
      ? html`
            <${ModalPadrao}
              aberto=${modalCriarCurriculoAberto}
              titulo="Criar currículo"
              subtitulo="Preencha os dados do candidato para cadastrá-lo manualmente na Cx de Currículos."
              onClose=${fecharModalCriarCurriculo}
            >
              <div class="rh-details-body">
                ${erroCurriculoManual ? html`<div class="alert alert-warning">${erroCurriculoManual}</div>` : null}

                <div class="settings-ambiente-section">
                  <h3>Dados de contato</h3>
                  <div class="settings-password-grid">
                    <label class="settings-name-field">
                      <span>Nome completo *</span>
                      <input
                        class="form-control"
                        value=${formCurriculoManual.nome}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('nome', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>E-mail</span>
                      <input
                        class="form-control"
                        type="email"
                        value=${formCurriculoManual.email}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('email', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>Telefone / WhatsApp</span>
                      <input
                        class="form-control"
                        value=${formCurriculoManual.telefone}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('telefone', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>Vaga pretendida</span>
                      <input
                        class="form-control"
                        value=${formCurriculoManual.vaga_pretendida}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('vaga_pretendida', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>Cidade</span>
                      <input
                        class="form-control"
                        value=${formCurriculoManual.cidade}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('cidade', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>Bairro</span>
                      <input
                        class="form-control"
                        value=${formCurriculoManual.bairro}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('bairro', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>Endereço</span>
                      <input
                        class="form-control"
                        value=${formCurriculoManual.endereco}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('endereco', event.target.value)}
                      />
                    </label>
                    <label class="settings-name-field">
                      <span>Data de nascimento</span>
                      <input
                        class="form-control"
                        type="date"
                        value=${formCurriculoManual.data_nascimento}
                        disabled=${criandoCurriculoManual}
                        onInput=${(event) => atualizarCampoCurriculoManual('data_nascimento', event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div class="settings-ambiente-section">
                  <div class="process-cutoff-panel">
                    <label class="process-switch-row">
                      <input
                        type="checkbox"
                        checked=${formCurriculoManual.experiencia_ativa}
                        disabled=${criandoCurriculoManual}
                        onChange=${(event) => atualizarCampoCurriculoManual('experiencia_ativa', event.target.checked)}
                      />
                      <span class="process-switch-visual"></span>
                      <span>
                        <strong>Experiência profissional</strong>
                        <small>Ative para informar as experiências do candidato.</small>
                      </span>
                    </label>
                  </div>

                  ${formCurriculoManual.experiencia_ativa
          ? html`
                        <div class="rh-details-body">
                          ${formCurriculoManual.experiencias.map(
            (experiencia, indice) => html`
                              <div class="c24-card settings-ambiente-section" key=${indice}>
                                <div class="settings-password-grid">
                                  <label class="settings-name-field">
                                    <span>Empresa</span>
                                    <input
                                      class="form-control"
                                      value=${experiencia.empresa}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarExperienciaCurriculoManual(indice, 'empresa', event.target.value)}
                                    />
                                  </label>
                                  <label class="settings-name-field">
                                    <span>Cargo</span>
                                    <input
                                      class="form-control"
                                      value=${experiencia.cargo}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarExperienciaCurriculoManual(indice, 'cargo', event.target.value)}
                                    />
                                  </label>
                                  <label class="settings-name-field">
                                    <span>Período</span>
                                    <input
                                      class="form-control"
                                      placeholder="ex.: 2020 - 2023"
                                      value=${experiencia.periodo}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarExperienciaCurriculoManual(indice, 'periodo', event.target.value)}
                                    />
                                  </label>
                                </div>
                                <label class="settings-name-field">
                                  <span>Descrição</span>
                                  <textarea
                                    class="form-control"
                                    rows="2"
                                    value=${experiencia.descricao}
                                    disabled=${criandoCurriculoManual}
                                    onInput=${(event) =>
                atualizarExperienciaCurriculoManual(indice, 'descricao', event.target.value)}
                                  ></textarea>
                                </label>
                                <button
                                  type="button"
                                  class="btn btn-outline-secondary btn-sm"
                                  disabled=${criandoCurriculoManual}
                                  onClick=${() => removerExperienciaCurriculoManual(indice)}
                                >
                                  Remover experiência
                                </button>
                              </div>
                            `,
          )}
                          <button
                            type="button"
                            class="btn btn-outline-primary btn-sm"
                            disabled=${criandoCurriculoManual}
                            onClick=${adicionarExperienciaCurriculoManual}
                          >
                            + Adicionar experiência
                          </button>
                        </div>
                      `
          : null}
                </div>

                <div class="settings-ambiente-section">
                  <div class="process-cutoff-panel">
                    <label class="process-switch-row">
                      <input
                        type="checkbox"
                        checked=${formCurriculoManual.formacao_ativa}
                        disabled=${criandoCurriculoManual}
                        onChange=${(event) => atualizarCampoCurriculoManual('formacao_ativa', event.target.checked)}
                      />
                      <span class="process-switch-visual"></span>
                      <span>
                        <strong>Formação acadêmica</strong>
                        <small>Ative para informar a formação do candidato.</small>
                      </span>
                    </label>
                  </div>

                  ${formCurriculoManual.formacao_ativa
          ? html`
                        <div class="rh-details-body">
                          ${formCurriculoManual.formacao.map(
            (formacao, indice) => html`
                              <div class="c24-card settings-ambiente-section" key=${indice}>
                                <div class="settings-password-grid">
                                  <label class="settings-name-field">
                                    <span>Instituição</span>
                                    <input
                                      class="form-control"
                                      value=${formacao.instituicao}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarFormacaoCurriculoManual(indice, 'instituicao', event.target.value)}
                                    />
                                  </label>
                                  <label class="settings-name-field">
                                    <span>Curso</span>
                                    <input
                                      class="form-control"
                                      value=${formacao.curso}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarFormacaoCurriculoManual(indice, 'curso', event.target.value)}
                                    />
                                  </label>
                                  <label class="settings-name-field">
                                    <span>Nível</span>
                                    <input
                                      class="form-control"
                                      placeholder="ex.: Graduação"
                                      value=${formacao.nivel}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarFormacaoCurriculoManual(indice, 'nivel', event.target.value)}
                                    />
                                  </label>
                                  <label class="settings-name-field">
                                    <span>Período</span>
                                    <input
                                      class="form-control"
                                      placeholder="ex.: 2018 - 2022"
                                      value=${formacao.periodo}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarFormacaoCurriculoManual(indice, 'periodo', event.target.value)}
                                    />
                                  </label>
                                  <label class="settings-name-field">
                                    <span>Status</span>
                                    <input
                                      class="form-control"
                                      placeholder="ex.: Concluído"
                                      value=${formacao.status}
                                      disabled=${criandoCurriculoManual}
                                      onInput=${(event) =>
                atualizarFormacaoCurriculoManual(indice, 'status', event.target.value)}
                                    />
                                  </label>
                                </div>
                                <button
                                  type="button"
                                  class="btn btn-outline-secondary btn-sm"
                                  disabled=${criandoCurriculoManual}
                                  onClick=${() => removerFormacaoCurriculoManual(indice)}
                                >
                                  Remover formação
                                </button>
                              </div>
                            `,
          )}
                          <button
                            type="button"
                            class="btn btn-outline-primary btn-sm"
                            disabled=${criandoCurriculoManual}
                            onClick=${adicionarFormacaoCurriculoManual}
                          >
                            + Adicionar formação
                          </button>
                        </div>
                      `
          : null}
                </div>
              </div>
              <footer class="rh-modal-footer">
                <div class="rh-modal-footer-actions">
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    disabled=${criandoCurriculoManual}
                    onClick=${fecharModalCriarCurriculo}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled=${!formCurriculoManual.nome.trim() || criandoCurriculoManual}
                    onClick=${enviarCurriculoManual}
                  >
                    ${criandoCurriculoManual ? 'Criando...' : 'Criar currículo'}
                  </button>
                </div>
              </footer>
            </${ModalPadrao}>
          `
      : null}
    </${PainelRh}>
  `;
}

export function TelaHistorico({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [linhas, setLinhas] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [paginacao, setPaginacao] = useState({
    paginaAtual: 1,
    totalPaginas: 1,
    totalItens: 0,
  });
  const [filtros, setFiltros] = useState({ nome: '', vaga: '', data: '' });
  const [detalheAberto, setDetalheAberto] = useState(null);
  const [mapaStatus, setMapaStatus] = useState({});

  useEffect(() => {
    (async () => {
      setCarregando(true);
      try {
        const [historico, statusAtual] = await Promise.all([
          lerHistoricoPaginado({
            pagina,
            tamanho: TAMANHO_HISTORICO,
            nome: filtros.nome,
            vaga: filtros.vaga,
            data: filtros.data,
          }),
          construirMapaStatusAtual(),
        ]);
        setLinhas(Array.isArray(historico?.items) ? historico.items : []);
        setPaginacao({
          paginaAtual: historico?.page || pagina,
          totalPaginas: historico?.total_pages || 1,
          totalItens: historico?.total_items || 0,
        });
        setMapaStatus(statusAtual);
      } finally {
        setCarregando(false);
      }
    })();
  }, [filtros, pagina]);

  return html`
    <${PainelRh}
      screenId="screen-history"
      navAtiva="screen-history"
      subtituloMarca="Histórico de provas"
      placeholderBusca="Consulta do histórico de avaliações"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Iniciar teste',
      permissao: 'provas.enviar',
      onClick: () => controlador.iniciarNovoFluxo(),
    }}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="Console • Histórico"
        title="Histórico de exames"
        description="Consulte resultados salvos com filtros por candidato, vaga e data."
      />

      <${BlocoFiltro} tourId="history-filters">
        <div class="rh-filter-grid">
          <${CampoFiltro} label="Candidato" icon="person_search">
            <input
              class="form-control"
              placeholder="Pesquisar por nome..."
              value=${filtros.nome}
              onInput=${(event) => {
      setPagina(1);
      setFiltros({ ...filtros, nome: event.target.value });
    }}
            />
          </${CampoFiltro}>

          <${CampoFiltro} label="Vaga" icon="work">
            <input
              class="form-control"
              placeholder="Pesquisar por vaga..."
              value=${filtros.vaga}
              onInput=${(event) => {
      setPagina(1);
      setFiltros({ ...filtros, vaga: event.target.value });
    }}
            />
          </${CampoFiltro}>

          <${CampoFiltro} label="Data" icon="calendar_month">
            <input
              class="form-control"
              type="date"
              value=${filtros.data}
              onInput=${(event) => {
      setPagina(1);
      setFiltros({ ...filtros, data: event.target.value });
    }}
            />
          </${CampoFiltro}>
        </div>
      </${BlocoFiltro}>

      <${SectionCard}
        title="Resultados salvos"
        description="Tabela consolidada com status atualizado e ações de consulta."
        tourId="history-results"
      >
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Vaga</th>
                <th>Nível</th>
                <th>Data</th>
                <th>Nota</th>
                <th>Status</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${7} linhas=${6} />`
      : linhas.length
        ? linhas.map(
          (linha) => html`
                        <tr key=${linha.id_teste}>
                          <td>${linha.nome_candidato || '-'}</td>
                          <td>${linha.vaga || '-'}</td>
                          <td>${linha.nivel || '-'}</td>
                          <td>${linha.data_exibicao || '-'}</td>
                          <td>
                            ${formatarPontuacaoDetalhada(
            linha.pontuacao_final,
            '',
          )}
                          </td>
                          <td>
                            <span
                              class=${`rh-status-pill ${obterClasseSituacaoAtual(obterRotuloSituacaoAtual(linha, mapaStatus))}`}
                            >
                              ${obterRotuloSituacaoAtual(linha, mapaStatus)}
                            </span>
                          </td>
                          <td class="text-end">
                            <div class="d-flex justify-content-end gap-2 flex-wrap">
                              <button
                                type="button"
                                class="btn btn-sm btn-outline-primary"
                                onClick=${async () =>
              setDetalheAberto(
                await carregarDetalhesProva(linha.id_teste),
              )}
                              >
                                Detalhes
                              </button>
                              <button
                                type="button"
                                class="btn btn-sm btn-outline-success"
                                onClick=${() =>
              baixarPacoteHistorico(
                linha.id_teste,
                linha.nome_candidato || 'candidato',
              )}
                              >
                                Baixar prova
                              </button>
                            </div>
                          </td>
                        </tr>
                      `,
        )
        : html`
                      <${TabelaVazia}
                        colunas=${7}
                        texto="Nenhum registro encontrado para os filtros informados."
                        icone="search_off"
                      />
                    `}
            </tbody>
          </table>
        </div>

        <${GrupoPaginacao}
          paginaAtual=${paginacao.paginaAtual}
          totalPaginas=${paginacao.totalPaginas}
          onChange=${setPagina}
        />
      </${SectionCard}>

      <${ModalDetalhesProva}
        detalhe=${detalheAberto}
        onClose=${() => setDetalheAberto(null)}
        onDownload=${() =>
      baixarPacoteHistorico(
        detalheAberto?.linha?.id_teste,
        detalheAberto?.linha?.nome_candidato || 'candidato',
      )}
        onCandidateDetails=${async () => {
      try {
        await abrirFichaCandidatoDaProva(detalheAberto);
      } catch (error) {
        showToast('Não foi possível localizar a ficha deste candidato.', 'error');
      }
    }}
      />
    </${PainelRh}>
  `;
}

export function TelaCriarProcesso({ controlador }) {
  const [formulario, setFormulario] = useState({
    vaga: '',
    quantidade: 1,
    dataEncerramento: '',
    operacao: '',
    trilha: '',
    urgente: false,
    usaNotaCorte: false,
    notaCorte: '',
    areaProva: '',
    nivelProva: '',
    nivelDificuldade: 3,
    tempoTotal: 40,
    tipoProva: 'Processo seletivo',
    personalizacaoInteligente: false,
    clientesPersonalizacao: [],
    clienteOutro: '',
    tiposAtendimento: [],
    tipoAtendimentoOutro: '',
    nivelPersonalizacao: 'situacional',
    tomProva: 'Humanizado',
    situacaoPraticaOperacao: '',
    etapasPersonalizadas: ETAPAS_PERSONALIZADAS_PROCESSO.map((item) => item.key),
    manterNivelPadraoEtapas: true,
    niveisEtapas: {},
    disponibilidade: [],
    tipoContratacao: '',
    tipoContratacaoOutro: '',
    modeloTrabalho: '',
    hibridoEscala: '',
    jornadaTrabalho: '',
    jornadaOutroDetalhe: { dias: [], horaInicio: '', horaFim: '' },
    trabalhoEscala: '',
    escolaridadeMinima: '',
    cursosSuperior: '',
    experienciaPrevia: '',
    experienciasEspecificas: [],
    idioma: '',
    skillsTags: '',
    salario: '',
    mostrarSalario: false,
    beneficios: BENEFICIOS_PROCESSO_PADRAO.map((nome) => ({ nome, selecionado: false, valor: '' })),
    descricaoAtividades: '',
    descricaoAtividadesEditada: false,
    treinamentosSelecionados: [],
    // Correções.txt item 9: testes complementares (independentes do Conecta
    // Provas) oferecidos ao candidato quando a prova deste processo é
    // liberada — ver montarConfiguracaoProva() e liberarProvaDoProcesso().
    testesComplementares: { disc: false, fitCultural: false, raciocinioLogico: false },
  });
  const [etapaAtual, setEtapaAtual] = useState(1);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [modalTalentosAberto, setModalTalentosAberto] = useState(false);
  const [processoRecemCriado, setProcessoRecemCriado] = useState('');
  const [sugestoesTalentos, setSugestoesTalentos] = useState([]);
  const [carregandoSugestoesTalentos, setCarregandoSugestoesTalentos] = useState(false);
  const [usandoTalentoId, setUsandoTalentoId] = useState(null);
  const [modalCompartilharAberto, setModalCompartilharAberto] = useState(false);
  const [operacoesCadastradas, setOperacoesCadastradas] = useState([]);
  const [trilhasDisponiveis, setTrilhasDisponiveis] = useState([]);
  const [modalJornadaOutroAberto, setModalJornadaOutroAberto] = useState(false);
  const [modalTreinamentosAberto, setModalTreinamentosAberto] = useState(false);
  const [novaExperienciaEspecifica, setNovaExperienciaEspecifica] = useState('');

  useEffect(() => {
    let cancelado = false;
    listarOperacoes()
      .then((itens) => {
        if (!cancelado && Array.isArray(itens)) setOperacoesCadastradas(itens);
      })
      .catch(() => {
        // Mantém a lista estática (OPCOES_OPERACOES) como fallback silencioso.
      });
    listarTrilhasOnboarding()
      .then((itens) => {
        if (!cancelado && Array.isArray(itens)) setTrilhasDisponiveis(itens);
      })
      .catch(() => {
        // Seleção de treinamentos é opcional — sem a lista, o passo fica vazio.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const operacaoSelecionada = useMemo(
    () => operacoesCadastradas.find((item) => item.nome === formulario.operacao),
    [operacoesCadastradas, formulario.operacao],
  );

  useEffect(() => {
    if (!operacaoSelecionada) return;
    const payload = operacaoSelecionada.payload || {};
    setFormulario((anterior) => ({
      ...anterior,
      modeloTrabalho: anterior.modeloTrabalho || payload.modalidade || '',
      jornadaTrabalho: anterior.jornadaTrabalho || (payload.jornadas_trabalho || [])[0] || '',
      descricaoAtividades: anterior.descricaoAtividadesEditada
        ? anterior.descricaoAtividades
        : payload.descricao_atividades || anterior.descricaoAtividades,
    }));
  }, [operacaoSelecionada]);

  useEffect(() => {
    if (!trilhasDisponiveis.length || formulario.treinamentosSelecionados.length) return;
    const padroes = trilhasDisponiveis
      .filter((trilha) => normalizarBuscaPainel(trilha.categoria) === normalizarBuscaPainel('Onboarding'))
      .map((trilha) => trilha.id_trilha);
    if (padroes.length) {
      setFormulario((anterior) => ({ ...anterior, treinamentosSelecionados: padroes }));
    }
  }, [trilhasDisponiveis]);

  const alternarTreinamentoSelecionado = (idTrilha) => {
    setFormulario((anterior) => {
      const atuais = anterior.treinamentosSelecionados;
      const treinamentosSelecionados = atuais.includes(idTrilha)
        ? atuais.filter((item) => item !== idTrilha)
        : [...atuais, idTrilha];
      return { ...anterior, treinamentosSelecionados };
    });
  };

  const alternarBeneficioProcesso = (nome) => {
    setFormulario((anterior) => ({
      ...anterior,
      beneficios: anterior.beneficios.map((item) =>
        item.nome === nome ? { ...item, selecionado: !item.selecionado } : item,
      ),
    }));
  };

  const atualizarValorBeneficioProcesso = (nome, valor) => {
    setFormulario((anterior) => ({
      ...anterior,
      beneficios: anterior.beneficios.map((item) => (item.nome === nome ? { ...item, valor } : item)),
    }));
  };

  const alternarDiaJornadaOutro = (dia) => {
    setFormulario((anterior) => {
      const dias = anterior.jornadaOutroDetalhe.dias.includes(dia)
        ? anterior.jornadaOutroDetalhe.dias.filter((item) => item !== dia)
        : [...anterior.jornadaOutroDetalhe.dias, dia];
      return { ...anterior, jornadaOutroDetalhe: { ...anterior.jornadaOutroDetalhe, dias } };
    });
  };

  const atualizarHorarioJornadaOutro = (campo, valor) => {
    setFormulario((anterior) => ({
      ...anterior,
      jornadaOutroDetalhe: { ...anterior.jornadaOutroDetalhe, [campo]: valor },
    }));
  };

  const adicionarExperienciaEspecifica = () => {
    const valor = novaExperienciaEspecifica.trim();
    if (!valor || formulario.experienciasEspecificas.includes(valor)) return;
    setFormulario((anterior) => ({
      ...anterior,
      experienciasEspecificas: [...anterior.experienciasEspecificas, valor],
    }));
    setNovaExperienciaEspecifica('');
  };

  const removerExperienciaEspecifica = (valor) => {
    setFormulario((anterior) => ({
      ...anterior,
      experienciasEspecificas: anterior.experienciasEspecificas.filter((item) => item !== valor),
    }));
  };

  const opcoesOperacaoDisponiveis = useMemo(() => {
    const nomesCadastrados = new Set(operacoesCadastradas.map((item) => item.nome));
    const extras = OPCOES_OPERACOES.filter((nome) => !nomesCadastrados.has(nome));
    return [...operacoesCadastradas.map((item) => item.nome), ...extras];
  }, [operacoesCadastradas]);

  useEffect(() => {
    if (!opcoesOperacaoDisponiveis.length) return;
    const argumento = sessionStorage.getItem(CHAVE_COMANDO_NOVO_PROCESSO);
    if (argumento === null) return;
    sessionStorage.removeItem(CHAVE_COMANDO_NOVO_PROCESSO);
    if (!argumento.trim()) return;
    const termo = normalizarTextoPainel(argumento);
    const encontrada = opcoesOperacaoDisponiveis.find(
      (nome) => normalizarTextoPainel(nome).includes(termo) || termo.includes(normalizarTextoPainel(nome)),
    );
    if (encontrada) {
      setFormulario((anterior) => ({ ...anterior, operacao: encontrada }));
    }
  }, [opcoesOperacaoDisponiveis]);

  useEffect(() => {
    const bruto = sessionStorage.getItem(CHAVE_DUPLICAR_PROCESSO);
    if (bruto === null) return;
    sessionStorage.removeItem(CHAVE_DUPLICAR_PROCESSO);
    try {
      const dados = JSON.parse(bruto) || {};
      setFormulario((anterior) => ({
        ...anterior,
        vaga: dados.vaga || anterior.vaga,
        operacao: dados.operacao || anterior.operacao,
        trilha: dados.trilha || anterior.trilha,
        usaNotaCorte: Boolean(dados.usaNotaCorte),
        notaCorte: dados.notaCorte || anterior.notaCorte,
      }));
    } catch (error) {
      // Prefill é um atalho opcional — se o JSON vier inválido, segue com o formulário em branco.
    }
  }, []);

  const regras = obterRegrasFormularioProcesso(formulario.vaga);
  const permiteTipoAtendimento = vagaPermiteTipoAtendimentoProcesso(formulario.vaga);
  const trilhaEfetiva = regras.trilhaFixa || formulario.trilha;
  const trilhaBlueprint = normalizarTrilhaProvaProcesso(
    formulario.areaProva || trilhaEfetiva,
  );

  useEffect(() => {
    if (regras.trilhaFixa && formulario.trilha !== regras.trilhaFixa) {
      setFormulario((anterior) => ({ ...anterior, trilha: regras.trilhaFixa }));
    }
  }, [regras.trilhaFixa, formulario.trilha]);

  useEffect(() => {
    const areaSelecionada = normalizarTextoPainel(trilhaEfetiva);
    if (!areaSelecionada || formulario.areaProva === areaSelecionada) return;
    setFormulario((anterior) => ({ ...anterior, areaProva: areaSelecionada }));
  }, [trilhaEfetiva, formulario.areaProva]);

  useEffect(() => {
    if (!formulario.vaga) return;
    const opcao = obterOpcaoVagaProvaProcesso(formulario.vaga);
    const areaSugerida = normalizarTextoPainel(opcao?.track || trilhaEfetiva || '');
    const nivelSugerido = normalizarNivelProvaProcesso(
      SUGESTOES_NIVEL_POR_VAGA[formulario.vaga] || opcao?.level || '',
    );
    setFormulario((anterior) => ({
      ...anterior,
      areaProva: anterior.areaProva || areaSugerida,
      nivelProva: anterior.nivelProva || nivelSugerido,
      trilha: anterior.trilha || normalizarTrilhaProvaProcesso(areaSugerida),
    }));
  }, [formulario.vaga]);

  const blueprint = useMemo(() => {
    if (!formulario.vaga || !formulario.nivelProva) return null;
    return resolverBlueprintProva(
      formulario.vaga,
      formulario.nivelProva,
      trilhaBlueprint,
    );
  }, [formulario.vaga, formulario.nivelProva, trilhaBlueprint]);

  const dificuldadeProva = mapearNivelDificuldadeProcesso(formulario.nivelDificuldade);
  const questoes = useMemo(
    () => (blueprint ? montarProvaPorBlueprint(blueprint, dificuldadeProva) : []),
    [blueprint, dificuldadeProva],
  );
  const etapasProva = useMemo(
    () => montarEtapasBlueprintProcesso(blueprint),
    [blueprint],
  );
  const etapasDisponiveisPersonalizacao = useMemo(
    () => obterEtapasDisponiveisPersonalizacaoProcesso(formulario, trilhaBlueprint),
    [formulario.vaga, formulario.areaProva, formulario.trilha, trilhaBlueprint],
  );
  const etapasSelecionadasPersonalizacao = useMemo(() => {
    const selecionadas = new Set(
      Array.isArray(formulario.etapasPersonalizadas) ? formulario.etapasPersonalizadas : [],
    );
    return etapasDisponiveisPersonalizacao
      .map((item) => item.key)
      .filter((etapaKey) => selecionadas.has(etapaKey));
  }, [formulario.etapasPersonalizadas, etapasDisponiveisPersonalizacao]);
  const questoesConfiguradas = useMemo(
    () => montarQuestoesEtapasPersonalizadasProcesso({
      formulario: {
        ...formulario,
        etapasPersonalizadas: etapasSelecionadasPersonalizacao,
      },
      trilhaBlueprint,
      questoesPadrao: questoes,
    }),
    [
      formulario.personalizacaoInteligente,
      etapasSelecionadasPersonalizacao,
      formulario.manterNivelPadraoEtapas,
      formulario.niveisEtapas,
      formulario.vaga,
      formulario.nivelProva,
      formulario.nivelDificuldade,
      trilhaBlueprint,
      questoes,
    ],
  );
  const etapasConfiguradasProva = useMemo(
    () =>
      formulario.personalizacaoInteligente
        ? montarEtapasPersonalizadasProcesso(questoesConfiguradas, etapasSelecionadasPersonalizacao)
        : etapasProva,
    [formulario.personalizacaoInteligente, etapasSelecionadasPersonalizacao, questoesConfiguradas, etapasProva],
  );
  const categoriasConfiguradasProva = useMemo(
    () => obterCategoriasQuestoesProcesso(questoesConfiguradas),
    [questoesConfiguradas],
  );
  const opcoesAreasProva = useMemo(
    () => montarOpcoesComValorProcesso(OPCOES_AREAS_PROVA_PROCESSO, formulario.areaProva),
    [formulario.areaProva],
  );
  const opcoesNiveisProva = useMemo(() => {
    if (
      !formulario.nivelProva ||
      OPCOES_NIVEL_PROVA_PROCESSO.some(
        (opcao) =>
          normalizarBuscaPainel(opcao.value) === normalizarBuscaPainel(formulario.nivelProva),
      )
    ) {
      return OPCOES_NIVEL_PROVA_PROCESSO;
    }
    return [
      { value: formulario.nivelProva, label: formulario.nivelProva },
      ...OPCOES_NIVEL_PROVA_PROCESSO,
    ];
  }, [formulario.nivelProva]);
  const processoCompartilhamento = useMemo(
    () => ({
      vaga: formulario.vaga,
      cargo: formulario.vaga,
      data_encerramento: formulario.dataEncerramento,
      operacao: formulario.operacao,
      trilha: trilhaEfetiva,
      status: 'Aberto',
    }),
    [formulario.vaga, formulario.dataEncerramento, formulario.operacao, trilhaEfetiva],
  );
  const requisitosCompartilhamento = useMemo(
    () => montarItensPublicosPadrao(REQUISITOS_PUBLICOS_PADRAO),
    [],
  );
  const responsabilidadesCompartilhamento = useMemo(
    () => montarItensPublicosPadrao(RESPONSABILIDADES_PUBLICAS_PADRAO),
    [],
  );
  const textoCompartilhamentoVaga = useMemo(
    () => montarTextoCompartilhamentoVaga({
      processo: processoCompartilhamento,
      requisitos: requisitosCompartilhamento,
      responsabilidades: responsabilidadesCompartilhamento,
    }),
    [processoCompartilhamento, requisitosCompartilhamento, responsabilidadesCompartilhamento],
  );

  useEffect(() => {
    if (!formulario.personalizacaoInteligente) return;
    const disponiveis = etapasDisponiveisPersonalizacao.map((item) => item.key);
    setFormulario((anterior) => {
      const selecionadasAtuais = Array.isArray(anterior.etapasPersonalizadas)
        ? anterior.etapasPersonalizadas
        : [];
      const selecionadasFiltradas = selecionadasAtuais.filter((etapaKey) => disponiveis.includes(etapaKey));
      const proximasSelecionadas = selecionadasFiltradas.length ? selecionadasFiltradas : disponiveis;
      const niveisEtapas = Object.fromEntries(
        Object.entries(anterior.niveisEtapas || {}).filter(([etapaKey]) => disponiveis.includes(etapaKey)),
      );
      const mesmaSelecao =
        proximasSelecionadas.length === selecionadasAtuais.length &&
        proximasSelecionadas.every((etapaKey, indice) => etapaKey === selecionadasAtuais[indice]);
      if (mesmaSelecao && Object.keys(niveisEtapas).length === Object.keys(anterior.niveisEtapas || {}).length) {
        return anterior;
      }
      return {
        ...anterior,
        etapasPersonalizadas: proximasSelecionadas,
        niveisEtapas,
      };
    });
  }, [formulario.personalizacaoInteligente, etapasDisponiveisPersonalizacao]);

  const atualizarCampo = (campo, valor) => {
    setFormulario((anterior) => ({
      ...anterior,
      [campo]: valor,
      ...(campo === 'vaga'
        ? {
          areaProva: '',
          nivelProva: '',
          niveisEtapas: {},
          tiposAtendimento: [],
          tipoAtendimentoOutro: '',
        }
        : {}),
      ...(campo === 'areaProva'
        ? { trilha: normalizarTrilhaProvaProcesso(valor) || anterior.trilha }
        : {}),
    }));
    setErro('');
  };

  const adicionarDisponibilidade = () => {
    setFormulario((anterior) => ({
      ...anterior,
      disponibilidade: [
        ...anterior.disponibilidade,
        {
          id: `disp-${Date.now()}-${anterior.disponibilidade.length}`,
          data: '',
          somenteDia: false,
          horaInicio: '09:00',
          horaFim: '12:00',
          duracaoMinutos: 30,
          capacidadeTotal: 1,
        },
      ],
    }));
  };

  const atualizarDisponibilidade = (id, campo, valor) => {
    setFormulario((anterior) => ({
      ...anterior,
      disponibilidade: anterior.disponibilidade.map((item) =>
        item.id === id ? { ...item, [campo]: valor } : item,
      ),
    }));
  };

  const removerDisponibilidade = (id) => {
    setFormulario((anterior) => ({
      ...anterior,
      disponibilidade: anterior.disponibilidade.filter((item) => item.id !== id),
    }));
  };

  const alternarEtapaPersonalizada = (etapaKey, marcada) => {
    setFormulario((anterior) => {
      const atuais = Array.isArray(anterior.etapasPersonalizadas) ? anterior.etapasPersonalizadas : [];
      const proximas = marcada
        ? Array.from(new Set([...atuais, etapaKey]))
        : atuais.filter((item) => item !== etapaKey);
      const niveisEtapas = { ...(anterior.niveisEtapas || {}) };
      if (!marcada) delete niveisEtapas[etapaKey];
      return {
        ...anterior,
        etapasPersonalizadas: proximas,
        niveisEtapas,
      };
    });
    setErro('');
  };

  const atualizarNivelEtapaPersonalizada = (etapaKey, nivel) => {
    setFormulario((anterior) => ({
      ...anterior,
      niveisEtapas: {
        ...(anterior.niveisEtapas || {}),
        [etapaKey]: nivel,
      },
    }));
    setErro('');
  };

  const montarDadosPersonalizacao = () => {
    const clienteOperacao = normalizarTextoPainel(formulario.operacao);
    const clientes = clienteOperacao ? [clienteOperacao] : [];
    const tiposAtendimento = permiteTipoAtendimento
      ? montarListaComOutroProcesso(
        formulario.tiposAtendimento,
        formulario.tipoAtendimentoOutro,
      )
      : [];

    return {
      enabled: Boolean(formulario.personalizacaoInteligente),
      clientes,
      tiposAtendimento,
      operacao: clientes.join(', '),
      tipo_atendimento: tiposAtendimento,
      nivel_personalizacao: formulario.nivelPersonalizacao,
      tom_prova: normalizarTextoPainel(formulario.tomProva),
      situacao_pratica: '',
      situacao_pratica_operacao: '',
    };
  };

  const montarConfiguracaoPersonalizacao = (personalizacao) => ({
    operacao: personalizacao.operacao,
    cliente: personalizacao.operacao,
    clientesOperacoes: personalizacao.clientes,
    vaga: formulario.vaga,
    area: formulario.areaProva,
    trilha: trilhaBlueprint,
    nivelProva: formulario.nivelProva,
    perfilOperacao: inferirPerfilAtendimentoPersonalizacao({
      clientes: personalizacao.clientes,
      tipos: personalizacao.tiposAtendimento,
      area: formulario.areaProva,
      vaga: formulario.vaga,
    }) || inferirPerfilOperacaoProcesso(formulario),
    tiposAtendimento: personalizacao.tiposAtendimento,
    nivelPersonalizacao: personalizacao.nivel_personalizacao,
    tomProva: formulario.tomProva,
    situacaoPratica: '',
    usuario:
      controlador?.estado?.nomeUsuarioAutenticado ||
      controlador?.estado?.usuarioAutenticado ||
      'RH',
  });

  const validarEtapaDadosProcesso = () =>
    validarFormularioProcesso(
      {
        vaga: formulario.vaga,
        quantidade: formulario.quantidade,
        dataEncerramento: formulario.dataEncerramento,
        operacao: formulario.operacao,
        trilha: trilhaEfetiva,
        usaNotaCorte: formulario.usaNotaCorte,
        notaCorte: formulario.notaCorte,
      },
      regras,
    );

  const validarEtapaProva = () => {
    if (
      !formulario.areaProva ||
      !formulario.nivelProva ||
      !Number(formulario.tempoTotal) ||
      !blueprint ||
      !questoesConfiguradas.length
    ) {
      return 'Selecione área/trilha, nível e tempo com uma configuração de prova válida.';
    }
    if (formulario.personalizacaoInteligente) {
      const personalizacao = montarDadosPersonalizacao();
      const etapasSelecionadas = etapasSelecionadasPersonalizacao;
      if (!etapasSelecionadas.length) {
        return 'Selecione ao menos uma etapa para compor a prova personalizada.';
      }
      const etapaSemQuestoes = etapasSelecionadas.find(
        (etapaKey) => !questoesConfiguradas.some(
          (questao) => obterChaveEtapaPersonalizadaQuestao(questao) === etapaKey,
        ),
      );
      if (etapaSemQuestoes) {
        const etapa = ETAPAS_PERSONALIZADAS_PROCESSO.find((item) => item.key === etapaSemQuestoes);
        return `A etapa ${etapa?.label || etapaSemQuestoes} não possui questões para a vaga e nível selecionados.`;
      }
      if (!formulario.manterNivelPadraoEtapas) {
        const pendenteNivel = etapasSelecionadas.some((etapaKey) => !formulario.niveisEtapas?.[etapaKey]);
        if (pendenteNivel) {
          return 'Defina o nível de todas as etapas selecionadas ou mantenha o nível padrão.';
        }
      }
      if (permiteTipoAtendimento && !personalizacao.tiposAtendimento.length) {
        return 'Selecione ao menos um tipo de atendimento para personalizar a prova.';
      }
    }
    return '';
  };

  const montarConfiguracaoProva = () => {
    const personalizacao = montarDadosPersonalizacao();
    const configuracaoPersonalizacao = formulario.personalizacaoInteligente
      ? montarConfiguracaoPersonalizacao(personalizacao)
      : null;
    const resultadoPersonalizacao = formulario.personalizacaoInteligente
      ? gerarPersonalizacaoProva(questoesConfiguradas, configuracaoPersonalizacao)
      : null;
    const questoesSnapshot = resultadoPersonalizacao?.questoes?.length
      ? resultadoPersonalizacao.questoes
      : questoesConfiguradas;
    const niveisEtapasSelecionadas = Object.fromEntries(
      etapasSelecionadasPersonalizacao
        .map((etapaKey) => [etapaKey, formulario.niveisEtapas?.[etapaKey]])
        .filter(([, nivel]) => normalizarTextoPainel(nivel)),
    );
    const configuradaEm = new Date().toISOString();

    return {
      versao: 1,
      origem: 'processo_seletivo',
      status: 'configurada',
      configurada_em: configuradaEm,
      vaga: formulario.vaga,
      area: formulario.areaProva,
      area_prova: formulario.areaProva,
      nivel: formulario.nivelProva,
      tempo_total: Number(formulario.tempoTotal || 40),
      tempo_minutos: Number(formulario.tempoTotal || 40),
      tipo_prova: formulario.tipoProva,
      quantidade_questoes: questoesSnapshot.length,
      etapas: etapasConfiguradasProva,
      categorias: categoriasConfiguradasProva,
      questoes_snapshot: questoesSnapshot,
      nivel_dificuldade_prova: formulario.nivelDificuldade,
      dificuldade_mapeada: mapearNivelDificuldadeProcesso(formulario.nivelDificuldade),
      tom_prova: formulario.tomProva,
      situacao_pratica_operacao: formulario.personalizacaoInteligente ? '' : formulario.situacaoPraticaOperacao,
      personalizacao,
      // Correções.txt item 9: lido em montarPayloadLiberacaoProva()
      // (fonte/features/processos/index.js) para provisionar automaticamente
      // os testes complementares habilitados quando a prova é liberada.
      testes_complementares: {
        disc: Boolean(formulario.testesComplementares?.disc),
        fit_cultural: Boolean(formulario.testesComplementares?.fitCultural),
        raciocinio_logico: Boolean(formulario.testesComplementares?.raciocinioLogico),
      },
      configuracao: {
        blueprint_key: blueprint?.key || '',
        blueprint_label: blueprint?.label || formulario.areaProva || '',
        area_prova: formulario.areaProva,
        area: formulario.areaProva,
        trilha_blueprint: trilhaBlueprint,
        setor_cliente: formulario.personalizacaoInteligente
          ? personalizacao.operacao
          : formulario.operacao,
        operacao: formulario.personalizacaoInteligente
          ? personalizacao.operacao
          : formulario.operacao,
        personalizacao_inteligente: Boolean(formulario.personalizacaoInteligente),
        personalizacao: formulario.personalizacaoInteligente
          ? {
            ...personalizacao,
            operacao: personalizacao.operacao,
            setor_cliente: personalizacao.operacao,
            tom_prova: formulario.tomProva,
            situacao_pratica_operacao: '',
            tipos_atendimento: personalizacao.tiposAtendimento,
            perfil_operacao: configuracaoPersonalizacao?.perfilOperacao,
            nivel_personalizacao: configuracaoPersonalizacao?.nivelPersonalizacao,
            etapas_selecionadas: etapasSelecionadasPersonalizacao,
            manter_nivel_padrao: Boolean(formulario.manterNivelPadraoEtapas),
            niveis_por_etapa: formulario.manterNivelPadraoEtapas ? {} : niveisEtapasSelecionadas,
            historico: resultadoPersonalizacao?.historico || null,
            alertas: resultadoPersonalizacao?.alertas || [],
          }
          : {
            enabled: false,
            opcional: true,
            mensagem: 'Prova padrão configurada para este processo seletivo.',
          },
        entrevista_obrigatoria: false,
        etapas_selecionadas: formulario.personalizacaoInteligente ? etapasSelecionadasPersonalizacao : [],
        niveis_por_etapa: formulario.personalizacaoInteligente && !formulario.manterNivelPadraoEtapas
          ? niveisEtapasSelecionadas
          : {},
        manter_nivel_padrao_etapas: Boolean(formulario.manterNivelPadraoEtapas),
      },
    };
  };

  const avancar = () => {
    const mensagemErro =
      etapaAtual === 1
        ? validarEtapaDadosProcesso()
        : etapaAtual === 2
          ? validarEtapaProva()
          : '';
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }
    setErro('');
    setEtapaAtual((etapa) => Math.min(7, etapa + 1));
  };

  const montarDetalhesVaga = () => ({
    tipo_contratacao: formulario.tipoContratacao === 'Outro' ? formulario.tipoContratacaoOutro : formulario.tipoContratacao,
    modelo_trabalho: formulario.modeloTrabalho,
    hibrido_escala: formulario.modeloTrabalho === 'hibrido' ? formulario.hibridoEscala : '',
    jornada_trabalho: formulario.jornadaTrabalho,
    jornada_trabalho_outro: formulario.jornadaTrabalho === 'outro' ? formulario.jornadaOutroDetalhe : null,
    trabalho_escala: formulario.trabalhoEscala,
    escolaridade_minima: formulario.escolaridadeMinima,
    cursos_superior: formulario.escolaridadeMinima === 'superior'
      ? formulario.cursosSuperior.split(',').map((item) => item.trim()).filter(Boolean)
      : [],
    experiencia_previa: formulario.experienciaPrevia,
    experiencias_especificas: formulario.experienciaPrevia === 'especificas' ? formulario.experienciasEspecificas : [],
    idiomas: {
      portugues: 'nativo',
      exigido: formulario.idioma || null,
    },
    skills_tags: formulario.skillsTags.split(',').map((item) => item.trim()).filter(Boolean),
    salario: formulario.salario ? Number(formulario.salario) : null,
    mostrar_salario: Boolean(formulario.mostrarSalario),
    beneficios: formulario.beneficios.filter((item) => item.selecionado).map((item) => ({ nome: item.nome, valor: item.valor })),
    descricao_atividades: formulario.descricaoAtividades,
    treinamentos_selecionados: formulario.treinamentosSelecionados,
  });

  const criar = async () => {
    const mensagemErro = validarEtapaDadosProcesso() || validarEtapaProva();
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }

    setErro('');
    setSalvando(true);

    try {
      const configuracaoProva = montarConfiguracaoProva();
      const idProcessoCriado = montarIdProcesso(formulario.vaga);
      await criarProcesso({
        id_processo: idProcessoCriado,
        vaga: formulario.vaga,
        quantidade_vagas: Number(formulario.quantidade),
        vagas_preenchidas: 0,
        data_encerramento: formulario.dataEncerramento,
        operacao: formulario.operacao,
        trilha: trilhaEfetiva,
        usa_nota_corte: formulario.usaNotaCorte ? 1 : 0,
        nota_corte: formulario.usaNotaCorte
          ? Number(formulario.notaCorte)
          : null,
        status: 'Aberto',
        data_criacao: new Date().toISOString(),
        link_agendamento: '',
        configuracao_prova_json: JSON.stringify(configuracaoProva),
        prova_configurada_em: configuracaoProva.configurada_em,
        urgente: Boolean(formulario.urgente),
        detalhes_vaga_json: JSON.stringify(montarDetalhesVaga()),
      });

      const disponibilidadesValidas = formulario.disponibilidade.filter((item) => item.data);
      for (const item of disponibilidadesValidas) {
        try {
          await criarSlotsEntrevista({
            id_processo: idProcessoCriado,
            data: item.data,
            somente_dia: Boolean(item.somenteDia),
            hora_inicio: item.somenteDia ? '' : item.horaInicio,
            hora_fim: item.somenteDia ? '' : item.horaFim,
            duracao_minutos: Number(item.duracaoMinutos) || 30,
            capacidade_total: Number(item.capacidadeTotal) || 1,
          });
        } catch (erroSlot) {
          // O processo já foi criado com sucesso — se um horário específico falhar
          // (ex.: conflito), o RH ainda pode ajustar a disponibilidade depois em
          // Processos > Entrevistas, então não bloqueamos a publicação por isso.
        }
      }

      // Correções.txt item 15: ao concluir a criação, mostra automaticamente
      // candidatos do Banco de Talentos compatíveis com a vaga — sempre
      // abre o modal, mesmo sem sugestões (feedback explícito de "nenhum
      // candidato compatível" em vez de navegar direto em silêncio).
      setProcessoRecemCriado(idProcessoCriado);
      setModalTalentosAberto(true);
      setCarregandoSugestoesTalentos(true);
      lerCandidatosSugeridosProcesso(idProcessoCriado)
        .then((resultado) => setSugestoesTalentos(Array.isArray(resultado?.candidatos) ? resultado.candidatos : []))
        .catch(() => setSugestoesTalentos([]))
        .finally(() => setCarregandoSugestoesTalentos(false));
    } catch (error) {
      setErro(error?.message || 'Não foi possível criar o processo.');
    } finally {
      setSalvando(false);
    }
  };

  const fecharModalTalentosENavegar = () => {
    setModalTalentosAberto(false);
    controlador.irParaTelaProtegida('screen-processes');
  };

  const adicionarTalentoAoProcesso = async (candidato) => {
    setUsandoTalentoId(candidato.id_banco);
    try {
      await usarCandidatoDoBancoTalentos(candidato.id_banco, { id_processo: processoRecemCriado });
      setSugestoesTalentos((atual) => atual.filter((item) => item.id_banco !== candidato.id_banco));
    } catch (error) {
      setErro(error?.message || 'Não foi possível adicionar este candidato ao processo.');
    } finally {
      setUsandoTalentoId(null);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-process-create"
      navAtiva="screen-process-create"
      subtituloMarca="Novo processo seletivo"
      placeholderBusca="Cadastro de novo processo"
      controlador=${controlador}
      acaoPrimaria=${etapaAtual < 7
      ? { label: 'Próximo passo', icon: 'arrow_forward', onClick: avancar, disabled: salvando }
      : { label: salvando ? 'Publicando...' : 'Publicar processo', icon: 'check', onClick: criar, disabled: salvando }}
    >
      <${PageIntro}
        kicker="Console • Novo processo"
        title=${`Etapa ${etapaAtual}: ${etapaAtual === 1
      ? 'Dados do Processo'
      : etapaAtual === 2
        ? 'Configuração da Prova'
        : etapaAtual === 3
          ? 'Disponibilidade de Horários para Entrevistas'
          : etapaAtual === 4
            ? 'Detalhes da Vaga'
            : etapaAtual === 5
              ? 'Salário e Benefícios'
              : etapaAtual === 6
                ? 'Treinamentos'
                : 'Publicação'
    }`}
        description="Cadastre a vaga e configure a prova vinculada ao processo seletivo."
      />

      <div class="process-create-shell">
        <${WizardStepper}
          etapas=${[
      ['1', 'Dados do Processo'],
      ['2', 'Configuração da Prova'],
      ['3', 'Disponibilidade de Horários para Entrevistas'],
      ['4', 'Detalhes da Vaga'],
      ['5', 'Salário e Benefícios'],
      ['6', 'Treinamentos'],
      ['7', 'Publicação'],
    ]}
          etapaAtual=${etapaAtual}
        />

        <${WizardSummaryStrip}
          items=${[
      ['Vaga', formulario.vaga || '-'],
      ['Quantidade', `${String(formulario.quantidade || 0).padStart(2, '0')} vaga(s)`],
      ['Encerramento', formatarDataResumoProcesso(formulario.dataEncerramento)],
      ['Cliente', formulario.operacao || '-'],
      ['Prova', blueprint?.label || '-'],
      ['Questões', questoesConfiguradas.length || '-'],
    ]}
          note="A prova configurada aqui fica vinculada ao processo seletivo."
        />

        <div class="process-create-main">
            ${etapaAtual === 1
      ? html`
                  <section class="process-create-card" tour-id="process-create-form">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('work')}</span>
                      <h2>Informações da Vaga</h2>
                    </div>
                    <div class="process-create-form-grid">
                      <label class="process-create-field is-wide">
                        <span>Vaga do processo</span>
                        <select value=${formulario.vaga} onChange=${(event) => atualizarCampo('vaga', event.target.value)}>
                          <option value="">Selecione...</option>
                          ${OPCOES_VAGAS_PROCESSO.map(
        (opcao) => html`<option key=${opcao.label} value=${opcao.label}>${opcao.label}</option>`,
      )}
                        </select>
                      </label>
                      <label class="process-create-field">
                        <span>Quantidade de vagas</span>
                        <input type="number" min="1" value=${formulario.quantidade} onInput=${(event) => atualizarCampo('quantidade', event.target.value)} />
                      </label>
                      <label class="process-create-field">
                        <span>Data de encerramento</span>
                        <input type="date" value=${formulario.dataEncerramento} onInput=${(event) => atualizarCampo('dataEncerramento', event.target.value)} />
                      </label>
                      <label class="process-create-field">
                        <span>Operação / Cliente</span>
                        <select value=${formulario.operacao} onChange=${(event) => atualizarCampo('operacao', event.target.value)}>
                          <option value="">Selecione...</option>
                          ${opcoesOperacaoDisponiveis.map(
        (operacao) => html`<option key=${operacao} value=${operacao}>${operacao}</option>`,
      )}
                        </select>
                      </label>
                      <label class="process-create-field">
                        <span>Área / Trilha</span>
                        <select disabled=${!!regras.trilhaFixa} value=${trilhaEfetiva} onChange=${(event) => atualizarCampo('trilha', event.target.value)}>
                          <option value="">Selecione...</option>
                          ${OPCOES_TRILHAS_PROCESSO.map(
        (opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`,
      )}
                        </select>
                      </label>
                    </div>
                  </section>
                  <section class="process-create-card c24-fade-in">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('bolt')}</span>
                      <h2>Botão Vaga Urgente</h2>
                    </div>
                    <div class="process-cutoff-panel">
                      <label class="process-switch-row" title="Em breve">
                        <input type="checkbox" checked=${formulario.urgente} disabled onChange=${(event) => atualizarCampo('urgente', event.target.checked)} />
                        <span class="process-switch-visual"></span>
                        <span>
                          <strong>Vaga Urgente</strong>
                          <small>Em breve. Use apenas para emergências reais quando disponível — existe um limite de vagas urgentes abertas ao mesmo tempo.</small>
                        </span>
                      </label>
                    </div>
                  </section>
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('rule')}</span>
                      <h2>Critérios de Avaliação</h2>
                    </div>
                    <div class="process-cutoff-panel">
                      <label class="process-switch-row">
                        <input type="checkbox" checked=${formulario.usaNotaCorte} onChange=${(event) => atualizarCampo('usaNotaCorte', event.target.checked)} />
                        <span class="process-switch-visual"></span>
                        <span>
                          <strong>Ativar nota de corte</strong>
                          <small>Candidatos abaixo da nota serão desclassificados automaticamente.</small>
                        </span>
                      </label>
                      <label class="process-create-field process-cutoff-score">
                        <span>Nota mínima</span>
                        <input type="number" min="4" max="10" step="0.1" disabled=${!formulario.usaNotaCorte} value=${formulario.notaCorte} onInput=${(event) => atualizarCampo('notaCorte', event.target.value)} />
                      </label>
                    </div>
                  </section>
                `
      : null}

            ${etapaAtual === 2
      ? html`
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('settings_applications')}</span>
                      <h2>Dados da Prova</h2>
                    </div>
                    <div class="process-create-form-grid">
                      <label class="process-create-field">
                        <span>Área / Trilha</span>
                        <select disabled value=${formulario.areaProva}>
                          <option value="">Selecione...</option>
                          ${opcoesAreasProva.map(
        (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
      )}
                        </select>
                      </label>
                      <label class="process-create-field">
                        <span>Nível da prova</span>
                        <select value=${formulario.nivelProva} onChange=${(event) => atualizarCampo('nivelProva', event.target.value)}>
                          <option value="">Selecione...</option>
                          ${opcoesNiveisProva.map(
        (opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`,
      )}
                        </select>
                      </label>
                      <label class="process-create-field">
                        <span>Tempo total</span>
                        <input type="number" min="1" max="300" value=${formulario.tempoTotal} onInput=${(event) => atualizarCampo('tempoTotal', event.target.value)} />
                      </label>
                      <label class="process-create-field">
                        <span>Tipo de prova</span>
                        <select value=${formulario.tipoProva} onChange=${(event) => atualizarCampo('tipoProva', event.target.value)}>
                          <option>Processo seletivo</option>
                          <option>Triagem técnica</option>
                          <option>Avaliação operacional</option>
                        </select>
                      </label>
                      <label class="process-create-field">
                        <span>Nível de dificuldade da prova</span>
                        <input type="range" min="1" max="5" step="1" value=${formulario.nivelDificuldade} onInput=${(event) => atualizarCampo('nivelDificuldade', Number(event.target.value))} />
                        <small class="text-muted">${{ 1: 'Fácil', 2: 'Fácil', 3: 'Média', 4: 'Difícil', 5: 'Difícil' }[formulario.nivelDificuldade] || 'Média'}</small>
                      </label>
                    </div>
                    <div class="process-blueprint-preview">
                      <span class="material-symbols-outlined">${IconeSvg('fact_check')}</span>
                      <div>
                        <strong>${blueprint?.label || 'Blueprint não selecionado'}</strong>
                        <small>${questoesConfiguradas.length ? `${questoesConfiguradas.length} questões em ${etapasConfiguradasProva.length} etapa(s)` : 'Escolha vaga, trilha, nível e etapas para montar a prova.'}</small>
                      </div>
                    </div>
                  </section>

                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('palette')}</span>
                      <h2>Personalização</h2>
                    </div>
                    <label class="process-personalization-toggle">
                      <input type="checkbox" checked=${formulario.personalizacaoInteligente} onChange=${(event) => atualizarCampo('personalizacaoInteligente', event.target.checked)} />
                      <span>
                        <strong>Personalizar prova por atendimento</strong>
                        <small>Opcional. Cliente/Operação será usado automaticamente a partir da vaga cadastrada.</small>
                      </span>
                    </label>
                    ${formulario.personalizacaoInteligente
          ? html`
                          <div class="process-create-form-grid mt-3">
                            ${permiteTipoAtendimento
              ? html`
                                <label class="process-create-field is-wide">
                                  <span>Tipo de atendimento</span>
                                  <select multiple value=${formulario.tiposAtendimento} onChange=${(event) => atualizarCampo('tiposAtendimento', lerValoresMultiselectProcesso(event))}>
                                    ${[...TIPOS_ATENDIMENTO_PERSONALIZACAO, OPCAO_OUTRO_PROCESSO].map(
                (opcao) => html`<option key=${opcao} value=${opcao} selected=${formulario.tiposAtendimento.includes(opcao)}>${opcao}</option>`,
              )}
                                  </select>
                                </label>
                                ${formulario.tiposAtendimento.includes(OPCAO_OUTRO_PROCESSO)
                  ? html`
                                      <label class="process-create-field">
                                        <span>Outro tipo de atendimento</span>
                                        <input value=${formulario.tipoAtendimentoOutro} onInput=${(event) => atualizarCampo('tipoAtendimentoOutro', event.target.value)} />
                                      </label>
                                    `
                  : null}
                              `
              : null}
                            <label class="process-create-field">
                              <span>Nível de personalização</span>
                              <select value=${formulario.nivelPersonalizacao} onChange=${(event) => atualizarCampo('nivelPersonalizacao', event.target.value)}>
                                ${NIVEIS_PERSONALIZACAO.map(
                (nivel) => html`<option key=${nivel.id} value=${nivel.id}>${nivel.label}: ${nivel.descricao}</option>`,
              )}
                              </select>
                            </label>
                            <label class="process-create-field">
                              <span>Tom da prova</span>
                              <select value=${formulario.tomProva} onChange=${(event) => atualizarCampo('tomProva', event.target.value)}>
                                ${OPCOES_TOM_PROVA_PROCESSO.map(
                (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
              )}
                              </select>
                            </label>
                            <div class="process-create-field is-wide process-stage-selector">
                              <span>Etapas da prova</span>
                              <div class="process-stage-checklist">
                                ${etapasDisponiveisPersonalizacao.map(
                (etapaOpcao) => html`
                                  <label class="process-stage-check" key=${etapaOpcao.key}>
                                    <input
                                      type="checkbox"
                                      checked=${formulario.etapasPersonalizadas.includes(etapaOpcao.key)}
                                      onChange=${(event) => alternarEtapaPersonalizada(etapaOpcao.key, event.target.checked)}
                                    />
                                    <span>${etapaOpcao.label}</span>
                                  </label>
                                `,
              )}
                              </div>
                            </div>
                            <label class="process-personalization-toggle process-stage-default-level">
                              <input
                                type="checkbox"
                                checked=${formulario.manterNivelPadraoEtapas}
                                onChange=${(event) => atualizarCampo('manterNivelPadraoEtapas', event.target.checked)}
                              />
                              <span>
                                <strong>Manter nível padrão</strong>
                                <small>Usa o nível definido para a vaga em todas as etapas selecionadas.</small>
                              </span>
                            </label>
                            ${!formulario.manterNivelPadraoEtapas
              ? html`
                                <div class="process-create-field is-wide process-stage-levels">
                                  <span>Nível por etapa</span>
                                  <div class="process-stage-level-grid">
                                    ${ETAPAS_PERSONALIZADAS_PROCESSO
                  .filter((etapaOpcao) => etapasSelecionadasPersonalizacao.includes(etapaOpcao.key))
                  .map(
                    (etapaOpcao) => html`
                                        <label class="process-create-field" key=${`nivel-${etapaOpcao.key}`}>
                                          <span>${etapaOpcao.label}</span>
                                          <select value=${formulario.niveisEtapas?.[etapaOpcao.key] || ''} onChange=${(event) => atualizarNivelEtapaPersonalizada(etapaOpcao.key, event.target.value)}>
                                            <option value="">Selecione...</option>
                                            ${opcoesNiveisProva.map(
                      (opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`,
                    )}
                                          </select>
                                        </label>
                                      `,
                  )}
                                  </div>
                                </div>
                              `
              : null}
                          </div>
                        `
          : null}
                  </section>

                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('quiz')}</span>
                      <h2>Testes complementares</h2>
                    </div>
                    <p class="text-muted" style=${{ marginBottom: '12px' }}>
                      Testes independentes do Conecta Provas. Quando ativados, ficam disponíveis para os candidatos
                      deste processo assim que a prova for liberada.
                    </p>
                    <div class="row g-3">
                      ${[
          { chave: 'disc', label: 'Teste DISC', descricao: 'Perfil comportamental D-I-S-C.' },
          { chave: 'fitCultural', label: 'Fit Cultural', descricao: 'Aderência aos valores da empresa.' },
          { chave: 'raciocinioLogico', label: 'Raciocínio Lógico e Numérico', descricao: 'Teste de raciocínio lógico e numérico.' },
        ].map(
          (teste) => html`
                          <div class="col-md-4" key=${teste.chave}>
                            <div class="form-check form-switch pt-2">
                              <input
                                class="form-check-input"
                                id=${`teste-complementar-${teste.chave}`}
                                type="checkbox"
                                checked=${Boolean(formulario.testesComplementares?.[teste.chave])}
                                onChange=${(event) => setFormulario({
            ...formulario,
            testesComplementares: {
              ...formulario.testesComplementares,
              [teste.chave]: event.target.checked,
            },
          })}
                              />
                              <label class="form-check-label" for=${`teste-complementar-${teste.chave}`}>
                                <strong>${teste.label}</strong>
                                <small class="d-block text-muted">${teste.descricao}</small>
                              </label>
                            </div>
                          </div>
                        `,
        )}
                    </div>
                  </section>
                `
      : null}

            ${etapaAtual === 3
      ? html`
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('event_available')}</span>
                      <h2>Disponibilidade de Horários para Entrevistas</h2>
                    </div>
                    <p class="process-create-hint">
                      Defina dia(s) e faixa de horário para gerar os slots de entrevista deste processo.
                      Se ainda não souber os horários, marque "somente o dia" — o RH combina o horário
                      depois. Esta etapa é opcional; você também pode configurar horários mais tarde em
                      Processos > Entrevistas.
                    </p>
                    <div class="process-availability-list">
                      ${formulario.disponibilidade.map(
        (item) => html`
                          <div class="process-availability-item" key=${item.id}>
                            <div class="process-create-form-grid">
                              <label class="process-create-field">
                                <span>Dia</span>
                                <input
                                  type="date"
                                  value=${item.data}
                                  onInput=${(event) => atualizarDisponibilidade(item.id, 'data', event.target.value)}
                                />
                              </label>
                              <label class="process-create-field">
                                <span>Vagas por horário</span>
                                <input
                                  type="number"
                                  min="1"
                                  value=${item.capacidadeTotal}
                                  onInput=${(event) => atualizarDisponibilidade(item.id, 'capacidadeTotal', event.target.value)}
                                />
                              </label>
                            </div>
                            <label class="process-switch-row">
                              <input
                                type="checkbox"
                                checked=${item.somenteDia}
                                onChange=${(event) => atualizarDisponibilidade(item.id, 'somenteDia', event.target.checked)}
                              />
                              <span class="process-switch-visual"></span>
                              <span>
                                <strong>Somente o dia (sem horário definido)</strong>
                                <small>Use quando ainda não souber a faixa de horário exata.</small>
                              </span>
                            </label>
                            ${!item.somenteDia
            ? html`
                                  <div class="process-create-form-grid">
                                    <label class="process-create-field">
                                      <span>Início</span>
                                      <input
                                        type="time"
                                        value=${item.horaInicio}
                                        onInput=${(event) => atualizarDisponibilidade(item.id, 'horaInicio', event.target.value)}
                                      />
                                    </label>
                                    <label class="process-create-field">
                                      <span>Fim</span>
                                      <input
                                        type="time"
                                        value=${item.horaFim}
                                        onInput=${(event) => atualizarDisponibilidade(item.id, 'horaFim', event.target.value)}
                                      />
                                    </label>
                                    <label class="process-create-field">
                                      <span>Duração de cada slot (min)</span>
                                      <input
                                        type="number"
                                        min="5"
                                        max="240"
                                        value=${item.duracaoMinutos}
                                        onInput=${(event) => atualizarDisponibilidade(item.id, 'duracaoMinutos', event.target.value)}
                                      />
                                    </label>
                                  </div>
                                `
            : null}
                            <button
                              type="button"
                              class="btn btn-outline-secondary btn-sm"
                              onClick=${() => removerDisponibilidade(item.id)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                              Remover
                            </button>
                          </div>
                        `,
      )}
                    </div>
                    <button type="button" class="btn btn-outline-primary btn-sm" onClick=${adicionarDisponibilidade}>
                      <span class="material-symbols-outlined">${IconeSvg('add')}</span>
                      Adicionar disponibilidade
                    </button>
                  </section>
                `
      : null}

            ${etapaAtual === 4
      ? html`
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('badge')}</span>
                      <h2>Detalhes da vaga</h2>
                    </div>
                    <div class="process-create-form-grid">
                      <label>
                        <span>Tipo de contratação</span>
                        <select class="form-select" value=${formulario.tipoContratacao} onChange=${(event) => setFormulario({ ...formulario, tipoContratacao: event.target.value })}>
                          <option value="">Selecione</option>
                          ${TIPOS_CONTRATACAO_PROCESSO.map((item) => html`<option key=${item} value=${item}>${item}</option>`)}
                        </select>
                      </label>
                      ${formulario.tipoContratacao === 'Outro'
          ? html`
                            <label>
                              <span>Qual tipo de contratação?</span>
                              <input class="form-control" value=${formulario.tipoContratacaoOutro} onInput=${(event) => setFormulario({ ...formulario, tipoContratacaoOutro: event.target.value })} />
                            </label>
                          `
          : null}
                      <label>
                        <span>Perfil e modelo de trabalho</span>
                        <select class="form-select" value=${formulario.modeloTrabalho} onChange=${(event) => setFormulario({ ...formulario, modeloTrabalho: event.target.value })}>
                          <option value="">Selecione</option>
                          ${MODELOS_TRABALHO_PROCESSO.map((item) => html`<option key=${item.value} value=${item.value}>${item.label}</option>`)}
                        </select>
                      </label>
                      ${formulario.modeloTrabalho === 'hibrido'
          ? html`
                            <label>
                              <span>Escala do híbrido</span>
                              <input class="form-control" placeholder="Ex.: 3 dias presenciais na Unidade Barra Olímpica / 3 dias Home Office" value=${formulario.hibridoEscala} onInput=${(event) => setFormulario({ ...formulario, hibridoEscala: event.target.value })} />
                            </label>
                          `
          : null}
                      <label>
                        <span>Jornada de trabalho</span>
                        <select class="form-select" value=${formulario.jornadaTrabalho} onChange=${(event) => {
          const valor = event.target.value;
          setFormulario({ ...formulario, jornadaTrabalho: valor });
          if (valor === 'outro') setModalJornadaOutroAberto(true);
        }}>
                          <option value="">Selecione</option>
                          ${JORNADAS_TRABALHO_PROCESSO.map((item) => html`<option key=${item.value} value=${item.value}>${item.label}</option>`)}
                        </select>
                      </label>
                      ${formulario.jornadaTrabalho === 'outro'
          ? html`
                            <label>
                              <span>Jornada personalizada</span>
                              <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setModalJornadaOutroAberto(true)}>
                                ${formulario.jornadaOutroDetalhe.dias.length
              ? `${formulario.jornadaOutroDetalhe.dias.join(', ')} · ${formulario.jornadaOutroDetalhe.horaInicio || '--:--'} às ${formulario.jornadaOutroDetalhe.horaFim || '--:--'}`
              : 'Configurar jornada'}
                              </button>
                            </label>
                          `
          : null}
                      <label>
                        <span>Trabalho com escala</span>
                        <select class="form-select" value=${formulario.trabalhoEscala} onChange=${(event) => setFormulario({ ...formulario, trabalhoEscala: event.target.value })}>
                          <option value="">Selecione</option>
                          <option value="sim">Sim</option>
                          <option value="nao">Não</option>
                        </select>
                      </label>
                    </div>

                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('checklist')}</span>
                      <h2>Requisitos do candidato</h2>
                    </div>
                    <div class="process-create-form-grid">
                      <label>
                        <span>Escolaridade mínima</span>
                        <select class="form-select" value=${formulario.escolaridadeMinima} onChange=${(event) => setFormulario({ ...formulario, escolaridadeMinima: event.target.value })}>
                          <option value="">Selecione</option>
                          ${ESCOLARIDADES_PROCESSO.map((item) => html`<option key=${item.value} value=${item.value}>${item.label}</option>`)}
                        </select>
                      </label>
                      ${formulario.escolaridadeMinima === 'superior'
          ? html`
                            <label>
                              <span>Quais cursos?</span>
                              <input class="form-control" placeholder="Separados por vírgula" value=${formulario.cursosSuperior} onInput=${(event) => setFormulario({ ...formulario, cursosSuperior: event.target.value })} />
                            </label>
                          `
          : null}
                      <label class="process-create-field is-wide">
                        <span>Experiência prévia exigida</span>
                        <select class="form-select" value=${formulario.experienciaPrevia} onChange=${(event) => setFormulario({ ...formulario, experienciaPrevia: event.target.value })}>
                          <option value="">Selecione</option>
                          ${EXPERIENCIAS_PREVIAS_PROCESSO.map((item) => html`<option key=${item.value} value=${item.value}>${item.label}</option>`)}
                        </select>
                      </label>
                      ${formulario.experienciaPrevia === 'especificas'
          ? html`
                            <div class="process-create-field is-wide">
                              <span>Quais experiências específicas?</span>
                              <div class="d-flex gap-2 mt-2">
                                <input
                                  class="form-control"
                                  value=${novaExperienciaEspecifica}
                                  onInput=${(event) => setNovaExperienciaEspecifica(event.target.value)}
                                  onKeyDown=${(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                adicionarExperienciaEspecifica();
              }
            }}
                                />
                                <button type="button" class="btn btn-outline-secondary" onClick=${adicionarExperienciaEspecifica}>Adicionar</button>
                              </div>
                              <div class="rh-chip-wrap mt-2">
                                ${formulario.experienciasEspecificas.map(
              (item) => html`
                                      <span key=${item} class="rh-chip">
                                        ${item}
                                        <button type="button" class="btn-close btn-close-white ms-1" style=${{ width: '0.5em', height: '0.5em' }} onClick=${() => removerExperienciaEspecifica(item)} aria-label="Remover"></button>
                                      </span>
                                    `,
            )}
                                ${!formulario.experienciasEspecificas.length
              ? html`<span class="text-muted small">Nenhuma experiência adicionada ainda.</span>`
              : null}
                              </div>
                            </div>
                          `
          : null}
                      <label class="process-create-field is-wide">
                        <span>Idioma</span>
                        <select class="form-select" value=${formulario.idioma} onChange=${(event) => setFormulario({ ...formulario, idioma: event.target.value })}>
                          <option value="">Não exigido</option>
                          <option value="Inglês">Inglês</option>
                          <option value="Espanhol">Espanhol</option>
                        </select>
                      </label>
                      <label class="process-create-field is-wide">
                        <span>Habilidades técnicas obrigatórias</span>
                        <input class="form-control" placeholder="Separadas por vírgula — viram tags na vaga" value=${formulario.skillsTags} onInput=${(event) => setFormulario({ ...formulario, skillsTags: event.target.value })} />
                      </label>
                    </div>

                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('description')}</span>
                      <h2>Descrição das atividades</h2>
                    </div>
                    <label class="is-wide">
                      <span>Texto exibido na vaga</span>
                      <textarea
                        class="form-control"
                        rows="4"
                        placeholder="Como funciona a operação no dia a dia — nunca mencione o cliente diretamente"
                        value=${formulario.descricaoAtividades}
                        onInput=${(event) => setFormulario({ ...formulario, descricaoAtividades: event.target.value, descricaoAtividadesEditada: true })}
                      ></textarea>
                      <small class="text-muted">Pré-preenchido a partir da operação selecionada. Pode ajustar ou apagar livremente.</small>
                    </label>
                  </section>

                  <${ModalPadrao}
                    aberto=${modalJornadaOutroAberto}
                    titulo="Jornada de trabalho personalizada"
                    onClose=${() => setModalJornadaOutroAberto(false)}
                  >
                    <div class="d-flex flex-column gap-3">
                      <div>
                        <span style=${{ fontWeight: 600 }}>Dias da semana</span>
                        <div class="d-flex flex-wrap gap-2 mt-2">
                          ${DIAS_SEMANA_JORNADA_PROCESSO.map(
            (dia) => html`
                                <label key=${dia} class="settings-toggle-line">
                                  <input type="checkbox" checked=${formulario.jornadaOutroDetalhe.dias.includes(dia)} onChange=${() => alternarDiaJornadaOutro(dia)} />
                                  <span>${dia}</span>
                                </label>
                              `,
          )}
                        </div>
                      </div>
                      <div class="process-create-form-grid">
                        <label class="process-create-field">
                          <span>Horário de entrada</span>
                          <input type="time" value=${formulario.jornadaOutroDetalhe.horaInicio} onInput=${(event) => atualizarHorarioJornadaOutro('horaInicio', event.target.value)} />
                        </label>
                        <label class="process-create-field">
                          <span>Horário de saída</span>
                          <input type="time" value=${formulario.jornadaOutroDetalhe.horaFim} onInput=${(event) => atualizarHorarioJornadaOutro('horaFim', event.target.value)} />
                        </label>
                      </div>
                    </div>
                    <footer class="rh-modal-footer">
                      <button type="button" class="btn btn-primary" onClick=${() => setModalJornadaOutroAberto(false)}>Salvar</button>
                    </footer>
                  </${ModalPadrao}>
                `
      : null}

            ${etapaAtual === 5
      ? html`
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('payments')}</span>
                      <h2>Salário e Benefícios</h2>
                    </div>
                    <div class="process-create-form-grid">
                      <label class="process-create-field settings-toggle-line">
                        <input type="checkbox" checked=${formulario.mostrarSalario} onChange=${(event) => setFormulario({ ...formulario, mostrarSalario: event.target.checked })} />
                        <span>Informar o salário na descrição da vaga</span>
                      </label>
                      ${formulario.mostrarSalario
          ? html`
                            <label class="process-create-field">
                              <span>Salário</span>
                              <input type="number" min="0" step="0.01" value=${formulario.salario} onInput=${(event) => setFormulario({ ...formulario, salario: event.target.value })} />
                            </label>
                          `
          : null}
                      <div class="process-create-field is-wide">
                        <span>Benefícios</span>
                        <div class="d-flex flex-wrap gap-3 mt-2">
                          ${formulario.beneficios.map(
            (beneficio) => html`
                                <div key=${beneficio.nome} class="d-flex align-items-center gap-2">
                                  <label class="settings-toggle-line" style=${{ minWidth: '0' }}>
                                    <input type="checkbox" checked=${beneficio.selecionado} onChange=${() => alternarBeneficioProcesso(beneficio.nome)} />
                                    <span>${beneficio.nome}</span>
                                  </label>
                                  ${beneficio.selecionado
                ? html`
                                        <input
                                          class="form-control form-control-sm"
                                          style=${{ maxWidth: '140px' }}
                                          placeholder="Valor (opcional)"
                                          value=${beneficio.valor}
                                          onInput=${(event) => atualizarValorBeneficioProcesso(beneficio.nome, event.target.value)}
                                        />
                                      `
                : null}
                                </div>
                              `,
          )}
                        </div>
                      </div>
                    </div>
                  </section>
                `
      : null}

            ${etapaAtual === 6
      ? html`
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('school')}</span>
                      <h2>Treinamentos da trilha de aprovação</h2>
                    </div>
                    <p class="text-muted small mb-2">
                      Selecionados por padrão os treinamentos de onboarding. Ao aprovar candidatos, eles entram na Central de Treinamentos com a tag "Aguardando processo" até o RH/Gestor liberar.
                    </p>
                    <button type="button" class="btn btn-outline-secondary btn-sm mb-2" onClick=${() => setModalTreinamentosAberto(true)}>
                      <span class="material-symbols-outlined">${IconeSvg('link')}</span>
                      Atrelar treinamentos
                    </button>
                    <div class="rh-chip-wrap">
                      ${trilhasDisponiveis
          .filter((trilha) => formulario.treinamentosSelecionados.includes(trilha.id_trilha))
          .map((trilha) => html`<span key=${trilha.id_trilha} class="rh-chip">${trilha.nome}</span>`)}
                      ${!formulario.treinamentosSelecionados.length
          ? html`<span class="text-muted small">Nenhum treinamento atrelado ainda.</span>`
          : null}
                    </div>
                  </section>

                  <${ModalPadrao}
                    aberto=${modalTreinamentosAberto}
                    titulo="Atrelar treinamentos"
                    onClose=${() => setModalTreinamentosAberto(false)}
                  >
                    ${trilhasDisponiveis.length
          ? html`
                          <select multiple class="form-select" style=${{ minHeight: '220px' }}
                            value=${formulario.treinamentosSelecionados}
                            onChange=${(event) => {
              const selecionados = Array.from(event.target.selectedOptions || []).map((opcao) => Number(opcao.value));
              setFormulario({ ...formulario, treinamentosSelecionados: selecionados });
            }}>
                            ${trilhasDisponiveis.map((trilha) => html`<option key=${trilha.id_trilha} value=${trilha.id_trilha}>${trilha.nome}</option>`)}
                          </select>
                        `
          : html`<p class="text-muted small mb-0">Nenhuma trilha de treinamento cadastrada ainda.</p>`}
                    <footer class="rh-modal-footer">
                      <button type="button" class="btn btn-primary" onClick=${() => setModalTreinamentosAberto(false)}>Concluído</button>
                    </footer>
                  </${ModalPadrao}>
                `
      : null}

            ${etapaAtual === 7
      ? html`
                  <section class="process-create-card">
                    <div class="process-create-section-title">
                      <span class="material-symbols-outlined">${IconeSvg('publish')}</span>
                      <h2>Publicação / Finalização</h2>
                    </div>
                    <div class="process-final-review">
                      ${[
          ['Vaga', formulario.vaga || '-'],
          ['Quantidade', `${formulario.quantidade || 0} vaga(s)`],
          ['Encerramento', formatarDataResumoProcesso(formulario.dataEncerramento)],
          ['Operação', formulario.operacao || '-'],
          ['Área / Trilha', trilhaEfetiva || '-'],
          ['Botão Vaga Urgente', formulario.urgente ? 'Urgente' : 'Não urgente'],
          ['Nota de corte', formulario.usaNotaCorte ? formulario.notaCorte || '-' : 'Não ativada'],
          ['Prova', blueprint?.label || '-'],
          ['Tempo', `${formulario.tempoTotal || 0} min`],
          ['Personalização', formulario.personalizacaoInteligente ? 'Ativada' : 'Não ativada'],
          ['Etapas', formulario.personalizacaoInteligente ? etapasConfiguradasProva.map((item) => item.label).join(', ') || '-' : 'Todas'],
        ].map(
          ([label, value]) => html`
                          <span key=${label}>
                            <strong>${label}</strong>
                            ${value}
                          </span>
                        `,
        )}
                    </div>
                    <div class="process-blueprint-preview is-ready">
                      <span class="material-symbols-outlined">${IconeSvg('check_circle')}</span>
                      <div>
                        <strong>Prova configurada para o processo</strong>
                        <small>Ao publicar, esta configuração fica disponível para liberar prova aos candidatos deste processo.</small>
                      </div>
                    </div>
                  </section>
                `
      : null}
        </div>

        ${erro ? html`<div class="alert alert-danger mt-3">${erro}</div>` : null}

        <footer class="process-create-actions">
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled=${salvando}
            onClick=${() =>
      etapaAtual > 1
        ? setEtapaAtual((etapa) => etapa - 1)
        : controlador.irParaTelaProtegida('screen-processes')}
          >
            <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>
            Voltar
          </button>
          <div>
            <button
              type="button"
              class="btn btn-outline-secondary"
              disabled=${salvando}
              onClick=${() => controlador.irParaTelaProtegida('screen-processes')}
            >
              Cancelar
            </button>
            ${etapaAtual === 7
      ? html`
                  <button type="button" class="btn btn-outline-primary" disabled=${salvando} onClick=${() => setModalCompartilharAberto(true)}>
                    <span class="material-symbols-outlined">${IconeSvg('share')}</span>
                    Compartilhar vaga
                  </button>
                `
      : null}
          </div>
        </footer>
      </div>
      <${ModalCompartilharVaga}
        aberto=${modalCompartilharAberto}
        processo=${processoCompartilhamento}
        texto=${textoCompartilhamentoVaga}
        requisitos=${requisitosCompartilhamento}
        responsabilidades=${responsabilidadesCompartilhamento}
        onClose=${() => setModalCompartilharAberto(false)}
      />

      <${ModalPadrao}
        aberto=${modalTalentosAberto}
        titulo="Candidatos do Banco de Talentos compatíveis"
        subtitulo=${`Sugestões para a vaga "${formulario.vaga}", com base em palavras-chave em comum.`}
        onClose=${fecharModalTalentosENavegar}
        className="rh-talent-matches-dialog"
      >
        <div class="rh-details-body">
          ${carregandoSugestoesTalentos
      ? html`<p class="text-muted mb-0">Buscando candidatos compatíveis...</p>`
      : sugestoesTalentos.length
        ? html`
                <ul class="rh-talent-matches-list">
                  ${sugestoesTalentos.map(
          (candidato) => html`
                      <li key=${candidato.id_banco} class="rh-talent-matches-item">
                        <div class="rh-talent-matches-info">
                          <strong>${candidato.nome_candidato}</strong>
                          <span class="rh-talent-matches-pct">${candidato.percentual_compatibilidade}% compatível</span>
                          <small class="text-muted">${candidato.motivo}</small>
                        </div>
                        <button
                          type="button"
                          class="btn btn-outline-primary btn-sm"
                          disabled=${usandoTalentoId === candidato.id_banco}
                          onClick=${() => adicionarTalentoAoProcesso(candidato)}
                        >
                          ${usandoTalentoId === candidato.id_banco ? 'Adicionando...' : 'Adicionar ao processo'}
                        </button>
                      </li>
                    `,
        )}
                </ul>
              `
        : html`<p class="text-muted mb-0">Nenhum candidato compatível encontrado no Banco de Talentos para esta vaga.</p>`}
        </div>
        <footer class="rh-modal-footer">
          <button type="button" class="btn btn-primary" onClick=${fecharModalTalentosENavegar}>
            Ir para o processo
          </button>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

export function TelaBancoTalentos({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [processosAbertos, setProcessosAbertos] = useState([]);
  const [candidatoParaUtilizar, setCandidatoParaUtilizar] = useState(null);
  const [processoSelecionadoUso, setProcessoSelecionadoUso] = useState('');
  const [perfilEdicao, setPerfilEdicao] = useState(null);
  const [formularioPerfil, setFormularioPerfil] = useState({
    tags: '',
    habilidades: '',
    observacao_rh: '',
  });
  const [filtros, setFiltros] = useState({
    busca: '',
    habilidade: '',
    tag: '',
  });
  const [filtrosBancoAbertos, setFiltrosBancoAbertos] = useState(false);

  const carregar = async ({ forcar = false } = {}) => {
    setCarregando(true);
    setErro('');

    try {
      const [banco, processos] = await Promise.all([
        lerBancoTalentos({
          forcar,
          search: filtros.busca,
          skill: filtros.habilidade,
          tag: filtros.tag,
        }),
        lerProcessos({ forcar }),
      ]);

      setLinhas(Array.isArray(banco) ? banco : []);
      setProcessosAbertos(
        (Array.isArray(processos) ? processos : []).filter(
          (processo) => !isProcessClosed(processo),
        ),
      );
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível carregar o banco de talentos.',
      );
      setLinhas([]);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [filtros.busca, filtros.habilidade, filtros.tag]);

  const abrirCurriculo = async (candidato) => {
    if (!candidato?.id_teste || !candidato?.cv_disponivel) {
      showToast('Não há currículo disponível para este candidato.', 'warning');
      return;
    }

    try {
      const arquivo = await baixarCvCandidato(candidato.id_teste);
      const tipo = String(arquivo?.contentType || '').toLowerCase();
      if (tipo.includes('pdf')) {
        abrirBlobEmNovaGuia(arquivo.blob);
        return;
      }

      baixarBlob(arquivo.filename || 'curriculo', arquivo.blob);
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível abrir o currículo do candidato.',
      );
    }
  };

  const remover = async (idBanco) => {
    if (!window.confirm('Deseja eliminar este candidato do banco de talentos?')) {
      return;
    }

    setSalvando(true);
    setErro('');
    try {
      await removerBancoTalentos(idBanco);
      await carregar({ forcar: true });
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível remover o candidato do banco.',
      );
    } finally {
      setSalvando(false);
    }
  };

  const revalidar = async (idBanco) => {
    if (!window.confirm('Reiniciar a contagem de permanência deste candidato no banco de talentos por mais 180 dias?')) {
      return;
    }

    setSalvando(true);
    setErro('');
    try {
      await revalidarBancoTalentos(idBanco);
      await carregar({ forcar: true });
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível revalidar o candidato no banco.',
      );
    } finally {
      setSalvando(false);
    }
  };

  const abrirEdicaoPerfil = (candidato) => {
    setPerfilEdicao(candidato);
    setFormularioPerfil({
      tags: Array.isArray(candidato.tags) ? candidato.tags.join(', ') : '',
      habilidades: Array.isArray(candidato.habilidades)
        ? candidato.habilidades.join(', ')
        : '',
      observacao_rh: candidato.observacao_rh || '',
    });
  };

  const salvarPerfil = async () => {
    if (!perfilEdicao) return;

    const mensagemErro = validarPerfilCandidato(formularioPerfil);
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }

    setSalvando(true);
    setErro('');

    try {
      await atualizarPerfilCandidato(perfilEdicao.id_teste, {
        nome_candidato: perfilEdicao.nome_candidato,
        tags: quebrarListaTexto(formularioPerfil.tags),
        habilidades: quebrarListaTexto(formularioPerfil.habilidades),
        observacao_rh: formularioPerfil.observacao_rh,
      });
      setPerfilEdicao(null);
      await carregar({ forcar: true });
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o perfil RH.');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarUso = async () => {
    if (!candidatoParaUtilizar || !processoSelecionadoUso) {
      showToast('Selecione um processo antes de continuar.', 'warning');
      return;
    }

    const confirmar = window.confirm(
      `Deseja realmente utilizar o candidato ${candidatoParaUtilizar?.nome_candidato || ''} no processo ${processoSelecionadoUso}?`,
    );
    if (!confirmar) return;

    setSalvando(true);
    setErro('');

    try {
      const processoSelecionado = processosAbertos.find(
        (processo) => obterReferenciaProcesso(processo) === processoSelecionadoUso,
      );
      await usarCandidatoDoBancoTalentos(candidatoParaUtilizar.id_banco, {
        id_processo: processoSelecionado?.id_processo || '',
        id_processo_ref: processoSelecionadoUso,
      });

      setCandidatoParaUtilizar(null);
      setProcessoSelecionadoUso('');
      await carregar({ forcar: true });
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível reutilizar o candidato selecionado.',
      );
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-talent-bank"
      navAtiva="screen-talent-bank"
      subtituloMarca="Banco de talentos"
      placeholderBusca="Reaproveitamento de candidatos"
      controlador=${controlador}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="Console • Banco de talentos"
        title="Banco de talentos"
        description=""
      />

      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}

      <${SectionCard} className="process-filter-panel" tourId="talent-filters">
        <div class="rh-filter-bar">
          <div class="rh-filter-bar-search">
            <span class="material-symbols-outlined">${IconeSvg('search')}</span>
            <input
              type="search"
              placeholder="Nome, vaga ou processo..."
              value=${filtros.busca}
              onInput=${(event) => setFiltros({ ...filtros, busca: event.target.value })}
            />
          </div>

          <button
            type="button"
            class="rh-filter-toggle"
            aria-expanded=${filtrosBancoAbertos}
            onClick=${() => setFiltrosBancoAbertos(!filtrosBancoAbertos)}
          >
            <span class="material-symbols-outlined">${IconeSvg('tune')}</span>
            Filtros
            ${(filtros.habilidade ? 1 : 0) + (filtros.tag ? 1 : 0) > 0
      ? html`<span class="rh-filter-count">${(filtros.habilidade ? 1 : 0) + (filtros.tag ? 1 : 0)}</span>`
      : null}
          </button>

          ${filtros.habilidade
      ? html`
              <span class="rh-filter-chip">
                Habilidade: ${filtros.habilidade}
                <button type="button" aria-label="Remover filtro de habilidade" onClick=${() => setFiltros({ ...filtros, habilidade: '' })}>×</button>
              </span>
            `
      : null}
          ${filtros.tag
      ? html`
              <span class="rh-filter-chip">
                Tag: ${filtros.tag}
                <button type="button" aria-label="Remover filtro de tag" onClick=${() => setFiltros({ ...filtros, tag: '' })}>×</button>
              </span>
            `
      : null}
        </div>

        ${filtrosBancoAbertos
      ? html`
            <div class="rh-filter-panel-expanded">
              <div class="rh-filter-grid">
                <div class="rh-filter-field">
                  <label>Habilidade</label>
                  <input
                    class="form-control"
                    placeholder="Excel, Atendimento, TI..."
                    value=${filtros.habilidade}
                    onInput=${(event) => setFiltros({ ...filtros, habilidade: event.target.value })}
                  />
                </div>
                <div class="rh-filter-field">
                  <label>Tag</label>
                  <input
                    class="form-control"
                    placeholder="Prioritário, Boa aderência..."
                    value=${filtros.tag}
                    onInput=${(event) => setFiltros({ ...filtros, tag: event.target.value })}
                  />
                </div>
              </div>
            </div>
          `
      : null}
      </${SectionCard}>

      <${SectionCard}
        title="Lista atual"
        description="Reaproveitamento, perfil RH e filtros avançados funcionando sobre dados persistidos."
        tourId="talent-table"
      >
        ${html`
              <div class="table-responsive">
                <table class="table align-middle rh-modern-history-table">
                  <thead>
                    <tr>
                      <th>Candidato</th>
                      <th>Localização</th>
                      <th>Vaga / Processo</th>
                      <th class="text-end">Nota</th>
                      <th>Habilidades / tags</th>
                      <th>Observações RH</th>
                      <th>Entrevista</th>
                      <th>CV</th>
                      <th class="text-end">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${carregando
        ? html`<${SkeletonTableRows} colunas=${9} linhas=${6} />`
        : linhas.length
          ? linhas.map(
            (linha) => html`
                            <tr key=${linha.id_banco} class="c24-fade-in">
                              <td>
                                <strong>${linha.nome_candidato || '-'}</strong>
                                <div class="small text-muted mt-1">
                                  ${formatarDataHora(linha.data_movimentacao)}
                                  ${linha.expirado
                ? html`
                                        <span
                                          class="rh-status-pill is-not-qualified ms-2"
                                          title="Mais de 180 dias no banco de talentos — revise antes de reutilizar."
                                        >
                                          Expirado
                                        </span>
                                      `
                : null}
                                </div>
                              </td>
                              <td>${[linha.cidade, linha.bairro].filter(Boolean).join(' · ') || '-'}</td>
                              <td>
                                <div>${linha.vaga || '-'}</div>
                                <div class="small text-muted">${linha.id_processo || '-'}</div>
                              </td>
                              <td class="text-end">
                                ${linha.pontuacao_final
                ? html`<span class=${`candidate-score-badge num ${obterClasseFaixaNota(linha.pontuacao_final)}`}>${linha.pontuacao_final}</span>`
                : '-'}
                              </td>
                              <td>
                                <div class="rh-cell-stack">
                                  <div class="rh-chip-wrap">
                                    ${(linha.habilidades || []).map(
                  (item) => html`
                                        <span key=${item} class="rh-chip is-skill">${item}</span>
                                      `,
                )}
                                    ${(linha.tags || []).map(
                  (item) => html`
                                        <span key=${item} class="rh-chip">${item}</span>
                                      `,
                )}
                                  </div>
                                  <small>${linha.origem || '-'}</small>
                                </div>
                              </td>
                              <td>${linha.observacao_rh || 'Sem observações.'}</td>
                              <td>
                                ${linha.status_entrevista
                ? html`
                                      <div class="rh-cell-stack">
                                        <span
                                          class=${`rh-status-pill ${obterClasseStatusEntrevista(linha.status_entrevista)}`}
                                        >
                                          ${linha.status_entrevista}
                                        </span>
                                        <small>${formatarDataHora(linha.data_entrevista)}</small>
                                      </div>
                                    `
                : 'Não agendada'}
                              </td>
                              <td>
                                ${linha.cv_disponivel
                ? html`
                                      <button
                                        type="button"
                                        class="btn btn-sm btn-outline-secondary"
                                        onClick=${() => abrirCurriculo(linha)}
                                      >
                                        Ver CV
                                      </button>
                                    `
                : 'Sem CV'}
                              </td>
                              <td class="text-end">
                                <div class="d-flex justify-content-end gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-secondary"
                                    onClick=${() => abrirEdicaoPerfil(linha)}
                                  >
                                    Perfil RH
                                  </button>
                                  ${linha.expirado
                ? html`
                                        <button
                                          type="button"
                                          class="btn btn-sm btn-outline-primary"
                                          disabled=${salvando}
                                          onClick=${() => revalidar(linha.id_banco)}
                                        >
                                          Revalidar
                                        </button>
                                      `
                : null}
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-danger"
                                    disabled=${salvando}
                                    onClick=${() => remover(linha.id_banco)}
                                  >
                                    Eliminar
                                  </button>
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-outline-primary"
                                    onClick=${() => {
                setCandidatoParaUtilizar(linha);
                setProcessoSelecionadoUso('');
              }}
                                  >
                                    Utilizar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          `,
          )
          : html`
                          <${TabelaVazia}
                            colunas=${9}
                            texto="Nenhum candidato no banco de talentos."
                            icone="person_search"
                          />
                        `}
                  </tbody>
                </table>
              </div>
            `}
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${!!candidatoParaUtilizar}
        titulo="Utilizar candidato"
        subtitulo="Selecione o processo aberto e confirme a reutilização."
        onClose=${() => {
      setCandidatoParaUtilizar(null);
      setProcessoSelecionadoUso('');
    }}
      >
        <div class="rh-details-body">
          <label class="form-label">Processo aberto</label>
          <select
            class="form-select"
            value=${processoSelecionadoUso}
            onChange=${(event) => setProcessoSelecionadoUso(event.target.value)}
          >
            <option value="">Selecione...</option>
              ${processosAbertos.map(
      (processo) => html`
                <option key=${obterChaveProcesso(processo)} value=${obterReferenciaProcesso(processo)}>
                  ${processo.id_processo} • ${processo.vaga} •
                  ${processo.operacao || processo.trilha || '-'}
                </option>
              `,
    )}
          </select>
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => {
      setCandidatoParaUtilizar(null);
      setProcessoSelecionadoUso('');
    }}
          >
            Cancelar
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled=${salvando}
            onClick=${confirmarUso}
          >
            Confirmar utilização
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!perfilEdicao}
        titulo="Perfil RH do candidato"
        subtitulo="Cadastre habilidades, tags e observações persistidas para reutilização futura."
        onClose=${() => setPerfilEdicao(null)}
      >
        ${perfilEdicao
      ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-12">
                    <label class="form-label">Candidato</label>
                    <input
                      class="form-control"
                      readonly
                      value=${perfilEdicao.nome_candidato || ''}
                    />
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Habilidades</label>
                    <input
                      class="form-control"
                      placeholder="Excel, Atendimento, Administrativo..."
                      value=${formularioPerfil.habilidades}
                      onInput=${(event) =>
          setFormularioPerfil({
            ...formularioPerfil,
            habilidades: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Tags</label>
                    <input
                      class="form-control"
                      placeholder="Prioritário, Boa aderência..."
                      value=${formularioPerfil.tags}
                      onInput=${(event) =>
          setFormularioPerfil({
            ...formularioPerfil,
            tags: event.target.value,
          })}
                    />
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Observação RH</label>
                    <textarea
                      class="form-control"
                      rows="5"
                      value=${formularioPerfil.observacao_rh}
                      onInput=${(event) =>
          setFormularioPerfil({
            ...formularioPerfil,
            observacao_rh: event.target.value,
          })}
                    ></textarea>
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary"
                  onClick=${() => setPerfilEdicao(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled=${salvando}
                  onClick=${salvarPerfil}
                >
                  ${salvando ? 'Salvando...' : 'Salvar perfil'}
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}

function GraficoComparativoAnalise({ itens = [] }) {
  const dados = Array.isArray(itens) ? itens : [];
  const maiorValor = Math.max(
    1,
    ...dados.flatMap((item) => [
      Number(item?.obtained || 0),
      Number(item?.expected || 0),
    ]),
  );

  if (!dados.length) {
    return html`
      <${EmptyState}
        title="Sem dados para o gráfico"
        text="Não há informações suficientes para exibir a comparação."
      />
    `;
  }

  return html`
    <div class="rh-analysis-chart">
      ${dados.map(
    (item, indice) => html`
          <div key=${indice} class="rh-analysis-chart-row">
            <div class="rh-analysis-chart-label">${item.label || '-'}</div>
            <div class="rh-analysis-chart-bars">
              <div class="rh-analysis-chart-bar-track">
                <div
                  class="rh-analysis-chart-bar is-obtained"
                  style=${{
        width: `${(Number(item?.obtained || 0) / maiorValor) * 100}%`,
      }}
                ></div>
              </div>
              <div class="rh-analysis-chart-bar-track">
                <div
                  class="rh-analysis-chart-bar is-expected"
                  style=${{
        width: `${(Number(item?.expected || 0) / maiorValor) * 100}%`,
      }}
                ></div>
              </div>
            </div>
            <div class="rh-analysis-chart-value">
              ${formatarNotaAnalise(item?.obtained || 0)} x
              ${formatarNotaAnalise(item?.expected || 0)}
            </div>
          </div>
        `,
  )}
    </div>
  `;
}

export function TelaAnaliseCandidatos({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [linhas, setLinhas] = useState([]);
  const [relatorioAtivo, setRelatorioAtivo] = useState('processos');
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(false);
  const [exportandoRelatorio, setExportandoRelatorio] = useState(false);
  const [relatorioProcessos, setRelatorioProcessos] = useState([]);
  const [relatorioCandidatos, setRelatorioCandidatos] = useState([]);
  const [ultimaAtualizacaoRelatorio, setUltimaAtualizacaoRelatorio] = useState(null);
  const [erroRelatorio, setErroRelatorio] = useState('');
  const [paginaRelatorio, setPaginaRelatorio] = useState(1);
  const [painelFiltrosRelatorioAberto, setPainelFiltrosRelatorioAberto] = useState(false);
  const [menuExportacaoAberto, setMenuExportacaoAberto] = useState(false);
  const [filtrosRelatorio, setFiltrosRelatorio] = useState({
    dataInicial: '',
    dataFinal: '',
    status: '',
    processo: '',
  });
  const [detalhe, setDetalhe] = useState(null);
  const exportMenuRef = useRef(null);

  const carregarAnalises = async () => {
    const dados = await lerAnalisesCandidatos();
    setLinhas(Array.isArray(dados) ? dados : []);
  };

  const carregarRelatorios = async (filtrosBase = filtrosRelatorio) => {
    setCarregandoRelatorio(true);
    setErroRelatorio('');
    try {
      const [processos, candidatos] = await Promise.all([
        lerRelatorioProcessos(filtrosBase),
        lerRelatorioCandidatos(filtrosBase),
      ]);
      setRelatorioProcessos(Array.isArray(processos) ? processos : []);
      setRelatorioCandidatos(Array.isArray(candidatos) ? candidatos : []);
      setUltimaAtualizacaoRelatorio(new Date());
      setPaginaRelatorio(1);
    } catch (error) {
      setErroRelatorio(error?.message || 'Não foi possível carregar os relatórios.');
    } finally {
      setCarregandoRelatorio(false);
    }
  };

  const exportarRelatorioAtivo = async (formato) => {
    if (exportandoRelatorio) return;
    const configuracao =
      relatorioAtivo === 'processos'
        ? {
          colunas: COLUNAS_RELATORIO_PROCESSOS,
          linhas: relatorioProcessosFiltrado.map(montarLinhaProcessoRelatorio),
          nomeBase: 'relatorio_processos',
          planilha: 'Processos',
        }
        : relatorioAtivo === 'ranking'
          ? {
            colunas: COLUNAS_RANKING_ANALITICO,
            linhas: rankingAnaliticoFiltrado.map(montarLinhaRankingRelatorio),
            nomeBase: 'ranking_analitico',
            planilha: 'Ranking',
          }
          : {
            colunas: COLUNAS_RELATORIO_CANDIDATOS,
            linhas: relatorioCandidatosFiltrado,
            nomeBase: 'relatorio_candidatos',
            planilha: 'Candidatos',
          };

    setExportandoRelatorio(true);
    setErroRelatorio('');
    try {
      if (formato === 'xlsx') {
        baixarXlsxRelatorio(
          configuracao.nomeBase,
          configuracao.planilha,
          configuracao.colunas,
          configuracao.linhas,
        );
      } else {
        baixarCsvRelatorio(configuracao.nomeBase, configuracao.colunas, configuracao.linhas);
      }
      setMenuExportacaoAberto(false);
    } catch (error) {
      setErroRelatorio(error?.message || 'Não foi possível exportar o relatório agora.');
    } finally {
      setExportandoRelatorio(false);
    }
  };

  useEffect(() => {
    carregarAnalises();
    carregarRelatorios();
  }, []);

  useEffect(() => {
    if (!menuExportacaoAberto) return undefined;
    const fecharMenu = (event) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setMenuExportacaoAberto(false);
      }
    };
    const fecharComTeclado = (event) => {
      if (event.key === 'Escape') {
        setMenuExportacaoAberto(false);
      }
    };
    document.addEventListener('mousedown', fecharMenu);
    document.addEventListener('keydown', fecharComTeclado);
    return () => {
      document.removeEventListener('mousedown', fecharMenu);
      document.removeEventListener('keydown', fecharComTeclado);
    };
  }, [menuExportacaoAberto]);

  const rankingAnaliticoFiltrado = useMemo(
    () =>
      linhas.filter((linha) => {
        const matchProcesso =
          !filtrosRelatorio.processo ||
          normalizarBuscaPainel([
            linha?.id_processo,
            linha?.nome_candidato,
            linha?.vaga,
            linha?.recomendacao,
          ].join(' ')).includes(normalizarBuscaPainel(filtrosRelatorio.processo));
        const matchStatus =
          !filtrosRelatorio.status ||
          normalizarBuscaPainel(getCandidateVisibleStatus(linha)).includes(
            normalizarBuscaPainel(filtrosRelatorio.status),
          );

        return matchProcesso && matchStatus;
      }),
    [linhas, filtrosRelatorio.processo, filtrosRelatorio.status],
  );
  const rankingResumoVisual = useMemo(() => {
    const comNota = rankingAnaliticoFiltrado
      .map((linha) => ({
        label: linha.nome_candidato || 'Candidato',
        value: Number(String(linha.nota_final ?? '0').replace(',', '.')) || 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const aceitos = rankingAnaliticoFiltrado.filter(
      (linha) => getCandidateVisibleStatus(linha) === 'Aprovado',
    ).length;
    const reprovados = rankingAnaliticoFiltrado.filter((linha) => {
      const status = getCandidateVisibleStatus(linha);
      return status === 'Eliminado' || status === 'Reprovado';
    }).length;
    return { comNota, aceitos, reprovados };
  }, [rankingAnaliticoFiltrado]);
  const filtrosRelatorioAtivos = [
    filtrosRelatorio.dataInicial,
    filtrosRelatorio.dataFinal,
    filtrosRelatorio.status,
    filtrosRelatorio.processo,
  ].filter((valor) => String(valor || '').trim()).length;
  const relatorioProcessosFiltrado = useMemo(() => {
    const busca = normalizarBuscaPainel(filtrosRelatorio.processo);
    const status = normalizarBuscaPainel(filtrosRelatorio.status);

    return relatorioProcessos.filter((linha) => {
      const matchBusca =
        !busca || normalizarBuscaPainel(textoBuscaRelatorioProcesso(linha)).includes(busca);
      const matchStatus =
        !status || normalizarBuscaPainel(obterStatusRelatorioProcesso(linha)).includes(status);

      return matchBusca && matchStatus;
    });
  }, [relatorioProcessos, filtrosRelatorio.processo, filtrosRelatorio.status]);
  const relatorioCandidatosFiltrado = useMemo(() => {
    const busca = normalizarBuscaPainel(filtrosRelatorio.processo);
    const status = normalizarBuscaPainel(filtrosRelatorio.status);

    return relatorioCandidatos.filter((linha) => {
      const matchBusca =
        !busca ||
        normalizarBuscaPainel([
          linha?.processo,
          linha?.id_processo,
          linha?.id_processo_ref,
          linha?.vaga,
          linha?.nome_candidato,
        ].join(' ')).includes(busca);
      const matchStatus =
        !status ||
        normalizarBuscaPainel(linha?.status_atual || linha?.status).includes(status);

      return matchBusca && matchStatus;
    });
  }, [relatorioCandidatos, filtrosRelatorio.processo, filtrosRelatorio.status]);
  const linhasRelatorioAtivo =
    relatorioAtivo === 'processos'
      ? relatorioProcessosFiltrado
      : relatorioAtivo === 'ranking'
        ? rankingAnaliticoFiltrado
        : relatorioCandidatosFiltrado;
  const paginacaoRelatorio = obterItensPaginados(linhasRelatorioAtivo, paginaRelatorio, TAMANHO_RELATORIO);
  const totalRelatorioAtivo = linhasRelatorioAtivo.length;
  const rotuloTotalRelatorio =
    relatorioAtivo === 'processos'
      ? `${totalRelatorioAtivo} ${totalRelatorioAtivo === 1 ? 'processo' : 'processos'}`
      : relatorioAtivo === 'ranking'
        ? `${totalRelatorioAtivo} ${totalRelatorioAtivo === 1 ? 'candidato ranqueado' : 'candidatos ranqueados'}`
        : `${totalRelatorioAtivo} ${totalRelatorioAtivo === 1 ? 'candidato' : 'candidatos'}`;
  const detalheEstadoAcoes = useMemo(
    () => getCandidateActionState(detalhe || {}, detalhe?.status_processo || ''),
    [detalhe],
  );

  useEffect(() => {
    setPaginaRelatorio(1);
  }, [
    relatorioAtivo,
    filtrosRelatorio.dataInicial,
    filtrosRelatorio.dataFinal,
    filtrosRelatorio.status,
    filtrosRelatorio.processo,
  ]);

  const atualizarFiltroRelatorio = (campo, valor) => {
    setFiltrosRelatorio((atuais) => ({
      ...atuais,
      [campo]: valor,
    }));
  };

  const limparFiltrosRelatorio = () => {
    const filtrosLimpos = {
      dataInicial: '',
      dataFinal: '',
      status: '',
      processo: '',
    };
    setFiltrosRelatorio(filtrosLimpos);
    setPaginaRelatorio(1);
    setPainelFiltrosRelatorioAberto(false);
    carregarRelatorios(filtrosLimpos);
  };

  const alterarRelatorioAtivo = (valor) => {
    setRelatorioAtivo(valor);
    setPaginaRelatorio(1);
  };

  const abrirProcessoDoRelatorio = (linha) => {
    const referencia = obterIdRelatorioProcesso(linha);
    if (!referencia || !controlador.possuiPermissao('processos.visualizar')) return;
    sessionStorage.setItem(CHAVE_PROCESSO_DETALHE, referencia);
    controlador.irParaTelaProtegida('screen-process-details');
  };

  const aplicarAcao = async (statusCandidato) => {
    if (!detalhe?.id_teste) return;
    if (detalheEstadoAcoes.processClosed) {
      showToast('O processo seletivo deste candidato está encerrado e não permite novas movimentações.', 'warning');
      return;
    }
    if (
      statusCandidato === 'Aprovado' &&
      !detalheEstadoAcoes.canApprove
    ) {
      showToast('A aprovação não está disponível para o status atual deste candidato.', 'warning');
      return;
    }
    if (
      statusCandidato === 'Eliminado' &&
      !detalheEstadoAcoes.canEliminate
    ) {
      showToast('A eliminação não está disponível para o status atual deste candidato.', 'warning');
      return;
    }
    if (
      statusCandidato === 'Banco de talentos' &&
      !detalheEstadoAcoes.canSendToTalentBank
    ) {
      showToast('O envio para banco de talentos não está disponível para o status atual deste candidato.', 'warning');
      return;
    }

    const candidatosProcesso = await lerCandidatosProcessos();
    const vinculo = candidatosProcesso.find(
      (item) =>
        String(item.id_teste || '').trim() ===
        String(detalhe.id_teste || '').trim(),
    );

    if (!vinculo) {
      showToast(
        'Não foi possível localizar o vínculo do candidato com o processo.',
        'error',
      );
      return;
    }

    await atualizarStatusCandidato(vinculo.id_registro, {
      status_candidato: statusCandidato,
      data_movimentacao: new Date().toISOString(),
    });

    await carregarAnalises();
    setDetalhe(await lerDetalheAnaliseCandidato(detalhe.id_teste));
  };

  return html`
    <${PainelRh}
      screenId="screen-analysis-candidates"
      navAtiva="screen-analysis-candidates"
      subtituloMarca="Análise por candidato"
      placeholderBusca="Inteligência analítica do RH"
      controlador=${controlador}
      mostrarAtalhos=${false}
    >
      <${ToastHost} />
      <${PageIntro}
        title="Relatórios"
        description=${html`${formatarAtualizacaoRelatorio(ultimaAtualizacaoRelatorio)}
          <button type="button" class="reports-refresh-link" disabled=${carregandoRelatorio} onClick=${carregarRelatorios}>
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('sync')}</span>
            Atualizar
          </button>`}
        actions=${html`
          <button
            type="button"
            class="c24-icon-btn"
            title="Atualizar relatórios"
            disabled=${carregandoRelatorio}
            onClick=${carregarRelatorios}
          >
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('sync')}</span>
          </button>
          <div class="reports-export-menu" ref=${exportMenuRef}>
            <button
              type="button"
              class="c24-icon-btn"
              title="Opções do relatório"
              aria-label="Opções do relatório"
              aria-haspopup="menu"
              aria-expanded=${menuExportacaoAberto}
              disabled=${carregandoRelatorio || exportandoRelatorio}
              onClick=${() => setMenuExportacaoAberto((aberto) => !aberto)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(exportandoRelatorio ? 'hourglass_top' : 'settings')}</span>
            </button>
            ${menuExportacaoAberto
        ? html`
                  <div class="reports-export-panel" role="menu" aria-label="Opções de download do relatório">
                    <div class="reports-menu-title">Baixar relatório completo</div>
                    <button
                      type="button"
                      class="reports-export-option"
                      role="menuitem"
                      disabled=${exportandoRelatorio}
                      onClick=${() => exportarRelatorioAtivo('csv')}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('description')}</span>
                      CSV
                    </button>
                    <button
                      type="button"
                      class="reports-export-option"
                      role="menuitem"
                      disabled=${exportandoRelatorio}
                      onClick=${() => exportarRelatorioAtivo('xlsx')}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('table_view')}</span>
                      Excel (.xlsx)
                    </button>
                  </div>
                `
        : null}
          </div>
        `}
      />

      <${SectionCard} className="reports-modern-card">
        <div class="reports-count-line">${rotuloTotalRelatorio}</div>

        <div class="reports-control-bar">
          <label class="reports-type-select">
            <span>Tipo de relatório</span>
            <select
              class="form-select"
              value=${relatorioAtivo}
              onChange=${(event) => alterarRelatorioAtivo(event.target.value)}
            >
              <option value="processos">Relatório de Processos</option>
              <option value="candidatos">Relatório de Candidatos</option>
              <option value="ranking">Ranking Analítico</option>
            </select>
          </label>

          <label class="reports-search-field">
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('search')}</span>
            <input
              class="form-control"
              placeholder=${relatorioAtivo === 'processos'
      ? 'Pesquisar processo por nome ou ID'
      : relatorioAtivo === 'ranking'
        ? 'Pesquisar por processo, candidato ou vaga'
        : 'Pesquisar por processo, vaga ou candidato'}
              value=${filtrosRelatorio.processo}
              onInput=${(event) => atualizarFiltroRelatorio('processo', event.target.value)}
            />
          </label>

          <div class="reports-filter-menu">
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm reports-filter-btn"
              onClick=${() => setPainelFiltrosRelatorioAberto((aberto) => !aberto)}
              aria-expanded=${painelFiltrosRelatorioAberto}
            >
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('filter_alt')}</span>
              Filtros
              ${filtrosRelatorioAtivos
      ? html`<span class="reports-filter-count">${filtrosRelatorioAtivos}</span>`
      : null}
            </button>

            ${painelFiltrosRelatorioAberto
      ? html`
                  <div class="reports-filter-panel" role="dialog" aria-label="Filtros do relatório">
                    <label>
                      <span>Data inicial</span>
                      <input
                        class="form-control"
                        type="date"
                        value=${filtrosRelatorio.dataInicial}
                        onInput=${(event) => atualizarFiltroRelatorio('dataInicial', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Data final</span>
                      <input
                        class="form-control"
                        type="date"
                        value=${filtrosRelatorio.dataFinal}
                        onInput=${(event) => atualizarFiltroRelatorio('dataFinal', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Status</span>
                      <select
                        class="form-select"
                        value=${filtrosRelatorio.status}
                        onChange=${(event) => atualizarFiltroRelatorio('status', event.target.value)}
                      >
                        <option value="">Todos</option>
                        ${relatorioAtivo === 'processos'
          ? html`
                              <option value="Aberto">Aberto</option>
                              <option value="Encerrado">Encerrado</option>
                              <option value="Cancelado">Cancelado</option>
                            `
          : html`
                              <option value="Aprovado">Aprovado</option>
                              <option value="Eliminado">Eliminado/Reprovado</option>
                              <option value="Banco de talentos">Banco de Talentos</option>
                              <option value="Analise">Em andamento</option>
                            `}
                      </select>
                    </label>
                    <div class="reports-filter-actions">
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        disabled=${carregandoRelatorio}
                        onClick=${() => {
          setPainelFiltrosRelatorioAberto(false);
          carregarRelatorios();
        }}
                      >
                        Aplicar
                      </button>
                    </div>
                  </div>
                `
      : null}
          </div>

          <button
            type="button"
            class="btn btn-outline-secondary btn-sm reports-clear-btn"
            disabled=${!filtrosRelatorioAtivos}
            onClick=${limparFiltrosRelatorio}
          >
            Limpar tudo
          </button>
        </div>

        ${erroRelatorio ? html`<div class="rh-inline-alert reports-alert">${erroRelatorio}</div>` : null}

        ${relatorioAtivo === 'processos'
      ? html`
              <div class="reports-table-shell">
                <table class="table align-middle rh-modern-history-table reports-process-table">
                  <thead>
                    <tr>
                      <th>ID do processo</th>
                      <th>Processo</th>
                      <th>Data de abertura</th>
                      <th>Data de encerramento</th>
                      <th>Status</th>
                      <th class="is-number">Total de vagas</th>
                      <th class="is-number">Vagas preenchidas</th>
                      <th class="is-number">Candidatos</th>
                      <th class="is-number">Aprovados</th>
                      <th class="is-number">Eliminados</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${carregandoRelatorio
          ? html`<${TabelaVazia} colunas=${10} texto="Carregando relatórios..." />`
          : paginacaoRelatorio.itens.length
            ? paginacaoRelatorio.itens.map(
              (linha) => {
                const idProcesso = obterIdRelatorioProcesso(linha);
                const status = obterStatusRelatorioProcesso(linha);
                return html`
                                <tr key=${`${idProcesso}-${linha.data_abertura}`}>
                                  <td>
                                    ${idProcesso && controlador.possuiPermissao('processos.visualizar')
                    ? html`
                                          <button
                                            type="button"
                                            class="reports-process-link"
                                            onClick=${() => abrirProcessoDoRelatorio(linha)}
                                          >
                                            ${idProcesso}
                                          </button>
                                        `
                    : html`<span class="reports-process-id">${idProcesso || '-'}</span>`}
                                  </td>
                                  <td>${obterNomeRelatorioProcesso(linha)}</td>
                                  <td>${formatarDataRelatorio(linha.data_abertura)}</td>
                                  <td>${formatarDataRelatorio(linha.data_encerramento)}</td>
                                  <td>
                                    <span class=${`rh-status-pill ${obterClasseStatusRelatorioProcesso(status)}`}>
                                      ${status || '-'}
                                    </span>
                                  </td>
                                  <td class="is-number">${formatarNumeroRelatorio(linha.quantidade_vagas, '-')}</td>
                                  <td class="is-number">${formatarNumeroRelatorio(obterPrimeiroValorRelatorio(linha, ['vagas_preenchidas', 'quantidade_vagas_preenchidas', 'quantidade_aprovados'], 0))}</td>
                                  <td class="is-number">${formatarNumeroRelatorio(obterPrimeiroValorRelatorio(linha, ['quantidade_candidatos', 'total_candidatos', 'candidatos'], '-'), '-')}</td>
                                  <td class="is-number">${formatarNumeroRelatorio(linha.quantidade_aprovados)}</td>
                                  <td class="is-number">${formatarNumeroRelatorio(linha.quantidade_eliminados_reprovados)}</td>
                                </tr>
                              `;
              },
            )
            : html`<${TabelaVazia} colunas=${10} texto="Nenhum processo no período." />`}
                  </tbody>
                </table>
              </div>
            `
      : relatorioAtivo === 'ranking'
        ? html`
              ${rankingResumoVisual.comNota.length
            ? html`
                    <div class="reports-charts-row">
                      <${SectionCard} title="Comparativo de notas" className="reports-chart-card">
                        <${BarComparisonChart}
                          items=${rankingResumoVisual.comNota}
                          valueFormatter=${(valor) => valor.toFixed(1)}
                        />
                      </${SectionCard}>
                      <${SectionCard} title="Aprovação" className="reports-chart-card reports-chart-card--donut">
                        <${AcceptanceDonutChart}
                          aceitos=${rankingResumoVisual.aceitos}
                          reprovados=${rankingResumoVisual.reprovados}
                        />
                      </${SectionCard}>
                    </div>
                  `
            : null}
              <div class="reports-table-shell">
                <table class="table align-middle rh-modern-history-table reports-ranking-table">
                  <thead>
                    <tr>
                      <th>Processo</th>
                      <th>Candidato</th>
                      <th>Vaga</th>
                      <th>Nota</th>
                      <th>Afinidade</th>
                      <th>Recomendação</th>
                      <th>Status</th>
                      <th class="text-end">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${paginacaoRelatorio.itens.length
            ? paginacaoRelatorio.itens.map(
              (linha) => html`
                            <tr key=${linha.id_teste || `${linha.id_processo}-${linha.nome_candidato}`}>
                              <td>${linha.id_processo || '-'}</td>
                              <td>${linha.nome_candidato || '-'}</td>
                              <td>${linha.vaga || '-'}</td>
                              <td>${formatarNotaAnalise(linha.nota_final)}</td>
                              <td>${formatarPercentualAfinidade(linha.afinidade_percentual)}%</td>
                              <td>
                                <span class=${obterClasseAderencia(linha.recomendacao)}>
                                  ${linha.recomendacao || '-'}
                                </span>
                              </td>
                              <td>${getCandidateVisibleStatus(linha) || '-'}</td>
                              <td class="text-end">
                                <button
                                  type="button"
                                  class="btn btn-sm btn-outline-primary"
                                  disabled=${!linha.id_teste}
                                  onClick=${async () => setDetalhe(await lerDetalheAnaliseCandidato(linha.id_teste))}
                                >
                                  Detalhes
                                </button>
                              </td>
                            </tr>
                          `,
            )
            : html`<${TabelaVazia} colunas=${8} texto="Nenhuma análise disponível." />`}
                  </tbody>
                </table>
              </div>
            `
        : html`
              <div class="reports-table-shell">
                <table class="table align-middle rh-modern-history-table reports-candidates-table">
                  <thead>
                    <tr>
                      ${COLUNAS_RELATORIO_CANDIDATOS.map((coluna) => html`<th key=${coluna.key}>${coluna.label}</th>`)}
                    </tr>
                  </thead>
                  <tbody>
                    ${carregandoRelatorio
            ? html`<${TabelaVazia} colunas=${COLUNAS_RELATORIO_CANDIDATOS.length} texto="Carregando relatórios..." />`
            : paginacaoRelatorio.itens.length
              ? paginacaoRelatorio.itens.map(
                (linha) => html`
                              <tr key=${`${linha.id_candidato || linha.id_teste}-${linha.processo_relatorio || linha.processo}`}>
                                <td>${linha.id_candidato || '-'}</td>
                                <td>${linha.nome || linha.nome_candidato || '-'}</td>
                                <td>${linha.telefone || '-'}</td>
                                <td>${linha.e_mail || linha.email || '-'}</td>
                                <td>${linha.processo_relatorio || linha.processo || '-'}</td>
                                <td>${linha.vaga_relatorio || linha.vaga || '-'}</td>
                                <td>${linha.data_entrada || '-'}</td>
                                <td>
                                  <span
                                    class="reports-text-ellipsis"
                                    title=${linha.movimentacoes_completas || linha.movimentacoes || ''}
                                  >
                                    ${resumirTextoTabela(linha.movimentacoes_completas || linha.movimentacoes)}
                                  </span>
                                </td>
                                <td>${linha.nota_perfil || '-'}</td>
                                <td>${linha.score_cv || '-'}</td>
                                <td>${linha.cv || '-'}</td>
                                <td>
                                  <span class="reports-text-ellipsis" title=${linha.justificativa || ''}>
                                    ${resumirTextoTabela(linha.justificativa, 64)}
                                  </span>
                                </td>
                                <td>${linha.prova || '-'}</td>
                                <td>${linha.data_da_prova || '-'}</td>
                                <td>${linha.nota_word || '-'}</td>
                                <td>${linha.nota_excel || '-'}</td>
                                <td>${linha.nota_conhecimentos_gerais || '-'}</td>
                                <td>${linha.nota_conhecimentos_tecnicos || '-'}</td>
                                <td>${linha.nota_redacao || '-'}</td>
                                <td>${linha.aprovacao || '-'}</td>
                                <td>${linha.eliminacao || '-'}</td>
                                <td>${linha.motivo_da_eliminacao || '-'}</td>
                                <td>${linha.banco_de_talentos || '-'}</td>
                                <td>${linha.data_saida || '-'}</td>
                              </tr>
                            `,
              )
              : html`<${TabelaVazia} colunas=${COLUNAS_RELATORIO_CANDIDATOS.length} texto="Nenhum candidato no período." />`}
                  </tbody>
                </table>
              </div>
            `}

        <${PaginacaoCompacta}
          paginacao=${paginacaoRelatorio}
          label=${`Mostrando ${obterIntervaloPaginacao(paginacaoRelatorio)} de ${paginacaoRelatorio.totalItens} resultados`}
          onChange=${setPaginaRelatorio}
        />
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${!!detalhe}
        titulo=${`Análise do candidato • ${detalhe?.nome_candidato || 'Candidato'}`}
        subtitulo="Comparativo analítico entre desempenho e expectativa da vaga."
        onClose=${() => setDetalhe(null)}
      >
        ${detalhe
      ? html`
              <div class="rh-details-body">
                <${MetricGrid}
                  items=${[
          { label: 'Processo', value: detalhe.id_processo || '-' },
          { label: 'Candidato', value: detalhe.nome_candidato || '-' },
          { label: 'Vaga', value: detalhe.vaga || '-' },
          {
            label: 'Nota final',
            value: formatarNotaAnalise(detalhe.nota_final),
          },
          {
            label: 'Afinidade',
            value: `${formatarPercentualAfinidade(
              detalhe.afinidade_percentual,
            )}%`,
          },
          {
            label: 'Recomendação',
            value: html`
                        <span class=${obterClasseAderencia(detalhe.recomendacao)}>
                          ${detalhe.recomendacao || '-'}
                        </span>
                      `,
          },
          {
            label: 'Status atual',
            value: getCandidateVisibleStatus(detalhe) || '-',
          },
          {
            label: 'Processo',
            value: detalhe.status_processo || 'Aberto',
          },
        ]}
                />

                <${SectionCard}
                  title="Etapas comparadas"
                  className="rh-section-card--flat"
                >
                  <${GraficoComparativoAnalise} itens=${detalhe.grafico || []} />
                </${SectionCard}>

                <${SectionCard}
                  title="Observações"
                  className="rh-section-card--flat"
                >
                  <div class="rh-detail-list">
                    <div>
                      Nota textual geral:
                      ${formatarNotaAnalise(
          detalhe?.analise_texto?.overall || 0,
        )}
                    </div>
                    ${(detalhe.ressalvas || []).map(
          (item, indice) => html`<div key=${indice}>${item}</div>`,
        )}
                    <div>${detalhe.parecer_final || '-'}</div>
                  </div>
                </${SectionCard}>
              </div>

              <footer class="rh-modal-footer">
                <div class="rh-modal-footer-actions">
                  ${detalheEstadoAcoes.canApprove
          ? html`
                        <button
                          type="button"
                          class="btn btn-outline-success"
                          onClick=${() => aplicarAcao('Aprovado')}
                        >
                          Aprovar
                        </button>
                      `
          : null}
                  ${detalheEstadoAcoes.canEliminate
          ? html`
                        <button
                          type="button"
                          class="btn btn-outline-danger"
                          onClick=${() => aplicarAcao('Eliminado')}
                        >
                          Eliminar
                        </button>
                      `
          : null}
                  ${detalheEstadoAcoes.canSendToTalentBank
          ? html`
                        <button
                          type="button"
                          class="btn btn-outline-secondary"
                          onClick=${() => aplicarAcao('Banco de talentos')}
                        >
                          Banco de talentos
                        </button>
                      `
          : null}
                  ${!detalheEstadoAcoes.canApprove &&
          !detalheEstadoAcoes.canEliminate &&
          !detalheEstadoAcoes.canSendToTalentBank
          ? html`
                        <span class="text-muted">
                          ${isProcessClosed(detalhe?.status_processo)
              ? 'Processo encerrado: sem movimentações.'
              : 'Sem ações operacionais para o status atual.'}
                        </span>
                      `
          : null}
                </div>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick=${() => setDetalhe(null)}
                >
                  Fechar
                </button>
              </footer>
            `
      : null}
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
