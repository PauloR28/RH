// Tela inicial configurável por perfil (espelha apps/backend/rh_api/services/tela_inicial.py).
// A configuração do perfil só ESCONDE ou reordena blocos: cada bloco continua
// exigindo a permissão da área (quem não acessa a Caixa de CV não vê o bloco).
import { useEffect, useState } from '../infraestrutura-react.js?v=20261125-acessos-perfil';
import { lerSessaoAutenticacao, requisitar } from '../services/api/core.js?v=20261125-acessos-perfil';

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

// Início por módulo (reestruturação, Etapa 8 — amostra aprovada em 17/nov/2026). RH = blocos acima.
export const MODULOS_INICIO = [['rh', 'RH'], ['operacao', 'Operação'], ['tecnologia', 'Tecnologia']];
export const BLOCOS_POR_MODULO = {
  rh: BLOCOS_TELA_INICIAL,
  operacao: [
    { id: 'atalhos', label: 'Acessos rápidos', permissao: null },
    { id: 'escala_hoje', label: 'Escala de hoje', permissao: null },
    { id: 'precisa_de_voce', label: 'Precisa de você (pendências)', permissao: null },
    { id: 'suas_operacoes', label: 'Suas operações (só quem vê mais de uma)', permissao: null },
  ],
  tecnologia: [
    { id: 'resumo', label: 'Números (módulos e usuários)', permissao: null },
    { id: 'situacao', label: 'Situação do sistema (backup e inatividade)', permissao: 'configuracoes.visualizar' },
    { id: 'atalhos', label: 'Acessos rápidos', permissao: null },
  ],
};
// Atalhos que cada módulo pode mostrar no Início (o RH usa atalhosDoInicioPorPerfil, mais abaixo).
export const ATALHOS_POR_MODULO = {
  operacao: [
    { id: 'monitoria', label: 'Monitoria' },
    { id: 'wfm', label: 'Turnos e Plantões' },
    { id: 'diario', label: 'Diário de bordo' },
    { id: 'equipe', label: 'Equipes' },
  ],
  tecnologia: [
    { id: 'screen-settings-users', label: 'Usuários' },
    { id: 'screen-settings-acessos', label: 'Acessos' },
    { id: 'screen-settings-operations', label: 'Operação' },
    { id: 'screen-settings-conecta', label: 'Configurações do Conecta' },
    { id: 'screen-settings-lgpd', label: 'LGPD e retenção' },
    { id: 'screen-settings-logs', label: 'Auditoria' },
    { id: 'wfm', label: 'Escalas e Plantões (TI)' },
  ],
};

export function configTelaInicialPadrao(modulo = 'rh') {
  if (modulo !== 'rh') return { blocos: BLOCOS_POR_MODULO[modulo].map((bloco) => ({ id: bloco.id, visivel: true })), atalhos_ocultos: [] };
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

export async function salvarTelaInicialPerfil(idPerfil, blocos, atalhosOcultos = [], modulo = 'rh') {
  return requisitar(`/settings/tela-inicial/${encodeURIComponent(idPerfil)}?modulo=${encodeURIComponent(modulo)}`, {
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

// Atalhos que o Início do perfil mostra hoje (mesmo recorte de inicio-operador.js e inicio-operacao.js),
// limitados às sessões liberadas para o perfil.
export function atalhosDoInicioPorPerfil(perfilId, permissoes = []) {
  const liberada = (sessao) => permissoes.includes(`sessao.${sessao}.acessar`);
  let lista = ATALHOS_SESSOES;
  if (perfilId === 'operador') lista = [...ATALHOS_FIXOS_OPERADOR, ...ATALHOS_SESSOES.filter((a) => !['wfm', 'monitoria'].includes(a.id))];
  else if (perfilId === 'supervisor') lista = ATALHOS_SESSOES.filter((a) => a.id !== 'treinamentos');
  return lista.filter((a) => liberada(a.sessao));
}

// Configuração do Início do perfil logado, lida uma vez por login (a tela pode abrir várias vezes).
let minhaConfig = { token: '', promessa: null };
function lerMinhaConfigUmaVez() {
  const token = lerSessaoAutenticacao()?.token || '';
  if (!minhaConfig.promessa || minhaConfig.token !== token) {
    const promessa = lerMinhaTelaInicial().catch((erro) => { minhaConfig = { token: '', promessa: null }; throw erro; });
    minhaConfig = { token, promessa };
  }
  return minhaConfig.promessa;
}

// Ids dos atalhos escondidos no Início do perfil logado (Set). Sem resposta do servidor, nada fica escondido.
// Módulo ainda não configurado em Início dos módulos: valem os atalhos escondidos no formato antigo (RH).
const ocultosDoModulo = (cfg, modulo) => {
  const parte = modulo !== 'rh' ? cfg?.modulos?.[modulo] : null;
  return (parte?.personalizado ? parte.atalhos_ocultos : cfg?.atalhos_ocultos) || [];
};
export function useAtalhosOcultos(modulo = 'rh') {
  const [ocultos, setOcultos] = useState(() => new Set());
  useEffect(() => {
    let ativo = true;
    lerMinhaConfigUmaVez()
      .then((cfg) => { if (ativo) setOcultos(new Set(ocultosDoModulo(cfg, modulo))); })
      .catch(() => {});
    return () => { ativo = false; };
  }, [modulo]);
  return ocultos;
}

// Blocos ligados no Início de um módulo do perfil logado ({ blocos: [ids na ordem], atalhosOcultos: Set }). null = carregando.
// Sem resposta do servidor, vale o padrão (tudo ligado).
export function useInicioDoModulo(modulo) {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let ativo = true;
    const aplicar = (cfg) => {
      const parte = cfg?.modulos?.[modulo] || configTelaInicialPadrao(modulo);
      const validos = new Set(BLOCOS_POR_MODULO[modulo].map((b) => b.id));
      if (ativo) setConfig({ blocos: (parte.blocos || []).filter((b) => b.visivel && validos.has(b.id)).map((b) => b.id), atalhosOcultos: new Set(ocultosDoModulo(cfg, modulo)) });
    };
    lerMinhaConfigUmaVez().then(aplicar, () => aplicar(null));
    return () => { ativo = false; };
  }, [modulo]);
  return config;
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
