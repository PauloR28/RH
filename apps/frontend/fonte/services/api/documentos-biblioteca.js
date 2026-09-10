import { requisitar } from './core.js';

export async function listarDocumentosBiblioteca() {
  return requisitar('/documentos-biblioteca', { method: 'GET' });
}

export async function criarDocumentoBiblioteca(payload) {
  return requisitar('/documentos-biblioteca', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function atualizarDocumentoBiblioteca(idDocumento, payload) {
  return requisitar(`/documentos-biblioteca/${encodeURIComponent(idDocumento)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function excluirDocumentoBiblioteca(idDocumento) {
  return requisitar(`/documentos-biblioteca/${encodeURIComponent(idDocumento)}`, {
    method: 'DELETE',
  });
}
