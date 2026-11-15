const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

global.document = {
  createElement() {
    return {
      textContent: '',
      innerText: '',
      set innerHTML(value) {
        const texto = String(value || '')
          .replace(/<br\s*\/?\s*>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        this.textContent = texto;
        this.innerText = texto;
      },
    };
  },
};

const rootDir = path.resolve(__dirname, '..');
const perguntasUrl = pathToFileURL(path.join(rootDir, 'fonte', 'perguntas.js')).href;
const personalizacaoUrl = pathToFileURL(
  path.join(rootDir, 'fonte', 'features', 'prova', 'services', 'personalizacao-inteligente.js'),
).href;
const regrasProvaUrl = pathToFileURL(path.join(rootDir, 'fonte', 'regras-prova.js')).href;

const forbiddenVisiblePatterns = /Gabarito|Resposta correta|O que deve ser avaliado|Rubrica interna/i;

function contarPor(lista, seletor) {
  return lista.reduce((mapa, item) => {
    const chave = seletor(item);
    mapa[chave] = (mapa[chave] || 0) + 1;
    return mapa;
  }, {});
}

function gerar(perguntas, vaga, nivel, trilha) {
  const blueprint = perguntas.resolverBlueprintProva(vaga, nivel, trilha);
  assert.ok(blueprint, `${vaga} deve resolver blueprint`);
  const questoes = perguntas.montarProvaPorBlueprint(blueprint);
  return { blueprint, questoes };
}

function assertSemSigiloVisivel(questoes, contexto) {
  const vazamentos = questoes
    .filter((questao) => questao.type !== 'excel_external')
    .filter((questao) =>
      forbiddenVisiblePatterns.test(
        [questao.description, questao.enunciadoCandidato, questao.instrucaoCandidato].join('\n'),
      ),
    )
    .map((questao) => questao.questionBankId || questao.title);

  assert.deepEqual(vazamentos, [], `${contexto} não deve expor gabarito/rubrica`);
}

function assertExcelPreservado(questoes, taskId, contexto) {
  const excel = questoes.filter((questao) => questao.type === 'excel_external');
  assert.equal(excel.length, 1, `${contexto} deve manter uma etapa Excel`);
  assert.equal(excel[0].taskId, taskId, `${contexto} deve manter arquivo-base Excel`);
  assert.equal(excel[0].questaoReformulada, undefined, `${contexto} Excel não deve vir do banco reformulado`);
}

function assertGrupoCompacto(questoes, tamanhos, contexto) {
  const grupos = questoes.filter((questao) => questao.type === 'compact_choice_group');
  assert.deepEqual(
    grupos.map((questao) => questao.items.length).sort((a, b) => a - b),
    tamanhos.slice().sort((a, b) => a - b),
    `${contexto} deve manter questões agrupadas`,
  );
}

async function main() {
  const perguntas = await import(perguntasUrl);
  const personalizacao = await import(personalizacaoUrl);
  const regrasProva = await import(regrasProvaUrl);
  const resumoBanco = perguntas.obterResumoBancoQuestoes();
  const bancoReformulado = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'bancoQuestoesReformuladas.json'), 'utf8'),
  );
  const neutrasReformuladas = bancoReformulado.questoes || [];
  const personalizadasReformuladas = bancoReformulado.questoes_personalizadas || [];

  assert.ok(resumoBanco.validacao.ok, 'Banco central legado deve continuar válido.');
  assert.ok(resumoBanco.total >= 60, 'Banco legado deve continuar carregado.');
  assert.ok(resumoBanco.reformuladas.total >= 60, 'Banco reformulado deve estar carregado.');
  assert.deepEqual(
    resumoBanco.reformuladas.cargos,
    ['estagiario', 'jovem_aprendiz', 'operador', 'planejamento', 'supervisor'],
    'Somente cargos reformulados devem entrar no novo banco.',
  );
  for (const cargo of ['jovem_aprendiz', 'supervisor']) {
    assert.equal(
      neutrasReformuladas.filter((q) => q.cargo === cargo && q.tipo === 'essay').length,
      1,
      `A redação de ${cargo} deve possuir uma única versão neutra.`,
    );
    assert.equal(
      personalizadasReformuladas.filter((q) => q.cargo === cargo && q.tipo === 'essay').length,
      0,
      `A redação de ${cargo} não pode ter versão personalizada.`,
    );
  }
  assert.equal(
    [...neutrasReformuladas, ...personalizadasReformuladas].some((q) =>
      /O que deve ser avaliado|Observação\s*:/i.test(q.enunciado || ''),
    ),
    false,
    'Blocos internos não podem fazer parte do enunciado do candidato.',
  );

  const jovem = gerar(perguntas, 'Jovem Aprendiz', '1', 'Operação');
  assert.equal(jovem.questoes.length, 16, 'Jovem Aprendiz neutra deve usar os DOCX e manter Excel/Geral.');
  assert.equal(jovem.questoes.filter((q) => q.questaoReformulada).length, 10);
  assertExcelPreservado(jovem.questoes, 'basic_exam', 'Jovem Aprendiz');
  assert.equal(jovem.questoes.filter((q) => q.stageKey === 'professional_essay').length, 1);
  assert.equal(
    jovem.questoes.find((q) => q.stageKey === 'professional_essay')?.essay?.theme,
    'Tema livre',
    'O novo tema da redação de Jovem Aprendiz deve vir do DOCX.',
  );
  const questaoComJustificado = jovem.questoes.find(
    (q) => q.type === 'word' && q.expected?.requiredAlignment === 'justify',
  );
  assert.ok(questaoComJustificado, 'A exigência de alinhamento justificado deve chegar à questão Word.');
  assert.ok(
    questaoComJustificado.oQueDeveSerAvaliado.includes('Justificado'),
    'O bloco interno de avaliação deve ser preservado para a Análise de Resposta.',
  );
  assertSemSigiloVisivel(jovem.questoes, 'Jovem Aprendiz neutra');

  const jovemPersonalizada = personalizacao.gerarPersonalizacaoProva(jovem.questoes, {
    vaga: 'Jovem Aprendiz',
    trilha: 'Operação',
    nivelProva: '1',
    operacao: 'Davita',
    clientesOperacoes: ['Davita'],
    tiposAtendimento: ['Atendimento ao paciente'],
    nivelPersonalizacao: 'situacional',
    usuario: 'smoke-test',
  });
  assert.ok(
    jovemPersonalizada.questoes.filter((q) => q.questaoReformulada && q.personalizacaoInteligente?.mecanismo === 'banco_personalizado').length >= 9,
    'Jovem Aprendiz personalizada deve usar variações por cliente do DOCX.',
  );
  assert.ok(
    jovemPersonalizada.questoes.some((q) => q.stageKey === 'professional_essay' && q.personalizacaoInteligente?.mecanismo === 'banco_reformulado_neutro'),
    'Redação de Jovem Aprendiz não deve ser personalizada.',
  );
  assertSemSigiloVisivel(jovemPersonalizada.questoes, 'Jovem Aprendiz personalizada');

  const operador = gerar(perguntas, 'Operador', '2', 'Operação');
  // A Questão 6 do Word do Operador ("utilizando sua espontaneidade", sem gabarito) é comportamental no banco
  // reformulado e não entra na etapa de Word: ficam 5 múltiplas + o grupo de 20.
  assert.equal(operador.questoes.length, 13, 'Operador neutra deve usar Word/Redação reformulados.');
  assert.equal(operador.questoes.filter((q) => q.questaoReformulada).length, 7);
  assertGrupoCompacto(operador.questoes, [20], 'Operador neutra');
  assertExcelPreservado(operador.questoes, 'qualid_exam', 'Operador');
  assertSemSigiloVisivel(operador.questoes, 'Operador neutra');

  const operadorPersonalizada = personalizacao.gerarPersonalizacaoProva(operador.questoes, {
    vaga: 'Operador',
    trilha: 'Operação',
    nivelProva: '2',
    operacao: 'Davita',
    clientesOperacoes: ['Davita'],
    tiposAtendimento: ['Atendimento ao paciente'],
    nivelPersonalizacao: 'situacional',
    usuario: 'smoke-test',
  });
  assert.ok(
    operadorPersonalizada.questoes.filter((q) => q.questaoReformulada && q.personalizacaoInteligente?.mecanismo === 'banco_personalizado').length >= 7,
    'Operador personalizada deve usar blocos por cliente do DOCX.',
  );
  assertSemSigiloVisivel(operadorPersonalizada.questoes, 'Operador personalizada');

  const estagiario = gerar(perguntas, 'Estagiário', '2', 'TI');
  // Idem Operador: a Questão 6 do Word (espontaneidade) é comportamental e sai da prova (writing_logic fica só com o grupo de 20).
  assert.equal(estagiario.questoes.length, 28, 'Estagiário TI neutra deve incluir Word, Gerais, Técnicos e Redação reformulados.');
  assert.equal(estagiario.questoes.filter((q) => q.questaoReformulada).length, 27);
  assert.deepEqual(contarPor(estagiario.questoes, (q) => q.stageKey), {
    word_basic: 5,
    excel_basic: 1,
    general_basic: 10,
    tech_ti_basic: 10,
    writing_logic: 1,
    professional_essay: 1,
  });
  assertGrupoCompacto(estagiario.questoes, [20], 'Estagiário TI neutra');
  assertExcelPreservado(estagiario.questoes, 'qualid_exam', 'Estagiário TI');
  assertSemSigiloVisivel(estagiario.questoes, 'Estagiário TI neutra');

  const estagiarioPersonalizada = personalizacao.gerarPersonalizacaoProva(estagiario.questoes, {
    vaga: 'Estagiário',
    trilha: 'TI',
    nivelProva: '2',
    operacao: 'Davita',
    clientesOperacoes: ['Davita'],
    tiposAtendimento: ['Suporte Técnico'],
    nivelPersonalizacao: 'situacional',
    usuario: 'smoke-test',
  });
  assert.ok(
    estagiarioPersonalizada.questoes.filter((q) => q.questaoReformulada && q.personalizacaoInteligente?.mecanismo === 'banco_personalizado').length >= 7,
    'Estagiário personalizada deve usar variações por área do DOCX.',
  );
  assertSemSigiloVisivel(estagiarioPersonalizada.questoes, 'Estagiário personalizada');

  const supervisor = gerar(perguntas, 'Supervisor', '3', 'Operação / Gestão');
  assert.equal(supervisor.questoes.length, 11, 'Supervisor neutra deve evitar duplicação dos DOCX repetidos.');
  assert.equal(supervisor.questoes.filter((q) => q.questaoReformulada).length, 10);
  assert.deepEqual(contarPor(supervisor.questoes, (q) => q.stageKey), {
    word_basic: 7,
    excel_mid: 1,
    general_adv_people: 2,
    professional_essay: 1,
  });
  assertExcelPreservado(supervisor.questoes, 'qualid_exam', 'Supervisor');
  assert.match(
    supervisor.questoes.find((q) => q.stageKey === 'professional_essay')?.essay?.theme || '',
    /jogar NUM time/i,
    'O novo tema de Supervisor deve vir do DOCX.',
  );
  assertSemSigiloVisivel(supervisor.questoes, 'Supervisor neutra');

  const supervisorPersonalizada = personalizacao.gerarPersonalizacaoProva(supervisor.questoes, {
    vaga: 'Supervisor',
    trilha: 'Operação / Gestão',
    nivelProva: '3',
    operacao: 'Davita',
    clientesOperacoes: ['Davita'],
    tiposAtendimento: ['Atendimento ao paciente'],
    nivelPersonalizacao: 'situacional',
    usuario: 'smoke-test',
  });
  assert.ok(
    supervisorPersonalizada.questoes.filter((q) => q.questaoReformulada && q.personalizacaoInteligente?.mecanismo === 'banco_personalizado').length >= 8,
    'Supervisor personalizada deve usar blocos por cliente do DOCX.',
  );
  assert.ok(
    supervisorPersonalizada.questoes.some((q) => q.stageKey === 'professional_essay' && q.personalizacaoInteligente?.mecanismo === 'banco_reformulado_neutro'),
    'Redação de Supervisor não deve ser personalizada.',
  );
  assertSemSigiloVisivel(supervisorPersonalizada.questoes, 'Supervisor personalizada');

  for (const prova of [jovemPersonalizada, operadorPersonalizada, estagiarioPersonalizada, supervisorPersonalizada]) {
    assert.equal(
      prova.questoes.some((q) => q.questaoReformulada && q.personalizacaoInteligente?.mecanismo === 'template_local'),
      false,
      'Questões reformuladas não devem passar por personalização automática por template.',
    );
  }

  const planejamento = gerar(perguntas, 'Planejamento', '4', 'Operação / Gestão');
  assert.equal(
    planejamento.questoes.filter((q) => q.questaoReformulada).length,
    8,
    'Planejamento deve usar as sete questões Word e a redação do DOCX.',
  );
  assert.equal(
    planejamento.questoes.filter((q) => q.tipo === 'word_discursive').length,
    2,
    'Planejamento deve manter as duas questões discursivas.',
  );
  assert.match(
    planejamento.questoes.find((q) => q.stageKey === 'professional_essay')?.essay?.theme || '',
    /Planejamento.*cérebro da operação/i,
    'O tema neutro de Planejamento deve vir do DOCX.',
  );
  assertSemSigiloVisivel(planejamento.questoes, 'Planejamento neutra');

  const planejamentoPersonalizado = personalizacao.gerarPersonalizacaoProva(
    planejamento.questoes,
    {
      vaga: 'Planejamento',
      trilha: 'Operação / Gestão',
      nivelProva: '4',
      operacao: 'Davita',
      clientesOperacoes: ['Davita'],
      tiposAtendimento: ['Agendamento de consultas'],
      nivelPersonalizacao: 'situacional',
      usuario: 'smoke-test',
    },
  );
  assert.equal(
    planejamentoPersonalizado.questoes.filter(
      (q) => q.questaoReformulada && q.personalizacaoInteligente?.mecanismo === 'banco_personalizado',
    ).length,
    8,
    'Planejamento personalizado deve reutilizar as oito variações do cliente.',
  );
  assert.match(
    planejamentoPersonalizado.questoes.find((q) => q.stageKey === 'professional_essay')?.essay?.theme || '',
    /Central de Agendamentos/i,
    'A redação personalizada de Planejamento deve usar o tema da DaVita.',
  );
  assertSemSigiloVisivel(planejamentoPersonalizado.questoes, 'Planejamento personalizada');

  const opcaoQualidade = perguntas.OPCOES_VAGAS_PROCESSO.find((opcao) => opcao.label === 'Qualidade');
  assert.deepEqual(
    opcaoQualidade,
    { label: 'Qualidade', level: '4', track: 'Operação / Gestão' },
    'Qualidade deve estar disponível no cadastro do processo.',
  );
  const qualidade = gerar(perguntas, 'Qualidade', '4', 'Operação / Gestão');
  assert.deepEqual(
    qualidade.blueprint.stages.map((stage) => stage.label),
    ['Word', 'Excel', 'Redação', 'Conhecimentos Técnicos', 'Conhecimentos Gerais'],
    'Qualidade deve manter somente as cinco etapas solicitadas e na ordem definida.',
  );
  assert.deepEqual(
    qualidade.blueprint.stages.map((stage) => stage.key),
    ['word_advanced', 'excel_advanced', 'professional_essay', 'tech_adm_specific', 'general_advanced'],
    'Qualidade deve usar o nível avançado de Excel.',
  );
  assertExcelPreservado(qualidade.questoes, 'qualid_exam', 'Qualidade');
  assert.equal(
    qualidade.questoes.find((questao) => questao.type === 'excel_external')?.stageKey,
    'excel_advanced',
    'A planilha de Qualidade deve ser classificada como Excel avançado.',
  );
  assert.equal(
    perguntas.resolverBlueprintProva('Qualidade', '1', 'Operação / Gestão'),
    qualidade.blueprint,
    'Qualidade deve preservar o blueprint com Excel avançado mesmo se o nível geral for alterado.',
  );
  assertSemSigiloVisivel(qualidade.questoes, 'Qualidade neutra');

  const analista = gerar(perguntas, 'Analista', '4', 'ADM / Gestão');
  assert.equal(
    analista.questoes.filter((q) => q.questaoReformulada).length,
    0,
    'Cargo não reformulado deve continuar no banco antigo.',
  );
  assertExcelPreservado(analista.questoes, 'advanced_exam', 'Analista');

  const editorSource = fs.readFileSync(
    path.join(rootDir, 'fonte', 'ui', 'components', 'exam-fields.js'),
    'utf8',
  );
  for (const comando of ['bold', 'italic', 'underline', 'strikeThrough', 'fontSize', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList']) {
    assert.ok(editorSource.includes(comando), `Editor deve expor comando ${comando}`);
  }

  const esperadoFormatado = {
    minTextLength: 20,
    anyBold: true,
    requiresItalic: true,
    requiresUnderline: true,
    requiresStrike: true,
    requiredFontSize: 14,
    requiredAlignment: 'justify',
    requiresList: true,
    requiredListType: 'ordered',
  };
  const respostaFormatada = {
    content: '<div style="text-align: justify"><ol><li><font size="3"><strong><em><u><s>Resposta completa e organizada para avaliação.</s></u></em></strong></font></li></ol></div>',
  };
  const respostaSemFormatacao = {
    content: '<p>Resposta completa e organizada para avaliação.</p>',
  };
  const notaFormatada = regrasProva.avaliarRespostaTexto(respostaFormatada, esperadoFormatado, 10);
  const notaSemFormatacao = regrasProva.avaliarRespostaTexto(respostaSemFormatacao, esperadoFormatado, 10);
  assert.ok(notaFormatada > notaSemFormatacao, 'A avaliação existente deve considerar as formatações solicitadas.');
  assert.deepEqual(regrasProva.obterFormatacoesAplicadas(respostaFormatada), {
    negrito: true,
    italico: true,
    sublinhado: true,
    tachado: true,
    tamanhosFonte: [14],
    alinhamentos: ['justify'],
    lista: true,
    listaOrdenada: true,
    listaNaoOrdenada: false,
  });

  const analise = personalizacao.corrigirRespostaDiscursivaInteligente(
    {
      ...questaoComJustificado,
      rubricaInterna: 'Rubrica restrita ao RH.',
    },
    {
      ...respostaFormatada,
      formatacoesAplicadas: regrasProva.obterFormatacoesAplicadas(respostaFormatada),
    },
    notaFormatada,
    10,
  );
  assert.equal(analise.nota_sugerida, notaFormatada, 'A Análise de Resposta deve preservar a nota-base atual.');
  assert.equal(analise.dados_analisados.rubrica_interna, 'Rubrica restrita ao RH.');
  assert.equal(
    analise.dados_analisados.o_que_deve_ser_avaliado,
    questaoComJustificado.oQueDeveSerAvaliado,
  );
  assert.equal(analise.dados_analisados.formatacoes_aplicadas.alinhamentos[0], 'justify');

  console.log('RH business rules smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
