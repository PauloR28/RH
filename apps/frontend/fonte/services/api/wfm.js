import { requisitar, requisitarArquivo } from './core.js';
import { operacaoBaseAtiva } from '../../modulos/estado.js?v=20261003-modulos-c';
import { filtrarPorOperacaoBase } from '../../modulos/registro.js?v=20261003-modulos-c';

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
// Em Tecnologia a tela emprestada do WFM mostra só a operação da TI (filtro de conveniência; o isolamento real é do servidor).
export const lerContextoWfm = () =>
  requisitar('/wfm/contexto', { method: 'GET' }).then((contexto) => {
    const base = operacaoBaseAtiva();
    return base && contexto ? { ...contexto, operacoes: filtrarPorOperacaoBase(contexto.operacoes, base, 'chave') } : contexto;
  });

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

export const lerEscalaWfm = (operacao, anoMes, propria = false) => requisitar(`/wfm/escala${consulta({ operacao, ano_mes: anoMes, ...(propria ? { propria: true } : {}) })}`, { method: 'GET' });
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

export const exportarEscalaWfm = (operacao, anoMes, formato = 'xlsx') =>
  requisitarArquivo(`/wfm/escala/exportar${consulta({ operacao, ano_mes: anoMes, formato })}`, { method: 'GET' });

export const lerRelatorioWfm = (filtros) => requisitar(`/wfm/relatorios${consulta(filtros)}`, { method: 'GET' });
export const exportarRelatorioWfm = (filtros) => requisitarArquivo(`/wfm/relatorios/exportar${consulta(filtros)}`, { method: 'GET' });

export const listarTrocasWfm = (operacao, estado = '') => requisitar(`/wfm/trocas${consulta({ operacao, estado })}`, { method: 'GET' });
export const listarColegasTrocaWfm = (operacao) => requisitar(`/wfm/trocas/colegas${consulta({ operacao })}`, { method: 'GET' });
export const solicitarTrocaWfm = (dados) => enviar('/wfm/trocas', 'POST', dados);
export const responderTrocaWfm = (id, aceitar) => enviar(`/wfm/trocas/${id}/responder`, 'POST', { aceitar });
export const cancelarTrocaWfm = (id) => enviar(`/wfm/trocas/${id}/cancelar`, 'POST', {});
export const decidirTrocaWfm = (id, aprovar, justificativa = '') => enviar(`/wfm/trocas/${id}/decidir`, 'POST', { aprovar, justificativa });
export const desfazerTrocaWfm = (id, justificativa) => enviar(`/wfm/trocas/${id}/desfazer`, 'POST', { justificativa });

export const listarHorasExtrasWfm = (operacao, anoMes) => requisitar(`/wfm/horas-extras${consulta({ operacao, ano_mes: anoMes })}`, { method: 'GET' });
export const lancarHoraExtraWfm = (dados) => enviar('/wfm/horas-extras', 'PUT', dados);
export const listarOperadoresContratoWfm = (operacao, id) => requisitar(`/wfm/contratos/${id}/operadores${consulta({ operacao })}`, { method: 'GET' });
export const desvincularOperadorContratoWfm = (operacao, id, idOperador) => requisitar(`/wfm/contratos/${id}/operadores/${idOperador}${consulta({ operacao })}`, { method: 'DELETE' });
export const listarSupervisoresWfm = (operacao) => requisitar(`/wfm/supervisores${consulta({ operacao })}`, { method: 'GET' });
export const excluirContratoWfm = (operacao, id) => requisitar(`/wfm/contratos/${id}${consulta({ operacao })}`, { method: 'DELETE' });
export const excluirTurnoWfm =(operacao, id) => requisitar(`/wfm/turnos/${id}${consulta({ operacao })}`, { method: 'DELETE' });
export const lerContratoOperadorWfm = (operacao, idOperador) => requisitar(`/wfm/operadores/${idOperador}/contrato${consulta({ operacao })}`, { method: 'GET' });
export const lancarPresencaLoteWfm = (dados) => enviar('/wfm/presencas/lote', 'PUT', dados);

export const lerPausasDiaWfm = (operacao, data) => requisitar(`/wfm/pausas${consulta({ operacao, data })}`, { method: 'GET' });
export const salvarPausasWfm = (dados) => enviar('/wfm/pausas', 'PUT', dados);
export const distribuirPausasWfm = (dados) => enviar('/wfm/pausas/distribuir', 'POST', dados);
export const definirCapacidadePausasWfm = (dados) => enviar('/wfm/pausas/capacidade', 'PUT', dados);

// Aprovação da escala antes da publicação e tipos de escala do setor de TI.
export const enviarAprovacaoEscalaWfm = (dados) => enviar('/wfm/escala/enviar-aprovacao', 'POST', dados);
export const aprovarEscalaWfm = (dados) => enviar('/wfm/escala/aprovar', 'POST', dados);
export const declinarEscalaWfm = (dados) => enviar('/wfm/escala/declinar', 'POST', dados);
export const cancelarEnvioEscalaWfm = (dados) => enviar('/wfm/escala/cancelar-envio', 'POST', dados);
export const listarTiposEscalaWfm = (operacaoBase = 'TI') => requisitar(`/wfm/tipos-escala${consulta({ operacao_base: operacaoBase })}`, { method: 'GET' });
export const salvarTipoEscalaWfm = (dados, id) => enviar(id ? `/wfm/tipos-escala/${id}` : '/wfm/tipos-escala', id ? 'PUT' : 'POST', dados);
export const excluirTipoEscalaWfm = (id) => requisitar(`/wfm/tipos-escala/${id}`, { method: 'DELETE' });

// Configuração da escala (nome e aprovadores) e resumo das escalas para trocar de escala sem sair da tela.
export const lerConfigEscalaWfm = (operacao) => requisitar(`/wfm/escala/config${consulta({ operacao })}`, { method: 'GET' });
export const salvarConfigEscalaWfm = (dados) => enviar('/wfm/escala/config', 'PUT', dados);
export const resumoEscalasWfm = (anoMes) => requisitar(`/wfm/escalas/resumo${consulta({ ano_mes: anoMes })}`, { method: 'GET' });
export const gestaoEscalasWfm = (anoMes) =>
  requisitar(`/wfm/escalas/gestao${consulta({ ano_mes: anoMes })}`, { method: 'GET' }).then((resposta) => {
    const base = operacaoBaseAtiva();
    return base && resposta ? { ...resposta, itens: filtrarPorOperacaoBase(resposta.itens, base, 'operacao_base') } : resposta;
  });
export const criarEscalaWfm = (dados) => enviar('/wfm/escalas', 'POST', dados);
export const duplicarEscalaWfm = (dados) => enviar('/wfm/escalas/duplicar', 'POST', dados);
export const excluirEscalaWfm = (operacao) => requisitar(`/wfm/escalas${consulta({ operacao })}`, { method: 'DELETE' });
