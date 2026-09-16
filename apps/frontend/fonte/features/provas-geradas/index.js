import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  OPCOES_OPERACOES,
  OPCOES_VAGAS_PROVA,
  SUGESTOES_NIVEL_POR_VAGA,
  montarProvaPorBlueprint,
  resolverBlueprintProva,
} from '../../perguntas.js';
import {
  NIVEIS_PERSONALIZACAO,
  TIPOS_ATENDIMENTO_PERSONALIZACAO,
  corrigirRespostaDiscursivaInteligente,
  gerarPersonalizacaoProva,
  inferirPerfilAtendimentoPersonalizacao,
  registrarHistoricoPersonalizacao,
} from '../prova/services/personalizacao-inteligente.js';
import {
  avaliarRespostaTexto,
  obterFormatacoesAplicadas,
} from '../../regras-prova.js';
import {
  atualizarProvaGerada,
  cancelarProvaGerada,
  criarProvaGerada,
  lerHeatmapQuestoes,
  lerProvaGerada,
  lerReplayProvaGerada,
  lerSessaoPreviaProvaGerada,
  listarProvasGeradas,
  reabrirProvaGerada,
  recalcularScoreProva,
  registrarDecisaoRhProva,
  salvarAvaliacaoManualProva,
} from '../../servico-api.js?v=20260902-correcoes-txt';
import { escaparHtml, obterItensPaginados } from '../../utilitarios.js';
import { listarOperacoes } from '../../services/api/operations.js';
import { abrirFichaCandidatoDaProva } from '../../app/controlador-aplicacao.js';
import { TelaConectaProvas } from '../conecta-provas/index.js';
import { PainelResultadoDisc } from '../disc/index.js';
import { PainelResultadoFitCultural } from '../fit-cultural/index.js';
import { PainelResultadoRaciocinio } from '../raciocinio-logico/index.js';
import { copiarTexto } from '../../shared/browser-utils.js';
import { formatarNotaVisual, formatarTempoRestante } from '../../shared/helpers-visuais.js';
import {
  EmptyState,
  IlustracaoEstadoVazio,
  LoadingState,
  MetricGrid,
  ModalConfirmacaoAcao,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
  Tabs,
  TabPanel,
} from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';

const LINK_CONECTA_PROVAS = '/conecta-provas';
const CHAVE_ABRIR_MODAL_GERAR_PROVA = 'rh_open_generated_exam_modal_v1';
const STATUS_APTOS_GERAR_PROVA = new Set([
  'Agendado',
  'Apto para prova',
  'Em avaliação',
  'Em avaliacao',
  'Pendente de prova',
  'Confirmado',
  'Reagendado',
]);

const OPCOES_LOGIN_CONECTA_PROVA = [
  { value: 'email', label: 'E-mail' },
  { value: 'celular', label: 'Celular' },
  { value: 'codigo_prova', label: 'Código da prova' },
];

const OPCOES_NIVEL = [
  { value: '1', label: 'Nível 1' },
  { value: '2', label: 'Nível 2' },
  { value: '3', label: 'Nível 3' },
  { value: '4', label: 'Nível 4' },
  { value: '5', label: 'Nível 5' },
  { value: 'personalizado', label: 'Personalizado' },
];

const OPCOES_OPERACOES_MODAL = Array.from(
  new Set([
    ...OPCOES_OPERACOES,
    'CRF / Flamengo',
    'Davita',
    'Endoview',
    'Newe Seguros',
    'Central24Horas',
  ].map((item) => normalizarTexto(item)).filter(Boolean)),
);

const OPCOES_AREAS_PROVA = [
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

const OPCOES_TOM_PROVA = [
  'Formal',
  'Corporativo',
  'Humanizado',
  'Técnico',
  'Simples e objetivo',
  'Atendimento ao cliente',
  'Operacional',
];

const OPCAO_OUTRO = 'Outro';

const DECISOES_RH = [
  'Pendente',
  'Aprovado',
  'Aprovado com ressalvas',
  'Reprovado',
  'Eliminado',
  'Banco de talentos',
  'Reavaliar',
  'Desistiu',
];

function normalizarTexto(valor) {
  return String(valor || '').trim();
}

function normalizarBusca(valor) {
  return normalizarTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function validarEmail(valor) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizarTexto(valor));
}

function validarTelefone(valor) {
  const digitos = normalizarTexto(valor).replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 13;
}

function formatarTelefoneBrasileiro(valor) {
  let digitos = normalizarTexto(valor).replace(/\D/g, '');
  if (digitos.length > 11 && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  }
  digitos = digitos.slice(0, 11);
  if (!digitos) return '';
  if (digitos.length <= 2) return `(${digitos}`;

  const ddd = digitos.slice(0, 2);
  const limitePrimeiroBloco = digitos.length > 10 ? 7 : 6;
  const primeiroBloco = digitos.slice(2, limitePrimeiroBloco);
  const segundoBloco = digitos.slice(limitePrimeiroBloco);
  return segundoBloco
    ? `(${ddd}) ${primeiroBloco}-${segundoBloco}`
    : `(${ddd}) ${primeiroBloco}`;
}

function primeiroValorLista(lista = []) {
  return Array.isArray(lista) ? normalizarTexto(lista[0]) : '';
}

function montarListaComOutro(lista = [], outro = '') {
  return [
    ...lista.filter((item) => item !== OPCAO_OUTRO),
    normalizarTexto(outro),
  ].filter(Boolean);
}

function primeiroTexto(...valores) {
  return valores.map(normalizarTexto).find(Boolean) || '';
}

function obterOpcaoVaga(vaga) {
  const chave = normalizarBusca(vaga);
  if (!chave) return null;
  return (
    OPCOES_VAGAS_PROVA.find((item) => normalizarBusca(item.label) === chave) ||
    OPCOES_VAGAS_PROVA.find((item) => {
      const label = normalizarBusca(item.label);
      return label && (chave.includes(label) || label.includes(chave));
    }) ||
    null
  );
}

function normalizarTrilha(valor) {
  const chave = normalizarBusca(valor);
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

function aplicarSugestoesDaVaga(formulario = {}) {
  const opcao = obterOpcaoVaga(formulario.vaga);
  if (!opcao) return formulario;

  const nivelSugerido = normalizarNivelProva(
    SUGESTOES_NIVEL_POR_VAGA[formulario.vaga] || opcao.level || '',
  );
  const areaSugerida = normalizarTexto(opcao.track || '');
  const trilhaSugerida = normalizarTrilha(areaSugerida);

  return {
    ...formulario,
    nivel: nivelSugerido || formulario.nivel,
    area_prova: areaSugerida || formulario.area_prova,
    trilha: trilhaSugerida || formulario.trilha,
  };
}

function obterAreaInicial(candidato, processo, opcaoVaga) {
  return primeiroTexto(
    candidato.area_prova ||
    candidato.area ||
    candidato.area_vaga ||
    candidato.area_cargo ||
    candidato.area_tecnica ||
    candidato.departamento ||
    candidato.trilha ||
    candidato.track ||
    processo.area_prova ||
    processo.area ||
    processo.area_vaga ||
    processo.area_cargo ||
    processo.area_tecnica ||
    processo.departamento ||
    processo.trilha ||
    processo.track ||
    opcaoVaga?.track ||
    '',
  );
}

function normalizarNivelProva(valor) {
  const texto = normalizarTexto(valor);
  if (!texto) return '';
  const chave = normalizarBusca(texto);
  const numero = chave.match(/[1-5]/)?.[0];
  if (numero) return numero;
  if (chave.includes('basico') || chave.includes('junior') || chave.includes('aprendiz')) return '1';
  if (chave.includes('intermediario') || chave.includes('pleno')) return '3';
  if (chave.includes('avancado') || chave.includes('senior') || chave.includes('supervisor')) return '4';
  return texto;
}

function montarOpcoesComValor(opcoes = [], valor = '') {
  const atual = normalizarTexto(valor);
  if (!atual || opcoes.some((opcao) => normalizarBusca(opcao) === normalizarBusca(atual))) {
    return opcoes;
  }
  return [atual, ...opcoes];
}

function resolverTrilhaBlueprint(formulario = {}) {
  return normalizarTrilha(
    formulario.area_prova ||
    formulario.trilha ||
    obterOpcaoVaga(formulario.vaga)?.track ||
    '',
  );
}

function inferirPerfilOperacao(formulario = {}) {
  const base = normalizarBusca([
    formulario.operacao,
    formulario.area_prova,
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

function montarFormularioInicial(contexto = {}) {
  const provaEditar = contexto.provaEditar || {};
  const candidato = { ...(contexto.candidato || {}), ...provaEditar };
  const processo = contexto.processo || {};
  const vaga = normalizarTexto(candidato.vaga || processo.vaga || '');
  const opcaoVaga = obterOpcaoVaga(vaga);
  const area = obterAreaInicial(candidato, processo, opcaoVaga);
  const trilha = normalizarTrilha(area || opcaoVaga?.track || '');
  const nivel = normalizarNivelProva(
    primeiroTexto(
      candidato.nivel,
      candidato.level,
      candidato.nivel_prova,
      candidato.nivel_vaga,
      candidato.nivel_cargo,
      processo.nivel_prova,
      processo.nivel,
      processo.level,
      processo.nivel_vaga,
      processo.nivel_cargo,
      SUGESTOES_NIVEL_POR_VAGA[vaga],
      opcaoVaga?.level,
    ),
  );

  return {
    nome_candidato: normalizarTexto(candidato.nome_candidato || candidato.nome || candidato.name || ''),
    email: normalizarTexto(candidato.email || candidato.email_acesso || candidato.email_candidato || ''),
    telefone: formatarTelefoneBrasileiro(
      candidato.telefone || candidato.telefone_acesso || candidato.whatsapp || candidato.celular || '',
    ),
    cpf: normalizarTexto(candidato.cpf || ''),
    id_teste: normalizarTexto(candidato.id_teste || ''),
    id_registro: candidato.id_registro || null,
    id_entrevista: candidato.id_entrevista || null,
    id_processo: normalizarTexto(processo.id_processo || candidato.id_processo || ''),
    id_processo_ref: normalizarTexto(
      processo.id_processo_ref ||
      candidato.id_processo_ref ||
      candidato.id_processo ||
      '',
    ),
    vaga,
    area_prova: area,
    operacao: normalizarTexto(
      candidato.setor_cliente ||
      candidato.operacao ||
      candidato.cliente ||
      candidato.setor ||
      processo.setor_cliente ||
      processo.operacao ||
      processo.cliente ||
      processo.setor ||
      '',
    ),
    trilha,
    nivel,
    tempo_total: Number(candidato.tempo_total || candidato.time || processo.tempo_prova || processo.tempo_minutos || 40),
    quantidade_questoes: '',
    redacao_obrigatoria: true,
    excel_obrigatorio: false,
    personalizacao_inteligente: false,
    clientes_personalizacao: [],
    cliente_outro: '',
    tipos_atendimento: [],
    tipo_atendimento_outro: '',
    nivel_personalizacao: 'situacional',
    observacoes_internas_rh: normalizarTexto(candidato.configuracao?.observacoes_internas_rh || processo.observacoes_internas_rh || ''),
    tom_prova: normalizarTexto(candidato.configuracao?.personalizacao?.tom_prova || 'Humanizado'),
    situacao_pratica_operacao: normalizarTexto(
      candidato.situacao_pratica_operacao ||
      processo.situacao_pratica_operacao ||
      processo.contexto_vaga ||
      '',
    ),
    expira_em: normalizarTexto(candidato.expira_em || ''),
    login_method: normalizarTexto(candidato.login_method || ''),
    duracao_etapas: Array.isArray(candidato.etapas)
      ? Object.fromEntries(
        candidato.etapas
          .filter((etapa) => etapa?.key)
          .map((etapa) => [
            etapa.key,
            {
              duracao_minutos: Number(etapa.duracao_minutos || 0),
              tolerancia_minutos: Number(etapa.tolerancia_minutos || 0),
            },
          ]),
      )
      : {},
  };
}

function montarEtapasBlueprint(blueprint) {
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

function obterCategoriasDasQuestoes(questoes = []) {
  return Array.from(
    new Set(
      questoes
        .map((questao) => questao.stage || questao.category || questao.stageKey)
        .filter(Boolean),
    ),
  );
}

function obterCompetenciasDasQuestoes(questoes = []) {
  return Array.from(
    new Set(questoes.flatMap((questao) => (Array.isArray(questao.competencias) ? questao.competencias : []))),
  );
}

function statusPermiteGerarProva(candidato = {}) {
  const status = normalizarTexto(
    candidato.status_fluxo ||
    candidato.status_candidato ||
    candidato.status_entrevista ||
    'Agendado',
  );
  return STATUS_APTOS_GERAR_PROVA.has(status);
}

function formatarScore(valor) {
  if (valor === null || valor === undefined || valor === '') return '-';
  const numero = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero)) return String(valor);
  return `${numero.toFixed(1).replace('.', ',')}`;
}

function parseJsonSeguro(valor, fallback) {
  if (valor === null || valor === undefined || valor === '') return fallback;
  if (Array.isArray(valor) || (typeof valor === 'object' && valor !== null)) return valor;
  try {
    return JSON.parse(valor);
  } catch (error) {
    return fallback;
  }
}

function obterListaJson(valor) {
  const dados = parseJsonSeguro(valor, []);
  return Array.isArray(dados) ? dados.filter(Boolean) : [];
}

function obterAlertas(item) {
  if (Array.isArray(item?.alertas_criticos)) return item.alertas_criticos.filter(Boolean);
  return obterListaJson(item?.alertas_criticos_json);
}

function obterIniciais(nome) {
  const partes = normalizarTexto(nome).split(/\s+/).filter(Boolean);
  if (!partes.length) return 'RH';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0].slice(0, 1)}${partes[partes.length - 1].slice(0, 1)}`.toUpperCase();
}

function formatarDataSomente(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    const texto = String(valor);
    return texto.includes('T') ? texto.slice(0, 10).split('-').reverse().join('/') : texto.slice(0, 10) || '-';
  }
  return data.toLocaleDateString('pt-BR');
}

function formatarDataHoraDetalhe(valor, fallback = '-') {
  if (!valor) return fallback;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor || fallback);
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function obterNotaFinal(prova = {}) {
  return prova.nota_final_prova ?? prova.resultado?.nota_final_prova ?? null;
}

function obterScoreFinal(prova = {}) {
  return prova.score_final ?? prova.score?.score_final ?? null;
}

function obterClasseStatusProva(status) {
  const valor = normalizarBusca(status);
  if (valor.includes('final') || valor.includes('corrigid')) return 'is-finished';
  if (valor.includes('pendente') || valor.includes('manual') || valor.includes('revis')) return 'is-pending';
  if (valor.includes('andamento') || valor.includes('dispon') || valor.includes('gerad') || valor.includes('reabert')) {
    return 'is-progress';
  }
  if (valor.includes('cancel') || valor.includes('expir')) return 'is-cancelled';
  return 'is-neutral';
}

function obterClasseStatusEtapa(status) {
  const valor = normalizarBusca(status);
  if (valor.includes('resultado')) return 'is-final';
  if (valor.includes('corrig') || valor.includes('final')) return 'is-done';
  if (valor.includes('pend')) return 'is-pending';
  if (valor.includes('cancel') || valor.includes('invalid') || valor.includes('interromp')) return 'is-danger';
  return 'is-muted';
}

function obterIconeEtapa(etapa = {}) {
  const texto = normalizarBusca([etapa.label, etapa.key, etapa.categoria].join(' '));
  if (texto.includes('excel') || texto.includes('tabela') || texto.includes('planilha')) return 'table';
  if (texto.includes('word') || texto.includes('redacao') || texto.includes('document')) return 'description';
  if (texto.includes('tecnic') || texto.includes('ti') || texto.includes('sistema')) return 'business_center';
  if (texto.includes('comunic') || texto.includes('atendimento')) return 'forum';
  if (texto.includes('matemat') || texto.includes('racioc')) return 'calculate';
  if (texto.includes('geral') || texto.includes('final')) return 'bar_chart';
  return 'fact_check';
}

function montarAlertasDetalhe(score = {}) {
  return {
    fortes: Array.isArray(score.pontos_fortes)
      ? score.pontos_fortes.filter(Boolean)
      : obterListaJson(score.pontos_fortes_json),
    atencao: Array.isArray(score.pontos_atencao)
      ? score.pontos_atencao.filter(Boolean)
      : obterListaJson(score.pontos_atencao_json),
    criticos: Array.isArray(score.alertas_criticos)
      ? score.alertas_criticos.filter(Boolean)
      : obterListaJson(score.alertas_criticos_json),
  };
}

function montarEtapasResultado(detalhe = {}) {
  const resultado = detalhe.resultado || {};
  const resumoEtapas = obterListaJson(resultado.resumo_etapas_json || detalhe.resumo_etapas_json);
  const etapasConfiguradas = Array.isArray(detalhe.etapas) ? detalhe.etapas : [];
  const etapasBase = resumoEtapas.length ? resumoEtapas : etapasConfiguradas;

  const etapas = etapasBase.map((etapa, indice) => {
    const interrompida = Boolean(etapa.interrupted || etapa.interrompida || etapa.invalidated || etapa.invalidada || etapa.zeroed || etapa.nota_zerada) ||
      normalizarBusca(etapa.status).includes('interromp');
    const rawMax = Number(etapa.rawMax ?? etapa.max ?? 0);
    const rawScore = interrompida ? 0 : Number(etapa.rawScore ?? etapa.score ?? etapa.nota ?? 0);
    const percent = etapa.percent !== undefined && etapa.percent !== null
      ? (interrompida ? 0 : Number(etapa.percent))
      : rawMax
        ? rawScore / rawMax
        : null;
    const temNota = Number.isFinite(percent) && (rawMax > 0 || etapa.score !== undefined || etapa.nota !== undefined);
    const pendencias = Number(etapa.pendings || etapa.pendencias || 0);
    const status = interrompida
      ? 'Etapa interrompida - nota zerada'
      : temNota
        ? pendencias > 0
          ? 'Pendente'
          : 'Corrigido'
        : 'Não avaliado';

    return {
      key: etapa.key || etapa.stageKey || etapa.label || `etapa-${indice}`,
      label: etapa.label || etapa.stage || etapa.categoria || etapa.key || `Etapa ${indice + 1}`,
      status,
      score: temNota ? Math.max(0, Math.min(100, percent * 100)) : null,
      icon: obterIconeEtapa(etapa),
    };
  });

  const notaFinal = obterNotaFinal(detalhe);
  const scoreFinal = obterScoreFinal(detalhe);
  const valorFinal = notaFinal ?? scoreFinal;
  const possuiGeral = etapas.some((etapa) => normalizarBusca(etapa.label).includes('geral'));
  if (valorFinal !== null && valorFinal !== undefined && valorFinal !== '' && !possuiGeral) {
    etapas.push({
      key: 'resultado-final',
      label: 'Geral',
      status: 'Resultado final',
      score: Number(String(valorFinal).replace(',', '.')),
      icon: 'bar_chart',
    });
  }

  return etapas;
}

function descreverResposta(resposta) {
  if (resposta === null || resposta === undefined || resposta === '') return '-';
  if (typeof resposta === 'string' || typeof resposta === 'number' || typeof resposta === 'boolean') {
    return String(resposta);
  }
  if (Array.isArray(resposta)) return resposta.join(', ') || '-';
  if (typeof resposta === 'object') {
    if (resposta.text) return resposta.text;
    if (resposta.filename) return resposta.filename;
    if (resposta.selected !== undefined && resposta.selected !== null) return `Alternativa ${Number(resposta.selected) + 1}`;
    return JSON.stringify(resposta);
  }
  return String(resposta);
}

function BotaoAcaoProva({ icon, label, variant = 'neutral', onClick, disabled = false }) {
  return html`
    <button
      type="button"
      class=${`generated-action-button is-${variant}`}
      onClick=${onClick}
      disabled=${disabled}
      title=${label}
    >
      <span class="material-symbols-outlined">${IconeSvg(icon)}</span>
      <span>${label}</span>
    </button>
  `;
}

function obterRotuloStatusDetalhe(status) {
  const texto = normalizarTexto(status || 'Pendente');
  return texto ? texto.toUpperCase() : 'PENDENTE';
}

function obterPercentualEtapaDetalhe(etapa = {}) {
  if (etapa.score === null || etapa.score === undefined || Number.isNaN(Number(etapa.score))) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(etapa.score)));
}

function obterTomEtapaDetalhe(etapa = {}) {
  const status = normalizarBusca(etapa.status);
  const label = normalizarBusca(etapa.label);
  const percentual = obterPercentualEtapaDetalhe(etapa);
  if (status.includes('pend')) return 'warning';
  if (status.includes('corrig') || percentual >= 70) return 'success';
  if (label.includes('conhecimento') || label.includes('geral')) return 'info';
  if (percentual <= 0) return 'neutral';
  return 'warning';
}

function obterStatusRespostaDetalhe(resposta = {}) {
  if (resposta.correta === true || resposta.correta === 1) {
    return { label: 'Correta', className: 'is-correct' };
  }
  if (resposta.correta === false || resposta.correta === 0) {
    return { label: 'Incorreta', className: 'is-incorrect' };
  }
  return { label: 'Manual', className: 'is-manual' };
}

function obterSubtituloEtapaResposta(resposta = {}) {
  return (
    resposta.stageLabel ||
    resposta.stage_label ||
    resposta.stage ||
    resposta.subcategoria ||
    resposta.tipo_questao ||
    resposta.questionType ||
    ''
  );
}

function montarAnaliseRespostaDetalhe(resposta = {}, questao = {}) {
  if (questao?.type !== 'word') return null;
  const respostaOriginal = resposta.resposta;
  const respostaWord = respostaOriginal && typeof respostaOriginal === 'object'
    ? respostaOriginal
    : { type: 'word', content: String(respostaOriginal || '') };
  const pontos = Number(questao.points || 10);
  const notaBase = avaliarRespostaTexto(respostaWord, questao.expected || {}, pontos);
  return corrigirRespostaDiscursivaInteligente(
    questao,
    {
      ...respostaWord,
      formatacoesAplicadas: obterFormatacoesAplicadas(respostaWord),
    },
    notaBase,
    pontos,
  );
}

function montarLinhasResultadoDetalhe(respostas = [], questoes = []) {
  return respostas.map((resposta, indice) => {
    const questaoIndice = Number(resposta.questao_indice ?? indice);
    const questao = questoes[questaoIndice] || {};
    return {
      id: resposta.id_resposta || resposta.id || `${resposta.categoria || 'questao'}-${indice}`,
      etapa: resposta.categoria || resposta.stageLabel || resposta.stage || 'Questão',
      subtitulo: obterSubtituloEtapaResposta(resposta),
      numero: questaoIndice + 1,
      questao: resposta.texto_questao_snapshot || resposta.enunciado || resposta.questao || '-',
      resposta: descreverResposta(resposta.resposta),
      gabarito: resposta.resposta_correta_payload !== undefined && resposta.resposta_correta_payload !== null
        ? descreverResposta(resposta.resposta_correta_payload)
        : 'Não disponível',
      nota: formatarScore(resposta.nota),
      status: obterStatusRespostaDetalhe(resposta),
      analiseResposta: montarAnaliseRespostaDetalhe(resposta, questao),
    };
  });
}

export function ModalGerarProva({
  aberto,
  contexto = {},
  controlador,
  onClose,
  onGerada,
}) {
  const [formulario, setFormulario] = useState(() => montarFormularioInicial(contexto));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [operacoesCadastradas, setOperacoesCadastradas] = useState([]);
  const candidatosElegiveis = Array.isArray(contexto.candidatosElegiveis)
    ? contexto.candidatosElegiveis
    : [];

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    listarOperacoes()
      .then((itens) => {
        if (!cancelado && Array.isArray(itens)) setOperacoesCadastradas(itens);
      })
      .catch(() => {
        // Mantém OPCOES_OPERACOES_MODAL como fallback silencioso.
      });
    return () => {
      cancelado = true;
    };
  }, [aberto]);

  const opcoesOperacaoModal = useMemo(() => {
    const nomesCadastrados = new Set(
      operacoesCadastradas.map((item) => normalizarTexto(item.nome)).filter(Boolean),
    );
    const extras = OPCOES_OPERACOES_MODAL.filter((nome) => !nomesCadastrados.has(nome));
    return [...operacoesCadastradas.map((item) => normalizarTexto(item.nome)).filter(Boolean), ...extras];
  }, [operacoesCadastradas]);

  useEffect(() => {
    if (!aberto) return;
    setFormulario(montarFormularioInicial(contexto));
    setErro('');
    setResultado(null);
    setSalvando(false);
  }, [aberto, contexto]);

  useEffect(() => {
    if (!formulario.vaga) return;
    setFormulario((anterior) => {
      const proximo = aplicarSugestoesDaVaga(anterior);
      return anterior.nivel === proximo.nivel &&
        anterior.area_prova === proximo.area_prova &&
        anterior.trilha === proximo.trilha
        ? anterior
        : proximo;
    });
  }, [formulario.vaga]);

  const blueprint = useMemo(() => {
    if (!formulario.vaga || !formulario.nivel) return null;
    return resolverBlueprintProva(
      formulario.vaga,
      formulario.nivel,
      resolverTrilhaBlueprint(formulario),
    );
  }, [formulario.vaga, formulario.nivel, formulario.area_prova, formulario.trilha]);
  const questoes = useMemo(
    () => (blueprint ? montarProvaPorBlueprint(blueprint) : []),
    [blueprint],
  );
  const etapas = useMemo(() => montarEtapasBlueprint(blueprint), [blueprint]);
  const categorias = useMemo(() => obterCategoriasDasQuestoes(questoes), [questoes]);
  const competencias = useMemo(() => obterCompetenciasDasQuestoes(questoes), [questoes]);
  const opcoesAreasFormulario = useMemo(
    () => montarOpcoesComValor(OPCOES_AREAS_PROVA, formulario.area_prova),
    [formulario.area_prova],
  );
  const opcoesNivelFormulario = useMemo(() => {
    if (
      !formulario.nivel ||
      OPCOES_NIVEL.some((opcao) => normalizarBusca(opcao.value) === normalizarBusca(formulario.nivel))
    ) {
      return OPCOES_NIVEL;
    }
    return [{ value: formulario.nivel, label: formulario.nivel }, ...OPCOES_NIVEL];
  }, [formulario.nivel]);

  if (!aberto) return null;

  const atualizarCampo = (campo, valor) => {
    setFormulario((anterior) => {
      const proximo = {
        ...anterior,
        [campo]: campo === 'telefone' ? formatarTelefoneBrasileiro(valor) : valor,
        ...(campo === 'area_prova' ? { trilha: normalizarTrilha(valor) } : {}),
      };
      return campo === 'vaga' ? aplicarSugestoesDaVaga(proximo) : proximo;
    });
    setErro('');
  };

  const atualizarDuracaoEtapa = (etapaKey, campo, valor) => {
    setFormulario((anterior) => ({
      ...anterior,
      duracao_etapas: {
        ...anterior.duracao_etapas,
        [etapaKey]: {
          duracao_minutos: 0,
          tolerancia_minutos: 0,
          ...anterior.duracao_etapas?.[etapaKey],
          [campo]: valor,
        },
      },
    }));
  };

  const selecionarCandidato = (identificador) => {
    const candidato = candidatosElegiveis.find(
      (item) => String(item.id_registro || item.id_teste || '') === String(identificador || ''),
    );
    setFormulario(montarFormularioInicial({ ...contexto, candidato: candidato || {} }));
    setErro('');
    setResultado(null);
  };

  const montarDadosPersonalizacao = () => {
    const clientes = montarListaComOutro(
      formulario.clientes_personalizacao,
      formulario.cliente_outro,
    );
    const tiposAtendimento = montarListaComOutro(
      formulario.tipos_atendimento,
      formulario.tipo_atendimento_outro,
    );

    return {
      enabled: Boolean(formulario.personalizacao_inteligente),
      clientes,
      tiposAtendimento,
      operacao: clientes.join(', '),
      tipo_atendimento: tiposAtendimento,
      nivel_personalizacao: formulario.nivel_personalizacao,
      tom_prova: normalizarTexto(formulario.tom_prova),
      situacao_pratica: normalizarTexto(formulario.situacao_pratica_operacao),
      situacao_pratica_operacao: normalizarTexto(formulario.situacao_pratica_operacao),
    };
  };

  const montarConfiguracaoPersonalizacao = () => {
    const trilhaBlueprint = resolverTrilhaBlueprint(formulario);
    const dadosPersonalizacao = montarDadosPersonalizacao();
    return {
      operacao: dadosPersonalizacao.operacao,
      cliente: dadosPersonalizacao.operacao,
      clientesOperacoes: dadosPersonalizacao.clientes,
      vaga: formulario.vaga,
      area: formulario.area_prova,
      trilha: trilhaBlueprint,
      nivelProva: formulario.nivel,
      perfilOperacao: inferirPerfilAtendimentoPersonalizacao({
        clientes: dadosPersonalizacao.clientes,
        tipos: dadosPersonalizacao.tiposAtendimento,
        area: formulario.area_prova,
        vaga: formulario.vaga,
      }) || inferirPerfilOperacao(formulario),
      tiposAtendimento: dadosPersonalizacao.tiposAtendimento,
      nivelPersonalizacao: dadosPersonalizacao.nivel_personalizacao,
      tomProva: formulario.tom_prova,
      situacaoPratica: formulario.situacao_pratica_operacao,
      usuario:
        controlador?.estado?.nomeUsuarioAutenticado ||
        controlador?.estado?.usuarioAutenticado ||
        'RH',
    };
  };

  const gerar = async () => {
    const nome = normalizarTexto(formulario.nome_candidato);
    const email = normalizarTexto(formulario.email);
    const telefone = normalizarTexto(formulario.telefone);

    if (!nome) {
      setErro('Informe o nome completo do candidato.');
      return;
    }
    if (!validarEmail(email)) {
      setErro('Informe um e-mail válido para acesso do candidato.');
      return;
    }
    if (!validarTelefone(telefone)) {
      setErro('Informe um telefone válido para acesso do candidato.');
      return;
    }
    if (!formulario.vaga || !formulario.area_prova || !formulario.nivel || !Number(formulario.tempo_total) || !blueprint || !questoes.length) {
      setErro('Selecione cargo/vaga, área, nível e tempo com uma configuração de prova válida.');
      return;
    }
    const candidatoSelecionado = contexto.candidato || candidatosElegiveis.find(
      (item) => String(item.id_registro || item.id_teste || '') === String(formulario.id_registro || formulario.id_teste || ''),
    );
    if (candidatosElegiveis.length && !candidatoSelecionado) {
      setErro('Selecione o candidato que receberá a prova.');
      return;
    }
    if (!contexto.provaEditar && candidatoSelecionado && !statusPermiteGerarProva(candidatoSelecionado)) {
      setErro('O status atual do candidato não está apto para gerar prova.');
      return;
    }

    const personalizacao = montarDadosPersonalizacao();
    const clientesPersonalizacao = personalizacao.clientes || [];
    const tiposAtendimento = personalizacao.tiposAtendimento || [];

    if (formulario.personalizacao_inteligente) {
      if (!clientesPersonalizacao.length) {
        setErro('Selecione ao menos um Cliente/Operação para personalizar a prova.');
        return;
      }
      if (!tiposAtendimento.length) {
        setErro('Selecione ao menos um tipo de atendimento para personalizar a prova.');
        return;
      }
    }

    const configuracaoPersonalizacao = formulario.personalizacao_inteligente
      ? montarConfiguracaoPersonalizacao()
      : null;
    const resultadoPersonalizacao = formulario.personalizacao_inteligente
      ? gerarPersonalizacaoProva(questoes, configuracaoPersonalizacao)
      : null;
    const questoesPersonalizadas = resultadoPersonalizacao?.questoes?.length
      ? resultadoPersonalizacao.questoes
      : questoes;
    const trilhaBlueprint = resolverTrilhaBlueprint(formulario);
    const operacaoPayload = formulario.personalizacao_inteligente
      ? personalizacao.operacao
      : normalizarTexto(formulario.operacao);

    const etapasComDuracao = etapas.map((etapa) => ({
      ...etapa,
      duracao_minutos: Number(formulario.duracao_etapas?.[etapa.key]?.duracao_minutos) || 0,
      tolerancia_minutos: Number(formulario.duracao_etapas?.[etapa.key]?.tolerancia_minutos) || 0,
    }));

    const payload = {
      candidato_id: formulario.id_teste,
      id_teste: formulario.id_teste,
      id_registro: formulario.id_registro,
      id_entrevista: formulario.id_entrevista,
      id_processo: formulario.id_processo,
      id_processo_ref: formulario.id_processo_ref,
      nome_candidato: nome,
      email,
      telefone,
      whatsapp: telefone,
      cpf: formulario.cpf,
      cargo: formulario.vaga,
      vaga: formulario.vaga,
      area: formulario.area_prova,
      area_prova: formulario.area_prova,
      operacao: operacaoPayload,
      trilha: formulario.area_prova,
      nivel: formulario.nivel,
      tempo_total: Number(formulario.tempo_total || 40),
      tempo_minutos: Number(formulario.tempo_total || 40),
      quantidade_questoes: questoesPersonalizadas.length,
      etapas: etapasComDuracao,
      categorias,
      competencias,
      questoes_snapshot: questoesPersonalizadas,
      personalizacao,
      observacoes_internas_rh: formulario.observacoes_internas_rh,
      tom_prova: formulario.tom_prova,
      situacao_pratica_operacao: formulario.situacao_pratica_operacao,
      expira_em: formulario.expira_em,
      login_method: formulario.personalizacao_inteligente ? formulario.login_method : '',
      configuracao: {
        blueprint_key: blueprint.key || '',
        blueprint_label: blueprint.label || formulario.area_prova || '',
        area_prova: formulario.area_prova,
        area: formulario.area_prova,
        trilha_blueprint: trilhaBlueprint,
        setor_cliente: operacaoPayload,
        operacao: operacaoPayload,
        observacoes_internas_rh: formulario.observacoes_internas_rh,
        personalizacao_inteligente: Boolean(formulario.personalizacao_inteligente),
        personalizacao: formulario.personalizacao_inteligente
          ? {
            ...personalizacao,
            operacao: operacaoPayload,
            setor_cliente: operacaoPayload,
            tom_prova: formulario.tom_prova,
            situacao_pratica_operacao: formulario.situacao_pratica_operacao,
            situacao_pratica: formulario.situacao_pratica_operacao,
            tipos_atendimento: tiposAtendimento,
            perfil_operacao: configuracaoPersonalizacao.perfilOperacao,
            nivel_personalizacao: configuracaoPersonalizacao.nivelPersonalizacao,
            historico: resultadoPersonalizacao.historico,
            alertas: resultadoPersonalizacao.alertas || [],
          }
          : {
            enabled: false,
            opcional: true,
            mensagem: 'Prova padrão gerada sem personalização por operação/cliente.',
          },
        entrevista_obrigatoria: false,
      },
    };

    setSalvando(true);
    setErro('');
    try {
      const resposta = contexto.provaEditar?.id_prova
        ? await atualizarProvaGerada(contexto.provaEditar.id_prova, payload)
        : await criarProvaGerada(payload);
      if (resultadoPersonalizacao?.historico) {
        registrarHistoricoPersonalizacao(resultadoPersonalizacao.historico);
      }
      setResultado(resposta);
      onGerada?.(resposta);
    } catch (error) {
      setErro(error?.message || 'Não foi possível gerar a prova.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo=${contexto.provaEditar ? 'Editar prova' : 'Gerar prova'}
      subtitulo=${contexto.provaEditar ? 'Ajuste os parâmetros antes de o candidato iniciar.' : 'Crie uma prova rastreável para execução exclusiva no Conecta Provas.'}
      className="generated-exam-modal-dialog"
      onClose=${onClose}
    >
      <div class="rh-details-body generated-exam-modal">
        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
        ${resultado
      ? html`
              <div class="alert alert-success">
                ${contexto.provaEditar ? 'Prova atualizada com sucesso.' : 'Prova gerada com sucesso. Código de acesso:'}
                <strong>${resultado.codigo_acesso}</strong>
                ${!contexto.provaEditar ? html`<button
                  type="button"
                  class="btn btn-sm btn-outline-success ms-2"
                  onClick=${() => copiarTexto(resultado.codigo_acesso)}
                >
                  Copiar código
                </button>` : null}
              </div>
            `
      : null}

        <${SectionCard}
          title="Dados do candidato"
          description="Esses dados serão usados para autenticar e confirmar o candidato."
          className="rh-section-card--flat"
        >
          <div class="row g-3">
            ${candidatosElegiveis.length ? html`
              <div class="col-md-12">
                <label class="form-label">Selecionar candidato apto</label>
                <select
                  class="form-select"
                  value=${formulario.id_registro || formulario.id_teste || ''}
                  onChange=${(event) => selecionarCandidato(event.target.value)}
                >
                  <option value="">Selecione o candidato...</option>
                  ${candidatosElegiveis.map((candidato) => html`
                    <option
                      key=${candidato.id_registro || candidato.id_teste}
                      value=${candidato.id_registro || candidato.id_teste}
                    >
                      ${candidato.nome_candidato || '-'} — ${candidato.status_entrevista || candidato.status_fluxo || candidato.status_candidato || '-'}
                    </option>
                  `)}
                </select>
              </div>
            ` : null}
            <div class="col-md-6">
              <label class="form-label">Nome completo</label>
              <input
                class="form-control"
                value=${formulario.nome_candidato}
                onInput=${(event) => atualizarCampo('nome_candidato', event.target.value)}
              />
            </div>
            <div class="col-md-3">
              <label class="form-label">E-mail</label>
              <input
                class="form-control"
                value=${formulario.email}
                onInput=${(event) => atualizarCampo('email', event.target.value)}
              />
            </div>
            <div class="col-md-3">
              <label class="form-label">Telefone</label>
              <input
                class="form-control"
                inputMode="tel"
                value=${formulario.telefone}
                onInput=${(event) => atualizarCampo('telefone', event.target.value)}
              />
            </div>
            <div class="col-md-4">
              <label class="form-label">Processo vinculado</label>
              <input class="form-control" readonly value=${formulario.id_processo_ref || 'Prova avulsa'} />
            </div>
            <div class="col-md-4">
              <label class="form-label">Cargo/Vaga</label>
              <select
                class="form-select"
                value=${formulario.vaga}
                onChange=${(event) => atualizarCampo('vaga', event.target.value)}
              >
                <option value="">Selecione...</option>
                ${OPCOES_VAGAS_PROVA.map(
        (opcao) => html`<option key=${opcao.label} value=${opcao.label}>${opcao.label}</option>`,
      )}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Status do candidato</label>
              <input
                class="form-control"
                readonly
                value=${candidatosElegiveis.find((item) => String(item.id_registro || item.id_teste || '') === String(formulario.id_registro || formulario.id_teste || ''))?.status_entrevista || contexto.candidato?.status_fluxo || contexto.candidato?.status_candidato || contexto.candidato?.status_entrevista || (contexto.provaEditar ? 'Prova não iniciada' : 'Prova avulsa')}
              />
            </div>
          </div>
        </${SectionCard}>

        <${SectionCard}
          title="Configuração da prova"
          description="A geração reutiliza o banco de questões e blueprint já existentes."
          className="rh-section-card--flat"
        >
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">Área</label>
              <select
                class="form-select"
                value=${formulario.area_prova}
                onChange=${(event) => atualizarCampo('area_prova', event.target.value)}
              >
                <option value="">Selecione...</option>
                ${opcoesAreasFormulario.map(
        (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
      )}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Nível</label>
              <select
                class="form-select"
                value=${formulario.nivel}
                onChange=${(event) => atualizarCampo('nivel', event.target.value)}
              >
                <option value="">Selecione...</option>
                ${opcoesNivelFormulario.map(
        (opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`,
      )}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Tempo total</label>
              <input
                class="form-control"
                type="number"
                min="1"
                max="300"
                value=${formulario.tempo_total}
                onInput=${(event) => atualizarCampo('tempo_total', event.target.value)}
              />
            </div>
            <div class="col-md-12">
              <label class="form-label">Observações internas</label>
              <textarea
                class="form-control"
                rows="3"
                value=${formulario.observacoes_internas_rh}
                onInput=${(event) => atualizarCampo('observacoes_internas_rh', event.target.value)}
              ></textarea>
            </div>
          </div>
        </${SectionCard}>

        ${etapas.length
      ? html`
              <${SectionCard}
                title="Duração por etapa"
                description="Opcional. Deixe em 0 para a etapa usar apenas o tempo total da prova, sem limite próprio."
                className="rh-section-card--flat"
              >
                <div class="generated-stage-duration-list">
                  ${etapas.map((etapa) => html`
                    <div class="generated-stage-duration-row" key=${etapa.key}>
                      <span class="generated-stage-duration-label">${etapa.label}</span>
                      <label class="generated-stage-duration-field">
                        <span>Duração (min)</span>
                        <input
                          class="form-control"
                          type="number"
                          min="0"
                          max="300"
                          value=${formulario.duracao_etapas?.[etapa.key]?.duracao_minutos || 0}
                          onInput=${(event) => atualizarDuracaoEtapa(etapa.key, 'duracao_minutos', Number(event.target.value))}
                        />
                      </label>
                      <label class="generated-stage-duration-field">
                        <span>Tolerância (min)</span>
                        <input
                          class="form-control"
                          type="number"
                          min="0"
                          max="60"
                          value=${formulario.duracao_etapas?.[etapa.key]?.tolerancia_minutos || 0}
                          onInput=${(event) => atualizarDuracaoEtapa(etapa.key, 'tolerancia_minutos', Number(event.target.value))}
                        />
                      </label>
                    </div>
                  `)}
                </div>
              </${SectionCard}>
            `
      : null}

        <${SectionCard}
          title="Personalização da prova"
          description="Opcional. A prova padrão será gerada normalmente se esta opção ficar desmarcada."
          className="rh-section-card--flat"
        >
          <label class="form-check generated-personalization-toggle">
            <input
              class="form-check-input"
              type="checkbox"
              checked=${formulario.personalizacao_inteligente}
              onChange=${(event) => {
      const ativa = event.target.checked;
      setFormulario((anterior) => ({
        ...anterior,
        personalizacao_inteligente: ativa,
        ...(!ativa
          ? {
            clientes_personalizacao: [],
            cliente_outro: '',
            tipos_atendimento: [],
            tipo_atendimento_outro: '',
            situacao_pratica_operacao: '',
          }
          : {}),
      }));
      setErro('');
    }}
            />
            <span class="form-check-label fw-semibold">
              Desejo personalizar esta prova por operação/cliente
            </span>
          </label>

          ${formulario.personalizacao_inteligente
      ? html`
                <div class="row g-3 mt-1">
                  <div class="col-md-6">
                    <label class="form-label">Cliente/Operação</label>
                    <select
                      class="form-select"
                      value=${primeiroValorLista(formulario.clientes_personalizacao)}
                      onChange=${(event) =>
          atualizarCampo(
            'clientes_personalizacao',
            event.target.value ? [event.target.value] : [],
          )}
                    >
                      <option value="">Selecione...</option>
                      ${[...opcoesOperacaoModal, OPCAO_OUTRO].map(
            (opcao) => html`
                          <option key=${opcao} value=${opcao}>
                            ${opcao}
                          </option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Tipo de atendimento</label>
                    <select
                      class="form-select"
                      value=${primeiroValorLista(formulario.tipos_atendimento)}
                      onChange=${(event) =>
          atualizarCampo(
            'tipos_atendimento',
            event.target.value ? [event.target.value] : [],
          )}
                    >
                      <option value="">Selecione...</option>
                      ${TIPOS_ATENDIMENTO_PERSONALIZACAO.map(
            (opcao) => html`
                          <option key=${opcao} value=${opcao}>
                            ${opcao}
                          </option>
                        `,
          )}
                    </select>
                  </div>
                  ${formulario.clientes_personalizacao.includes(OPCAO_OUTRO)
          ? html`
                        <div class="col-md-6">
                          <label class="form-label">Outro cliente/operação</label>
                          <input
                            class="form-control"
                            value=${formulario.cliente_outro}
                            onInput=${(event) => atualizarCampo('cliente_outro', event.target.value)}
                          />
                        </div>
                      `
          : null}
                  ${formulario.tipos_atendimento.includes(OPCAO_OUTRO)
          ? html`
                        <div class="col-md-6">
                          <label class="form-label">Outro tipo de atendimento</label>
                          <input
                            class="form-control"
                            value=${formulario.tipo_atendimento_outro}
                            onInput=${(event) => atualizarCampo('tipo_atendimento_outro', event.target.value)}
                          />
                        </div>
                      `
          : null}
                  <div class="col-md-6">
                    <label class="form-label">Nível de personalização</label>
                    <select
                      class="form-select"
                      value=${formulario.nivel_personalizacao}
                      onChange=${(event) => atualizarCampo('nivel_personalizacao', event.target.value)}
                    >
                      ${NIVEIS_PERSONALIZACAO.map(
            (nivel) => html`
                          <option key=${nivel.id} value=${nivel.id}>
                            ${nivel.label}: ${nivel.descricao}
                          </option>
                        `,
          )}
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Tom da prova</label>
                    <select
                      class="form-select"
                      value=${formulario.tom_prova}
                      onChange=${(event) => atualizarCampo('tom_prova', event.target.value)}
                    >
                      ${OPCOES_TOM_PROVA.map(
            (opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`,
          )}
                    </select>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Situação prática da operação</label>
                    <textarea
                      class="form-control"
                      rows="2"
                      placeholder="Ex.: Paciente entra em contato com dúvida sobre agendamento e demonstra preocupação com o tratamento."
                      value=${formulario.situacao_pratica_operacao}
                      onInput=${(event) => atualizarCampo('situacao_pratica_operacao', event.target.value)}
                    ></textarea>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Forma de login no Conecta Prova</label>
                    <select
                      class="form-select"
                      value=${formulario.login_method}
                      onChange=${(event) => atualizarCampo('login_method', event.target.value)}
                    >
                      <option value="">Selecione...</option>
                      ${OPCOES_LOGIN_CONECTA_PROVA.map(
            (opcao) => html`<option key=${opcao.value} value=${opcao.value}>${opcao.label}</option>`,
          )}
                    </select>
                  </div>
                </div>
              `
      : null}
        </${SectionCard}>

        <${SectionCard}
          title="Acesso do candidato"
          description="O link é fixo para todos os candidatos; o código só fica visível para o RH."
          className="rh-section-card--flat"
        >
          <${MetricGrid}
            items=${[
      { label: 'E-mail de acesso', value: formulario.email || '-' },
      { label: 'Telefone de acesso', value: formulario.telefone || '-' },
      { label: 'Código', value: resultado?.codigo_acesso || 'Gerado ao salvar' },
      { label: 'Link fixo', value: LINK_CONECTA_PROVAS },
    ]}
          />
        </${SectionCard}>

        <${SectionCard}
          title="Confirmação"
          description="Revise antes de disponibilizar a prova."
          className="rh-section-card--flat"
        >
          <div class="generated-exam-summary">
            <span><strong>Candidato</strong>${formulario.nome_candidato || '-'}</span>
            <span><strong>Cargo/Vaga</strong>${formulario.vaga || '-'}</span>
            <span><strong>Área</strong>${formulario.area_prova || '-'}</span>
            <span><strong>Processo</strong>${formulario.id_processo_ref || 'Avulsa'}</span>
            <span><strong>Personalização</strong>${formulario.personalizacao_inteligente ? 'Sim' : 'Não'}</span>
            <span><strong>Cliente/Operação</strong>${formulario.personalizacao_inteligente ? montarDadosPersonalizacao().operacao || '-' : formulario.operacao || '-'}</span>
            <span><strong>Nível</strong>${formulario.nivel || '-'}</span>
            <span><strong>Tempo</strong>${`${formulario.tempo_total || 0} min`}</span>
            <span><strong>Tom</strong>${formulario.personalizacao_inteligente ? formulario.tom_prova || '-' : 'Padrão'}</span>
            ${formulario.personalizacao_inteligente
      ? html`<span><strong>Login no Conecta Prova</strong>${OPCOES_LOGIN_CONECTA_PROVA.find((opcao) => opcao.value === formulario.login_method)?.label || 'Não definido'}</span>`
      : null}
            <span><strong>E-mail de acesso</strong>${formulario.email || '-'}</span>
            <span><strong>Telefone de acesso</strong>${formulario.telefone || '-'}</span>
            <span><strong>Etapas</strong>${etapas.map((item) => item.label).join(', ') || '-'}</span>
          </div>
        </${SectionCard}>
      </div>
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${onClose}>
          Cancelar
        </button>
        <button type="button" class="btn btn-primary" disabled=${salvando || !!resultado} onClick=${gerar}>
          ${salvando
      ? contexto.provaEditar ? 'Salvando...' : 'Gerando...'
      : resultado
        ? contexto.provaEditar ? 'Prova atualizada' : 'Prova gerada'
        : contexto.provaEditar ? 'Salvar alterações' : 'Gerar prova'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

function imprimirResultadoProva(detalhe, { etapas, linhasResultado, alertas, notaGeral, scoreConecta, statusProva }) {
  const nome = escaparHtml(detalhe?.nome_candidato || 'Candidato');
  const dataGeracao = escaparHtml(formatarDataHoraDetalhe(new Date().toISOString()));

  const linhasEtapas = etapas.length
    ? etapas.map((etapa) => `
        <tr>
          <td>${escaparHtml(etapa.label)}</td>
          <td>${escaparHtml(etapa.status)}</td>
          <td>${etapa.score === null || etapa.score === undefined ? '-' : `${formatarNotaVisual(etapa.score, 0)}%`}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="3" class="exam-print-empty">Nenhuma etapa avaliada.</td></tr>';

  const montarLista = (itens) => itens.length
    ? `<ul>${itens.map((item) => `<li>${escaparHtml(item)}</li>`).join('')}</ul>`
    : '<p class="exam-print-empty">Nenhum item registrado.</p>';

  const linhasRespostas = linhasResultado.length
    ? linhasResultado.map((linha) => `
        <tr>
          <td>${escaparHtml(linha.etapa)}</td>
          <td>${escaparHtml(linha.questao)}</td>
          <td>${escaparHtml(linha.resposta)}</td>
          <td>${escaparHtml(linha.nota)}</td>
          <td>${escaparHtml(linha.status?.label || '-')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="exam-print-empty">Respostas completas não disponíveis.</td></tr>';

  const janela = window.open('', '_blank');
  if (!janela) {
    throw new Error('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
  }

  const htmlImpressao = `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Resultado da prova - ${nome}</title>
        <style>
          @page { size: A4; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; }
          .toolbar { display: flex; justify-content: flex-end; margin: 0 0 16px; }
          .toolbar button { border: 1px solid #1b5fc1; border-radius: 6px; background: #1b5fc1; color: #fff; padding: 8px 14px; /*font-weight: 700;*/ cursor: pointer; }
          header { border-bottom: 2px solid #1b5fc1; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
          header h1 { margin: 0 0 4px; font-size: 22px; }
          header small { color: #627085; }
          .exam-print-issued { min-width: 140px; text-align: right; }
          h2 { margin: 18px 0 8px; font-size: 15px; color: #1b5fc1; }
          .exam-print-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 18px; margin-bottom: 6px; }
          .exam-print-summary div { border: 1px solid #d8e0ec; border-radius: 6px; padding: 8px; }
          .exam-print-summary span { display: block; font-size: 9px; color: #627085; text-transform: uppercase; letter-spacing: .04em; }
          .exam-print-summary strong { font-size: 13px; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; }
          th, td { border: 1px solid #d8e0ec; padding: 7px; vertical-align: top; text-align: left; font-size: 10px; }
          th { background: #edf3fb; color: #172033; }
          ul { margin: 4px 0 0; padding-left: 18px; }
          .exam-print-empty { padding: 8px; color: #7a869a; }
          .exam-print-section { margin-top: 14px; break-inside: avoid; }
          @media print { .toolbar { display: none; } }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button type="button" onclick="window.print()">Imprimir / salvar PDF</button>
        </div>
        <header>
          <div>
            <h1>Resultado da prova - ${nome}</h1>
            <small>Código: ${escaparHtml(detalhe?.codigo_acesso || '-')} · Status: ${escaparHtml(statusProva || '-')}</small>
          </div>
          <div class="exam-print-issued">
            <strong>Conecta Provas</strong>
            <br /><small>${dataGeracao}</small>
          </div>
        </header>

        <section class="exam-print-section">
          <h2>Resumo</h2>
          <div class="exam-print-summary">
            <div><span>Nota geral</span><strong>${escaparHtml(formatarScore(notaGeral))}</strong></div>
            <div><span>Score Conecta</span><strong>${escaparHtml(formatarScore(scoreConecta))}</strong></div>
            <div><span>Gerada em</span><strong>${escaparHtml(formatarDataHoraDetalhe(detalhe?.gerada_em))}</strong></div>
            <div><span>Iniciada em</span><strong>${escaparHtml(formatarDataHoraDetalhe(detalhe?.iniciada_em, 'Não iniciado'))}</strong></div>
            <div><span>Finalizada em</span><strong>${escaparHtml(formatarDataHoraDetalhe(detalhe?.finalizada_em, 'Não finalizado'))}</strong></div>
          </div>
        </section>

        <section class="exam-print-section">
          <h2>Resultado por etapa</h2>
          <table>
            <thead><tr><th>Etapa</th><th>Status</th><th>Nota</th></tr></thead>
            <tbody>${linhasEtapas}</tbody>
          </table>
        </section>

        <section class="exam-print-section">
          <h2>Pontos fortes</h2>
          ${montarLista(alertas.fortes)}
        </section>

        <section class="exam-print-section">
          <h2>Pontos de atenção</h2>
          ${montarLista(alertas.atencao)}
        </section>

        <section class="exam-print-section">
          <h2>Alertas críticos</h2>
          ${montarLista(alertas.criticos)}
        </section>

        <section class="exam-print-section">
          <h2>Respostas</h2>
          <table>
            <thead><tr><th>Etapa</th><th>Questão</th><th>Resposta</th><th>Nota</th><th>Status</th></tr></thead>
            <tbody>${linhasRespostas}</tbody>
          </table>
        </section>
      </body>
    </html>
  `;

  janela.document.open();
  janela.document.write(htmlImpressao);
  janela.document.close();
}

function ModalDetalheProvaGerada({
  detalhe,
  onClose,
  onCopiarCodigo,
  onRecalcular,
  onAvaliacaoManual,
  onReabrir,
  onCancelar,
  onDecisao,
  onDadosCandidato,
}) {
  // Correções.txt item 13: gabarito e resultado completo ficam ocultos por
  // padrão e só aparecem via a ação correspondente no menu "Ações".
  const [mostrarResultadoCompleto, setMostrarResultadoCompleto] = useState(false);
  const [mostrarGabarito, setMostrarGabarito] = useState(false);
  const [menuAcoesAberto, setMenuAcoesAberto] = useState(false);
  // Redesign 10/set/2026 (ver design/wireframes/README.md, seção 2): o
  // conteúdo deste modal (resumo, alertas, testes complementares, feedback
  // qualitativo, resultado completo) era um scroll único e contínuo — a
  // organização em abas de nível superior é a mudança estrutural em si,
  // sem alterar nenhum handler/estado dos blocos movidos para dentro delas.
  const [abaDetalhe, setAbaDetalhe] = useState('resumo');
  // Correções.txt item 11: DISC/Fit Cultural/Raciocínio em abas dentro do
  // modal de resultado — cada painel avisa via aoCarregar se o candidato
  // possui resultado, e a aba correspondente é desativada quando não possui.
  const [abaTesteComplementar, setAbaTesteComplementar] = useState('disc');
  const [statusTestesComplementares, setStatusTestesComplementares] = useState({
    disc: null,
    fit_cultural: null,
    raciocinio: null,
  });
  useEffect(() => {
    setAbaDetalhe('resumo');
    setAbaTesteComplementar('disc');
    setStatusTestesComplementares({ disc: null, fit_cultural: null, raciocinio: null });
  }, [detalhe?.id_prova]);
  const [replayAberto, setReplayAberto] = useState(false);
  const [replay, setReplay] = useState(null);
  const [carregandoReplay, setCarregandoReplay] = useState(false);
  const [erroReplay, setErroReplay] = useState('');
  const [previewAberto, setPreviewAberto] = useState(false);
  const [sessaoPrevia, setSessaoPrevia] = useState(null);
  const [carregandoPreview, setCarregandoPreview] = useState(false);
  const [erroPreview, setErroPreview] = useState('');
  if (!detalhe) return null;

  const abrirReplay = async () => {
    setReplayAberto(true);
    setErroReplay('');
    if (replay) return;
    setCarregandoReplay(true);
    try {
      const dados = await lerReplayProvaGerada(detalhe.id_prova);
      setReplay(dados);
    } catch (error) {
      setErroReplay(error?.message || 'Não foi possível carregar o replay desta prova.');
    } finally {
      setCarregandoReplay(false);
    }
  };

  const abrirPreview = async () => {
    setPreviewAberto(true);
    setErroPreview('');
    setCarregandoPreview(true);
    try {
      const dados = await lerSessaoPreviaProvaGerada(detalhe.id_prova);
      setSessaoPrevia(dados);
    } catch (error) {
      setErroPreview(error?.message || 'Não foi possível carregar a pré-visualização desta prova.');
    } finally {
      setCarregandoPreview(false);
    }
  };
  const score = detalhe.score || {};
  const resultado = detalhe.resultado || {};
  const alertas = montarAlertasDetalhe(score);
  const etapas = montarEtapasResultado(detalhe);
  const respostas = Array.isArray(detalhe.respostas) ? detalhe.respostas : [];
  const questoes = Array.isArray(detalhe.questoes) ? detalhe.questoes : [];
  const linhasResultado = montarLinhasResultadoDetalhe(respostas, questoes);
  const linhasComAnalise = linhasResultado.filter((linha) => linha.analiseResposta);
  const notaGeral = obterNotaFinal(detalhe) ?? resultado.nota_final_prova;
  const scoreConecta = obterScoreFinal(detalhe) ?? score.score_final;
  const statusProva = detalhe.status || resultado.status || 'Pendente';
  const statusClasse = obterClasseStatusProva(statusProva);
  const possuiRespostas = respostas.length > 0;
  const possuiNota = notaGeral !== null && notaGeral !== undefined && notaGeral !== '';
  const provaCancelada = normalizarBusca(statusProva).includes('cancelad');

  return html`
    <${ModalPadrao}
      aberto=${!!detalhe}
      titulo=${html`
        <span class="generated-detail-title-text">Prova | ${detalhe.nome_candidato || 'Candidato'}</span>
        <span class=${`generated-detail-status-chip ${statusClasse}`}>
          ${obterRotuloStatusDetalhe(statusProva)}
        </span>
      `}
      subtitulo="Detalhes internos do RH. Nada desta tela é exibido ao candidato."
      className="generated-exam-detail-dialog"
      onClose=${onClose}
    >
      <div class="rh-details-body generated-detail-body">
        <${Tabs}
          className="generated-detail-tabs"
          activeKey=${abaDetalhe}
          onChange=${setAbaDetalhe}
          tabs=${[
      { key: 'resumo', label: 'Resumo' },
      { key: 'testes', label: 'Testes complementares' },
      ...(detalhe.feedback_qualitativo ? [{ key: 'qualitativo', label: 'Feedback qualitativo' }] : []),
      { key: 'respostas', label: 'Respostas' },
    ]}
        />

        <${TabPanel} tabKey="resumo" activeKey=${abaDetalhe}>
        <div class="generated-detail-summary-grid">
          ${[
      { icon: 'task_alt', label: 'Status', value: statusProva || '-' },
      { icon: 'tag', label: 'Código', value: detalhe.codigo_acesso || '-' },
      { icon: 'insert_chart', label: 'Nota geral', value: formatarScore(notaGeral) },
      { icon: 'trending_up', label: 'Score Conecta', value: formatarScore(scoreConecta) },
      { icon: 'person_check', label: 'Classificação', value: score.classificacao || detalhe.classificacao || '-' },
      { icon: 'shield', label: 'Confiabilidade', value: score.confiabilidade || detalhe.confiabilidade || '-' },
    ].map(
      (item) => html`
              <article class="generated-detail-summary-card" key=${item.label}>
                <span class="material-symbols-outlined">${IconeSvg(item.icon)}</span>
                <small>${item.label}</small>
                <strong>${item.value}</strong>
              </article>
            `,
    )}
        </div>

        <div class="generated-detail-date-strip">
          ${[
      { icon: 'calendar_month', label: 'Data de geração', value: formatarDataHoraDetalhe(detalhe.gerada_em) },
      { icon: 'play_arrow', label: 'Início', value: formatarDataHoraDetalhe(detalhe.iniciada_em, 'Não iniciado') },
      { icon: 'stop', label: 'Finalização', value: formatarDataHoraDetalhe(detalhe.finalizada_em, 'Não finalizado') },
    ].map(
      (item) => html`
              <div class="generated-detail-date-item" key=${item.label}>
                <span class="material-symbols-outlined">${IconeSvg(item.icon)}</span>
                <span>${item.label}: <strong>${item.value}</strong></span>
              </div>
            `,
    )}
        </div>

        <section class="generated-detail-section">
          <div class="generated-detail-section-title">
            <h3>Resultado da prova por etapa</h3>
          </div>
          ${etapas.length
      ? html`
                <div class="generated-stage-result-grid">
                  ${etapas.map(
        (etapa) => {
          const percentual = obterPercentualEtapaDetalhe(etapa);
          const tom = obterTomEtapaDetalhe(etapa);
          return html`
                      <article class=${`generated-stage-result-card is-${tom}`} key=${etapa.key}>
                        <div class="generated-stage-card-head">
                          <span class="material-symbols-outlined">${IconeSvg(etapa.icon)}</span>
                          <strong>${etapa.label}</strong>
                          <span class=${`generated-stage-status ${obterClasseStatusEtapa(etapa.status)}`}>
                            ${etapa.status}
                          </span>
                        </div>
                        <div class="generated-stage-score-row">
                          <strong class="generated-stage-score">
                          ${etapa.score === null || etapa.score === undefined || Number.isNaN(Number(etapa.score))
              ? '-'
              : formatarScore(etapa.score)}
                          </strong>
                          <small>Score</small>
                        </div>
                        <div class="generated-stage-progress" aria-hidden="true">
                          <span style=${{ width: `${percentual}%` }}></span>
                        </div>
                      </article>
                    `;
        },
      )}
                </div>
              `
      : html`<${EmptyState} title="Sem etapas registradas" text="A prova ainda não possui resultado por etapa salvo." />`}
        </section>

        <section class="generated-detail-section">
          <h3>Alertas e notificações</h3>
          <div class="generated-alert-columns">
            ${[
      { key: 'fortes', icon: 'check_circle', title: 'Pontos fortes', tone: 'success', items: alertas.fortes },
      { key: 'atencao', icon: 'warning', title: 'Pontos de atenção', tone: 'warning', items: alertas.atencao },
      { key: 'criticos', icon: 'error', title: 'Alertas críticos', tone: 'danger', items: alertas.criticos },
    ].map(
      (coluna) => html`
                <div class=${`generated-alert-column is-${coluna.tone}`} key=${coluna.key}>
                  <div class="generated-alert-column-title">
                    <span class="generated-alert-dot"></span>
                    <strong>${coluna.title}</strong>
                  </div>
                  ${coluna.items.length
          ? coluna.items.map(
            (item) => html`
                          <span class="generated-alert-item" key=${item}>
                            ${item}
                          </span>
                        `,
          )
          : html`<span class="generated-alert-empty">Nenhum ponto registrado.</span>`}
                </div>
              `,
    )}
          </div>
        </section>
        </${TabPanel}>

        <${TabPanel} tabKey="testes" activeKey=${abaDetalhe}>
        <section class="generated-detail-section generated-complementary-tests">
          <h3>Análise do candidato</h3>
          <div class="generated-complementary-tabs" role="tablist">
            ${[
      { key: 'disc', label: 'Teste DISC' },
      { key: 'fit_cultural', label: 'Fit Cultural' },
      { key: 'raciocinio', label: 'Raciocínio Lógico e Numérico' },
    ].map((aba) => {
      const status = statusTestesComplementares[aba.key];
      const desativada = status === false;
      return html`
                <button
                  type="button"
                  role="tab"
                  key=${aba.key}
                  class=${`generated-complementary-tab ${abaTesteComplementar === aba.key ? 'is-active' : ''} ${desativada ? 'is-empty' : ''}`}
                  aria-selected=${abaTesteComplementar === aba.key}
                  title=${desativada ? 'Candidato não realizou este teste' : aba.label}
                  onClick=${() => setAbaTesteComplementar(aba.key)}
                >
                  ${aba.label}
                </button>
              `;
    })}
          </div>
          <div class="generated-complementary-panel" hidden=${abaTesteComplementar !== 'disc'}>
            <${PainelResultadoDisc}
              idTeste=${detalhe.id_teste}
              aoCarregar=${(status) => setStatusTestesComplementares((valor) => ({ ...valor, disc: status.possuiResultado }))}
            />
          </div>
          <div class="generated-complementary-panel" hidden=${abaTesteComplementar !== 'fit_cultural'}>
            <${PainelResultadoFitCultural}
              candidatoProcessoId=${detalhe.id_registro}
              aoCarregar=${(status) => setStatusTestesComplementares((valor) => ({ ...valor, fit_cultural: status.possuiResultado }))}
            />
          </div>
          <div class="generated-complementary-panel" hidden=${abaTesteComplementar !== 'raciocinio'}>
            <${PainelResultadoRaciocinio}
              idTeste=${detalhe.id_teste}
              aoCarregar=${(status) => setStatusTestesComplementares((valor) => ({ ...valor, raciocinio: status.possuiResultado }))}
            />
          </div>
        </section>
        </${TabPanel}>

        <${TabPanel} tabKey="qualitativo" activeKey=${abaDetalhe}>
        ${detalhe.feedback_qualitativo
      ? html`
              <section class="generated-detail-section generated-qualitative-feedback">
                <h3>Feedback qualitativo automático</h3>
                <p class="generated-qualitative-summary">
                  ${detalhe.feedback_qualitativo.resumo_textual || 'Sem resumo qualitativo disponível.'}
                </p>
                ${(detalhe.feedback_qualitativo.questoes_erradas || []).length
          ? html`
                      <div class="generated-qualitative-list">
                        ${detalhe.feedback_qualitativo.questoes_erradas.map(
            (item) => html`
                            <div class="generated-qualitative-item" key=${`fb-${item.questao_indice}-${item.questao_id ?? ''}`}>
                              <span class="generated-qualitative-item-title">
                                Questão ${Number(item.questao_indice ?? 0) + 1} — ${item.categoria}
                                ${item.dificuldade ? html`<small>${item.dificuldade}</small>` : null}
                              </span>
                              <p>${item.feedback_qualitativo}</p>
                            </div>
                          `,
          )}
                      </div>
                    `
          : html`<p class="text-muted">Nenhuma questão errada com feedback registrado.</p>`}
              </section>
            `
      : null}
        </${TabPanel}>

        <${TabPanel} tabKey="respostas" activeKey=${abaDetalhe}>
        ${!mostrarResultadoCompleto
      ? html`
              <${EmptyState}
                title="Resultado completo oculto"
                text="Use Ações → Ver resultado completo para exibir as respostas, notas e gabarito desta prova."
              />
            `
      : null}
        ${mostrarResultadoCompleto
      ? html`
              <section class="generated-detail-section generated-full-result">
                <div class="generated-detail-section-title">
                  <h3>Resultado completo</h3>
                </div>
                ${linhasResultado.length
          ? html`
                  <div class="generated-result-table-shell">
                    <table class="generated-result-table">
                      <thead>
                        <tr>
                          <th># & Etapa</th>
                          <th>Questão</th>
                          ${possuiRespostas ? html`<th>Resposta</th>` : null}
                          ${mostrarGabarito ? html`<th>Gabarito</th>` : null}
                          <th>Nota</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${linhasResultado.map(
            (linha) => html`
                            <tr key=${linha.id}>
                              <td>
                                <strong>${linha.numero}. ${linha.etapa}</strong>
                                ${linha.subtitulo ? html`<small>${linha.subtitulo}</small>` : null}
                              </td>
                              <td>${linha.questao}</td>
                              ${possuiRespostas ? html`<td>${linha.resposta}</td>` : null}
                              ${mostrarGabarito ? html`<td>${linha.gabarito}</td>` : null}
                              <td><strong>${linha.nota}</strong></td>
                              <td>
                                <span class=${`generated-answer-status ${linha.status.className}`}>
                                  ${linha.status.label}
                                </span>
                              </td>
                            </tr>
                          `,
          )}
                      </tbody>
                    </table>
                  </div>
                  ${linhasComAnalise.length
              ? html`
                        <div class="generated-answer-list">
                          ${linhasComAnalise.map((linha) => {
                const analise = linha.analiseResposta;
                const dados = analise.dados_analisados || {};
                return html`
                              <article class="generated-answer-card" key=${`analise-${linha.id}`}>
                                <div>
                                  <strong>Análise de Resposta — questão ${linha.numero}</strong>
                                  <p>${analise.justificativa_nota}</p>
                                </div>
                                <dl>
                                  <div>
                                    <dt>Nota sugerida</dt>
                                    <dd>${analise.nota_sugerida}/${analise.nota_maxima}</dd>
                                  </div>
                                  <div>
                                    <dt>Pontos positivos</dt>
                                    <dd>${(analise.pontos_positivos || []).join(' ') || 'Nenhum ponto automático registrado.'}</dd>
                                  </div>
                                  <div>
                                    <dt>Pontos de atenção</dt>
                                    <dd>${(analise.pontos_atencao || []).join(' ') || 'Nenhum ponto automático registrado.'}</dd>
                                  </div>
                                  ${dados.o_que_deve_ser_avaliado
                    ? html`
                                        <div>
                                          <dt>O que deve ser avaliado</dt>
                                          <dd>${dados.o_que_deve_ser_avaliado}</dd>
                                        </div>
                                      `
                    : null}
                                  ${dados.rubrica_interna
                    ? html`
                                        <div>
                                          <dt>Rubrica interna</dt>
                                          <dd>${dados.rubrica_interna}</dd>
                                        </div>
                                      `
                    : null}
                                </dl>
                              </article>
                            `;
              })}
                        </div>
                      `
              : null}
                `
          : html`
                  <div class="generated-full-result-fallback">
                    <p>As respostas completas ainda não estão salvas para esta prova.</p>
                  </div>
                `}
              </section>
            `
      : null}
        </${TabPanel}>
      </div>
      <footer class="rh-modal-footer generated-detail-footer">
        <${BotaoAcaoProva} icon="close" label="Fechar" variant="neutral" onClick=${onClose} />
        <div class="generated-actions-menu">
          <${BotaoAcaoProva}
            icon="more_horiz"
            label="Ações"
            variant="solid"
            onClick=${() => setMenuAcoesAberto((aberto) => !aberto)}
          />
          ${menuAcoesAberto
      ? html`
                <div class="generated-actions-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          onCopiarCodigo?.();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('content_copy')}</span>
                    Copiar Código
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          try {
            imprimirResultadoProva(detalhe, { etapas, linhasResultado, alertas, notaGeral, scoreConecta, statusProva });
          } catch (error) {
            window.alert(error?.message || 'Não foi possível gerar o PDF do resultado.');
          }
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('picture_as_pdf')}</span>
                    Exportar PDF
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          abrirReplay();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('history')}</span>
                    Ver replay
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          abrirPreview();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('visibility')}</span>
                    Pré-visualizar
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          onAvaliacaoManual?.();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('menu_book')}</span>
                    Inserir Manualmente
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          setMostrarResultadoCompleto((valor) => !valor);
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('checklist')}</span>
                    ${mostrarResultadoCompleto ? 'Ocultar resultado completo' : 'Ver resultado completo'}
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          setMostrarGabarito((valor) => !valor);
          setMostrarResultadoCompleto(true);
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('fact_check')}</span>
                    ${mostrarGabarito ? 'Ocultar gabarito' : 'Ver gabarito'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled=${!possuiNota}
                    onClick=${() => {
          setMenuAcoesAberto(false);
          onRecalcular?.();
        }}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('sync')}</span>
                    Recalcular Score
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          (provaCancelada ? onReabrir : onCancelar)?.();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg(provaCancelada ? 'history' : 'delete')}</span>
                    ${provaCancelada ? 'Reabrir Prova' : 'Cancelar'}
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          onDecisao?.();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('person_add')}</span>
                    Decisão RH
                  </button>
                  <button type="button" role="menuitem" onClick=${() => {
          setMenuAcoesAberto(false);
          onDadosCandidato?.();
        }}>
                    <span class="material-symbols-outlined">${IconeSvg('badge')}</span>
                    Dados Candidato
                  </button>
                </div>
              `
      : null}
        </div>
      </footer>
    </${ModalPadrao}>

    ${replayAberto
      ? html`
            <${ModalPadrao}
              aberto=${true}
              titulo="Replay da prova"
              subtitulo=${`Linha do tempo de ${detalhe.nome_candidato || 'candidato'} respondendo esta prova.`}
              className="generated-replay-dialog"
              onClose=${() => setReplayAberto(false)}
            >
              <div class="rh-details-body">
                ${carregandoReplay
          ? html`<${LoadingState} titulo="Carregando replay" descricao="Reconstruindo a jornada do candidato nesta prova." />`
          : erroReplay
            ? html`<div class="alert alert-warning">${erroReplay}</div>`
            : replay?.eventos?.length
              ? html`
                    <div class="generated-detail-summary-grid">
                      <article class="generated-detail-summary-card">
                        <span class="material-symbols-outlined">${IconeSvg('timer')}</span>
                        <small>Tempo ativo total</small>
                        <strong>${formatarTempoRestante(replay.resumo?.tempo_ativo_total_segundos || 0)}</strong>
                      </article>
                      <article class="generated-detail-summary-card">
                        <span class="material-symbols-outlined">${IconeSvg('visibility')}</span>
                        <small>Questões visitadas</small>
                        <strong>${replay.resumo?.questoes_visitadas ?? 0} de ${replay.resumo?.total_questoes ?? 0}</strong>
                      </article>
                    </div>
                    <div class="generated-replay-list">
                      ${replay.eventos.map((evento, indice) => html`
                        <article key=${`${evento.tipo}-${indice}`}>
                          <span class="generated-replay-icon">
                            <i class="material-symbols-outlined">${IconeSvg(evento.tipo === 'etapa_iniciada' ? 'play_circle'
                : evento.tipo === 'etapa_finalizada' ? 'flag'
                  : evento.tipo === 'questao_respondida' ? 'edit'
                    : 'visibility')}</i>
                          </span>
                          <div>
                            <strong>${evento.titulo}</strong>
                            ${evento.descricao ? html`<p>${evento.descricao}</p>` : null}
                            <small>${formatarDataHoraDetalhe(evento.data)}</small>
                          </div>
                        </article>
                      `)}
                    </div>
                  `
              : html`<p class="text-muted">Sem telemetria registrada para esta prova ainda.</p>`}
              </div>
            </${ModalPadrao}>
          `
      : null}

    ${previewAberto
      ? html`
            <div class="generated-preview-overlay">
              ${carregandoPreview
          ? html`<${LoadingState} titulo="Carregando pré-visualização" descricao="Montando a prova como o candidato vê." />`
          : erroPreview
            ? html`
                  <div class="generated-preview-overlay-erro">
                    <div class="alert alert-warning">${erroPreview}</div>
                    <button type="button" class="btn btn-outline-secondary" onClick=${() => setPreviewAberto(false)}>
                      Fechar
                    </button>
                  </div>
                `
            : sessaoPrevia
              ? html`
                    <${TelaConectaProvas}
                      modoPreview=${true}
                      sessaoInicial=${sessaoPrevia}
                      onFecharPreview=${() => setPreviewAberto(false)}
                    />
                  `
              : null}
            </div>
          `
      : null}
  `;
}

function ModalAvaliacaoManual({ prova, onClose, onSave }) {
  const [formulario, setFormulario] = useState({
    nota_redacao: '',
    nota_excel: '',
    nota_tecnica: '',
    nota_comunicacao: '',
    nota_lgpd: '',
    observacao: '',
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!prova) return;
    setFormulario({
      nota_redacao: prova.nota_redacao ?? '',
      nota_excel: prova.nota_excel ?? '',
      nota_tecnica: prova.nota_tecnica ?? '',
      nota_comunicacao: prova.nota_comunicacao ?? '',
      nota_lgpd: prova.nota_lgpd ?? '',
      observacao: '',
    });
    setErro('');
  }, [prova]);

  if (!prova) return null;

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      await onSave({
        ...formulario,
        nota_redacao: formulario.nota_redacao === '' ? null : Number(formulario.nota_redacao),
        nota_excel: formulario.nota_excel === '' ? null : Number(formulario.nota_excel),
        nota_tecnica: formulario.nota_tecnica === '' ? null : Number(formulario.nota_tecnica),
        nota_comunicacao: formulario.nota_comunicacao === '' ? null : Number(formulario.nota_comunicacao),
        nota_lgpd: formulario.nota_lgpd === '' ? null : Number(formulario.nota_lgpd),
      });
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar a avaliação manual.');
    } finally {
      setSalvando(false);
    }
  };

  const campoNota = (campo, label) => html`
    <div class="col-md-4">
      <label class="form-label">${label}</label>
      <input
        class="form-control"
        type="number"
        min="0"
        max="100"
        value=${formulario[campo]}
        onInput=${(event) => setFormulario({ ...formulario, [campo]: event.target.value })}
      />
    </div>
  `;

  return html`
    <${ModalPadrao}
      aberto=${!!prova}
      titulo="Avaliação manual"
      subtitulo="Notas manuais liberam o Score quando houver redação, Excel ou etapa subjetiva."
      onClose=${onClose}
    >
      <div class="rh-details-body">
        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
        <div class="row g-3">
          ${campoNota('nota_redacao', 'Redação')}
          ${campoNota('nota_excel', 'Excel')}
          ${campoNota('nota_tecnica', 'Técnica')}
          ${campoNota('nota_comunicacao', 'Comunicação')}
          ${campoNota('nota_lgpd', 'LGPD')}
          <div class="col-md-12">
            <label class="form-label">Observação</label>
            <textarea
              class="form-control"
              rows="4"
              value=${formulario.observacao}
              onInput=${(event) => setFormulario({ ...formulario, observacao: event.target.value })}
            ></textarea>
          </div>
        </div>
      </div>
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${onClose}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${salvar}>
          ${salvando ? 'Salvando...' : 'Salvar avaliação'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

function ModalDecisaoRh({ prova, onClose, onSave }) {
  const [formulario, setFormulario] = useState({
    decisao: 'Pendente',
    justificativa: '',
    observacao: '',
    score_considerado: true,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!prova) return;
    setFormulario({
      decisao: 'Pendente',
      justificativa: '',
      observacao: '',
      score_considerado: true,
    });
    setErro('');
  }, [prova]);

  if (!prova) return null;

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      await onSave(formulario);
    } catch (error) {
      setErro(error?.message || 'Não foi possível registrar a decisão.');
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${ModalPadrao}
      aberto=${!!prova}
      titulo="Decisão final do RH"
      subtitulo="O Score é apoio analítico; a decisão final continua manual."
      onClose=${onClose}
    >
      <div class="rh-details-body">
        ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Decisão</label>
            <select
              class="form-select"
              value=${formulario.decisao}
              onChange=${(event) => setFormulario({ ...formulario, decisao: event.target.value })}
            >
              ${DECISOES_RH.map((item) => html`<option key=${item} value=${item}>${item}</option>`)}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-check mt-4">
              <input
                class="form-check-input"
                type="checkbox"
                checked=${formulario.score_considerado}
                onChange=${(event) => setFormulario({ ...formulario, score_considerado: event.target.checked })}
              />
              <span class="form-check-label">Score considerado na análise</span>
            </label>
          </div>
          <div class="col-md-12">
            <label class="form-label">Justificativa</label>
            <textarea
              class="form-control"
              rows="3"
              value=${formulario.justificativa}
              onInput=${(event) => setFormulario({ ...formulario, justificativa: event.target.value })}
            ></textarea>
          </div>
          <div class="col-md-12">
            <label class="form-label">Observação</label>
            <textarea
              class="form-control"
              rows="3"
              value=${formulario.observacao}
              onInput=${(event) => setFormulario({ ...formulario, observacao: event.target.value })}
            ></textarea>
          </div>
        </div>
      </div>
      <footer class="rh-modal-footer">
        <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${onClose}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${salvar}>
          ${salvando ? 'Registrando...' : 'Registrar decisão'}
        </button>
      </footer>
    </${ModalPadrao}>
  `;
}

export function TelaProvasResultados({ controlador }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [provas, setProvas] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [filtros, setFiltros] = useState({
    candidato: '',
    vaga: '',
    operacao: '',
    trilha: '',
    competencia: '',
    status: '',
    resultado: '',
    notaMinima: '',
    notaMaxima: '',
    dataGeracao: '',
  });
  const [modalGerarAberto, setModalGerarAberto] = useState(false);
  const [modalHeatmapAberto, setModalHeatmapAberto] = useState(false);
  const [heatmapTrilha, setHeatmapTrilha] = useState('');
  const [heatmap, setHeatmap] = useState(null);
  const [carregandoHeatmap, setCarregandoHeatmap] = useState(false);
  const [erroHeatmap, setErroHeatmap] = useState('');
  const [detalhe, setDetalhe] = useState(null);
  const [avaliacaoManual, setAvaliacaoManual] = useState(null);
  const [decisaoRh, setDecisaoRh] = useState(null);
  const [acaoSensivel, setAcaoSensivel] = useState(null);
  const [salvandoAcaoSensivel, setSalvandoAcaoSensivel] = useState(false);
  const [erroAcaoSensivel, setErroAcaoSensivel] = useState('');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarProvasGeradas();
      setProvas(Array.isArray(lista) ? lista : []);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar as provas geradas.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const carregarHeatmap = async (trilha = heatmapTrilha) => {
    setCarregandoHeatmap(true);
    setErroHeatmap('');
    try {
      const dados = await lerHeatmapQuestoes(trilha);
      setHeatmap(dados);
    } catch (error) {
      setErroHeatmap(error?.message || 'Não foi possível carregar o heatmap de questões.');
    } finally {
      setCarregandoHeatmap(false);
    }
  };

  const abrirHeatmap = () => {
    setModalHeatmapAberto(true);
    carregarHeatmap(heatmapTrilha);
  };

  useEffect(() => {
    try {
      if (sessionStorage.getItem(CHAVE_ABRIR_MODAL_GERAR_PROVA) !== '1') {
        return;
      }
      sessionStorage.removeItem(CHAVE_ABRIR_MODAL_GERAR_PROVA);
      setModalGerarAberto(true);
    } catch (error) {
      // Fluxo manual segue disponivel se sessionStorage estiver bloqueado.
    }
  }, []);

  const provasFiltradas = useMemo(() => {
    const candidato = normalizarBusca(filtros.candidato);
    const vaga = normalizarBusca(filtros.vaga);
    const operacao = normalizarBusca(filtros.operacao);
    const trilha = normalizarBusca(filtros.trilha);
    const competencia = normalizarBusca(filtros.competencia);
    const status = normalizarBusca(filtros.status);
    const resultado = normalizarBusca(filtros.resultado);
    const notaMinima = filtros.notaMinima === '' ? null : Number(filtros.notaMinima);
    const notaMaxima = filtros.notaMaxima === '' ? null : Number(filtros.notaMaxima);
    return provas.filter((item) => {
      const textoCandidato = normalizarBusca([
        item.nome_candidato,
        item.email_acesso,
        item.vaga,
        item.operacao,
        item.trilha,
        item.telefone_acesso,
        item.codigo_acesso,
      ].join(' '));
      const textoVaga = normalizarBusca(item.vaga);
      const textoOperacao = normalizarBusca(item.operacao);
      const textoTrilha = normalizarBusca(item.trilha);
      const competenciasItem = (Array.isArray(item.competencias) ? item.competencias : []).map(normalizarBusca);
      const textoStatus = normalizarBusca(item.status);
      const dataBase = String(item.gerada_em || '').slice(0, 10);
      const notaFinal = obterNotaFinal(item);
      const alertas = obterAlertas(item);
      if (candidato && !textoCandidato.includes(candidato)) return false;
      if (vaga && !textoVaga.includes(vaga)) return false;
      if (operacao && textoOperacao !== operacao) return false;
      if (trilha && textoTrilha !== trilha) return false;
      if (competencia && !competenciasItem.includes(competencia)) return false;
      if (status && textoStatus !== status) return false;
      if (resultado === 'com_nota' && (notaFinal === null || notaFinal === undefined || notaFinal === '')) return false;
      if (resultado === 'sem_nota' && !(notaFinal === null || notaFinal === undefined || notaFinal === '')) return false;
      if (resultado === 'com_alertas' && !alertas.length) return false;
      if (resultado === 'sem_alertas' && alertas.length) return false;
      if (resultado === 'pendente_avaliacao' && !item.pendente_avaliacao_manual && !textoStatus.includes('pendente')) return false;
      if (notaMinima !== null || notaMaxima !== null) {
        const notaFinalNumerica = notaFinal === null || notaFinal === undefined || notaFinal === ''
          ? null
          : Number(String(notaFinal).replace(',', '.'));
        if (notaFinalNumerica === null || !Number.isFinite(notaFinalNumerica)) return false;
        if (notaMinima !== null && notaFinalNumerica < notaMinima) return false;
        if (notaMaxima !== null && notaFinalNumerica > notaMaxima) return false;
      }
      if (filtros.dataGeracao && dataBase !== filtros.dataGeracao) return false;
      return true;
    });
  }, [provas, filtros]);

  useEffect(() => {
    setPagina(1);
  }, [filtros]);

  const provasPaginadas = useMemo(
    () => obterItensPaginados(provasFiltradas, pagina, 10),
    [pagina, provasFiltradas],
  );

  const resumo = useMemo(() => {
    const finalizadas = provas.filter((item) => item.status === 'Finalizada' || item.status === 'Corrigida').length;
    const pendentes = provas.filter((item) => item.pendente_avaliacao_manual).length;
    const mediaScore = provas
      .map((item) => Number(item.score_final))
      .filter((valor) => Number.isFinite(valor));
    return {
      total: provas.length,
      finalizadas,
      pendentes,
      mediaScore: mediaScore.length
        ? mediaScore.reduce((soma, valor) => soma + valor, 0) / mediaScore.length
        : null,
    };
  }, [provas]);

  const abrirDetalhe = async (idProva) => {
    try {
      setErro('');
      const dados = await lerProvaGerada(idProva);
      setDetalhe(dados);
    } catch (error) {
      setErro(error?.message || 'Não foi possível abrir os detalhes da prova.');
    }
  };

  const copiarCodigo = async (prova = detalhe) => {
    await copiarTexto(prova?.codigo_acesso || '');
    setMensagem('Código copiado.');
  };

  const executarRecalculo = async (prova = detalhe) => {
    if (!prova?.id_prova) return;
    try {
      await recalcularScoreProva(prova.id_prova);
      setMensagem('Score recalculado.');
      await carregar();
      const atualizado = await lerProvaGerada(prova.id_prova);
      setDetalhe(atualizado);
    } catch (error) {
      setErro(error?.message || 'Não foi possível recalcular o Score.');
    }
  };

  const imprimirProvaDaLinha = async (prova) => {
    if (!prova?.id_prova) return;
    try {
      setErro('');
      const dados = await lerProvaGerada(prova.id_prova);
      const score = dados.score || {};
      const resultado = dados.resultado || {};
      const alertas = montarAlertasDetalhe(score);
      const etapas = montarEtapasResultado(dados);
      const respostas = Array.isArray(dados.respostas) ? dados.respostas : [];
      const questoes = Array.isArray(dados.questoes) ? dados.questoes : [];
      const linhasResultado = montarLinhasResultadoDetalhe(respostas, questoes);
      const notaGeral = obterNotaFinal(dados) ?? resultado.nota_final_prova;
      const scoreConecta = obterScoreFinal(dados) ?? score.score_final;
      const statusProva = dados.status || resultado.status || 'Pendente';
      imprimirResultadoProva(dados, { etapas, linhasResultado, alertas, notaGeral, scoreConecta, statusProva });
    } catch (error) {
      setErro(error?.message || 'Não foi possível imprimir esta prova.');
    }
  };

  const executarCancelamento = async (prova) => {
    if (!prova?.id_prova) return;
    setErroAcaoSensivel('');
    setAcaoSensivel({ tipo: 'cancelar', prova });
  };

  const confirmarCancelamento = async (prova, motivo) => {
    try {
      setSalvandoAcaoSensivel(true);
      await cancelarProvaGerada(prova.id_prova, { motivo });
      setMensagem('Prova cancelada.');
      await carregar();
      if (detalhe?.id_prova === prova.id_prova) {
        setDetalhe(await lerProvaGerada(prova.id_prova));
      }
      setSalvandoAcaoSensivel(false);
      setAcaoSensivel(null);
    } catch (error) {
      setErro(error?.message || 'Não foi possível cancelar a prova.');
    }
  };

  const executarReabertura = async (prova) => {
    if (!prova?.id_prova) return;
    setErroAcaoSensivel('');
    setAcaoSensivel({ tipo: 'reabrir', prova });
  };

  const confirmarReabertura = async (prova, motivo) => {
    try {
      setSalvandoAcaoSensivel(true);
      await reabrirProvaGerada(prova.id_prova, {
        motivo,
        manter_respostas: true,
      });
      setMensagem('Prova reaberta.');
      await carregar();
      if (detalhe?.id_prova === prova.id_prova) {
        setDetalhe(await lerProvaGerada(prova.id_prova));
      }
      setSalvandoAcaoSensivel(false);
      setAcaoSensivel(null);
    } catch (error) {
      setSalvandoAcaoSensivel(false);
      setSalvandoAcaoSensivel(false);
      setErro(error?.message || 'Não foi possível reabrir a prova.');
    }
  };

  const salvarManual = async (payload) => {
    await salvarAvaliacaoManualProva(avaliacaoManual.id_prova, payload);
    setAvaliacaoManual(null);
    setMensagem('Avaliação manual salva.');
    await carregar();
    if (detalhe?.id_prova === avaliacaoManual.id_prova) {
      setDetalhe(await lerProvaGerada(avaliacaoManual.id_prova));
    }
  };

  const salvarDecisao = async (payload) => {
    await registrarDecisaoRhProva(decisaoRh.id_prova, payload);
    setDecisaoRh(null);
    setMensagem('Decisão final registrada.');
    await carregar();
    if (detalhe?.id_prova === decisaoRh.id_prova) {
      setDetalhe(await lerProvaGerada(decisaoRh.id_prova));
    }
  };

  const statusDisponiveis = Array.from(new Set(provas.map((item) => item.status).filter(Boolean)));
  const vagasDisponiveis = Array.from(new Set(provas.map((item) => item.vaga).filter(Boolean)));
  const operacoesDisponiveis = Array.from(new Set(provas.map((item) => item.operacao).filter(Boolean)));
  const trilhasDisponiveis = Array.from(new Set(provas.map((item) => item.trilha).filter(Boolean)));
  const competenciasDisponiveis = Array.from(
    new Set(provas.flatMap((item) => (Array.isArray(item.competencias) ? item.competencias : [])).filter(Boolean)),
  );
  const atualizarFiltro = (campo, valor) =>
    setFiltros((anteriores) => ({
      ...anteriores,
      [campo]: valor,
    }));
  const limparFiltros = () =>
    setFiltros({
      candidato: '',
      vaga: '',
      operacao: '',
      trilha: '',
      competencia: '',
      status: '',
      resultado: '',
      notaMinima: '',
      notaMaxima: '',
      dataGeracao: '',
    });

  return html`
    <${PainelRh}
      screenId="screen-generated-exams"
      navAtiva="screen-generated-exams"
      subtituloMarca="Provas e Resultados"
      placeholderBusca="Buscar provas, candidatos e códigos"
      controlador=${controlador}
      acaoPrimaria=${{
      label: 'Gerar prova',
      icon: 'assignment_add',
      permissoes: ['provas.criar', 'provas.enviar'],
      onClick: () => setModalGerarAberto(true),
    }}
    >
      <${PageIntro}
        kicker="CONECTA PROVAS > SCORE CONECTA"
        title="Provas e resultados"
        description="Acompanhe o andamento, correções e resultados das provas."
        actions=${html`
          <button type="button" class="btn btn-outline-secondary rh-action-btn" onClick=${abrirHeatmap}>
            <span class="material-symbols-outlined">${IconeSvg('grid_view')}</span>
            Heatmap de questões
          </button>
        `}
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
      ${mensagem ? html`<div class="alert alert-success">${mensagem}</div>` : null}

      <${MetricGrid}
        items=${[
      { label: 'Provas geradas', value: resumo.total, icon: 'assignment' },
      { label: 'Finalizadas', value: resumo.finalizadas, icon: 'task_alt' },
      { label: 'Pendências manuais', value: resumo.pendentes, icon: 'rate_review' },
      { label: 'Score médio', value: resumo.mediaScore === null ? '-' : formatarNotaVisual(resumo.mediaScore, 1), icon: 'trending_up' },
    ]}
      />

      <${SectionCard}
        title="Lista de provas"
        description=""
        className="generated-exams-list-card"
      >
        <div class="generated-exams-filters generated-exams-filters-wide">
          <label class="generated-filter-field generated-filter-search">
            <span class="material-symbols-outlined">${IconeSvg('person_search')}</span>
            <input
              class="form-control"
              placeholder="Candidato, e-mail ou código"
              value=${filtros.candidato}
              onInput=${(event) => atualizarFiltro('candidato', event.target.value)}
            />
          </label>
          <select
            class="form-select"
            value=${filtros.vaga}
            onChange=${(event) => atualizarFiltro('vaga', event.target.value)}
          >
            <option value="">Todas as vagas</option>
            ${vagasDisponiveis.map((vaga) => html`<option key=${vaga} value=${vaga}>${vaga}</option>`)}
          </select>
          <select
            class="form-select"
            value=${filtros.operacao}
            onChange=${(event) => atualizarFiltro('operacao', event.target.value)}
          >
            <option value="">Todas as operações</option>
            ${operacoesDisponiveis.map((operacao) => html`<option key=${operacao} value=${operacao}>${operacao}</option>`)}
          </select>
          <select
            class="form-select"
            value=${filtros.trilha}
            onChange=${(event) => atualizarFiltro('trilha', event.target.value)}
          >
            <option value="">Todas as trilhas</option>
            ${trilhasDisponiveis.map((trilha) => html`<option key=${trilha} value=${trilha}>${trilha}</option>`)}
          </select>
          ${competenciasDisponiveis.length
      ? html`
              <select
                class="form-select"
                value=${filtros.competencia}
                onChange=${(event) => atualizarFiltro('competencia', event.target.value)}
              >
                <option value="">Todas as competências</option>
                ${competenciasDisponiveis.map((competencia) => html`<option key=${competencia} value=${competencia}>${competencia}</option>`)}
              </select>
            `
      : null}
          <select
            class="form-select"
            value=${filtros.status}
            onChange=${(event) => atualizarFiltro('status', event.target.value)}
          >
            <option value="">Todos os status</option>
            ${statusDisponiveis.map((status) => html`<option key=${status} value=${status}>${status}</option>`)}
          </select>
          <select
            class="form-select"
            value=${filtros.resultado}
            onChange=${(event) => atualizarFiltro('resultado', event.target.value)}
          >
            <option value="">Todos os resultados</option>
            <option value="com_nota">Com nota final</option>
            <option value="sem_nota">Sem nota final</option>
            <option value="pendente_avaliacao">Pendente de avaliação</option>
            <option value="com_alertas">Com alertas</option>
            <option value="sem_alertas">Sem alertas</option>
          </select>
          <label class="generated-filter-field generated-filter-score">
            <span class="material-symbols-outlined">${IconeSvg('trending_up')}</span>
            <input
              class="form-control"
              type="number"
              min="0"
              max="10"
              step="0.1"
              placeholder="Nota mínima"
              value=${filtros.notaMinima}
              onInput=${(event) => atualizarFiltro('notaMinima', event.target.value)}
            />
          </label>
          <label class="generated-filter-field generated-filter-score">
            <span class="material-symbols-outlined">${IconeSvg('trending_down')}</span>
            <input
              class="form-control"
              type="number"
              min="0"
              max="10"
              step="0.1"
              placeholder="Nota máxima"
              value=${filtros.notaMaxima}
              onInput=${(event) => atualizarFiltro('notaMaxima', event.target.value)}
            />
          </label>
          <label class="generated-filter-field generated-filter-date">
            <span class="material-symbols-outlined">${IconeSvg('calendar_month')}</span>
            <input
              class="form-control"
              type="date"
              value=${filtros.dataGeracao}
              onInput=${(event) => atualizarFiltro('dataGeracao', event.target.value)}
            />
          </label>
          <button type="button" class="btn btn-outline-secondary generated-clear-filters" onClick=${limparFiltros}>
            <span class="material-symbols-outlined">${IconeSvg('filter_alt_off')}</span>
            Limpar filtros
          </button>
        </div>
        ${carregando
      ? html`
              <${LoadingState}
                titulo="Carregando provas"
                descricao="Buscando provas geradas, status e resultados."
              />
            `
      : provasFiltradas.length
        ? html`
                <div class="table-responsive generated-exams-table">
                  <table class="table align-middle">
                    <thead>
                      <tr>
                        <th>Candidato</th>
                        <th>Vaga</th>
                        <th>Status</th>
                        <th>Data geração</th>
                        <th>Nota final</th>
                        <th>Alertas</th>
                        <th class="text-end">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                  ${provasPaginadas.itens.map((prova) => {
          const alertas = obterAlertas(prova);
          const cancelada = normalizarBusca(prova.status || '').includes('cancelad');
          const naoIniciada = !prova.iniciada_em;
          const acoesLinha = [
            { key: 'ver', label: 'Ver detalhe', icon: 'visibility', onClick: () => abrirDetalhe(prova.id_prova) },
            { key: 'imprimir', label: 'Imprimir prova', icon: 'print', onClick: () => imprimirProvaDaLinha(prova) },
            { separator: true },
            cancelada
              ? { key: 'reabrir', label: 'Reabrir prova', icon: 'lock_open', onClick: () => executarReabertura(prova) }
              : {
                key: 'cancelar',
                label: 'Cancelar prova',
                icon: 'cancel',
                danger: true,
                disabled: !naoIniciada,
                title: naoIniciada ? '' : 'Prova já iniciada pelo candidato.',
                onClick: () => executarCancelamento(prova),
              },
          ];
          return html`
                      <tr key=${prova.id_prova} class="generated-exams-row" onClick=${() => abrirDetalhe(prova.id_prova)}>
                        <td>
                          <div class="generated-candidate-cell">
                            <span class="generated-candidate-avatar">${obterIniciais(prova.nome_candidato)}</span>
                            <div>
                              <strong>${prova.nome_candidato || '-'}</strong>
                              <small>${prova.email_acesso || '-'}</small>
                              <small>Código ${prova.codigo_acesso || '-'}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div class="generated-job-cell">
                            <strong>${prova.vaga || '-'}</strong>
                            <small>${prova.operacao || '-'}</small>
                            <small>${prova.trilha || prova.area_prova || prova.id_processo_ref || 'Avulsa'}</small>
                          </div>
                        </td>
                        <td>
                          <span class=${`generated-status-badge ${obterClasseStatusProva(prova.status)}`}>
                            ${prova.status || '-'}
                          </span>
                        </td>
                        <td class="generated-date-cell">${formatarDataSomente(prova.gerada_em)}</td>
                        <td class="generated-score-cell">${formatarScore(obterNotaFinal(prova))}</td>
                        <td>
                          <button
                            type="button"
                            class=${`generated-alert-badge ${alertas.length ? 'is-warning' : 'is-empty'}`}
                            onClick=${(event) => { event.stopPropagation(); abrirDetalhe(prova.id_prova); }}
                          >
                            <span class="material-symbols-outlined">${IconeSvg(alertas.length ? 'warning' : 'check_circle')}</span>
                            ${alertas.length ? `${alertas.length} alerta${alertas.length > 1 ? 's' : ''}` : 'Sem alertas'}
                          </button>
                        </td>
                        <td class="text-end" onClick=${(event) => event.stopPropagation()}>
                          <div class="generated-exams-actions">
                            <${MenuAcoesProcesso} label="Ações" icon="expand_more" ariaLabel="Ações da prova" triggerClassName="btn btn-primary process-actions-trigger" acoes=${acoesLinha} />
                          </div>
                        </td>
                      </tr>
                    `;
        })}
                    </tbody>
                  </table>
                </div>
                <div class="generated-pagination-row">
                  <small>
                    Exibindo ${provasPaginadas.itens.length} de ${provasFiltradas.length} prova(s).
                  </small>
                  <div class="generated-pagination">
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm"
                      disabled=${provasPaginadas.paginaAtual <= 1}
                      onClick=${() => setPagina(provasPaginadas.paginaAtual - 1)}
                      aria-label="Página anterior"
                    >
                      <span class="material-symbols-outlined">${IconeSvg('chevron_left')}</span>
                    </button>
                    <button type="button" class="btn btn-primary btn-sm" disabled>
                      ${provasPaginadas.paginaAtual}
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm"
                      disabled=${provasPaginadas.paginaAtual >= provasPaginadas.totalPaginas}
                      onClick=${() => setPagina(provasPaginadas.paginaAtual + 1)}
                      aria-label="Próxima página"
                    >
                      <span class="material-symbols-outlined">${IconeSvg('chevron_right')}</span>
                    </button>
                  </div>
                </div>
              `
        : provas.length
          ? html`
                  <${EmptyState}
                    icon="filter_alt_off"
                    title="Nenhuma prova encontrada com esses filtros"
                    text="Ajuste ou limpe os filtros aplicados para visualizar as provas geradas."
                    action=${{
              label: 'Limpar filtros',
              icon: 'filter_alt_off',
              onClick: limparFiltros,
            }}
                  />
                `
          : html`
                  <${EmptyState}
                    ilustracao=${html`<${IlustracaoEstadoVazio} />`}
                    title="Nenhuma prova gerada ainda"
                    text="Quando uma prova for gerada para um candidato, ela aparecerá aqui com status, nota e alertas de correção."
                    action=${{
              label: 'Gerar primeira prova',
              icon: 'assignment_add',
              onClick: () => setModalGerarAberto(true),
            }}
                  />
                `}
      </${SectionCard}>

      <${ModalConfirmacaoAcao}
        aberto=${Boolean(acaoSensivel)}
        titulo=${acaoSensivel?.tipo === 'cancelar' ? 'Cancelar prova' : 'Reabrir prova'}
        descricao=${`Prova de ${acaoSensivel?.prova?.nome_candidato || 'candidato'} para ${acaoSensivel?.prova?.vaga || 'vaga não informada'}.`}
        consequencia=${acaoSensivel?.tipo === 'cancelar'
      ? 'O cancelamento interromperá a disponibilidade da prova e ficará registrado para auditoria.'
      : 'A reabertura permitirá nova continuidade da prova, mantendo respostas conforme a regra atual.'}
        reversibilidade=${acaoSensivel?.tipo === 'cancelar'
      ? 'Esta ação poderá ser revertida posteriormente por reabertura autorizada.'
      : 'Esta ação poderá ser revertida posteriormente por novo cancelamento autorizado.'}
        labelJustificativa=${acaoSensivel?.tipo === 'cancelar'
      ? 'Justificativa do cancelamento'
      : 'Justificativa da reabertura'}
        justificativaObrigatoria=${true}
        textoConfirmar=${acaoSensivel?.tipo === 'cancelar'
      ? 'Confirmar cancelamento'
      : 'Confirmar reabertura'}
        textoCancelar="Voltar"
        tipo=${acaoSensivel?.tipo === 'cancelar' ? 'destrutivo' : 'aviso'}
        carregando=${salvandoAcaoSensivel}
        erro=${erroAcaoSensivel}
        onClose=${() => {
      if (!salvandoAcaoSensivel) setAcaoSensivel(null);
    }}
        onConfirm=${({ justificativa }) => {
      if (acaoSensivel?.tipo === 'cancelar') {
        confirmarCancelamento(acaoSensivel.prova, justificativa);
        return;
      }
      confirmarReabertura(acaoSensivel?.prova, justificativa);
    }}
      />

      <${ModalGerarProva}
        aberto=${modalGerarAberto}
        contexto=${{}}
        controlador=${controlador}
        onClose=${() => setModalGerarAberto(false)}
        onGerada=${async () => {
      await carregar();
    }}
      />

      <${ModalDetalheProvaGerada}
        detalhe=${detalhe}
        onClose=${() => setDetalhe(null)}
        onCopiarCodigo=${() => copiarCodigo(detalhe)}
        onRecalcular=${() => executarRecalculo(detalhe)}
        onAvaliacaoManual=${() => setAvaliacaoManual(detalhe)}
        onReabrir=${() => executarReabertura(detalhe)}
        onCancelar=${() => executarCancelamento(detalhe)}
        onDecisao=${() => setDecisaoRh(detalhe)}
        onDadosCandidato=${async () => {
      try {
        await abrirFichaCandidatoDaProva(detalhe);
      } catch (error) {
        window.alert('Não foi possível localizar a ficha deste candidato.');
      }
    }}
      />

      <${ModalAvaliacaoManual}
        prova=${avaliacaoManual}
        onClose=${() => setAvaliacaoManual(null)}
        onSave=${salvarManual}
      />

      <${ModalDecisaoRh}
        prova=${decisaoRh}
        onClose=${() => setDecisaoRh(null)}
        onSave=${salvarDecisao}
      />

      ${modalHeatmapAberto
      ? html`
            <${ModalPadrao}
              aberto=${true}
              titulo="Heatmap de questões"
              subtitulo="Taxa de acerto por questão, entre todos os candidatos que já responderam objetivamente."
              className="generated-heatmap-dialog"
              onClose=${() => setModalHeatmapAberto(false)}
            >
              <div class="rh-details-body">
                <label class="form-label" for="generated-heatmap-trilha">Trilha</label>
                <select
                  id="generated-heatmap-trilha"
                  class="form-select generated-heatmap-select"
                  value=${heatmapTrilha}
                  onChange=${(event) => {
          setHeatmapTrilha(event.target.value);
          carregarHeatmap(event.target.value);
        }}
                >
                  <option value="">Todas as trilhas</option>
                  ${(heatmap?.trilhas_disponiveis?.length ? heatmap.trilhas_disponiveis : trilhasDisponiveis).map(
          (trilha) => html`<option key=${trilha} value=${trilha}>${trilha}</option>`,
        )}
                </select>

                ${carregandoHeatmap
          ? html`<${LoadingState} titulo="Carregando heatmap" descricao="Calculando a taxa de acerto de cada questão." />`
          : erroHeatmap
            ? html`<div class="alert alert-warning">${erroHeatmap}</div>`
            : heatmap?.itens?.length
              ? html`
                    <div class="generated-heatmap-list">
                      ${heatmap.itens.map((item) => html`
                        <article key=${item.questao_id} class="generated-heatmap-item">
                          <div class="generated-heatmap-item-head">
                            <strong>${item.texto_questao || item.questao_id}</strong>
                            <span class="generated-heatmap-item-meta">${item.categoria || 'Sem categoria'} · ${item.total_respostas} resposta(s)</span>
                          </div>
                          <div class="generated-heatmap-bar-track">
                            <div
                              class="generated-heatmap-bar-fill"
                              style=${{
                  width: `${Math.round(item.taxa_acerto * 100)}%`,
                  background: item.taxa_acerto < 0.4 ? '#d92d20' : item.taxa_acerto < 0.7 ? '#f79009' : '#12b76a',
                }}
                            ></div>
                          </div>
                          <span class="generated-heatmap-item-percent">${Math.round(item.taxa_acerto * 100)}% de acerto</span>
                        </article>
                      `)}
                    </div>
                  `
              : html`<p class="text-muted">Nenhuma questão com respostas objetivas corrigidas ainda${heatmapTrilha ? ` para a trilha "${heatmapTrilha}"` : ''}.</p>`}
              </div>
            </${ModalPadrao}>
          `
      : null}
    </${PainelRh}>
  `;
}
