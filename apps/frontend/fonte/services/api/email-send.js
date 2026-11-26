import { requisitar } from './core.js?v=20261126-painel-graficos';

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
