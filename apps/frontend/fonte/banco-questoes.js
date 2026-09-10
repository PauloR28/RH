const BANCO_QUESTOES_URL = '../data/bancoQuestoes.json';
const BANCO_QUESTOES_REFORMULADAS_URL = '../data/bancoQuestoesReformuladas.json';

const CAMPOS_OBRIGATORIOS = [
  'id',
  'ativo',
  'etapa',
  'tipo',
  'vaga',
  'area',
  'nivel',
  'dificuldade',
  'titulo',
  'contexto',
  'enunciado',
  'instrucoes',
  'gabarito',
  'tags',
  'personalizacao',
];

const ETAPAS_VALIDAS = new Set([
  'word',
  'redacao',
  'tecnico',
  'operacional',
  'comportamental',
  'geral',
]);

const TIPOS_VALIDOS = new Set([
  'multipla_escolha',
  'resposta_texto',
  'redacao',
  'verdadeiro_falso',
  'situacional',
  'interpretacao',
  'word',
]);

const NIVEIS_VALIDOS = new Set(['basico', 'intermediario', 'avancado']);
const DIFICULDADES_VALIDAS = new Set(['facil', 'media', 'dificil']);
const CLIENTES_BLOQUEADOS = ['davita', 'crf', 'endoview', 'newe', 'brava'];
const MAX_CARACTERES_REDACAO = 2200;
const MAX_LINHAS_REDACAO = 20;

function ambienteNode() {
  return !!(
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node
  );
}

async function carregarJsonUrl(url) {
  if (ambienteNode()) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(
      readFileSync(new URL(url, import.meta.url), 'utf8'),
    );
  }

  const resposta = await fetch(url, { cache: 'no-store' });
  if (!resposta.ok) {
    throw new Error(
      `Nao foi possivel carregar o banco de questoes (${resposta.status}).`,
    );
  }
  return resposta.json();
}

async function carregarJsonBancoQuestoes() {
  return carregarJsonUrl(BANCO_QUESTOES_URL);
}

async function carregarJsonBancoQuestoesReformuladas() {
  try {
    const dedicado = await carregarJsonUrl(BANCO_QUESTOES_REFORMULADAS_URL);
    return {
      ...dedicado,
      origem: 'bancoQuestoesReformuladas.json',
    };
  } catch (error) {
    console.warn('Banco de questoes reformuladas indisponivel.', error);
    const incorporado = BANCO_QUESTOES?.questoes_reformuladas;
    if (incorporado && typeof incorporado === 'object') {
      return {
        questoes: Array.isArray(incorporado.questoes) ? incorporado.questoes : [],
        questoes_personalizadas: Array.isArray(incorporado.questoes_personalizadas)
          ? incorporado.questoes_personalizadas
          : [],
        origem: 'bancoQuestoes.json',
      };
    }
    return { questoes: [], questoes_personalizadas: [] };
  }
}

const BANCO_QUESTOES = await carregarJsonBancoQuestoes();
const BANCO_QUESTOES_REFORMULADAS = await carregarJsonBancoQuestoesReformuladas();
const VALIDACAO_BANCO_QUESTOES = validarBancoQuestoes(BANCO_QUESTOES);

if (!VALIDACAO_BANCO_QUESTOES.ok) {
  console.error(
    'Banco de questoes invalido. A geracao de provas sera bloqueada.',
    VALIDACAO_BANCO_QUESTOES.erros,
  );
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function textoPreenchido(valor) {
  return String(valor ?? '').trim().length > 0;
}

function normalizarLista(valor) {
  return (Array.isArray(valor) ? valor : [valor])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function somaPesos(criterios) {
  return (Array.isArray(criterios) ? criterios : []).reduce(
    (total, criterio) => total + Number(criterio?.peso || 0),
    0,
  );
}

function textoQuestaoCompleta(questao) {
  return [
    questao?.titulo,
    questao?.contexto,
    questao?.enunciado,
    questao?.instrucoes,
    questao?.texto_base,
    questao?.tema,
  ].join(' ');
}

function validarQuestao(questao, indice, ids, enunciados, opcoes = {}) {
  const erros = [];
  const {
    colecao = 'questoes',
    permitirClientesReais = false,
  } = opcoes;
  const prefixo = `${colecao}[${indice}]`;

  CAMPOS_OBRIGATORIOS.forEach((campo) => {
    if (campo === 'ativo') {
      if (typeof questao?.ativo !== 'boolean') {
        erros.push(`${prefixo}.${campo} deve ser booleano.`);
      }
      return;
    }
    if (campo === 'alternativas') return;
    if (campo === 'tags') {
      if (!Array.isArray(questao?.tags) || !questao.tags.length) {
        erros.push(`${prefixo}.tags deve ter ao menos uma tag.`);
      }
      return;
    }
    if (campo === 'gabarito' || campo === 'personalizacao') {
      if (!questao?.[campo] || typeof questao[campo] !== 'object') {
        erros.push(`${prefixo}.${campo} deve ser objeto preenchido.`);
      }
      return;
    }
    if (!textoPreenchido(questao?.[campo])) {
      erros.push(`${prefixo}.${campo} e obrigatorio.`);
    }
  });

  const id = String(questao?.id || '').trim();
  if (ids.has(id)) erros.push(`${prefixo}.id duplicado: ${id}.`);
  if (id) ids.add(id);

  const enunciado = normalizarTexto(questao?.enunciado);
  if (enunciados.has(enunciado)) {
    erros.push(`${prefixo}.enunciado duplicado: ${questao?.enunciado}.`);
  }
  if (enunciado) enunciados.add(enunciado);

  const etapa = normalizarTexto(questao?.etapa);
  const tipo = normalizarTexto(questao?.tipo);
  const nivel = normalizarTexto(questao?.nivel);
  const dificuldade = normalizarTexto(questao?.dificuldade);

  if (!ETAPAS_VALIDAS.has(etapa)) erros.push(`${prefixo}.etapa invalida.`);
  if (!TIPOS_VALIDOS.has(tipo)) erros.push(`${prefixo}.tipo invalido.`);
  if (!NIVEIS_VALIDOS.has(nivel)) erros.push(`${prefixo}.nivel invalido.`);
  if (!DIFICULDADES_VALIDAS.has(dificuldade)) {
    erros.push(`${prefixo}.dificuldade invalida.`);
  }
  if (etapa === 'excel') erros.push(`${prefixo} nao pode ser Excel.`);

  if (questao?.ativo && !questao?.gabarito) {
    erros.push(`${prefixo} ativa precisa de gabarito.`);
  }

  const gabarito = questao?.gabarito || {};
  const alternativas = Array.isArray(questao?.alternativas)
    ? questao.alternativas
    : [];

  if (
    ['multipla_escolha', 'verdadeiro_falso', 'situacional', 'interpretacao'].includes(
      tipo,
    )
  ) {
    if (!alternativas.length) {
      erros.push(`${prefixo}.alternativas deve ter opcoes.`);
    }
    alternativas.forEach((alternativa, indiceAlternativa) => {
      if (!textoPreenchido(alternativa?.id) || !textoPreenchido(alternativa?.texto)) {
        erros.push(`${prefixo}.alternativas[${indiceAlternativa}] incompleta.`);
      }
    });
    const correta = String(gabarito?.resposta_correta || '').trim();
    if (!correta) {
      erros.push(`${prefixo}.gabarito.resposta_correta e obrigatoria.`);
    } else if (!alternativas.some((item) => String(item.id) === correta)) {
      erros.push(`${prefixo}.gabarito.resposta_correta nao existe nas alternativas.`);
    }
  }

  if (gabarito?.tipo === 'rubrica') {
    const total = somaPesos(gabarito.criterios);
    if (total !== 100) {
      erros.push(`${prefixo}.gabarito.criterios deve somar 100; soma atual ${total}.`);
    }
  }

  if (tipo === 'redacao') {
    if (!textoPreenchido(questao?.tema)) erros.push(`${prefixo}.tema e obrigatorio.`);
    if (!textoPreenchido(questao?.texto_base)) {
      erros.push(`${prefixo}.texto_base e obrigatorio.`);
    }
  }

  if (normalizarTexto(questao?.enunciado).includes('leia a situacao apresentada')) {
    erros.push(`${prefixo}.enunciado usa introducao generica proibida.`);
  }

  const textoCompleto = normalizarTexto(textoQuestaoCompleta(questao));
  if (!permitirClientesReais) {
    CLIENTES_BLOQUEADOS.forEach((cliente) => {
      if (textoCompleto.includes(cliente)) {
        erros.push(`${prefixo} menciona cliente real bloqueado: ${cliente}.`);
      }
    });
  }

  return erros;
}

export function validarBancoQuestoes(banco = {}) {
  const questoes = Array.isArray(banco?.questoes) ? banco.questoes : [];
  const personalizadas = Array.isArray(banco?.questoes_personalizadas)
    ? banco.questoes_personalizadas
    : [];
  const clientesPersonalizacao = Array.isArray(banco?.clientes_personalizacao)
    ? banco.clientes_personalizacao
    : [];
  const erros = [];
  const ids = new Set();
  const enunciados = new Set();
  const clientesDeclarados = new Set(
    clientesPersonalizacao.flatMap((cliente) =>
      normalizarLista([cliente?.id, cliente?.nome]).map(normalizarTexto),
    ),
  );

  if (!questoes.length) {
    erros.push('Banco de questoes vazio ou sem array "questoes".');
  }

  questoes.forEach((questao, indice) => {
    erros.push(...validarQuestao(questao, indice, ids, enunciados));
  });

  personalizadas.forEach((questao, indice) => {
    erros.push(
      ...validarQuestao(questao, indice, ids, enunciados, {
        colecao: 'questoes_personalizadas',
        permitirClientesReais: true,
      }),
    );

    const prefixo = `questoes_personalizadas[${indice}]`;
    if (!textoPreenchido(questao?.cliente_id) || !textoPreenchido(questao?.cliente)) {
      erros.push(`${prefixo} precisa declarar cliente_id e cliente.`);
    }
    if (!Array.isArray(questao?.areas_personalizadas) || !questao.areas_personalizadas.length) {
      erros.push(`${prefixo}.areas_personalizadas deve ter ao menos uma area.`);
    }
    if (clientesDeclarados.size && !clientesDeclarados.has(normalizarTexto(questao?.cliente_id))) {
      erros.push(`${prefixo}.cliente_id nao esta declarado em clientes_personalizacao.`);
    }
  });

  return { ok: erros.length === 0, erros };
}

function garantirBancoValido() {
  if (!VALIDACAO_BANCO_QUESTOES.ok) {
    throw new Error(
      `Banco de questoes invalido: ${VALIDACAO_BANCO_QUESTOES.erros.join(' | ')}`,
    );
  }
}

function obterQuestoesAtivas() {
  garantirBancoValido();
  return BANCO_QUESTOES.questoes.filter((questao) => questao.ativo);
}

function obterQuestoesPersonalizadasAtivas() {
  garantirBancoValido();
  return Array.isArray(BANCO_QUESTOES.questoes_personalizadas)
    ? BANCO_QUESTOES.questoes_personalizadas.filter((questao) => questao.ativo)
    : [];
}

export function mapearStageKeyParaEtapa(stageKey = '') {
  const chave = normalizarTexto(stageKey);
  if (chave.includes('excel')) return 'excel';
  if (chave.includes('word')) return 'word';
  if (chave.includes('essay') || chave.includes('redacao')) return 'redacao';
  if (chave.includes('tech') || chave.includes('analysis')) return 'tecnico';
  if (chave.includes('operational') || chave.includes('operacao')) return 'operacional';
  if (chave.includes('comport') || chave.includes('personalidade') || chave.includes('espontane')) return 'comportamental';
  return 'geral';
}

export function normalizarNivelBanco(valor = '', vaga = '') {
  const chaveVaga = normalizarTexto(vaga);
  const nivel = String(valor || '').trim();

  if (
    chaveVaga.includes('jovem aprendiz') ||
    chaveVaga.includes('estagiario') ||
    chaveVaga.includes('auxiliar') ||
    chaveVaga.includes('operador') ||
    chaveVaga.includes('recepcionista')
  ) {
    return 'basico';
  }

  if (nivel === '1') return 'basico';
  if (nivel === '2' || nivel === '3') return 'intermediario';
  if (nivel === '4') return 'avancado';

  const normalizado = normalizarTexto(nivel);
  if (NIVEIS_VALIDOS.has(normalizado)) return normalizado;
  return 'basico';
}

function normalizarVagaBanco(vaga = '') {
  const chave = normalizarTexto(vaga);
  if (chave.includes('jovem aprendiz')) return 'Jovem Aprendiz';
  if (chave.includes('estagiario')) return 'Estagiário';
  if (chave.includes('auxiliar')) return 'Auxiliar';
  if (chave.includes('assistente')) return 'Assistente';
  if (chave.includes('operador')) return 'Operador de Atendimento';
  if (chave.includes('recepcionista')) return 'Recepcionista';
  if (chave.includes('rh')) return 'RH';
  if (chave === 'dp' || chave.includes('departamento pessoal')) return 'DP';
  if (chave.includes('comercial')) return 'Comercial';
  if (chave.includes('financeiro')) return 'Financeiro';
  if (chave.includes('suporte') || chave.includes('ti') || chave.includes('control desk')) {
    return 'TI/Suporte';
  }
  if (chave.includes('tecnico') || chave.includes('operacional')) {
    return 'Técnico/Operacional';
  }
  if (chave.includes('administrativo') || chave.includes('analista')) {
    return 'Administrativo';
  }
  return vaga || 'Geral';
}

function normalizarAreaBanco(area = '', vaga = '') {
  const chave = normalizarTexto(`${area} ${vaga}`);
  if (chave.includes('ti') || chave.includes('suporte') || chave.includes('control desk')) {
    return 'TI/Suporte';
  }
  if (chave.includes('rh')) return 'RH';
  if (chave === 'dp' || chave.includes('departamento pessoal')) return 'DP';
  if (chave.includes('comercial')) return 'Comercial';
  if (chave.includes('financeiro')) return 'Financeiro';
  if (chave.includes('operacao') || chave.includes('operacional')) {
    return 'Técnico/Operacional';
  }
  if (chave.includes('adm') || chave.includes('gestao') || chave.includes('administrativo')) {
    return 'Administrativo';
  }
  return area || 'Geral';
}

function obterQuestoesReformuladasAtivas(origem = 'neutra') {
  const colecao = origem === 'personalizada'
    ? BANCO_QUESTOES_REFORMULADAS.questoes_personalizadas
    : BANCO_QUESTOES_REFORMULADAS.questoes;
  return Array.isArray(colecao) ? colecao.filter((questao) => questao?.ativo) : [];
}

function extrairPerfilReformulado(blueprint = {}) {
  const label = String(blueprint.label || '').replace(/^Nv\s*\d+\s*-\s*/i, '');
  const chave = normalizarTexto(label);
  const partes = label.split('/').map((item) => item.trim()).filter(Boolean);
  const areaLabel = partes[1] || '';
  const chaveArea = normalizarTexto(areaLabel || label);

  if (chave.includes('jovem aprendiz') || chave.includes('aprendiz')) {
    return { cargo: 'jovem_aprendiz', area: null };
  }
  if (chave.includes('operador')) {
    return { cargo: 'operador', area: null };
  }
  if (chave.includes('supervisor')) {
    return { cargo: 'supervisor', area: null };
  }
  if (chave.includes('planejamento')) {
    return { cargo: 'planejamento', area: null };
  }
  if (chave.includes('estagiario')) {
    let area = null;
    if (chaveArea.includes('ti')) area = 'TI';
    else if (chaveArea.includes('comercial')) area = 'Comercial';
    else if (chaveArea.includes('financeiro')) area = 'Financeiro';
    else if (chaveArea.includes('rh')) area = 'RH';
    else if (chaveArea.includes('operacao')) area = 'Operacao';
    return { cargo: 'estagiario', area };
  }
  return null;
}

function etapaReformuladaPorStage(stageKey = '') {
  const chave = normalizarTexto(stageKey);
  if (chave.includes('excel')) return null;
  if (chave.includes('essay') || chave.includes('redacao') || chave.includes('professional')) {
    return 'redacao';
  }
  if (chave.includes('general')) return 'conhecimentos_gerais';
  if (chave.includes('tech') || chave.includes('analysis')) return 'conhecimentos_tecnicos';
  if (chave.includes('word') || chave.includes('writing_logic')) return 'word';
  return null;
}

function blueprintPossuiStage(blueprint = {}, stageKey = '') {
  return Array.isArray(blueprint?.stages) &&
    blueprint.stages.some((stage) => normalizarTexto(stage?.key) === normalizarTexto(stageKey));
}

function areaReformuladaCorresponde(areaQuestao, areaPerfil) {
  if (!textoPreenchido(areaQuestao)) return true;
  if (!textoPreenchido(areaPerfil)) return true;
  const questao = normalizarTexto(areaQuestao);
  const perfil = normalizarTexto(areaPerfil);
  return questao === perfil || questao.includes(perfil) || perfil.includes(questao);
}

function questaoReformuladaServeAoStage(questao, { perfil, stageKey, blueprint }) {
  if (!questao || questao.cargo !== perfil.cargo) return false;
  const etapa = etapaReformuladaPorStage(stageKey);
  if (!etapa || questao.etapa !== etapa) return false;

  if (questao.etapa === 'conhecimentos_tecnicos') {
    return areaReformuladaCorresponde(questao.area, perfil.area);
  }

  if (questao.cargo === 'estagiario' && questao.etapa === 'word') {
    const numero = Number(questao.numero || 0);
    const stageNormalizado = normalizarTexto(stageKey);
    const temWritingLogic = blueprintPossuiStage(blueprint, 'writing_logic');
    if (stageNormalizado.includes('writing_logic')) return numero >= 6;
    if (temWritingLogic && stageNormalizado.includes('word')) return numero <= 5;
  }

  return true;
}

function obterQuestoesReformuladasParaStage(blueprint = {}, stage = {}) {
  const perfil = extrairPerfilReformulado(blueprint);
  if (!perfil) return null;

  const candidatas = obterQuestoesReformuladasAtivas('neutra')
    .filter((questao) =>
      questaoReformuladaServeAoStage(questao, {
        perfil,
        stageKey: stage.key,
        blueprint,
      }),
    )
    .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));

  return candidatas.length ? candidatas : null;
}

function respostasCompactas(questao = {}) {
  const respostas = questao.gabarito && typeof questao.gabarito === 'object'
    ? questao.gabarito
    : {};
  return Object.fromEntries(
    Object.entries(respostas)
      .map(([id, letra]) => [String(id), String(letra || '').trim().toUpperCase()])
      .filter(([, letra]) => letra),
  );
}

function criteriosReformulados(questao = {}) {
  const rubrica = String(questao.rubricaInterna || '').trim();
  const oQueDeveSerAvaliado = String(questao.oQueDeveSerAvaliado || '').trim();
  const criterios = [
    oQueDeveSerAvaliado
      ? {
        nome: 'O que deve ser avaliado',
        descricao: oQueDeveSerAvaliado,
      }
      : null,
    rubrica
      ? {
        nome: 'Rubrica interna',
        descricao: rubrica,
      }
      : null,
  ].filter(Boolean);
  const peso = criterios.length ? 100 / criterios.length : 0;
  return criterios.map((criterio) => ({ ...criterio, peso }));
}

function requisitosFormatacaoReformulados(questao = {}) {
  const texto = normalizarTexto([
    questao.enunciado,
    questao.oQueDeveSerAvaliado,
  ].join(' '));
  const requisitos = {};
  const comandoFormatacao = '(?:aplique|aplicar|use|utilize|formate|coloque|deixe|mantenha)';

  if (new RegExp(`${comandoFormatacao}.{0,50}negrit`).test(texto)) {
    requisitos.anyBold = true;
  }
  if (new RegExp(`${comandoFormatacao}.{0,50}italic`).test(texto)) {
    requisitos.requiresItalic = true;
  }
  if (new RegExp(`${comandoFormatacao}.{0,50}sublinh`).test(texto)) {
    requisitos.requiresUnderline = true;
  }
  if (new RegExp(`${comandoFormatacao}.{0,50}tachad`).test(texto)) {
    requisitos.requiresStrike = true;
  }

  if (/alinhamento\s+justificad|alinhe.{0,30}justificad|justifique\s+(?:todo\s+)?o\s+texto/.test(texto)) {
    requisitos.requiredAlignment = 'justify';
  } else if (/alinhamento\s+centralizad|centralize/.test(texto)) {
    requisitos.requiredAlignment = 'center';
  } else if (/alinhamento\s+(?:a\s+)?direita|alinhe.{0,30}(?:a\s+)?direita/.test(texto)) {
    requisitos.requiredAlignment = 'right';
  } else if (/alinhamento\s+(?:a\s+)?esquerda|alinhe.{0,30}(?:a\s+)?esquerda/.test(texto)) {
    requisitos.requiredAlignment = 'left';
  }

  const tamanhoFonte = texto.match(/(?:fonte|tamanho).{0,30}\b(12|14|16|18|24)\b/);
  if (tamanhoFonte) requisitos.requiredFontSize = Number(tamanhoFonte[1]);

  if (/lista\s+numerad|numeracao/.test(texto)) {
    requisitos.requiresList = true;
    requisitos.requiredListType = 'ordered';
  } else if (/lista\s+(?:com\s+)?marcadores|marcadores/.test(texto)) {
    requisitos.requiresList = true;
    requisitos.requiredListType = 'unordered';
  } else if (new RegExp(`${comandoFormatacao}.{0,40}lista`).test(texto)) {
    requisitos.requiresList = true;
  }

  return requisitos;
}

function adaptarQuestaoReformuladaParaSistema(questao, contexto) {
  const tipo = normalizarTexto(questao.tipo);
  const base = {
    stageKey: contexto.stageKey,
    stage: contexto.stageLabel,
    title: questao.titulo || `Questao ${questao.numero || ''}`.trim(),
    description: questao.enunciado || '',
    titulo: questao.titulo || `Questao ${questao.numero || ''}`.trim(),
    categoria: contexto.stageLabel,
    enunciadoCandidato: questao.enunciado || '',
    contextoCandidato: '',
    enunciadoQuestao: questao.enunciado || '',
    instrucaoCandidato: '',
    itensOrdenacao: [],
    contextoInternoGeracao: '',
    criteriosAvaliacao: criteriosReformulados(questao).map((criterio) => criterio.descricao),
    respostaEsperadaInterna:
      questao.gabarito || questao.rubricaInterna || questao.oQueDeveSerAvaliado || '',
    points: contexto.points,
    questionBankId: questao.id,
    idQuestaoReformulada: questao.id,
    baseNeutraId: questao.base_neutra_id || '',
    origemBancoReformulado: questao.origemArquivo || 'bancoQuestoesReformuladas.json',
    questaoReformulada: true,
    tipoReformulado: questao.tipo,
    cargoReformulado: questao.cargo,
    etapaReformulada: questao.etapa,
    origemReformulada: questao.origem,
    clientePersonalizacao: questao.cliente || null,
    clienteIdPersonalizacao: questao.cliente_id || null,
    areaPersonalizacao: questao.area || null,
    rubricaInterna: questao.rubricaInterna || '',
    oQueDeveSerAvaliado: questao.oQueDeveSerAvaliado || '',
    gabaritoInterno: questao.gabarito || null,
    personalizacao: {
      permitida: questao.origem === 'personalizada',
      origem: questao.origem,
      cliente: questao.cliente || null,
      area: questao.area || null,
    },
    competencias: normalizarLista(questao.competencias),
  };

  if (
    ['multiple_choice', 'general_multiple_choice', 'technical_multiple_choice'].includes(tipo)
  ) {
    const alternativas = Array.isArray(questao.alternativas) ? questao.alternativas : [];
    const correta = String(questao.gabarito || '').trim().toUpperCase();
    const answer = Math.max(
      0,
      alternativas.findIndex((alternativa) => String(alternativa.id).toUpperCase() === correta),
    );
    return {
      ...base,
      type: 'multiple',
      tipo: tipo.includes('technical')
        ? 'technical_multiple_choice'
        : tipo.includes('general')
          ? 'general_multiple_choice'
          : 'multiple_choice',
      options: alternativas.map((alternativa) => alternativa.texto),
      answer,
      correctIndex: answer,
      gabarito: {
        tipo: 'alternativa',
        resposta_correta: correta,
      },
    };
  }

  if (tipo === 'compact_choice_group') {
    const respostas = respostasCompactas(questao);
    const itens = (Array.isArray(questao.itens) ? questao.itens : []).map((item) => {
      const alternativas = Array.isArray(item.alternativas) ? item.alternativas : [];
      const letraCorreta = String(item.gabarito || respostas[String(item.id)] || '').toUpperCase();
      return {
        id: String(item.id || ''),
        enunciado: item.enunciado || '',
        options: alternativas.map((alternativa) => alternativa.texto),
        alternativas,
        answer:
          letraCorreta
            ? alternativas.findIndex(
              (alternativa) => String(alternativa.id).toUpperCase() === letraCorreta,
            )
            : null,
        gabarito: letraCorreta || null,
      };
    });
    return {
      ...base,
      type: 'compact_choice_group',
      tipo: 'compact_choice_group',
      items: itens,
      itens,
      gabarito: {
        tipo: 'grupo_compacto',
        respostas,
      },
    };
  }

  const criterios = criteriosReformulados(questao);
  const isEssay = tipo === 'essay';
  const expected = {
    minTextLength: isEssay ? 100 : 35,
    minSentences: isEssay ? 4 : 1,
    essay: isEssay,
    maxCharacters: isEssay ? MAX_CARACTERES_REDACAO : undefined,
    maxLines: isEssay ? MAX_LINHAS_REDACAO : undefined,
    criteria: criterios.map((criterio) => criterio.descricao),
    rubric: criterios,
    requiresRichText: tipo === 'word_discursive',
    ...(tipo === 'word_discursive' ? requisitosFormatacaoReformulados(questao) : {}),
  };

  return {
    ...base,
    type: 'word',
    tipo: isEssay ? 'redacao' : 'word_discursive',
    expected,
    essay: isEssay
      ? {
        theme: questao.temaRedacao || questao.titulo || 'Redacao',
        supportTexts: [],
        motivatingTexts: [],
        proposal: questao.enunciado || '',
        orientation: questao.instrucoesRedacao || '',
        maxCharacters: MAX_CARACTERES_REDACAO,
        maxLines: MAX_LINHAS_REDACAO,
        criteria: expected.criteria,
      }
      : undefined,
    gabarito: {
      tipo: 'rubrica',
      criterios,
    },
  };
}

function extrairContextoBlueprint(blueprint = {}) {
  const label = String(blueprint.label || '').replace(/^Nv\s*\d+\s*-\s*/i, '');
  const partes = label.split('/').map((item) => item.trim()).filter(Boolean);
  const vaga = partes[0] || label || 'Geral';
  const area = partes[1] || '';
  return {
    vaga: normalizarVagaBanco(vaga),
    area: normalizarAreaBanco(area, vaga),
    nivel: normalizarNivelBanco(blueprint.level, vaga),
  };
}

function corresponde(valorQuestao, valorFiltro) {
  if (!textoPreenchido(valorFiltro)) return true;
  return normalizarTexto(valorQuestao) === normalizarTexto(valorFiltro);
}

function normalizarTermosBusca(...valores) {
  return valores
    .flatMap((valor) => normalizarLista(valor))
    .flatMap((valor) => String(valor).split(/[,;|]/))
    .map(normalizarTexto)
    .filter(Boolean);
}

function termosClienteConfiguracao(configuracao = {}) {
  return normalizarTermosBusca(
    configuracao.operacao,
    configuracao.cliente,
    configuracao.cliente_id,
    configuracao.clientes,
    configuracao.clientesOperacoes,
    configuracao.operacoes,
  );
}

function termosAreaConfiguracao(configuracao = {}) {
  return normalizarTermosBusca(
    configuracao.area,
    configuracao.area_prova,
    configuracao.trilha,
    configuracao.track,
    configuracao.tipoAtendimento,
    configuracao.tiposAtendimento,
    configuracao.tipos_atendimento,
    configuracao.vaga,
  );
}

function algumTermoCorresponde(origem = [], destino = []) {
  return origem.some((termoOrigem) =>
    destino.some(
      (termoDestino) =>
        termoOrigem === termoDestino ||
        termoOrigem.includes(termoDestino) ||
        termoDestino.includes(termoOrigem),
    ),
  );
}

function clienteCorresponde(questao = {}, clientesConfiguracao = []) {
  if (!clientesConfiguracao.length) return false;
  const clientesQuestao = normalizarTermosBusca(
    questao.cliente_id,
    questao.cliente,
    questao.operacao,
    questao.clientes,
  );
  return algumTermoCorresponde(clientesQuestao, clientesConfiguracao);
}

function areasQuestaoPersonalizada(questao = {}) {
  return normalizarTermosBusca(
    questao.area,
    questao.areas_personalizadas,
    questao.tipo_atendimento,
  );
}

function tipoSistemaBanco(questao = {}) {
  const tipo = normalizarTexto(questao.tipo);
  if (
    ['multipla_escolha', 'verdadeiro_falso', 'situacional', 'interpretacao'].includes(
      tipo,
    )
  ) {
    return 'multiple';
  }
  return 'word';
}

function pontuarQuestaoPersonalizada({
  questao,
  questaoOriginal,
  configuracao,
  ordem,
  clientesConfiguracao,
  areasConfiguracao,
}) {
  const etapaOriginal = mapearStageKeyParaEtapa(questaoOriginal.stageKey);
  if (etapaOriginal === 'excel') return -1;
  if (!corresponde(questao.etapa, etapaOriginal)) return -1;
  if (!clienteCorresponde(questao, clientesConfiguracao)) return -1;
  if (questaoOriginal.type && tipoSistemaBanco(questao) !== questaoOriginal.type) return -1;

  const nivelEsperado = normalizarNivelBanco(
    configuracao.nivelProva || configuracao.nivel || questaoOriginal.nivel || '',
    configuracao.vaga || questaoOriginal.vaga || '',
  );
  if (nivelEsperado && !corresponde(questao.nivel, nivelEsperado)) return -1;

  const questaoAreas = areasQuestaoPersonalizada(questao);
  const vagaEsperada = normalizarVagaBanco(configuracao.vaga || questaoOriginal.vaga || '');
  const areaEsperada = normalizarAreaBanco(
    configuracao.area || configuracao.area_prova || configuracao.trilha || '',
    configuracao.vaga || questaoOriginal.vaga || '',
  );
  const baseOriginal = normalizarTexto(questaoOriginal.questionBankId);
  const basePersonalizada = normalizarTexto(questao.base_neutra_id);
  if (baseOriginal && basePersonalizada && basePersonalizada !== baseOriginal) return -1;
  let score = 0;

  if (baseOriginal && basePersonalizada === baseOriginal) score += 100;
  if (areasConfiguracao.length && algumTermoCorresponde(questaoAreas, areasConfiguracao)) {
    score += 20;
  }
  if (corresponde(questao.vaga, vagaEsperada)) score += 10;
  if (corresponde(questao.area, areaEsperada)) score += 8;
  if (normalizarTexto(questao.vaga) === 'geral') score += 2;
  if (normalizarTexto(questao.area) === 'geral') score += 1;

  return score - ordem / 1000;
}

function idsBaseReformulada(questaoOriginal = {}) {
  return normalizarLista([
    questaoOriginal.idQuestaoReformulada,
    questaoOriginal.questionBankId,
    questaoOriginal.baseNeutraId,
    questaoOriginal.questionBankIdOriginal,
  ]);
}

function questaoPersonalizadaReformuladaCorrespondeBase(questao, idsBase = []) {
  const ids = new Set(idsBase.map(String));
  if (questao?.base_neutra_id && ids.has(String(questao.base_neutra_id))) return true;
  if (questao?.id && ids.has(String(questao.id))) return true;
  return (Array.isArray(questao?.aliases_base_neutra) ? questao.aliases_base_neutra : [])
    .some((id) => ids.has(String(id)));
}

function pontuarQuestaoPersonalizadaReformulada({
  questao,
  questaoOriginal,
  clientesConfiguracao,
  areasConfiguracao,
  ordem,
}) {
  if (!questaoOriginal?.questaoReformulada) return -1;
  if (questao.cargo !== questaoOriginal.cargoReformulado) return -1;
  if (questao.etapa !== questaoOriginal.etapaReformulada) return -1;
  if (questao.tipo !== questaoOriginal.tipoReformulado) return -1;

  const idsBase = idsBaseReformulada(questaoOriginal);
  if (!questaoPersonalizadaReformuladaCorrespondeBase(questao, idsBase)) return -1;

  let score = 100;
  if (questao.cliente_id || questao.cliente) {
    if (!clienteCorresponde(questao, clientesConfiguracao)) return -1;
    score += 30;
  }

  const areasQuestao = areasQuestaoPersonalizada(questao);
  if (areasQuestao.length) {
    if (!areasConfiguracao.length) return -1;
    if (!algumTermoCorresponde(areasQuestao, areasConfiguracao)) return -1;
    score += 20;
  }

  return score - ordem / 1000;
}

function obterQuestaoPersonalizadaReformuladaDoBanco(
  questaoOriginal = {},
  configuracao = {},
) {
  if (!questaoOriginal?.questaoReformulada) return null;

  const clientesConfiguracao = termosClienteConfiguracao(configuracao);
  const areasConfiguracao = termosAreaConfiguracao(configuracao);
  const candidatas = obterQuestoesReformuladasAtivas('personalizada')
    .map((questao, ordem) => ({
      questao,
      score: pontuarQuestaoPersonalizadaReformulada({
        questao,
        questaoOriginal,
        clientesConfiguracao,
        areasConfiguracao,
        ordem,
      }),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);

  const escolhida = candidatas[0]?.questao;
  if (!escolhida) return null;

  return {
    ...adaptarQuestaoReformuladaParaSistema(escolhida, {
      stageKey: questaoOriginal.stageKey,
      stageLabel: questaoOriginal.stage,
      points: Number(questaoOriginal.points || 10) || 10,
    }),
    stageWeight: questaoOriginal.stageWeight,
    questionBankIdOriginal: questaoOriginal.questionBankId || '',
    questionBankIdPersonalizado: escolhida.id,
    baseNeutraId: escolhida.base_neutra_id || '',
    areasPersonalizadas: escolhida.area ? [escolhida.area] : [],
    origemBancoPersonalizado: escolhida.origemArquivo || 'bancoQuestoesReformuladas.json',
  };
}

function filtrarQuestoes(candidatas, filtro, usadas) {
  return candidatas.filter((questao) => {
    if (usadas.has(questao.id)) return false;
    if (filtro.etapa && !corresponde(questao.etapa, filtro.etapa)) return false;
    if (filtro.nivel && !corresponde(questao.nivel, filtro.nivel)) return false;
    if (filtro.vaga && !corresponde(questao.vaga, filtro.vaga)) return false;
    if (filtro.area && !corresponde(questao.area, filtro.area)) return false;
    if (filtro.dificuldade && !corresponde(questao.dificuldade, filtro.dificuldade)) return false;
    return true;
  });
}

function selecionarComFallback({ etapa, vaga, area, nivel, dificuldade = '', quantidade, usadas }) {
  const candidatas = obterQuestoesAtivas().filter(
    (questao) => normalizarTexto(questao.etapa) === normalizarTexto(etapa),
  );
  const selecionadas = [];
  const trilhas = [
    { nome: 'vaga + area + nivel', filtro: { etapa, vaga, area, nivel } },
    { nome: 'vaga + nivel', filtro: { etapa, vaga, nivel } },
    { nome: 'area + nivel', filtro: { etapa, area, nivel } },
    { nome: 'nivel + Geral', filtro: { etapa, area: 'Geral', nivel } },
    { nome: 'Geral + nivel', filtro: { etapa, vaga: 'Geral', nivel } },
  ];
  const falhas = [];

  trilhas.forEach((trilha) => {
    if (selecionadas.length >= quantidade) return;

    // Preferência: tenta primeiro casar também a dificuldade pedida dentro desta trilha,
    // antes de completar sem esse filtro — nunca deixa a dificuldade travar a quantidade mínima.
    if (dificuldade) {
      const preferidos = filtrarQuestoes(candidatas, { ...trilha.filtro, dificuldade }, usadas);
      preferidos.forEach((questao) => {
        if (selecionadas.length >= quantidade || usadas.has(questao.id)) return;
        usadas.add(questao.id);
        selecionadas.push(questao);
      });
    }

    if (selecionadas.length >= quantidade) return;
    const encontrados = filtrarQuestoes(candidatas, trilha.filtro, usadas);
    if (!encontrados.length) falhas.push(trilha.nome);
    encontrados.forEach((questao) => {
      if (selecionadas.length >= quantidade || usadas.has(questao.id)) return;
      usadas.add(questao.id);
      selecionadas.push(questao);
    });
  });

  if (selecionadas.length < quantidade) {
    console.error('Filtros sem questoes suficientes no banco:', {
      etapa,
      vaga,
      area,
      nivel,
      quantidade,
      selecionadas: selecionadas.length,
      falhas,
    });
    throw new Error(
      `Banco de questoes sem itens suficientes para ${etapa} (${vaga}/${area}/${nivel}). ` +
        `Necessario: ${quantidade}; encontrado: ${selecionadas.length}.`,
    );
  }

  return selecionadas;
}

function montarDescricaoVisivel(questao) {
  const itensOrdenacao = normalizarLista(
    questao.itens_ordenacao || questao.itensOrdenacao,
  );
  return normalizarLista([
    questao.contexto,
    questao.enunciado,
    itensOrdenacao.length ? itensOrdenacao.map((item) => `- ${item}`).join('\n') : '',
    questao.instrucoes,
  ]).join(
    '\n\n',
  );
}

function criteriosRubrica(questao) {
  const criterios = Array.isArray(questao?.gabarito?.criterios)
    ? questao.gabarito.criterios
    : [];
  return criterios.map((criterio) => criterio.nome || criterio.descricao).filter(Boolean);
}

function adaptarMultiplaEscolha(questao, contexto) {
  const alternativas = Array.isArray(questao.alternativas) ? questao.alternativas : [];
  const correta = String(questao?.gabarito?.resposta_correta || '').trim();
  const answer = Math.max(
    0,
    alternativas.findIndex((alternativa) => String(alternativa.id) === correta),
  );

  return {
    stageKey: contexto.stageKey,
    stage: contexto.stageLabel,
    type: 'multiple',
    title: questao.titulo,
    description: montarDescricaoVisivel(questao),
    titulo: questao.titulo,
    tipo: 'multiple',
    categoria: contexto.stageLabel,
    enunciadoCandidato: [questao.contexto, questao.enunciado].filter(Boolean).join('\n\n'),
    contextoCandidato: questao.contexto,
    enunciadoQuestao: questao.enunciado,
    instrucaoCandidato: questao.instrucoes,
    itensOrdenacao: normalizarLista(questao.itens_ordenacao || questao.itensOrdenacao),
    contextoInternoGeracao: '',
    criteriosAvaliacao: [],
    respostaEsperadaInterna: correta,
    options: alternativas.map((alternativa) => alternativa.texto),
    answer,
    correctIndex: answer,
    points: contexto.points,
    questionBankId: questao.id,
    gabarito: questao.gabarito,
    personalizacao: questao.personalizacao,
    competencias: normalizarLista(questao.competencias),
  };
}

function adaptarRedacao(questao, contexto) {
  const criterios = criteriosRubrica(questao);
  const supportTexts = normalizarLista([questao.texto_base, questao.contexto]);
  const orientation =
    questao.instrucoes ||
    `Escreva ate ${MAX_LINHAS_REDACAO} linhas, com introducao, desenvolvimento e conclusao.`;

  return {
    stageKey: contexto.stageKey,
    stage: contexto.stageLabel,
    type: 'word',
    title: 'Redação',
    description: [questao.contexto, questao.enunciado, orientation].filter(Boolean).join('\n\n'),
    titulo: 'Redação',
    tipo: 'redacao',
    categoria: contexto.stageLabel,
    enunciadoCandidato: questao.enunciado,
    contextoCandidato: questao.contexto,
    enunciadoQuestao: questao.enunciado,
    instrucaoCandidato: orientation,
    itensOrdenacao: normalizarLista(questao.itens_ordenacao || questao.itensOrdenacao),
    contextoInternoGeracao: '',
    criteriosAvaliacao: criterios,
    respostaEsperadaInterna: questao.gabarito,
    expected: {
      minTextLength: contexto.nivel === 'avancado' ? 220 : contexto.nivel === 'intermediario' ? 160 : 100,
      minSentences: 4,
      essay: true,
      maxCharacters: MAX_CARACTERES_REDACAO,
      maxLines: MAX_LINHAS_REDACAO,
      criteria: criterios,
      rubric: questao.gabarito?.criterios || [],
    },
    essay: {
      theme: questao.tema || questao.titulo,
      supportTexts,
      motivatingTexts: supportTexts,
      proposal: questao.enunciado,
      orientation,
      maxCharacters: MAX_CARACTERES_REDACAO,
      maxLines: MAX_LINHAS_REDACAO,
      criteria: criterios,
    },
    points: contexto.points,
    questionBankId: questao.id,
    gabarito: questao.gabarito,
    personalizacao: questao.personalizacao,
    competencias: normalizarLista(questao.competencias),
  };
}

function adaptarTexto(questao, contexto) {
  const criterios = criteriosRubrica(questao);
  const tags = normalizarLista(questao.tags);
  const expected = {
    minTextLength: contexto.nivel === 'avancado' ? 90 : contexto.nivel === 'intermediario' ? 65 : 35,
    minSentences: tags.includes('lista') || questao.tipo === 'word' ? 0 : 1,
    criteria: criterios,
    rubric: questao.gabarito?.criterios || [],
  };

  if (tags.includes('lista') || normalizarTexto(questao.titulo).includes('lista')) {
    expected.requiresList = true;
    expected.minListItems = 3;
  }

  return {
    stageKey: contexto.stageKey,
    stage: contexto.stageLabel,
    type: 'word',
    title: questao.titulo,
    description: montarDescricaoVisivel(questao),
    titulo: questao.titulo,
    tipo: 'word',
    categoria: contexto.stageLabel,
    enunciadoCandidato: [questao.contexto, questao.enunciado].filter(Boolean).join('\n\n'),
    contextoCandidato: questao.contexto,
    enunciadoQuestao: questao.enunciado,
    instrucaoCandidato: questao.instrucoes,
    itensOrdenacao: normalizarLista(questao.itens_ordenacao || questao.itensOrdenacao),
    contextoInternoGeracao: '',
    criteriosAvaliacao: criterios,
    respostaEsperadaInterna: questao.gabarito,
    expected,
    points: contexto.points,
    questionBankId: questao.id,
    gabarito: questao.gabarito,
    personalizacao: questao.personalizacao,
    competencias: normalizarLista(questao.competencias),
  };
}

function adaptarQuestaoParaSistema(questao, contexto) {
  const tipo = normalizarTexto(questao.tipo);
  if (
    ['multipla_escolha', 'verdadeiro_falso', 'situacional', 'interpretacao'].includes(
      tipo,
    )
  ) {
    return adaptarMultiplaEscolha(questao, contexto);
  }
  if (tipo === 'redacao') return adaptarRedacao(questao, contexto);
  return adaptarTexto(questao, contexto);
}

export function getQuestoes({
  vaga = 'Geral',
  area = 'Geral',
  nivel = 'basico',
  etapas = [],
  quantidadePorEtapa = {},
  excluirExcel = true,
  stageKeyPorEtapa = {},
  stageLabelPorEtapa = {},
  pointsPorEtapa = {},
  idsExcluidos = [],
  dificuldade = '',
} = {}) {
  garantirBancoValido();
  const usadas = new Set(idsExcluidos);
  const resultado = {};
  const etapasNormalizadas = normalizarLista(etapas).filter(
    (etapa) => !(excluirExcel && normalizarTexto(etapa) === 'excel'),
  );

  etapasNormalizadas.forEach((etapaOriginal) => {
    const etapa = normalizarTexto(etapaOriginal);
    const quantidade = Number(quantidadePorEtapa[etapaOriginal] || quantidadePorEtapa[etapa] || 1);
    const selecionadas = selecionarComFallback({
      etapa,
      vaga,
      area,
      nivel,
      dificuldade,
      quantidade,
      usadas,
    });
    resultado[etapa] = selecionadas.map((questao, indice) =>
      adaptarQuestaoParaSistema(questao, {
        stageKey: stageKeyPorEtapa[etapaOriginal] || stageKeyPorEtapa[etapa] || etapa,
        stageLabel: stageLabelPorEtapa[etapaOriginal] || stageLabelPorEtapa[etapa] || etapa,
        points:
          Number(pointsPorEtapa[etapaOriginal]?.[indice] || pointsPorEtapa[etapa]?.[indice] || 10) ||
          10,
        nivel,
      }),
    );
  });

  return resultado;
}

export function getQuestoesParaBlueprint(
  blueprint = {},
  stage = {},
  legado = [],
  idsExcluidos = [],
  dificuldade = '',
) {
  const etapa = mapearStageKeyParaEtapa(stage.key);
  if (etapa === 'excel') return Array.isArray(legado) ? legado : [];

  // Questões reformuladas/personalizadas por cliente não passam pelo filtro de dificuldade —
  // são um banco à parte, fora do escopo do filtro do banco padrão.
  const reformuladas = obterQuestoesReformuladasParaStage(blueprint, stage);
  if (Array.isArray(reformuladas) && reformuladas.length) {
    const pontosLegados = (Array.isArray(legado) ? legado : []).map((questao) =>
      Number(questao?.points || 10),
    );
    return reformuladas.map((questao, indice) =>
      adaptarQuestaoReformuladaParaSistema(questao, {
        stageKey: stage.key || etapa,
        stageLabel: stage.label || legado?.[0]?.stage || etapa,
        points: Number(pontosLegados[indice] || pontosLegados[0] || 10) || 10,
      }),
    );
  }

  const contexto = extrairContextoBlueprint(blueprint);
  const quantidade = Array.isArray(legado) && legado.length ? legado.length : 1;
  const points = (Array.isArray(legado) ? legado : []).map((questao) =>
    Number(questao?.points || 10),
  );
  const questoesPorEtapa = getQuestoes({
    ...contexto,
    etapas: [etapa],
    quantidadePorEtapa: { [etapa]: quantidade },
    stageKeyPorEtapa: { [etapa]: stage.key || etapa },
    stageLabelPorEtapa: { [etapa]: stage.label || legado?.[0]?.stage || etapa },
    pointsPorEtapa: { [etapa]: points },
    excluirExcel: true,
    idsExcluidos,
    dificuldade,
  });

  return questoesPorEtapa[etapa] || [];
}

export function obterQuestaoPersonalizadaDoBanco(
  questaoOriginal = {},
  configuracao = {},
) {
  if (!questaoOriginal || questaoOriginal.type === 'excel_external') return null;

  const reformulada = obterQuestaoPersonalizadaReformuladaDoBanco(
    questaoOriginal,
    configuracao,
  );
  if (reformulada) return reformulada;
  if (questaoOriginal.questaoReformulada) return null;

  const clientesConfiguracao = termosClienteConfiguracao(configuracao);
  if (!clientesConfiguracao.length) return null;

  const areasConfiguracao = termosAreaConfiguracao(configuracao);
  const candidatas = obterQuestoesPersonalizadasAtivas()
    .map((questao, ordem) => ({
      questao,
      score: pontuarQuestaoPersonalizada({
        questao,
        questaoOriginal,
        configuracao,
        ordem,
        clientesConfiguracao,
        areasConfiguracao,
      }),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);

  const escolhida = candidatas[0]?.questao;
  if (!escolhida) return null;

  const nivel = normalizarNivelBanco(
    configuracao.nivelProva || configuracao.nivel || questaoOriginal.nivel || '',
    configuracao.vaga || questaoOriginal.vaga || '',
  );
  const adaptada = adaptarQuestaoParaSistema(escolhida, {
    stageKey: questaoOriginal.stageKey || mapearStageKeyParaEtapa(escolhida.etapa),
    stageLabel: questaoOriginal.stage || escolhida.etapa,
    points: Number(questaoOriginal.points || 10) || 10,
    nivel,
  });

  return {
    ...adaptada,
    stageWeight: questaoOriginal.stageWeight,
    questionBankId: questaoOriginal.questionBankId || escolhida.base_neutra_id || escolhida.id,
    questionBankIdOriginal: questaoOriginal.questionBankId || '',
    questionBankIdPersonalizado: escolhida.id,
    clientePersonalizacao: escolhida.cliente,
    clienteIdPersonalizacao: escolhida.cliente_id,
    areaPersonalizacao: escolhida.area,
    areasPersonalizadas: Array.isArray(escolhida.areas_personalizadas)
      ? escolhida.areas_personalizadas
      : [],
    baseNeutraId: escolhida.base_neutra_id || '',
    origemBancoPersonalizado: 'bancoQuestoes.json',
  };
}

export function obterResumoBancoQuestoes() {
  const personalizadas = Array.isArray(BANCO_QUESTOES.questoes_personalizadas)
    ? BANCO_QUESTOES.questoes_personalizadas
    : [];
  const clientesPersonalizacao = Array.isArray(BANCO_QUESTOES.clientes_personalizacao)
    ? BANCO_QUESTOES.clientes_personalizacao
    : [];

  return {
    versao: BANCO_QUESTOES.versao,
    total: Array.isArray(BANCO_QUESTOES.questoes) ? BANCO_QUESTOES.questoes.length : 0,
    personalizadas: {
      total: personalizadas.length,
      ativas: personalizadas.filter((questao) => questao.ativo).length,
      clientes: clientesPersonalizacao.map((cliente) => ({
        id: cliente.id,
        nome: cliente.nome,
        areas: Array.isArray(cliente.areas) ? cliente.areas : [],
      })),
    },
    reformuladas: {
      total: obterQuestoesReformuladasAtivas('neutra').length,
      personalizadas: obterQuestoesReformuladasAtivas('personalizada').length,
      cargos: Array.from(
        new Set(
          obterQuestoesReformuladasAtivas('neutra')
            .map((questao) => questao.cargo)
            .filter(Boolean),
        ),
      ).sort(),
    },
    validacao: VALIDACAO_BANCO_QUESTOES,
  };
}
