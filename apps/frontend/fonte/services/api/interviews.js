import { gravarCache, invalidarCacheApi, lerCache, requisitar } from './core.js?v=20261125-deploy';

export async function lerEntrevistas({
  idProcesso = '',
  statusEntrevista = '',
  search = '',
} = {}) {
  const params = new URLSearchParams();
  if (idProcesso) params.set('id_processo', idProcesso);
  if (statusEntrevista) params.set('status_entrevista', statusEntrevista);
  if (search) params.set('search', search);

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const chaveCache = `entrevistas:${params.toString()}`;
  const emCache = lerCache(chaveCache);
  if (emCache) return emCache;
  const dados = await requisitar(`/interviews${sufixo}`, { method: 'GET' });
  gravarCache(chaveCache, dados);
  return dados;
}

export async function lerSlotsEntrevista({
  idProcesso = '',
  date = '',
  statusSlot = '',
} = {}) {
  const params = new URLSearchParams();
  if (idProcesso) params.set('id_processo', idProcesso);
  if (date) params.set('date', date);
  if (statusSlot) params.set('status_slot', statusSlot);

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const chaveCache = `slots-entrevista:${params.toString()}`;
  const emCache = lerCache(chaveCache);
  if (emCache) return emCache;
  const dados = await requisitar(`/interview-slots${sufixo}`, { method: 'GET' });
  gravarCache(chaveCache, dados);
  return dados;
}

export async function criarSlotsEntrevista(payload) {
  const resultado = await requisitar('/interview-slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos', 'entrevistas', 'slots-entrevista', 'relatorios', 'historico');
  return resultado;
}

export async function atualizarSlotEntrevista(idSlot, payload) {
  const resultado = await requisitar(
    `/interview-slots/${encodeURIComponent(idSlot)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos', 'entrevistas', 'slots-entrevista', 'relatorios', 'historico');
  return resultado;
}

export async function excluirSlotEntrevista(idSlot) {
  const resultado = await requisitar(
    `/interview-slots/${encodeURIComponent(idSlot)}`,
    { method: 'DELETE' },
  );

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos', 'entrevistas', 'slots-entrevista', 'relatorios', 'historico');
  return resultado;
}

export async function agendarEntrevista(payload) {
  const resultado = await requisitar('/interviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos', 'entrevistas', 'slots-entrevista', 'relatorios', 'historico');
  return resultado;
}

export async function atualizarEntrevista(idEntrevista, payload) {
  const resultado = await requisitar(
    `/interviews/${encodeURIComponent(idEntrevista)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  invalidarCacheApi('candidatos-processos', 'pipeline-candidatos', 'processos', 'entrevistas', 'slots-entrevista', 'relatorios', 'historico');
  return resultado;
}
