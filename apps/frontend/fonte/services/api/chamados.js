import { requisitar, requisitarArquivo } from './core.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function consulta(params = {}) {
  const partes = Object.entries(params)
    .filter(([, valor]) => valor !== undefined && valor !== null && valor !== '' && valor !== false)
    .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

const enviar = (caminho, metodo, corpo) =>
  requisitar(caminho, { method: metodo, headers: JSON_HEADERS, body: JSON.stringify(corpo || {}) });

// Chamados (Suporte TI). Toda permissão e escopo de operação são aplicados no backend; o frontend só esconde o que não cabe ao perfil.
export const lerMetaChamados = () => requisitar('/chamados/meta', { method: 'GET' });
export const listarChamados = (filtros = {}) => requisitar(`/chamados${consulta(filtros)}`, { method: 'GET' });
export const listarFilaChamados = (filtros = {}) => requisitar(`/chamados/fila${consulta(filtros)}`, { method: 'GET' });
export const lerChamado = (id) => requisitar(`/chamados/${id}`, { method: 'GET' });
export const listarEventosChamado = (id, params = {}) => requisitar(`/chamados/${id}/eventos${consulta(params)}`, { method: 'GET' });

export function criarChamado(dados, arquivos = []) {
  const corpo = new FormData();
  corpo.append('dados', JSON.stringify(dados));
  arquivos.forEach((arquivo) => corpo.append('arquivos', arquivo, arquivo.name));
  return requisitar('/chamados', { method: 'POST', body: corpo });
}

export function enviarMensagemChamado(id, conteudo, arquivos = []) {
  const corpo = new FormData();
  corpo.append('conteudo', conteudo || '');
  arquivos.forEach((arquivo) => corpo.append('arquivos', arquivo, arquivo.name));
  return requisitar(`/chamados/${id}/mensagens`, { method: 'POST', body: corpo });
}

export const assumirChamado = (id) => enviar(`/chamados/${id}/assumir`, 'POST', {});
export const atribuirChamado = (id, responsavelId) => enviar(`/chamados/${id}/atribuir`, 'POST', { responsavel_id: responsavelId });
export const mudarStatusChamado = (id, status, justificativa = '') => enviar(`/chamados/${id}/status`, 'PUT', { status, justificativa });
export const mudarUrgenciaChamado = (id, urgencia, justificativa = '') => enviar(`/chamados/${id}/urgencia`, 'PUT', { urgencia, justificativa });
export const cancelarChamado = (id, motivo = '') => enviar(`/chamados/${id}/cancelar`, 'POST', { motivo });
export const confirmarEncerramentoChamado = (id) => enviar(`/chamados/${id}/confirmar-encerramento`, 'POST', {});
export const reabrirChamado = (id, motivo) => enviar(`/chamados/${id}/reabrir`, 'POST', { motivo });

export const buscarAgentesChamado = (operacao, q) => requisitar(`/chamados/agentes${consulta({ operacao, q })}`, { method: 'GET' });
export const buscarAtendentesChamado = (q) => requisitar(`/chamados/atendentes${consulta({ q })}`, { method: 'GET' });

export const baixarAnexoChamado = (idAnexo) => requisitarArquivo(`/chamados/anexos/${idAnexo}/download`, { method: 'GET' });
export const excluirAnexoChamado = (idAnexo) => requisitar(`/chamados/anexos/${idAnexo}`, { method: 'DELETE' });

export const lerDashboardChamados = (dias = 30) => requisitar(`/chamados/dashboard${consulta({ dias })}`, { method: 'GET' });
export const lerConfigChamados = () => requisitar('/chamados/config', { method: 'GET' });
export const salvarConfigChamados = (valores) => enviar('/chamados/config', 'PUT', { valores });
export const criarCategoriaChamado = (dados) => enviar('/chamados/config/categorias', 'POST', dados);
export const atualizarCategoriaChamado = (id, dados) => enviar(`/chamados/config/categorias/${id}`, 'PUT', dados);
