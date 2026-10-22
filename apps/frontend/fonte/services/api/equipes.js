import { requisitar } from './core.js';

// Controle de Equipes e Turnos. Presença, escala e horários usam as rotas do WFM; aqui só a equipe, as monitorias e o Mural da operação.
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const enviar = (caminho, metodo, corpo) =>
  requisitar(caminho, { method: metodo, headers: JSON_HEADERS, body: JSON.stringify(corpo || {}) });

export const lerContextoEquipes = (idSupervisor = '') =>
  requisitar(`/equipes/contexto${idSupervisor ? `?id_supervisor=${encodeURIComponent(idSupervisor)}` : ''}`, { method: 'GET' });
export const listarCandidatosEquipe = () => requisitar('/equipes/candidatos', { method: 'GET' });
export const listarSupervisoresDestinoEquipe = () => requisitar('/equipes/supervisores-destino', { method: 'GET' });
export const adicionarOperadorEquipe = (idOperador) => enviar('/equipes/operadores', 'POST', { id_operador: idOperador });
export const removerOperadorEquipe = (idOperador, idNovoSupervisor = null) =>
  enviar(`/equipes/operadores/${encodeURIComponent(idOperador)}/remover`, 'POST', { id_novo_supervisor: idNovoSupervisor });
export const lerMonitoriasEquipe = (idSupervisor = '', dias = 90) =>
  requisitar(`/equipes/monitorias?dias=${encodeURIComponent(dias)}${idSupervisor ? `&id_supervisor=${encodeURIComponent(idSupervisor)}` : ''}`, { method: 'GET' });

// Mural com escopo da operação (mesmo contrato de services/api/mural.js).
export const API_MURAL_EQUIPE = {
  listar: (statusFiltro = '') => requisitar(`/equipes/mural${statusFiltro ? `?status_filtro=${encodeURIComponent(statusFiltro)}` : ''}`, { method: 'GET' }),
  ambientes: () => requisitar('/equipes/mural/ambientes', { method: 'GET' }),
  criar: (payload) => enviar('/equipes/mural', 'POST', payload),
  atualizar: (id, payload) => enviar(`/equipes/mural/${encodeURIComponent(id)}`, 'PUT', payload),
  arquivar: (id) => requisitar(`/equipes/mural/${encodeURIComponent(id)}/arquivar`, { method: 'POST' }),
  restaurar: (id) => requisitar(`/equipes/mural/${encodeURIComponent(id)}/restaurar`, { method: 'POST' }),
  publicar: (id, ambientes = []) => enviar(`/equipes/mural/${encodeURIComponent(id)}/publicar`, 'POST', { ambientes }),
  excluir: (id) => requisitar(`/equipes/mural/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  upload: (arquivo) => {
    const formData = new FormData();
    formData.append('arquivo', arquivo);
    return requisitar('/equipes/mural/imagens', { method: 'POST', body: formData });
  },
};
