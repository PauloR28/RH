import { createContext, html, useContext, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { BuscaGlobalTopbar } from '../busca-global.js';
import { obterTourDaTela } from '../../shared/tour-config.js';
import { TourGuiado, orientacoesAtivas } from '../tour-guiado.js';
import { definirTema, obterTemaSalvo, proximoTema } from '../../shared/tema.js';
import { resolverAvatarUrl } from '../../shared/avatares.js';
import { lerCoresNotificacao, useResumoNotificacoes } from '../../shared/notificacoes.js?v=20260921-alertas';
import { IconeSvg } from '../icone.js';
import { assinarTemaOperacao, obterLogoOperacao } from '../../shared/tema-operacao.js';

const TEMA_ROTULO = { claro: 'Claro', escuro: 'Escuro' };
const TEMA_ICONE = { claro: 'light_mode', escuro: 'dark_mode' };

// Correções.txt (rodada 3): a ação principal da tela (acaoPrimaria/acoesTopo,
// props de PainelRh) precisa aparecer dentro do PageIntro — título/descrição
// à esquerda, botões à direita, tudo numa linha só — mas PageIntro é chamado
// por cada tela dentro de `children`, fora do controle de PainelRh. Contexto
// evita ter que tocar as ~16 telas que usam PainelRh: PainelRh publica a ação
// principal, PageIntro lê e desenha no seu próprio slot de ações.
const AcoesPaginaContext = createContext(null);
// A busca global saiu da faixa de navegação (para o menu caber em uma linha)
// e fica centralizada na linha do PageIntro; PainelRh publica os dados dela.
const BuscaPaginaContext = createContext(null);

function BotaoVoltarGlobal() {
  return html`
    <button
      type="button"
      class="rh-global-back-btn"
      title="Voltar para a tela anterior"
      aria-label="Voltar para a tela anterior"
      onClick=${() => window.history.back()}
    >
      <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('arrow_back')}</span>
    </button>
  `;
}

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
      <span class="material-symbols-outlined c24-icon">${IconeSvg(TEMA_ICONE[tema])}</span>
    </button>
  `;
}

export function BarraLateral({
  navAtiva,
  controlador,
  subtituloMarca = 'Plataforma de Recrutamento e Seleção',
  placeholderBusca,
  mostrarAtalhos = true,
  recolhida = false,
  onOpenHelp = null,
  mostrarAjuda = false,
}) {
  const itensPrincipais = [
    { tela: 'screen-menu', icone: 'home', label: 'Início', permissao: 'inicio.visualizar' },
    {
      tela: 'screen-email-inbox',
      icone: 'mail',
      label: 'Cx de Currículos',
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
      icone: 'quiz',
      label: 'Banco de Provas',
      permissao: 'configuracoes.visualizar',
    },
  ];
  const sublinksTreinamentos = [
    {
      tela: 'screen-training-mine',
      icone: 'play_circle',
      label: 'Meus treinamentos',
      permissao: 'onboarding.visualizar',
    },
    {
      tela: 'screen-training-trilhas',
      icone: 'school',
      label: 'Treinamentos',
      permissao: 'onboarding.visualizar',
    },
    {
      tela: 'screen-training-assignments',
      icone: 'assignment_ind',
      label: 'Atribuições',
      permissao: 'onboarding.visualizar',
    },
  ];
  const sublinksMonitoria = [
    { tela: 'screen-monitoria-nova', icone: 'add', label: 'Nova monitoria', permissao: 'monitoria.criar' },
    { tela: 'screen-monitoria-feedback', icone: 'rate_review', label: 'Feedback', permissao: 'monitoria.feedback_aplicar' },
    { tela: 'screen-monitoria-contestacoes', icone: 'verified', label: 'Contestações', permissao: 'monitoria.reanalisar' },
    { tela: 'screen-monitoria-minhas', icone: 'assignment_ind', label: 'Minhas monitorias', permissao: 'monitoria.contestar' },
    { tela: 'screen-monitoria', icone: 'history', label: 'Histórico', permissao: 'monitoria.visualizar' },
    { tela: 'screen-monitoria-dashboard', icone: 'analytics', label: 'Dashboard', permissao: 'monitoria.dashboard' },
    { tela: 'screen-monitoria-planos', icone: 'task_alt', label: 'Planos de ação', permissao: 'monitoria.plano_acao_visualizar' },
    { tela: 'screen-monitoria-relatorios', icone: 'table_chart', label: 'Relatórios', permissao: 'monitoria.relatorios' },
    { tela: 'screen-monitoria-formularios', icone: 'rule', label: 'Formulários', permissao: 'monitoria.matriz' },
  ];
  const telasRelacionadasMonitoria = sublinksMonitoria.map((item) => item.tela);
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
      permissao: 'calendario.visualizar',
    },
    {
      tela: 'screen-mural',
      icone: 'article',
      label: 'Mural',
      permissao: 'mural.visualizar',
    },
  ];
  const itensDriveConecta = [
    {
      tela: 'screen-onedrive-files',
      icone: 'cloud',
      label: 'Drive',
      permissao: 'onedrive.visualizar',
    },
  ];
  const sublinksConfiguracoes = [
    {
      tela: 'screen-settings-monitoria',
      icone: 'fact_check',
      label: 'Central de Monitoria',
      permissao: 'monitoria.configurar',
    },
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
      tela: 'screen-settings-etapas',
      icone: 'checklist',
      label: 'Etapas do Processo',
      permissao: 'configuracoes.visualizar',
      desativado: true,
    },
    {
      tela: 'screen-settings-motivos-eliminacao',
      icone: 'person_remove',
      label: 'Motivos de Eliminação',
      permissao: 'configuracoes.visualizar',
    },
    {
      tela: 'screen-settings-modelos-email',
      icone: 'mail',
      label: 'Modelos de E-mail',
      permissao: 'configuracoes.visualizar',
    },
    {
      tela: 'screen-settings-lgpd',
      icone: 'shield_lock',
      label: 'LGPD e Retenção',
      permissao: 'configuracoes.visualizar',
      desativado: true,
    },
    {
      tela: 'screen-settings-logs',
      icone: 'history_edu',
      label: 'Logs',
      permissao: 'logs.visualizar',
    },
    {
      tela: 'screen-settings-monitoria-equipes',
      icone: 'groups',
      label: 'Equipes e catálogos',
      permissao: 'monitoria.equipes',
      somenteAdmin: true,
    },
    {
      tela: 'screen-settings-document-templates',
      icone: 'help',
      label: 'Central de Ajuda',
      permissao: 'documentos_templates.editar',
    },
    {
      tela: 'screen-settings-administracao',
      icone: 'verified_user',
      label: 'Parâmetros',
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
    'screen-training-mine',
  ];
  const telasRelacionadasGestao = [
    'screen-analysis-candidates',
    'screen-dashboard-funil',
    'screen-candidates',
    'screen-candidate-details',
    'screen-candidate-pipeline',
    'screen-calendario',
    'screen-mural',
  ];
  const telasRelacionadasConfiguracoes = [
    'screen-settings',
    'screen-settings-users',
    'screen-settings-profiles',
    'screen-settings-operations',
    'screen-settings-etapas',
    'screen-settings-motivos-eliminacao',
    'screen-settings-modelos-email',
    'screen-settings-lgpd',
    'screen-settings-logs',
    'screen-settings-monitoria-equipes',
    'screen-settings-monitoria-logs',
    'screen-settings-document-templates',
    'screen-settings-administracao',
    'screen-settings-monitoria',
  ];
  const possuiPermissao = (permissao) =>
    !permissao || controlador?.possuiPermissao?.(permissao);
  // Chave-mestra da sessão (Perfis e Permissões): só restringe quando o token a traz.
  const sessaoOk = (tela) => controlador?.sessaoDaTelaLiberada?.(tela) !== false;
  // "Minhas monitorias" também é do Supervisor (monitorias da equipe, com a etiqueta "Contestada").
  const supervisorMinhas = (subitem) =>
    subitem.tela === 'screen-monitoria-minhas' && controlador?.estado?.perfilUsuario === 'supervisor' && possuiPermissao('monitoria.visualizar');
  const possuiSub = (subitem) => (possuiPermissao(subitem.permissao) || supervisorMinhas(subitem)) && sessaoOk(subitem.tela);
  const itemAtivo = (item) =>
    navAtiva === item.tela || (item.telasRelacionadas || []).includes(navAtiva);
  const grupoProcessosAtivo = telasRelacionadasProcessos.includes(navAtiva);
  const subitemProcessoAtivo = sublinksProcessos.some(
    (item) => item.tela === navAtiva,
  );
  const sublinksProcessosVisiveis = sublinksProcessos.filter((subitem) =>
    possuiSub(subitem),
  );
  const grupoProvasAtivo = telasRelacionadasProvas.includes(navAtiva);
  const subitemProvaAtivo = (subitem) => navAtiva === subitem.tela;
  const sublinksProvasVisiveis = sublinksProvas.filter((subitem) =>
    possuiSub(subitem),
  );
  const ehAdministrador = controlador?.estado?.perfilUsuario === 'administrador';
  const sublinksConfiguracoesVisiveis = sublinksConfiguracoes.filter(
    (subitem) => possuiSub(subitem) && (!subitem.somenteAdmin || ehAdministrador),
  );
  const sublinksGestaoVisiveis = sublinksGestao.filter((subitem) =>
    possuiSub(subitem),
  );
  const grupoGestaoAtivo = telasRelacionadasGestao.includes(navAtiva);
  const subitemGestaoAtivo = (subitem) =>
    navAtiva === subitem.tela || (subitem.telasRelacionadas || []).includes(navAtiva);
  const grupoConfiguracoesAtivo = telasRelacionadasConfiguracoes.includes(navAtiva);
  const subitemConfiguracaoAtivo = (subitem) =>
    navAtiva === subitem.tela ||
    (navAtiva === 'screen-settings' && subitem.tela === 'screen-settings-users');
  const sublinksTreinamentosVisiveis = sublinksTreinamentos.filter((subitem) =>
    possuiSub(subitem),
  );
  const grupoTreinamentosAtivo = telasRelacionadasTreinamentos.includes(navAtiva);
  const sublinksMonitoriaVisiveis = sublinksMonitoria.filter((subitem) => possuiSub(subitem));
  const grupoMonitoriaAtivo = telasRelacionadasMonitoria.includes(navAtiva);
  const subitemMonitoriaAtivo = (subitem) => navAtiva === subitem.tela;
  const subitemTreinamentoAtivo = (subitem) =>
    navAtiva === subitem.tela ||
    (navAtiva === 'screen-training' && subitem.tela === 'screen-training-trilhas');
  // Navegação horizontal: só um grupo (dropdown) fica aberto por vez —
  // substitui os 5 booleans independentes que faziam sentido como acordeão
  // vertical na barra lateral, mas não numa barra de menus horizontal.
  const [grupoAberto, setGrupoAberto] = useState(null);
  const [logoComErro, setLogoComErro] = useState(false);
  const [logoOperacao, setLogoOperacao] = useState(() => obterLogoOperacao());
  useEffect(() => assinarTemaOperacao((tema) => { setLogoOperacao(tema.logoUrl || ''); setLogoComErro(false); }), []);
  const referenciaNav = useRef(null);

  useEffect(() => {
    setGrupoAberto(null);
  }, [navAtiva]);

  useEffect(() => {
    function fecharAoClicarFora(evento) {
      if (referenciaNav.current && !referenciaNav.current.contains(evento.target)) {
        setGrupoAberto(null);
      }
    }
    document.addEventListener('mousedown', fecharAoClicarFora);
    return () => document.removeEventListener('mousedown', fecharAoClicarFora);
  }, []);

  const alternarGrupo = (grupo) =>
    setGrupoAberto((atual) => (atual === grupo ? null : grupo));

  const renderizarItem = (item) => {
    if (item.visivel === false || !possuiPermissao(item.permissao) || !sessaoOk(item.tela)) return null;
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
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(item.icone)}</span>
        <span class="rh-modern-nav-label">${item.label}</span>
      </button>
    `;
  };

  return html`
    <header
      class="rh-modern-topnav"
      data-tour-id="layout-sidebar"
      ref=${referenciaNav}
    >
      <div class="rh-modern-topnav-brand">
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
                </span>
              `
      : html`
                <img
                  alt="Conecta Central 24h"
                  class="rh-modern-logo"
                  src=${logoOperacao || '/estilos/logo_conecta_horizontal.png'}
                  onError=${() => setLogoComErro(true)}
                />
              `}
        </button>
      </div>

      <nav class="rh-modern-nav">
        ${itensPrincipais.map(renderizarItem)}
        ${sublinksProcessosVisiveis.length
      ? html`
              <div
                class=${`rh-modern-nav-group ${grupoAberto === 'processos' ? 'is-open' : ''
          } ${grupoProcessosAtivo ? 'has-active' : ''}`.trim()}
              >
                <button
                  type="button"
                  class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoProcessosAtivo && !subitemProcessoAtivo ? 'is-active' : ''
          }`.trim()}
                  title="Processos"
                  aria-expanded=${grupoAberto === 'processos'}
                  aria-haspopup="true"
                  aria-controls="rh-modern-subnav-processos"
                  aria-current=${grupoProcessosAtivo && !subitemProcessoAtivo ? 'page' : null
        }
                  onClick=${() => alternarGrupo('processos')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('business_center')}</span>
                  <span class="rh-modern-nav-label">Processos</span>
                  <span
                    class="material-symbols-outlined rh-modern-nav-chevron"
                    aria-hidden="true"
                  >${IconeSvg('expand_more')}</span>
                </button>
                ${grupoAberto === 'processos'
          ? html`
                      <div
                        class="rh-modern-subnav"
                        id="rh-modern-subnav-processos"
                        role="menu"
                        aria-label="Submenu de Processos"
                      >
                        ${sublinksProcessosVisiveis.map(
            (subitem) => html`
                            <button
                              key=${subitem.tela}
                              type="button"
                              class=${`rh-modern-subnav-btn ${navAtiva === subitem.tela ? 'is-active' : ''
                } ${subitem.status || ''}`.trim()}
                              title=${subitem.label}
                              role="menuitem"
                              aria-current=${navAtiva === subitem.tela ? 'page' : null
              }
                              onClick=${() => {
                setGrupoAberto(null);
                controlador.irParaTelaProtegida(subitem.tela);
              }}
                            >
                              <span
                                class="material-symbols-outlined"
                                aria-hidden="true"
                              >${IconeSvg(subitem.icone)}</span>
                              <span>${subitem.label}</span>
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}
        ${sublinksProvasVisiveis.length
      ? html`
              <div
                class=${`rh-modern-nav-group ${grupoAberto === 'provas' ? 'is-open' : ''
          } ${grupoProvasAtivo ? 'has-active' : ''}`.trim()}
              >
                <button
                  type="button"
                  class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoProvasAtivo && !sublinksProvasVisiveis.some(subitemProvaAtivo) ? 'is-active' : ''
          }`.trim()}
                  title="Conecta Provas"
                  aria-expanded=${grupoAberto === 'provas'}
                  aria-haspopup="true"
                  aria-controls="rh-modern-subnav-provas"
                  onClick=${() => alternarGrupo('provas')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('assignment_turned_in')}</span>
                  <span class="rh-modern-nav-label">Conecta Provas</span>
                  <span
                    class="material-symbols-outlined rh-modern-nav-chevron"
                    aria-hidden="true"
                  >${IconeSvg('expand_more')}</span>
                </button>
                ${grupoAberto === 'provas'
          ? html`
                      <div
                        class="rh-modern-subnav"
                        id="rh-modern-subnav-provas"
                        role="menu"
                        aria-label="Submenu de Conecta Provas"
                      >
                        ${sublinksProvasVisiveis.map(
            (subitem) => html`
                            <button
                              key=${subitem.tela}
                              type="button"
                              class=${`rh-modern-subnav-btn ${subitemProvaAtivo(subitem) ? 'is-active' : ''
                }`.trim()}
                              title=${subitem.label}
                              role="menuitem"
                              aria-current=${subitemProvaAtivo(subitem) ? 'page' : null
              }
                              onClick=${() => {
                setGrupoAberto(null);
                controlador.irParaTelaProtegida(subitem.tela);
              }}
                            >
                              <span
                                class="material-symbols-outlined"
                                aria-hidden="true"
                              >${IconeSvg(subitem.icone)}</span>
                              <span>${subitem.label}</span>
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}
        ${sublinksGestaoVisiveis.length
      ? html`
              <div
                class=${`rh-modern-nav-group ${grupoAberto === 'gestao' ? 'is-open' : ''
          } ${grupoGestaoAtivo ? 'has-active' : ''}`.trim()}
              >
                <button
                  type="button"
                  class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoGestaoAtivo && !sublinksGestaoVisiveis.some(subitemGestaoAtivo) ? 'is-active' : ''
          }`.trim()}
                  title="Gestão"
                  aria-expanded=${grupoAberto === 'gestao'}
                  aria-haspopup="true"
                  aria-controls="rh-modern-subnav-gestao"
                  onClick=${() => alternarGrupo('gestao')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('manage_accounts')}</span>
                  <span class="rh-modern-nav-label">Gestão</span>
                  <span
                    class="material-symbols-outlined rh-modern-nav-chevron"
                    aria-hidden="true"
                  >${IconeSvg('expand_more')}</span>
                </button>
                ${grupoAberto === 'gestao'
          ? html`
                      <div
                        class="rh-modern-subnav"
                        id="rh-modern-subnav-gestao"
                        role="menu"
                        aria-label="Submenu de Gestão"
                      >
                        ${sublinksGestaoVisiveis.map(
            (subitem) => html`
                            <button
                              key=${subitem.tela}
                              type="button"
                              class=${`rh-modern-subnav-btn ${subitemGestaoAtivo(subitem) ? 'is-active' : ''
                }`.trim()}
                              title=${subitem.label}
                              role="menuitem"
                              aria-current=${subitemGestaoAtivo(subitem) ? 'page' : null
              }
                              onClick=${() => {
                setGrupoAberto(null);
                controlador.irParaTelaProtegida(subitem.tela);
              }}
                            >
                              <span
                                class="material-symbols-outlined"
                                aria-hidden="true"
                              >${IconeSvg(subitem.icone)}</span>
                              <span>${subitem.label}</span>
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}
        ${itensDriveConecta.map(renderizarItem)}
        ${sublinksTreinamentosVisiveis.length
      ? html`
              <div
                class=${`rh-modern-nav-group ${grupoAberto === 'treinamentos' ? 'is-open' : ''
          } ${grupoTreinamentosAtivo ? 'has-active' : ''}`.trim()}
              >
                <button
                  type="button"
                  class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoTreinamentosAtivo && !sublinksTreinamentosVisiveis.some(subitemTreinamentoAtivo) ? 'is-active' : ''
          }`.trim()}
                  title="Treinamentos"
                  aria-expanded=${grupoAberto === 'treinamentos'}
                  aria-haspopup="true"
                  aria-controls="rh-modern-subnav-treinamentos"
                  onClick=${() => alternarGrupo('treinamentos')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('school')}</span>
                  <span class="rh-modern-nav-label">Treinamentos</span>
                  <span
                    class="material-symbols-outlined rh-modern-nav-chevron"
                    aria-hidden="true"
                  >${IconeSvg('expand_more')}</span>
                </button>
                ${grupoAberto === 'treinamentos'
          ? html`
                      <div
                        class="rh-modern-subnav"
                        id="rh-modern-subnav-treinamentos"
                        role="menu"
                        aria-label="Submenu de Treinamentos"
                      >
                        ${sublinksTreinamentosVisiveis.map(
            (subitem) => html`
                            <button
                              key=${subitem.tela}
                              type="button"
                              class=${`rh-modern-subnav-btn ${subitemTreinamentoAtivo(subitem) ? 'is-active' : ''
                }`.trim()}
                              title=${subitem.label}
                              role="menuitem"
                              aria-current=${subitemTreinamentoAtivo(subitem) ? 'page' : null
              }
                              onClick=${() => {
                setGrupoAberto(null);
                controlador.irParaTelaProtegida(subitem.tela);
              }}
                            >
                              <span
                                class="material-symbols-outlined"
                                aria-hidden="true"
                              >${IconeSvg(subitem.icone)}</span>
                              <span>${subitem.label}</span>
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}
        ${sublinksMonitoriaVisiveis.length
      ? html`
              <div
                class=${`rh-modern-nav-group ${grupoAberto === 'monitoria' ? 'is-open' : ''
          } ${grupoMonitoriaAtivo ? 'has-active' : ''}`.trim()}
              >
                <button
                  type="button"
                  class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoMonitoriaAtivo && !sublinksMonitoriaVisiveis.some(subitemMonitoriaAtivo) ? 'is-active' : ''
          }`.trim()}
                  title="Monitoria"
                  aria-expanded=${grupoAberto === 'monitoria'}
                  aria-haspopup="true"
                  aria-controls="rh-modern-subnav-monitoria"
                  onClick=${() => alternarGrupo('monitoria')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('fact_check')}</span>
                  <span class="rh-modern-nav-label">Monitoria</span>
                  <span
                    class="material-symbols-outlined rh-modern-nav-chevron"
                    aria-hidden="true"
                  >${IconeSvg('expand_more')}</span>
                </button>
                ${grupoAberto === 'monitoria'
          ? html`
                      <div
                        class="rh-modern-subnav"
                        id="rh-modern-subnav-monitoria"
                        role="menu"
                        aria-label="Submenu de Monitoria"
                      >
                        ${sublinksMonitoriaVisiveis.map(
            (subitem) => html`
                            <button
                              key=${subitem.tela}
                              type="button"
                              class=${`rh-modern-subnav-btn ${subitemMonitoriaAtivo(subitem) ? 'is-active' : ''
                }`.trim()}
                              title=${subitem.label}
                              role="menuitem"
                              aria-current=${subitemMonitoriaAtivo(subitem) ? 'page' : null
              }
                              onClick=${() => {
                setGrupoAberto(null);
                controlador.irParaTelaProtegida(subitem.tela);
              }}
                            >
                              <span
                                class="material-symbols-outlined"
                                aria-hidden="true"
                              >${IconeSvg(subitem.icone)}</span>
                              <span>${subitem.label}</span>
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}
        ${sublinksConfiguracoesVisiveis.length
      ? html`
              <div
                class=${`rh-modern-nav-group ${grupoAberto === 'configuracoes' ? 'is-open' : ''
          } ${grupoConfiguracoesAtivo ? 'has-active' : ''}`.trim()}
              >
                <button
                  type="button"
                  class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoConfiguracoesAtivo && !sublinksConfiguracoesVisiveis.some(subitemConfiguracaoAtivo) ? 'is-active' : ''
          }`.trim()}
                  title="Configurações"
                  aria-expanded=${grupoAberto === 'configuracoes'}
                  aria-haspopup="true"
                  aria-controls="rh-modern-subnav-configuracoes"
                  onClick=${() => alternarGrupo('configuracoes')}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('settings')}</span>
                  <span class="rh-modern-nav-label">Configurações</span>
                  <span
                    class="material-symbols-outlined rh-modern-nav-chevron"
                    aria-hidden="true"
                  >${IconeSvg('expand_more')}</span>
                </button>
                ${grupoAberto === 'configuracoes'
          ? html`
                      <div
                        class="rh-modern-subnav"
                        id="rh-modern-subnav-configuracoes"
                        role="menu"
                        aria-label="Submenu de Configurações"
                      >
                        ${sublinksConfiguracoesVisiveis.map(
            (subitem) => html`
                            <button
                              key=${subitem.tela}
                              type="button"
                              class=${`rh-modern-subnav-btn ${subitemConfiguracaoAtivo(subitem) ? 'is-active' : ''} ${subitem.desativado ? 'is-disabled' : ''
                }`.trim()}
                              title=${subitem.desativado ? `${subitem.label} (em construção)` : subitem.label}
                              role="menuitem"
                              aria-disabled=${subitem.desativado ? 'true' : null}
                              aria-current=${subitemConfiguracaoAtivo(subitem) ? 'page' : null
              }
                              onClick=${() => {
                if (subitem.desativado) return;
                setGrupoAberto(null);
                controlador.irParaTelaProtegida(subitem.tela);
              }}
                            >
                              <span
                                class="material-symbols-outlined"
                                aria-hidden="true"
                              >${IconeSvg(subitem.desativado ? 'lock' : subitem.icone)}</span>
                              <span>${subitem.label}</span>
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}
      </nav>

      <div class="rh-modern-topnav-user">
        <${CartaoUsuarioTopo} controlador=${controlador} onOpenHelp=${onOpenHelp} mostrarAjuda=${mostrarAjuda} />
      </div>
    </header>
  `;
}

export function PageIntro({
  kicker,
  title,
  description,
  actions = null,
  tourId = 'page-intro',
}) {
  // Correções.txt (rodada 3): a ação principal da tela (acaoPrimaria/
  // acoesTopo, publicada por PainelRh via contexto) entra na MESMA linha de
  // ações do PageIntro, junto de qualquer `actions` que a tela já passe —
  // título/descrição à esquerda, todos os botões à direita.
  const acaoPagina = useContext(AcoesPaginaContext);
  const buscaPagina = useContext(BuscaPaginaContext);
  const acoesCombinadas = [
    acaoPagina?.acaoPrimaria
      ? html`
          <button
            type="button"
            class="btn btn-primary"
            data-tour-id="topbar-primary-action"
            disabled=${acaoPagina.acaoPrimaria.disabled}
            onClick=${acaoPagina.acaoPrimaria.onClick}
          >
            ${acaoPagina.acaoPrimaria.icon
          ? html`<span class="material-symbols-outlined">${IconeSvg(acaoPagina.acaoPrimaria.icon)}</span>`
          : null}
            ${acaoPagina.acaoPrimaria.label}
          </button>
        `
      : null,
    acaoPagina?.acoesTopo || null,
    actions,
  ].filter(Boolean);

  return html`
    <section class=${`rh-page-intro ${buscaPagina ? 'has-search' : ''}`.trim()} data-tour-id=${tourId || null}>
      <div class="rh-page-intro-heading">
        ${kicker ? html`<p class="rh-modern-kicker">${kicker}</p>` : null}
        <h2 class="rh-modern-title">${title}</h2>
        ${description
      ? html`<p class="rh-modern-description">${description}</p>`
      : null}
      </div>
      ${buscaPagina
      ? html`
          <div class="rh-page-search" data-tour-id="topbar-search">
            <${BuscaGlobalTopbar}
              placeholderBusca=${buscaPagina.placeholderBusca}
              controlador=${buscaPagina.controlador}
            />
          </div>
        `
      : null}
      ${acoesCombinadas.length
      ? html`<div class="rh-page-intro-actions">${acoesCombinadas}</div>`
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
  collapsible = false,
  defaultCollapsed = false,
  children,
}) {
  const [recolhido, setRecolhido] = useState(collapsible && defaultCollapsed);
  return html`
    <section
      class=${`rh-section-card ${className} ${collapsible ? 'rh-section-card--collapsible' : ''}`.trim()}
      data-tour-id=${tourId || null}
    >
      ${title || description || actions || collapsible
      ? html`
            <header
              class="rh-section-card-header"
              onClick=${collapsible ? () => setRecolhido((anterior) => !anterior) : null}
              style=${collapsible ? { cursor: 'pointer' } : null}
            >
              ${title || description
        ? html`
                    <div>
                      ${title ? html`<h3>${title}</h3>` : null}
                      ${description
            ? html`<p class="rh-section-card-description">${description}</p>`
            : null}
                    </div>
                  `
        : null}
              ${actions}
              ${collapsible
        ? html`
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm rh-section-card-toggle"
                      title=${recolhido ? 'Expandir' : 'Recolher'}
                      onClick=${(event) => {
            event.stopPropagation();
            setRecolhido((anterior) => !anterior);
          }}
                    >
                      <span class="material-symbols-outlined">${IconeSvg(recolhido ? 'expand_more' : 'expand_less')}</span>
                    </button>
                  `
        : null}
            </header>
          `
      : null}
      ${collapsible && recolhido ? null : children}
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

export function CartaoUsuarioTopo({ controlador, onOpenHelp = null, mostrarAjuda = false }) {
  const [aberto, setAberto] = useState(false);
  const [notificacoesAbertas, setNotificacoesAbertas] = useState(false);
  const [tema, setTema] = useState(() => obterTemaSalvo());
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
  const { itens: notificacoes, carregando: carregandoNotificacoes, marcarComoLida, excluirTodas } = useResumoNotificacoes(controlador);
  const coresPorCategoria = lerCoresNotificacao();
  const notificacoesNaoLidas = notificacoes.filter((item) => !item.lida);

  const alternarTema = () => {
    const novoTema = definirTema(proximoTema(tema));
    setTema(novoTema);
  };

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

  useEffect(() => {
    if (!notificacoesAbertas) return undefined;

    const fecharAoClicarFora = (event) => {
      if (
        event.target?.closest?.('.c24-notif-side-panel') ||
        event.target?.closest?.('.c24-user-menu-wrap')
      ) {
        return;
      }
      setNotificacoesAbertas(false);
    };
    const fecharNoEscape = (event) => {
      if (event.key === 'Escape') setNotificacoesAbertas(false);
    };

    document.addEventListener('click', fecharAoClicarFora);
    document.addEventListener('keydown', fecharNoEscape);
    return () => {
      document.removeEventListener('click', fecharAoClicarFora);
      document.removeEventListener('keydown', fecharNoEscape);
    };
  }, [notificacoesAbertas]);

  return html`
    <div class="c24-user-menu-wrap">
      <button
        type="button"
        class="c24-user-menu"
        title="Perfil do usuário"
        aria-label=${`Abrir menu do perfil de ${nome}${notificacoesNaoLidas.length ? `, ${notificacoesNaoLidas.length} notificações novas` : ''}`}
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
        </span>
        ${notificacoesNaoLidas.length ? html`<i class="c24-user-menu-badge" aria-hidden="true"></i>` : null}
      </button>

      ${aberto
      ? html`
            <div class="c24-user-dropdown" role="menu">
              <div class="c24-user-dropdown-identity">
                <strong>${nome}</strong>
                <small>${perfil}</small>
              </div>
              <button
                type="button"
                role="menuitem"
                class="c24-user-dropdown-item"
                onClick=${(event) => {
          event.stopPropagation();
          setAberto(false);
          setNotificacoesAbertas(true);
        }}
              >
                <span class="material-symbols-outlined">${IconeSvg('notifications')}</span>
                Notificações
                ${notificacoesNaoLidas.length ? html`<span class="c24-user-dropdown-badge">${notificacoesNaoLidas.length}</span>` : null}
              </button>
              <button
                type="button"
                role="menuitem"
                class="c24-user-dropdown-item"
                onClick=${() => {
          setAberto(false);
          controlador.irParaTelaProtegida(
            controlador.podeAcessarTela('screen-settings-document-templates') ? 'screen-settings-document-templates' : 'screen-help',
          );
        }}
              >
                <span class="material-symbols-outlined">${IconeSvg('menu_book')}</span>
                Central de Ajuda
              </button>
              ${mostrarAjuda && onOpenHelp
          ? html`
                    <button
                      type="button"
                      role="menuitem"
                      class="c24-user-dropdown-item"
                      onClick=${() => {
              setAberto(false);
              onOpenHelp();
            }}
                    >
                      <span class="material-symbols-outlined">${IconeSvg('help')}</span>
                      Ver orientações
                    </button>
                  `
          : null}
              <button
                type="button"
                role="menuitem"
                class="c24-user-dropdown-item"
                onClick=${(event) => {
          event.stopPropagation();
          alternarTema();
        }}
              >
                <span class="material-symbols-outlined">${IconeSvg(TEMA_ICONE[tema])}</span>
                Alternar modo claro e escuro
              </button>
              <button
                type="button"
                role="menuitem"
                class="c24-user-dropdown-item"
                onClick=${() => {
          setAberto(false);
          controlador.irParaTelaProtegida('screen-settings-environment');
        }}
              >
                <span class="material-symbols-outlined">${IconeSvg('settings')}</span>
                Configurações de Perfil
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
                <span class="material-symbols-outlined">${IconeSvg('logout')}</span>
                Sair
              </button>
            </div>
          `
      : null}

      ${notificacoesAbertas
      ? html`
            <div class="c24-notif-side-panel" role="menu">
              <header class="c24-notif-side-panel-header">
                <span>Notificações</span>
                <div class="c24-notif-side-panel-header-actions">
                  ${notificacoes.length
          ? html`
                        <button
                          type="button"
                          class="c24-notif-side-panel-clear"
                          onClick=${() => excluirTodas()}
                        >
                          Excluir notificações
                        </button>
                      `
          : null}
                  <button
                    type="button"
                    class="c24-notif-side-panel-close"
                    aria-label="Fechar notificações"
                    onClick=${() => setNotificacoesAbertas(false)}
                  >
                    <span class="material-symbols-outlined">${IconeSvg('close')}</span>
                  </button>
                </div>
              </header>
              ${carregandoNotificacoes
          ? html`<p class="c24-notif-empty">Carregando…</p>`
          : notificacoes.length
            ? html`
                    <ul class="c24-notif-list">
                      ${notificacoes.map(
              (item) => html`
                          <li
                            key=${item.id}
                            class=${`c24-notif-item ${item.lida ? 'is-lida' : ''}`.trim()}
                            role="menuitem"
                            tabIndex="0"
                            title=${item.lida ? 'Notificação lida' : 'Marcar como lida'}
                            onClick=${() => marcarComoLida(item)}
                            onKeyDown=${(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    marcarComoLida(item);
                  }
                }}
                          >
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
  const acaoPaginaContexto = mostrarAcaoPrimaria || acoesTopo
    ? {
      acaoPrimaria: mostrarAcaoPrimaria
        ? {
          label: acaoPrimaria.label,
          icon: acaoPrimaria.icon,
          disabled: Boolean(acaoPrimaria.disabled),
          onClick: acaoPrimaria.onClick,
        }
        : null,
      acoesTopo: acoesTopo || null,
    }
    : null;
  // Correções.txt (21/set/2026): o Operador não tem barra de pesquisa global.
  const semBusca = controlador?.estado?.perfilUsuario === 'operador';
  const buscaPaginaContexto = useMemo(
    () => (semBusca ? null : { placeholderBusca, controlador }),
    [placeholderBusca, controlador, semBusca],
  );
  // Telas sem PageIntro não têm a linha onde a busca é centralizada: nelas a
  // busca continua acessível numa linha própria acima do conteúdo.
  const paginaRef = useRef(null);
  const [semIntro, setSemIntro] = useState(false);
  useEffect(() => {
    const tem = Boolean(paginaRef.current?.querySelector('.rh-page-intro'));
    setSemIntro((atual) => (atual === !tem ? atual : !tem));
  });

  return html`
    <section class="active screen" id=${screenId}>
      <${BotaoVoltarGlobal} />
      <div class="rh-modern-shell">
        <${BarraLateral}
          navAtiva=${navAtiva}
          subtituloMarca=${subtituloMarca}
          placeholderBusca=${placeholderBusca}
          controlador=${controlador}
          mostrarAtalhos=${mostrarAtalhos}
          onOpenHelp=${abrirTour}
          mostrarAjuda=${Boolean(tour?.steps?.length) && orientacoesAtivas()}
        />

        <div class="rh-modern-main">
          <main class="rh-modern-page" ref=${paginaRef}>
            ${semIntro && !semBusca
      ? html`
                  <div class="rh-page-search rh-page-search--solo" data-tour-id="topbar-search">
                    <${BuscaGlobalTopbar} placeholderBusca=${placeholderBusca} controlador=${controlador} />
                  </div>
                `
      : null}
            <${BuscaPaginaContext.Provider} value=${buscaPaginaContexto}>
              <${AcoesPaginaContext.Provider} value=${acaoPaginaContexto}>
                ${children}
              </${AcoesPaginaContext.Provider}>
            </${BuscaPaginaContext.Provider}>
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
