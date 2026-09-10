import { IconeSvg } from '../../ui/icone.js';

﻿import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import {
  acessarProvaPorCodigo,
  acessarProvaPorEmail,
  acessarProvaPorTelefone,
  confirmarDadosConectaProvas,
  concluirEtapaConectaProvas,
  finalizarConectaProvas,
  iniciarConectaProvas,
  iniciarEtapaConectaProvas,
  interromperEtapaConectaProvas,
  lerSessaoConectaProvas,
  marcarRevisaoConectaProvas,
  salvarRespostasConectaProvas,
} from '../../servico-api.js?v=20260721-exam-analytics-2';
import { formatarTempoRestante } from '../../shared/helpers-visuais.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  EditorTextoRich,
  PerguntaExcel,
  PerguntaGrupoCompacto,
  PerguntaMultipla,
} from '../../ui/componentes-compartilhados.js';

const CHAVE_TOKEN_PUBLICO = 'conecta_provas_token';
const CHAVE_TIMER_PUBLICO = 'conecta_provas_timer';
const ERRO_GENERICO =
  'Não encontramos uma prova disponível com os dados informados. Verifique as informações ou tente outro método de acesso.';
const ERRO_GENERICO_TELEFONE =
  'Não encontramos uma prova disponível com os dados informados. Verifique as informações ou solicite apoio ao RH.';
const LIMITE_LINHAS_REDACAO = 20;
const LIMITE_CARACTERES_REDACAO = 2200;
const ORIENTACAO_REDACAO =
  `Seu texto deve ter introdução, desenvolvimento e conclusão. Escreva uma redação de até ${LIMITE_LINHAS_REDACAO} linhas.`;
const AVISO_SAIDA_ETAPA =
  'Ao atualizar ou sair desta página, você retornará para a tela de etapas. Esta etapa será considerada realizada e não poderá ser feita novamente.';

function estimarTamanhoRespostaAnalitica(resposta) {
  if (resposta === null || resposta === undefined) return 0;
  if (typeof resposta === 'string') return resposta.length;
  if (typeof resposta !== 'object') return String(resposta).length;
  const texto = resposta.text || resposta.content;
  if (typeof texto === 'string') return texto.replace(/<[^>]+>/g, '').length;
  if (resposta.selected !== undefined && resposta.selected !== null) return String(resposta.selected).length;
  if (resposta.selections && typeof resposta.selections === 'object') {
    return Object.keys(resposta.selections).length;
  }
  return Number(resposta.fileSize || resposta.tamanho || 0);
}
const CRITERIOS_REDACAO = [
  'Clareza',
  'Coerência',
  'Coesão',
  'Ortografia',
  'Organização das ideias',
  'Adequação ao tema',
  'Argumentação',
  `Cumprimento do limite de até ${LIMITE_LINHAS_REDACAO} linhas`,
];
const FRASES_PROMPT_INTERNO_BLOQUEADAS = [
  'Imagine uma situação',
  'Use linguagem humanizada',
  'A resposta deve mostrar',
  'Avalie organização',
  'sem cobrar experiência prévia',
  'Use atendimento, rotina operacional',
  'O cenário pode usar como referência',
  'A personalização deve',
  'Considere o cliente',
  'Considere a operação',
  'com foco em empatia',
  'capacidade de aprender',
  'use linguagem simples e situações de primeiro emprego',
  'Use como eixo da questão',
  'Use tom',
  'A demanda deve considerar conhecimentos',
];

function normalizarTexto(valor) {
  return String(valor || '').trim();
}

function textoSemAcentos(valor) {
  return normalizarTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function textoContaminadoPorPromptInterno(texto) {
  const base = textoSemAcentos(texto);
  if (!base) return false;
  return FRASES_PROMPT_INTERNO_BLOQUEADAS.some((frase) =>
    base.includes(textoSemAcentos(frase)),
  );
}

function limparTextoVisivelCandidato(texto) {
  const limpo = normalizarTexto(texto)
    .replace(/^\s*Texto-(base|motivador)\s*\d+\s*:\s*/i, '')
    .replace(/^\s*Texto\s+motivador\s*\d+\s*:\s*/i, '')
    .replace(/^\s*Contexto\s*:\s*/i, '')
    .replace(/\b(central de agendamento)\s+\1\b/gi, '$1')
    .replace(/\s+([,.?!;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!limpo || textoContaminadoPorPromptInterno(limpo)) return '';
  return limpo;
}

function normalizarCriteriosRedacao(criterios = []) {
  const visiveis = Array.isArray(criterios)
    ? criterios
      .map((criterio) => normalizarTexto(criterio))
      .filter(Boolean)
      .filter((criterio) => !/400\s+caracteres/i.test(criterio))
    : [];
  return Array.from(new Set([...visiveis, ...CRITERIOS_REDACAO])).filter(
    (criterio) => !/caracteres/i.test(criterio),
  );
}

function validarEmail(valor) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizarTexto(valor));
}

function normalizarTelefone(valor) {
  return normalizarTexto(valor).replace(/\D/g, '');
}

function validarTelefone(valor) {
  const digitos = normalizarTelefone(valor);
  return digitos.length >= 10 && digitos.length <= 13;
}

function validarCodigo(valor) {
  return /^[A-Z]{2}\d{2}$/.test(normalizarTexto(valor).toUpperCase().replace(/\s+/g, ''));
}

function removerHtml(valor) {
  return String(valor || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparHtml(valor) {
  return String(valor || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function obterTextoResposta(resposta = {}) {
  return normalizarTexto(resposta.content || resposta.text || '');
}

function obterLimiteCaracteresRedacao(questao = {}) {
  if (!etapaEhRedacao(questao)) return 0;
  const configurado = Number(
    questao.essay?.maxCharacters ||
    questao.expected?.maxCharacters ||
    LIMITE_CARACTERES_REDACAO,
  );
  if (Number.isFinite(configurado) && configurado >= 1800) return configurado;
  return LIMITE_CARACTERES_REDACAO;
}

function limitarConteudoTexto(content, limiteCaracteres = 0) {
  const limite = Number(limiteCaracteres || 0);
  const texto = removerHtml(content);
  if (!limite || texto.length <= limite) {
    return {
      content,
      text: texto,
    };
  }
  const text = texto.slice(0, limite);
  return {
    content: escaparHtml(text).replace(/\n/g, '<br>'),
    text,
  };
}

function respostaPreenchida(resposta) {
  if (resposta === null || resposta === undefined || resposta === '') return false;
  if (typeof resposta === 'number') return true;
  if (typeof resposta === 'string') return resposta.trim().length > 0;
  if (typeof resposta === 'object') {
    return Object.values(resposta).some((valor) => {
      if (Array.isArray(valor)) return valor.length > 0;
      return valor !== null && valor !== undefined && String(valor).trim() !== '';
    });
  }
  return true;
}

function questaoObrigatoria(questao) {
  return questao?.required !== false;
}

function respostaQuestaoPreenchida(questao, resposta) {
  if (!questaoObrigatoria(questao)) return true;
  if (questao?.type === 'multiple') {
    return resposta?.selected !== null && resposta?.selected !== undefined;
  }
  if (questao?.type === 'compact_choice_group') {
    const itens = Array.isArray(questao.items)
      ? questao.items
      : Array.isArray(questao.itens)
        ? questao.itens
        : [];
    const selecoes = resposta?.selections || {};
    return itens.length > 0 && itens.every((item) => {
      const chave = String(item.id || '');
      return selecoes[chave] !== null && selecoes[chave] !== undefined;
    });
  }
  if (questao?.type === 'excel_external') {
    return Boolean(
      resposta?.uploaded &&
      resposta?.filename &&
      (resposta?.validation || resposta?.contentBase64),
    );
  }
  if (questao?.type === 'word') {
    return removerHtml(obterTextoResposta(resposta)).length > 0;
  }
  return respostaPreenchida(resposta);
}

function obterPendenciasObrigatorias(questoes = [], respostas = [], etapasIgnoradas = []) {
  const ignoradas = new Set(etapasIgnoradas.filter(Boolean));
  return questoes
    .map((questao, indice) => {
      const grupo = obterGrupoJornadaQuestao(questao, indice);
      return {
        indice,
        questao,
        pendente: !ignoradas.has(grupo.key) && !respostaQuestaoPreenchida(questao, respostas[indice]),
      };
    })
    .filter((item) => item.pendente);
}

function obterLabelEtapa(questao = {}) {
  return questao.stage || questao.stageKey || questao.category || 'Etapa';
}

const ROTULOS_RESUMO_ETAPAS = {
  word_basic: 'WORD',
  word_advanced: 'WORD',
  excel_basic: 'EXCEL',
  excel_mid: 'EXCEL',
  excel_advanced: 'EXCEL',
  general_basic: 'CONHECIMENTOS GERAIS',
  general_advanced: 'CONHECIMENTOS GERAIS',
  general_adv_people: 'CONHECIMENTOS GERAIS',
  tech_ti_basic: 'CONHECIMENTOS TECNICOS',
  tech_rh_basic: 'CONHECIMENTOS TECNICOS',
  tech_adm_basic: 'CONHECIMENTOS TECNICOS',
  tech_commercial_basic: 'CONHECIMENTOS TECNICOS',
  tech_finance_basic: 'CONHECIMENTOS TECNICOS',
  tech_operation_basic: 'CONHECIMENTOS TECNICOS',
  tech_ti_specific: 'CONHECIMENTOS TECNICOS',
  tech_adm_specific: 'CONHECIMENTOS TECNICOS',
  tech_logic: 'CONHECIMENTOS TECNICOS',
  professional_essay: 'REDACAO',
  writing_logic: 'ESCRITA E LOGICA',
  analysis_eval: 'ANALISE',
};

function normalizarChaveEtapa(valor = '') {
  return normalizarTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatarLabelResumoEtapa(valor = '') {
  const chave = normalizarChaveEtapa(valor);
  if (ROTULOS_RESUMO_ETAPAS[chave]) return ROTULOS_RESUMO_ETAPAS[chave];
  if (chave.includes('word')) return 'WORD';
  if (chave.includes('excel')) return 'EXCEL';
  if (chave.includes('general') || chave.includes('conhecimentos_gerais')) {
    return 'CONHECIMENTOS GERAIS';
  }
  if (chave.includes('tech') || chave.includes('tecnico')) {
    return 'CONHECIMENTOS TECNICOS';
  }
  if (chave.includes('essay') || chave.includes('redacao')) return 'REDACAO';
  return normalizarTexto(valor).replace(/_/g, ' ').toUpperCase() || 'ETAPA';
}

function tituloEhNumeracaoGenerica(titulo) {
  return /^quest[aã]o\s*\d+$/i.test(String(titulo || '').trim());
}

function obterTituloQuestao(questao = {}, indice = 0) {
  if (etapaEhRedacao(questao)) return 'Redação';
  // Correções.txt item 5: várias questões do banco trazem um "titulo" tipo
  // "Questão 6" herdado da posição no documento de origem — isso não é um
  // título de verdade, é numeração obsoleta. Se deixarmos passar, ele
  // sobrescreve a numeração dinâmica por etapa (o candidato via "Questão 6"
  // no cabeçalho mas "Questão 1 de 7" no status, ambos vindos do mesmo
  // índice). Só um título realmente descritivo (ex.: "Redação") deve vencer
  // o fallback abaixo.
  const tituloBruto = String(questao.title || '').trim();
  if (tituloBruto && !tituloEhNumeracaoGenerica(tituloBruto)) return tituloBruto;
  return `Questão ${indice + 1}`;
}

function obterResumoEtapas(prova = {}) {
  const questoes = Array.isArray(prova.questoes) ? prova.questoes : [];
  const etapasConfiguradas = Array.isArray(prova.etapas) ? prova.etapas : [];
  const mapa = new Map();

  etapasConfiguradas.forEach((etapa) => {
    const chave = normalizarTexto(etapa.key || etapa.stageKey || etapa.label);
    if (!chave) return;
    mapa.set(chave, {
      key: chave,
      label: formatarLabelResumoEtapa(etapa.label || etapa.stage || chave),
      quantidade: Number(etapa.questionCount || etapa.quantidade || 0),
    });
  });

  questoes.forEach((questao) => {
    const chave = normalizarTexto(questao.stageKey || obterLabelEtapa(questao));
    const atual = mapa.get(chave) || {
      key: chave,
      label: formatarLabelResumoEtapa(questao.stageKey || obterLabelEtapa(questao)),
      quantidade: 0,
    };
    atual.quantidade += 1;
    mapa.set(chave, atual);
  });

  return Array.from(mapa.values()).map((etapa) => ({
    ...etapa,
    quantidade: etapa.quantidade || questoes.filter((questao) =>
      normalizarTexto(questao.stageKey || obterLabelEtapa(questao)) === etapa.key
    ).length,
  }));
}

function etapaEhRedacao(questao = {}) {
  return questao.stageKey === 'professional_essay' || Boolean(questao.expected?.essay || questao.essay);
}

function etapaEhWord(questao = {}) {
  return questao.type === 'word' && !etapaEhRedacao(questao);
}

function questaoEhEmailCorporativo(questao = {}) {
  const titulo = textoSemAcentos(questao.title || questao.titulo);
  return titulo.includes('e-mail') || titulo.includes('email');
}

function questaoEhAtendimentoPaciente(questao = {}) {
  const base = textoSemAcentos(
    [
      questao.stage,
      questao.category,
      questao.categoria,
      questao.description,
      questao.enunciadoCandidato,
      questao.instrucaoCandidato,
      questao.personalizacaoInteligente?.operacao,
      questao.personalizacaoInteligente?.cliente,
      questao.personalizacaoInteligente?.nicho_operacao,
      ...(questao.personalizacaoInteligente?.termos_publicos || []),
    ].join(' '),
  );
  return (
    base.includes('davita') ||
    base.includes('paciente') ||
    base.includes('agendamento') ||
    base.includes('consulta')
  );
}

function obterFallbackQuestaoVisivel(questao = {}) {
  if (questaoEhEmailCorporativo(questao) && questaoEhAtendimentoPaciente(questao)) {
    return {
      enunciado:
        'Você trabalha em uma central de agendamento. Um paciente informou que está com dúvida sobre o horário e a unidade da consulta. A equipe precisa registrar a situação com atenção para evitar informações incorretas.',
      instrucao:
        'Escreva um registro curto de atendimento explicando o ocorrido e indicando que os dados da consulta devem ser conferidos antes do atendimento.',
    };
  }

  const titulo = textoSemAcentos(questao.title || questao.titulo);
  if (titulo.includes('comunicado')) {
    return {
      enunciado:
        'A equipe recebeu uma orientação simples que precisa ser comunicada de forma clara para manter a rotina organizada e evitar dúvidas.',
      instrucao:
        'Escreva um comunicado curto, com título adequado, explicando a orientação principal de maneira objetiva e profissional.',
    };
  }
  if (titulo.includes('lista') || titulo.includes('procedimento')) {
    return {
      enunciado:
        'Antes de iniciar uma atividade de atendimento, a equipe precisa organizar informações, conferir ferramentas e seguir passos básicos.',
      instrucao:
        'Crie uma lista com pelo menos três procedimentos simples que ajudem a preparar a rotina antes do atendimento.',
    };
  }

  if (questao.type === 'multiple') {
    return {
      enunciado:
        'Uma orientação de trabalho chegou com informação incompleta e pode gerar erro se for seguida sem conferência.',
      instrucao: 'Marque a alternativa que melhor demonstra cuidado, responsabilidade e comunicação clara.',
    };
  }

  return {
    enunciado:
      'Durante uma rotina de trabalho, uma pessoa precisa registrar uma informação simples para que a equipe consiga dar continuidade sem dúvida.',
    instrucao: 'Responda explicando o que deve ser comunicado e qual próximo passo precisa ser acompanhado.',
  };
}

function obterCamposQuestaoVisivel(questao = {}) {
  const enunciadoEstruturado = limparTextoVisivelCandidato(
    questao.enunciadoCandidato || questao.enunciado_candidato,
  );
  const instrucaoEstruturada = limparTextoVisivelCandidato(
    questao.instrucaoCandidato || questao.instrucao_candidato,
  );
  const descricaoLimpa = limparTextoVisivelCandidato(questao.description || '');
  const contaminada =
    textoContaminadoPorPromptInterno(questao.description) ||
    textoContaminadoPorPromptInterno(questao.enunciadoCandidato) ||
    textoContaminadoPorPromptInterno(questao.instrucaoCandidato);

  if ((enunciadoEstruturado || instrucaoEstruturada) && !contaminada) {
    return {
      enunciado: enunciadoEstruturado || descricaoLimpa,
      instrucao: instrucaoEstruturada,
    };
  }

  if (descricaoLimpa && !contaminada) {
    return {
      enunciado: descricaoLimpa,
      instrucao: '',
    };
  }

  return obterFallbackQuestaoVisivel(questao);
}

function descreverRespostaRevisao(questao, resposta) {
  if (!respostaQuestaoPreenchida(questao, resposta)) return 'Pendente';
  if (questao.type === 'multiple') {
    const indice = Number(resposta?.selected);
    return questao.options?.[indice] || `Alternativa ${indice + 1}`;
  }
  if (questao.type === 'compact_choice_group') {
    const selecoes = resposta?.selections || {};
    const total = (Array.isArray(questao.items) ? questao.items : questao.itens || []).length;
    const respondidas = Object.values(selecoes)
      .filter((valor) => valor !== null && valor !== undefined && valor !== '')
      .length;
    return `${respondidas}/${total || respondidas} itens respondidos`;
  }
  if (questao.type === 'excel_external') {
    return resposta?.filename || 'Arquivo anexado';
  }
  return removerHtml(obterTextoResposta(resposta)).slice(0, 280) || 'Texto preenchido';
}

function obterRespostaInicial(questao) {
  if (questao?.type === 'multiple') return { type: 'multiple', selected: null };
  if (questao?.type === 'compact_choice_group') {
    return { type: 'compact_choice_group', selections: {} };
  }
  if (questao?.type === 'excel_external') {
    return { type: 'excel_external', filename: '', contentBase64: '', validation: null };
  }
  return { type: 'word', content: '', text: '' };
}

function obterTempoTotalSegundos(sessao = {}) {
  const prova = sessao?.prova || {};
  const configuracao = prova.configuracao || {};
  const minutos = [
    prova.tempo_total,
    prova.tempo_minutos,
    configuracao.tempo_total,
    configuracao.tempo_minutos,
    40,
  ]
    .map((valor) => Number(valor || 0))
    .find((valor) => Number.isFinite(valor) && valor > 0);

  return Math.max(60, Math.round((minutos || 40) * 60));
}

function obterChaveTimer(token = '') {
  return `${CHAVE_TIMER_PUBLICO}:${normalizarTexto(token) || 'ativo'}`;
}

function lerTimestampTimer(token = '') {
  try {
    const valor = Number(sessionStorage.getItem(obterChaveTimer(token)) || 0);
    return Number.isFinite(valor) && valor > Date.now() ? valor : null;
  } catch (error) {
    return null;
  }
}

function salvarTimestampTimer(token = '', timestamp = 0) {
  try {
    if (timestamp > Date.now()) {
      sessionStorage.setItem(obterChaveTimer(token), String(timestamp));
    }
  } catch (error) {
    // Sem persistência, o cronômetro ainda funciona em memória.
  }
}

function limparTimestampTimer(token = '') {
  try {
    sessionStorage.removeItem(obterChaveTimer(token));
  } catch (error) {
    // Nada a limpar quando sessionStorage não está disponível.
  }
}

function calcularTimestampTermino(sessao = {}, token = '') {
  const salvo = lerTimestampTimer(token);
  if (salvo) return salvo;

  const totalSegundos = obterTempoTotalSegundos(sessao);
  const inicio = new Date(sessao?.prova?.iniciada_em || '').getTime();
  if (Number.isFinite(inicio) && inicio > 0) {
    const fim = inicio + totalSegundos * 1000;
    if (fim > Date.now()) return fim;
  }

  return Date.now() + totalSegundos * 1000;
}

/**
 * Duração/tolerância por etapa: opcional, configurada pelo RH por etapa do
 * blueprint (ex.: "word_basic", "excel_basic") e guardada em prova.etapas.
 * Uma etapa da jornada do candidato (ex.: "word") pode agrupar mais de uma
 * etapa do blueprint quando elas compartilham o mesmo tipo — por isso a
 * duração configurada de cada etapa do blueprint envolvida é somada.
 * Etapas sem duração configurada (todo o histórico até aqui) retornam 0,
 * e o cronômetro por etapa simplesmente não aparece — sem mudança de
 * comportamento para provas já em andamento.
 */
function obterConfiguracaoTempoEtapa(prova = {}, etapaJornada = null) {
  const indices = Array.isArray(etapaJornada?.indices) ? etapaJornada.indices : [];
  const questoes = Array.isArray(prova.questoes) ? prova.questoes : [];
  const etapasBlueprint = Array.isArray(prova.etapas) ? prova.etapas : [];
  if (!indices.length || !etapasBlueprint.length) {
    return { duracaoMinutos: 0, toleranciaMinutos: 0 };
  }

  const chavesBlueprint = new Set(
    indices
      .map((indice) => normalizarTexto(questoes[indice]?.stageKey || ''))
      .filter(Boolean),
  );
  if (!chavesBlueprint.size) {
    return { duracaoMinutos: 0, toleranciaMinutos: 0 };
  }

  let duracaoMinutos = 0;
  let toleranciaMinutos = 0;
  etapasBlueprint.forEach((etapa) => {
    if (!chavesBlueprint.has(normalizarTexto(etapa?.key || ''))) return;
    duracaoMinutos += Number(etapa?.duracao_minutos || 0);
    toleranciaMinutos += Number(etapa?.tolerancia_minutos || 0);
  });

  return {
    duracaoMinutos: Math.max(0, duracaoMinutos),
    toleranciaMinutos: Math.max(0, toleranciaMinutos),
  };
}

function obterChaveTimerEtapa(token = '', etapaKey = '') {
  return `${CHAVE_TIMER_PUBLICO}:etapa:${normalizarTexto(token) || 'ativo'}:${normalizarTexto(etapaKey) || 'atual'}`;
}

function lerTimestampTimerEtapa(token = '', etapaKey = '') {
  try {
    const valor = Number(sessionStorage.getItem(obterChaveTimerEtapa(token, etapaKey)) || 0);
    return Number.isFinite(valor) && valor > Date.now() ? valor : null;
  } catch (error) {
    return null;
  }
}

function salvarTimestampTimerEtapa(token = '', etapaKey = '', timestamp = 0) {
  try {
    if (timestamp > Date.now()) {
      sessionStorage.setItem(obterChaveTimerEtapa(token, etapaKey), String(timestamp));
    }
  } catch (error) {
    // Sem persistência, o cronômetro da etapa ainda funciona em memória.
  }
}

function calcularTimestampTerminoEtapa(token, etapaKey, etapaIniciadaEm, duracaoMinutos, toleranciaMinutos) {
  const salvo = lerTimestampTimerEtapa(token, etapaKey);
  if (salvo) return salvo;

  const totalSegundos = Math.max(60, Math.round((Number(duracaoMinutos) + Number(toleranciaMinutos)) * 60));
  const inicio = new Date(etapaIniciadaEm || '').getTime();
  const base = Number.isFinite(inicio) && inicio > 0 ? inicio : Date.now();
  return base + totalSegundos * 1000;
}

function TelaAcesso({
  metodo,
  valor,
  erro,
  carregando,
  tentativasEmail,
  tentativasTelefone,
  provas,
  onValor,
  onSubmit,
  onSelecionar,
  onMetodo,
}) {
  const tituloCampo =
    metodo === 'telefone' ? 'Telefone' : metodo === 'codigo' ? 'código da prova' : 'E-mail';
  const textoAjuda =
    metodo === 'telefone'
      ? 'Tente acessar usando o telefone cadastrado pelo RH.'
      : metodo === 'codigo'
        ? 'Se você não souber os dados cadastrados, solicite ao RH o código da sua prova.'
        : 'Informe o email cadastrado pelo RH para localizar sua avaliação.';

  return html`
    <section class="conecta-provas-card">
      <div class="conecta-provas-brand">
        <span class="material-symbols-outlined">${IconeSvg('assignment')}</span>
        <strong>Conecta Provas</strong>
      </div>
      <h1>Acesse sua prova</h1>
      <p>${textoAjuda}</p>

      <form
        onSubmit=${(event) => {
      event.preventDefault();
      onSubmit();
    }}
      >
        <label class="form-label">${tituloCampo}</label>
        <input
          class="form-control conecta-provas-input"
          value=${valor}
          autocomplete=${metodo === 'email' ? 'email' : 'off'}
          inputmode=${metodo === 'telefone' ? 'tel' : 'text'}
          maxlength=${metodo === 'codigo' ? 4 : null}
          onInput=${(event) => onValor(event.target.value)}
        />
        ${erro ? html`<div class="alert alert-warning mt-3">${erro}</div>` : null}
        <button type="submit" class="btn btn-primary conecta-provas-primary" disabled=${carregando}>
          ${carregando ? 'Validando...' : 'Continuar'}
        </button>
      </form>

      ${provas.length > 1
      ? html`
            <div class="conecta-provas-list">
              <strong>Selecione a avaliação</strong>
              ${provas.map(
        (prova) => html`
                  <button
                    type="button"
                    key=${prova.token}
                    class="conecta-provas-list-item"
                    onClick=${() => onSelecionar(prova)}
                  >
                    <span>${prova.vaga || 'avaliação'}</span>
                    <small>${prova.operacao || '-'} â€¢ ${prova.status || '-'} â€¢ ${prova.gerada_em || '-'}</small>
                  </button>
                `,
      )}
            </div>
          `
      : null}

      <div class="conecta-provas-alt-actions">
        ${tentativasEmail >= 3 && metodo !== 'telefone'
      ? html`
              <button type="button" class="btn btn-link" onClick=${() => onMetodo('telefone')}>
                Acessar com telefone
              </button>
            `
      : null}
        ${tentativasTelefone >= 3 && metodo !== 'codigo'
      ? html`
              <button type="button" class="btn btn-link" onClick=${() => onMetodo('codigo')}>
                Acessar com código da prova
              </button>
            `
      : null}
      </div>
    </section>
  `;
}

function TelaConfirmacao({ sessao, formulario, erro, salvando, onChange, onConfirmar }) {
  const [consultandoCep, setConsultandoCep] = useState(false);
  const [erroCep, setErroCep] = useState('');
  const buscarCep = async () => {
    const cep = String(formulario.cep || '').replace(/\D/g, '');
    if (cep.length !== 8) {
      setErroCep('Informe um CEP com 8 dígitos.');
      return;
    }
    setConsultandoCep(true);
    setErroCep('');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const dados = await response.json();
      if (!response.ok || dados.erro) throw new Error('CEP não encontrado.');
      onChange({
        ...formulario,
        cep,
        endereco: dados.logradouro || formulario.endereco,
        bairro: dados.bairro || formulario.bairro,
        cidade: dados.localidade || formulario.cidade,
      });
    } catch (error) {
      setErroCep(error?.message || 'Não foi possível consultar o CEP. Preencha o endereço manualmente.');
    } finally {
      setConsultandoCep(false);
    }
  };
  return html`
    <section class="conecta-provas-card conecta-provas-card-wide conecta-provas-registration">
      <div class="conecta-provas-step">Etapa 1 · Confirmação dos dados</div>
      <h1>Confirme seus dados</h1>
      <p>Complete seu cadastro. Após a confirmação, as avaliações serão desbloqueadas.</p>
      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
      ${erroCep ? html`<div class="alert alert-info">${erroCep}</div>` : null}
      <div class="row g-3">
        <div class="col-md-12">
          <label class="form-label">Nome completo</label>
          <input
            class="form-control"
            value=${formulario.nome_candidato}
            onInput=${(event) => onChange({ ...formulario, nome_candidato: event.target.value })}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label">E-mail</label>
          <input type="email" class="form-control"
            value=${formulario.email}
            onInput=${(event) => onChange({ ...formulario, email: event.target.value })}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label">Confirmar e-mail</label>
          <input type="email" class="form-control" value=${formulario.confirmar_email} onInput=${(event) => onChange({ ...formulario, confirmar_email: event.target.value })} />
        </div>
        <div class="col-md-4">
          <label class="form-label">Telefone</label>
          <input class="form-control" inputmode="tel"
            value=${formulario.telefone}
            onInput=${(event) => onChange({ ...formulario, telefone: event.target.value })}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label">WhatsApp</label>
          <input class="form-control" inputmode="tel" value=${formulario.whatsapp} onInput=${(event) => onChange({ ...formulario, whatsapp: event.target.value })} />
        </div>
        <div class="col-md-4">
          <label class="form-label">Idade</label>
          <input type="number" min="14" max="100" class="form-control" value=${formulario.idade ?? ''} onInput=${(event) => onChange({ ...formulario, idade: event.target.value })} />
        </div>
        <div class="col-md-4">
          <label class="form-label">CEP</label>
          <div class="conecta-provas-cep-field"><input class="form-control" inputmode="numeric" maxlength="9" value=${formulario.cep} onInput=${(event) => onChange({ ...formulario, cep: event.target.value })} onBlur=${buscarCep} /><button type="button" class="btn btn-outline-primary" disabled=${consultandoCep} onClick=${buscarCep}>${consultandoCep ? 'Buscando...' : 'Buscar'}</button></div>
        </div>
        <div class="col-md-6">
          <label class="form-label">Rua / endereço</label>
          <input class="form-control" value=${formulario.endereco} onInput=${(event) => onChange({ ...formulario, endereco: event.target.value })} />
        </div>
        <div class="col-md-2">
          <label class="form-label">Número</label>
          <input class="form-control" value=${formulario.numero} onInput=${(event) => onChange({ ...formulario, numero: event.target.value })} />
        </div>
        <div class="col-md-4">
          <label class="form-label">Bairro</label>
          <input class="form-control" value=${formulario.bairro} onInput=${(event) => onChange({ ...formulario, bairro: event.target.value })} />
        </div>
        <div class="col-md-4">
          <label class="form-label">Cidade</label>
          <input class="form-control" value=${formulario.cidade} onInput=${(event) => onChange({ ...formulario, cidade: event.target.value })} />
        </div>
        <div class="col-md-4">
          <label class="form-label">Escolaridade</label>
          <select class="form-select" value=${formulario.escolaridade} onChange=${(event) => onChange({ ...formulario, escolaridade: event.target.value })}>
            <option value="">Selecione...</option>
            ${['Ensino Fundamental incompleto', 'Ensino Fundamental completo', 'Ensino Médio incompleto', 'Ensino Médio completo', 'Ensino Superior incompleto', 'Ensino Superior completo', 'Pós-graduação'].map((item) => html`<option key=${item} value=${item}>${item}</option>`)}
          </select>
        </div>
      </div>
      <button type="button" class="btn btn-primary conecta-provas-primary" disabled=${salvando} onClick=${onConfirmar}>
        ${salvando ? 'Salvando...' : 'Confirmar e continuar'}
      </button>
      <div class="Comfirmação">
        <span>${sessao?.prova?.vaga || '-'}</span>
        <span>${sessao?.prova?.operacao || '-'}</span>
      </div>
    </section>
  `;
}

function TelaRegras({ sessao, onIniciar, carregando, erro }) {
  const prova = sessao?.prova || {};
  const questoes = Array.isArray(prova.questoes) ? prova.questoes : [];
  const etapas = obterResumoEtapas(prova);
  const possuiExcel = questoes.some((questao) => questao.type === 'excel_external');
  const possuiRedacao = questoes.some(etapaEhRedacao);
  const possuiWord = questoes.some(etapaEhWord);
  const quantidadeQuestoes = prova.quantidade_questoes || questoes.length;
  const resumoQuantitativo = etapas.map((etapa) => ({
    label: etapa.label,
    value: `${etapa.quantidade || 0} ${Number(etapa.quantidade || 0) === 1 ? 'Questão' : 'questões'}`,
  }));

  return html`
    <section class="conecta-provas-card conecta-provas-card-wide">
      <div class="conecta-provas-step">Regras</div>
      <h1>Regras da prova</h1>
      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
      <div class="conecta-provas-rules-grid">
        <span><strong>Vaga</strong>${prova.vaga || '-'}</span>
        ${prova.operacao
      ? html`<span><strong>Operação/cliente</strong>${prova.operacao}</span>`
      : null}
        <span><strong>Tempo total</strong>${prova.tempo_total || 0} min</span>
        <span><strong>Etapas</strong>${etapas.length}</span>
        <span><strong>Questões</strong>${quantidadeQuestoes}</span>
        <span><strong>Redação</strong>${possuiRedacao ? 'Sim' : 'Não'}</span>
        <span><strong>Excel</strong>${possuiExcel ? 'Sim' : 'Não'}</span>
        <span><strong>Word/texto</strong>${possuiWord ? 'Sim' : 'Não'}</span>
      </div>

      <section>
          <h3>Resumo quantitativo da prova</h3>
          <div class="conecta-provas-rules-grid">
            ${resumoQuantitativo.map(
        (item) => html`
                <span key=${item.label}><strong>${item.label}</strong>${item.value}</span>
              `,
      )}
            <span><strong>Tempo total</strong>${prova.tempo_total || 0} minutos</span>
          </div>
        </section>

      <div class="conecta-provas-section-list">
        <section>
          <h2>Regras gerais</h2>
          <ul class="conecta-provas-rules">
            <li>Preencha todas as etapas obrigatórias antes de finalizar.</li>
            <li>Não atualize a página durante a prova.</li>
            <li>Não feche o navegador durante a prova.</li>
            <li>Acompanhe o cronômetro no topo da tela.</li>
            <li>Revise suas respostas antes do envio final.</li>
            <li>Ao finalizar, suas respostas serão enviadas ao RH para análise.</li>
            <li>O resultado da avaliação não será exibido ao candidato nesta tela.</li>
            <li>Avise o RH quando concluir a prova, se estiver realizando presencialmente.</li>
          </ul>
        </section>

        <section>
          <h2>O que será avaliado</h2>
          <ul class="conecta-provas-rules">
            <li>Interpretação de enunciado.</li>
            <li>Organização das respostas.</li>
            <li>Escrita e clareza.</li>
            <li>Conhecimentos básicos ou técnicos conforme a vaga.</li>
            <li>Uso correto das ferramentas solicitadas.</li>
            <li>Atenção às instruções.</li>
            <li>Capacidade de resolver situações práticas.</li>
            ${possuiRedacao
      ? html`<li>Na redação: coerência, coesão, estrutura, ortografia e argumentação.</li>`
      : null}
            ${possuiExcel
      ? html`<li>No Excel: preenchimento correto, organização, fórmulas quando aplicável, filtros, edição e formatação conforme a atividade.</li>`
      : null}
            ${possuiWord
      ? html`<li>No Word/texto: formatação, clareza, organização visual, uso dos recursos solicitados e cumprimento do enunciado.</li>`
      : null}
          </ul>
        </section>

        
      </div>
      <button type="button" class="btn btn-primary conecta-provas-primary" disabled=${carregando} onClick=${onIniciar}>
        ${carregando ? 'Iniciando...' : 'Iniciar prova'}
      </button>
    </section>
  `;
}

function obterGrupoJornadaQuestao(questao = {}, indice = 0) {
  const chave = normalizarChaveEtapa(questao.stageKey || obterLabelEtapa(questao));
  if (etapaEhRedacao(questao)) {
    return { key: 'redacao', label: 'Redação', icon: 'edit_note', description: 'Produção de texto com tema orientado' };
  }
  if (chave.includes('personalidade') || chave.includes('espontane')) {
    // Correções.txt item 7: personalidade/espontaneidade usa a mesma fábrica de
    // pergunta "word" (texto livre) das etapas discursivas — precisa de etapa
    // própria, checada ANTES do branch "word" abaixo, senão a questão some
    // dentro da Prova de Word (mesmo padrão de etapaEhRedacao() acima).
    return { key: 'personalidade', label: 'Perfil e comportamento', icon: 'diversity_3', description: 'Questões sobre personalidade e espontaneidade' };
  }
  if (questao.type === 'excel_external' || chave.includes('excel')) {
    return { key: 'excel', label: 'Prova de Excel', icon: 'table_view', description: 'Atividades em planilha e interpretação de dados' };
  }
  if (etapaEhWord(questao) || chave.includes('word')) {
    return { key: 'word', label: 'Prova de Word', icon: 'description', description: 'Questões práticas de formatação e edição' };
  }
  if (chave.includes('tech') || chave.includes('tecnico')) {
    return { key: 'conhecimentos_tecnicos', label: 'Conhecimentos técnicos', icon: 'psychology', description: 'Questões objetivas sobre conhecimentos técnicos da vaga' };
  }
  if (chave.includes('general') || chave.includes('geral')) {
    return { key: 'conhecimentos_gerais', label: 'Conhecimentos gerais', icon: 'psychology', description: 'Questões objetivas sobre rotina, lógica e conhecimentos gerais' };
  }
  if (chave.includes('conhecimento')) {
    return { key: 'conhecimentos', label: 'Conhecimentos gerais e técnicos', icon: 'psychology', description: 'Questões objetivas sobre rotina, lógica e conhecimentos da vaga' };
  }
  return {
    key: chave || `etapa-${indice + 1}`,
    label: formatarLabelResumoEtapa(obterLabelEtapa(questao)),
    icon: 'task_alt',
    description: questao.description || 'Avaliação configurada para esta vaga',
  };
}

function obterEstadosEtapasCandidato(prova = {}) {
  const estados = prova?.configuracao?.estado_etapas_candidato || {};
  return estados && typeof estados === 'object' ? estados : {};
}

function aplicarEstadoPersistidoEtapa(etapa = {}, estados = {}) {
  const estado = estados[etapa.key];
  if (!estado || typeof estado !== 'object') return etapa;
  const status = normalizarChaveEtapa(estado.status || '');
  if (status === 'realizada' || estado.indisponivel) {
    return { ...etapa, status: 'indisponivel', indisponivel: true, respondidas: etapa.total };
  }
  if (status === 'concluida') {
    return { ...etapa, status: 'concluida', respondidas: etapa.total };
  }
  return etapa;
}

function atualizarEstadoEtapaSessao(sessao, etapaKey, estado = {}) {
  if (!sessao || !etapaKey) return sessao;
  const configuracao = sessao.prova?.configuracao || {};
  return {
    ...sessao,
    prova: {
      ...(sessao.prova || {}),
      configuracao: {
        ...configuracao,
        estado_etapas_candidato: {
          ...(configuracao.estado_etapas_candidato || {}),
          [etapaKey]: estado,
        },
      },
    },
  };
}

function montarEtapasJornada(prova = {}, respostas = [], cadastroConcluido = false) {
  const questoes = Array.isArray(prova.questoes) ? prova.questoes : [];
  const estados = obterEstadosEtapasCandidato(prova);
  const mapa = new Map();
  questoes.forEach((questao, indice) => {
    const grupo = obterGrupoJornadaQuestao(questao, indice);
    const atual = mapa.get(grupo.key) || { ...grupo, indices: [] };
    atual.indices.push(indice);
    mapa.set(grupo.key, atual);
  });
  const avaliativas = Array.from(mapa.values()).map((etapa) => {
    const respondidas = etapa.indices.filter((indice) =>
      respostaQuestaoPreenchida(questoes[indice], respostas[indice]),
    ).length;
    return aplicarEstadoPersistidoEtapa({
      ...etapa,
      respondidas,
      total: etapa.indices.length,
      status: respondidas === etapa.indices.length && etapa.indices.length
        ? 'concluida'
        : respondidas > 0
          ? 'andamento'
          : 'nao-iniciada',
    }, estados);
  });
  return [
    {
      key: 'cadastro',
      label: 'Confirmação dos dados',
      icon: 'person',
      description: 'Confirme seus dados antes de começar',
      indices: [],
      respondidas: cadastroConcluido ? 1 : 0,
      total: 1,
      status: cadastroConcluido ? 'concluida' : 'nao-iniciada',
      obrigatoria: true,
    },
    ...avaliativas,
  ];
}

function TelaEtapasProva({
  sessao,
  respostas,
  carregando,
  erro,
  confirmacao = false,
  cadastroConcluido = false,
  onIniciar,
  onCadastro,
  onVoltar,
  onFinalizar,
}) {
  const { showToast, ToastHost } = useToast();
  const etapas = montarEtapasJornada(sessao?.prova || {}, respostas, cadastroConcluido);
  const etapasAvaliativas = etapas.filter((item) => item.key !== 'cadastro');
  const concluidas = etapas.filter((item) => item.status === 'concluida' || item.status === 'indisponivel').length;
  const pendentes = etapasAvaliativas.filter((item) => item.status !== 'concluida' && item.status !== 'indisponivel');
  const todasConcluidas = cadastroConcluido && pendentes.length === 0 && etapasAvaliativas.length > 0;
  const progresso = etapas.length ? Math.round((concluidas / etapas.length) * 100) : 0;

  return html`
    <section class="exam-steps-page">
      <${ToastHost} />
      <header class="exam-steps-header">
        <button type="button" class="exam-steps-back" aria-label="Voltar" onClick=${onVoltar}>
          <span class="material-symbols-outlined">${IconeSvg('arrow_back')}</span>
        </button>
        <div>
          <h1>Etapas da prova</h1>
          <p>Acompanhe sua jornada e conclua cada etapa para avançar no processo.</p>
        </div>
      </header>

      ${erro ? html`<div class="alert alert-warning exam-steps-alert">${erro}</div>` : null}
      ${confirmacao ? html`
        <div class=${`exam-steps-notice ${todasConcluidas ? 'is-complete' : 'is-pending'}`}>
          <span class="material-symbols-outlined">${IconeSvg(todasConcluidas ? 'check_circle' : 'info')}</span>
          <div><strong>${todasConcluidas ? 'Todas as etapas foram concluídas' : `Ainda ${pendentes.length === 1 ? 'falta' : 'faltam'} ${pendentes.length} etapa(s)`}</strong><span>${todasConcluidas ? 'Revise o resumo e finalize o envio quando estiver pronto.' : 'Continue pelas etapas pendentes antes de finalizar o envio.'}</span></div>
        </div>
      ` : null}

      <div class="exam-steps-layout">
        <div class="exam-steps-list">
          ${etapas.map((etapa, indice) => {
    const concluida = etapa.status === 'concluida';
    const emAndamento = etapa.status === 'andamento';
    const indisponivel = etapa.status === 'indisponivel';
    const somenteCadastro = etapa.key === 'cadastro';
    const bloqueada = (!somenteCadastro && !cadastroConcluido) || indisponivel;
    return html`
              <article class=${`exam-step-card is-${etapa.status} ${bloqueada ? 'is-locked' : ''}`.trim()} key=${etapa.key}>
                <div class="exam-step-timeline" aria-hidden="true">
                  <span>${indice + 1}</span>${indice < etapas.length - 1 ? html`<i></i>` : null}
                </div>
                <span class="exam-step-icon"><i class="material-symbols-outlined">${IconeSvg(etapa.icon)}</i></span>
                <div class="exam-step-copy">
                  <small>Etapa ${indice + 1}${etapa.obrigatoria ? ' · Obrigatório' : ''}</small>
                  <h2>${etapa.label}</h2>
                  <p>${etapa.description}</p>
                  ${confirmacao && !somenteCadastro ? html`<span class=${`exam-step-state is-${etapa.status}`}>${indisponivel ? 'Realizada' : concluida ? 'Concluída' : emAndamento ? 'Em andamento' : 'Não iniciada'}</span>` : null}
                  ${bloqueada && !indisponivel ? html`<span class="exam-step-state is-locked"><i class="material-symbols-outlined">${IconeSvg('lock')}</i>Conclua o Cadastro para desbloquear</span>` : null}
                </div>
                <div class="exam-step-action">
                  ${somenteCadastro
        ? cadastroConcluido
          ? html`<span class="exam-step-complete-tag"><i class="material-symbols-outlined">${IconeSvg('check')}</i>Etapa concluída</span>`
          : html`<button type="button" class="btn btn-primary" disabled=${carregando} onClick=${onCadastro}>Começar</button>`
        : html`<button type="button" class=${concluida ? 'btn btn-outline-primary' : 'btn btn-primary'} disabled=${carregando || bloqueada} onClick=${() => !bloqueada && onIniciar(etapa)}><span class="material-symbols-outlined">${IconeSvg(indisponivel ? 'block' : bloqueada ? 'lock' : concluida ? 'check_circle' : 'play_arrow')}</span>${indisponivel ? 'Indisponível' : bloqueada ? 'Bloqueada' : concluida ? 'Revisar' : emAndamento ? 'Continuar' : 'Iniciar prova'}</button>`}
                </div>
              </article>
            `;
  })}
        </div>

        <aside class="exam-summary-column">
          <section class="exam-summary-panel">
            <h2>Resumo</h2>
            <div class="exam-summary-total"><span class="material-symbols-outlined">${IconeSvg('checklist')}</span><strong>${etapas.length} etapas</strong></div>
            <p><span>•</span>${etapasAvaliativas.length} ${etapasAvaliativas.length === 1 ? 'avaliação' : 'avaliações'}</p>
            <div class="exam-summary-progress"><div><span>Progresso</span><strong>${progresso}%</strong></div><i><b style=${{ width: `${progresso}%` }}></b></i><small>${concluidas} de ${etapas.length} etapas concluídas</small></div>
            <span class=${`exam-summary-status ${todasConcluidas ? 'is-complete' : 'is-progress'}`}>${todasConcluidas ? 'Pronta para envio' : 'Em andamento'}</span>
          </section>
          <section class="exam-info-panel">
            <span class="exam-info-icon material-symbols-outlined">${IconeSvg('sentiment_satisfied')}</span>
            <div><h2>Seu processo está pronto</h2><p>Conclua as etapas na ordem indicada. Cada prova poderá ser iniciada individualmente e seu progresso será salvo.</p><a href="#entenda-etapas" onClick=${(event) => { event.preventDefault(); showToast('Inicie uma etapa por vez. Suas respostas são salvas ao concluir cada bloco e você poderá continuar as etapas pendentes antes do envio final.', 'info'); }}><span class="material-symbols-outlined">${IconeSvg('open_in_new')}</span>Entenda mais</a></div>
          </section>
          ${confirmacao && todasConcluidas ? html`<button type="button" class="btn btn-primary exam-final-submit" disabled=${carregando} onClick=${onFinalizar}>${carregando ? 'Finalizando...' : 'Finalizar envio'}</button>` : null}
        </aside>
      </div>
    </section>
  `;
}


function obterTemaAtualRedacao(questao = {}, proposta = '') {
  const dados = questao.essay || {};
  const temaConfigurado = limparTextoVisivelCandidato(
    dados.theme || dados.tema || questao.theme || questao.tema || '',
  );
  const propostaNormalizada = limparTextoVisivelCandidato(proposta).toLowerCase();
  // Correções.txt item 10: tema precisa ser curto e direto, nunca o mesmo
  // trecho com que a proposta começa — se o dado de origem não foi revisado
  // (tema = cópia da abertura da proposta), isso é sinal de erro, não um tema
  // válido, então cai no fallback abaixo em vez de exibir a duplicidade.
  const pareceCopiaDaProposta =
    temaConfigurado.length >= 20 &&
    propostaNormalizada.startsWith(temaConfigurado.toLowerCase().slice(0, 60));
  const temaValido =
    temaConfigurado &&
    !/^reda[cç][aã]o$/i.test(temaConfigurado) &&
    temaConfigurado.length <= 260 &&
    !pareceCopiaDaProposta;
  if (temaValido) return temaConfigurado;
  if (/tema\s+livre/i.test(proposta)) return 'Tema Livre';
  const temaNaProposta = proposta.match(/tema\s*[:\-]\s*([^.!\n]{4,120})/i)?.[1];
  return limparTextoVisivelCandidato(temaNaProposta) || 'Tema Livre';
}

function organizarPropostaRedacao(texto = '') {
  const original = limparTextoVisivelCandidato(texto);
  const boaSorte = /boa\s+sorte\s*!?/i.test(original);
  let proposta = original.replace(/boa\s+sorte\s*!?/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  const marcador = proposta.match(/palavras?\s+(?:citadas?|indicadas?|obrigat[oó]rias?)\s+(?:a\s+seguir|abaixo)\s*[.:\-]?/i);
  let palavras = [];
  let orientacaoExtra = '';
  if (marcador?.index !== undefined) {
    const inicio = marcador.index + marcador[0].length;
    const cauda = proposta.slice(inicio).trim();
    const limite = cauda.search(/(?:seu texto deve|escreva uma reda[cç][aã]o|orienta[cç][aã]o)\b/i);
    const trechoPalavras = (limite >= 0 ? cauda.slice(0, limite) : cauda)
      .replace(/[.;:]+$/g, '')
      .trim();
    palavras = trechoPalavras
      .split(/[\s,;|/]+/)
      .map((item) => item.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, '').trim())
      .filter((item) => item.length >= 3)
      .slice(0, 16);
    orientacaoExtra = limite >= 0 ? cauda.slice(limite).trim() : '';
    proposta = proposta.slice(0, inicio).trim();
  }
  return { proposta, palavras: Array.from(new Set(palavras)), boaSorte, orientacaoExtra };
}

function separarTextoParaCopiarWord(texto = '') {
  const enunciado = limparTextoVisivelCandidato(texto);
  const citacoes = Array.from(enunciado.matchAll(/[“"]([^”"]{20,})[”"]/g));
  const ultima = citacoes.at(-1);
  if (!ultima) return { enunciado, textoCopia: '' };
  return {
    enunciado: enunciado.replace(ultima[0], '').replace(/\s+([,.?!;:])/g, '$1').trim(),
    textoCopia: ultima[1].trim(),
  };
}

function normalizarQuebrasTextoQuestao(texto = '') {
  const marcadorTexto =
    'Texto\\s+(?:I{1,3}|IV|V|VI{1,3}|IX|X)\\s*(?:\\([^\\n)]*\\)|[—-][^:\\n]+)?\\s*[:：]';
  const textoNormalizado = normalizarTexto(texto).replace(/\r\n?/g, '\n');
  if (!textoNormalizado) return '';

  return textoNormalizado
    .replace(new RegExp(`([.!?])\\s+(${marcadorTexto})`, 'gi'), '$1\n\n$2')
    .replace(new RegExp(`\\n\\s*(${marcadorTexto})`, 'gi'), '\n\n$1')
    .replace(new RegExp(`(${marcadorTexto})\\s*(["“])`, 'gi'), '$1\n\n$2')
    .replace(new RegExp(`(["”])\\s+(${marcadorTexto})`, 'gi'), '$1\n\n$2')
    .replace(/(["”])\s+(Assinale a alternativa[^:\n]*:)/gi, '$1\n\n$2')
    .replace(/([.!?])\s+(Assinale a alternativa[^:\n]*:)/gi, '$1\n\n$2')
    .replace(/\n\s*(Assinale a alternativa[^:\n]*:)/gi, '\n\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function obterBlocosTextoQuestao(texto = '') {
  const textoFormatado = normalizarQuebrasTextoQuestao(texto);
  if (!textoFormatado) return [];
  return textoFormatado
    .split(/\n{2,}/)
    .map((bloco) => bloco.trim())
    .filter(Boolean);
}

function obterClasseBlocoTextoQuestao(bloco = '') {
  const texto = normalizarTexto(bloco);
  if (/^Texto\s+(?:I{1,3}|IV|V|VI{1,3}|IX|X)\b/i.test(texto)) {
    return 'conecta-provas-question-heading';
  }
  if (/^["“]/.test(texto)) {
    return 'conecta-provas-question-quote';
  }
  if (/^Assinale a alternativa/i.test(texto)) {
    return 'conecta-provas-question-command';
  }
  return '';
}

function BlocosTextoQuestao({ texto }) {
  const blocos = obterBlocosTextoQuestao(texto);
  if (!blocos.length) return null;
  return html`
    ${blocos.map((bloco, indice) => html`
      <p
        key=${`${indice}-${bloco.slice(0, 24)}`}
        class=${obterClasseBlocoTextoQuestao(bloco)}
      >
        ${bloco}
      </p>
    `)}
  `;
}

function BlocoRedacao({ questao }) {
  if (!etapaEhRedacao(questao)) return null;
  const dados = questao.essay || {};
  const textos = Array.isArray(dados.supportTexts)
    ? dados.supportTexts
    : Array.isArray(dados.motivatingTexts)
      ? dados.motivatingTexts
      : [];
  const textosVisiveis = textos
    .map(limparTextoVisivelCandidato)
    .filter(Boolean);
  const proposta =
    limparTextoVisivelCandidato(dados.proposal || questao.enunciadoCandidato) ||
    'Com base nos textos-base e em seus conhecimentos, escreva um texto explicando a importância de agir com organização, clareza e responsabilidade em situações profissionais.';
  const propostaOrganizada = organizarPropostaRedacao(proposta);
  const orientacao = limparTextoVisivelCandidato(dados.orientation || propostaOrganizada.orientacaoExtra) || ORIENTACAO_REDACAO;
  const temaAtual = obterTemaAtualRedacao(questao, proposta);
  const textosFallback = [
    'O início da vida profissional costuma ser marcado por descobertas, dúvidas e aprendizados. Para muitos jovens, esse período representa o primeiro contato com regras, horários, responsabilidades e formas de comunicação próprias do ambiente de trabalho. Atitudes simples, como ouvir com atenção, anotar orientações, confirmar informações e cumprir combinados, ajudam a construir confiança e demonstram disposição para aprender. Elas também tornam a rotina mais segura para a pessoa e para a equipe.',
    'Em uma situação cotidiana, uma pessoa recebeu uma lista curta de tarefas e percebeu que uma orientação estava incompleta. Antes de seguir adiante, ela decidiu conferir a informação com a pessoa responsável, evitando retrabalho e reduzindo o risco de repassar dados incorretos. Essa postura mostra que responsabilidade não depende apenas de experiência, mas também de cuidado, comunicação respeitosa e organização. Mesmo uma atividade simples pode exigir atenção aos detalhes.',
  ];

  return html`
    <div class="conecta-provas-essay-panel">
      <div class="conecta-provas-essay-theme">
        <strong>Tema da redação</strong>
        <span>${temaAtual}</span>
      </div>
      <div class="conecta-provas-motivators">
        ${(textosVisiveis.length >= 2
      ? textosVisiveis
      : textosFallback
    ).slice(0, 2).map(
      (texto, indiceTexto) => html`
            <article key=${indiceTexto}>
              <strong>${`Texto-base ${indiceTexto + 1}`}</strong>
              <p>${texto}</p>
            </article>
          `,
    )}
      </div>
      <div class="conecta-provas-essay-proposal">
        <strong>Proposta de redação</strong>
        <p>${propostaOrganizada.proposta}</p>
        ${propostaOrganizada.palavras.length ? html`<div class="conecta-provas-essay-keywords" aria-label="Palavras obrigatórias">${propostaOrganizada.palavras.map((palavra) => html`<span key=${palavra}>${palavra}</span>`)}</div>` : null}
        <span class="conecta-provas-essay-orientation">${orientacao}</span>
        ${propostaOrganizada.boaSorte ? html`<strong class="conecta-provas-good-luck">Boa sorte!</strong>` : null}
      </div>
    </div>
  `;
}

function QuestaoProva({
  questao,
  resposta,
  indice,
  total,
  tempoRestante,
  tempoRestanteEtapa,
  progresso,
  nomeCandidato,
  onResposta,
  onColagem,
}) {
  const tipo = questao?.type || 'multiple';
  const limiteCaracteres = obterLimiteCaracteresRedacao(questao);
  const ehRedacao = etapaEhRedacao(questao);
  const camposVisiveis = obterCamposQuestaoVisivel(questao);
  const textoWord = tipo === 'word' && !ehRedacao
    ? separarTextoParaCopiarWord(camposVisiveis.enunciado)
    : { enunciado: camposVisiveis.enunciado, textoCopia: '' };
  return html`
    <section class="conecta-provas-card conecta-provas-card-wide" onPaste=${onColagem}>
      <div class="conecta-provas-exam-head">
        <div>
          <span class="conecta-provas-step">${questao.stage || 'Etapa'}</span>
          <h1>${obterTituloQuestao(questao, indice)}</h1>
        </div>
        <div class="conecta-provas-status-card">
          <span>${`Questão ${indice + 1} de ${total}`}</span>
          <strong>${`Tempo restante: ${formatarTempoRestante(tempoRestante)}`}</strong>
          ${tempoRestanteEtapa !== null && tempoRestanteEtapa !== undefined
      ? html`<strong class="conecta-provas-status-etapa">${`Tempo desta etapa: ${formatarTempoRestante(tempoRestanteEtapa)}`}</strong>`
      : null}
          <div class="conecta-provas-status-track">
            <div style=${{ width: `${progresso}%` }}></div>
          </div>
        </div>
      </div>
      ${ehRedacao
      ? html`<${BlocoRedacao} questao=${questao} />`
      : html`
            <div class="conecta-provas-question-text">
              <${BlocosTextoQuestao} texto=${textoWord.enunciado} />
              ${camposVisiveis.instrucao
          ? html`<p><strong>Instrução:</strong> ${camposVisiveis.instrucao}</p>`
          : null}
              ${textoWord.textoCopia ? html`<div class="conecta-provas-copy-text"><span>Texto para copiar</span><strong>${textoWord.textoCopia}</strong></div>` : null}
            </div>
          `}

      ${tipo === 'multiple'
      ? html`
            <${PerguntaMultipla}
              questao=${questao}
              resposta=${resposta}
              onChange=${(selected) => onResposta({ type: 'multiple', selected })}
            />
          `
      : tipo === 'compact_choice_group'
        ? html`
              <${PerguntaGrupoCompacto}
                questao=${questao}
                resposta=${resposta}
                onChange=${(respostaGrupo) => onResposta(respostaGrupo)}
              />
            `
        : tipo === 'excel_external'
          ? html`
              <div class="conecta-provas-excel-rules">
                <strong>Regras da etapa de Excel</strong>
                <ul>
                  <li>Baixe a planilha da prova.</li>
                  <li>Responda no arquivo baixado.</li>
                  <li>Execute a atividade no Excel ou LibreOffice Calc.</li>
                  <li>Não altere o nome do arquivo.</li>
                  <li>Não envie arquivo de outro candidato.</li>
                  <li>Salve antes de anexar.</li>
                  <li>Confira o arquivo antes de avançãr.</li>
                  <li>Envie apenas o arquivo final.</li>
                </ul>
              </div>
              <${PerguntaExcel}
                questao=${questao}
                resposta=${resposta}
                nomeCandidato=${nomeCandidato}
                onChange=${(respostaExcel) => {
              const { uploadedArrayBuffer: _buffer, ...serializavel } = respostaExcel || {};
              onResposta(serializavel);
            }}
              />
            `
          : html`
              <${EditorTextoRich}
                valor=${resposta?.content || resposta?.text || ''}
                limiteCaracteres=${limiteCaracteres}
                textoAjuda=${ehRedacao ? ORIENTACAO_REDACAO : ''}
                mostrarContador=${!ehRedacao}
                onChange=${(content) => {
              const limitado = limitarConteudoTexto(content, limiteCaracteres);
              onResposta({ type: 'word', content: limitado.content, text: limitado.text });
            }}
              />
            `}
    </section>
  `;
}

function TelaRevisao({
  sessao,
  respostas,
  etapasIgnoradas = [],
  onEditar,
  onVoltar,
  onFinalizar,
  carregando,
  erro,
}) {
  const questoes = sessao?.prova?.questoes || [];
  const pendencias = obterPendenciasObrigatorias(questoes, respostas, etapasIgnoradas);
  const respondidas = questoes.length - pendencias.length;
  const possuiRedacao = questoes.some(etapaEhRedacao);
  const possuiExcel = questoes.some((questao) => questao.type === 'excel_external');
  const possuiWord = questoes.some(etapaEhWord);

  return html`
    <section class="conecta-provas-card conecta-provas-card-wide">
      <div class="conecta-provas-step">Revisão</div>
      <h1>Revise sua prova</h1>
      <p>Confira o preenchimento antes do envio final.</p>
      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}
      <div class="conecta-provas-review-grid">
        <span><strong>Etapas</strong>${obterResumoEtapas(sessao?.prova || {}).length}</span>
        <span><strong>Itens completos</strong>${respondidas}/${questoes.length}</span>
        <span><strong>Pendentes</strong>${pendencias.length}</span>
        <span><strong>redação</strong>${possuiRedacao ? 'Incluída' : 'Não incluída'}</span>
        <span><strong>Excel</strong>${possuiExcel ? 'Incluído' : 'Não incluído'}</span>
        <span><strong>Word/texto</strong>${possuiWord ? 'Incluído' : 'Não incluído'}</span>
      </div>

      <div class="conecta-provas-review-list">
        ${questoes.map((questao, indice) => {
    const completa = respostaQuestaoPreenchida(questao, respostas[indice]);
    return html`
            <article class=${`conecta-provas-review-item ${completa ? 'is-complete' : 'is-pending'}`} key=${indice}>
              <div>
                <small>${obterLabelEtapa(questao)}</small>
                <strong>${etapaEhRedacao(questao) ? 'redação' : questao.title || `Questão ${indice + 1}`}</strong>
                <p>${descreverRespostaRevisao(questao, respostas[indice])}</p>
              </div>
              <div class="conecta-provas-review-actions">
                <span>${completa ? 'Completa' : 'Pendente'}</span>
                <button type="button" class="btn btn-sm btn-outline-primary" onClick=${() => onEditar(indice)}>
                  Editar
                </button>
              </div>
            </article>
          `;
  })}
      </div>

      <div class="conecta-provas-actions">
        <button type="button" class="btn btn-outline-secondary" disabled=${carregando} onClick=${onVoltar}>
          Voltar e revisar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled=${carregando}
          onClick=${onFinalizar}
        >
          ${carregando ? 'Finalizando...' : 'Finalizar prova'}
        </button>
      </div>
    </section>
  `;
}

function AvisoPendenciasFinalizacao({
  pendencias,
  carregando,
  onFinalizarMesmoAssim,
  onContinuar,
}) {
  const lista = Array.isArray(pendencias) ? pendencias : [];
  return html`
    <div class="conecta-provas-modal-backdrop" role="presentation">
      <section
        class="conecta-provas-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conecta-provas-pendencias-title"
      >
        <div class="conecta-provas-modal-head">
          <span class="material-symbols-outlined">${IconeSvg('warning')}</span>
          <h2 id="conecta-provas-pendencias-title">Existem pendências na sua prova</h2>
        </div>
        <p>Você deseja finalizar mesmo assim ou voltar para revisar?</p>
        ${lista.length
      ? html`
              <ul class="conecta-provas-pending-list">
                ${lista.slice(0, 6).map(
        (item) => html`
                    <li key=${item.indice}>
                      ${`Questão ${item.indice + 1}: ${obterTituloQuestao(item.questao, item.indice)}`}
                    </li>
                  `,
      )}
                ${lista.length > 6
          ? html`<li>${`Mais ${lista.length - 6} pendência(s).`}</li>`
          : null}
              </ul>
            `
      : null}
        <div class="conecta-provas-modal-actions">
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled=${carregando}
            onClick=${onContinuar}
          >
            Continuar respondendo
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled=${carregando}
            onClick=${onFinalizarMesmoAssim}
          >
            ${carregando ? 'Finalizando...' : 'Finalizar mesmo assim'}
          </button>
        </div>
      </section>
    </div>
  `;
}

function ModalConfirmarEnvioProva({
  aberto,
  respondidas,
  total,
  etapasConcluidas,
  totalEtapas,
  carregando,
  onCancelar,
  onConfirmar,
}) {
  if (!aberto) return null;

  return html`
    <div class="conecta-provas-modal-backdrop" role="presentation">
      <section
        class="conecta-provas-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conecta-provas-confirmar-titulo"
      >
        <div class="conecta-provas-modal-head">
          <span class="material-symbols-outlined">${IconeSvg('task_alt')}</span>
          <h2 id="conecta-provas-confirmar-titulo">Confirmar envio da prova</h2>
        </div>
        <p>
          Você respondeu <strong>${respondidas} de ${total}</strong> questões em
          <strong>${etapasConcluidas} de ${totalEtapas}</strong> etapa(s) concluída(s).
        </p>
        <p>Após confirmar o envio, não será possível alterar suas respostas.</p>
        <div class="conecta-provas-modal-actions">
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled=${carregando}
            onClick=${onCancelar}
          >
            Revisar antes de enviar
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled=${carregando}
            onClick=${onConfirmar}
          >
            ${carregando ? 'Enviando...' : 'Confirmar e enviar prova'}
          </button>
        </div>
      </section>
    </div>
  `;
}

function TelaFinalizacao({ onInicio }) {
  return html`
    <section class="conecta-provas-card">
      <div class="conecta-provas-step">Conclusão</div>
      <h1>Sua prova foi finalizada com sucesso.</h1>
      <p>Avise ao RH que você concluiu a avaliação.</p>
      <button type="button" class="btn btn-primary conecta-provas-primary" onClick=${onInicio}>
        Voltar à tela inicial
      </button>
    </section>
  `;
}

export function TelaConectaProvas({ modoPreview = false, sessaoInicial = null, onFecharPreview = null } = {}) {
  const [etapa, setEtapa] = useState(modoPreview ? 'etapas' : 'acesso');
  const [metodo, setMetodo] = useState('email');
  const [valorAcesso, setValorAcesso] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [tentativasEmail, setTentativasEmail] = useState(0);
  const [tentativasTelefone, setTentativasTelefone] = useState(0);
  const [provasEncontradas, setProvasEncontradas] = useState([]);
  const [token, setToken] = useState(modoPreview ? 'preview' : '');
  const [sessao, setSessao] = useState(modoPreview ? sessaoInicial : null);
  const [formularioDados, setFormularioDados] = useState({
    nome_candidato: sessaoInicial?.candidato?.nome_candidato || '',
    email: sessaoInicial?.candidato?.email || '',
    confirmar_email: sessaoInicial?.candidato?.email || '',
    telefone: sessaoInicial?.candidato?.telefone || '',
    whatsapp: sessaoInicial?.candidato?.whatsapp || '',
    cep: sessaoInicial?.candidato?.cep || '',
    endereco: sessaoInicial?.candidato?.endereco || '',
    numero: sessaoInicial?.candidato?.numero || '',
    bairro: sessaoInicial?.candidato?.bairro || '',
    cidade: sessaoInicial?.candidato?.cidade || '',
    idade: sessaoInicial?.candidato?.idade || '',
    escolaridade: sessaoInicial?.candidato?.escolaridade || '',
  });
  const [respostas, setRespostas] = useState([]);
  const [indiceAtual, setIndiceAtual] = useState(0);
  const [etapaSelecionadaKey, setEtapaSelecionadaKey] = useState('');
  const [timestampTermino, setTimestampTermino] = useState(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const [timestampTerminoEtapa, setTimestampTerminoEtapa] = useState(null);
  const [segundosRestantesEtapa, setSegundosRestantesEtapa] = useState(null);
  const [pendenciasFinalizacao, setPendenciasFinalizacao] = useState([]);
  const [confirmarFinalizacaoAberta, setConfirmarFinalizacaoAberta] = useState(false);
  const interrupcaoRegistradaRef = useRef(false);
  const telemetriaRef = useRef({
    porQuestao: {},
    indiceAtivo: null,
    acessoAtivoEm: 0,
    ordemResposta: 0,
    etapaIniciadaEm: '',
  });
  const contextoInterrupcaoRef = useRef({
    token: '',
    respostas: [],
    etapaSelecionadaKey: '',
    indiceAtual: 0,
    etapa: '',
  });

  useEffect(() => {
    if (modoPreview) return;
    const salvo = sessionStorage.getItem(CHAVE_TOKEN_PUBLICO) || localStorage.getItem(CHAVE_TOKEN_PUBLICO) || '';
    if (!salvo) return;
    selecionarToken(salvo, { silencioso: true });
  }, []);

  useEffect(() => {
    if (!timestampTermino || etapa !== 'prova') return undefined;
    const atualizar = () => {
      const restante = Math.max(0, Math.floor((timestampTermino - Date.now()) / 1000));
      setSegundosRestantes(restante);
    };
    atualizar();
    const intervalo = window.setInterval(atualizar, 1000);
    return () => window.clearInterval(intervalo);
  }, [timestampTermino, etapa]);

  const questoes = sessao?.prova?.questoes || [];
  const questaoAtual = questoes[indiceAtual] || null;

  const acumularTempoQuestaoAtiva = () => {
    const estado = telemetriaRef.current;
    if (estado.indiceAtivo === null || !estado.acessoAtivoEm) return;
    const item = estado.porQuestao[estado.indiceAtivo];
    if (item) {
      const decorrido = Math.max(0, Math.min(300, (Date.now() - estado.acessoAtivoEm) / 1000));
      item.tempo_ativo_segundos = Math.min(86400, Number(item.tempo_ativo_segundos || 0) + decorrido);
    }
    estado.acessoAtivoEm = Date.now();
  };

  const garantirMetricaQuestao = (indice) => {
    const estado = telemetriaRef.current;
    if (!estado.porQuestao[indice]) {
      const agora = new Date().toISOString();
      const questao = questoes[indice] || {};
      estado.porQuestao[indice] = {
        questao_indice: indice,
        questao_id: String(questao.id || questao.questionId || questao.title || `q-${indice + 1}`),
        etapa_chave: obterGrupoJornadaQuestao(questao, indice).key,
        categoria_chave: String(questao.category || questao.stageKey || questao.stage || ''),
        primeiro_acesso_em: agora,
        ultima_alteracao_em: '',
        tempo_ativo_segundos: 0,
        quantidade_alteracoes: 0,
        ordem_resposta: null,
        tamanho_resposta_final: estimarTamanhoRespostaAnalitica(respostas[indice]),
        evento_colagem: false,
        quantidade_colagens: 0,
        tamanho_colagem_aproximado: 0,
      };
    }
    return estado.porQuestao[indice];
  };

  const registrarAcessoQuestao = (indice) => {
    acumularTempoQuestaoAtiva();
    garantirMetricaQuestao(indice);
    telemetriaRef.current.indiceAtivo = indice;
    telemetriaRef.current.acessoAtivoEm = Date.now();
  };

  const registrarAlteracaoQuestao = (indice, resposta) => {
    const item = garantirMetricaQuestao(indice);
    item.quantidade_alteracoes += 1;
    item.ultima_alteracao_em = new Date().toISOString();
    item.tamanho_resposta_final = estimarTamanhoRespostaAnalitica(resposta);
    if (item.tamanho_antes_colagem !== undefined) {
      item.tamanho_colagem_aproximado = Math.max(
        Number(item.tamanho_colagem_aproximado || 0),
        item.tamanho_resposta_final - Number(item.tamanho_antes_colagem || 0),
      );
      delete item.tamanho_antes_colagem;
    }
    if (!item.ordem_resposta && item.tamanho_resposta_final > 0) {
      telemetriaRef.current.ordemResposta += 1;
      item.ordem_resposta = telemetriaRef.current.ordemResposta;
    }
  };

  const registrarColagemQuestao = (indice) => {
    const item = garantirMetricaQuestao(indice);
    item.evento_colagem = true;
    item.quantidade_colagens += 1;
    // O conteudo da area de transferencia nunca e lido nem persistido; o tamanho
    // e apenas estimado pela diferenca da resposta antes/depois do evento.
    item.tamanho_antes_colagem = estimarTamanhoRespostaAnalitica(respostas[indice]);
  };

  const montarPayloadTelemetria = ({ finalizarEtapa = false } = {}) => {
    acumularTempoQuestaoAtiva();
    const telemetria = Object.values(telemetriaRef.current.porQuestao).map((item) => {
      const { tamanho_antes_colagem: _interno, ...publico } = item;
      return {
        ...publico,
        tempo_ativo_segundos: Number(Number(item.tempo_ativo_segundos || 0).toFixed(3)),
        tamanho_resposta_final: estimarTamanhoRespostaAnalitica(respostas[item.questao_indice]),
      };
    });
    const tempoEtapa = telemetria
      .filter((item) => item.etapa_chave === etapaSelecionadaKey)
      .reduce((total, item) => total + Number(item.tempo_ativo_segundos || 0), 0);
    return {
      telemetria,
      etapa_iniciada_em: telemetriaRef.current.etapaIniciadaEm,
      etapa_finalizada_em: finalizarEtapa ? new Date().toISOString() : '',
      tempo_ativo_etapa_segundos: Number(tempoEtapa.toFixed(3)),
    };
  };

  useEffect(() => {
    if (etapa !== 'prova' || !questaoAtual) return;
    registrarAcessoQuestao(indiceAtual);
  }, [etapa, indiceAtual, etapaSelecionadaKey]);

  useEffect(() => {
    if (etapa !== 'prova') return undefined;
    const atualizarVisibilidade = () => {
      if (document.hidden) {
        acumularTempoQuestaoAtiva();
        telemetriaRef.current.acessoAtivoEm = 0;
      } else if (telemetriaRef.current.indiceAtivo !== null) {
        telemetriaRef.current.acessoAtivoEm = Date.now();
      }
    };
    document.addEventListener('visibilitychange', atualizarVisibilidade);
    return () => document.removeEventListener('visibilitychange', atualizarVisibilidade);
  }, [etapa]);
  const etapasJornada = useMemo(
    () => montarEtapasJornada(sessao?.prova || {}, respostas, Boolean(sessao?.candidato?.dados_confirmados)),
    [sessao?.prova, sessao?.candidato?.dados_confirmados, respostas],
  );
  const etapaJornadaAtiva = etapasJornada.find((item) => item.key === etapaSelecionadaKey) || null;
  const indicesEtapaAtiva = etapaJornadaAtiva?.indices || [];
  const posicaoNaEtapa = indicesEtapaAtiva.indexOf(indiceAtual);
  const etapasIgnoradasPorInterrupcao = useMemo(
    () => etapasJornada.filter((item) => item.status === 'indisponivel').map((item) => item.key),
    [etapasJornada],
  );
  const progresso = useMemo(
    () => (questoes.length ? Math.round(((indiceAtual + 1) / questoes.length) * 100) : 0),
    [indiceAtual, questoes.length],
  );
  const posicaoEtapaJornada = etapasJornada.findIndex((item) => item.key === etapaSelecionadaKey);
  const numeroEtapaAtual = posicaoEtapaJornada >= 0 ? posicaoEtapaJornada + 1 : null;
  const totalEtapasJornada = etapasJornada.length;
  const etapasConcluidasJornada = etapasJornada.filter(
    (item) => item.status === 'concluida' || item.status === 'indisponivel',
  ).length;

  contextoInterrupcaoRef.current = {
    token,
    respostas,
    etapaSelecionadaKey,
    indiceAtual,
    etapa,
    telemetria: etapa === 'prova' ? montarPayloadTelemetria({ finalizarEtapa: true }) : {},
  };

  const marcarEtapaIndisponivel = (etapaKey) => {
    setSessao((anterior) =>
      atualizarEstadoEtapaSessao(anterior, etapaKey, { status: 'realizada', indisponivel: true }),
    );
  };

  const registrarInterrupcaoAtual = async ({ beacon = false } = {}) => {
    const contexto = contextoInterrupcaoRef.current || {};
    if (
      interrupcaoRegistradaRef.current ||
      contexto.etapa !== 'prova' ||
      !contexto.token ||
      !contexto.etapaSelecionadaKey
    ) {
      return false;
    }
    interrupcaoRegistradaRef.current = true;
    const payload = {
      token: contexto.token,
      respostas: contexto.respostas,
      etapa_chave: contexto.etapaSelecionadaKey,
      questao_indice: contexto.indiceAtual,
      ...(contexto.telemetria || {}),
    };
    if (beacon && navigator?.sendBeacon) {
      const corpo = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/conecta-provas-api/interromper-etapa', corpo);
      return true;
    }
    await interromperEtapaConectaProvas(
      contexto.token,
      contexto.respostas,
      contexto.etapaSelecionadaKey,
      contexto.indiceAtual,
      contexto.telemetria || {},
    );
    telemetriaRef.current.indiceAtivo = null;
    telemetriaRef.current.acessoAtivoEm = 0;
    marcarEtapaIndisponivel(contexto.etapaSelecionadaKey);
    setTimestampTerminoEtapa(null);
    setSegundosRestantesEtapa(null);
    setEtapa('confirmacao-etapas');
    return true;
  };

  useEffect(() => {
    if (modoPreview || etapa !== 'prova' || !token || !etapaSelecionadaKey) return undefined;
    const confirmarSaidaInterna = () => {
      if (!window.confirm(AVISO_SAIDA_ETAPA)) {
        window.history.pushState({ conectaProvasEtapa: true }, '', window.location.href);
        return;
      }
      registrarInterrupcaoAtual().catch(() => {
        setErro('Não foi possível registrar a saída desta etapa agora.');
      });
    };
    const avisarSaida = (event) => {
      event.preventDefault();
      event.returnValue = AVISO_SAIDA_ETAPA;
      return AVISO_SAIDA_ETAPA;
    };
    const persistirSaidaConfirmada = () => {
      registrarInterrupcaoAtual({ beacon: true }).catch(() => {});
    };

    window.history.pushState({ conectaProvasEtapa: true }, '', window.location.href);
    window.addEventListener('beforeunload', avisarSaida);
    window.addEventListener('pagehide', persistirSaidaConfirmada);
    window.addEventListener('popstate', confirmarSaidaInterna);
    window.addEventListener('hashchange', confirmarSaidaInterna);
    return () => {
      window.removeEventListener('beforeunload', avisarSaida);
      window.removeEventListener('pagehide', persistirSaidaConfirmada);
      window.removeEventListener('popstate', confirmarSaidaInterna);
      window.removeEventListener('hashchange', confirmarSaidaInterna);
    };
  }, [etapa, token, etapaSelecionadaKey]);

  useEffect(() => {
    if (modoPreview || !timestampTerminoEtapa || etapa !== 'prova') return undefined;
    const atualizar = () => {
      const restante = Math.max(0, Math.floor((timestampTerminoEtapa - Date.now()) / 1000));
      setSegundosRestantesEtapa(restante);
      if (restante <= 0) {
        registrarInterrupcaoAtual().catch(() => {
          setErro('O tempo desta etapa esgotou, mas não foi possível registrar automaticamente. Tente concluir a etapa.');
        });
      }
    };
    atualizar();
    const intervalo = window.setInterval(atualizar, 1000);
    return () => window.clearInterval(intervalo);
  }, [timestampTerminoEtapa, etapa]);

  const selecionarToken = async (tokenSelecionado, opcoes = {}) => {
    if (!tokenSelecionado) return;
    setCarregando(true);
    setErro('');
    try {
      const dados = await lerSessaoConectaProvas(tokenSelecionado);
      telemetriaRef.current = {
        porQuestao: {},
        indiceAtivo: null,
        acessoAtivoEm: 0,
        ordemResposta: 0,
        etapaIniciadaEm: '',
      };
      setToken(tokenSelecionado);
      sessionStorage.setItem(CHAVE_TOKEN_PUBLICO, tokenSelecionado);
      localStorage.setItem(CHAVE_TOKEN_PUBLICO, tokenSelecionado);
      setSessao(dados);
      setFormularioDados({
        nome_candidato: dados?.candidato?.nome_candidato || '',
        email: dados?.candidato?.email || '',
        confirmar_email: dados?.candidato?.dados_confirmados ? dados?.candidato?.email || '' : '',
        telefone: dados?.candidato?.telefone || '',
        whatsapp: dados?.candidato?.whatsapp || dados?.candidato?.telefone || '',
        cep: dados?.candidato?.cep || '',
        endereco: dados?.candidato?.endereco || '',
        numero: dados?.candidato?.numero || '',
        bairro: dados?.candidato?.bairro || '',
        cidade: dados?.candidato?.cidade || '',
        idade: dados?.candidato?.idade ?? '',
        escolaridade: dados?.candidato?.escolaridade || '',
      });
      const listaQuestoes = dados?.prova?.questoes || [];
      const respostasSalvas = Array.isArray(dados?.respostas)
        ? dados.respostas
        : Array.isArray(dados?.prova?.respostas)
          ? dados.prova.respostas
          : [];
      setRespostas(listaQuestoes.map((questao, indice) => respostasSalvas[indice] || obterRespostaInicial(questao)));
      setSegundosRestantes(obterTempoTotalSegundos(dados));
      setTimestampTermino(null);
      if (dados?.prova?.finalizada) {
        setEtapa('finalizacao');
      } else {
        setEtapa('etapas');
      }
    } catch (error) {
      if (!opcoes.silencioso) {
        sessionStorage.removeItem(CHAVE_TOKEN_PUBLICO);
        localStorage.removeItem(CHAVE_TOKEN_PUBLICO);
      }
      if (!opcoes.silencioso) {
        setErro(error?.message || ERRO_GENERICO);
      }
    } finally {
      setCarregando(false);
    }
  };

  const executarAcesso = async () => {
    setCarregando(true);
    setErro('');
    setProvasEncontradas([]);
    try {
      let resposta;
      if (metodo === 'email') {
        if (!validarEmail(valorAcesso)) {
          setErro('Informe um e-mail válido.');
          setTentativasEmail((valor) => valor + 1);
          return;
        }
        resposta = await acessarProvaPorEmail(valorAcesso.trim().toLowerCase());
      } else if (metodo === 'telefone') {
        if (!validarTelefone(valorAcesso)) {
          setErro('Informe um telefone válido.');
          setTentativasTelefone((valor) => valor + 1);
          return;
        }
        resposta = await acessarProvaPorTelefone(valorAcesso);
      } else {
        const codigo = valorAcesso.toUpperCase().replace(/\s+/g, '');
        if (!validarCodigo(codigo)) {
          setErro('Código inválido ou prova indisponível. Verifique com o RH.');
          return;
        }
        resposta = await acessarProvaPorCodigo(codigo);
      }

      if (!resposta?.success || !resposta?.provas?.length) {
        if (metodo === 'email') setTentativasEmail((valor) => valor + 1);
        if (metodo === 'telefone') setTentativasTelefone((valor) => valor + 1);
        setErro(
          metodo === 'telefone'
            ? ERRO_GENERICO_TELEFONE
            : resposta?.message || ERRO_GENERICO,
        );
        return;
      }

      if (resposta.provas.length === 1) {
        await selecionarToken(resposta.provas[0].token);
        return;
      }
      setProvasEncontradas(resposta.provas);
    } catch (error) {
      if (metodo === 'email') setTentativasEmail((valor) => valor + 1);
      if (metodo === 'telefone') setTentativasTelefone((valor) => valor + 1);
      setErro(error?.message || ERRO_GENERICO);
    } finally {
      setCarregando(false);
    }
  };

  const confirmarDados = async () => {
    if (!normalizarTexto(formularioDados.nome_candidato)) {
      setErro('Informe seu nome completo.');
      return;
    }
    if (!validarEmail(formularioDados.email)) {
      setErro('Informe um e-mail válido.');
      return;
    }
    if (normalizarTexto(formularioDados.confirmar_email).toLowerCase() !== normalizarTexto(formularioDados.email).toLowerCase()) {
      setErro('A confirmação do e-mail deve ser igual ao e-mail informado.');
      return;
    }
    if (!validarTelefone(formularioDados.telefone)) {
      setErro('Informe um telefone válido.');
      return;
    }
    if (!validarTelefone(formularioDados.whatsapp)) {
      setErro('Informe um WhatsApp válido.');
      return;
    }
    const camposObrigatorios = ['cep', 'endereco', 'numero', 'bairro', 'cidade', 'idade', 'escolaridade'];
    if (camposObrigatorios.some((campo) => !normalizarTexto(formularioDados[campo]))) {
      setErro('Preencha todos os dados pessoais e de endereço antes de continuar.');
      return;
    }
    setCarregando(true);
    setErro('');
    try {
      if (!modoPreview) {
        await confirmarDadosConectaProvas({ token, ...formularioDados, idade: Number(formularioDados.idade) });
      }
      setSessao((anterior) => ({
        ...anterior,
        candidato: { ...formularioDados, idade: Number(formularioDados.idade), dados_confirmados: true },
      }));
      setEtapa('etapas');
    } catch (error) {
      setErro(error?.message || 'Não foi possível confirmar seus dados.');
    } finally {
      setCarregando(false);
    }
  };

  const iniciar = async (etapaJornada = null) => {
    if (etapaJornada?.indisponivel || etapaJornada?.status === 'indisponivel') {
      setErro('Esta etapa já foi realizada e não está disponível para nova execução.');
      return;
    }
    setCarregando(true);
    setErro('');
    try {
      const provaJaIniciada = Boolean(sessao?.prova?.iniciada_em);
      const inicio = provaJaIniciada || modoPreview ? {} : await iniciarConectaProvas(token);
      const sessaoAtualizada = {
        ...sessao,
        prova: {
          ...(sessao?.prova || {}),
          iniciada_em: inicio?.iniciada_em || sessao?.prova?.iniciada_em || new Date().toISOString(),
          tempo_total: inicio?.tempo_total || sessao?.prova?.tempo_total || 40,
        },
      };
      setSessao(sessaoAtualizada);
      const timestamp = calcularTimestampTermino(sessaoAtualizada, token);
      salvarTimestampTimer(token, timestamp);
      setTimestampTermino(timestamp);
      setSegundosRestantes(Math.max(1, Math.floor((timestamp - Date.now()) / 1000)));
      const primeiroIndice = etapaJornada?.indices?.[0] ?? 0;
      const etapaKey = etapaJornada?.key || obterGrupoJornadaQuestao(questoes[primeiroIndice], primeiroIndice).key;
      const etapaIniciadaEm = new Date().toISOString();
      telemetriaRef.current.indiceAtivo = null;
      telemetriaRef.current.acessoAtivoEm = 0;
      telemetriaRef.current.etapaIniciadaEm = etapaIniciadaEm;
      setEtapaSelecionadaKey(etapaKey);
      setIndiceAtual(primeiroIndice);
      interrupcaoRegistradaRef.current = false;
      setEtapa('prova');
      if (!modoPreview) {
        iniciarEtapaConectaProvas(token, etapaKey, primeiroIndice, etapaIniciadaEm).catch(() => {});
      }

      const { duracaoMinutos, toleranciaMinutos } = obterConfiguracaoTempoEtapa(
        sessaoAtualizada?.prova,
        etapaJornada,
      );
      if (duracaoMinutos > 0) {
        const timestampEtapa = calcularTimestampTerminoEtapa(
          token,
          etapaKey,
          etapaIniciadaEm,
          duracaoMinutos,
          toleranciaMinutos,
        );
        salvarTimestampTimerEtapa(token, etapaKey, timestampEtapa);
        setTimestampTerminoEtapa(timestampEtapa);
        setSegundosRestantesEtapa(Math.max(1, Math.floor((timestampEtapa - Date.now()) / 1000)));
      } else {
        setTimestampTerminoEtapa(null);
        setSegundosRestantesEtapa(null);
      }
    } catch (error) {
      setErro(error?.message || 'Não foi possível iniciar a prova.');
    } finally {
      setCarregando(false);
    }
  };

  const salvarParcial = async (proximIndice = indiceAtual) => {
    if (
      proximIndice > indiceAtual &&
      questaoAtual?.type === 'excel_external' &&
      !respostaQuestaoPreenchida(questaoAtual, respostas[indiceAtual])
    ) {
      setErro('Anexe o arquivo Excel respondido antes de avançar nesta etapa.');
      return;
    }

    if (!modoPreview) {
      await salvarRespostasConectaProvas(token, respostas, montarPayloadTelemetria());
    }
    setIndiceAtual(Math.max(0, Math.min(questoes.length - 1, proximIndice)));
    setErro('');
  };

  const concluirEtapaAtual = async () => {
    if (posicaoNaEtapa < indicesEtapaAtiva.length - 1) {
      setErro('Avance até a última questão desta etapa antes de concluir.');
      return;
    }
    setCarregando(true);
    setErro('');
    try {
      if (!modoPreview) {
        await concluirEtapaConectaProvas(
          token,
          respostas,
          etapaSelecionadaKey,
          indiceAtual,
          montarPayloadTelemetria({ finalizarEtapa: true }),
        );
      }
      telemetriaRef.current.indiceAtivo = null;
      telemetriaRef.current.acessoAtivoEm = 0;
      interrupcaoRegistradaRef.current = true;
      setSessao((anterior) =>
        atualizarEstadoEtapaSessao(anterior, etapaSelecionadaKey, { status: 'concluida' }),
      );
      setTimestampTerminoEtapa(null);
      setSegundosRestantesEtapa(null);
      setEtapa('confirmacao-etapas');
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar esta etapa agora.');
    } finally {
      setCarregando(false);
    }
  };

  const irParaRevisao = async () => {
    setCarregando(true);
    setErro('');
    try {
      const pendencias = obterPendenciasObrigatorias(questoes, respostas, etapasIgnoradasPorInterrupcao);
      if (pendencias.length) {
        setIndiceAtual(pendencias[0].indice);
        setErro('Preencha todas as etapas obrigatórias antes de revisar a prova.');
        setCarregando(false);
        return;
      }
      if (!modoPreview) {
        await marcarRevisaoConectaProvas(token, respostas, montarPayloadTelemetria());
      }
      setEtapa('revisao');
    } catch (error) {
      setErro(error?.message || 'Não foi possível preparar a revisão.');
    } finally {
      setCarregando(false);
    }
  };

  const finalizar = async ({ finalizarMesmoComPendencias = false } = {}) => {
    setCarregando(true);
    setErro('');
    try {
      const pendencias = obterPendenciasObrigatorias(questoes, respostas, etapasIgnoradasPorInterrupcao);
      if (pendencias.length && !finalizarMesmoComPendencias) {
        setPendenciasFinalizacao(pendencias);
        setCarregando(false);
        return;
      }
      if (!modoPreview) {
        await finalizarConectaProvas(token, respostas, {
          finalizarMesmoAssim: finalizarMesmoComPendencias,
          telemetria: montarPayloadTelemetria({ finalizarEtapa: true }),
        });
        sessionStorage.removeItem(CHAVE_TOKEN_PUBLICO);
        localStorage.removeItem(CHAVE_TOKEN_PUBLICO);
        limparTimestampTimer(token);
      }
      setPendenciasFinalizacao([]);
      setEtapa('finalizacao');
    } catch (error) {
      setErro(error?.message || 'Não foi possível finalizar a prova.');
    } finally {
      setCarregando(false);
    }
  };

  const solicitarFinalizacao = async () => {
    setCarregando(true);
    setErro('');
    try {
      if (!modoPreview) {
        await salvarRespostasConectaProvas(token, respostas, montarPayloadTelemetria());
      }
      const pendencias = obterPendenciasObrigatorias(questoes, respostas, etapasIgnoradasPorInterrupcao);
      if (pendencias.length) {
        setPendenciasFinalizacao(pendencias);
        return;
      }
      setConfirmarFinalizacaoAberta(true);
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar suas respostas antes de finalizar.');
    } finally {
      setCarregando(false);
    }
  };

  const continuarRespondendoPendencias = () => {
    const primeira = pendenciasFinalizacao[0];
    setPendenciasFinalizacao([]);
    if (primeira) {
      setIndiceAtual(primeira.indice);
      setEtapa('prova');
      setErro('Revise as pendências destacadas antes de finalizar.');
    }
  };

  const voltarInicio = () => {
    sessionStorage.removeItem(CHAVE_TOKEN_PUBLICO);
    localStorage.removeItem(CHAVE_TOKEN_PUBLICO);
    limparTimestampTimer(token);
    setEtapa('acesso');
    setMetodo('email');
    setValorAcesso('');
    setErro('');
    setToken('');
    setSessao(null);
    setRespostas([]);
    setIndiceAtual(0);
    setEtapaSelecionadaKey('');
    telemetriaRef.current = {
      porQuestao: {},
      indiceAtivo: null,
      acessoAtivoEm: 0,
      ordemResposta: 0,
      etapaIniciadaEm: '',
    };
    setTentativasEmail(0);
    setTentativasTelefone(0);
    window.history.replaceState(null, '', '/conecta-provas');
  };

  return html`
    <main class=${`conecta-provas-shell ${etapa === 'acesso' ? 'is-access-view' : ''} ${etapa === 'etapas' || etapa === 'confirmacao-etapas' ? 'is-steps-view' : ''}`.trim()}>
      ${modoPreview
      ? html`
            <div class="conecta-provas-preview-banner">
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('visibility')}</span>
              <span>Modo pré-visualização (RH) — nenhuma resposta é salva.</span>
              ${onFecharPreview
          ? html`
                  <button type="button" class="btn btn-sm btn-outline-light" onClick=${onFecharPreview}>
                    Fechar pré-visualização
                  </button>
                `
          : null}
            </div>
          `
      : null}
      ${etapa === 'acesso'
      ? html`
            <${TelaAcesso}
              metodo=${metodo}
              valor=${valorAcesso}
              erro=${erro}
              carregando=${carregando}
              tentativasEmail=${tentativasEmail}
              tentativasTelefone=${tentativasTelefone}
              provas=${provasEncontradas}
              onValor=${setValorAcesso}
              onSubmit=${executarAcesso}
              onSelecionar=${(prova) => selecionarToken(prova.token)}
              onMetodo=${(novoMetodo) => {
          setMetodo(novoMetodo);
          setValorAcesso('');
          setErro('');
        }}
            />
          `
      : null}
      ${etapa === 'confirmacao'
      ? html`
            <${TelaConfirmacao}
              sessao=${sessao}
              formulario=${formularioDados}
              erro=${erro}
              salvando=${carregando}
              onChange=${setFormularioDados}
              onConfirmar=${confirmarDados}
            />
          `
      : null}
      ${etapa === 'etapas' || etapa === 'confirmacao-etapas'
      ? html`
            <${TelaEtapasProva}
              sessao=${sessao}
              respostas=${respostas}
              etapasIgnoradas=${etapasIgnoradasPorInterrupcao}
              carregando=${carregando}
              erro=${erro}
              confirmacao=${etapa === 'confirmacao-etapas'}
              cadastroConcluido=${Boolean(sessao?.candidato?.dados_confirmados)}
              onIniciar=${iniciar}
              onCadastro=${() => setEtapa('confirmacao')}
              onVoltar=${voltarInicio}
              onFinalizar=${solicitarFinalizacao}
            />
          `
      : null}
      ${etapa === 'regras'
      ? html`
            <${TelaRegras}
              sessao=${sessao}
              onIniciar=${iniciar}
              carregando=${carregando}
              erro=${erro}
            />
          `
      : null}
      ${etapa === 'prova' && questaoAtual
      ? html`
            <div class="conecta-provas-progress-wrap">
              <div class="conecta-provas-progress-label">
                <span>${numeroEtapaAtual ? `Etapa ${numeroEtapaAtual} de ${totalEtapasJornada}` : 'Prova em andamento'}</span>
                <span>${etapasConcluidasJornada} de ${totalEtapasJornada} etapas concluídas</span>
              </div>
              <div class="conecta-provas-progress-track">
                <div class="conecta-provas-progress-bar" style=${{ width: `${progresso}%` }}></div>
              </div>
            </div>
            <${QuestaoProva}
              questao=${questaoAtual}
              resposta=${respostas[indiceAtual]}
              indice=${posicaoNaEtapa >= 0 ? posicaoNaEtapa : indiceAtual}
              total=${indicesEtapaAtiva.length || questoes.length}
              tempoRestante=${timestampTermino ? segundosRestantes : obterTempoTotalSegundos(sessao)}
              tempoRestanteEtapa=${timestampTerminoEtapa ? segundosRestantesEtapa : null}
              progresso=${progresso}
              nomeCandidato=${formularioDados.nome_candidato || sessao?.candidato?.nome_candidato}
              onResposta=${(resposta) =>
          setRespostas((anteriores) => {
            const proximas = [...anteriores];
            proximas[indiceAtual] = resposta;
            registrarAlteracaoQuestao(indiceAtual, resposta);
            return proximas;
          })}
              onColagem=${() => registrarColagemQuestao(indiceAtual)}
            />
            ${erro ? html`<div class="alert alert-warning conecta-provas-error">${erro}</div>` : null}
            <div class="conecta-provas-nav">
              <button
                type="button"
                class="btn btn-outline-secondary-avr"
                disabled=${posicaoNaEtapa <= 0 || carregando}
                onClick=${() => salvarParcial(indicesEtapaAtiva[posicaoNaEtapa - 1])}
              >
                Anterior
              </button>
              ${posicaoNaEtapa >= 0 && posicaoNaEtapa < indicesEtapaAtiva.length - 1
          ? html`<button type="button" class="btn btn-primary" disabled=${carregando} onClick=${() => salvarParcial(indicesEtapaAtiva[posicaoNaEtapa + 1])}>Avançar</button>`
          : html`<button type="button" class="btn btn-primary" disabled=${carregando} onClick=${concluirEtapaAtual}>${carregando ? 'Salvando...' : 'Concluir etapa'}</button>`}
            </div>
          `
      : null}
      ${etapa === 'revisao'
      ? html`
            <${TelaRevisao}
              sessao=${sessao}
              respostas=${respostas}
              carregando=${carregando}
              erro=${erro}
              onVoltar=${() => setEtapa('prova')}
              onEditar=${(indice) => {
          setIndiceAtual(indice);
          setEtapa('prova');
          setErro('');
        }}
              onFinalizar=${solicitarFinalizacao}
            />
          `
      : null}
      ${etapa === 'finalizacao' ? html`<${TelaFinalizacao} onInicio=${voltarInicio} />` : null}
      ${pendenciasFinalizacao.length
      ? html`
            <${AvisoPendenciasFinalizacao}
              pendencias=${pendenciasFinalizacao}
              carregando=${carregando}
              onContinuar=${continuarRespondendoPendencias}
              onFinalizarMesmoAssim=${() => finalizar({ finalizarMesmoComPendencias: true })}
            />
          `
      : null}
      <${ModalConfirmarEnvioProva}
        aberto=${confirmarFinalizacaoAberta}
        respondidas=${questoes.length - obterPendenciasObrigatorias(questoes, respostas, etapasIgnoradasPorInterrupcao).length}
        total=${questoes.length}
        etapasConcluidas=${etapasConcluidasJornada}
        totalEtapas=${totalEtapasJornada}
        carregando=${carregando}
        onCancelar=${() => setConfirmarFinalizacaoAberta(false)}
        onConfirmar=${async () => {
          setConfirmarFinalizacaoAberta(false);
          await finalizar({ finalizarMesmoComPendencias: false });
        }}
      />
    </main>
  `;
}
