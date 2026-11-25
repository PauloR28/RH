import { requisitar } from './core.js?v=20261125-acessos-perfil';

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function listarResultadosAnaliticosProcesso(processId, params = {}) {
  return requisitar(
    `/processes/${encodeURIComponent(processId)}/analytical-results${queryString(params)}`,
  );
}

export function lerStatusResultadosAnaliticosProcesso(processId) {
  return requisitar(`/processes/${encodeURIComponent(processId)}/analytical-results/status`);
}

export function lerConfiguracaoResultadosAnaliticosProcesso(processId) {
  return requisitar(`/processes/${encodeURIComponent(processId)}/analytical-results/configuration`);
}

export function lerDetalheResultadoAnalitico(processId, candidateId) {
  return requisitar(
    `/processes/${encodeURIComponent(processId)}/analytical-results/candidates/${encodeURIComponent(candidateId)}`,
  );
}

export function compararResultadosAnaliticos(processId, candidateIds = []) {
  const query = new URLSearchParams();
  candidateIds.forEach((id) => query.append('candidate_ids', id));
  return requisitar(
    `/processes/${encodeURIComponent(processId)}/analytical-results/compare?${query.toString()}`,
  );
}

export function salvarPesosResultadosAnaliticos(processId, weights) {
  return requisitar(`/processes/${encodeURIComponent(processId)}/analytical-results/weights`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights }),
  });
}

export function salvarPerfilIdealResultadosAnaliticos(processId, idealProfile) {
  return requisitar(`/processes/${encodeURIComponent(processId)}/analytical-results/ideal-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ideal_profile: idealProfile }),
  });
}

export function salvarMapeamentosResultadosAnaliticos(processId, mappings) {
  return requisitar(`/processes/${encodeURIComponent(processId)}/analytical-results/categories`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings }),
  });
}
