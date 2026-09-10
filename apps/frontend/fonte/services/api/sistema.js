import { requisitar } from './core.js';

export async function listarParametrosSistema() {
  return requisitar('/sistema/parametros', { method: 'GET' });
}

export async function salvarParametroSistema(chave, payload) {
  return requisitar(`/sistema/parametros/${encodeURIComponent(chave)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function listarInfraestruturaCredenciais() {
  return requisitar('/sistema/parametros/infraestrutura', { method: 'GET' });
}

export async function resetarDadosConecta(confirmacao) {
  return requisitar('/sistema/resetar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmacao }),
  });
}

export async function listarAmbientesSharePoint() {
  return requisitar('/sistema/ambientes-sharepoint', { method: 'GET' });
}

export async function criarAmbienteSharePoint(payload) {
  return requisitar('/sistema/ambientes-sharepoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function atualizarAmbienteSharePoint(idAmbiente, payload) {
  return requisitar(`/sistema/ambientes-sharepoint/${encodeURIComponent(idAmbiente)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function testarAmbienteSharePoint(idAmbiente) {
  return requisitar(`/sistema/ambientes-sharepoint/${encodeURIComponent(idAmbiente)}/testar`, {
    method: 'POST',
  });
}

export async function excluirAmbienteSharePoint(idAmbiente, justificativa = '') {
  const query = justificativa ? `?justificativa=${encodeURIComponent(justificativa)}` : '';
  return requisitar(`/sistema/ambientes-sharepoint/${encodeURIComponent(idAmbiente)}${query}`, {
    method: 'DELETE',
  });
}
