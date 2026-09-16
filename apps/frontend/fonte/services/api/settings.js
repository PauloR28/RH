import {
  gravarCache,
  invalidarCacheApi,
  lerCache,
  requisitar,
  requisitarArquivo,
} from './core.js';

function montarQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    query.set(chave, valor);
  });
  const texto = query.toString();
  return texto ? `?${texto}` : '';
}

export async function listarPerfis() {
  const chave = 'settings:roles';
  const emCache = lerCache(chave, { ttlMs: 300000, persistente: true });
  if (emCache) return emCache;
  const dados = await requisitar('/settings/security/roles', { method: 'GET' });
  gravarCache(chave, dados, { ttlMs: 300000, persistente: true });
  return dados;
}

export async function listarPermissoes() {
  const chave = 'settings:permissions';
  const emCache = lerCache(chave, { ttlMs: 300000, persistente: true });
  if (emCache) return emCache;
  const dados = await requisitar('/settings/security/permissions', { method: 'GET' });
  gravarCache(chave, dados, { ttlMs: 300000, persistente: true });
  return dados;
}

export async function atualizarPermissoesPerfil(idPerfil, payload) {
  const resultado = await requisitar(`/settings/security/roles/${encodeURIComponent(idPerfil)}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('settings:roles', 'settings:permissions');
  return resultado;
}

export async function listarUsuarios(filtros = {}) {
  const chave = `settings:users:${JSON.stringify(filtros || {})}`;
  const emCache = lerCache(chave, { ttlMs: 300000, persistente: true });
  if (emCache) return emCache;
  const dados = await requisitar(`/settings/users${montarQuery(filtros)}`, { method: 'GET' });
  gravarCache(chave, dados, { ttlMs: 300000, persistente: true });
  return dados;
}

export async function criarUsuario(payload) {
  const resultado = await requisitar('/settings/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('settings:roles', 'settings:users');
  return resultado;
}

export async function criarUsuarioRapido(payload) {
  const resultado = await requisitar('/settings/users/quick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('settings:roles', 'settings:users');
  return resultado;
}

export async function atualizarUsuario(idUsuario, payload) {
  const resultado = await requisitar(`/settings/users/${encodeURIComponent(idUsuario)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('settings:roles', 'settings:users');
  return resultado;
}

export async function redefinirSenhaUsuario(idUsuario, payload) {
  return requisitar(`/settings/users/${encodeURIComponent(idUsuario)}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function redefinirMfaUsuario(idUsuario, justificativa = '') {
  const resultado = await requisitar(
    `/settings/users/${encodeURIComponent(idUsuario)}/mfa/reset${montarQuery({ justificativa })}`,
    { method: 'POST' },
  );
  invalidarCacheApi('settings:users');
  return resultado;
}

export async function alterarStatusUsuario(idUsuario, payload) {
  const resultado = await requisitar(`/settings/users/${encodeURIComponent(idUsuario)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('settings:roles', 'settings:users');
  return resultado;
}

export async function excluirUsuario(idUsuario, justificativa = '') {
  const resultado = await requisitar(
    `/settings/users/${encodeURIComponent(idUsuario)}${montarQuery({ justificativa })}`,
    { method: 'DELETE' },
  );
  invalidarCacheApi('settings:roles', 'settings:users');
  return resultado;
}

export async function listarLogsAuditoria(filtros = {}) {
  return requisitar(`/settings/audit-logs${montarQuery(filtros)}`, { method: 'GET' });
}

export async function baixarLogsAuditoria() {
  return requisitarArquivo('/settings/audit-logs/export', { method: 'GET' });
}

export async function listarCatalogoConfiguracoes() {
  const chave = 'settings:catalog';
  const emCache = lerCache(chave, { ttlMs: 300000, persistente: true });
  if (emCache) return emCache;
  const dados = await requisitar('/settings/catalog', { method: 'GET' });
  gravarCache(chave, dados, { ttlMs: 300000, persistente: true });
  return dados;
}

export async function criarItemConfiguracao(tipo, payload) {
  const resultado = await requisitar(`/settings/catalog/${encodeURIComponent(tipo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('settings:catalog');
  return resultado;
}

export async function atualizarItemConfiguracao(tipo, idItem, payload) {
  const resultado = await requisitar(
    `/settings/catalog/${encodeURIComponent(tipo)}/${encodeURIComponent(idItem)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    },
  );
  invalidarCacheApi('settings:catalog');
  return resultado;
}

export async function desativarItemConfiguracao(tipo, idItem, justificativa = '') {
  const resultado = await requisitar(
    `/settings/catalog/${encodeURIComponent(tipo)}/${encodeURIComponent(idItem)}${montarQuery({ justificativa })}`,
    { method: 'DELETE' },
  );
  invalidarCacheApi('settings:catalog');
  return resultado;
}

export async function excluirItemConfiguracao(tipo, idItem, justificativa = '') {
  const resultado = await requisitar(
    `/settings/catalog/${encodeURIComponent(tipo)}/${encodeURIComponent(idItem)}/permanente${montarQuery({ justificativa })}`,
    { method: 'DELETE' },
  );
  invalidarCacheApi('settings:catalog');
  return resultado;
}

export async function registrarSolicitacaoLgpd(payload) {
  return requisitar('/settings/lgpd/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function lerAutomacaoNotificacoes() {
  return requisitar('/settings/automacao-notificacoes', { method: 'GET' });
}

export async function atualizarAutomacaoNotificacoes(payload) {
  return requisitar('/settings/automacao-notificacoes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}
