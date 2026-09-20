import { requisitar, requisitarArquivo } from './core.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function consulta(params = {}) {
  const partes = Object.entries(params)
    .filter(([, valor]) => valor !== undefined && valor !== null && valor !== '' && valor !== false && valor !== 0)
    .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(valor === true ? 'true' : valor)}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

const enviar = (caminho, metodo, corpo) =>
  requisitar(caminho, { method: metodo, headers: JSON_HEADERS, body: JSON.stringify(corpo || {}) });

// --- contexto / organização ---------------------------------------------
export const lerContextoMonitoria = () => requisitar('/monitoria/contexto', { method: 'GET' });
export const escolherDesignOperacao = (operacao) => enviar('/monitoria/tema', 'PUT', { operacao });
export const listarEquipesMonitoria = (operacao = '') =>
  requisitar(`/monitoria/equipes${consulta({ operacao })}`, { method: 'GET' });
export const salvarEquipeMonitoria = (payload, idEquipe = null) =>
  enviar(idEquipe ? `/monitoria/equipes/${idEquipe}` : '/monitoria/equipes', idEquipe ? 'PUT' : 'POST', payload);
export const listarCatalogoMonitoria = (tipo, operacao = '', incluirInativos = false) =>
  requisitar(`/monitoria/catalogo${consulta({ tipo, operacao, incluir_inativos: incluirInativos })}`, { method: 'GET' });
export const salvarCatalogoMonitoria = (payload, idItem = null) =>
  enviar(idItem ? `/monitoria/catalogo/${idItem}` : '/monitoria/catalogo', idItem ? 'PUT' : 'POST', payload);

// --- usuários da monitoria ------------------------------------------------
export const listarUsuariosMonitoria = () => requisitar('/monitoria/usuarios', { method: 'GET' });
export const criarUsuarioMonitoria = (payload) => enviar('/monitoria/usuarios', 'POST', payload);
export const atualizarUsuarioMonitoria = (id, payload) => enviar(`/monitoria/usuarios/${id}`, 'PUT', payload);
export const transferirSupervisao = (payload) => enviar('/monitoria/supervisao/transferir', 'POST', payload);
export const liberarTrocaDesign = (id) => enviar(`/monitoria/usuarios/${id}/liberar-design`, 'POST', {});
export const trocarSenhaInicial = (payload) => enviar('/auth/me/senha-inicial', 'POST', payload);

// --- matriz ----------------------------------------------------------------
export const lerMatriz = (operacao) => requisitar(`/monitoria/matriz${consulta({ operacao })}`, { method: 'GET' });
export const listarVersoesMatriz = (operacao) =>
  requisitar(`/monitoria/matriz/versoes${consulta({ operacao })}`, { method: 'GET' });
export const lerVersaoMatriz = (idVersao) => requisitar(`/monitoria/matriz/versoes/${idVersao}`, { method: 'GET' });
export const salvarMatriz = (operacao, config, observacao = '') =>
  enviar(`/monitoria/matriz${consulta({ operacao })}`, 'PUT', { config, observacao });

// --- realização / consulta -------------------------------------------------
export const listarOperadoresMonitoria = (operacao) =>
  requisitar(`/monitoria/operadores${consulta({ operacao })}`, { method: 'GET' });
export const realizarMonitoria = (payload, idRascunho = 0) =>
  enviar(`/monitoria/monitorias${consulta({ id_rascunho: idRascunho })}`, 'POST', payload);
export const listarMonitorias = (filtros = {}) => requisitar(`/monitoria/monitorias${consulta(filtros)}`, { method: 'GET' });
export const lerMonitoria = (ref) => requisitar(`/monitoria/monitorias/${encodeURIComponent(ref)}`, { method: 'GET' });
export const calcularPrevia = (operacao, respostas) => enviar('/monitoria/calcular', 'POST', { operacao, respostas });
export const listarRascunhos = () => requisitar('/monitoria/rascunhos', { method: 'GET' });
export const salvarRascunho = (payload, id = null) =>
  enviar(id ? `/monitoria/rascunhos/${id}` : '/monitoria/rascunhos', id ? 'PUT' : 'POST', payload);
export const descartarRascunho = (id) => requisitar(`/monitoria/rascunhos/${id}`, { method: 'DELETE' });

// --- fluxo ------------------------------------------------------------------
export const aplicarFeedback = (ref, payload) => enviar(`/monitoria/monitorias/${ref}/feedback`, 'POST', payload);
export const confirmarMonitoria = (ref) => enviar(`/monitoria/monitorias/${ref}/confirmar`, 'POST', {});
export const contestarMonitoria = (ref, payload) => enviar(`/monitoria/monitorias/${ref}/contestar`, 'POST', payload);
export const replicarContestacao = (ref, texto) => enviar(`/monitoria/monitorias/${ref}/replica`, 'POST', { texto });
export const reanalisarContestacao = (ref, payload) => enviar(`/monitoria/monitorias/${ref}/reanalise`, 'POST', payload);
export function anexarEvidencia(ref, arquivo) {
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  return requisitar(`/monitoria/monitorias/${ref}/anexos`, { method: 'POST', body: corpo });
}
export const baixarEvidencia = (idAnexo) => requisitarArquivo(`/monitoria/anexos/${idAnexo}`, { method: 'GET' });

// --- planos de ação ---------------------------------------------------------
export const listarPlanos = (filtros = {}) => requisitar(`/monitoria/planos${consulta(filtros)}`, { method: 'GET' });
export const lerPlano = (id) => requisitar(`/monitoria/planos/${id}`, { method: 'GET' });
export const criarPlano = (payload) => enviar('/monitoria/planos', 'POST', payload);
export const revisarPlano = (id, payload) => enviar(`/monitoria/planos/${id}`, 'PUT', payload);

// --- análise / saída --------------------------------------------------------
export const lerDashboard = (filtros = {}) => requisitar(`/monitoria/dashboard${consulta(filtros)}`, { method: 'GET' });
export const lerRelatorio = (tipo, filtros = {}) =>
  requisitar(`/monitoria/relatorios/${tipo}${consulta(filtros)}`, { method: 'GET' });
export const exportarRelatorio = (tipo, formato, filtros = {}) =>
  requisitarArquivo(`/monitoria/relatorios/${tipo}/exportar${consulta({ ...filtros, formato })}`, { method: 'GET' });
export const exportarMonitorias = (ids) =>
  requisitarArquivo('/monitoria/exportar/monitorias', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids }) });
export const listarDestinatarios = (ids) => requisitar(`/monitoria/destinatarios${consulta({ ids: ids.join(',') })}`, { method: 'GET' });
export const compartilharMonitorias = (payload) => enviar('/monitoria/compartilhar', 'POST', payload);
export const listarLogsMonitoria = (filtros = {}) => requisitar(`/monitoria/logs${consulta(filtros)}`, { method: 'GET' });

// --- guia / configuração / risco / identidade ---------------------------------
export const listarGuia = (todos = false) => requisitar(`/monitoria/guia${consulta({ todos })}`, { method: 'GET' });
export const salvarGuia = (payload, id = null) =>
  enviar(id ? `/monitoria/guia/${id}` : '/monitoria/guia', id ? 'PUT' : 'POST', payload);
export const lerConfigMonitoria = () => requisitar('/monitoria/config', { method: 'GET' });
export const salvarConfigMonitoria = (payload) => enviar('/monitoria/config', 'PUT', payload);
export const executarZonaDeRisco = (acao, payload) => enviar(`/monitoria/risco/${acao}`, 'POST', payload);
export const listarIdentidadeOperacoes = () => requisitar('/monitoria/identidade', { method: 'GET' });
export const salvarCorOperacao = (operacao, cor) => enviar(`/monitoria/identidade/${operacao}`, 'PUT', { cor_primaria: cor });
export function enviarLogoOperacao(operacao, arquivo) {
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  return requisitar(`/monitoria/identidade/${operacao}/logo`, { method: 'POST', body: corpo });
}
