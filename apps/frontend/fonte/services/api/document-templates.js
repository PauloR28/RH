import { invalidarCacheApi, requisitar } from './core.js?v=20261125-acessos-perfil';

export async function listarVariaveisTemplatesDocumentos() {
  return requisitar('/document-templates/variables', { method: 'GET' });
}

export async function listarTemplatesDocumentos() {
  return requisitar('/document-templates', { method: 'GET' });
}

export async function criarTemplateDocumento(payload) {
  const resultado = await requisitar('/document-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('templates-documentos');
  return resultado;
}

export async function atualizarTemplateDocumento(idTemplate, payload) {
  const resultado = await requisitar(`/document-templates/${encodeURIComponent(idTemplate)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('templates-documentos');
  return resultado;
}

export async function excluirTemplateDocumento(idTemplate) {
  const resultado = await requisitar(`/document-templates/${encodeURIComponent(idTemplate)}`, {
    method: 'DELETE',
  });
  invalidarCacheApi('templates-documentos');
  return resultado;
}

export async function gerarDocumentoPorTemplate(payload) {
  return requisitar('/document-templates/gerar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}
