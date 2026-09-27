import { invalidarCacheApi, requisitar } from './core.js';

export async function listarNotificacoes(apenasNaoLidas = false) {
  const query = apenasNaoLidas ? '?apenas_nao_lidas=true' : '';
  return requisitar(`/notificacoes${query}`, { method: 'GET' });
}

export async function marcarNotificacaoLida(idNotificacao) {
  const resultado = await requisitar(`/notificacoes/${encodeURIComponent(idNotificacao)}/marcar-lida`, {
    method: 'POST',
  });
  invalidarCacheApi('notificacoes');
  return resultado;
}

export async function marcarNotificacoesEntidadeLidas(entidade, entidadeId) {
  const resultado = await requisitar(
    `/notificacoes/entidade/${encodeURIComponent(entidade)}/${encodeURIComponent(entidadeId)}/marcar-lidas`,
    { method: 'POST' },
  );
  invalidarCacheApi('notificacoes');
  return resultado;
}

export async function marcarTodasNotificacoesLidas() {
  const resultado = await requisitar('/notificacoes/marcar-todas-lidas', { method: 'POST' });
  invalidarCacheApi('notificacoes');
  return resultado;
}

export async function excluirNotificacao(idNotificacao) {
  const resultado = await requisitar(`/notificacoes/${encodeURIComponent(idNotificacao)}`, { method: 'DELETE' });
  invalidarCacheApi('notificacoes');
  return resultado;
}

export async function excluirTodasNotificacoes() {
  const resultado = await requisitar('/notificacoes', { method: 'DELETE' });
  invalidarCacheApi('notificacoes');
  return resultado;
}

// QA T2-NOT-03: lida/oculta das notificações montadas no front vale em qualquer
// navegador (antes ficava só no localStorage).
export async function obterEstadoNotificacoesUsuario() {
  return requisitar('/notificacoes/estado-usuario', { method: 'GET' });
}

export async function registrarEstadoNotificacoesUsuario({ lidas = [], ocultas = [] } = {}) {
  return requisitar('/notificacoes/estado-usuario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lidas, ocultas }),
  });
}
