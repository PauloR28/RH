import {
  gravarCache,
  lerCache,
  montarChaveCacheApi,
  requisitar,
  requisitarArquivo,
} from './core.js?v=20261124-cache';

export async function lerAnalisesCandidatos(forcar = false) {
  const chaveCache = 'relatorios:analises-candidatos';
  if (!forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }
  const dados = await requisitar('/candidate-analytics', { method: 'GET' });
  gravarCache(chaveCache, dados, { sensivel: true });
  return dados;
}

export async function lerDetalheAnaliseCandidato(idTeste, forcar = false) {
  const chaveCache = `relatorios:analise-candidato:${idTeste}`;
  if (!forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }
  const dados = await requisitar(`/candidate-analytics/${encodeURIComponent(idTeste)}`, {
    method: 'GET',
  });
  gravarCache(chaveCache, dados, { sensivel: true });
  return dados;
}

function montarParametrosRelatorio(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.dataInicial) params.set('start_date', filtros.dataInicial);
  if (filtros.dataFinal) params.set('end_date', filtros.dataFinal);
  if (filtros.status) params.set('status_filter', filtros.status);
  if (filtros.processo) params.set('id_processo', filtros.processo);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function lerRelatorioProcessos(filtros = {}) {
  const chaveCache = montarChaveCacheApi('relatorios:processos', filtros);
  const emCache = lerCache(chaveCache);
  if (emCache) return emCache;
  const dados = await requisitar(`/reports/processes${montarParametrosRelatorio(filtros)}`, {
    method: 'GET',
  });
  gravarCache(chaveCache, dados, { sensivel: true });
  return dados;
}

export async function baixarRelatorioProcessos(filtros = {}) {
  return requisitarArquivo(
    `/reports/processes/export${montarParametrosRelatorio(filtros)}`,
    { method: 'GET' },
  );
}

export async function lerRelatorioCandidatos(filtros = {}) {
  const chaveCache = montarChaveCacheApi('relatorios:candidatos', filtros);
  const emCache = lerCache(chaveCache);
  if (emCache) return emCache;
  const dados = await requisitar(`/reports/candidates${montarParametrosRelatorio(filtros)}`, {
    method: 'GET',
  });
  gravarCache(chaveCache, dados, { sensivel: true });
  return dados;
}

export async function baixarRelatorioCandidatos(filtros = {}) {
  return requisitarArquivo(
    `/reports/candidates/export${montarParametrosRelatorio(filtros)}`,
    { method: 'GET' },
  );
}

export async function lerFunilDashboard(filtros = {}) {
  const chaveCache = montarChaveCacheApi('relatorios:funil-dashboard', filtros);
  const emCache = lerCache(chaveCache);
  if (emCache) return emCache;
  const dados = await requisitar(`/reports/funnel-dashboard${montarParametrosRelatorio(filtros)}`, {
    method: 'GET',
  });
  gravarCache(chaveCache, dados, { sensivel: true });
  return dados;
}
