import { invalidarCacheApi, requisitar } from './core.js?v=20261126-painel-graficos';

export async function listarPoliticas() {
  return requisitar('/policies', { method: 'GET' });
}

export async function criarPolitica(payload) {
  const resultado = await requisitar('/policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('policies');
  return resultado;
}

export async function atualizarPolitica(idPolitica, payload) {
  const resultado = await requisitar(`/policies/${encodeURIComponent(idPolitica)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('policies');
  return resultado;
}

export async function buscarPoliticaPendente() {
  const dados = await requisitar('/policies/pending', { method: 'GET' });
  if (!dados || !dados.id_politica) return null;
  return dados;
}

export async function confirmarLeituraPolitica(idPolitica) {
  return requisitar(`/policies/${encodeURIComponent(idPolitica)}/confirm`, {
    method: 'POST',
  });
}
