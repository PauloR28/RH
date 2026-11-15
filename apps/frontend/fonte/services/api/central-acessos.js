import { requisitar } from './core.js';

// Central de Acessos (Etapa 6): /tecnologia/acessos. Sem cache: a tela precisa ver o que acabou de salvar.
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const lerAcessos = (modulo, escopo = 'padrao') => requisitar(`/tecnologia/acessos?${q({ modulo, escopo })}`, { method: 'GET' });
export const lerEscoposAcessos = (modulo) => requisitar(`/tecnologia/acessos/escopos?${q({ modulo })}`, { method: 'GET' });
export const salvarAcessos = (corpo) => requisitar('/tecnologia/acessos/lote', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(corpo) });
export const padronizarAcessos = (corpo) => requisitar('/tecnologia/acessos/padronizar', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(corpo) });
