import {
  gravarCache,
  invalidarCacheApi,
  lerCache,
  requisitar,
  requisitarArquivo,
} from './core.js?v=20261124-equipes2';

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

// Cadastro de usuários em massa (planilha): modelo, prévia (confirmar=false) e criação (confirmar=true).
export const baixarModeloUsuariosEmMassa = () => requisitarArquivo('/settings/users/bulk/template', { method: 'GET' });

export async function enviarPlanilhaUsuarios(arquivo, confirmar = false) {
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  corpo.append('confirmar', confirmar ? 'true' : 'false');
  const resultado = await requisitar('/settings/users/bulk', { method: 'POST', body: corpo });
  if (confirmar) invalidarCacheApi('settings:roles', 'settings:users');
  return resultado;
}

// Módulos por pessoa e por perfil (16/nov/2026): bloco "Módulos" do cadastro e de Perfis e Permissões.
export const lerModulosUsuario = (idUsuario, perfil = '') =>
  requisitar(`/settings/users/${encodeURIComponent(idUsuario)}/modulos${montarQuery({ perfil })}`, { method: 'GET' });
export const salvarModulosUsuario = (idUsuario, modulos, justificativa = '') =>
  requisitar(`/settings/users/${encodeURIComponent(idUsuario)}/modulos`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modulos, justificativa }),
  });
export const lerModulosPerfil = (idPerfil) =>
  requisitar(`/settings/security/roles/${encodeURIComponent(idPerfil)}/modulos`, { method: 'GET' });
export const salvarModulosPerfil = (idPerfil, modulos, justificativa = '') =>
  requisitar(`/settings/security/roles/${encodeURIComponent(idPerfil)}/modulos`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modulos, justificativa }),
  });

// Etapa 9 (21/nov/2026): janela Perfis da tela Acessos. Toda mudança limpa a lista de perfis guardada.
const JSON_PERFIS = { 'Content-Type': 'application/json' };
export async function criarPerfil(dados) {
  const r = await requisitar('/settings/security/roles', { method: 'POST', headers: JSON_PERFIS, body: JSON.stringify(dados) });
  invalidarCacheApi('settings:roles');
  return r;
}
export async function editarPerfil(id, dados) {
  const r = await requisitar(`/settings/security/roles/${encodeURIComponent(id)}`, { method: 'PUT', headers: JSON_PERFIS, body: JSON.stringify(dados) });
  invalidarCacheApi('settings:roles');
  return r;
}
export async function apagarPerfil(id) {
  const r = await requisitar(`/settings/security/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  invalidarCacheApi('settings:roles');
  return r;
}
export async function listarPerfisAtualizados() {
  invalidarCacheApi('settings:roles');
  return listarPerfis();
}
