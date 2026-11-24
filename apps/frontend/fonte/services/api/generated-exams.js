import { invalidarCacheApi, lerCache, gravarCache, requisitar } from './core.js?v=20261124-equipes4';

const CACHE_PROVAS_GERADAS = 'provas-geradas';
const TEMPO_CACHE_PROVAS_GERADAS_MS = 60 * 60 * 1000;
const requisicoesEmAndamento = new Map();

export async function listarProvasGeradas(opcoes = {}) {
  const forcar = typeof opcoes === 'boolean' ? opcoes : Boolean(opcoes?.forcar);
  if (forcar) {
    invalidarCacheApi(CACHE_PROVAS_GERADAS);
  }
  const cache = lerCache(CACHE_PROVAS_GERADAS, { sensivel: true, ttlMs: TEMPO_CACHE_PROVAS_GERADAS_MS });
  if (!forcar && cache) return cache;
  if (requisicoesEmAndamento.has(CACHE_PROVAS_GERADAS)) {
    return requisicoesEmAndamento.get(CACHE_PROVAS_GERADAS);
  }

  const requisicao = requisitar('/generated-exams')
    .then((dados) => {
      gravarCache(CACHE_PROVAS_GERADAS, dados, { sensivel: true, ttlMs: TEMPO_CACHE_PROVAS_GERADAS_MS });
      return dados;
    })
    .finally(() => requisicoesEmAndamento.delete(CACHE_PROVAS_GERADAS));
  requisicoesEmAndamento.set(CACHE_PROVAS_GERADAS, requisicao);
  return requisicao;
}

export async function criarProvaGerada(payload) {
  const resultado = await requisitar('/generated-exams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function atualizarProvaGerada(idProva, payload) {
  const resultado = await requisitar(`/generated-exams/${encodeURIComponent(idProva)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function deletarProvaGerada(idProva) {
  const resultado = await requisitar(`/generated-exams/${encodeURIComponent(idProva)}`, {
    method: 'DELETE',
  });
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function lerProvaGerada(idProva) {
  return requisitar(`/generated-exams/${encodeURIComponent(idProva)}`);
}

export async function lerReplayProvaGerada(idProva) {
  return requisitar(`/generated-exams/${encodeURIComponent(idProva)}/replay`);
}

export async function lerSessaoPreviaProvaGerada(idProva) {
  return requisitar(`/generated-exams/${encodeURIComponent(idProva)}/preview-session`);
}

export async function lerHeatmapQuestoes(trilha = '') {
  const query = trilha ? `?trilha=${encodeURIComponent(trilha)}` : '';
  return requisitar(`/generated-exams/question-heatmap${query}`);
}

export async function recalcularScoreProva(idProva) {
  const resultado = await requisitar(
    `/generated-exams/${encodeURIComponent(idProva)}/score/recalculate`,
    { method: 'POST' },
  );
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function salvarAvaliacaoManualProva(idProva, payload) {
  const resultado = await requisitar(
    `/generated-exams/${encodeURIComponent(idProva)}/manual-evaluation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function reabrirProvaGerada(idProva, payload) {
  const resultado = await requisitar(
    `/generated-exams/${encodeURIComponent(idProva)}/reopen`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function cancelarProvaGerada(idProva, payload) {
  const resultado = await requisitar(
    `/generated-exams/${encodeURIComponent(idProva)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function registrarDecisaoRhProva(idProva, payload) {
  const resultado = await requisitar(
    `/generated-exams/${encodeURIComponent(idProva)}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
  invalidarCacheApi(CACHE_PROVAS_GERADAS, 'candidatos-processos', 'processos', 'pipeline-candidatos', 'banco-talentos', 'relatorios', 'historico');
  return resultado;
}

export async function acessarProvaPorEmail(email) {
  return requisitar('/conecta-provas-api/acesso/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }, { autenticado: false });
}

export async function acessarProvaPorTelefone(telefone) {
  return requisitar('/conecta-provas-api/acesso/telefone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefone }),
  }, { autenticado: false });
}

export async function acessarProvaPorCodigo(codigo) {
  return requisitar('/conecta-provas-api/acesso/codigo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
  }, { autenticado: false });
}

export async function lerSessaoConectaProvas(token) {
  return requisitar('/conecta-provas-api/sessao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }, { autenticado: false });
}

export async function confirmarDadosConectaProvas(payload) {
  return requisitar('/conecta-provas-api/confirmar-dados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  }, { autenticado: false });
}

export async function iniciarConectaProvas(token) {
  return requisitar('/conecta-provas-api/iniciar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }, { autenticado: false });
}

export async function iniciarEtapaConectaProvas(token, etapaChave, questaoIndice, etapaIniciadaEm) {
  return requisitar('/conecta-provas-api/iniciar-etapa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      etapa_chave: etapaChave,
      questao_indice: questaoIndice,
      etapa_iniciada_em: etapaIniciadaEm || new Date().toISOString(),
    }),
  }, { autenticado: false });
}

export async function salvarRespostasConectaProvas(token, respostas, telemetria = {}) {
  return requisitar('/conecta-provas-api/respostas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, respostas, ...(telemetria || {}) }),
  }, { autenticado: false });
}

export async function concluirEtapaConectaProvas(token, respostas, etapaChave, questaoIndice, telemetria = {}) {
  return requisitar('/conecta-provas-api/concluir-etapa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      respostas,
      etapa_chave: etapaChave,
      questao_indice: questaoIndice,
      ...(telemetria || {}),
    }),
  }, { autenticado: false });
}

export async function interromperEtapaConectaProvas(token, respostas, etapaChave, questaoIndice, telemetria = {}) {
  return requisitar('/conecta-provas-api/interromper-etapa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      respostas,
      etapa_chave: etapaChave,
      questao_indice: questaoIndice,
      ...(telemetria || {}),
    }),
  }, { autenticado: false });
}

export async function marcarRevisaoConectaProvas(token, respostas, telemetria = {}) {
  return requisitar('/conecta-provas-api/revisao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, respostas, ...(telemetria || {}) }),
  }, { autenticado: false });
}

export async function finalizarConectaProvas(token, respostas, opcoes = {}) {
  return requisitar('/conecta-provas-api/finalizar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      respostas,
      finalizar_mesmo_assim: Boolean(opcoes.finalizarMesmoAssim),
      ...(opcoes.telemetria || {}),
    }),
  }, { autenticado: false });
}
