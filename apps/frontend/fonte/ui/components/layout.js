import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { BuscaGlobalTopbar } from '../busca-global.js';
import { obterTourDaTela } from '../../shared/tour-config.js';
import { BotaoAjudaTour, TourGuiado, orientacoesAtivas } from '../tour-guiado.js';
import { definirTema, obterTemaSalvo, proximoTema } from '../../shared/tema.js';
import { resolverAvatarUrl } from '../../shared/avatares.js';
import { CATEGORIAS_NOTIFICACAO, useResumoNotificacoes } from '../../shared/notificacoes.js';

const TEMA_ROTULO = { claro: 'Claro', escuro: 'Escuro' };
const TEMA_ICONE = { claro: 'light_mode', escuro: 'dark_mode' };

function SeletorTema() {
  const [tema, setTema] = useState(() => obterTemaSalvo());

  const alternar = () => {
    const novoTema = definirTema(proximoTema(tema));
    setTema(novoTema);
  };

  return html`
    <button
      type="button"
      class="c24-icon-btn c24-theme-toggle"
      title=${`Tema: ${TEMA_ROTULO[tema]}. Clique para alternar.`}
      aria-label=${`Alternar tema. Tema atual: ${TEMA_ROTULO[tema]}.`}
      onClick=${alternar}
    >
      <span class="material-symbols-outlined c24-icon">${TEMA_ICONE[tema]}</span>
    </button>
  `;
}

export function BarraLateral({
  navAtiva,
  controlador,
  subtituloMarca = 'Plataforma de Recrutamento e Seleção',
  mostrarAtalhos = true,
  recolhida = false,
  onOpenHelp = null,
  mostrarAjuda = false,
}) {
  const itensPrincipais = [
    { tela: 'screen-menu', icone: 'home', label: 'Início' },
    {
      tela: 'screen-email-inbox',
      icone: 'mail',
      label: 'E-mails',
      permissao: 'candidatos.criar',
    },
  ];
  const sublinksProcessos = [
    {
      tela: 'screen-processes',
      icone: 'view_list',
      label: 'Processos Seletivos',
      permissao: 'vagas.visualizar',
    },
    {
      tela: 'screen-processes-closed',
      icone: 'radio_button_checked',
      label: 'Processos encerrados',
      status: 'is-closed',
      permissao: 'vagas.visualizar',
    },
    {
      tela: 'screen-process-decisions',
      icone: 'fact_check',
      label: 'Decisões Pendentes',
      permissao: 'vagas.visualizar',
    },
    {
      tela: 'screen-interviews',
      icone: 'event_available',
      label: 'Entrevistas',
      permissao: 'entrevistas.visualizar',
    },
    {
      tela: 'screen-talent-bank',
      icone: 'group',
      label: 'Banco de Talentos',
      permissao: 'candidatos.visualizar',
    },
  ];
  const sublinksProvas = [
    {
      tela: 'screen-generated-exams',
      icone: 'assignment',
      label: 'Provas e Resultados',
      permissao: 'provas.visualizar',
    },
    {
      tela: 'screen-history',
      icone: 'history',
      label: 'Histórico de Provas',
      permissao: 'candidatos.consultar_historico',
    },
    {
      tela: 'screen-provas-configuracao',
      icone: 'tune',
      label: 'Configuração',
      permissao: 'configuracoes.visualizar',
    },
  ];
  const sublinksTreinamentos = [
    {
      tela: 'screen-training-trilhas',
      icone: 'school',
      label: 'Trilhas',
      permissao: 'onboarding.visualizar',
    },
    {
      tela: 'screen-training-assignments',
      icone: 'assignment_ind',
      label: 'Atribuições',
      permissao: 'onboarding.visualizar',
    },
  ];
  const sublinksGestao = [
    {
      tela: 'screen-analysis-candidates',
      icone: 'bar_chart',
      label: 'Relatórios Gerais',
      permissao: 'relatorios.visualizar',
    },
    {
      tela: 'screen-dashboard-funil',
      icone: 'monitoring',
      label: 'Dashboard de Funil',
      permissao: 'relatorios.visualizar',
    },
    {
      tela: 'screen-candidates',
      icone: 'groups',
      label: 'Candidatos',
      permissao: 'candidatos.visualizar',
      telasRelacionadas: ['screen-candidate-details', 'screen-candidate-pipeline'],
    },
    {
      tela: 'screen-calendario',
      icone: 'celebration',
      label: 'Calendário',
    },
  ];
  const itensDriveConecta = [
    {
      tela: 'screen-onedrive-files',
      icone: 'cloud',
      label: 'Drive-Conecta',
      permissao: 'onedrive.visualizar',
    },
  ];
  const sublinksConfiguracoes = [
    {
      tela: 'screen-settings-users',
      icone: 'person',
      label: 'Usuários',
      permissao: 'usuarios.visualizar',
    },
    {
      tela: 'screen-settings-profiles',
      icone: 'admin_panel_settings',
      label: 'Perfis e permissões',
      permissao: 'configuracoes.visualizar',
    },
    {
      tela: 'screen-settings-operations',
      icone: 'apartment',
      label: 'Operações',
      permissao: 'configuracoes.visualizar',
    },
    {
      tela: 'screen-settings-catalog',
      icone: 'inventory_2',
      label: 'Catálogos',
      permissao: 'configuracoes.visualizar',
    },
    {
      tela: 'screen-settings-logs',
      icone: 'history_edu',
      label: 'Logs',
      permissao: 'logs.visualizar',
    },
    {
      tela: 'screen-settings-policies',
      icone: 'policy',
      label: 'Políticas',
      permissao: 'politicas.editar',
    },
    {
      tela: 'screen-settings-document-templates',
      icone: 'description',
      label: 'Templates de Documentos',
      permissao: 'documentos_templates.editar',
    },
    {
      tela: 'screen-settings-administracao',
      icone: 'verified_user',
      label: 'Administração',
      permissao: 'configuracoes.visualizar',
    },
  ];
  const telasRelacionadasProcessos = [
    'screen-process-create',
    'screen-processes',
    'screen-processes-closed',
    'screen-process-decisions',
    'screen-process-details',
    'screen-process-analytical-results',
    'screen-interviews',
    'screen-talent-bank',
  ];
  const telasRelacionadasProvas = [
    'screen-generated-exams',
    'screen-history',
    'screen-provas-configuracao',
    'screen-settings-onboarding',
    'screen-settings-disc',
    'screen-settings-fit-cultural',
    'screen-settings-raciocinio-logico',
  ];
  const telasRelacionadasTreinamentos = [
    'screen-training',
    'screen-training-trilhas',
    'screen-training-assignments',
  ];
  const telasRelacionadasGestao = [
    'screen-analysis-candidates',
    'screen-dashboard-funil',
    'screen-candidates',
    'screen-candidate-details',
    'screen-candidate-pipeline',
    'screen-calendario',
  ];
  const telasRelacionadasConfiguracoes = [
    'screen-settings',
    'screen-settings-users',
    'screen-settings-profiles',
    'screen-settings-operations',
    'screen-settings-catalog',
    'screen-settings-logs',
    'screen-settings-policies',
    'screen-settings-document-templates',
    'screen-settings-administracao',
  ];
  const possuiPermissao = (permissao) =>
    !permissao || controlador?.possuiPermissao?.(permissao);
  const itemAtivo = (item) =>
    navAtiva === item.tela || (item.telasRelacionadas || []).includes(navAtiva);
  const grupoProcessosAtivo = telasRelacionadasProcessos.includes(navAtiva);
  const sublinksProcessosVisiveis = sublinksProcessos.filter((subitem) =>
    possuiPermissao(subitem.permissao),
  );
  const grupoProvasAtivo = telasRelacionadasProvas.includes(navAtiva);
  const subitemProvaAtivo = (subitem) => navAtiva === subitem.tela;
  const sublinksProvasVisiveis = sublinksProvas.filter((subitem) =>
    possuiPermissao(subitem.permissao),
  );
  const sublinksConfiguracoesVisiveis = sublinksConfiguracoes.filter((subitem) =>
    possuiPermissao(subitem.permissao),
  );
  const sublinksGestaoVisiveis = sublinksGestao.filter((subitem) =>
    possuiPermissao(subitem.permissao),
  );
  const grupoGestaoAtivo = telasRelacionadasGestao.includes(navAtiva);
  const subitemGestaoAtivo = (subitem) =>
    navAtiva === subitem.tela || (subitem.telasRelacionadas || []).includes(navAtiva);
  const grupoConfiguracoesAtivo = telasRelacionadasConfiguracoes.includes(navAtiva);
  const subitemConfiguracaoAtivo = (subitem) =>
    navAtiva === subitem.tela ||
    (navAtiva === 'screen-settings' && subitem.tela === 'screen-settings-users');
  const sublinksTreinamentosVisiveis = sublinksTreinamentos.filter((subitem) =>
    possuiPermissao(subitem.permissao),
  );
  const grupoTreinamentosAtivo = telasRelacionadasTreinamentos.includes(navAtiva);
  const subitemTreinamentoAtivo = (subitem) =>
    navAtiva === subitem.tela ||
    (navAtiva === 'screen-training' && subitem.tela === 'screen-training-trilhas');
  const [logoComErro, setLogoComErro] = useState(false);

  const renderizarItem = (item) => {
    if (item.visivel === false || !possuiPermissao(item.permissao)) return null;
    const ativo = itemAtivo(item) && !item.acao;
    return html`
      <button
        key=${item.label}
        type="button"
        class=${`rh-modern-nav-btn ${ativo ? 'is-active' : ''}`.trim()}
        title=${item.label}
        aria-current=${ativo ? 'page' : null}
        onClick=${item.acao || (() => controlador.irParaTelaProtegida(item.tela))}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          ${item.icone}
        </span>
        <span class="rh-modern-nav-label">${item.label}</span>
      </button>
    `;
  };

  // Grupos com submenu: no novo design (docs/Desing/Tela Web - Estilo
  // Submenu.png) o submenu é um painel fixo em segunda coluna, não mais um
  // acordeão que empurra os itens abaixo. Clicar no grupo navega para o
  // primeiro subitem e o painel some assim que a tela ativa deixa de
  // pertencer ao grupo.
  const grupos = [
    {
      id: 'processos',
      label: 'Processos',
      icone: 'business_center',
      ativo: grupoProcessosAtivo,
      sublinks: sublinksProcessosVisiveis,
      subitemAtivo: itemAtivo,
    },
    {
      id: 'provas',
      label: 'Conecta Provas',
      icone: 'quiz',
      ativo: grupoProvasAtivo,
      sublinks: sublinksProvasVisiveis,
      subitemAtivo: subitemProvaAtivo,
    },
    {
      id: 'gestao',
      label: 'Gestão',
      icone: 'manage_accounts',
      ativo: grupoGestaoAtivo,
      sublinks: sublinksGestaoVisiveis,
      subitemAtivo: subitemGestaoAtivo,
    },
    {
      id: 'treinamentos',
      label: 'Treinamentos',
      icone: 'school',
      ativo: grupoTreinamentosAtivo,
      sublinks: sublinksTreinamentosVisiveis,
      subitemAtivo: subitemTreinamentoAtivo,
    },
    {
      id: 'configuracoes',
      label: 'Configurações',
      icone: 'settings',
      ativo: grupoConfiguracoesAtivo,
      sublinks: sublinksConfiguracoesVisiveis,
      subitemAtivo: subitemConfiguracaoAtivo,
    },
  ];
  const grupoAberto = !recolhida
    ? grupos.find((grupo) => grupo.ativo && grupo.sublinks.length)
    : null;

  const renderizarGrupo = (grupo) => {
    if (!grupo.sublinks.length) return null;
    return html`
      <button
        key=${grupo.id}
        type="button"
        class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupo.ativo ? 'is-active' : ''}`.trim()}
        title=${grupo.label}
        aria-current=${grupo.ativo ? 'page' : null}
        aria-expanded=${grupo.ativo && !recolhida}
        aria-controls=${`rh-modern-subnav-panel-${grupo.id}`}
        onClick=${() => controlador.irParaTelaProtegida(grupo.sublinks[0]?.tela)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          ${grupo.icone}
        </span>
        <span class="rh-modern-nav-label">${grupo.label}</span>
        <span class="material-symbols-outlined rh-modern-nav-chevron" aria-hidden="true">
          chevron_right
        </span>
      </button>
    `;
  };

  return html`
    <div class="rh-modern-nav-wrap" style=${{ display: 'contents' }}>
    <aside
      class=${`rh-modern-sidebar ${recolhida ? 'is-collapsed' : ''}`.trim()}
      data-tour-id="layout-sidebar"
    >
      <div class="rh-modern-sidebar-brand">
        <button
          type="button"
          class="rh-modern-logo-btn"
          aria-label="Voltar ao painel principal"
          onClick=${() => controlador.irParaMenu()}
          title=${subtituloMarca || 'Conecta'}
        >
          ${logoComErro
      ? html`
                <span class="rh-modern-logo-fallback">
                  <strong>Conecta</strong>
                  <span>Central 24h</span>
                </span>
              `
      : html`
                <img
                  alt="Conecta Central 24h"
                  class="rh-modern-logo"
                  src="/estilos/logo_conecta_branco_palavra.png"
                  onError=${() => setLogoComErro(true)}
                />
              `}
        </button>
      </div>

      <nav class="rh-modern-nav">
        <button
          type="button"
          class="rh-modern-nav-btn rh-modern-sidebar-toggle"
          aria-label=${recolhida ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          title=${recolhida ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          onClick=${() => controlador.alternarBarraLateral()}
        >
          <span class="material-symbols-outlined">
            ${recolhida ? 'chevron_right' : 'chevron_left'}
          </span>
          <span class="rh-modern-nav-label">${recolhida ? 'Expandir' : 'Recolher'}</span>
        </button>
        ${itensPrincipais.map(renderizarItem)}
        ${renderizarGrupo(grupos[0])}
        ${renderizarGrupo(grupos[1])}
        ${renderizarGrupo(grupos[2])}
        ${itensDriveConecta.map(renderizarItem)}
        ${renderizarGrupo(grupos[3])}
        ${renderizarGrupo(grupos[4])}
      </nav>
    </aside>

    ${grupoAberto
      ? html`
            <aside
              class="rh-modern-subnav-panel"
              id=${`rh-modern-subnav-panel-${grupoAberto.id}`}
              aria-label=${`Submenu de ${grupoAberto.label}`}
            >
              <div class="rh-modern-subnav-panel-title">${grupoAberto.label}</div>
              <nav class="rh-modern-subnav-panel-list" role="group">
                ${grupoAberto.sublinks.map(
        (subitem) => html`
                    <button
                      key=${subitem.tela}
                      type="button"
                      class=${`rh-modern-subnav-panel-btn ${grupoAberto.subitemAtivo(subitem) ? 'is-active' : ''
              } ${subitem.status || ''}`.trim()}
                      title=${subitem.label}
                      aria-current=${grupoAberto.subitemAtivo(subitem) ? 'page' : null}
                      onClick=${() => controlador.irParaTelaProtegida(subitem.tela)}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">
                        ${subitem.icone}
                      </span>
                      <span>${subitem.label}</span>
                    </button>
                  `,
      )}
              </nav>
            </aside>
          `
      : null}
    </div>
  `;
}

export function PageIntro({
  kicker,
  title,
  description,
  actions = null,
  tourId = 'page-intro',
}) {
  return html`
    <section class="rh-page-intro" data-tour-id=${tourId || null}>
      <div>
        ${kicker ? html`<p class="rh-modern-kicker">${kicker}</p>` : null}
        <h2 class="rh-modern-title">${title}</h2>
        ${description
      ? html`<p class="rh-modern-description">${description}</p>`
      : null}
      </div>
      ${actions
      ? html`<div class="rh-page-intro-actions">${actions}</div>`
      : null}
    </section>
  `;
}

export function SectionCard({
  title,
  description,
  actions = null,
  className = '',
  tourId = '',
  children,
}) {
  return html`
    <section
      class=${`rh-section-card ${className}`.trim()}
      data-tour-id=${tourId || null}
    >
      ${title || description || actions
      ? html`
            <header class="rh-section-card-header">
              <div>
                ${title ? html`<h3>${title}</h3>` : null}
                ${description
          ? html`<p class="rh-section-card-description">
                      ${description}
                    </p>`
          : null}
              </div>
              ${actions}
            </header>
          `
      : null}
      ${children}
    </section>
  `;
}

export function Tabs({ tabs = [], activeKey, onChange, className = '' }) {
  return html`
    <div class=${`rh-tabs ${className}`.trim()} role="tablist">
      ${tabs.map(
        (tab) => html`
          <button
            key=${tab.key}
            type="button"
            role="tab"
            id=${`rh-tab-${tab.key}`}
            aria-selected=${activeKey === tab.key}
            aria-controls=${`rh-tabpanel-${tab.key}`}
            class=${`rh-tabs-btn ${activeKey === tab.key ? 'is-active' : ''}`.trim()}
            onClick=${() => onChange(tab.key)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

export function TabPanel({ tabKey, activeKey, className = '', children }) {
  const ativo = activeKey === tabKey;
  return html`
    <div
      id=${`rh-tabpanel-${tabKey}`}
      role="tabpanel"
      aria-labelledby=${`rh-tab-${tabKey}`}
      aria-hidden=${!ativo}
      class=${`rh-tab-panel ${className}`.trim()}
      style=${{ display: ativo ? 'block' : 'none' }}
    >
      ${children}
    </div>
  `;
}

function obterIniciaisUsuario(nome) {
  const partes = String(nome || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!partes.length) return 'RH';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();

  return `${partes[0].slice(0, 1)}${partes[partes.length - 1].slice(0, 1)}`.toUpperCase();
}

export function AvatarUsuario({ avatar = '', nome = '', tamanho = 40 }) {
  const estilo = { width: `${tamanho}px`, height: `${tamanho}px`, fontSize: `${Math.round(tamanho * 0.4)}px` };
  return html`
    <span class="c24-user-avatar" style=${estilo}>
      ${avatar
      ? html`<img src=${avatar} alt="" />`
      : html`<span>${obterIniciaisUsuario(nome)}</span>`}
    </span>
  `;
}

export function CartaoUsuarioTopo({ controlador }) {
  const [aberto, setAberto] = useState(false);
  const estado = controlador?.estado || {};
  const nome =
    estado.nomeUsuarioAutenticado ||
    estado.usuarioAutenticado ||
    'Usuário RH';
  const perfilBase =
    estado.perfilUsuarioNome ||
    estado.perfilUsuario ||
    estado.nivelPerfilUsuario ||
    'Usuário';
  const perfil = String(perfilBase).includes('/')
    ? perfilBase
    : `RH / ${perfilBase}`;
  const avatar = resolverAvatarUrl(estado.avatarUsuario);
  const podeAbrirPerfil =
    controlador?.possuiPermissao?.('configuracoes.visualizar') ||
    controlador?.podeAcessarTela?.('screen-settings');

  useEffect(() => {
    if (!aberto) return undefined;

    const fecharAoClicarFora = (event) => {
      if (event.target?.closest?.('.c24-user-menu-wrap')) return;
      setAberto(false);
    };
    const fecharNoEscape = (event) => {
      if (event.key === 'Escape') setAberto(false);
    };

    document.addEventListener('click', fecharAoClicarFora);
    document.addEventListener('keydown', fecharNoEscape);
    return () => {
      document.removeEventListener('click', fecharAoClicarFora);
      document.removeEventListener('keydown', fecharNoEscape);
    };
  }, [aberto]);

  return html`
    <div class="c24-user-menu-wrap">
      <button
        type="button"
        class="c24-user-menu"
        title="Perfil do usuário"
        aria-label=${`Abrir menu do perfil de ${nome}`}
        aria-haspopup="menu"
        aria-expanded=${aberto}
        onClick=${(event) => {
      event.stopPropagation();
      setAberto((valor) => !valor);
    }}
      >
        <span class="c24-user-avatar">
          ${avatar
      ? html`<img src=${avatar} alt="" />`
      : html`<span>${obterIniciaisUsuario(nome)}</span>`}
          <i aria-hidden="true"></i>
        </span>
        <span class="c24-user-copy">
          <strong>${nome}</strong>
          <small>${perfil}</small>
        </span>
        <span class="material-symbols-outlined c24-user-chevron">
          ${aberto ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      ${aberto
      ? html`
            <div class="c24-user-dropdown" role="menu">
              ${podeAbrirPerfil
          ? html`
                    <button
                      type="button"
                      role="menuitem"
                      class="c24-user-dropdown-item"
                      onClick=${() => {
              setAberto(false);
              controlador.irParaTelaProtegida('screen-settings');
            }}
                    >
                      <span class="material-symbols-outlined">settings</span>
                      Configurações de Perfil
                    </button>
                  `
          : null}
              <button
                type="button"
                role="menuitem"
                class="c24-user-dropdown-item"
                onClick=${() => {
          setAberto(false);
          controlador.irParaTelaProtegida('screen-settings-environment');
        }}
              >
                <span class="material-symbols-outlined">tune</span>
                Configurações de Ambiente
              </button>
              <button
                type="button"
                role="menuitem"
                class="c24-user-dropdown-item is-danger"
                onClick=${() => {
          setAberto(false);
          controlador.sair();
        }}
              >
                <span class="material-symbols-outlined">logout</span>
                Sair
              </button>
            </div>
          `
      : null}
    </div>
  `;
}

export function SinoNotificacoes({ controlador }) {
  const [aberto, setAberto] = useState(false);
  const { itens, carregando } = useResumoNotificacoes(controlador);
  const coresPorCategoria = CATEGORIAS_NOTIFICACAO.reduce(
    (mapa, categoria) => ({ ...mapa, [categoria.id]: categoria.cor }),
    {},
  );

  useEffect(() => {
    if (!aberto) return undefined;

    const fecharAoClicarFora = (event) => {
      if (event.target?.closest?.('.c24-notif-wrap')) return;
      setAberto(false);
    };
    const fecharNoEscape = (event) => {
      if (event.key === 'Escape') setAberto(false);
    };

    document.addEventListener('click', fecharAoClicarFora);
    document.addEventListener('keydown', fecharNoEscape);
    return () => {
      document.removeEventListener('click', fecharAoClicarFora);
      document.removeEventListener('keydown', fecharNoEscape);
    };
  }, [aberto]);

  return html`
    <div class="c24-notif-wrap">
      <button
        type="button"
        class="c24-icon-btn c24-notif-toggle"
        title="Notificações"
        aria-label=${`Notificações${itens.length ? `, ${itens.length} novas` : ''}`}
        aria-haspopup="menu"
        aria-expanded=${aberto}
        onClick=${(event) => {
          event.stopPropagation();
          setAberto((valor) => !valor);
        }}
      >
        <span class="material-symbols-outlined c24-icon">notifications</span>
        ${itens.length ? html`<span class="c24-notif-badge">${itens.length}</span>` : null}
      </button>

      ${aberto
        ? html`
            <div class="c24-notif-dropdown" role="menu">
              <header class="c24-notif-dropdown-header">Notificações</header>
              ${carregando
                ? html`<p class="c24-notif-empty">Carregando…</p>`
                : itens.length
                  ? html`
                      <ul class="c24-notif-list">
                        ${itens.map(
                          (item) => html`
                            <li key=${item.id} class="c24-notif-item">
                              <span
                                class="c24-notif-dot"
                                style=${{ backgroundColor: coresPorCategoria[item.categoria] || '#0f5be8' }}
                              ></span>
                              <span>${item.texto}</span>
                            </li>
                          `,
                        )}
                      </ul>
                    `
                  : html`<p class="c24-notif-empty">Nenhuma notificação por aqui.</p>`}
            </div>
          `
        : null}
    </div>
  `;
}

export function PainelRh({
  screenId,
  navAtiva,
  subtituloMarca,
  placeholderBusca,
  controlador,
  acaoPrimaria,
  acoesTopo = null,
  mostrarAtalhos = true,
  children,
}) {
  const sidebarRecolhida = !!controlador?.estado?.barraLateralRecolhida;
  const tour = obterTourDaTela(screenId, {
    hasPrimaryAction: Boolean(acaoPrimaria),
  });
  const [tourReopenSignal, setTourReopenSignal] = useState(0);
  const usuarioTour = controlador?.estado?.usuarioAutenticado || '';
  const permissaoAcaoPrimaria = acaoPrimaria?.permissao;
  const permissoesAcaoPrimaria = Array.isArray(acaoPrimaria?.permissoes)
    ? acaoPrimaria.permissoes
    : [];
  const mostrarAcaoPrimaria =
    acaoPrimaria &&
    (!permissaoAcaoPrimaria && !permissoesAcaoPrimaria.length
      ? true
      : permissoesAcaoPrimaria.length
        ? controlador?.possuiAlgumaPermissao?.(...permissoesAcaoPrimaria)
        : controlador?.possuiPermissao?.(permissaoAcaoPrimaria));
  const abrirTour = () => setTourReopenSignal((valor) => valor + 1);
  const ambiente = String(window.RUNTIME_CONFIG?.APP_ENV || '').toLowerCase();
  const exibirAmbiente = ambiente === 'dev' || ambiente === 'hml';

  return html`
    <section class="active screen" id=${screenId}>
      <div
        class=${`rh-modern-shell ${sidebarRecolhida ? 'is-sidebar-collapsed' : ''}`.trim()}
      >
        <${BarraLateral}
          navAtiva=${navAtiva}
          subtituloMarca=${subtituloMarca}
          controlador=${controlador}
          mostrarAtalhos=${mostrarAtalhos}
          recolhida=${sidebarRecolhida}
          onOpenHelp=${abrirTour}
          mostrarAjuda=${Boolean(tour?.steps?.length)}
        />

        <div class="rh-modern-main">
          <header class="rh-modern-topbar">
            <div class="rh-modern-topbar-left" data-tour-id="topbar-search">
              <${BuscaGlobalTopbar}
                placeholderBusca=${placeholderBusca}
                controlador=${controlador}
              />
            </div>
            <div class="rh-modern-topbar-actions">
              
              ${mostrarAcaoPrimaria
      ? html`
                    <button
                      type="button"
                      class="btn btn-primary rh-modern-primary-btn"
                      data-tour-id="topbar-primary-action"
                      onClick=${acaoPrimaria.onClick}
                    >
                      ${acaoPrimaria.icon
          ? html`<span class="material-symbols-outlined">${acaoPrimaria.icon}</span>`
          : null}
                      ${acaoPrimaria.label}
                    </button>
                  `
      : null}
              ${tour?.steps?.length && orientacoesAtivas()
      ? html`
                    <${BotaoAjudaTour}
                      compact=${true}
                      label="Ver orientações"
                      onClick=${abrirTour}
                    />
                  `
      : null}
              ${acoesTopo}
              <${SinoNotificacoes} controlador=${controlador} />
              <${SeletorTema} />
              <${CartaoUsuarioTopo} controlador=${controlador} />
            </div>
          </header>

          <main class="rh-modern-page">
            ${children}
            ${tour?.steps?.length && orientacoesAtivas()
      ? html`
                  <${TourGuiado}
                    screenId=${screenId}
                    userId=${usuarioTour}
                    steps=${tour.steps}
                    reopenSignal=${tourReopenSignal}
                  />
                `
      : null}
          </main>
        </div>
      </div>
    </section>
  `;
}
