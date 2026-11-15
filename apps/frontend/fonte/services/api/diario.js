import { requisitar, requisitarArquivo } from './core.js';

// Diário de bordo (08/11/2026): registro do dia da operação por turno. Regras e permissões ficam no servidor (/diario/*).
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const enviar = (caminho, metodo, corpo) => requisitar(caminho, { method: metodo, headers: JSON_HEADERS, body: JSON.stringify(corpo || {}) });
const q = encodeURIComponent;

export const lerContextoDiario = () => requisitar('/diario/contexto', { method: 'GET' });
export const aceitarTermosDiario = () => enviar('/diario/termos/aceite', 'POST', {});
export const lerDiaDiario = (operacao, data) => requisitar(`/diario/dia?operacao=${q(operacao)}&data=${q(data)}`, { method: 'GET' });
export const lerResumoHojeDiario = () => requisitar('/diario/resumo-hoje', { method: 'GET' });

export const marcarEdicaoTurno = (idTurno, forcar = false) => enviar(`/diario/turnos/${q(idTurno)}/editar`, 'POST', { forcar });
export const salvarTurnoDiario = (idTurno, corpo) => enviar(`/diario/turnos/${q(idTurno)}`, 'PUT', corpo);
export const concluirTurnoDiario = (idTurno, versao) => enviar(`/diario/turnos/${q(idTurno)}/concluir`, 'POST', { versao });
export const reabrirTurnoDiario = (idTurno, motivo) => enviar(`/diario/turnos/${q(idTurno)}/reabrir`, 'POST', { motivo });

export const salvarEncerramentoDiario = (idDia, corpo) => enviar(`/diario/dias/${q(idDia)}/encerramento`, 'PUT', corpo);
export const encerrarDiaDiario = (idDia, corpo) => enviar(`/diario/dias/${q(idDia)}/encerrar`, 'POST', corpo);
export const reabrirDiaDiario = (idDia, motivo) => enviar(`/diario/dias/${q(idDia)}/reabrir`, 'POST', { motivo });
export const corrigirAbsDiario = (idDia, corpo) => enviar(`/diario/dias/${q(idDia)}/abs`, 'POST', corpo);
export const salvarParcialDiario = (idDia, idParcial, corpo) =>
  idParcial ? enviar(`/diario/dias/${q(idDia)}/parciais/${q(idParcial)}`, 'PUT', corpo) : enviar(`/diario/dias/${q(idDia)}/parciais`, 'POST', corpo);
export const excluirParcialDiario = (idDia, idParcial) => requisitar(`/diario/dias/${q(idDia)}/parciais/${q(idParcial)}`, { method: 'DELETE' });
export const registrarEnvioDiario = (idDia, passo) => enviar(`/diario/dias/${q(idDia)}/envio`, 'POST', { passo });
export const lerAlteracoesDiario = (idDia) => requisitar(`/diario/dias/${q(idDia)}/alteracoes`, { method: 'GET' });
export const exportarAlteracoesDiario = (idDia) => requisitarArquivo(`/diario/dias/${q(idDia)}/alteracoes/exportar`, { method: 'GET' });

export const criarIntercorrenciaDiario = (corpo) => enviar('/diario/intercorrencias', 'POST', corpo);
export const editarIntercorrenciaDiario = (id, corpo) => enviar(`/diario/intercorrencias/${q(id)}`, 'PUT', corpo);
export const excluirIntercorrenciaDiario = (id, motivo) => enviar(`/diario/intercorrencias/${q(id)}/excluir`, 'POST', { motivo });
export const intercorrenciasNoHorario = (operacao, momento) =>
  requisitar(`/diario/intercorrencias/no-horario?operacao=${q(operacao)}&momento=${q(momento)}`, { method: 'GET' });

export const lerHistoricoDiario = (operacao, anoMes) => requisitar(`/diario/historico?operacao=${q(operacao)}&ano_mes=${q(anoMes)}`, { method: 'GET' });
export const exportarHistoricoDiario = (operacao, anoMes, formato = 'xlsx') =>
  requisitarArquivo('/diario/historico/exportar', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ operacao, ano_mes: anoMes, formato }) });

export const listarCadastrosDiario = (operacao) => requisitar(`/diario/cadastros?operacao=${q(operacao)}`, { method: 'GET' });
export const salvarCadastroDiario = (idItem, corpo) => (idItem ? enviar(`/diario/cadastros/${q(idItem)}`, 'PUT', corpo) : enviar('/diario/cadastros', 'POST', corpo));
export const importarDiario = (operacao, arquivos, gravar) => enviar('/diario/importar', 'POST', { operacao, arquivos, gravar });
