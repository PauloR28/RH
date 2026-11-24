import { requisitar } from './core.js?v=20261124-equipes3';

export async function listarModelosEmail() {
  return requisitar('/emails/modelos', { method: 'GET' });
}

export async function enviarEmail(payload) {
  return requisitar('/emails/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}
