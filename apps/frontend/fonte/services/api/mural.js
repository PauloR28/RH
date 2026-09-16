import { requisitar } from './core.js';

export async function listarMural(statusFiltro = '') {
  const query = statusFiltro ? `?status_filtro=${encodeURIComponent(statusFiltro)}` : '';
  return requisitar(`/mural${query}`, { method: 'GET' });
}

export async function lerPublicacaoMural(idPublicacao) {
  return requisitar(`/mural/${encodeURIComponent(idPublicacao)}`, { method: 'GET' });
}

export async function listarAmbientesMural() {
  return requisitar('/mural/ambientes', { method: 'GET' });
}

export async function criarPublicacaoMural(payload) {
  return requisitar('/mural', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function atualizarPublicacaoMural(idPublicacao, payload) {
  return requisitar(`/mural/${encodeURIComponent(idPublicacao)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function arquivarPublicacaoMural(idPublicacao) {
  return requisitar(`/mural/${encodeURIComponent(idPublicacao)}/arquivar`, { method: 'POST' });
}

export async function restaurarPublicacaoMural(idPublicacao) {
  return requisitar(`/mural/${encodeURIComponent(idPublicacao)}/restaurar`, { method: 'POST' });
}

export async function publicarMural(idPublicacao, ambientes = []) {
  return requisitar(`/mural/${encodeURIComponent(idPublicacao)}/publicar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ambientes }),
  });
}

export async function excluirPublicacaoMural(idPublicacao) {
  return requisitar(`/mural/${encodeURIComponent(idPublicacao)}`, { method: 'DELETE' });
}

export async function uploadImagemMural(arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  return requisitar('/mural/imagens', {
    method: 'POST',
    body: formData,
  });
}
