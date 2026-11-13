// Checagem estática (achado S-25): verifica que trechos-chave do código-fonte
// ainda existem/não existem literalmente no arquivo (grep programático), não
// o comportamento renderizado da tela. Serve para pegar rapidamente uma
// remoção/renomeação acidental de regra de negócio durante um refactor —
// não substitui um teste de comportamento real (ver `tests-e2e/` para isso).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(rootDir, 'fonte', 'features', 'conecta-provas', 'index.js'),
  'utf8',
);
const apiAggregator = fs.readFileSync(
  path.join(__dirname, '..', '..', 'fonte', 'servico-api.js'),
  'utf8',
);
const generatedExamsApi = fs.readFileSync(
  path.join(__dirname, '..', '..', 'fonte', 'services', 'api', 'generated-exams.js'),
  'utf8',
);
const indexHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const principal = fs.readFileSync(path.join(__dirname, '..', '..', 'fonte', 'principal.js'), 'utf8');
const aplicacao = fs.readFileSync(path.join(__dirname, '..', '..', 'fonte', 'aplicacao.js'), 'utf8');

assert.ok(source.includes('>Começar</button>'));
assert.ok(source.includes("const bloqueada = (!somenteCadastro && !cadastroConcluido) || indisponivel"));
assert.ok(source.includes('concluirEtapaConectaProvas('));
assert.ok(source.includes('montarPayloadTelemetria({ finalizarEtapa: true })'));
assert.ok(source.includes('interromperEtapaConectaProvas('));
assert.ok(apiAggregator.includes("generated-exams.js?v=20260902-correcoes-rh"));
assert.ok(generatedExamsApi.includes('export async function concluirEtapaConectaProvas'));
// A cadeia de carregamento usa tag de versão (?v=) em cada elo, para o navegador baixar os arquivos novos.
assert.match(indexHtml, /principal\.js\?v=[\w-]+/);
assert.match(principal, /aplicacao\.js\?v=[\w-]+/);
assert.match(aplicacao, /aplicacao-raiz\.js\?v=[\w-]+/);
assert.ok(!source.includes('Ver etapas'));
assert.ok(source.includes("setEtapa('etapas')"));
assert.ok(source.includes('localStorage.setItem(CHAVE_TOKEN_PUBLICO'));
assert.ok(source.includes("dados?.candidato?.dados_confirmados"));
assert.ok(source.includes('conecta-provas-essay-keywords'));
assert.ok(source.includes('Boa sorte!'));
assert.ok(source.includes('conecta-provas-copy-text'));
assert.ok(source.includes('function normalizarQuebrasTextoQuestao'));
assert.ok(source.includes('function BlocosTextoQuestao'));
assert.ok(source.includes('conecta-provas-question-heading'));
assert.ok(source.includes('conecta-provas-question-quote'));
assert.ok(source.includes('conecta-provas-question-command'));
assert.ok(source.includes("return limparTextoVisivelCandidato(temaNaProposta) || 'Tema Livre'"));

const regrasSource = fs.readFileSync(path.join(rootDir, 'fonte', 'regras-prova.js'), 'utf8');
const helpersSource = fs.readFileSync(
  path.join(rootDir, 'fonte', 'shared', 'helpers-visuais.js'),
  'utf8',
);
assert.doesNotMatch(
  `${regrasSource}\n${helpersSource}`,
  /from ['"].*(?:perguntas|banco-questoes|personalizacao-inteligente)/,
  'A rota pública não deve carregar indiretamente o banco interno de questões/rubricas.',
);

console.log('Conecta Provas flow smoke passed.');
