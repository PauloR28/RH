import { invalidarCacheApi, requisitar } from './core.js';

// RH: banco de blocos/frases do teste DISC próprio (calibrado para Call Center).
export async function listarBlocosDisc() {
  return requisitar('/disc/blocos', { method: 'GET' });
}

export async function criarBlocoDisc(payload) {
  const resultado = await requisitar('/disc/blocos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('disc-blocos');
  return resultado;
}

export async function atualizarBlocoDisc(idBloco, payload) {
  const resultado = await requisitar(`/disc/blocos/${encodeURIComponent(idBloco)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('disc-blocos');
  return resultado;
}

// RH: gerar uma aplicação do teste DISC para um candidato.
export async function criarAplicacaoDisc(payload) {
  const resultado = await requisitar('/disc/aplicacoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('disc-aplicacoes');
  return resultado;
}

export async function lerAplicacaoDisc(idAplicacao) {
  return requisitar(`/disc/aplicacoes/${encodeURIComponent(idAplicacao)}`, { method: 'GET' });
}

export async function lerResultadoDiscCandidato(idTeste) {
  return requisitar(`/disc/candidatos/${encodeURIComponent(idTeste)}/resultado`, { method: 'GET' });
}

// Candidato (rota pública, sem autenticação de RH): aplicação do teste.
export async function lerAplicacaoDiscPublica(idAplicacao) {
  return requisitar(`/disc-api/aplicacoes/${encodeURIComponent(idAplicacao)}`, { method: 'GET' });
}

export async function finalizarAplicacaoDiscPublica(idAplicacao, payload) {
  return requisitar(`/disc-api/aplicacoes/${encodeURIComponent(idAplicacao)}/finalizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}
