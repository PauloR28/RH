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
  path.join(rootDir, 'fonte', 'features', 'processos', 'index.js'),
  'utf8',
);

assert.ok(source.includes("['reprovados', `Reprovados (${reprovados.length})`]"));
assert.equal(source.includes('cv-reprovado-'), false);
assert.ok(source.includes('42 * 60 * 60 * 1000'));
assert.ok(source.includes("label: 'Confirmar entrevista'"));
assert.ok(source.includes("label: 'Cancelar prova'"));
assert.ok(source.includes("label: 'Aprovar candidato'"));
assert.ok(source.includes("label: 'Reabrir prova'"));
assert.ok(source.includes("label: 'Deletar prova'"));
assert.ok(source.includes("label: 'Editar prova'"));
assert.ok(source.includes('obterEntrevistasConfirmadas(entrevistasProcesso)'));
assert.ok(source.includes('CANDIDATE_STATUS_WITHDREW'));
assert.ok(source.includes('return isActiveCandidateStatus(status);'));
assert.ok(source.includes('status === CANDIDATE_STATUS_WITHDREW'));
assert.ok(source.includes('[CANDIDATE_STATUS_ELIMINATED, CANDIDATE_STATUS_WITHDREW].includes(statusEntrevista)'));
assert.ok(source.includes("'Desistência do candidato'"));
assert.ok(source.includes("['groups', 'Candidatos no processo', candidatos.length, "));
assert.ok(source.includes('titulo="Ficha do candidato"'));
assert.ok(source.includes('Qualidades analisadas do CV'));
assert.ok(source.includes('Ver nota completa'));
assert.ok(source.includes('candidate-profile-actions'));
assert.equal(source.includes('normalizarComparacao('), false);
const candidateTableStart = source.indexOf("${aba === 'candidatos' ? html`");
const approvedTableStart = source.indexOf("${aba === 'aprovados' ? html`");
const candidateTable = source.slice(candidateTableStart, approvedTableStart);
assert.equal(candidateTable.includes('<${MenuAcoesProcesso}'), false);

console.log('Process details rules smoke passed.');
