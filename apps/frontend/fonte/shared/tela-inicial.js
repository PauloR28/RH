// Tela inicial configurável por perfil (espelha apps/backend/rh_api/services/tela_inicial.py).
// A configuração do perfil só ESCONDE ou reordena blocos: cada bloco continua
// exigindo a permissão da área (quem não acessa a Caixa de CV não vê o bloco).
import { requisitar } from '../services/api/core.js';

export const PERFIS_INICIO_POR_SESSOES = new Set(['supervisor', 'qualidade', 'operador', 'candidato']);

export const BLOCOS_TELA_INICIAL = [
  { id: 'atalhos', label: 'Acessos rápidos', permissao: null, coluna: 'topo' },
  { id: 'indicadores', label: 'Indicadores do dia', permissao: null, coluna: 'topo' },
  { id: 'sessoes', label: 'Suas áreas (Treinamentos, Monitoria, Mural...)', permissao: null, coluna: 'topo' },
  { id: 'caixa_cv', label: 'Caixa de Currículos', permissao: 'candidatos.criar', coluna: 'esquerda' },
  { id: 'movimentacoes', label: 'Movimentações', permissao: 'candidatos.visualizar', coluna: 'esquerda' },
  { id: 'mural', label: 'Mural', permissao: 'mural.visualizar', coluna: 'esquerda' },
  { id: 'entrevistas', label: 'Próximas Entrevistas', permissao: 'entrevistas.visualizar', coluna: 'direita' },
  { id: 'provas_recentes', label: 'Provas recentes', permissao: 'candidatos.consultar_historico', coluna: 'direita' },
  { id: 'processos', label: 'Processos Abertos', permissao: 'vagas.visualizar', coluna: 'direita' },
];

export function configTelaInicialPadrao() {
  return { blocos: BLOCOS_TELA_INICIAL.map((bloco) => ({ id: bloco.id, visivel: bloco.id !== 'sessoes' })) };
}

export function usaInicioPorSessoes(perfil) {
  return Boolean(perfil) && PERFIS_INICIO_POR_SESSOES.has(String(perfil));
}

export async function lerMinhaTelaInicial() {
  return requisitar('/settings/tela-inicial/minha', { method: 'GET' });
}

export async function listarTelaInicialPerfis() {
  return requisitar('/settings/tela-inicial', { method: 'GET' });
}

export async function salvarTelaInicialPerfil(idPerfil, blocos) {
  return requisitar(`/settings/tela-inicial/${encodeURIComponent(idPerfil)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocos }),
  });
}

// Blocos que o usuário vê, na ordem configurada: visível na configuração do
// perfil E com a permissão da área.
export function blocosVisiveisTelaInicial(config, possuiPermissao) {
  const catalogo = new Map(BLOCOS_TELA_INICIAL.map((bloco) => [bloco.id, bloco]));
  const blocos = Array.isArray(config?.blocos) && config.blocos.length ? config.blocos : configTelaInicialPadrao().blocos;
  return blocos
    .filter((item) => item?.visivel && catalogo.has(item.id))
    .map((item) => catalogo.get(item.id))
    .filter((bloco) => !bloco.permissao || possuiPermissao(bloco.permissao));
}
