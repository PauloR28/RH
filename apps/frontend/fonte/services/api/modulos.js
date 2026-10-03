import { invalidarCacheApi, requisitar } from './core.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const enviar = (caminho, metodo, corpo) =>
  requisitar(caminho, { method: metodo, headers: JSON_HEADERS, body: JSON.stringify(corpo || {}) });

// Core: módulos visíveis, módulo padrão e permissões efetivas do usuário logado (GET /core/acesso).
export const lerAcessoCore = () => requisitar('/core/acesso', { method: 'GET' });

// Tecnologia: ativação de módulos, dono das permissões e liberação do WFM para participantes (fase de teste).
export const listarModulosTecnologia = () => requisitar('/tecnologia/modulos', { method: 'GET' });
export const definirModuloAtivo = (chave, ativo, justificativa = '') =>
  enviar(`/tecnologia/modulos/${encodeURIComponent(chave)}`, 'PUT', { ativo, justificativa });
export async function definirModuloDaPermissao(chave, modulo, abreModulo = null, justificativa = '') {
  const resposta = await enviar(`/tecnologia/permissoes/${encodeURIComponent(chave)}/modulo`, 'PUT', {
    modulo,
    abre_modulo: abreModulo,
    justificativa,
  });
  invalidarCacheApi('settings:permissions');
  return resposta;
}
export const lerWfmParticipantes = () => requisitar('/tecnologia/parametros/wfm-participantes', { method: 'GET' });
export const definirWfmParticipantes = (valor, justificativa = '') =>
  enviar('/tecnologia/parametros/wfm-participantes', 'PUT', { valor, confirmar: true, justificativa });
