// Tela inicial configurável por perfil (espelha apps/backend/rh_api/services/tela_inicial.py).
// A configuração do perfil só ESCONDE ou reordena blocos: cada bloco continua
// exigindo a permissão da área (quem não acessa a Caixa de CV não vê o bloco).
import { useEffect, useState } from '../infraestrutura-react.js';
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

export async function salvarTelaInicialPerfil(idPerfil, blocos, atalhosOcultos = []) {
  return requisitar(`/settings/tela-inicial/${encodeURIComponent(idPerfil)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocos, atalhos_ocultos: atalhosOcultos }),
  });
}

// Início por sessões (item 9 da lista de 10/11/2026, opção B): atalhos que o perfil pode
// esconder do Início. Esconder é só exibição: a pessoa continua abrindo a seção pelo menu.
// "sessao" = permissão de sessão que libera o atalho (espelha SESSOES em features/monitoria/index.js).
const ATALHOS_FIXOS_OPERADOR = [
  { id: 'minha-escala', label: 'Minha escala', sessao: 'wfm' },
  { id: 'trocas', label: 'Trocas', sessao: 'wfm' },
  { id: 'minhas-monitorias', label: 'Minhas monitorias', sessao: 'monitoria' },
];
const ATALHOS_SESSOES = [
  { id: 'curriculos', label: 'Caixa de Currículos' },
  { id: 'processos', label: 'Processos' },
  { id: 'provas', label: 'Provas' },
  { id: 'gestao', label: 'Gestão' },
  { id: 'drive', label: 'Drive' },
  { id: 'treinamentos', label: 'Central de Treinamento' },
  { id: 'monitoria', label: 'Monitorias' },
  { id: 'equipe', label: 'Equipes e Turnos' },
  { id: 'wfm', label: 'Turnos e Plantões' },
  { id: 'relatorios', label: 'Relatórios e Históricos' },
  { id: 'configuracoes', label: 'Configurações' },
].map((a) => ({ ...a, sessao: a.id }));

// Atalhos que o Início do perfil mostra hoje (mesmo recorte de inicio-operador.js e inicio-supervisor.js),
// limitados às sessões liberadas para o perfil.
export function atalhosDoInicioPorPerfil(perfilId, permissoes = []) {
  const liberada = (sessao) => permissoes.includes(`sessao.${sessao}.acessar`);
  let lista = ATALHOS_SESSOES;
  if (perfilId === 'operador') lista = [...ATALHOS_FIXOS_OPERADOR, ...ATALHOS_SESSOES.filter((a) => !['wfm', 'monitoria'].includes(a.id))];
  else if (perfilId === 'supervisor') lista = ATALHOS_SESSOES.filter((a) => a.id !== 'treinamentos');
  return lista.filter((a) => liberada(a.sessao));
}

// Ids dos atalhos escondidos no Início do perfil logado (Set). Sem resposta do servidor, nada fica escondido.
export function useAtalhosOcultos() {
  const [ocultos, setOcultos] = useState(() => new Set());
  useEffect(() => {
    let ativo = true;
    lerMinhaTelaInicial()
      .then((cfg) => { if (ativo) setOcultos(new Set(Array.isArray(cfg?.atalhos_ocultos) ? cfg.atalhos_ocultos : [])); })
      .catch(() => {});
    return () => { ativo = false; };
  }, []);
  return ocultos;
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
