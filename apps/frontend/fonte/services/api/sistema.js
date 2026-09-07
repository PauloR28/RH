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
