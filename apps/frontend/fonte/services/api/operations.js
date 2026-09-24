import { requisitar } from './core.js';

export async function listarOperacoes() {
  // Correções.txt (24/set/2026, item 5/13): endpoint quase estático (poucas
  // operações, mudam raramente) — deixa o navegador reaproveitar via
  // Cache-Control/ETag (ver services/http_cache.py) em vez de 'no-store'.
  return requisitar('/operacoes', { method: 'GET', cache: 'default' });
}
