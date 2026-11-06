import {
  gravarCache,
  invalidarCacheApi,
  lerCache,
  montarChaveCacheApi,
  requisitarArquivo,
  requisitar,
} from './core.js';

const TEMPO_CACHE_EMAIL_INBOX_MS = 60 * 60 * 1000;
const requisicoesEmailEmAndamento = new Map();

function normalizarOpcoesListagem(opcoesOuForcar = false) {
  if (typeof opcoesOuForcar === 'boolean') {
    return { forcar: opcoesOuForcar };
  }
  return opcoesOuForcar && typeof opcoesOuForcar === 'object' ? opcoesOuForcar : {};
}

function montarQueryListagem({ pagina, tamanho, filtros = {} } = {}) {
  const params = new URLSearchParams();
  if (pagina) params.set('page', String(pagina));
  if (tamanho) params.set('page_size', String(tamanho));
  Object.entries(filtros || {}).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    params.set(chave, String(valor));
  });
  return params;
}

export async function lerProcessos(opcoesOuForcar = false) {
  const opcoes = normalizarOpcoesListagem(opcoesOuForcar);
  const params = montarQueryListagem(opcoes);
  const paginado = params.has('page') || params.has('page_size');
  const chaveCache = montarChaveCacheApi('processos', Object.fromEntries(params.entries()));

  if (!opcoes.forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const dados = await requisitar(`/processes${sufixo}`, { method: 'GET' });
  const resultado = paginado ? dados : Array.isArray(dados) ? dados : [];
  gravarCache(chaveCache, resultado);
  return resultado;
}

export async function criarProcesso(dadosProcesso) {
  const resultado = await requisitar('/processes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dadosProcesso),
  });

  invalidarCacheApi('processos');
  return resultado;
}

export async function atualizarProcesso(idProcesso, dadosProcesso) {
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosProcesso),
    },
  );

  invalidarCacheApi('processos', `processos:detalhe:${idProcesso}`, 'relatorios', 'historico', 'candidatos-processos');
  return resultado;
}

export async function encerrarProcesso(idProcesso, payload = null) {
  const opcoes = payload
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    : { method: 'POST' };
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/close`,
    opcoes,
  );

  invalidarCacheApi('processos', `processos:detalhe:${idProcesso}`, 'relatorios', 'historico', 'candidatos-processos');
  return resultado;
}

async function alterarEstadoProcesso(idProcesso, acao, payload = {}) {
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/${acao}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('processos', `processos:detalhe:${idProcesso}`, 'relatorios', 'historico', 'candidatos-processos');
  return resultado;
}

export async function pausarProcesso(idProcesso, payload = {}) {
  return alterarEstadoProcesso(idProcesso, 'pause', payload);
}

export async function retomarProcesso(idProcesso, payload = {}) {
  return alterarEstadoProcesso(idProcesso, 'resume', payload);
}

export async function cancelarProcesso(idProcesso, payload = {}) {
  return alterarEstadoProcesso(idProcesso, 'cancel', payload);
}

export async function lerCandidatosProcessos(opcoesOuForcar = false) {
  const opcoes = normalizarOpcoesListagem(opcoesOuForcar);
  const params = montarQueryListagem(opcoes);
  const paginado = params.has('page') || params.has('page_size');
  const chaveCache = montarChaveCacheApi('candidatos-processos', Object.fromEntries(params.entries()));

  if (!opcoes.forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const dados = await requisitar(`/process-candidates${sufixo}`, { method: 'GET' });
  const resultado = paginado ? dados : Array.isArray(dados) ? dados : [];
  gravarCache(chaveCache, resultado, { sensivel: true });
  return resultado;
}

export async function criarCandidatoNoProcesso(dadosCandidato) {
  const resultado = await requisitar('/process-candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dadosCandidato),
  });

  invalidarCacheApi(
    'candidatos-processos',
    'banco-talentos',
    'processos',
    'pipeline-candidatos',
    'relatorios',
    'historico',
  );
  return resultado;
}

export async function atualizarStatusCandidato(idRegistro, dadosStatus) {
  const resultado = await requisitar(
    `/process-candidates/${idRegistro}/status`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosStatus),
    },
  );

  invalidarCacheApi('candidatos-processos', 'banco-talentos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function reconsiderarEliminacaoCandidato(idRegistro, dadosReconsideracao) {
  const resultado = await requisitar(
    `/process-candidates/${idRegistro}/reconsider`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosReconsideracao),
    },
  );

  invalidarCacheApi('candidatos-processos', 'banco-talentos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function lerScorecardCandidato(idRegistro) {
  return requisitar(`/process-candidates/${idRegistro}/scorecard`, {
    method: 'GET',
  });
}

export async function salvarScorecardCandidato(idRegistro, dadosScorecard) {
  const resultado = await requisitar(
    `/process-candidates/${idRegistro}/scorecard`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosScorecard),
    },
  );

  invalidarCacheApi('candidatos-processos', 'processos');
  return resultado;
}

export async function atualizarStatusCandidatoAvulso(idTeste, dadosStatus) {
  const resultado = await requisitar(
    `/candidate-profiles/${encodeURIComponent(idTeste)}/status`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosStatus),
    },
  );

  invalidarCacheApi('gabaritos', 'banco-talentos', 'candidatos-processos', 'pipeline-candidatos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function lerBancoTalentos({
  forcar = false,
  search = '',
  skill = '',
  tag = '',
  pagina = 0,
  tamanho = 0,
} = {}) {
  const chaveCache = montarChaveCacheApi('banco-talentos', {
    search,
    skill,
    tag,
    page: pagina || '',
    page_size: tamanho || '',
  });
  const paginado = Boolean(pagina || tamanho);

  if (!forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (skill) params.set('skill', skill);
  if (tag) params.set('tag', tag);
  if (pagina) params.set('page', String(pagina));
  if (tamanho) params.set('page_size', String(tamanho));

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const dados = await requisitar(`/talent-bank${sufixo}`, { method: 'GET' });
  const resultado = paginado ? dados : Array.isArray(dados) ? dados : [];
  gravarCache(chaveCache, resultado, { sensivel: true });
  return resultado;
}

export async function lerCandidatosSugeridosProcesso(idProcesso, { limit = 15 } = {}) {
  if (!idProcesso) return { candidatos: [], total_sugestoes: 0 };
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const sufixo = params.toString() ? `?${params.toString()}` : '';
  return requisitar(`/processes/${encodeURIComponent(idProcesso)}/candidatos-sugeridos${sufixo}`, {
    method: 'GET',
  });
}

export async function removerBancoTalentos(idBanco) {
  const resultado = await requisitar(`/talent-bank/${idBanco}`, {
    method: 'DELETE',
  });

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function revalidarBancoTalentos(idBanco) {
  const resultado = await requisitar(`/talent-bank/${idBanco}/revalidate`, {
    method: 'POST',
  });

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function listarMotivosEliminacao() {
  return requisitar('/motivos-eliminacao', { method: 'GET' });
}


export async function criarBancoTalentos(dadosCandidato) {
  const { id_banco, ...payload } = dadosCandidato || {};
  const resultado = await requisitar('/talent-bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'processos', 'pipeline-candidatos', 'relatorios', 'historico');
  return resultado;
}

export async function atualizarPerfilCandidato(idTeste, payload) {
  const resultado = await requisitar(
    `/candidate-profiles/${encodeURIComponent(idTeste)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'pipeline-candidatos', 'processos', 'relatorios');
  return resultado;
}

export async function lerFichaCandidato(idTeste) {
  return requisitar(`/candidate-profiles/${encodeURIComponent(idTeste)}/sheet`, {
    method: 'GET',
  });
}

export async function atualizarFichaCandidato(idTeste, payload) {
  const resultado = await requisitar(
    `/candidate-profiles/${encodeURIComponent(idTeste)}/sheet`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'pipeline-candidatos', 'processos', 'relatorios');
  return resultado;
}

export async function uploadCvCandidato(idTeste, formData) {
  const resultado = await requisitar(
    `/candidate-profiles/${encodeURIComponent(idTeste)}/cv`,
    {
      method: 'POST',
      body: formData,
    },
  );

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'pipeline-candidatos', 'processos');
  return resultado;
}

export async function usarCandidatoDoBancoTalentos(idBanco, dadosUso) {
  const resultado = await requisitar(`/talent-bank/${idBanco}/use`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dadosUso),
  });

  invalidarCacheApi(
    'banco-talentos',
    'candidatos-processos',
    'processos',
    'pipeline-candidatos',
    'relatorios',
    'historico',
  );
  return resultado;
}

export async function lerDetalheProcesso(idProcesso, forcar = false) {
  const chaveCache = `processos:detalhe:${idProcesso}`;
  if (!forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }

  const detalhe = await requisitar(`/processes/${encodeURIComponent(idProcesso)}/details`, {
    method: 'GET',
  });
  gravarCache(chaveCache, detalhe);
  return detalhe;
}

export async function lerAnotacoesDossieProcesso(idProcesso) {
  return requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/dossier/notes`,
    { method: 'GET' },
  );
}

export async function criarAnotacaoDossieProcesso(idProcesso, payload) {
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/dossier/notes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos');
  return resultado;
}

export async function atualizarAnotacaoDossieProcesso(idAnotacao, payload) {
  const resultado = await requisitar(
    `/process-dossier-notes/${encodeURIComponent(idAnotacao)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos');
  return resultado;
}

export async function lerPreAnalisesCv(idProcesso, pagina = 1, tamanho = 5, filtros = {}) {
  const params = new URLSearchParams({
    page: String(pagina),
    page_size: String(tamanho),
  });
  if (filtros.nome) params.set('nome', filtros.nome);
  if (filtros.scoreMin) params.set('score_min', filtros.scoreMin);
  if (filtros.scoreMax) params.set('score_max', filtros.scoreMax);
  if (filtros.classificacao) params.set('classificacao', filtros.classificacao);
  if (filtros.mostrarOcultos) params.set('incluir_ocultos', 'true');

  return requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/cv-pre-analyses?${params.toString()}`,
    { method: 'GET' },
  );
}

export async function limparListaPreAnalisesCv(idProcesso) {
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/cv-pre-analyses/clear-list`,
    { method: 'POST' },
  );

  invalidarCacheApi('processos', 'candidatos-processos');
  return resultado;
}

export async function analisarCvProcesso(idProcesso, formData) {
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/cv-pre-analyses`,
    {
      method: 'POST',
      body: formData,
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos');
  return resultado;
}

export async function atualizarPreAnaliseCv(idPreAnalise, payload) {
  const resultado = await requisitar(`/cv-pre-analyses/${encodeURIComponent(idPreAnalise)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'pipeline-candidatos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function analisarCvCandidatoInscrito(idTeste, payload = {}) {
  const resultado = await requisitar(
    `/candidate-profiles/${encodeURIComponent(idTeste)}/analyze-cv`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos');
  return resultado;
}

export async function lerConfiguracaoAnaliseCurriculoIa() {
  return requisitar('/curriculos-ia/configuracao', { method: 'GET' });
}

export async function lerUltimaAnaliseCurriculoIa(idCandidato, idProcesso = '') {
  const params = new URLSearchParams();
  if (idProcesso) params.set('id_processo', idProcesso);
  const sufixo = params.toString() ? `?${params.toString()}` : '';
  return requisitar(
    `/curriculos/${encodeURIComponent(idCandidato)}/analises-ia/ultima${sufixo}`,
    { method: 'GET' },
  );
}

export async function analisarCurriculoIa(idCandidato, idProcesso = '') {
  const params = new URLSearchParams();
  if (idProcesso) params.set('id_processo', idProcesso);
  const sufixo = params.toString() ? `?${params.toString()}` : '';
  return requisitar(
    `/curriculos/${encodeURIComponent(idCandidato)}/analisar-ia${sufixo}`,
    { method: 'POST' },
  );
}

export async function marcarAnaliseCurriculoIaRevisada(idAnalise) {
  return requisitar(
    `/analises-curriculo-ia/${encodeURIComponent(idAnalise)}/marcar-revisada`,
    { method: 'POST' },
  );
}

export async function excluirPreAnaliseCv(idPreAnalise) {
  return requisitar(`/cv-pre-analyses/${encodeURIComponent(idPreAnalise)}`, {
    method: 'DELETE',
  });
}

export async function dispensarPreAnaliseCv(idPreAnalise) {
  const resultado = await requisitar(
    `/cv-pre-analyses/${encodeURIComponent(idPreAnalise)}/dismiss`,
    { method: 'POST' },
  );

  invalidarCacheApi('processos', 'candidatos-processos', 'banco-talentos', 'relatorios');
  return resultado;
}

export async function enviarPreAnaliseParaBancoTalentos(idPreAnalise) {
  const resultado = await requisitar(
    `/cv-pre-analyses/${encodeURIComponent(idPreAnalise)}/talent-bank`,
    { method: 'POST' },
  );

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'processos', 'relatorios', 'historico');
  return resultado;
}

export async function adicionarPreAnaliseAoProcesso(idPreAnalise, opcoes = {}) {
  const resultado = await requisitar(
    `/cv-pre-analyses/${encodeURIComponent(idPreAnalise)}/add-to-process`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opcoes || {}),
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos');
  return resultado;
}

export async function lerEmailsRecebidosProcesso(idProcesso, limite = 12, forcar = false) {
  const params = new URLSearchParams({ limit: String(limite) });
  const chaveCache = montarChaveCacheApi('email-inbox:processo', {
    id_processo: idProcesso,
    limit: limite,
  });
  if (forcar) {
    invalidarCacheApi(chaveCache);
  }
  if (!forcar) {
    const emCache = lerCache(chaveCache, {
      sensivel: true,
      ttlMs: TEMPO_CACHE_EMAIL_INBOX_MS,
    });
    if (emCache) return emCache;
  }
  if (requisicoesEmailEmAndamento.has(chaveCache)) {
    return requisicoesEmailEmAndamento.get(chaveCache);
  }

  const requisicao = requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/email-inbox?${params.toString()}`,
    { method: 'GET' },
  )
    .then((dados) => {
      gravarCache(chaveCache, Array.isArray(dados) ? dados : [], {
        sensivel: true,
        ttlMs: TEMPO_CACHE_EMAIL_INBOX_MS,
      });
      return dados;
    })
    .finally(() => requisicoesEmailEmAndamento.delete(chaveCache));
  requisicoesEmailEmAndamento.set(chaveCache, requisicao);
  return requisicao;
}

export async function analisarCvEmailRecebido(idProcesso, payload) {
  const resultado = await requisitar(
    `/processes/${encodeURIComponent(idProcesso)}/email-inbox/analyze-cv`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function lerEmailsRecebidos({
  limite = 50,
  mostrarIgnorados = false,
  apenasComAnexos = false,
  refresh = false,
  query = '',
} = {}) {
  const params = new URLSearchParams({ limit: String(limite) });
  const paramsCache = new URLSearchParams({ limit: String(limite) });
  if (mostrarIgnorados) params.set('include_ignored', 'true');
  if (mostrarIgnorados) paramsCache.set('include_ignored', 'true');
  params.set('with_attachments_only', apenasComAnexos ? 'true' : 'false');
  paramsCache.set('with_attachments_only', apenasComAnexos ? 'true' : 'false');
  params.set('refresh', refresh ? 'true' : 'false');
  if (query) params.set('query', query);
  if (query) paramsCache.set('query', query);
  const chaveCache = montarChaveCacheApi('email-inbox', Object.fromEntries(paramsCache.entries()));
  if (refresh) {
    invalidarCacheApi(chaveCache);
  }
  if (!refresh) {
    const emCache = lerCache(chaveCache, {
      sensivel: true,
      ttlMs: TEMPO_CACHE_EMAIL_INBOX_MS,
    });
    if (emCache) return emCache;
  }
  if (requisicoesEmailEmAndamento.has(chaveCache)) {
    return requisicoesEmailEmAndamento.get(chaveCache);
  }

  const requisicao = requisitar(`/email-inbox/messages?${params.toString()}`, { method: 'GET' })
    .then((dados) => {
      gravarCache(chaveCache, dados, {
        sensivel: true,
        ttlMs: TEMPO_CACHE_EMAIL_INBOX_MS,
      });
      return dados;
    })
    .finally(() => requisicoesEmailEmAndamento.delete(chaveCache));
  requisicoesEmailEmAndamento.set(chaveCache, requisicao);
  return requisicao;
}

export async function lerDetalheEmailRecebido(idEmail, forcar = false) {
  const chaveCache = `email-inbox:detalhe:${idEmail}`;
  if (!forcar) {
    const emCache = lerCache(chaveCache);
    if (emCache) return emCache;
  }

  const dados = await requisitar(`/email-inbox/messages/${encodeURIComponent(idEmail)}`, {
    method: 'GET',
  });
  gravarCache(chaveCache, dados, { sensivel: true });
  return dados;
}

export async function baixarAnexoEmailRecebido(idEmail, idAnexo = '') {
  const respostaDownload = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}/download-attachments`,
    { method: 'POST' },
  );
  const item = respostaDownload?.item || {};
  const anexos = Array.isArray(item.anexos) ? item.anexos : [];
  const anexo = anexos.find((entrada) => entrada.id === idAnexo) || anexos[0];
  const caminho = anexo?.id
    ? `/email-inbox/messages/${encodeURIComponent(idEmail)}/attachment/${encodeURIComponent(anexo.id)}`
    : `/email-inbox/messages/${encodeURIComponent(idEmail)}/attachment`;
  return requisitarArquivo(
    caminho,
    { method: 'GET' },
  );
}

export async function adicionarCvManualCaixaEmail(arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  const resultado = await requisitar('/email-inbox/messages/manual', {
    method: 'POST',
    body: formData,
  });

  invalidarCacheApi('processos', 'candidatos-processos', 'banco-talentos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function criarCurriculoManualCaixaEmail(dados) {
  const resultado = await requisitar('/email-inbox/messages/manual-estruturado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados || {}),
  });

  invalidarCacheApi('processos', 'candidatos-processos', 'banco-talentos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function marcarEmailRecebidoComoLido(idEmail) {
  const resultado = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}/mark-read`,
    { method: 'POST' },
  );

  invalidarCacheApi('email-inbox');
  return resultado;
}

export async function analisarCvEmailRecebidoGeral(idEmail) {
  const resultado = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}/analyze-cv`,
    { method: 'POST' },
  );

  invalidarCacheApi('processos', 'candidatos-processos', 'banco-talentos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function vincularEmailRecebidoProcesso(idEmail, payload) {
  const resultado = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}/link-process`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('processos', 'candidatos-processos', 'pipeline-candidatos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function enviarEmailRecebidoBancoTalentos(idEmail) {
  const resultado = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}/talent-bank`,
    { method: 'POST' },
  );

  invalidarCacheApi('banco-talentos', 'candidatos-processos', 'processos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function ignorarEmailRecebido(idEmail) {
  const resultado = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}/ignore`,
    { method: 'POST' },
  );

  invalidarCacheApi('processos', 'candidatos-processos', 'banco-talentos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function excluirEmailRecebido(idEmail) {
  const resultado = await requisitar(
    `/email-inbox/messages/${encodeURIComponent(idEmail)}`,
    { method: 'DELETE' },
  );

  invalidarCacheApi('processos', 'candidatos-processos', 'banco-talentos', 'email-inbox', 'relatorios');
  return resultado;
}

export async function registrarWhatsappAprovacao(idRegistro, payload) {
  return requisitar(
    `/process-candidates/${encodeURIComponent(idRegistro)}/approval-whatsapp`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
}

export async function registrarWhatsappContatoManual(idRegistro, payload) {
  const resultado = await requisitar(
    `/process-candidates/${encodeURIComponent(idRegistro)}/whatsapp-contact`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );

  invalidarCacheApi('candidatos-processos', 'processos', 'pipeline-candidatos');
  return resultado;
}

export async function enviarEmailAprovacao(idRegistro, payload) {
  return requisitar(
    `/process-candidates/${encodeURIComponent(idRegistro)}/approval-email`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
}

export async function gerarLinkPublicoCandidatura(idProcesso) {
  const resultado = await requisitar(
    `/processos/${encodeURIComponent(idProcesso)}/gerar-link-candidatura`,
    { method: 'POST' },
  );

  invalidarCacheApi('processos');
  return resultado;
}

export async function desativarLinkPublicoCandidatura(idProcesso) {
  const resultado = await requisitar(
    `/processos/${encodeURIComponent(idProcesso)}/link-candidatura/desativar`,
    { method: 'PATCH' },
  );

  invalidarCacheApi('processos');
  return resultado;
}

export async function baixarCvCandidato(idTeste) {
  return requisitarArquivo(
    `/candidate-profiles/${encodeURIComponent(idTeste)}/cv`,
    { method: 'GET' },
  );
}
