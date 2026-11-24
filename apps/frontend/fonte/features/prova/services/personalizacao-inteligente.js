import { obterQuestaoPersonalizadaDoBanco } from '../../../banco-questoes.js?v=20261124-cache';

const CHAVE_HISTORICO_PERSONALIZACAO =
  'rh_exam_personalization_history_v1';
const LIMITE_LINHAS_REDACAO = 20;
const LIMITE_CARACTERES_REDACAO = 2200;
const ORIENTACAO_REDACAO =
  `Seu texto deve ter introdução, desenvolvimento e conclusão. Escreva até ${LIMITE_LINHAS_REDACAO} linhas.`;
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
  'Use como eixo da questao',
  'Use como eixo da questão',
  'Use tom',
  'A demanda deve considerar conhecimentos',
  'A tarefa deve continuar acessível',
  'A tarefa deve resolver a situação',
];

export const STATUS_PERSONALIZACAO = {
  NAO_PERSONALIZADA: 'Não personalizada',
  PENDENTE: 'Personalização pendente',
  GERADA: 'Gerada',
  EM_REVISAO: 'Em revisão',
  APROVADA: 'Aprovada',
  REPROVADA: 'Reprovada',
  EDITADA: 'Editada manualmente',
  PUBLICADA: 'Publicada',
  ERRO: 'Erro na geração',
};

export const PERFIS_OPERACAO = [
  {
    id: 'atendimento_saude',
    label: 'Atendimento em saúde',
    descricao:
      'Cenários com pacientes, agendamento, acolhimento, sigilo e clareza nas orientações.',
    situacoes: [
      'agendamento de consulta',
      'indisponibilidade de agenda',
      'orientação sobre retorno',
    ],
    tom: 'acolhedor, claro e cuidadoso',
  },
  {
    id: 'call_center',
    label: 'Call center / SAC',
    descricao:
      'Cenários com fila de atendimento, registro em sistema, SLA, postura e solução no primeiro contato.',
    situacoes: [
      'cliente insatisfeito',
      'registro de protocolo',
      'encaminhamento para suporte',
    ],
    tom: 'objetivo, cordial e resolutivo',
  },
  {
    id: 'backoffice',
    label: 'Backoffice operacional',
    descricao:
      'Cenários com análise de cadastro, atualização de planilhas, conferência de dados e tratativas internas.',
    situacoes: [
      'cadastro divergente',
      'relatório pendente',
      'validação de informação',
    ],
    tom: 'preciso, organizado e profissional',
  },
  {
    id: 'suporte_ti',
    label: 'Suporte técnico',
    descricao:
      'Cenários com incidente, abertura de chamado, diagnóstico inicial, orientação ao usuário e escalonamento.',
    situacoes: [
      'falha de acesso',
      'sistema indisponível',
      'triagem de incidente',
    ],
    tom: 'técnico, claro e orientado a causa',
  },
  {
    id: 'rh_dp',
    label: 'RH / DP',
    descricao:
      'Cenários com documentos, comunicação interna, admissão, processo seletivo e atendimento a colaboradores.',
    situacoes: [
      'documentação pendente',
      'comunicado interno',
      'orientação ao candidato',
    ],
    tom: 'formal, humano e objetivo',
  },
];

export const NIVEIS_PERSONALIZACAO = [
  {
    id: 'leve',
    label: 'Baixo',
    descricao: 'Adapta apenas exemplos e contexto, mantendo a prova mais neutra.',
  },
  {
    id: 'situacional',
    label: 'Médio',
    descricao: 'Adapta enunciados, estudos de caso e redação ao cliente/operação.',
  },
  {
    id: 'contextual_avancado',
    label: 'Alto',
    descricao: 'Contextualiza com mais força no cliente, tipo de atendimento e situação prática.',
  },
];

export const TIPOS_ATENDIMENTO_PERSONALIZACAO = [
  'SAC',
  'Central de Atendimento',
  'Agendamento',
  'Suporte Técnico',
  'Atendimento receptivo',
  'Atendimento ativo',
  'Atendimento ao paciente',
  'Atendimento ao cliente final',
  'Backoffice',
  'Ouvidoria',
  'Retenção',
  'Cobrança',
  'Vendas',
  'Operação administrativa',
  'Outro',
];

const CONTEXTOS_PERFIL_ATENDIMENTO = {
  atendimento_saude: {
    ambiente: 'equipe de atendimento',
    atividade: 'agendamento e confirmação de consultas',
    publico: 'paciente',
    publicoPlural: 'pacientes',
    registros: 'agenda de consultas e avisos do sistema',
    problema: 'algumas orientações sobre marcação, confirmação e retorno estavam sendo repassadas apenas verbalmente',
    risco: 'dúvidas para os pacientes e falhas no atendimento',
    elementos: 'agenda, registro no sistema, orientação clara e acolhimento',
    termos: ['paciente', 'consulta', 'agenda', 'agendamento', 'atendimento'],
  },
  call_center: {
    ambiente: 'equipe de atendimento',
    atividade: 'tratativa de solicitações por telefone e canais digitais',
    publico: 'cliente',
    publicoPlural: 'clientes',
    registros: 'protocolos, avisos de fila e orientações do sistema',
    problema: 'algumas informações sobre protocolos e encaminhamentos estavam ficando dispersas entre os atendentes',
    risco: 'retrabalho, espera maior e perda de clareza para o cliente',
    elementos: 'protocolo, registro no sistema, fila de atendimento e comunicação objetiva',
    termos: ['cliente', 'protocolo', 'atendimento', 'solicitação', 'registro'],
  },
  backoffice: {
    ambiente: 'equipe de backoffice',
    atividade: 'conferência de cadastros, planilhas e pendências internas',
    publico: 'solicitante',
    publicoPlural: 'solicitantes',
    registros: 'planilhas, cadastros e avisos internos',
    problema: 'algumas divergências de cadastro e atualização estavam sendo tratadas sem registro claro',
    risco: 'atrasos na conferência e inconsistências no acompanhamento',
    elementos: 'cadastro, planilha, conferência de dados e registro das pendências',
    termos: ['cadastro', 'planilha', 'conferência', 'pendência', 'registro'],
  },
  suporte_ti: {
    ambiente: 'equipe de suporte',
    atividade: 'triagem de chamados e orientação inicial a usuários',
    publico: 'usuário',
    publicoPlural: 'usuários',
    registros: 'chamados, filas de suporte e avisos técnicos',
    problema: 'algumas orientações sobre acesso, indisponibilidade e escalonamento estavam sem registro padronizado',
    risco: 'demora na solução e perda de informações importantes do chamado',
    elementos: 'chamado, diagnóstico inicial, orientação ao usuário e escalonamento',
    termos: ['usuário', 'chamado', 'suporte', 'acesso', 'sistema'],
  },
  rh_dp: {
    ambiente: 'equipe de RH',
    atividade: 'atendimento a colaboradores e organização de documentos',
    publico: 'colaborador',
    publicoPlural: 'colaboradores',
    registros: 'documentos, comunicados internos e avisos do sistema',
    problema: 'algumas orientações sobre documentos e prazos estavam sendo repassadas de forma informal',
    risco: 'dúvidas entre colaboradores e atraso nas tratativas internas',
    elementos: 'documentos, prazos, comunicado interno e registro das orientações',
    termos: ['colaborador', 'documento', 'prazo', 'comunicado', 'RH'],
  },
};

export const NICHOS_VAGA = {
  estagiario_rh: {
    label: 'Estagiário / RH',
    resumo:
      'relacionamento e suporte ao colaborador, documentos, ponto, processos seletivos e comunicação interna',
    termos: [
      'colaborador',
      'documento',
      'ponto',
      'processo seletivo',
      'comunicação interna',
      'RH',
    ],
  },
  estagiario_ti: {
    label: 'Estagiário / TI',
    resumo:
      'software, hardware, manutenção básica de computadores, pacote Office, atendimento inicial ao usuário e organização de chamados',
    termos: ['software', 'hardware', 'Office', 'usuário', 'chamado', 'diagnóstico'],
  },
  estagiario_comercial: {
    label: 'Estagiário / Comercial',
    resumo:
      'planilhas, pacote Office, Excel, Power BI, organização de dados comerciais, indicadores e análise básica',
    termos: ['planilha', 'Excel', 'Power BI', 'indicador', 'dados comerciais'],
  },
  estagiario_operacao: {
    label: 'Estagiário / Operação',
    resumo:
      'atendimento, rotina operacional, registros, comunicação com cliente e acompanhamento de demandas',
    termos: ['atendimento', 'registro', 'ocorrência', 'cliente', 'demanda'],
  },
  estagiario_financeiro: {
    label: 'Estagiário / Financeiro',
    resumo:
      'controles financeiros, documentos, conferência, planilhas e organização de dados',
    termos: ['controle financeiro', 'documento', 'conferência', 'planilha', 'valor'],
  },
  suporte_tecnico_junior: {
    label: 'Suporte Técnico Júnior',
    resumo:
      'suporte básico, Windows, hardware, software, pacote Office, atendimento ao usuário e diagnóstico inicial',
    termos: ['Windows', 'hardware', 'software', 'Office', 'usuário', 'suporte'],
  },
  suporte_tecnico_pleno: {
    label: 'Suporte Técnico Pleno',
    resumo:
      'suporte intermediário, chamados, Windows, redes, diagnóstico, troubleshooting e autonomia moderada',
    termos: ['chamado', 'Windows', 'rede', 'diagnóstico', 'troubleshooting'],
  },
  suporte_tecnico_senior: {
    label: 'Suporte Técnico Sênior',
    resumo:
      'suporte avançado N1, N2 e N3, redes, incidentes críticos, diagnóstico avançado e orientação técnica',
    termos: ['N1', 'N2', 'N3', 'rede', 'incidente crítico', 'orientação técnica'],
  },
  planejamento: {
    label: 'Planejamento',
    resumo:
      'análise, organização, indicadores, visão operacional, capacidade, SLA e tomada de decisão',
    termos: ['indicador', 'SLA', 'volume', 'capacidade', 'planejamento'],
  },
  supervisor: {
    label: 'Supervisor',
    resumo:
      'liderança, indicadores, gestão de equipe, conflitos, operação, comunicação e tomada de decisão',
    termos: ['liderança', 'indicador', 'equipe', 'conflito', 'operação'],
  },
};

export const NICHOS_OPERACAO = {
  davita: {
    label: 'DAVITA',
    resumo:
      'central de agendamento para clínicas DaVita, tratamento renal, pacientes em todo o Brasil e cuidado com informações sensíveis',
    termos: ['DaVita', 'clínica', 'tratamento renal', 'paciente', 'agenda'],
    contextoPerfil: {
      ambiente: 'central de agendamento DaVita',
      atividade: 'agendamento de consultas em clínicas de tratamento renal',
      publico: 'paciente',
      publicoPlural: 'pacientes',
      registros: 'consultas, horários, unidades e informações sensíveis',
      problema:
        'consultas, horários e unidades precisam ser organizados com comunicação acolhedora e registro correto',
      risco: 'falhas de agendamento, dúvidas para pacientes e exposição de informações sensíveis',
      elementos: 'agenda, unidade, paciente, horário e cuidado com dados sensíveis',
      termos: ['paciente', 'consulta', 'clínica', 'DaVita', 'tratamento renal'],
    },
  },
  crf: {
    label: 'CRF',
    resumo:
      'SAC para sócios do programa Sócio Torcedor, dúvidas, reclamações, cadastro, benefícios e suporte',
    termos: ['CRF', 'sócio torcedor', 'torcedor', 'cadastro', 'benefício'],
    contextoPerfil: {
      ambiente: 'SAC do programa Sócio Torcedor',
      atividade: 'atendimento a torcedores sobre cadastro, benefícios, dúvidas e reclamações',
      publico: 'torcedor',
      publicoPlural: 'torcedores',
      registros: 'protocolos, cadastros, benefícios e histórico de atendimento',
      problema:
        'dúvidas e reclamações de torcedores precisam ser tratadas com clareza, objetividade e empatia',
      risco: 'retrabalho, insatisfação do torcedor e falhas no relacionamento',
      elementos: 'cadastro, benefício, protocolo, reclamação e comunicação empática',
      termos: ['torcedor', 'sócio torcedor', 'cadastro', 'benefício', 'SAC'],
    },
  },
  newe: {
    label: 'Newe',
    resumo:
      'SAC para ocorrências de seguros, registro e acompanhamento de solicitações e organização de dados do segurado',
    termos: ['Newe', 'seguro', 'segurado', 'ocorrência', 'solicitação'],
    contextoPerfil: {
      ambiente: 'SAC de ocorrências de seguros',
      atividade: 'registro e acompanhamento de solicitações de seguros',
      publico: 'segurado',
      publicoPlural: 'segurados',
      registros: 'ocorrências, dados do segurado, protocolos e documentos',
      problema:
        'solicitações de seguro exigem comunicação precisa, registro completo e acompanhamento organizado',
      risco: 'dados incompletos, atraso na análise e orientação imprecisa ao segurado',
      elementos: 'ocorrência, segurado, protocolo, documento e acompanhamento',
      termos: ['segurado', 'seguro', 'ocorrência', 'protocolo', 'documento'],
    },
  },
  brava: {
    label: 'Brava',
    resumo:
      'SAC para ocorrências de emergência em plataformas petrolíferas da Brava Energia, urgência operacional e atenção a protocolos',
    termos: ['Brava', 'emergência', 'plataforma petrolífera', 'protocolo', 'ocorrência'],
    contextoPerfil: {
      ambiente: 'SAC de ocorrências críticas da Brava Energia',
      atividade: 'registro e encaminhamento de ocorrências de emergência em plataformas petrolíferas',
      publico: 'solicitante',
      publicoPlural: 'solicitantes',
      registros: 'ocorrências, protocolos, horários, responsáveis e encaminhamentos',
      problema:
        'ocorrências de emergência precisam ser registradas com precisão, urgência e atenção aos protocolos',
      risco: 'falha de encaminhamento, perda de informação crítica e impacto operacional',
      elementos: 'emergência, plataforma petrolífera, protocolo, urgência e registro correto',
      termos: ['emergência', 'plataforma petrolífera', 'Brava', 'protocolo', 'ocorrência'],
    },
  },
  endoview: {
    label: 'Endoview',
    resumo:
      'central de agendamento para consultas e exames nas clínicas Endoview, atendimento a pacientes e cuidado com informações sensíveis',
    termos: ['Endoview', 'clínica', 'consulta', 'exame', 'paciente'],
    contextoPerfil: {
      ambiente: 'central de agendamento Endoview',
      atividade: 'marcação, remarcação e orientação sobre consultas e exames',
      publico: 'paciente',
      publicoPlural: 'pacientes',
      registros: 'agenda, consultas, exames, unidades e orientações',
      problema:
        'consultas e exames precisam ser organizados com comunicação acolhedora, agenda correta e cuidado com dados sensíveis',
      risco: 'falhas de agenda, orientação incompleta e exposição de informações sensíveis',
      elementos: 'consulta, exame, agenda, paciente, unidade e orientação acolhedora',
      termos: ['paciente', 'consulta', 'exame', 'clínica', 'Endoview'],
    },
  },
};

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

function removerRotulosTextoBase(texto) {
  return normalizarTexto(texto)
    .replace(/^\s*Texto-(base|motivador)\s*\d+\s*:\s*/i, '')
    .replace(/^\s*Texto\s+motivador\s*\d+\s*:\s*/i, '')
    .replace(/^\s*Contexto\s*:\s*/i, '')
    .trim();
}

export function limparTextoVisivelCandidato(texto) {
  const limpo = removerRotulosTextoBase(texto)
    .replace(/\b(central de agendamento)\s+\1\b/gi, '$1')
    .replace(/\s+([,.?!;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!limpo || textoContaminadoPorPromptInterno(limpo)) return '';
  return limpo;
}

function unirEnunciadoInstrucao(enunciado, instrucao) {
  return [enunciado, instrucao].map(normalizarTexto).filter(Boolean).join('\n\n');
}

function normalizarCriteriosRedacao(criterios = []) {
  const visiveis = Array.isArray(criterios)
    ? criterios
        .map((criterio) => normalizarTexto(criterio))
        .filter(Boolean)
        .filter((criterio) => !/400\s+caracteres/i.test(criterio))
    : [];

  const conjunto = new Set([...visiveis, ...CRITERIOS_REDACAO]);
  return Array.from(conjunto).filter((criterio) => !/caracteres/i.test(criterio));
}

function obterLimiteCaracteresRedacaoSeguro(valor) {
  const informado = Number(valor || 0);
  if (Number.isFinite(informado) && informado >= 1800) return informado;
  return LIMITE_CARACTERES_REDACAO;
}

function obterNichoVaga(vaga, trilha = '') {
  const chaveVaga = textoSemAcentos(vaga);
  const chaveTrilha = textoSemAcentos(trilha);

  if (chaveVaga.includes('suporte tecnico senior')) return NICHOS_VAGA.suporte_tecnico_senior;
  if (chaveVaga.includes('suporte tecnico pleno')) return NICHOS_VAGA.suporte_tecnico_pleno;
  if (chaveVaga.includes('suporte tecnico junior')) return NICHOS_VAGA.suporte_tecnico_junior;
  if (chaveVaga.includes('planejamento')) return NICHOS_VAGA.planejamento;
  if (chaveVaga.includes('supervisor')) return NICHOS_VAGA.supervisor;
  if (chaveVaga.includes('estagiario comercial')) return NICHOS_VAGA.estagiario_comercial;
  if (chaveVaga.includes('estagiario financeiro')) return NICHOS_VAGA.estagiario_financeiro;
  if (chaveVaga.includes('estagiario operacao')) return NICHOS_VAGA.estagiario_operacao;
  if (chaveVaga.includes('estagiario rh')) return NICHOS_VAGA.estagiario_rh;
  if (chaveVaga.includes('estagiario ti')) return NICHOS_VAGA.estagiario_ti;
  if (chaveVaga === 'ti' || chaveTrilha.includes('ti')) return NICHOS_VAGA.suporte_tecnico_senior;
  if (chaveTrilha.includes('comercial')) return NICHOS_VAGA.estagiario_comercial;
  if (chaveTrilha.includes('financeiro')) return NICHOS_VAGA.estagiario_financeiro;
  if (chaveTrilha.includes('rh')) return NICHOS_VAGA.estagiario_rh;
  if (chaveTrilha.includes('operacao')) return NICHOS_VAGA.estagiario_operacao;

  return null;
}

function obterNichoOperacao(operacao) {
  const chave = textoSemAcentos(operacao);
  if (!chave) return null;
  if (chave.includes('davita') || chave.includes('da vita')) return NICHOS_OPERACAO.davita;
  if (chave.includes('crf')) return NICHOS_OPERACAO.crf;
  if (chave.includes('newe')) return NICHOS_OPERACAO.newe;
  if (chave.includes('brava')) return NICHOS_OPERACAO.brava;
  if (chave.includes('endoview')) return NICHOS_OPERACAO.endoview;
  return null;
}

function unirTermosPublicos(...listas) {
  const termos = listas.flatMap((lista) => (Array.isArray(lista) ? lista : []));
  return Array.from(new Set(termos.map((termo) => normalizarTexto(termo)).filter(Boolean)));
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor ?? null));
}

function obterPerfilPorId(id) {
  if (!normalizarTexto(id)) {
    return PERFIS_OPERACAO.find((perfil) => perfil.id === 'call_center') ||
      PERFIS_OPERACAO[0];
  }

  return (
    PERFIS_OPERACAO.find((perfil) => perfil.id === id) ||
    PERFIS_OPERACAO.find((perfil) => perfil.id === 'call_center') ||
    PERFIS_OPERACAO[0]
  );
}

function obterContextoPerfil(perfil) {
  return (
    CONTEXTOS_PERFIL_ATENDIMENTO[perfil?.id] ||
    CONTEXTOS_PERFIL_ATENDIMENTO.call_center
  );
}

function obterOpcao(lista, id) {
  return lista.find((item) => item.id === id) || lista[0];
}

function normalizarListaConfiguracao(valor) {
  if (Array.isArray(valor)) return valor.map(normalizarTexto).filter(Boolean);
  if (!normalizarTexto(valor)) return [];
  return String(valor)
    .split(/[,;|]/)
    .map(normalizarTexto)
    .filter(Boolean);
}

export function inferirPerfilAtendimentoPersonalizacao({
  clientes = [],
  tipos = [],
  area = '',
  vaga = '',
} = {}) {
  const base = textoSemAcentos(
    [...normalizarListaConfiguracao(clientes), ...normalizarListaConfiguracao(tipos), area, vaga].join(' '),
  );

  if (
    base.includes('paciente') ||
    base.includes('agendamento') ||
    base.includes('saude') ||
    base.includes('davita') ||
    base.includes('endoview')
  ) {
    return 'atendimento_saude';
  }

  if (base.includes('suporte') || base.includes('tecnico') || base.includes('ti')) {
    return 'suporte_ti';
  }

  if (
    base.includes('backoffice') ||
    base.includes('administrativa') ||
    base.includes('cobranca') ||
    base.includes('financeiro')
  ) {
    return 'backoffice';
  }

  if (base.includes('rh') || base.includes('dp')) return 'rh_dp';

  return 'call_center';
}

function obterRestricaoNivel(contexto) {
  const vaga = textoSemAcentos(contexto.vaga);
  const nivel = textoSemAcentos(contexto.nivelProva);
  const trilha = textoSemAcentos(contexto.trilha);

  const jovemAprendiz =
    nivel === '1' ||
    vaga.includes('jovem aprendiz') ||
    vaga.includes('aprendiz');
  const entrada =
    jovemAprendiz ||
    nivel === '2' ||
    vaga.includes('operador') ||
    vaga.includes('atendente') ||
    vaga.includes('estagiario') ||
    trilha.includes('estagio');

  if (jovemAprendiz) {
    return {
      entrada: true,
      jovemAprendiz: true,
      label: 'Jovem Aprendiz',
      orientacao:
        'Use linguagem simples e situações de primeiro emprego. Avalie organização básica, responsabilidade, comunicação respeitosa, interpretação e vontade de aprender, sem cobrar vivência corporativa prévia.',
    };
  }

  if (entrada) {
    return {
      entrada: true,
      jovemAprendiz: false,
      label: 'Entrada',
      orientacao:
        'Use contexto de atendimento em nível básico. Avalie empatia, clareza, escuta, organização e interpretação, sem exigir domínio de KPI, SLA, CRM, scripts complexos ou gestão avançada.',
    };
  }

  return {
    entrada: false,
    jovemAprendiz: false,
    label: 'Profissional',
    orientacao:
      'A complexidade pode crescer conforme o nível, com situações mais específicas quando fizer sentido para a vaga.',
  };
}

function sanitizarComplexidadeEntrada(texto) {
  return normalizarTexto(texto)
    .replace(/\bSLA\b/gi, 'tempo de resposta')
    .replace(/\bKPI\b/gi, 'informações de acompanhamento')
    .replace(/\bKPIs\b/gi, 'informações de acompanhamento')
    .replace(/\bCRM\b/gi, 'sistema de registro')
    .replace(/\bgestão de pessoas\b/gi, 'organização do trabalho em equipe')
    .replace(/\bgestão\b/gi, 'organização')
    .replace(/\bliderança\b/gi, 'responsável pela equipe')
    .replace(/\bprocessos internos complexos\b/gi, 'orientações internas básicas')
    .replace(/\bconflitos avançados\b/gi, 'situações de comunicação');
}

function criarSnapshotQuestao(questao) {
  return {
    stageKey: questao.stageKey,
    stage: questao.stage,
    type: questao.type,
    title: questao.title,
    description: questao.description,
    options: clonar(questao.options || []),
    answer: questao.answer,
    correctIndex: questao.correctIndex,
    expected: clonar(questao.expected || {}),
    taskId: questao.taskId,
    points: questao.points,
    stageWeight: questao.stageWeight,
  };
}

function montarContexto(configuracao = {}) {
  const perfil = obterPerfilPorId(configuracao.perfilOperacao);
  const nivel = obterOpcao(
    NIVEIS_PERSONALIZACAO,
    configuracao.nivelPersonalizacao,
  );
  const operacao =
    normalizarTexto(configuracao.operacao) ||
    normalizarTexto(configuracao.cliente) ||
    normalizarListaConfiguracao(configuracao.clientesOperacoes).join(', ');
  const contextoOperacao = obterNichoOperacao(operacao);
  const contextoVaga = obterNichoVaga(configuracao.vaga, configuracao.trilha);
  const contextoPerfil =
    contextoOperacao?.contextoPerfil || obterContextoPerfil(perfil);
  const contextoBase = {
    operacao,
    cliente: normalizarTexto(configuracao.cliente) || operacao,
    vaga: normalizarTexto(configuracao.vaga),
    trilha: normalizarTexto(configuracao.trilha),
    nivelProva: normalizarTexto(configuracao.nivelProva),
    area: normalizarTexto(configuracao.area || configuracao.area_prova),
  };
  const restricaoNivel = obterRestricaoNivel(contextoBase);

  return {
    ...contextoBase,
    tomProva: normalizarTexto(
      configuracao.tomProva ||
        configuracao.tom_prova ||
        configuracao.tom ||
        '',
    ),
    situacaoPratica: normalizarTexto(
      configuracao.situacaoPratica ||
        configuracao.situacao_pratica ||
        configuracao.situacao_pratica_operacao ||
        '',
    ),
    tiposAtendimento: normalizarListaConfiguracao(
      configuracao.tiposAtendimento ||
        configuracao.tipos_atendimento ||
        configuracao.tipo_atendimento,
    ),
    perfil,
    contextoPerfil,
    contextoVaga,
    contextoOperacao,
    nivel,
    restricaoNivel,
    usuario: normalizarTexto(configuracao.usuario) || 'RH',
  };
}

function obterInstrucaoTom(contexto) {
  const tom = textoSemAcentos(contexto.tomProva);
  if (!tom) return '';
  if (tom.includes('humanizado') || tom.includes('acolhedor')) {
    return 'A comunicação esperada deve ser acolhedora, clara e respeitosa.';
  }
  if (tom.includes('tecnico')) {
    return 'A situação exige linguagem técnica, objetiva e organizada.';
  }
  if (tom.includes('simples') || tom.includes('objetivo')) {
    return 'A resposta deve ser simples, objetiva e direta.';
  }
  if (tom.includes('corporativo') || tom.includes('formal')) {
    return 'A comunicação deve ser profissional, clara e adequada ao ambiente de trabalho.';
  }
  if (tom.includes('atendimento')) {
    return 'A situação envolve cordialidade, clareza, registro correto e resolução do atendimento.';
  }
  if (tom.includes('operacional')) {
    return 'A situação envolve rotina, prioridade, registro, procedimento e acompanhamento.';
  }
  return `A resposta deve manter tom ${contexto.tomProva}, com clareza e coerência.`;
}

function obterInstrucaoSituacaoPratica(contexto) {
  if (!contexto.situacaoPratica) return '';
  return `A situação prática envolve: ${contexto.situacaoPratica}`;
}

function montarOrientacaoContextual(contexto) {
  return [
    obterInstrucaoSituacaoPratica(contexto),
    obterInstrucaoTom(contexto),
  ]
    .filter(Boolean)
    .join(' ');
}

function escaparRegExp(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trocarTermo(texto, termo, substituto) {
  if (!normalizarTexto(termo) || !normalizarTexto(substituto)) return texto;
  return texto.replace(new RegExp(`\\b${escaparRegExp(termo)}\\b`, 'gi'), substituto);
}

function substituirVocabularioBase(texto, contextoPerfil) {
  let resultado = texto;
  resultado = trocarTermo(resultado, 'rotina do setor', `rotina de ${contextoPerfil.atividade}`);
  resultado = trocarTermo(resultado, 'avisos do setor', contextoPerfil.registros);
  resultado = trocarTermo(resultado, 'setor', contextoPerfil.ambiente);
  resultado = trocarTermo(resultado, 'cliente', contextoPerfil.publico);
  resultado = trocarTermo(resultado, 'clientes', contextoPerfil.publicoPlural);
  resultado = trocarTermo(resultado, 'usuário', contextoPerfil.publico);
  resultado = trocarTermo(resultado, 'usuários', contextoPerfil.publicoPlural);
  resultado = trocarTermo(resultado, 'colaboradores', 'integrantes da equipe');
  resultado = trocarTermo(resultado, 'recados', 'orientações');
  return resultado;
}

function removerTermosConfiguradosDoEnunciado(texto, contexto) {
  let resultado = texto;
  const substituto = contexto.contextoPerfil.ambiente;
  const termos = [
    contexto.operacao,
    contexto.cliente,
  ].filter((termo) => normalizarTexto(termo).length > 2);

  termos.forEach((termo) => {
    resultado = resultado.replace(
      new RegExp(escaparRegExp(termo), 'gi'),
      substituto,
    );
  });

  return resultado;
}

function separarCenarioETarefa(texto) {
  const partes = normalizarTexto(texto)
    .split(/\n{2,}/)
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (partes.length > 1) {
    return {
      cenario: partes[0],
      tarefa: partes.slice(1).join('\n\n'),
    };
  }

  const indiceInstrucao = normalizarTexto(texto).search(
    /\b(Escreva|Redija|Assinale|Escolha|Informe|Calcule|Crie|Monte|Responda|Analise|Organize|Classifique)\b/i,
  );

  if (indiceInstrucao > 20) {
    return {
      cenario: texto.slice(0, indiceInstrucao).trim(),
      tarefa: texto.slice(indiceInstrucao).trim(),
    };
  }

  return {
    cenario: '',
    tarefa: normalizarTexto(texto),
  };
}

function estruturarCamposCandidato(questao, contexto, descricaoGerada, indice = 0) {
  if (questao.type === 'excel_external') {
    return {
      titulo: questao.title || '',
      tipo: questao.type || '',
      categoria: questao.stage || questao.stageKey || '',
      enunciadoCandidato: limparTextoVisivelCandidato(descricaoGerada || questao.description),
      instrucaoCandidato: '',
      contextoInternoGeracao: '',
      criteriosAvaliacao: [],
      respostaEsperadaInterna: questao.taskId || '',
    };
  }

  if (questao.stageKey === 'professional_essay') {
    const { cenario } = separarCenarioETarefa(descricaoGerada);
    const proposta = limparTextoVisivelCandidato(cenario || descricaoGerada);
    return {
      titulo: questao.title || 'Redação',
      tipo: questao.type || 'word',
      categoria: questao.stage || questao.stageKey || '',
      enunciadoCandidato: proposta,
      instrucaoCandidato: ORIENTACAO_REDACAO,
      contextoInternoGeracao: '',
      criteriosAvaliacao: CRITERIOS_REDACAO,
      respostaEsperadaInterna: '',
    };
  }

  const { cenario, tarefa } = separarCenarioETarefa(descricaoGerada || questao.description);
  let enunciadoCandidato = limparTextoVisivelCandidato(cenario || descricaoGerada || questao.description);
  let instrucaoCandidato = limparTextoVisivelCandidato(tarefa && cenario ? tarefa : '');

  if (questaoEhEmailCorporativo(questao) && questaoEhAtendimentoSaude(contexto)) {
    const fallback = montarFallbackWordCandidato(questao, contexto, indice);
    enunciadoCandidato = fallback.enunciadoCandidato;
    instrucaoCandidato = fallback.instrucaoCandidato;
  } else if (!enunciadoCandidato || textoContaminadoPorPromptInterno(descricaoGerada)) {
    const fallback = montarFallbackCandidato(questao, contexto, indice);
    enunciadoCandidato = fallback.enunciadoCandidato;
    instrucaoCandidato = fallback.instrucaoCandidato;
  }

  return {
    titulo: questao.title || '',
    tipo: questao.type || '',
    categoria: questao.stage || questao.stageKey || '',
    enunciadoCandidato,
    instrucaoCandidato,
    contextoInternoGeracao: [
      contexto.contextoOperacao?.resumo,
      contexto.contextoVaga?.resumo,
      contexto.restricaoNivel?.orientacao,
    ].filter(Boolean).join(' '),
    criteriosAvaliacao: Array.isArray(questao.expected?.criteria)
      ? questao.expected.criteria
      : [],
    respostaEsperadaInterna:
      questao.type === 'multiple'
        ? questao.answer ?? questao.correctIndex ?? ''
        : questao.expected || '',
  };
}

function minuscularPrimeiraLetra(texto) {
  const valor = normalizarTexto(texto);
  if (!valor) return valor;
  return `${valor.charAt(0).toLowerCase()}${valor.slice(1)}`;
}

function obterLabelOperacao(contexto) {
  return normalizarTexto(contexto.contextoOperacao?.label || contexto.operacao || contexto.cliente);
}

function obterAmbienteCurto(contexto) {
  const operacao = textoSemAcentos(obterLabelOperacao(contexto));
  const atividade = textoSemAcentos(contexto.contextoPerfil?.atividade);

  if (operacao.includes('davita')) return 'em uma rotina de atendimento a pacientes';
  if (operacao.includes('endoview')) return 'em uma rotina de consultas e exames';
  if (operacao.includes('crf')) return 'em um atendimento a torcedores';
  if (operacao.includes('newe')) return 'em um registro de solicitação de seguro';
  if (operacao.includes('brava')) return 'em uma tratativa operacional de emergência';
  if (atividade.includes('suporte')) return 'em uma rotina de suporte a usuários';
  if (atividade.includes('backoffice')) return 'em uma rotina de conferência de dados';
  if (atividade.includes('rh')) return 'em uma rotina de atendimento interno';

  return 'em uma rotina de atendimento';
}

function questaoEhEmailCorporativo(questao = {}) {
  const titulo = textoSemAcentos(questao.title || questao.titulo);
  return titulo.includes('e-mail') || titulo.includes('email');
}

function questaoEhAtendimentoSaude(contexto) {
  const base = textoSemAcentos(
    [
      contexto.operacao,
      contexto.cliente,
      contexto.contextoPerfil?.atividade,
      contexto.contextoPerfil?.ambiente,
      ...(contexto.tiposAtendimento || []),
    ].join(' '),
  );
  return (
    base.includes('davita') ||
    base.includes('paciente') ||
    base.includes('agendamento') ||
    base.includes('consulta')
  );
}

function montarFallbackWordCandidato(questao, contexto, indice = 0) {
  const titulo = textoSemAcentos(questao.title);
  const atendimentoSaude = questaoEhAtendimentoSaude(contexto);

  if (questaoEhEmailCorporativo(questao) && atendimentoSaude) {
    return {
      enunciadoCandidato:
        'Você trabalha em uma central de agendamento. Um paciente informou que está com dúvida sobre o horário e a unidade da consulta. A equipe precisa registrar a situação com atenção para evitar informações incorretas.',
      instrucaoCandidato:
        'Escreva um e-mail curto para a equipe explicando o ocorrido e orientando que os dados da consulta sejam conferidos antes do atendimento.',
    };
  }

  if (titulo.includes('comunicado')) {
    return {
      enunciadoCandidato:
        'A equipe recebeu uma orientação simples que precisa ser comunicada de forma clara para manter a rotina organizada e evitar dúvidas entre as pessoas envolvidas.',
      instrucaoCandidato:
        'Escreva um comunicado curto, com título adequado, explicando a orientação principal de maneira objetiva e profissional.',
    };
  }

  if (titulo.includes('lista') || titulo.includes('procedimento')) {
    return {
      enunciadoCandidato:
        'Antes de iniciar uma atividade de atendimento, a equipe precisa organizar informações, conferir ferramentas e seguir passos básicos para trabalhar com mais segurança.',
      instrucaoCandidato:
        'Crie uma lista com pelo menos três procedimentos simples que ajudem a preparar a rotina antes do atendimento.',
    };
  }

  const ambiente = obterAmbienteCurto(contexto);
  const variacoes = [
    {
      enunciadoCandidato: `Durante uma atividade ${ambiente}, uma informação importante precisou ser conferida antes da continuidade da tarefa.`,
      instrucaoCandidato:
        'Escreva uma resposta curta explicando como organizar a informação, comunicar a equipe e evitar retrabalho.',
    },
    {
      enunciadoCandidato: `Em uma rotina de trabalho ${ambiente}, a equipe recebeu uma orientação incompleta e precisou agir com atenção para manter a qualidade da entrega.`,
      instrucaoCandidato:
        'Explique qual atitude profissional ajuda a confirmar dados, registrar a situação e seguir a orientação correta.',
    },
    {
      enunciadoCandidato: `Ao lidar com uma demanda ${ambiente}, uma pessoa percebeu que precisava conferir detalhes antes de responder ou concluir a atividade.`,
      instrucaoCandidato:
        'Redija uma orientação simples mostrando como pedir esclarecimentos e comunicar os próximos passos com respeito.',
    },
  ];

  return variacoes[indice % variacoes.length];
}

function montarFallbackMultiplaCandidato(questao, contexto, indice = 0) {
  const habilidade = obterHabilidadeQuestao(questao, questao.description);
  const ambiente = obterAmbienteCurto(contexto);
  const cenarios = {
    comunicacao: `Em uma conversa curta ${ambiente}, uma pessoa precisa responder com clareza e respeito a uma dúvida recebida.`,
    registro: `Ao registrar uma informação ${ambiente}, a equipe precisa evitar dados incompletos e manter o histórico organizado.`,
    organizacao: `Durante uma rotina com mais de uma demanda ${ambiente}, é necessário escolher a atitude que ajuda a organizar prioridades.`,
    interpretacao:
      'Uma orientação de trabalho chegou incompleta e precisa ser conferida antes da execução. Escolha a alternativa que demonstra melhor interpretação e cuidado.',
    tecnica:
      'Em uma atividade técnica simples, escolha a alternativa que representa a conduta mais adequada antes de encaminhar a solução.',
    raciocinio:
      'Observe as informações da situação e escolha a alternativa que apresenta a conclusão mais adequada.',
    geral: `Em uma situação prática ${ambiente}, escolha a atitude mais adequada para agir com responsabilidade.`,
  };

  return {
    enunciadoCandidato: cenarios[habilidade] || cenarios.geral,
    instrucaoCandidato: 'Marque a alternativa correta.',
  };
}

function montarFallbackCandidato(questao, contexto, indice = 0) {
  if (questao.type === 'word') {
    return montarFallbackWordCandidato(questao, contexto, indice);
  }

  if (questao.type === 'multiple') {
    return montarFallbackMultiplaCandidato(questao, contexto, indice);
  }

  return {
    enunciadoCandidato:
      limparTextoVisivelCandidato(questao.description) ||
      'Siga as instruções da etapa e conclua a atividade solicitada.',
    instrucaoCandidato: '',
  };
}

function obterHabilidadeQuestao(questao, textoOriginal) {
  const base = textoSemAcentos(
    [
      questao.stageKey,
      questao.stage,
      questao.title,
      textoOriginal,
    ].join(' '),
  );

  if (base.includes('excel') || base.includes('planilha') || base.includes('calcule') || base.includes('quantas') || base.includes('total')) {
    return 'raciocinio';
  }
  if (base.includes('comunicacao') || base.includes('empatia') || base.includes('cordial') || base.includes('respeitosa') || base.includes('atendimento')) {
    return 'comunicacao';
  }
  if (base.includes('cadastro') || base.includes('dados') || base.includes('registro') || base.includes('protocolo')) {
    return 'registro';
  }
  if (base.includes('prioridade') || base.includes('organiza') || base.includes('rotina') || base.includes('demanda')) {
    return 'organizacao';
  }
  if (base.includes('portugues') || base.includes('interpretacao') || base.includes('texto') || base.includes('instrucao')) {
    return 'interpretacao';
  }
  if (base.includes('programacao') || base.includes('api') || base.includes('rede') || base.includes('suporte tecnico') || base.includes('tech_ti') || base.includes(' ti ')) {
    return 'tecnica';
  }

  return 'geral';
}

function selecionarMicroContexto(questao, contexto, indice = 0) {
  if (contexto.nivel.id === 'leve') return '';

  const ambiente = obterAmbienteCurto(contexto);
  const operacao = obterLabelOperacao(contexto);
  const habilidade = obterHabilidadeQuestao(questao, questao.description);
  const entrada = contexto.restricaoNivel?.entrada;
  const banco = {
    comunicacao: [
      `Durante um contato ${ambiente},`,
      `Ao orientar uma pessoa ${ambiente},`,
      `Em uma conversa curta ${ambiente},`,
    ],
    registro: [
      `Ao registrar uma informação ${ambiente},`,
      `Durante a conferência de dados ${ambiente},`,
      `Antes de concluir um cadastro ${ambiente},`,
    ],
    organizacao: [
      `Ao organizar uma demanda ${ambiente},`,
      `Durante o acompanhamento de uma solicitação ${ambiente},`,
      `Em uma rotina com várias prioridades ${ambiente},`,
    ],
    interpretacao: [
      `Ao interpretar uma orientação ${ambiente},`,
      'Durante a leitura de uma instrução de trabalho,',
      'Em uma atividade de compreensão de informações,',
    ],
    tecnica: [
      'Ao apoiar usuários em sistemas da operação,',
      'Durante uma análise técnica ligada à rotina de trabalho,',
      'Em uma verificação de sistemas usados pela equipe,',
    ],
    raciocinio: [
      'Em uma conferência simples de informações,',
      'Ao organizar dados de uma demanda de trabalho,',
      'Durante uma checagem objetiva de números e registros,',
    ],
    geral: [
      `Em uma situação prática ${ambiente},`,
      'Durante uma demanda comum de trabalho,',
      `Ao lidar com uma solicitação da operação${operacao ? ` ${operacao}` : ''},`,
    ],
  };
  const opcoes = banco[habilidade] || banco.geral;
  const deslocamento = contexto.nivel.id === 'contextual_avancado' ? 1 : 0;
  const frase = opcoes[(indice + deslocamento) % opcoes.length];
  if (entrada && !textoSemAcentos(frase).includes('simples')) {
    if (/^Em uma situação prática/i.test(frase)) {
      return frase.replace(/^Em uma situação prática/i, 'Em uma situação simples');
    }
    if (/^Em uma rotina/i.test(frase)) {
      return frase.replace(/^Em uma rotina/i, 'Em uma situação simples');
    }
    return frase.replace(/^Em uma /, 'Em uma situação simples em ');
  }
  return frase;
}

function enunciadoJaTemContextoOperacao(texto, contexto) {
  const base = textoSemAcentos(texto);
  const termos = unirTermosPublicos(
    [obterLabelOperacao(contexto), contexto.contextoPerfil?.ambiente],
    contexto.contextoOperacao?.termos,
  );
  return termos.some((termo) => {
    const chave = textoSemAcentos(termo);
    return chave.length > 3 && base.includes(chave);
  });
}

function limparDuplicidadesContextuais(texto, contexto) {
  let resultado = normalizarTexto(texto)
    .replace(/^\s*Contexto:\s*/gim, '')
    .replace(/\b(central de agendamento)\s+\1\b/gi, '$1')
    .replace(/\b(rotina de atendimento)\s+\1\b/gi, '$1')
    .replace(/\s+([,.?!;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');

  const ambiente = normalizarTexto(contexto.contextoPerfil?.ambiente);
  if (ambiente) {
    resultado = resultado.replace(
      new RegExp(`(${escaparRegExp(ambiente)})\\s+\\1`, 'gi'),
      '$1',
    );
  }

  return resultado;
}

function combinarMicroContextoEnunciado(microContexto, textoBase) {
  const texto = normalizarTexto(textoBase);
  if (!microContexto) return texto;
  return `${microContexto} ${minuscularPrimeiraLetra(texto)}`;
}

function montarEnunciadoPersonalizadoCurto(questao, contexto, indice = 0) {
  const textoOriginal = normalizarTexto(questao.description);
  const adaptado = substituirVocabularioBase(textoOriginal, contexto.contextoPerfil);
  const textoBase = limparDuplicidadesContextuais(adaptado, contexto);
  const microContexto = selecionarMicroContexto(questao, contexto, indice);

  if (!microContexto || enunciadoJaTemContextoOperacao(textoBase, contexto)) {
    return contexto.restricaoNivel?.entrada
      ? sanitizarComplexidadeEntrada(textoBase)
      : textoBase;
  }

  const resultado = combinarMicroContextoEnunciado(microContexto, textoBase);
  return contexto.restricaoNivel?.entrada
    ? sanitizarComplexidadeEntrada(limparDuplicidadesContextuais(resultado, contexto))
    : limparDuplicidadesContextuais(resultado, contexto);
}

function montarFraseNicho(contexto) {
  const partes = [];
  if (contexto.contextoVaga?.resumo) {
    partes.push(
      contexto.restricaoNivel?.entrada
        ? `A situação se relaciona a atividades simples de ${contexto.contextoVaga.resumo}.`
        : `A situação se relaciona a conhecimentos de ${contexto.contextoVaga.resumo}.`,
    );
  }
  if (contexto.contextoOperacao?.resumo) {
    partes.push(`O contexto de trabalho envolve ${contexto.contextoOperacao.resumo}.`);
  }
  if (contexto.restricaoNivel?.entrada) {
    partes.push('A atividade deve ser resolvida com atenção, organização e comunicação respeitosa.');
  }
  return partes.join(' ');
}

function montarEnunciadoLeve(textoOriginal, contexto) {
  const contextoPerfil = contexto.contextoPerfil;
  const adaptado = substituirVocabularioBase(textoOriginal, contextoPerfil);
  const orientacao = montarOrientacaoContextual(contexto);
  const semTermosConfigurados = removerTermosConfiguradosDoEnunciado(
    adaptado,
    contexto,
  );

  if (textoSemAcentos(semTermosConfigurados) !== textoSemAcentos(textoOriginal)) {
    const resultado = orientacao ? `${orientacao}\n\n${semTermosConfigurados}` : semTermosConfigurados;
    return contexto.restricaoNivel?.entrada
      ? sanitizarComplexidadeEntrada(resultado)
      : resultado;
  }

  const resultado = [
    orientacao,
    contexto.restricaoNivel?.entrada
      ? `Em uma situação simples de ${contextoPerfil.atividade}, ${minuscularPrimeiraLetra(semTermosConfigurados)}`
      : `Em uma rotina de ${contextoPerfil.atividade}, ${minuscularPrimeiraLetra(semTermosConfigurados)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return contexto.restricaoNivel?.entrada
    ? sanitizarComplexidadeEntrada(resultado)
    : resultado;
}

function montarEnunciadoSituacional(textoOriginal, contexto) {
  const contextoPerfil = contexto.contextoPerfil;
  const { tarefa } = separarCenarioETarefa(textoOriginal);
  const tarefaFinal = substituirVocabularioBase(
    tarefa || textoOriginal,
    contextoPerfil,
  );
  const cenario = contexto.restricaoNivel?.entrada
    ? [
        `Em uma situação simples de ${contextoPerfil.atividade}, uma informação precisa ser conferida antes da continuidade da tarefa.`,
        montarOrientacaoContextual(contexto),
        'A equipe precisa agir com organização, atenção às instruções e comunicação respeitosa.',
        montarFraseNicho(contexto),
      ].filter(Boolean).join(' ')
    : [
        `Durante a rotina de ${contextoPerfil.atividade}, foi percebido que ${contextoPerfil.problema}.`,
        montarOrientacaoContextual(contexto),
        `Para evitar ${contextoPerfil.risco} e manter a comunicação organizada, a equipe precisa executar a orientação abaixo.`,
        montarFraseNicho(contexto),
      ].filter(Boolean).join(' ');

  const resultado = `${cenario}\n\n${tarefaFinal}`;
  return contexto.restricaoNivel?.entrada
    ? sanitizarComplexidadeEntrada(resultado)
    : resultado;
}

function montarEnunciadoContextualAvancado(textoOriginal, contexto) {
  const contextoPerfil = contexto.contextoPerfil;
  const { tarefa } = separarCenarioETarefa(textoOriginal);
  const tarefaFinal = substituirVocabularioBase(
    tarefa || textoOriginal,
    contextoPerfil,
  );
  const cenario = contexto.restricaoNivel?.entrada
    ? [
        `Em uma situação prática e básica de ${contextoPerfil.atividade}, o candidato precisa organizar informações com cuidado antes de responder.`,
        montarOrientacaoContextual(contexto),
        'A tarefa deve continuar acessível para quem está iniciando a vida profissional.',
        montarFraseNicho(contexto),
      ].filter(Boolean).join(' ')
    : [
        `Em um dia de maior volume na rotina de ${contextoPerfil.atividade}, a equipe precisou conciliar ${contextoPerfil.elementos}.`,
        montarOrientacaoContextual(contexto),
        `Como parte do alinhamento do turno, uma orientação inconsistente poderia gerar ${contextoPerfil.risco}.`,
        'A tarefa deve resolver a situação de forma clara, objetiva e compatível com o nível da prova.',
        montarFraseNicho(contexto),
      ].filter(Boolean).join(' ');

  const resultado = `${cenario}\n\n${tarefaFinal}`;
  return contexto.restricaoNivel?.entrada
    ? sanitizarComplexidadeEntrada(resultado)
    : resultado;
}

function montarEnunciadoRedacaoPersonalizada(textoOriginal, contexto) {
  const texto = limparTextoVisivelCandidato(textoOriginal);
  if (texto) return texto;

  if (contexto.restricaoNivel?.jovemAprendiz) {
    return 'Com base nos textos-base e em seus conhecimentos, escreva um texto explicando por que responsabilidade, organização e comunicação respeitosa são importantes para quem está começando a vida profissional.';
  }

  return 'Com base nos textos-base e em seus conhecimentos, escreva um texto explicando a importância de agir com organização, clareza e responsabilidade em situações profissionais.';
}

function personalizarEnunciado(questao, contexto, indice = 0) {
  if (questao.type === 'excel_external') {
    return questao.description;
  }

  const textoOriginal = normalizarTexto(questao.description);
  if (!textoOriginal) return textoOriginal;

  if (questao.stageKey === 'professional_essay') {
    return montarEnunciadoRedacaoPersonalizada(textoOriginal, contexto);
  }

  return montarEnunciadoPersonalizadoCurto(questao, contexto, indice);
}

function personalizarDadosRedacao(questao, contexto) {
  if (questao.stageKey !== 'professional_essay') return questao.essay;

  const dados = clonar(questao.essay || {});
  const tema = contexto.restricaoNivel?.jovemAprendiz
    ? 'Responsabilidade, organização e comunicação no começo da vida profissional'
    : normalizarTexto(dados.theme || questao.title || 'Tema da redação');
  const textosOriginais = Array.isArray(dados.supportTexts)
    ? dados.supportTexts
    : Array.isArray(dados.motivatingTexts)
      ? dados.motivatingTexts
      : [];
  const textoBase1 = contexto.restricaoNivel?.jovemAprendiz
    ? 'O início da vida profissional costuma ser um período de adaptação. Para muitos jovens, o primeiro emprego representa o contato com novas responsabilidades, horários, regras, colegas e formas de comunicação. Nesse momento, atitudes simples, como ouvir com atenção, anotar orientações, tirar dúvidas e cumprir combinados, ajudam a construir confiança e demonstram disposição para aprender com a equipe. Também permitem que a pessoa compreenda melhor a rotina e participe com mais segurança.'
    : limparTextoVisivelCandidato(textosOriginais[0]) ||
      `${tema} exige atenção ao contexto, interpretação das informações disponíveis e cuidado na forma de comunicar uma resposta. Em uma rotina profissional, clareza e organização ajudam a reduzir dúvidas, retrabalho e decisões tomadas sem conferência. Ao escrever sobre esse tema, o candidato deve relacionar atitudes observáveis no trabalho com responsabilidade, respeito e compromisso com a qualidade da entrega.`;
  const textoBase2 = contexto.restricaoNivel?.jovemAprendiz
    ? 'Em uma situação cotidiana, um jovem aprendiz recebeu uma lista de tarefas para organizar documentos e repassar uma informação à equipe. Ao perceber que uma das orientações estava incompleta, ele decidiu confirmar a informação antes de continuar. Essa atitude evitou retrabalho, preservou a qualidade da entrega e mostrou cuidado com uma atividade simples, sem depender de experiência anterior. Mesmo em tarefas iniciais, conferir dados e comunicar dúvidas pode fazer diferença no resultado.'
    : limparTextoVisivelCandidato(textosOriginais[1]) ||
      'Em uma situação prática, uma equipe recebeu uma demanda com informações incompletas e prazos curtos. Antes de agir, uma pessoa conferiu os dados disponíveis, organizou as prioridades e comunicou o que ainda precisava ser confirmado. Essa postura permitiu orientar os envolvidos com mais segurança e demonstrou que resolver problemas também depende de registro, escuta e acompanhamento.';
  const proposta =
    limparTextoVisivelCandidato(dados.proposal) ||
    (contexto.restricaoNivel?.jovemAprendiz
      ? 'Com base nos textos-base e em seus conhecimentos, escreva um texto explicando por que responsabilidade, organização e comunicação respeitosa são importantes para quem está começando a vida profissional.'
      : `Com base nos textos-base e em seus conhecimentos, escreva um texto argumentativo sobre: ${tema}.`);

  return {
    ...dados,
    theme: tema,
    supportTexts: [textoBase1, textoBase2],
    motivatingTexts: [textoBase1, textoBase2],
    proposal: proposta,
    orientation: ORIENTACAO_REDACAO,
    maxCharacters: obterLimiteCaracteresRedacaoSeguro(dados.maxCharacters),
    maxLines: LIMITE_LINHAS_REDACAO,
    criteria: normalizarCriteriosRedacao(dados.criteria),
  };
}

function validarQuestaoPersonalizada(original, personalizada) {
  const alertas = [];

  if (!normalizarTexto(personalizada.description)) {
    alertas.push('Enunciado personalizado vazio.');
  }

  if (original.type !== personalizada.type) {
    alertas.push('Tipo da questão foi alterado.');
  }

  if (Number(original.points || 0) !== Number(personalizada.points || 0)) {
    alertas.push('Peso da questão foi alterado.');
  }

  if (normalizarTexto(original.stageKey) !== normalizarTexto(personalizada.stageKey)) {
    alertas.push('Etapa original foi alterada.');
  }

  if (
    original.type === 'multiple' &&
    Array.isArray(original.options) &&
    Array.isArray(personalizada.options)
  ) {
    if (original.options.length !== personalizada.options.length) {
      alertas.push('Quantidade de alternativas foi alterada.');
    }
    if (
      Number(original.answer ?? original.correctIndex) !==
      Number(personalizada.answer ?? personalizada.correctIndex)
    ) {
      alertas.push('Alternativa correta foi alterada.');
    }
  }

  return {
    ok: alertas.length === 0,
    alertas,
  };
}

function montarQuestaoPersonalizadaDoBanco({
  questao,
  questaoBanco,
  contexto,
  original,
  indice,
}) {
  const personalizada = {
    ...clonar(questao),
    ...clonar(questaoBanco),
    stageKey: questao.stageKey,
    stage: questao.stage,
    type: questao.type,
    points: questao.points,
    stageWeight: questao.stageWeight,
  };
  const validacao = validarQuestaoPersonalizada(original, personalizada);
  const status = validacao.ok
    ? STATUS_PERSONALIZACAO.GERADA
    : STATUS_PERSONALIZACAO.EM_REVISAO;

  return {
    ...personalizada,
    personalizacaoInteligente: {
      ativa: true,
      indice,
      status,
      operacao: contexto.operacao,
      cliente: contexto.cliente,
      vaga: contexto.vaga,
      trilha: contexto.trilha,
      nivel_prova: contexto.nivelProva,
      area: contexto.area,
      tom_prova: contexto.tomProva,
      situacao_pratica_operacao: contexto.situacaoPratica,
      tipos_atendimento: contexto.tiposAtendimento,
      perfil_atendimento: contexto.perfil.label,
      nivel_personalizacao: contexto.nivel.label,
      restricao_nivel: contexto.restricaoNivel?.label || '',
      nicho_vaga: contexto.contextoVaga?.label || '',
      nicho_vaga_resumo: contexto.contextoVaga?.resumo || '',
      nicho_operacao: contexto.contextoOperacao?.label || '',
      nicho_operacao_resumo: contexto.contextoOperacao?.resumo || '',
      termos_publicos: unirTermosPublicos(
        contexto.contextoPerfil.termos,
        contexto.contextoVaga?.termos,
        contexto.contextoOperacao?.termos,
      ),
      competencia_preservada: personalizada.stage || personalizada.stageKey,
      nivel_preservado: true,
      peso_preservado: true,
      original,
      justificativa_adaptacao:
        'Questao personalizada selecionada do banco central por cliente, area, etapa, tipo e nivel.',
      alertas: validacao.alertas,
      validacao,
      visivel_ao_candidato: false,
      gerada_em: new Date().toISOString(),
      gerada_por: contexto.usuario,
      mecanismo: 'banco_personalizado',
      origem_banco_personalizado: {
        arquivo: questaoBanco.origemBancoPersonalizado || 'bancoQuestoes.json',
        id: questaoBanco.questionBankIdPersonalizado || '',
        base_neutra_id: questaoBanco.baseNeutraId || questaoBanco.questionBankIdOriginal || '',
        cliente_id: questaoBanco.clienteIdPersonalizacao || '',
        cliente: questaoBanco.clientePersonalizacao || '',
        area: questaoBanco.areaPersonalizacao || '',
        areas: questaoBanco.areasPersonalizadas || [],
      },
    },
  };
}

export function gerarQuestaoPersonalizada(
  questao,
  configuracao = {},
  indice = 0,
) {
  const contexto = montarContexto(configuracao);
  const original = criarSnapshotQuestao(questao);
  const questaoBanco = obterQuestaoPersonalizadaDoBanco(questao, configuracao);
  if (questaoBanco) {
    return montarQuestaoPersonalizadaDoBanco({
      questao,
      questaoBanco,
      contexto,
      original,
      indice,
    });
  }

  if (questao.questaoReformulada) {
    return {
      ...clonar(questao),
      personalizacaoInteligente: {
        ativa: true,
        indice,
        status: STATUS_PERSONALIZACAO.NAO_PERSONALIZADA,
        operacao: contexto.operacao,
        cliente: contexto.cliente,
        vaga: contexto.vaga,
        trilha: contexto.trilha,
        nivel_prova: contexto.nivelProva,
        area: contexto.area,
        tom_prova: contexto.tomProva,
        situacao_pratica_operacao: contexto.situacaoPratica,
        tipos_atendimento: contexto.tiposAtendimento,
        perfil_atendimento: contexto.perfil.label,
        nivel_personalizacao: contexto.nivel.label,
        restricao_nivel: contexto.restricaoNivel?.label || '',
        nicho_vaga: contexto.contextoVaga?.label || '',
        nicho_vaga_resumo: contexto.contextoVaga?.resumo || '',
        nicho_operacao: contexto.contextoOperacao?.label || '',
        nicho_operacao_resumo: contexto.contextoOperacao?.resumo || '',
        termos_publicos: unirTermosPublicos(
          contexto.contextoPerfil.termos,
          contexto.contextoVaga?.termos,
          contexto.contextoOperacao?.termos,
        ),
        competencia_preservada: questao.stage || questao.stageKey,
        nivel_preservado: true,
        peso_preservado: true,
        original,
        justificativa_adaptacao:
          'Questao reformulada preservada sem personalizacao automatica; nao havia variacao escrita aplicavel no banco importado.',
        alertas: [],
        validacao: { ok: true, alertas: [] },
        visivel_ao_candidato: false,
        gerada_em: new Date().toISOString(),
        gerada_por: contexto.usuario,
        mecanismo: 'banco_reformulado_neutro',
      },
    };
  }

  const essayPersonalizado = personalizarDadosRedacao(questao, contexto);
  const descricaoPersonalizada = essayPersonalizado
    ? unirEnunciadoInstrucao(essayPersonalizado.proposal, essayPersonalizado.orientation)
    : personalizarEnunciado(questao, contexto, indice);
  const camposCandidato = estruturarCamposCandidato(
    questao,
    contexto,
    descricaoPersonalizada,
    indice,
  );
  const personalizada = {
    ...clonar(questao),
    ...camposCandidato,
    title: camposCandidato.titulo || questao.title,
    description: unirEnunciadoInstrucao(
      camposCandidato.enunciadoCandidato,
      camposCandidato.instrucaoCandidato,
    ),
    ...(essayPersonalizado
      ? {
          essay: essayPersonalizado,
          expected: {
            ...(questao.expected || {}),
            maxCharacters: essayPersonalizado.maxCharacters,
            maxLines: LIMITE_LINHAS_REDACAO,
            criteria: essayPersonalizado.criteria,
          },
        }
      : {}),
  };

  const alertas = [];
  if (questao.type === 'excel_external') {
    alertas.push(
      'Questão prática de Excel preservada sem adaptação textual para não alterar arquivo-base, peso ou critério.',
    );
  }

  if (!contexto.operacao) {
    alertas.push('Operação não informada; personalização ficou genérica.');
  }

  const validacao = validarQuestaoPersonalizada(original, personalizada);
  const status = validacao.ok
    ? STATUS_PERSONALIZACAO.GERADA
    : STATUS_PERSONALIZACAO.EM_REVISAO;
  const alertasFinais = [...alertas, ...validacao.alertas];

  return {
    ...personalizada,
    personalizacaoInteligente: {
      ativa: true,
      indice,
      status,
      operacao: contexto.operacao,
      cliente: contexto.cliente,
      vaga: contexto.vaga,
      trilha: contexto.trilha,
      nivel_prova: contexto.nivelProva,
      area: contexto.area,
      tom_prova: contexto.tomProva,
      situacao_pratica_operacao: contexto.situacaoPratica,
      tipos_atendimento: contexto.tiposAtendimento,
      perfil_atendimento: contexto.perfil.label,
      nivel_personalizacao: contexto.nivel.label,
      restricao_nivel: contexto.restricaoNivel?.label || '',
      nicho_vaga: contexto.contextoVaga?.label || '',
      nicho_vaga_resumo: contexto.contextoVaga?.resumo || '',
      nicho_operacao: contexto.contextoOperacao?.label || '',
      nicho_operacao_resumo: contexto.contextoOperacao?.resumo || '',
      termos_publicos: unirTermosPublicos(
        contexto.contextoPerfil.termos,
        contexto.contextoVaga?.termos,
        contexto.contextoOperacao?.termos,
      ),
      competencia_preservada: personalizada.stage || personalizada.stageKey,
      nivel_preservado: true,
      peso_preservado: true,
      original,
      justificativa_adaptacao:
        questao.type === 'excel_external'
          ? 'Questão mantida neutra para preservar arquivo-base e checklist técnico.'
          : `Enunciado adaptado ao perfil "${contexto.perfil.label}", com nichos de vaga/operação como contexto, no nível "${contexto.nivel.label}", sem alterar tipo, peso, etapa, alternativas ou critérios.`,
      alertas: alertasFinais,
      validacao,
      visivel_ao_candidato: false,
      gerada_em: new Date().toISOString(),
      gerada_por: contexto.usuario,
      mecanismo: 'template_local',
    },
  };
}

export function gerarPersonalizacaoProva(questoes = [], configuracao = {}) {
  const lista = Array.isArray(questoes) ? questoes : [];
  const questoesPersonalizadas = lista.map((questao, indice) => {
    try {
      return gerarQuestaoPersonalizada(questao, configuracao, indice);
    } catch (error) {
      return {
        ...clonar(questao),
        personalizacaoInteligente: {
          ativa: true,
          indice,
          status: STATUS_PERSONALIZACAO.ERRO,
          original: criarSnapshotQuestao(questao),
          alertas: [
            error?.message ||
              'Não foi possível personalizar esta questão automaticamente.',
          ],
          gerada_em: new Date().toISOString(),
          mecanismo: 'template_local_fallback',
        },
      };
    }
  });
  const alertas = questoesPersonalizadas.flatMap(
    (questao) => questao.personalizacaoInteligente?.alertas || [],
  );

  return {
    status: STATUS_PERSONALIZACAO.GERADA,
    questoes: questoesPersonalizadas,
    alertas,
    historico: montarHistoricoPersonalizacao(
      questoesPersonalizadas,
      configuracao,
      'gerar_personalizacao_automatica',
    ),
  };
}

export function montarHistoricoPersonalizacao(
  questoes = [],
  configuracao = {},
  acao = 'personalizacao',
) {
  const contexto = montarContexto(configuracao);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    acao,
    operacao: contexto.operacao,
    cliente: contexto.cliente,
    vaga: contexto.vaga,
    trilha: contexto.trilha,
    nivel_prova: contexto.nivelProva,
    area: contexto.area,
    tom_prova: contexto.tomProva,
    situacao_pratica_operacao: contexto.situacaoPratica,
    tipos_atendimento: contexto.tiposAtendimento,
    nicho_vaga: contexto.contextoVaga?.label || '',
    nicho_vaga_resumo: contexto.contextoVaga?.resumo || '',
    nicho_operacao: contexto.contextoOperacao?.label || '',
    nicho_operacao_resumo: contexto.contextoOperacao?.resumo || '',
    perfil_atendimento: contexto.perfil.label,
    nivel_personalizacao: contexto.nivel.label,
    restricao_nivel: contexto.restricaoNivel?.label || '',
    usuario: contexto.usuario,
    data_hora: new Date().toISOString(),
    mecanismo: 'template_local',
    total_questoes: questoes.length,
    questoes: questoes.map((questao, indice) => ({
      indice,
      status: questao.personalizacaoInteligente?.status ||
        STATUS_PERSONALIZACAO.NAO_PERSONALIZADA,
      questao_original:
        questao.personalizacaoInteligente?.original?.description ||
        questao.description,
      questao_personalizada: questao.description,
      competencia_preservada:
        questao.personalizacaoInteligente?.competencia_preservada ||
        questao.stage ||
        questao.stageKey,
      peso: questao.points,
      alertas: questao.personalizacaoInteligente?.alertas || [],
    })),
  };
}

export function registrarHistoricoPersonalizacao(item) {
  if (!item) return;

  try {
    const atual = JSON.parse(
      localStorage.getItem(CHAVE_HISTORICO_PERSONALIZACAO) || '[]',
    );
    const lista = Array.isArray(atual) ? atual : [];
    lista.unshift(item);
    localStorage.setItem(
      CHAVE_HISTORICO_PERSONALIZACAO,
      JSON.stringify(lista.slice(0, 100)),
    );
  } catch (error) {
    console.warn('Não foi possível registrar histórico de personalização.', error);
  }
}

export { corrigirRespostaDiscursivaInteligente } from './analise-resposta.js?v=20261124-cache';
