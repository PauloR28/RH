import { requisitar } from './core.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function consulta(params = {}) {
  const partes = Object.entries(params)
    .filter(([, valor]) => valor !== undefined && valor !== null && valor !== '')
    .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

const enviar = (caminho, metodo, corpo) =>
  requisitar(caminho, { method: metodo, headers: JSON_HEADERS, body: JSON.stringify(corpo || {}) });

// WFM — Turnos e Plantões. Toda restrição (operação, equipe, perfil) é aplicada no backend.
export const lerContextoWfm = () => requisitar('/wfm/contexto', { method: 'GET' });

export const listarContratosWfm = (operacao) => requisitar(`/wfm/contratos${consulta({ operacao })}`, { method: 'GET' });
export const salvarContratoWfm = (dados, id) => enviar(id ? `/wfm/contratos/${id}` : '/wfm/contratos', id ? 'PUT' : 'POST', dados);

export const listarTurnosWfm = (operacao) => requisitar(`/wfm/turnos${consulta({ operacao })}`, { method: 'GET' });
export const salvarTurnoWfm = (dados, id) => enviar(id ? `/wfm/turnos/${id}` : '/wfm/turnos', id ? 'PUT' : 'POST', dados);

export const listarSkillsWfm = (operacao) => requisitar(`/wfm/skills${consulta({ operacao })}`, { method: 'GET' });
export const salvarSkillWfm = (dados, id) => enviar(id ? `/wfm/skills/${id}` : '/wfm/skills', id ? 'PUT' : 'POST', dados);
export const definirSkillsOperadorWfm = (idOperador, dados) => enviar(`/wfm/operadores/${idOperador}/skills`, 'PUT', dados);
export const vincularContratoOperadorWfm = (idOperador, dados) => enviar(`/wfm/operadores/${idOperador}/contrato`, 'PUT', dados);

export const listarCalendarioWfm = (operacao, anoMes = '') => requisitar(`/wfm/calendario${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });
export const salvarEventoWfm = (dados, id) => enviar(id ? `/wfm/calendario/${id}` : '/wfm/calendario', id ? 'PUT' : 'POST', dados);

export const lerEscalaWfm = (operacao, anoMes) => requisitar(`/wfm/escala${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });
export const salvarItensEscalaWfm = (dados) => enviar('/wfm/escala/itens', 'PUT', dados);
export const validarEscalaWfm = (operacao, anoMes) => requisitar(`/wfm/escala/validar${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });
export const publicarEscalaWfm = (dados) => enviar('/wfm/escala/publicar', 'POST', dados);
export const fecharPeriodoWfm = (dados) => enviar('/wfm/escala/fechar', 'POST', dados);
export const listarVersoesEscalaWfm = (operacao, anoMes) => requisitar(`/wfm/escala/versoes${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });

export const listarPresencasWfm = (operacao, anoMes) => requisitar(`/wfm/presencas${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });
export const lancarPresencaWfm = (dados) => enviar('/wfm/presencas', 'PUT', dados);
export const listarAtestadosWfm = (operacao, anoMes) => requisitar(`/wfm/atestados${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });
export const registrarAtestadoWfm = (dados) => enviar('/wfm/atestados', 'POST', dados);

export const listarAuditoriaWfm = (filtros = {}) => requisitar(`/wfm/auditoria${consulta(filtros)}`, { method: 'GET' });
