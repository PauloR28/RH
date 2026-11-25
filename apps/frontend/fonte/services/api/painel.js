import { requisitar } from './core.js?v=20261125-deploy';

// Painel (14/11/2026): visão analítica por módulo e unidade. Acesso, escopo e métricas são decididos no servidor (/painel/*).
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const q = encodeURIComponent;

export const lerOpcoesPainel = () => requisitar('/painel/opcoes', { method: 'GET' });
export const lerDadosPainel = (idPainel, periodo, equipe = '') =>
  requisitar(`/painel/${q(idPainel)}/dados?periodo=${q(periodo)}&equipe=${q(equipe)}`, { method: 'GET' });
export const lerFichaOperador = (idPainel, idOperador, periodo) =>
  requisitar(`/painel/${q(idPainel)}/operadores/${q(idOperador)}?periodo=${q(periodo)}`, { method: 'GET' });

export const lerConfigPaineis = () => requisitar('/painel/config', { method: 'GET' });
export const salvarConfigPainel = (idPainel, corpo) =>
  requisitar(idPainel ? `/painel/config/${q(idPainel)}` : '/painel/config', { method: idPainel ? 'PUT' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(corpo) });
export const lerPresencaComparada = (idPainel, periodo, equipe, comparar) =>
  requisitar(`/painel/${q(idPainel)}/presenca-comparada?periodo=${q(periodo)}&equipe=${q(equipe || '')}&comparar=${q(comparar)}`, { method: 'GET' });
export const lerDiaPainel = (idPainel, data, equipe = '') => requisitar(`/painel/${q(idPainel)}/dia?data=${q(data)}&equipe=${q(equipe)}`, { method: 'GET' });
