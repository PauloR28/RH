import {
  gravarCache,
  invalidarCacheApi,
  lerCache,
  requisitar,
} from './core.js?v=20261124-equipes2';

export async function lerHistorico() {
  return requisitar('/history', { method: 'GET' });
}

export async function lerHistoricoPaginado({
  pagina = 1,
  tamanho = 10,
  nome = '',
  vaga = '',
  data = '',
} = {}) {
  const params = new URLSearchParams({
    page: String(pagina),
    page_size: String(tamanho),
  });

  if (nome) params.set('nome', nome);
  if (vaga) params.set('vaga', vaga);
  if (data) params.set('data', data);

  return requisitar(`/history?${params.toString()}`, { method: 'GET' });
}

export async function salvarHistorico(linha) {
  const resultado = await requisitar('/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(linha),
  });

  invalidarCacheApi('historico');
  return resultado;
}

export async function lerArquivosResposta() {
  const emCache = lerCache('gabaritos');
  if (emCache) return emCache;

  const dados = await requisitar('/answer-files', { method: 'GET' });
  const seguro = dados && typeof dados === 'object' ? dados : {};
  gravarCache('gabaritos', seguro);
  return seguro;
}

export async function salvarArquivoResposta(payload) {
  const resultado = await requisitar('/answer-files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi('gabaritos');
  return resultado;
}
