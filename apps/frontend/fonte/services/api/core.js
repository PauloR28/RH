import { criarLogger } from '../../logger.js';

const CONFIG_RUNTIME = window.RUNTIME_CONFIG || {};

function detectarApiLocalPadrao() {
  const local = window.location || {};

  if (local.protocol === 'file:') {
    return 'http://127.0.0.1:8000';
  }
  return local.origin && local.origin !== 'null' ? local.origin : '';
}

const URL_API_BASE =
  CONFIG_RUNTIME.API_BASE_URL || window.__RH_API_BASE__ || detectarApiLocalPadrao();
export const URL_PUBLICA_BASE_CANDIDATURA =
  CONFIG_RUNTIME.PUBLIC_CANDIDATE_BASE_URL ||
  window.__RH_PUBLIC_CANDIDATE_BASE_URL__ ||
  '';
const TEMPO_CACHE_PADRAO_MS = 60000;
const TEMPO_CACHE_SENSIVEL_MS = 1800000;
const TEMPO_CACHE_ESTATICO_MS = 300000;
const TEMPO_CACHE_EMAIL_INBOX_MS = 60 * 60 * 1000;
const PREFIXO_CACHE_SESSAO = 'rh_api_cache_v2:';
const LIMITE_CACHE_SESSAO_CARACTERES = 1500000;
const LIMITE_ITENS_CACHE_MEMORIA = 80;
const CHAVE_TOKEN_AUTENTICACAO = 'rh_api_access_token';
const CHAVE_USUARIO_AUTENTICADO = 'rh_api_authenticated_user';
const CHAVE_SESSAO_AUTENTICACAO = 'rh_api_session_payload';

export const EVENTO_AUTENTICACAO_EXPIRADA = 'rh-auth-expired';

const cacheMemoria = new Map();
const logger = criarLogger('api');
const PREFIXOS_CACHE_PERSISTENTE = [
  'settings:roles',
  'settings:permissions',
  'settings:catalog',
  'processos',
  'gabaritos',
];
const PREFIXOS_CACHE_SENSIVEL = [
  'banco-talentos',
  'candidatos-processos',
  'email-inbox',
  'entrevistas',
  'historico',
  'pipeline-candidatos',
  'processos:detalhe',
  'provas-geradas',
  'relatorios',
  'slots-entrevista',
];

function chaveCacheSessao(chave) {
  return `${PREFIXO_CACHE_SESSAO}${chave}`;
}

function removerCacheSessaoPorPrefixo(...chaves) {
  try {
    for (let indice = sessionStorage.length - 1; indice >= 0; indice -= 1) {
      const chaveArmazenada = sessionStorage.key(indice) || '';
      if (!chaveArmazenada.startsWith(PREFIXO_CACHE_SESSAO)) continue;
      const chaveApi = chaveArmazenada.slice(PREFIXO_CACHE_SESSAO.length);
      if (!chaves.length || chaves.some((chave) => chaveApi === chave || chaveApi.startsWith(`${chave}:`))) {
        sessionStorage.removeItem(chaveArmazenada);
      }
    }
  } catch (error) {
    logger.debug?.('Não foi possível limpar o cache temporário da sessão.', error);
  }
}

function chaveComecaCom(chave, prefixos) {
  return prefixos.some((prefixo) => chave === prefixo || chave.startsWith(`${prefixo}:`));
}

function chaveEhEmailInbox(chave = '') {
  return chave === 'email-inbox' || chave.startsWith('email-inbox:');
}

function cacheEmailInboxEhDeOutroDia(timestamp) {
  const data = new Date(Number(timestamp || 0));
  if (Number.isNaN(data.getTime())) return true;
  return data.toDateString() !== new Date().toDateString();
}

function normalizarOpcoesCache(opcoes = {}) {
  const sensivel = opcoes.sensivel ?? chaveComecaCom(opcoes.chave || '', PREFIXOS_CACHE_SENSIVEL);
  const persistente =
    !sensivel &&
    (opcoes.persistente ?? chaveComecaCom(opcoes.chave || '', PREFIXOS_CACHE_PERSISTENTE));
  const ttlPadrao = chaveEhEmailInbox(opcoes.chave || '')
    ? TEMPO_CACHE_EMAIL_INBOX_MS
    : sensivel
      ? TEMPO_CACHE_SENSIVEL_MS
      : persistente
        ? TEMPO_CACHE_ESTATICO_MS
        : TEMPO_CACHE_PADRAO_MS;

  return {
    ttlMs: Number(opcoes.ttlMs || ttlPadrao),
    persistente,
    sensivel,
  };
}

function lerCache(chave, opcoes = {}) {
  limparCacheExpirado();
  const politica = normalizarOpcoesCache({ ...opcoes, chave });
  const entrada = cacheMemoria.get(chave);
  if (entrada) {
    const ttlEntrada = Number(entrada.ttlMs || politica.ttlMs);
    if (chaveEhEmailInbox(chave) && cacheEmailInboxEhDeOutroDia(entrada.timestamp)) {
      cacheMemoria.delete(chave);
      return null;
    }
    if (Date.now() - entrada.timestamp <= ttlEntrada) return entrada.data;
    cacheMemoria.delete(chave);
  }

  if (!politica.persistente) return null;

  try {
    const persistido = JSON.parse(sessionStorage.getItem(chaveCacheSessao(chave)) || 'null');
    const ttlPersistido = Number(persistido?.ttlMs || politica.ttlMs);
    if (!persistido || Date.now() - Number(persistido.timestamp || 0) > ttlPersistido) {
      sessionStorage.removeItem(chaveCacheSessao(chave));
      return null;
    }
    cacheMemoria.set(chave, persistido);
    return persistido.data;
  } catch (error) {
    sessionStorage.removeItem(chaveCacheSessao(chave));
    return null;
  }
}

function limparCacheExpirado() {
  const agora = Date.now();
  Array.from(cacheMemoria.entries()).forEach(([chave, entrada]) => {
    const politica = normalizarOpcoesCache({ chave });
    const ttlEntrada = Number(entrada?.ttlMs || politica.ttlMs);
    if (!entrada || agora - Number(entrada.timestamp || 0) > ttlEntrada) {
      cacheMemoria.delete(chave);
    }
  });
}

function limitarCacheMemoria() {
  limparCacheExpirado();
  const excesso = cacheMemoria.size - LIMITE_ITENS_CACHE_MEMORIA;
  if (excesso <= 0) return;

  Array.from(cacheMemoria.entries())
    .sort(([, a], [, b]) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0))
    .slice(0, excesso)
    .forEach(([chave]) => cacheMemoria.delete(chave));
}

function gravarCache(chave, data, opcoes = {}) {
  const politica = normalizarOpcoesCache({ ...opcoes, chave });
  const entrada = {
    data,
    timestamp: Date.now(),
    ttlMs: politica.ttlMs,
  };
  cacheMemoria.set(chave, entrada);
  limitarCacheMemoria();

  if (!politica.persistente) {
    sessionStorage.removeItem(chaveCacheSessao(chave));
    return;
  }

  try {
    const serializado = JSON.stringify(entrada);
    if (serializado.length <= LIMITE_CACHE_SESSAO_CARACTERES) {
      sessionStorage.setItem(chaveCacheSessao(chave), serializado);
    }
  } catch (error) {
    logger.debug?.('Não foi possível persistir o cache temporário da API.', error);
  }
}

export function montarChaveCacheApi(prefixo, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    query.set(chave, String(valor));
  });
  const parametros = query.toString();
  return parametros ? `${prefixo}:${parametros}` : prefixo;
}

export function lerSessaoAutenticacao() {
  let payload = {};
  try {
    payload = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO_AUTENTICACAO) || '{}');
  } catch (error) {
    payload = {};
  }

  return {
    token: sessionStorage.getItem(CHAVE_TOKEN_AUTENTICACAO) || '',
    usuario: sessionStorage.getItem(CHAVE_USUARIO_AUTENTICADO) || '',
    nome: payload.nome || '',
    email: payload.email || '',
    perfil: payload.perfil || '',
    perfil_nome: payload.perfil_nome || '',
    nivel: payload.nivel || '',
    permissoes: Array.isArray(payload.permissoes) ? payload.permissoes : [],
    avatar_ilustrado: payload.avatar_ilustrado || '',
    deve_trocar_senha: Boolean(payload.deve_trocar_senha),
  };
}

export function salvarSessaoAutenticacao(token, sessaoOuUsuario) {
  const sessao =
    typeof sessaoOuUsuario === 'object' && sessaoOuUsuario !== null
      ? sessaoOuUsuario
      : { usuario: sessaoOuUsuario || '' };
  sessionStorage.setItem(CHAVE_TOKEN_AUTENTICACAO, token || '');
  sessionStorage.setItem(CHAVE_USUARIO_AUTENTICADO, sessao.usuario || sessao.email || '');
  sessionStorage.setItem(
    CHAVE_SESSAO_AUTENTICACAO,
    JSON.stringify({
      usuario: sessao.usuario || sessao.email || '',
      nome: sessao.nome || '',
      email: sessao.email || '',
      perfil: sessao.perfil || '',
      perfil_nome: sessao.perfil_nome || '',
      nivel: sessao.nivel || '',
      permissoes: Array.isArray(sessao.permissoes) ? sessao.permissoes : [],
      avatar_ilustrado: sessao.avatar_ilustrado || '',
      deve_trocar_senha: Boolean(sessao.deve_trocar_senha),
    }),
  );
  // Primeiro acesso com senha inicial: a tela de troca obrigatória abre (features/monitoria/global.js).
  if (sessao.deve_trocar_senha) {
    window.dispatchEvent(new CustomEvent('conecta-troca-senha-obrigatoria'));
  }
}

export function limparSessaoAutenticacao() {
  [sessionStorage, localStorage].forEach((armazenamento) => {
    try {
      armazenamento.removeItem(CHAVE_TOKEN_AUTENTICACAO);
      armazenamento.removeItem(CHAVE_USUARIO_AUTENTICADO);
      armazenamento.removeItem(CHAVE_SESSAO_AUTENTICACAO);
    } catch (error) {
      logger.warn('Não foi possível limpar dados locais de autenticação.', error);
    }
  });
  cacheMemoria.clear();
  removerCacheSessaoPorPrefixo();
}

export function possuiSessaoAutenticada() {
  return Boolean(lerSessaoAutenticacao().token);
}

function notificarSessaoExpirada() {
  window.dispatchEvent(new CustomEvent(EVENTO_AUTENTICACAO_EXPIRADA));
}

async function lerMensagemErro(resposta) {
  const tipo = resposta.headers.get('content-type') || '';

  if (tipo.includes('application/json')) {
    const json = await resposta.json().catch(() => null);
    if (json?.message) return json.message;
    if (json?.detail) return json.detail;
  }

  return resposta.text().catch(() => '');
}

async function executarRequisicao(caminho, opcoes = {}, configuracao = {}) {
  const { autenticado = true } = configuracao;
  const headers = new Headers(opcoes.headers || {});
  const sessao = lerSessaoAutenticacao();

  if (autenticado && sessao.token) {
    headers.set('Authorization', `Bearer ${sessao.token}`);
  }

  let resposta;

  try {
    resposta = await fetch(`${URL_API_BASE}${caminho}`, {
      cache: 'no-store',
      ...opcoes,
      headers,
    });
  } catch (error) {
    logger.error('Falha de conectividade com a API.', {
      caminho,
      mensagem: error?.message || '',
    });
    throw new Error(
      `Não foi possível conectar com a API em ${URL_API_BASE}${caminho}. Verifique se o servidor da API está ativo.`,
    );
  }

  if (!resposta.ok) {
    const textoErro = await lerMensagemErro(resposta);

    if (resposta.status === 401) {
      limparSessaoAutenticacao();
      notificarSessaoExpirada();
    }
    if (resposta.status === 403 && String(textoErro).includes('TROCA_SENHA_OBRIGATORIA')) {
      window.dispatchEvent(new CustomEvent('conecta-troca-senha-obrigatoria'));
    }

    logger.warn('Resposta de erro recebida da API.', {
      caminho,
      status: resposta.status,
      textoErro,
    });
    if (resposta.status === 400 || resposta.status === 422) {
      throw new Error(textoErro || 'Não foi possível validar os dados enviados para a API.');
    }
    if (resposta.status >= 500) {
      throw new Error(
        textoErro ||
          'Não foi possível concluir a operação. A API retornou erro interno. Verifique o log do servidor.',
      );
    }
    throw new Error(textoErro || `Falha na API (${resposta.status}).`);
  }

  return resposta;
}

function extrairNomeArquivo(resposta) {
  const disposition = resposta.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  return 'arquivo';
}

export async function requisitar(caminho, opcoes = {}, configuracao = {}) {
  const resposta = await executarRequisicao(caminho, opcoes, configuracao);

  const tipo = resposta.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    return resposta.json();
  }

  return resposta.text();
}

export async function requisitarArquivo(caminho, opcoes = {}, configuracao = {}) {
  const resposta = await executarRequisicao(caminho, opcoes, configuracao);
  return {
    blob: await resposta.blob(),
    filename: extrairNomeArquivo(resposta),
    contentType:
      resposta.headers.get('content-type') || 'application/octet-stream',
  };
}

export function invalidarCacheApi(...chaves) {
  chaves.forEach((chave) => {
    cacheMemoria.delete(chave);
    Array.from(cacheMemoria.keys())
      .filter((cacheKey) => cacheKey.startsWith(`${chave}:`))
      .forEach((cacheKey) => cacheMemoria.delete(cacheKey));
  });
  removerCacheSessaoPorPrefixo(...chaves);
}

export function atualizarCacheApi(chave, atualizador, opcoes = {}) {
  const atual = lerCache(chave, opcoes);
  const proximo = typeof atualizador === 'function' ? atualizador(atual) : atualizador;
  gravarCache(chave, proximo, opcoes);
  return proximo;
}

export function limparCachesExpiradosApi() {
  limparCacheExpirado();
  removerCacheSessaoPorPrefixo('__expired__');
}

export { gravarCache, lerCache };
