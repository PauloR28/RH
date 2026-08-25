import { requisitar } from './core.js';

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
