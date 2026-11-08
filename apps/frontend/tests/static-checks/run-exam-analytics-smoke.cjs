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

const routes = read('fonte', 'rotas.js');
const app = read('fonte', 'app', 'aplicacao-raiz.js');
const processDetails = read('fonte', 'features', 'processos', 'index.js');
const analyticsPage = read('fonte', 'features', 'resultados-analiticos', 'index.js');
const examPage = read('fonte', 'features', 'conecta-provas', 'index.js');
const sidebar = read('fonte', 'ui', 'components', 'layout.js');
const analyticsApi = read('fonte', 'services', 'api', 'exam-analytics.js');

assert.ok(routes.includes("'screen-process-analytical-results'"));
assert.ok(routes.includes("/^processos\\/.+\\/resultados-analiticos$/"));
assert.ok(app.includes('TelaResultadosAnaliticosProcesso'));
assert.ok(processDetails.includes('Resultados das provas'));
assert.ok(analyticsPage.includes('Nota oficial, decisão humana'));
assert.ok(analyticsPage.includes('Amostra pequena'));
assert.ok(analyticsPage.includes('Selecione 2 ou 3 candidatos'));
assert.ok(analyticsPage.includes('Candidatos com prova'));
assert.ok(analyticsPage.includes('Correções com erro'));
assert.ok(analyticsPage.includes('Avaliação comparável'));
assert.ok(analyticsPage.includes('Correção manual'));
assert.ok(analyticsPage.includes('Score analítico mínimo'));
assert.ok(analyticsPage.includes('Mapeamento de etapas para categorias'));
assert.ok(analyticsPage.includes('Informação não registrada nesta versão da prova'));
assert.ok(analyticsPage.includes('Percentil geral'));
assert.ok(analyticsPage.includes('Fórmula ou método'));
assert.ok(analyticsApi.includes('/categories'));
assert.ok(analyticsPage.includes('não são exibidos nem coletados'));
assert.ok(examPage.includes('O conteudo da area de transferencia nunca e lido nem persistido;'));
assert.equal(examPage.includes("clipboardData.getData"), false);

const sidebarLinksStart = sidebar.indexOf('const sublinksProcessos = [');
// Só a lista de links do menu de Processos (termina no primeiro `];` depois do início).
const sidebarLinksEnd = sidebar.indexOf('];', sidebarLinksStart);
assert.ok(sidebarLinksStart >= 0 && sidebarLinksEnd > sidebarLinksStart);
const sidebarLinks = sidebar.slice(sidebarLinksStart, sidebarLinksEnd);
assert.equal(sidebarLinks.includes('screen-process-analytical-results'), false);

console.log('Exam analytics smoke passed.');
