import { invalidarCacheApi, requisitar } from './core.js?v=20261126-senha';

export async function lerPipelineCandidatos(idProcesso = '', search = '') {
  const params = new URLSearchParams();
  if (idProcesso) params.set('id_processo', idProcesso);
  if (search) params.set('search', search);

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  return requisitar(`/candidate-pipeline${sufixo}`, { method: 'GET' });
}

export async function criarCardPipeline(payload) {
  const resultado = await requisitar('/candidate-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos');
  return resultado;
}

export async function moverCardPipeline(idRegistro, payload) {
  const resultado = await requisitar(
    `/candidate-pipeline/${encodeURIComponent(idRegistro)}/stage`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function excluirCardPipeline(idRegistro) {
  const resultado = await requisitar(
    `/candidate-pipeline/${encodeURIComponent(idRegistro)}`,
    { method: 'DELETE' },
  );

  invalidarCacheApi(
    'candidatos-processos',
    'pipeline-candidatos',
    'processos',
    'banco-talentos',
    'relatorios',
    'historico',
  );
  return resultado;
}
