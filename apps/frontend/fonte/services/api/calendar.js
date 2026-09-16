import { invalidarCacheApi, requisitar } from './core.js';

export async function listarDatasComemorativas() {
  return requisitar('/celebratory-dates', { method: 'GET' });
}

export async function criarDataComemorativa(payload) {
  const resultado = await requisitar('/celebratory-dates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('celebratory-dates');
  return resultado;
}

export async function atualizarDataComemorativa(idData, payload) {
  const resultado = await requisitar(`/celebratory-dates/${encodeURIComponent(idData)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('celebratory-dates');
  return resultado;
}

export async function removerDataComemorativa(idData) {
  const resultado = await requisitar(`/celebratory-dates/${encodeURIComponent(idData)}`, {
    method: 'DELETE',
  });
  invalidarCacheApi('celebratory-dates');
  return resultado;
}

export async function listarEventosCalendario() {
  return requisitar('/calendar/events', { method: 'GET' });
}

export async function listarAmbientesCalendario() {
  return requisitar('/celebratory-dates/ambientes', { method: 'GET' });
}

export async function buscarEnderecoEmpresaCalendario() {
  return requisitar('/celebratory-dates/endereco-empresa', { method: 'GET' });
}

export async function uploadImagemCalendario(arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  return requisitar('/celebratory-dates/imagens', {
    method: 'POST',
    body: formData,
  });
}
