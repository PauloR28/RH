import { requisitar, requisitarArquivo } from './core.js?v=20261124-equipes';

// Equipes na Tecnologia (24/11/2026). Regras e escopo ficam no servidor (/equipes-admin).
const q = (operacao) => (operacao ? `?operacao=${encodeURIComponent(operacao)}` : '');

export const listarEquipesAdmin = (operacao = '') => requisitar(`/equipes-admin${q(operacao)}`, { method: 'GET' });
export const membrosEquipeAdmin = (idEquipe) => requisitar(`/equipes-admin/${encodeURIComponent(idEquipe)}/membros`, { method: 'GET' });
export const salvarEquipeAdmin = (dados, idEquipe = null) => requisitar(idEquipe ? `/equipes-admin/${encodeURIComponent(idEquipe)}` : '/equipes-admin', {
  method: idEquipe ? 'PUT' : 'POST', body: JSON.stringify(dados),
});
export const previaMoverEquipe = (dados) => requisitar('/equipes-admin/mover/previa', { method: 'POST', body: JSON.stringify(dados) });
export const moverEquipe = (dados) => requisitar('/equipes-admin/mover', { method: 'POST', body: JSON.stringify(dados) });
export const exportarEquipesAdmin = (operacao = '') => requisitarArquivo(`/equipes-admin/exportar${q(operacao)}`, { method: 'GET' });
