// Registro dos módulos do Conecta (core, rh, operacao, tecnologia) — dados e regras PURAS (sem DOM, sem React),
// para poderem ser testadas em Node. O estado em tempo de execução fica em ./estado.js.
//
// Regras (docs/modularizacao/PLANO.md):
//  * O backend decide quais módulos o usuário enxerga (GET /core/acesso); aqui só se organiza o menu.
//  * Telas existentes de RH e Monitoria NÃO mudam de lugar: este registro só diz a que módulo cada grupo do menu pertence.
//  * Se o acesso por módulo ainda não carregou (ou falhou), o menu se comporta exatamente como antes (sem filtro).

export const MODULO_CORE = 'core';
export const MODULO_RH = 'rh';
export const MODULO_OPERACAO = 'operacao';
export const MODULO_TECNOLOGIA = 'tecnologia';

export const NOMES_MODULOS = {
  [MODULO_CORE]: 'Conecta',
  [MODULO_RH]: 'RH',
  [MODULO_OPERACAO]: 'Operação',
  [MODULO_TECNOLOGIA]: 'Tecnologia',
};

// Grupos do menu superior do RH/Operação (ver BarraLateral em ui/components/layout.js) -> módulo.
// `core` aparece em todos os módulos, exceto Tecnologia (que é 100% administração).
export const MODULO_DO_GRUPO = {
  inicio: MODULO_CORE,
  'cx-curriculos': MODULO_RH,
  processos: MODULO_RH,
  provas: MODULO_RH,
  gestao: MODULO_RH,
  drive: MODULO_RH,
  treinamentos: MODULO_CORE,
  monitoria: MODULO_OPERACAO,
  wfm: MODULO_OPERACAO,
};

// Itens do grupo "Configurações" -> módulo. Em Tecnologia aparecem todos; em RH/Operação só os do próprio módulo.
export const MODULO_DA_TELA_CONFIGURACAO = {
  'screen-settings-monitoria': MODULO_OPERACAO,
  'screen-settings-monitoria-equipes': MODULO_OPERACAO,
  'screen-wfm-auditoria': MODULO_OPERACAO,
  'screen-settings-etapas': MODULO_RH,
  'screen-settings-motivos-eliminacao': MODULO_RH,
  'screen-settings-modelos-email': MODULO_RH,
  'screen-settings-lgpd': MODULO_RH,
  'screen-settings-document-templates': MODULO_RH,
  'screen-settings-users': MODULO_TECNOLOGIA,
  'screen-settings-profiles': MODULO_TECNOLOGIA,
  'screen-settings-operations': MODULO_TECNOLOGIA,
  'screen-settings-logs': MODULO_TECNOLOGIA,
  'screen-settings-administracao': MODULO_TECNOLOGIA,
};

// Operação interna da equipe de TI: a tela "Escalas e Plantões" emprestada do WFM é filtrada por ela em Tecnologia.
export const OPERACAO_BASE_TI = 'TI';

export const TELA_INICIO_TECNOLOGIA = 'screen-tecnologia';
export const TELA_MODULOS_TECNOLOGIA = 'screen-tecnologia-modulos';
export const TELAS_TECNOLOGIA = [TELA_INICIO_TECNOLOGIA, TELA_MODULOS_TECNOLOGIA];
// Suporte TI (Chamados): item do menu de Tecnologia; quem só abre/acompanha chamados (ex.: Supervisor) cai aqui ao entrar no módulo.
export const TELA_SUPORTE_TI = 'screen-chamados';
export const TELAS_SUPORTE_TI = ['screen-chamados', 'screen-chamados-fila', 'screen-chamados-dashboard', 'screen-chamados-config'];

// Telas do WFM, na ordem em que o módulo Tecnologia escolhe a primeira que o usuário pode abrir (mesma ordem do WFM).
export const TELAS_WFM_DA_TI = ['screen-wfm', 'screen-wfm-minha-escala', 'screen-wfm-trocas', 'screen-wfm-presenca', 'screen-wfm-relatorios'];

// Menu do módulo Tecnologia (wireframe aprovado): Início · Acessos ▾ · Sistema ▾ · Auditoria ▾ · Escalas e Plantões (do WFM).
export const MENU_TECNOLOGIA = [
  { id: 'inicio', tipo: 'item', tela: TELA_INICIO_TECNOLOGIA, label: 'Início', icone: 'home' },
  { id: 'suporte', tipo: 'suporte', label: 'Suporte TI', icone: 'support_agent' },
  {
    id: 'acessos',
    tipo: 'grupo',
    label: 'Acessos',
    icone: 'manage_accounts',
    itens: [
      { tela: 'screen-settings-users', label: 'Usuários', icone: 'person', permissao: 'usuarios.visualizar' },
      { tela: 'screen-settings-profiles', label: 'Perfis e permissões', icone: 'admin_panel_settings', permissao: 'configuracoes.visualizar' },
      { tela: 'screen-settings-operations', label: 'Operações', icone: 'apartment', permissao: 'configuracoes.visualizar' },
    ],
  },
  {
    id: 'sistema',
    tipo: 'grupo',
    label: 'Sistema',
    icone: 'settings',
    itens: [
      { tela: TELA_MODULOS_TECNOLOGIA, label: 'Módulos', icone: 'grid_view', permissao: 'configuracoes.visualizar' },
      { tela: 'screen-settings-administracao', label: 'Parâmetros e integrações', icone: 'verified_user', permissao: 'configuracoes.visualizar' },
      { tela: 'screen-settings-etapas', label: 'Etapas do Processo', icone: 'checklist', permissao: 'configuracoes.visualizar' },
      { tela: 'screen-settings-motivos-eliminacao', label: 'Motivos de Eliminação', icone: 'person_remove', permissao: 'configuracoes.visualizar' },
      { tela: 'screen-settings-modelos-email', label: 'Modelos de E-mail', icone: 'mail', permissao: 'configuracoes.visualizar' },
      { tela: 'screen-settings-lgpd', label: 'LGPD e Retenção', icone: 'shield_lock', permissao: 'lgpd.visualizar' },
      { tela: 'screen-settings-document-templates', label: 'Central de Ajuda', icone: 'help', permissao: 'documentos_templates.editar' },
    ],
  },
  {
    id: 'auditoria',
    tipo: 'grupo',
    label: 'Auditoria',
    icone: 'history_edu',
    itens: [
      { tela: 'screen-settings-logs', label: 'Logs', icone: 'history_edu', permissao: 'logs.visualizar' },
      { tela: 'screen-wfm-auditoria', label: 'Auditoria de Plantões', icone: 'history', permissao: 'wfm.auditoria' },
    ],
  },
  { id: 'escalas', tipo: 'wfm', label: 'Escalas e Plantões', icone: 'calendar_month' },
];

/** O grupo legado do menu (processos, monitoria...) aparece no módulo atual? Sem módulo carregado: sim (comportamento de antes). */
export function grupoNoModulo(grupo, moduloAtual, carregado) {
  if (!carregado || !moduloAtual) return true;
  if (moduloAtual === MODULO_TECNOLOGIA) return false;
  const dono = MODULO_DO_GRUPO[grupo];
  return !dono || dono === MODULO_CORE || dono === moduloAtual;
}

/** Item do grupo Configurações visível no módulo atual? */
export function itemConfiguracaoNoModulo(tela, moduloAtual, carregado) {
  if (!carregado || !moduloAtual) return true;
  const dono = MODULO_DA_TELA_CONFIGURACAO[tela];
  return !dono || dono === moduloAtual;
}

/** Primeira tela de WFM que o usuário pode abrir (para o item "Escalas e Plantões" de Tecnologia), ou '' se nenhuma. */
export function telaWfmParaTecnologia(podeAcessarTela) {
  return TELAS_WFM_DA_TI.find((tela) => podeAcessarTela(tela)) || '';
}

/** Monta o menu de Tecnologia já filtrado pelo que o usuário pode abrir. Grupos sem item visível somem. */
export function montarMenuTecnologia(podeAcessarTela, possuiPermissao) {
  const itemVisivel = (item) => podeAcessarTela(item.tela) && (!item.permissao || possuiPermissao(item.permissao));
  return MENU_TECNOLOGIA.flatMap((entrada) => {
    if (entrada.tipo === 'item') return podeAcessarTela(entrada.tela) ? [entrada] : [];
    if (entrada.tipo === 'suporte') {
      // A porta de entrada é a primeira aba do Suporte TI que a pessoa pode abrir (Chamados, Fila, Dashboard ou Configurações).
      const tela = TELAS_SUPORTE_TI.find((t) => podeAcessarTela(t));
      return tela ? [{ ...entrada, tela }] : [];
    }
    if (entrada.tipo === 'wfm') {
      const tela = telaWfmParaTecnologia(podeAcessarTela);
      return tela ? [{ ...entrada, tela }] : [];
    }
    const itens = entrada.itens.filter(itemVisivel);
    return itens.length ? [{ ...entrada, itens }] : [];
  });
}

/** Tela inicial de cada módulo (o seletor leva para ela). */
export function telaInicialDoModulo(modulo, podeAcessarTela) {
  if (modulo === MODULO_TECNOLOGIA) {
    if (podeAcessarTela(TELA_INICIO_TECNOLOGIA)) return TELA_INICIO_TECNOLOGIA;
    return TELAS_SUPORTE_TI.find((t) => podeAcessarTela(t)) || TELA_INICIO_TECNOLOGIA;
  }
  if (modulo === MODULO_OPERACAO) {
    const ordem = ['screen-monitoria-minhas', 'screen-monitoria-dashboard', 'screen-monitoria', 'screen-monitoria-nova', ...TELAS_WFM_DA_TI];
    return ordem.find((tela) => podeAcessarTela(tela)) || 'screen-menu';
  }
  return 'screen-menu';
}

/** Em Tecnologia, a tela do WFM só mostra a operação da TI; nos demais módulos, nenhum filtro. */
export function operacaoBaseDoModulo(moduloAtual, carregado = true) {
  return carregado && moduloAtual === MODULO_TECNOLOGIA ? OPERACAO_BASE_TI : '';
}

/** `TI::SOBREAVISO` -> `TI` (mesma regra de wfm_scope.operacao_base no backend). */
export function operacaoBase(chave) {
  return String(chave || '').split('::', 1)[0];
}

export function filtrarPorOperacaoBase(lista, base, campo = 'chave') {
  if (!base || !Array.isArray(lista)) return lista;
  return lista.filter((item) => operacaoBase(item?.[campo]).toUpperCase() === base.toUpperCase());
}

/** Escolhe o módulo atual: o último usado (se ainda visível) ou o padrão. */
export function escolherModuloAtual(visiveis, salvo, padrao) {
  if (salvo && visiveis.includes(salvo)) return salvo;
  if (padrao && (visiveis.includes(padrao) || padrao === MODULO_CORE)) return padrao;
  return visiveis[0] || MODULO_CORE;
}
