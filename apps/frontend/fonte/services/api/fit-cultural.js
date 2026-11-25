import { invalidarCacheApi, requisitar } from './core.js?v=20261125-deploy';

// RH: administração de valores da empresa e frases associadas.
export async function listarValoresEmpresa() {
  return requisitar('/fit-cultural/valores', { method: 'GET' });
}

export async function criarValorEmpresa(payload) {
  const resultado = await requisitar('/fit-cultural/valores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('valores-empresa');
  return resultado;
}

export async function atualizarValorEmpresa(idValor, payload) {
  const resultado = await requisitar(`/fit-cultural/valores/${encodeURIComponent(idValor)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('valores-empresa');
  return resultado;
}

export async function lerResultadoFitCultural(candidatoProcessoId) {
  return requisitar(`/fit-cultural/candidatos/${encodeURIComponent(candidatoProcessoId)}/resultado`, {
    method: 'GET',
  });
}

// Candidato (rota pública): responde o questionário de fit cultural (escala Likert 1-5).
export async function listarFrasesFitCulturalPublicas() {
  return requisitar('/fit-cultural-api/frases', { method: 'GET' });
}

export async function enviarRespostasFitCulturalPublicas(payload) {
  return requisitar('/fit-cultural-api/respostas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}
