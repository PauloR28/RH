import { requisitar } from './core.js?v=20261126-senha';

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
