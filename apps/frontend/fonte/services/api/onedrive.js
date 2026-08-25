import { invalidarCacheApi, requisitar, requisitarArquivo } from './core.js';

export async function listarArquivosOneDrive(caminho = '') {
  const params = new URLSearchParams();
  if (caminho) params.set('caminho', caminho);
  const sufixo = params.toString() ? `?${params.toString()}` : '';
  return requisitar(`/onedrive/items${sufixo}`, { method: 'GET' });
}

export async function criarPastaOneDrive(caminho, nomePasta) {
  const resultado = await requisitar('/onedrive/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caminho, nome_pasta: nomePasta }),
  });
  invalidarCacheApi('onedrive');
  return resultado;
}

export async function enviarArquivoOneDrive(caminho, arquivo) {
  const params = new URLSearchParams();
  if (caminho) params.set('caminho', caminho);
  const dadosFormulario = new FormData();
  dadosFormulario.append('arquivo', arquivo);
  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const resultado = await requisitar(`/onedrive/upload${sufixo}`, {
    method: 'POST',
    body: dadosFormulario,
  });
  invalidarCacheApi('onedrive');
  return resultado;
}

export async function baixarArquivoOneDrive(caminho) {
  const params = new URLSearchParams({ caminho });
  return requisitarArquivo(`/onedrive/download?${params.toString()}`, { method: 'GET' });
}

export async function obterPreviewOneDrive(caminho) {
  const params = new URLSearchParams({ caminho });
  return requisitar(`/onedrive/preview?${params.toString()}`, { method: 'GET' });
}

export async function excluirItemOneDrive(caminho, justificativa = '') {
  const params = new URLSearchParams({ caminho });
  if (justificativa) params.set('justificativa', justificativa);
  const resultado = await requisitar(`/onedrive/items?${params.toString()}`, { method: 'DELETE' });
  invalidarCacheApi('onedrive');
  return resultado;
}
