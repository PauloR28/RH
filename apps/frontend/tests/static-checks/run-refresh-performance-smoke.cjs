// Checagem estática (achado S-25): verifica que trechos-chave do código-fonte
// ainda existem/não existem literalmente no arquivo (grep programático), não
// o comportamento renderizado da tela. Serve para pegar rapidamente uma
// remoção/renomeação acidental de regra de negócio durante um refactor —
// não substitui um teste de comportamento real (ver `tests-e2e/` para isso).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(rootDir, ...parts), 'utf8');

const core = read('fonte', 'services', 'api', 'core.js');
const processesApi = read('fonte', 'services', 'api', 'processes.js');
const processesScreen = read('fonte', 'features', 'processos', 'index.js');
const appRoot = read('fonte', 'app', 'aplicacao-raiz.js');
const managementScreen = read('fonte', 'features', 'gestao', 'index.js');
const emptyTableRow = read('fonte', 'shared', 'components', 'empty-table-row.js');
const feedbackComponents = read('fonte', 'ui', 'components', 'feedback.js');

assert.ok(core.includes("PREFIXO_CACHE_SESSAO = 'rh_api_cache_v2:'"));
assert.ok(core.includes('sessionStorage.setItem(chaveCacheSessao(chave), serializado)'));
assert.ok(processesApi.includes('processos:detalhe:'));
assert.ok(processesScreen.includes('aplicarDetalhePrincipal(detalhe || {})'));
assert.ok(processesScreen.includes('setCarregando(false);'));
assert.equal(processesScreen.includes('lerBancoTalentos({ forcar: true })'), false);
assert.ok(appRoot.includes('function carregarTela(importador, nomeExportado)'));
assert.ok(appRoot.includes('<${Suspense}'));
assert.ok(processesApi.includes('TEMPO_CACHE_EMAIL_INBOX_MS = 60 * 60 * 1000'));
assert.ok(processesApi.includes("const paramsCache = new URLSearchParams({ limit: String(limite) });"));
assert.ok(managementScreen.includes('const cacheSecoesEmail = new Map();'));
assert.ok(managementScreen.includes('refresh: forcar'));
assert.ok(managementScreen.includes('lerProcessos({ forcar })'));
assert.equal(managementScreen.includes('refresh: true'), false);
assert.equal(managementScreen.includes(').filter((processo) => !isProcessClosed(processo)),\n      }'), false);
assert.ok(emptyTableRow.includes('rh-loading-state c24-loading-panel'));
assert.ok(feedbackComponents.includes('rh-loading-state c24-loading-panel'));

console.log('Refresh performance smoke passed.');
