import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  alterarStatusUsuario,
  aprovarSolicitacaoAlteracaoEmailApi,
  atualizarAutomacaoNotificacoes,
  atualizarItemConfiguracao,
  atualizarPermissoesPerfil,
  atualizarUsuario,
  baixarLogsAuditoria,
  criarItemConfiguracao,
  criarUsuario,
  criarUsuarioRapido,
  desativarItemConfiguracao,
  excluirUsuario,
  lerAutomacaoNotificacoes,
  lerCandidatosProcessos,
  listarCatalogoConfiguracoes,
  listarLogsAuditoria,
  listarPerfis,
  listarPermissoes,
  listarSolicitacoesAlteracaoEmailApi,
  listarUsuarios,
  redefinirSenhaUsuario,
  rejeitarSolicitacaoAlteracaoEmailApi,
} from '../../app/controlador-aplicacao.js';
import { canonicalizeCandidateStatus } from '../../shared/process-flow.js';
import { formatarDataHora } from '../../shared/helpers-visuais.js';
import { baixarBlob, obterItensPaginados } from '../../utilitarios.js';
import { redefinirMfaUsuario } from '../../services/api/settings.js';
import { listarOperacoes } from '../../services/api/operations.js';
import { PageIntro, PainelRh } from '../../ui/componentes-compartilhados.js';
import { ModalPadrao } from '../../ui/components/modals.js?v=20260921-hdr';
import { definirTema, obterTemaSalvo, proximoTema } from '../../shared/tema.js';
import { definirOrientacoesAtivas, orientacoesAtivas } from '../../ui/tour-guiado.js';
import { AVATARES_ILUSTRADOS, resolverAvatarUrl } from '../../shared/avatares.js';
import {
  CATEGORIAS_NOTIFICACAO,
  lerCoresNotificacao,
  lerPreferenciasNotificacao,
  salvarCorNotificacao,
  salvarPreferenciasNotificacao,
} from '../../shared/notificacoes.js?v=20260921-alertas';
import { IconeSvg } from '../../ui/icone.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';
import {
  AbaEquipesCatalogos,
  AbaLogsMonitoria,
  CamposVinculosMonitoria,
  ModalTransferirSupervisao,
  PERFIS_MONITORIA,
  VINCULOS_INICIAIS,
  validarVinculosMonitoria,
} from './monitoria-config.js';
import { salvarVinculosUsuarioMonitoria } from '../../services/api/monitoria.js';
import { AbaAmbienteOperacao } from './ambiente-operacao.js';

const ABAS = [
  { id: 'usuarios', tela: 'screen-settings-users', label: 'Usuários', permissao: 'usuarios.visualizar', icon: 'person' },
  { id: 'perfis', tela: 'screen-settings-profiles', label: 'Perfis e permissões', permissao: 'configuracoes.visualizar', icon: 'admin_panel_settings' },
  { id: 'operacoes', tela: 'screen-settings-operations', label: 'Operações', permissao: 'configuracoes.visualizar', icon: 'apartment' },
  { id: 'notificacoes', tela: 'screen-settings-notifications', label: 'Notificações', permissao: 'notificacoes.configurar', icon: 'notifications_active' },
  { id: 'logs', tela: 'screen-settings-logs', label: 'Logs', permissao: 'logs.visualizar', icon: 'history_edu' },
  // Administração da Monitoria (função do Administrador): equipes/catálogos. Os logs da Monitoria
  // ficam numa sub-aba da aba Logs.
  { id: 'equipes-catalogos', tela: 'screen-settings-monitoria-equipes', label: 'Equipes e catálogos', permissao: 'monitoria.equipes', icon: 'groups', somenteAdmin: true },
  { id: 'ambiente', tela: 'screen-settings-environment', label: 'Ambiente', permissao: '', icon: 'tune' },
];
// Redesign da tela de Perfis e permissões (Correções.txt, rodada 10/set/2026):
// os ~20 módulos granulares de permissão (rbac.py) são agrupados nestas 7
// "sessões" — o mesmo recorte que o usuário navega no Conecta — para que o
// perfil selecionado mostre uma sessão por vez em vez de todos os módulos
// abertos ao mesmo tempo (era o que tornava a tela "absurdamente longa").
const SESSOES_PERMISSAO = [
  { id: 'curriculos', label: 'Caixa de Currículos', icon: 'badge', modulos: ['Candidatos', 'Vagas'] },
  { id: 'processos', label: 'Processos', icon: 'checklist', modulos: ['Processos', 'Entrevistas', 'Etapas e Trilhas'] },
  { id: 'provas', label: 'Provas', icon: 'quiz', modulos: ['Provas', 'Fit Cultural'] },
  { id: 'gestao', label: 'Gestão', icon: 'analytics', modulos: ['Geral', 'Relatórios', 'Calendário', 'Notificações', 'Mural'] },
  { id: 'drive', label: 'Drive', icon: 'cloud', modulos: ['OneDrive', 'Documentos'] },
  { id: 'treinamentos', label: 'Treinamentos', icon: 'school', modulos: ['Onboarding'] },
  { id: 'monitoria', label: 'Monitoria', icon: 'fact_check', modulos: ['Monitoria'] },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: 'settings',
    modulos: ['Configurações', 'Usuários', 'LGPD', 'E-mails', 'Templates de Documentos', 'Central de Ajuda', 'Operações', 'Logs', 'Políticas'],
  },
];

// Ícone por perfil na árvore de Perfis e permissões — antes todo perfil usava
// o mesmo ícone genérico "badge"; um por papel ajuda a distinguir a lista
// de relance. IDs batem com rbac.py (ROLE_INTERN, ROLE_DP, etc.).
const ICONE_POR_PERFIL = {
  estagiario: 'school',
  dp: 'assignment_ind',
  gestor: 'supervisor_account',
  rh: 'groups',
  candidato: 'person_search',
  administrador: 'admin_panel_settings',
  funcionario: 'badge',
  supervisor: 'shield_person',
  operador: 'support_agent',
  qualidade: 'fact_check',
  control_desk: 'monitoring',
};

function ToggleSwitch({ checked, disabled, onChange }) {
  return html`
    <label class=${`c24-toggle-switch ${disabled ? 'is-disabled' : ''}`.trim()}>
      <input type="checkbox" checked=${checked} disabled=${disabled} onChange=${onChange} />
      <span class="c24-toggle-switch-track"><span class="c24-toggle-switch-thumb"></span></span>
    </label>
  `;
}

const ABA_POR_TELA = ABAS.reduce((mapa, aba) => ({ ...mapa, [aba.tela]: aba.id }), {
  'screen-settings': 'usuarios',
  'screen-settings-monitoria-logs': 'logs',
});

const FORM_USUARIO_INICIAL = {
  id_usuario: '',
  nome: '',
  sobrenome: '',
  email: '',
  login: '',
  senha: '',
  perfil: 'estagiario',
  cargo: '',
  status: 'Ativo',
  provedor_autenticacao: 'microsoft',
  operacoes: [],
  justificativa: '',
};

const FORM_ITEM_INICIAL = {
  id_item: '',
  chave: '',
  nome: '',
  descricao: '',
  categoria: '',
  criticidade: 'operacional',
  tags: '',
  aplicavel: 'todos',
  permissoes: '',
  payloadJson: '{}',
  ativo: true,
  justificativa: '',
  cliente: '',
  modalidadeOperacao: '',
  slaAtendimento: '',
  headcountPrevisto: '',
  softwaresUtilizados: '',
  sistemasAcesso: [],
  duracaoMinutos: '',
  toleranciaMinutos: '',
  subCausas: '',
  corTag: '#2563eb',
  finalidadeOperacao: '',
  segmentoMercado: '',
  areaSegmento: '',
  unidadeTipo: '',
  unidadeEnderecosHibrido: [],
  unidadeEnderecoCliente: '',
  jornadasTrabalho: [],
  turnoEscala: '',
  necessitaDisponibilidade: false,
  descricaoCliente: '',
  descricaoAtividades: '',
};

const SISTEMA_ACESSO_INICIAL = { nome: '', descricao: '' };

const TIPOS_OPERACAO = ['Receptivo', 'Ativo', 'Misto'];

const FINALIDADES_OPERACAO = [
  'SAC',
  'Suporte Técnico',
  'Televendas e Telemarketing',
  'Cobranças',
  'Pesquisa de Mercado',
  'Retenção',
];

const SEGMENTOS_MERCADO = [
  'Saúde e Bem-Estar',
  'Entretenimento e Esportes',
  'Plataformas de Serviço e Tecnologia (SaaS)',
  'Setores Industriais',
  'Infraestrutura de Alta Complexidade',
  'Setor Financeiro e Seguros',
  'Turismo, Viagens e Logística',
  'Serviços Públicos e Cidadania',
  'Indústria Automotiva e Mobilidade',
  'Varejo Especializado e Bens de Consumo',
  'Setor Imobiliário e Construção Civil',
  'Defesa, Segurança e Jurídico',
  'Outros Segmentos Emergentes',
  'Outros',
];

const AREAS_POR_SEGMENTO = {
  'Saúde e Bem-Estar': ['Hospitais e Clínicas', 'Planos de Saúde', 'Telemedicina', 'Farmácias e Laboratórios'],
  'Entretenimento e Esportes': ['Clubes de Futebol (Sócios-Torcedores)', 'Plataformas de Streaming', 'Casas de Apostas (Betting)'],
  'Plataformas de Serviço e Tecnologia (SaaS)': ['Marketplaces e E-commerce', 'Aplicativos de Delivery e Mobilidade', 'Plataformas de RH e Educação (EdTechs)'],
  'Setores Industriais': ['Plataformas Petrolíferas e Energia', 'Telecomunicações', 'Saneamento e Distribuição de Energia'],
  'Infraestrutura de Alta Complexidade': ['Plataformas Petrolíferas e Energia', 'Telecomunicações', 'Saneamento e Distribuição de Energia'],
  'Setor Financeiro e Seguros': ['Bancos Digitais e Tradicionais', 'Seguradoras'],
};

const JORNADAS_OPERACAO = [
  { value: '6x1', label: '6x1 (6 horas diárias / 36h semanais)' },
  { value: '5x2', label: '5x2 (8 horas diárias / 44h semanais)' },
  { value: '12x36', label: 'Escala 12x36' },
];

const ENDERECO_PRINCIPAL_CHAVE = 'ENDERECO_PRINCIPAL_EMPRESA';

const ENDERECO_PRINCIPAL_INICIAL = {
  id_item: '',
  rua: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
};

const UNIDADE_TIPOS_OPERACAO = [
  { value: 'em_loco', label: 'Em loco (endereço principal da empresa)' },
  { value: 'homeoffice', label: 'Home Office' },
  { value: 'hibrido', label: 'Híbrido' },
  { value: 'alocado_cliente', label: 'Alocado ao cliente' },
];

const CATALOGO_ICONS = {
  geral: 'settings',
  operacoes: 'apartment',
};

const STATUS_USUARIO = ['', 'Ativo', 'Inativo', 'Bloqueado'];
const STATUS_ITEM = [
  { value: 'todos', label: 'Todos' },
  { value: 'ativo', label: 'Ativos' },
  { value: 'inativo', label: 'Inativos' },
];

function normalizarLista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function textoSeguro(valor, fallback = '-') {
  if (valor === undefined || valor === null || valor === '') return fallback;
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (typeof valor === 'object') {
    return (
      valor.nome ||
      valor.label ||
      valor.titulo ||
      valor.id ||
      valor.chave ||
      fallback
    );
  }
  return String(valor);
}

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatarData(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatarAtualizacao(valor) {
  if (!valor) return 'Última atualização: aguardando atualização';
  return `Última atualização: hoje às ${valor.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function obterIntervaloPaginacao(paginacao) {
  const total = Number(paginacao?.totalItens || 0);
  if (!total) return '0-0';
  const tamanho = Number(paginacao?.tamanhoPagina || paginacao?.itens?.length || 1);
  const inicio = (Number(paginacao?.paginaAtual || 1) - 1) * tamanho + 1;
  const fim = Math.min(total, inicio + Number(paginacao?.itens?.length || 0) - 1);
  return `${inicio}-${fim}`;
}

function hojeSemHora() {
  const data = new Date();
  data.setHours(0, 0, 0, 0);
  return data;
}

function textoCampos(...campos) {
  return normalizarBusca(campos.filter(Boolean).join(' '));
}

function contarPor(lista, predicado) {
  return normalizarLista(lista).filter(predicado).length;
}

function obterStatusTone(status) {
  const texto = normalizarBusca(status);
  if (texto === 'ativo' || texto === 'sucesso') return 'success';
  if (texto === 'bloqueado' || texto === 'falha' || texto === 'critica') return 'danger';
  if (texto === 'inativo' || texto === 'rascunho') return 'muted';
  return 'info';
}

function dividirCsv(valor) {
  return String(valor || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatarCsv(valor) {
  if (Array.isArray(valor)) return valor.join(', ');
  return String(valor || '');
}

function agruparPermissoes(permissoes) {
  return normalizarLista(permissoes).reduce((mapa, permissao) => {
    const modulo = permissao.modulo || 'Outros';
    mapa[modulo] = mapa[modulo] || [];
    mapa[modulo].push(permissao);
    return mapa;
  }, {});
}

function permissaoEstaAtiva(perfil, chave) {
  return normalizarLista(perfil?.permissoes).includes(chave);
}

function formatarPayloadLog(valor) {
  if (valor === undefined || valor === null || valor === '') return '-';
  if (typeof valor === 'object') return JSON.stringify(valor, null, 2);
  try {
    return JSON.stringify(JSON.parse(valor), null, 2);
  } catch (error) {
    return String(valor);
  }
}

function inferirCriticidadeLog(log) {
  if (log?.sucesso === false) return 'Falha';
  const acao = normalizarBusca(log?.acao);
  if (
    acao.includes('excluir') ||
    acao.includes('desativar') ||
    acao.includes('bloquear') ||
    acao.includes('permiss') ||
    acao.includes('senha')
  ) {
    return 'Crítica';
  }
  return 'Operacional';
}

function Icone({ name, className = '' }) {
  return html`
    <span class=${`material-symbols-outlined ${className}`.trim()} aria-hidden="true">${IconeSvg(name)}</span>
  `;
}

// Redesign 10/set/2026 (achado transversal nº3, ver design/wireframes/
// README.md): trocado de fundo pastel liso (.c24-badge) para o mesmo
// padrão contorno+ponto (rh-status-pill) já usado no resto do app — um
// só ponto de mudança corrige as ~12 chamadas deste componente no arquivo.
function Badge({ label, tone = 'info' }) {
  const classe = tone === 'success' ? 'is-finished' : tone === 'danger' ? 'is-unsaved' : tone === 'muted' ? '' : 'is-neutral';
  return html`<span class=${`rh-status-pill ${classe}`}>${label}</span>`;
}

function StatCard({ icon, label, value, helper, tone = 'blue' }) {
  return html`
    <article class=${`c24-stat-card is-${tone}`}>
      <span class="c24-stat-icon"><${Icone} name=${icon} /></span>
      <span class="c24-stat-label">${label}</span>
      <strong>${value}</strong>
      ${helper ? html`<small>${helper}</small>` : null}
    </article>
  `;
}

function StatGrid({ items }) {
  return html`
    <div class="c24-stat-grid">
      ${items.map(
    (item) => html`
          <${StatCard}
            key=${item.label}
            icon=${item.icon}
            label=${item.label}
            value=${item.value}
            helper=${item.helper}
            tone=${item.tone}
          />
        `,
  )}
    </div>
  `;
}

function EmptyPanel({ icon = 'inbox', title, text, action = null }) {
  return html`
    <div class="c24-empty-state">
      <${Icone} name=${icon} />
      <h3>${title}</h3>
      <p>${text}</p>
      ${action}
    </div>
  `;
}

function FilterField({ label, icon = 'filter_alt', children }) {
  return html`
    <label class="c24-filter-field">
      <span><${Icone} name=${icon} />${label}</span>
      ${children}
    </label>
  `;
}

function PaginacaoCompacta({ paginacao, onChange, label = '' }) {
  if (!paginacao) return null;
  const totalPaginas = Math.max(1, Number(paginacao.totalPaginas || 1));
  const paginaAtual = Math.min(Math.max(1, Number(paginacao.paginaAtual || 1)), totalPaginas);
  return html`
    <div class="c24-pagination">
      <span>
        ${label || `Mostrando ${obterIntervaloPaginacao(paginacao)} de ${paginacao.totalItens} resultados`}
      </span>
      <div class="c24-pagination-actions">
        <button
          type="button"
          class="c24-page-btn"
          aria-label="Página anterior"
          disabled=${paginaAtual <= 1}
          onClick=${() => onChange(paginaAtual - 1)}
        >
          <${Icone} name="chevron_left" />
        </button>
        ${Array.from({ length: totalPaginas }, (_, indice) => indice + 1).map(
    (pagina) => html`
            <button
              key=${pagina}
              type="button"
              class=${`c24-page-btn ${pagina === paginaAtual ? 'is-active' : ''}`.trim()}
              onClick=${() => onChange(pagina)}
            >
              ${pagina}
            </button>
          `,
  )}
        <button
          type="button"
          class="c24-page-btn"
          aria-label="Próxima página"
          disabled=${paginaAtual >= totalPaginas}
          onClick=${() => onChange(paginaAtual + 1)}
        >
          <${Icone} name="chevron_right" />
        </button>
      </div>
    </div>
  `;
}

function BotaoAba({ aba, ativa, onClick }) {
  return html`
    <button
      type="button"
      class=${`c24-pill-tab ${ativa ? 'is-active' : ''}`.trim()}
      onClick=${onClick}
    >
      <${Icone} name=${aba.icon} />
      ${aba.label}
    </button>
  `;
}

export function TelaConfiguracoesSistema({ controlador, telaAtual = 'screen-settings-users' }) {
  const ehAdministrador = controlador.estado?.perfilUsuario === 'administrador';
  const abasPermitidas = ABAS.filter((aba) => controlador.possuiPermissao(aba.permissao) && (!aba.somenteAdmin || ehAdministrador));
  const [abaAtiva, setAbaAtiva] = useState(
    ABA_POR_TELA[telaAtual] || abasPermitidas[0]?.id || 'usuarios',
  );
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [operacoesDisponiveis, setOperacoesDisponiveis] = useState([]);
  const [perfis, setPerfis] = useState([]);
  // Perfis mantidos por compatibilidade (ex.: Funcionário, do app) não aparecem nas listas.
  const perfisVisiveis = useMemo(() => perfis.filter((perfil) => !perfil.oculto), [perfis]);
  const [permissoes, setPermissoes] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [formEndereco, setFormEndereco] = useState({ ...ENDERECO_PRINCIPAL_INICIAL });
  const [editandoEndereco, setEditandoEndereco] = useState(false);
  const [salvandoEndereco, setSalvandoEndereco] = useState(false);
  const [logs, setLogs] = useState([]);
  const [automacaoNotificacoes, setAutomacaoNotificacoes] = useState({
    email_automatico_ativo: false,
    lembretes_automaticos_ativos: false,
  });
  const [salvandoAutomacao, setSalvandoAutomacao] = useState(false);
  const [temaAmbiente, setTemaAmbiente] = useState(() => obterTemaSalvo());
  const [orientacoesAmbiente, setOrientacoesAmbiente] = useState(() => orientacoesAtivas());
  const [preferenciasNotificacaoAmbiente, setPreferenciasNotificacaoAmbiente] = useState(
    () => lerPreferenciasNotificacao(),
  );
  const [salvandoAvatar, setSalvandoAvatar] = useState(false);
  const [avatarExpandido, setAvatarExpandido] = useState(false);
  const [nomeDraft, setNomeDraft] = useState(() => controlador?.estado?.nomeUsuarioAutenticado || '');
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [sobrenomeDraft, setSobrenomeDraft] = useState(() => controlador?.estado?.sobrenomeUsuarioAutenticado || '');
  const [salvandoSobrenome, setSalvandoSobrenome] = useState(false);
  const [cargoDraft, setCargoDraft] = useState(() => controlador?.estado?.cargoUsuarioAutenticado || '');
  const [salvandoCargo, setSalvandoCargo] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [salvandoEmail, setSalvandoEmail] = useState(false);
  const [formLoginLocalAmbiente, setFormLoginLocalAmbiente] = useState({ novaSenha: '', confirmarSenha: '' });
  const [mostrarFormLoginLocalAmbiente, setMostrarFormLoginLocalAmbiente] = useState(false);
  const [editandoLoginAmbiente, setEditandoLoginAmbiente] = useState(false);
  const [salvandoLoginLocalAmbiente, setSalvandoLoginLocalAmbiente] = useState(false);
  const [salvandoProvedorAmbiente, setSalvandoProvedorAmbiente] = useState(false);
  const [solicitacoesEmailPendentes, setSolicitacoesEmailPendentes] = useState([]);
  const [decidindoSolicitacaoEmailId, setDecidindoSolicitacaoEmailId] = useState('');
  const [abaAmbiente, setAbaAmbiente] = useState('perfil');
  const [coresNotificacaoAmbiente, setCoresNotificacaoAmbiente] = useState(() => lerCoresNotificacao());
  const [formSenhaAmbiente, setFormSenhaAmbiente] = useState({ senhaAtual: '', novaSenha: '', confirmarNovaSenha: '' });
  const [salvandoSenhaAmbiente, setSalvandoSenhaAmbiente] = useState(false);
  const [erroSenhaAmbiente, setErroSenhaAmbiente] = useState('');
  const [formUsuario, setFormUsuario] = useState(FORM_USUARIO_INICIAL);
  const [vinculosMon, setVinculosMon] = useState(VINCULOS_INICIAIS);
  const [abaOperacao, setAbaOperacao] = useState('cadastro');
  const [subAbaLogs, setSubAbaLogs] = useState(telaAtual === 'screen-settings-monitoria-logs' ? 'monitoria' : 'sistema');
  const [transferindoSupervisao, setTransferindoSupervisao] = useState(false);
  const [usuarioSelecionadoId, setUsuarioSelecionadoId] = useState('');
  const [criandoUsuario, setCriandoUsuario] = useState(false);
  // "Criar usuário rápido" — nome, e-mail e senha para candidatos aprovados
  // que vão fazer treinamento; a atribuição do treinamento em si fica com a
  // Gestão de Treinamentos, não aqui.
  const [drawerUsuarioRapidoAberto, setDrawerUsuarioRapidoAberto] = useState(false);
  const [formUsuarioRapido, setFormUsuarioRapido] = useState({ nome: '', email: '', senha: '' });
  const [candidatosAprovados, setCandidatosAprovados] = useState([]);
  const [carregandoCandidatosAprovados, setCarregandoCandidatosAprovados] = useState(false);
  const [salvandoUsuarioRapido, setSalvandoUsuarioRapido] = useState(false);
  const [erroUsuarioRapido, setErroUsuarioRapido] = useState('');
  const [buscaCandidatoRapido, setBuscaCandidatoRapido] = useState('');
  const [filtrosUsuarios, setFiltrosUsuarios] = useState({
    busca: '',
    status: '',
    perfil: '',
    area: '',
    acesso: '',
  });
  const [painelFiltrosUsuariosAberto, setPainelFiltrosUsuariosAberto] = useState(false);
  const [paginaUsuarios, setPaginaUsuarios] = useState(1);
  const [perfilSelecionadoId, setPerfilSelecionadoId] = useState('');
  const [permissoesPerfilDraft, setPermissoesPerfilDraft] = useState([]);
  const [buscaPermissao, setBuscaPermissao] = useState('');
  const [mostrarSomenteAtivas, setMostrarSomenteAtivas] = useState(false);
  const [perfilComparadoId, setPerfilComparadoId] = useState('');
  const [justificativaPerfil, setJustificativaPerfil] = useState('');
  const [sessaoPermissaoAtiva, setSessaoPermissaoAtiva] = useState(SESSOES_PERMISSAO[0].id);
  const [perfisDesbloqueados, setPerfisDesbloqueados] = useState(false);
  const [tipoCatalogo, setTipoCatalogo] = useState('');
  const [listaCatalogoRecolhida, setListaCatalogoRecolhida] = useState(true);
  const [formItem, setFormItem] = useState(FORM_ITEM_INICIAL);
  const enderecoPrincipalItem = useMemo(
    () => (catalogo.find((secao) => secao.tipo === 'geral')?.items || []).find(
      (item) => item.chave === ENDERECO_PRINCIPAL_CHAVE,
    ),
    [catalogo],
  );
  const [filtrosCatalogo, setFiltrosCatalogo] = useState({ busca: '', status: 'todos' });
  const [filtrosLogs, setFiltrosLogs] = useState({
    busca: '',
    modulo: '',
    acao: '',
    usuario: '',
    criticidade: '',
    status: '',
    periodo: '',
  });
  const [paginaLogs, setPaginaLogs] = useState(1);
  const [logExpandidoId, setLogExpandidoId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [menuUsuarioAbertoId, setMenuUsuarioAbertoId] = useState('');
  const [menuUsuarioPosicao, setMenuUsuarioPosicao] = useState(null);
  const [drawerUsuarioAberto, setDrawerUsuarioAberto] = useState(false);
  const [modoEdicaoUsuario, setModoEdicaoUsuario] = useState(false);
  const [confirmandoExclusaoUsuario, setConfirmandoExclusaoUsuario] = useState(false);

  const permissoesPorModulo = useMemo(() => agruparPermissoes(permissoes), [permissoes]);
  const permissoesFiltradasPorModulo = useMemo(() => {
    const termo = normalizarBusca(buscaPermissao);
    return Object.entries(permissoesPorModulo)
      .map(([modulo, itens]) => [
        modulo,
        itens.filter((permissao) => {
          const ativa = permissoesPerfilDraft.includes(permissao.chave);
          if (mostrarSomenteAtivas && !ativa) return false;
          if (!termo) return true;
          return textoCampos(modulo, permissao.chave, permissao.descricao).includes(termo);
        }),
      ])
      .filter(([, itens]) => itens.length > 0);
  }, [permissoesPorModulo, buscaPermissao, mostrarSomenteAtivas, permissoesPerfilDraft]);
  const secaoCatalogoAtiva = useMemo(
    () => catalogo.find((secao) => secao.tipo === tipoCatalogo) || catalogo[0] || null,
    [catalogo, tipoCatalogo],
  );
  const perfilSelecionado = useMemo(
    () => perfis.find((perfil) => perfil.id === perfilSelecionadoId) || null,
    [perfis, perfilSelecionadoId],
  );
  const perfilComparado = useMemo(
    () => perfis.find((perfil) => perfil.id === perfilComparadoId) || null,
    [perfis, perfilComparadoId],
  );
  const abaRenderizada = abasPermitidas.some((aba) => aba.id === abaAtiva)
    ? abaAtiva
    : abasPermitidas[0]?.id || '';

  useEffect(() => {
    if (abaRenderizada === 'operacoes') setTipoCatalogo('operacoes');
  }, [abaRenderizada]);

  const fecharDrawerUsuario = () => {
    setDrawerUsuarioAberto(false);
    setMenuUsuarioAbertoId('');
    setMenuUsuarioPosicao(null);
    setConfirmandoExclusaoUsuario(false);
  };

  useEffect(() => {
    if (telaAtual === 'screen-settings-monitoria-logs') setSubAbaLogs('monitoria');
  }, [telaAtual]);

  useEffect(() => {
    const abaDaRota = ABA_POR_TELA[telaAtual];
    if (abaDaRota && abaDaRota !== abaAtiva) {
      setAbaAtiva(abaDaRota);
    }
  }, [telaAtual, abaAtiva]);

  // Correções.txt item 2: feedback (toast de sucesso/erro) não pode
  // sobreviver a uma troca de aba/tela — limpa ao trocar de aba e também
  // por timeout, mesmo que o timeout anterior ainda não tenha disparado.
  useEffect(() => {
    setFeedback('');
    setErro('');
  }, [abaAtiva]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(''), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!abasPermitidas.some((aba) => aba.id === abaAtiva)) {
      setAbaAtiva(abasPermitidas[0]?.id || 'usuarios');
    }
  }, [abasPermitidas.map((aba) => aba.id).join('|'), abaAtiva]);

  useEffect(() => {
    if (!perfis.length) {
      setPerfilSelecionadoId('');
      return;
    }
    if (perfilSelecionadoId && !perfis.some((perfil) => perfil.id === perfilSelecionadoId)) {
      setPerfilSelecionadoId('');
    }
  }, [perfis, perfilSelecionadoId]);

  useEffect(() => {
    setPermissoesPerfilDraft(normalizarLista(perfilSelecionado?.permissoes));
    setJustificativaPerfil('');
  }, [perfilSelecionado?.id, normalizarLista(perfilSelecionado?.permissoes).join('|')]);

  useEffect(() => {
    if (criandoUsuario) return;
    if (!usuarios.length) {
      setUsuarioSelecionadoId('');
      setFormUsuario(FORM_USUARIO_INICIAL);
      return;
    }
    if (!usuarioSelecionadoId || !usuarios.some((usuario) => String(usuario.id_usuario) === String(usuarioSelecionadoId))) {
      setUsuarioSelecionadoId(usuarios[0].id_usuario);
    }
  }, [usuarios, usuarioSelecionadoId, criandoUsuario]);

  useEffect(() => {
    if (criandoUsuario) {
      setFormUsuario(FORM_USUARIO_INICIAL);
      return;
    }
    const usuario = usuarios.find((item) => String(item.id_usuario) === String(usuarioSelecionadoId));
    if (!usuario) return;
    setFormUsuario({
      ...FORM_USUARIO_INICIAL,
      ...usuario,
      id_usuario: textoSeguro(usuario.id_usuario, ''),
      nome: textoSeguro(usuario.nome, ''),
      sobrenome: textoSeguro(usuario.sobrenome, ''),
      email: textoSeguro(usuario.email, ''),
      login: textoSeguro(usuario.login, ''),
      perfil: textoSeguro(usuario.perfil || usuario.perfil_id, FORM_USUARIO_INICIAL.perfil),
      status: textoSeguro(usuario.status, FORM_USUARIO_INICIAL.status),
      provedor_autenticacao: textoSeguro(usuario.provedor_autenticacao, 'local'),
      operacoes: Array.isArray(usuario.operacoes) ? usuario.operacoes : [],
      senha: '',
      justificativa: '',
    });
  }, [usuarioSelecionadoId, criandoUsuario, usuarios]);

  const carregarAba = async (aba) => {
    setCarregando(true);
    setErro('');
    try {
      const tarefas = [];
      if (aba === 'usuarios' && controlador.possuiPermissao('usuarios.visualizar')) {
        tarefas.push(listarUsuarios().then((valor) => setUsuarios(normalizarLista(valor))));
        tarefas.push(
          listarOperacoes().then((valor) =>
            setOperacoesDisponiveis(Array.isArray(valor) ? valor : valor?.itens || []),
          ),
        );
      }
      if (aba === 'usuarios' && controlador.possuiPermissao('usuarios.alterar_email')) {
        tarefas.push(carregarSolicitacoesEmailPendentes());
      }
      if ((aba === 'usuarios' || aba === 'perfis') && controlador.possuiPermissao('configuracoes.visualizar')) {
        tarefas.push(listarPerfis().then((valor) => setPerfis(normalizarLista(valor))));
      }
      if (aba === 'perfis' && controlador.possuiPermissao('configuracoes.visualizar')) {
        tarefas.push(listarPermissoes().then((valor) => setPermissoes(normalizarLista(valor))));
      }
      if ((aba === 'operacoes' || aba === 'catalogos') && controlador.possuiPermissao('configuracoes.visualizar')) {
        tarefas.push(
          listarCatalogoConfiguracoes().then((valor) => {
            const secoes = normalizarLista(valor?.sections);
            setCatalogo(secoes);
            setTipoCatalogo((atual) =>
              secoes.some((secao) => secao.tipo === atual) ? atual : secoes[0]?.tipo || '',
            );
          }),
        );
      }
      if (aba === 'notificacoes' && controlador.possuiPermissao('notificacoes.configurar')) {
        tarefas.push(
          lerAutomacaoNotificacoes().then((valor) => {
            setAutomacaoNotificacoes({
              email_automatico_ativo: Boolean(valor?.email_automatico_ativo),
              lembretes_automaticos_ativos: Boolean(valor?.lembretes_automaticos_ativos),
            });
          }),
        );
      }
      if (aba === 'logs' && controlador.possuiPermissao('logs.visualizar')) {
        tarefas.push(listarLogsAuditoria({ limit: 160 }).then((valor) => setLogs(normalizarLista(valor))));
      }

      const resultados = await Promise.allSettled(tarefas);
      const falha = resultados.find((item) => item.status === 'rejected');
      if (falha) {
        setErro(falha.reason?.message || 'Não foi possível carregar as configurações desta aba.');
      }
      setUltimaAtualizacao(new Date());
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (abaRenderizada) carregarAba(abaRenderizada);
  }, [abaRenderizada]);

  useEffect(() => {
    if (!drawerUsuarioAberto) return undefined;
    const fecharComEsc = (event) => {
      if (event.key === 'Escape') fecharDrawerUsuario();
    };
    document.addEventListener('keydown', fecharComEsc);
    return () => document.removeEventListener('keydown', fecharComEsc);
  }, [drawerUsuarioAberto]);

  useEffect(() => {
    if (!menuUsuarioAbertoId) return undefined;
    const fecharMenu = () => {
      setMenuUsuarioAbertoId('');
      setMenuUsuarioPosicao(null);
    };
    const fecharComEsc = (event) => {
      if (event.key === 'Escape') fecharMenu();
    };
    document.addEventListener('click', fecharMenu);
    document.addEventListener('keydown', fecharComEsc);
    window.addEventListener('resize', fecharMenu);
    window.addEventListener('scroll', fecharMenu, true);
    return () => {
      document.removeEventListener('click', fecharMenu);
      document.removeEventListener('keydown', fecharComEsc);
      window.removeEventListener('resize', fecharMenu);
      window.removeEventListener('scroll', fecharMenu, true);
    };
  }, [menuUsuarioAbertoId]);

  const selecionarUsuario = (usuario) => {
    setErro('');
    setCriandoUsuario(false);
    setUsuarioSelecionadoId(usuario.id_usuario);
    setFormUsuario({
      ...FORM_USUARIO_INICIAL,
      ...usuario,
      id_usuario: textoSeguro(usuario.id_usuario, ''),
      nome: textoSeguro(usuario.nome, ''),
      sobrenome: textoSeguro(usuario.sobrenome, ''),
      email: textoSeguro(usuario.email, ''),
      login: textoSeguro(usuario.login, ''),
      perfil: textoSeguro(usuario.perfil || usuario.perfil_id, FORM_USUARIO_INICIAL.perfil),
      cargo: textoSeguro(usuario.cargo, ''),
      status: textoSeguro(usuario.status, FORM_USUARIO_INICIAL.status),
      provedor_autenticacao: textoSeguro(usuario.provedor_autenticacao, 'local'),
      operacoes: Array.isArray(usuario.operacoes) ? usuario.operacoes : [],
      senha: '',
      justificativa: '',
    });
    setMenuUsuarioAbertoId('');
    setMenuUsuarioPosicao(null);
    setConfirmandoExclusaoUsuario(false);
    setModoEdicaoUsuario(false);
    setDrawerUsuarioAberto(true);
  };

  const iniciarNovoUsuario = () => {
    setErro('');
    setCriandoUsuario(true);
    setUsuarioSelecionadoId('');
    setFormUsuario(FORM_USUARIO_INICIAL);
    setMenuUsuarioAbertoId('');
    setMenuUsuarioPosicao(null);
    setConfirmandoExclusaoUsuario(false);
    setModoEdicaoUsuario(true);
    setDrawerUsuarioAberto(true);
  };

  const salvarUsuario = async (event) => {
    event.preventDefault();
    const email = String(formUsuario.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErro('Informe um e-mail válido.');
      return;
    }
    const perfilMonitoria = PERFIS_MONITORIA.includes(formUsuario.perfil);
    const operacoesSelecionadas = Array.isArray(formUsuario.operacoes) ? formUsuario.operacoes : [];
    if (perfilMonitoria) {
      const errosVinculos = validarVinculosMonitoria(formUsuario.perfil, operacoesSelecionadas, vinculosMon);
      if (errosVinculos.length) {
        setErro(errosVinculos.join(' '));
        return;
      }
    }
    setSalvando(true);
    setErro('');
    setFeedback('');
    try {
      const payload = {
        nome: formUsuario.nome,
        sobrenome: formUsuario.sobrenome,
        email,
        login: formUsuario.login || email,
        perfil: formUsuario.perfil,
        cargo: formUsuario.cargo,
        status: formUsuario.status,
        provedor_autenticacao: formUsuario.provedor_autenticacao,
        operacoes: formUsuario.perfil === 'control_desk' ? [] : operacoesSelecionadas,
        justificativa: formUsuario.justificativa,
      };
      const gravarVinculosMonitoria = (idUsuario) => salvarVinculosUsuarioMonitoria(idUsuario, {
        operacoes: formUsuario.perfil === 'control_desk' ? [] : operacoesSelecionadas,
        supervisores: formUsuario.perfil === 'operador' ? vinculosMon.supervisores : [],
        id_equipe: formUsuario.perfil === 'operador' && vinculosMon.id_equipe ? Number(vinculosMon.id_equipe) : null,
        turno: ['operador', 'supervisor'].includes(formUsuario.perfil) ? vinculosMon.turno || null : null,
        canais: ['operador', 'supervisor'].includes(formUsuario.perfil) ? vinculosMon.canais || [] : [],
      });
      if (formUsuario.id_usuario) {
        await atualizarUsuario(formUsuario.id_usuario, payload);
        if (perfilMonitoria) await gravarVinculosMonitoria(formUsuario.id_usuario);
        if (formUsuario.senha) {
          await redefinirSenhaUsuario(formUsuario.id_usuario, {
            senha: formUsuario.senha,
            justificativa: formUsuario.justificativa || 'Senha redefinida em Configurações.',
          });
        }
        setFeedback('Usuário atualizado com sucesso.');
      } else {
        const criado = await criarUsuario({ ...payload, senha: formUsuario.senha });
        if (perfilMonitoria && criado?.id_usuario) {
          try {
            await gravarVinculosMonitoria(criado.id_usuario);
          } catch (falhaVinculos) {
            // O usuário já existe: avisa e recarrega a lista para não sugerir que nada foi criado.
            setCriandoUsuario(false);
            setDrawerUsuarioAberto(false);
            await carregarAba(abaRenderizada);
            setErro(`Usuário criado, mas os vínculos da Monitoria (turno, canais, equipe) não foram salvos: ${falhaVinculos?.message || 'erro desconhecido'}. Abra o usuário para completar.`);
            return;
          }
        }
        setFeedback('Usuário criado com sucesso.');
      }
      setCriandoUsuario(false);
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar o usuário.');
    } finally {
      setSalvando(false);
    }
  };

  const abrirCriacaoUsuarioRapido = async () => {
    setFormUsuarioRapido({ nome: '', email: '', senha: '' });
    setErroUsuarioRapido('');
    setBuscaCandidatoRapido('');
    setDrawerUsuarioRapidoAberto(true);
    setCarregandoCandidatosAprovados(true);
    try {
      const candidatos = await lerCandidatosProcessos();
      const aprovados = (Array.isArray(candidatos) ? candidatos : []).filter(
        (candidato) =>
          canonicalizeCandidateStatus(candidato.status_fluxo || candidato.status_candidato) === 'Aprovado',
      );
      setCandidatosAprovados(aprovados);
    } catch (error) {
      setErroUsuarioRapido('Não foi possível carregar a lista de candidatos aprovados.');
    } finally {
      setCarregandoCandidatosAprovados(false);
    }
  };

  const fecharUsuarioRapido = () => {
    setDrawerUsuarioRapidoAberto(false);
    setErroUsuarioRapido('');
  };

  const selecionarCandidatoAprovadoRapido = (candidato) => {
    setFormUsuarioRapido({
      ...formUsuarioRapido,
      nome: candidato.nome_candidato || candidato.nome || '',
      email: candidato.email || '',
    });
  };

  const salvarUsuarioRapido = async (event) => {
    event.preventDefault();
    const email = String(formUsuarioRapido.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErroUsuarioRapido('Informe um e-mail válido.');
      return;
    }
    if (!formUsuarioRapido.nome.trim()) {
      setErroUsuarioRapido('Informe o nome.');
      return;
    }
    if (!formUsuarioRapido.senha) {
      setErroUsuarioRapido('Informe uma senha.');
      return;
    }
    setSalvandoUsuarioRapido(true);
    setErroUsuarioRapido('');
    try {
      await criarUsuarioRapido({ nome: formUsuarioRapido.nome.trim(), email, senha: formUsuarioRapido.senha });
      setFeedback('Usuário de treinamento criado com sucesso. A atribuição do treinamento fica a cargo da Gestão de Treinamentos.');
      setDrawerUsuarioRapidoAberto(false);
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErroUsuarioRapido(error?.message || 'Não foi possível criar o usuário.');
    } finally {
      setSalvandoUsuarioRapido(false);
    }
  };

  const candidatosAprovadosFiltrados = candidatosAprovados.filter((candidato) => {
    const termo = buscaCandidatoRapido.trim().toLowerCase();
    if (!termo) return true;
    return String(candidato.nome_candidato || candidato.nome || '').toLowerCase().includes(termo)
      || String(candidato.email || '').toLowerCase().includes(termo);
  });

  const alterarStatus = async (usuario, acao) => {
    setErro('');
    setFeedback('');
    try {
      await alterarStatusUsuario(usuario.id_usuario, {
        acao,
        justificativa: `Status alterado por Configurações: ${acao}.`,
      });
      setFeedback('Status do usuário atualizado.');
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível alterar o status do usuário.');
    }
  };

  const redefinirMfa = async (usuario) => {
    if (!window.confirm(`Redefinir o MFA de ${usuario.nome || usuario.email}? A pessoa precisará configurar novamente no próximo acesso.`)) return;
    setErro('');
    setFeedback('');
    try {
      await redefinirMfaUsuario(usuario.id_usuario, 'MFA redefinido por Configurações.');
      setFeedback('MFA do usuário redefinido.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível redefinir o MFA do usuário.');
    }
  };

  const desativarUsuario = async (usuario) => {
    if (!window.confirm(`Desativar o usuário ${usuario.nome || usuario.email}?`)) return;
    setErro('');
    setFeedback('');
    try {
      await alterarStatusUsuario(usuario.id_usuario, {
        acao: 'desativar',
        justificativa: 'Desativação por Configurações.',
      });
      setFeedback('Usuário desativado.');
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível desativar o usuário.');
    }
  };

  const excluirUsuarioSelecionado = async () => {
    if (!formUsuario.id_usuario || !controlador.possuiPermissao('usuarios.excluir')) return;
    setSalvando(true);
    setErro('');
    setFeedback('');
    try {
      await excluirUsuario(formUsuario.id_usuario, 'Exclusão solicitada em Configurações.');
      setFeedback('Usuário excluído com sucesso.');
      fecharDrawerUsuario();
      setCriandoUsuario(false);
      setUsuarioSelecionadoId('');
      setFormUsuario(FORM_USUARIO_INICIAL);
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir o usuário.');
    } finally {
      setSalvando(false);
    }
  };

  useEffect(() => {
    if (!enderecoPrincipalItem) return;
    const payload = enderecoPrincipalItem.payload || {};
    setFormEndereco({
      id_item: enderecoPrincipalItem.id_item || '',
      rua: payload.rua || '',
      numero: payload.numero || '',
      complemento: payload.complemento || '',
      bairro: payload.bairro || '',
      cidade: payload.cidade || '',
      uf: payload.uf || '',
      cep: payload.cep || '',
    });
  }, [enderecoPrincipalItem]);

  const salvarEnderecoPrincipal = async (event) => {
    event.preventDefault();
    setSalvandoEndereco(true);
    setErro('');
    setFeedback('');
    try {
      const data = {
        chave: ENDERECO_PRINCIPAL_CHAVE,
        nome: 'Endereço principal da empresa',
        descricao: '',
        categoria: 'endereco_empresa',
        payload: {
          rua: formEndereco.rua,
          numero: formEndereco.numero,
          complemento: formEndereco.complemento,
          bairro: formEndereco.bairro,
          cidade: formEndereco.cidade,
          uf: formEndereco.uf,
          cep: formEndereco.cep,
        },
        ativo: true,
        justificativa: 'Endereço principal da empresa (Configurações > Operações).',
      };
      if (formEndereco.id_item) {
        await atualizarItemConfiguracao('geral', formEndereco.id_item, data);
      } else {
        await criarItemConfiguracao('geral', data);
      }
      setFeedback('Endereço principal atualizado.');
      setEditandoEndereco(false);
      await carregarAba('operacoes');
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar o endereço principal.');
    } finally {
      setSalvandoEndereco(false);
    }
  };

  const editarItem = (item) => {
    const payload = item.payload || {};
    setFormItem({
      id_item: item.id_item || '',
      chave: item.chave || '',
      nome: item.nome || '',
      descricao: item.descricao || '',
      categoria: item.categoria || '',
      criticidade: payload.criticidade || payload.severidade || 'operacional',
      tags: formatarCsv(payload.tags),
      aplicavel: payload.aplicavel || payload.aplicavel_a || 'todos',
      permissoes: formatarCsv(payload.permissoes),
      payloadJson: JSON.stringify(payload || {}, null, 2),
      ativo: Boolean(item.ativo),
      justificativa: '',
      cliente: payload.cliente || '',
      modalidadeOperacao: payload.modalidade || '',
      slaAtendimento: payload.sla_atendimento || '',
      headcountPrevisto: payload.headcount_previsto ? String(payload.headcount_previsto) : '',
      softwaresUtilizados: formatarCsv(payload.softwares_utilizados),
      sistemasAcesso: normalizarLista(payload.sistemas_acesso).map((sistema) => ({
        nome: sistema?.nome || '',
        descricao: sistema?.descricao || '',
      })),
      duracaoMinutos: payload.duracao_minutos ? String(payload.duracao_minutos) : '',
      toleranciaMinutos: payload.tolerancia_minutos ? String(payload.tolerancia_minutos) : '',
      subCausas: formatarCsv(payload.sub_causas),
      corTag: payload.cor_tag || '#2563eb',
      finalidadeOperacao: payload.finalidade || '',
      segmentoMercado: payload.segmento_mercado || '',
      areaSegmento: payload.area_segmento || '',
      unidadeTipo: payload.unidade_tipo || '',
      unidadeEnderecosHibrido: normalizarLista(payload.unidade_enderecos_hibrido),
      unidadeEnderecoCliente: payload.unidade_endereco_cliente || '',
      jornadasTrabalho: normalizarLista(payload.jornadas_trabalho),
      turnoEscala: payload.turno_escala || '',
      necessitaDisponibilidade: Boolean(payload.necessita_disponibilidade),
      descricaoCliente: payload.descricao_cliente || '',
      descricaoAtividades: payload.descricao_atividades || '',
    });
  };

  const adicionarSistemaAcesso = () => {
    setFormItem((atual) => ({
      ...atual,
      sistemasAcesso: [...normalizarLista(atual.sistemasAcesso), { ...SISTEMA_ACESSO_INICIAL }],
    }));
  };

  const atualizarSistemaAcesso = (indice, campo, valor) => {
    setFormItem((atual) => ({
      ...atual,
      sistemasAcesso: normalizarLista(atual.sistemasAcesso).map((sistema, indiceAtual) =>
        indiceAtual === indice ? { ...sistema, [campo]: valor } : sistema,
      ),
    }));
  };

  const removerSistemaAcesso = (indice) => {
    setFormItem((atual) => ({
      ...atual,
      sistemasAcesso: normalizarLista(atual.sistemasAcesso).filter((_, indiceAtual) => indiceAtual !== indice),
    }));
  };

  const adicionarEnderecoHibrido = () => {
    setFormItem((atual) => ({
      ...atual,
      unidadeEnderecosHibrido: [...normalizarLista(atual.unidadeEnderecosHibrido), ''],
    }));
  };

  const atualizarEnderecoHibrido = (indice, valor) => {
    setFormItem((atual) => ({
      ...atual,
      unidadeEnderecosHibrido: normalizarLista(atual.unidadeEnderecosHibrido).map(
        (endereco, indiceAtual) => (indiceAtual === indice ? valor : endereco),
      ),
    }));
  };

  const removerEnderecoHibrido = (indice) => {
    setFormItem((atual) => ({
      ...atual,
      unidadeEnderecosHibrido: normalizarLista(atual.unidadeEnderecosHibrido).filter((_, indiceAtual) => indiceAtual !== indice),
    }));
  };

  const alternarJornadaOperacao = (valor) => {
    setFormItem((atual) => {
      const atuais = normalizarLista(atual.jornadasTrabalho);
      const jornadasTrabalho = atuais.includes(valor)
        ? atuais.filter((item) => item !== valor)
        : [...atuais, valor];
      return { ...atual, jornadasTrabalho };
    });
  };

  const duplicarItem = (item) => {
    editarItem(item);
    setFormItem((atual) => ({
      ...atual,
      id_item: '',
      nome: `Cópia de ${item.nome || 'item'}`,
      chave: item.chave ? `${item.chave}_copia` : '',
      justificativa: 'Duplicação de regra reutilizável.',
    }));
  };

  const salvarItem = async (event) => {
    event.preventDefault();
    if (!secaoCatalogoAtiva) return;
    setSalvando(true);
    setErro('');
    setFeedback('');
    try {
      let payload = {};
      try {
        payload = JSON.parse(formItem.payloadJson || '{}');
      } catch (error) {
        throw new Error('O payload JSON da configuração está inválido.');
      }
      payload = {
        ...payload,
        criticidade: formItem.criticidade,
        tags: dividirCsv(formItem.tags),
        aplicavel: formItem.aplicavel,
        permissoes: dividirCsv(formItem.permissoes),
      };

      if (secaoCatalogoAtiva.tipo === 'operacoes') {
        payload = {
          ...payload,
          cliente: formItem.cliente,
          modalidade: formItem.modalidadeOperacao,
          sla_atendimento: formItem.slaAtendimento,
          headcount_previsto: formItem.headcountPrevisto ? Number(formItem.headcountPrevisto) : null,
          softwares_utilizados: dividirCsv(formItem.softwaresUtilizados),
          sistemas_acesso: normalizarLista(formItem.sistemasAcesso).filter((sistema) => sistema.nome?.trim()),
          cor_tag: formItem.corTag || '#2563eb',
          finalidade: formItem.finalidadeOperacao,
          segmento_mercado: formItem.segmentoMercado,
          area_segmento: formItem.areaSegmento,
          unidade_tipo: formItem.unidadeTipo,
          unidade_enderecos_hibrido: normalizarLista(formItem.unidadeEnderecosHibrido).filter((endereco) => String(endereco || '').trim()),
          unidade_endereco_cliente: formItem.unidadeEnderecoCliente,
          jornadas_trabalho: normalizarLista(formItem.jornadasTrabalho),
          turno_escala: formItem.turnoEscala,
          necessita_disponibilidade: Boolean(formItem.necessitaDisponibilidade),
          descricao_cliente: formItem.descricaoCliente,
          descricao_atividades: formItem.descricaoAtividades,
        };
      }

      if (secaoCatalogoAtiva.tipo === 'etapas') {
        payload = {
          ...payload,
          duracao_minutos: formItem.duracaoMinutos ? Number(formItem.duracaoMinutos) : null,
          tolerancia_minutos: formItem.toleranciaMinutos ? Number(formItem.toleranciaMinutos) : null,
        };
      }

      if (secaoCatalogoAtiva.tipo === 'motivos_eliminacao') {
        payload = {
          ...payload,
          sub_causas: dividirCsv(formItem.subCausas),
        };
      }

      const data = {
        chave: secaoCatalogoAtiva.tipo === 'operacoes'
          ? String(formItem.nome || '').trim().toUpperCase()
          : formItem.chave,
        nome: formItem.nome,
        descricao: formItem.descricao,
        categoria: formItem.categoria,
        payload,
        ativo: formItem.ativo,
        justificativa: formItem.justificativa,
      };

      if (formItem.id_item) {
        await atualizarItemConfiguracao(secaoCatalogoAtiva.tipo, formItem.id_item, data);
        setFeedback('Configuração atualizada.');
      } else {
        await criarItemConfiguracao(secaoCatalogoAtiva.tipo, data);
        setFeedback('Configuração criada.');
      }
      setFormItem(FORM_ITEM_INICIAL);
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar a configuração.');
    } finally {
      setSalvando(false);
    }
  };

  const desativarItem = async (item) => {
    if (!secaoCatalogoAtiva) return;
    if (!window.confirm(`Arquivar ${item.nome || 'este item'}?`)) return;
    setErro('');
    setFeedback('');
    try {
      await desativarItemConfiguracao(
        secaoCatalogoAtiva.tipo,
        item.id_item,
        'Arquivamento lógico por Configurações.',
      );
      setFeedback('Configuração arquivada.');
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível arquivar a configuração.');
    }
  };

  const salvarPermissoesPerfil = async () => {
    if (!perfilSelecionado) return;
    setSalvando(true);
    setErro('');
    setFeedback('');
    try {
      await atualizarPermissoesPerfil(perfilSelecionado.id, {
        permissoes: permissoesPerfilDraft,
        justificativa: justificativaPerfil,
      });
      setFeedback('Permissões do perfil atualizadas.');
      await carregarAba(abaRenderizada);
    } catch (error) {
      setErro(error?.message || 'Não foi possível salvar as permissões do perfil.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarPermissao = (chave) => {
    setPermissoesPerfilDraft((atuais) => {
      const conjunto = new Set(atuais);
      if (conjunto.has(chave)) conjunto.delete(chave);
      else conjunto.add(chave);
      return Array.from(conjunto).sort();
    });
  };

  const alterarGrupoPermissoes = (itens, ativo) => {
    setPermissoesPerfilDraft((atuais) => {
      const conjunto = new Set(atuais);
      normalizarLista(itens).forEach((permissao) => {
        if (ativo) conjunto.add(permissao.chave);
        else conjunto.delete(permissao.chave);
      });
      return Array.from(conjunto).sort();
    });
  };

  const selecionarPerfilPermissoes = (idPerfil) => {
    setPerfilSelecionadoId(idPerfil);
    setPerfilComparadoId((atual) => (atual === idPerfil ? '' : atual));
  };

  const abrirUsuariosDoPerfil = () => {
    if (!perfilSelecionado) return;
    setFiltrosUsuarios((atuais) => ({ ...atuais, perfil: perfilSelecionado.id }));
    setPaginaUsuarios(1);
    setAbaAtiva('usuarios');
  };

  const exportarLogs = async () => {
    setErro('');
    try {
      const arquivo = await baixarLogsAuditoria();
      baixarBlob(arquivo.filename || 'logs_auditoria.csv', arquivo.blob);
    } catch (error) {
      setErro(error?.message || 'Não foi possível exportar os logs.');
    }
  };

  const usuariosFiltrados = useMemo(() => {
    const busca = normalizarBusca(filtrosUsuarios.busca);
    const status = normalizarBusca(filtrosUsuarios.status);
    const perfil = normalizarBusca(filtrosUsuarios.perfil);
    const area = normalizarBusca(filtrosUsuarios.area);
    const acesso = filtrosUsuarios.acesso;
    const agora = Date.now();
    return usuarios.filter((usuario) => {
      const texto = textoCampos(
        textoSeguro(usuario?.nome, ''),
        textoSeguro(usuario?.email, ''),
        textoSeguro(usuario?.login, ''),
        textoSeguro(usuario?.perfil_nome, ''),
        textoSeguro(usuario?.perfil, ''),
        textoSeguro(usuario?.nivel, ''),
        textoSeguro(usuario?.area, ''),
        textoSeguro(usuario?.operacao, ''),
        textoSeguro(usuario?.departamento, ''),
      );
      if (busca && !texto.includes(busca)) return false;
      if (status && normalizarBusca(textoSeguro(usuario?.status, '')) !== status) return false;
      if (perfil && normalizarBusca(textoSeguro(usuario?.perfil, '')) !== perfil) return false;
      if (area) {
        const operacoesUsuario = (Array.isArray(usuario?.operacoes) ? usuario.operacoes : []).map((item) => normalizarBusca(item));
        const textoArea = textoCampos(
          textoSeguro(usuario?.area, ''),
          textoSeguro(usuario?.operacao, ''),
          textoSeguro(usuario?.departamento, ''),
        );
        if (!operacoesUsuario.includes(area) && !textoArea.includes(area)) return false;
      }
      if (acesso === 'sem_acesso' && usuario?.ultimo_acesso) return false;
      if (acesso === 'recentes') {
        const data = new Date(usuario?.ultimo_acesso);
        if (Number.isNaN(data.getTime()) || agora - data.getTime() > 1000 * 60 * 60 * 24 * 7) {
          return false;
        }
      }
      return true;
    });
  }, [usuarios, filtrosUsuarios]);

  const paginacaoUsuarios = useMemo(
    () => obterItensPaginados(usuariosFiltrados, paginaUsuarios, 7),
    [usuariosFiltrados, paginaUsuarios],
  );
  const filtrosUsuariosAtivos = [
    filtrosUsuarios.busca,
    filtrosUsuarios.status,
    filtrosUsuarios.perfil,
    filtrosUsuarios.area,
    filtrosUsuarios.acesso,
  ].filter((valor) => String(valor || '').trim()).length;

  const limparFiltrosUsuarios = () => {
    setFiltrosUsuarios({ busca: '', status: '', perfil: '', area: '', acesso: '' });
    setPaginaUsuarios(1);
    setPainelFiltrosUsuariosAberto(false);
  };

  const usuariosPorPerfil = useMemo(() => {
    return usuarios.reduce((mapa, usuario) => {
      const id = usuario.perfil || usuario.perfil_id || '';
      if (!id) return mapa;
      mapa[id] = mapa[id] || [];
      mapa[id].push(usuario);
      return mapa;
    }, {});
  }, [usuarios]);

  const contagemUsuariosPorPerfil = useMemo(() => {
    return Object.fromEntries(
      Object.entries(usuariosPorPerfil).map(([idPerfil, usuariosPerfil]) => [idPerfil, usuariosPerfil.length]),
    );
  }, [usuariosPorPerfil]);

  const perfilMaisUsado = useMemo(() => {
    const ordenados = Object.entries(contagemUsuariosPorPerfil).sort((a, b) => b[1] - a[1]);
    const idPerfil = ordenados[0]?.[0] || '';
    return perfis.find((perfil) => perfil.id === idPerfil)?.nome || '-';
  }, [contagemUsuariosPorPerfil, perfis]);

  const usuariosPerfilSelecionado = useMemo(
    () => (perfilSelecionado ? usuariosPorPerfil[perfilSelecionado.id] || [] : []),
    [perfilSelecionado?.id, usuariosPorPerfil],
  );

  const permissoesOriginaisPerfil = useMemo(
    () => normalizarLista(perfilSelecionado?.permissoes),
    [perfilSelecionado?.id, perfilSelecionado?.permissoes],
  );

  const alteracoesPendentesPerfil = useMemo(() => {
    const originais = new Set(permissoesOriginaisPerfil);
    const rascunho = new Set(permissoesPerfilDraft);
    let total = 0;
    rascunho.forEach((chave) => {
      if (!originais.has(chave)) total += 1;
    });
    originais.forEach((chave) => {
      if (!rascunho.has(chave)) total += 1;
    });
    return total;
  }, [permissoesOriginaisPerfil, permissoesPerfilDraft]);

  const itensCatalogo = normalizarLista(secaoCatalogoAtiva?.items);
  const itensCatalogoFiltrados = useMemo(() => {
    const busca = normalizarBusca(filtrosCatalogo.busca);
    const status = filtrosCatalogo.status;
    return itensCatalogo.filter((item) => {
      const texto = textoCampos(item.nome, item.chave, item.descricao, item.categoria);
      if (busca && !texto.includes(busca)) return false;
      if (status === 'ativo' && !item.ativo) return false;
      if (status === 'inativo' && item.ativo) return false;
      return true;
    });
  }, [itensCatalogo, filtrosCatalogo]);

  const itemEmEdicao = useMemo(
    () => itensCatalogo.find((item) => String(item.id_item) === String(formItem.id_item)) || null,
    [itensCatalogo, formItem.id_item],
  );

  const logsFiltrados = useMemo(() => {
    const busca = normalizarBusca(filtrosLogs.busca);
    const modulo = normalizarBusca(filtrosLogs.modulo);
    const acao = normalizarBusca(filtrosLogs.acao);
    const usuario = normalizarBusca(filtrosLogs.usuario);
    const criticidade = normalizarBusca(filtrosLogs.criticidade);
    const statusLog = filtrosLogs.status;
    const inicioHoje = hojeSemHora().getTime();
    return logs.filter((log) => {
      const texto = textoCampos(
        log.nome_usuario,
        log.email_usuario,
        log.perfil_nome,
        log.modulo,
        log.acao,
        log.entidade,
        log.entidade_id,
        log.justificativa,
        log.origem,
      );
      if (busca && !texto.includes(busca)) return false;
      if (modulo && !normalizarBusca(log.modulo).includes(modulo)) return false;
      if (acao && !normalizarBusca(log.acao).includes(acao)) return false;
      if (usuario && !textoCampos(log.nome_usuario, log.email_usuario).includes(usuario)) return false;
      if (criticidade && normalizarBusca(inferirCriticidadeLog(log)) !== criticidade) return false;
      if (statusLog === 'sucesso' && log.sucesso === false) return false;
      if (statusLog === 'falha' && log.sucesso !== false) return false;
      if (filtrosLogs.periodo) {
        const data = new Date(log.data_hora);
        if (Number.isNaN(data.getTime())) return false;
        if (filtrosLogs.periodo === 'hoje' && data.getTime() < inicioHoje) return false;
        if (filtrosLogs.periodo === '7d' && Date.now() - data.getTime() > 1000 * 60 * 60 * 24 * 7) return false;
        if (filtrosLogs.periodo === '30d' && Date.now() - data.getTime() > 1000 * 60 * 60 * 24 * 30) return false;
      }
      return true;
    });
  }, [logs, filtrosLogs]);

  const paginacaoLogs = useMemo(
    () => obterItensPaginados(logsFiltrados, paginaLogs, 9),
    [logsFiltrados, paginaLogs],
  );

  const modulosLogs = useMemo(
    () => Array.from(new Set(logs.map((log) => log.modulo).filter(Boolean))).sort(),
    [logs],
  );

  const acoesLogs = useMemo(
    () => Array.from(new Set(logs.map((log) => log.acao).filter(Boolean))).sort(),
    [logs],
  );

  const metricasGerais = [
    {
      icon: 'group',
      label: 'Usuários ativos',
      value: contarPor(usuarios, (usuario) => normalizarBusca(usuario.status) === 'ativo'),
      helper: `${usuarios.length} cadastrados`,
      tone: 'blue',
    },
    {
      icon: 'admin_panel_settings',
      label: 'Perfis',
      value: perfis.length,
      helper: `${permissoes.length} permissões mapeadas`,
      tone: 'indigo',
    },
    {
      icon: 'rule_settings',
      label: 'Regras ativas',
      value: catalogo.reduce(
        (total, secao) => total + contarPor(secao.items, (item) => item.ativo),
        0,
      ),
      helper: `${catalogo.length} catálogos`,
      tone: 'green',
    },
    {
      icon: 'warning',
      label: 'Alertas',
      value: contarPor(logs, (log) => log.sucesso === false),
      helper: 'Falhas em auditoria',
      tone: 'yellow',
    },
  ];

  // Correções.txt item 4c: métricas do catálogo atualmente selecionado
  // (ex.: Operações), não contagens genéricas de todos os catálogos juntos —
  // só métricas com dado real por trás (ativo/inativo e atualizado_em já
  // vêm do backend; nada aqui é inventado).
  const metricasOperacoes = useMemo(() => {
    const ativos = contarPor(itensCatalogo, (item) => item.ativo);
    const arquivados = itensCatalogo.length - ativos;
    const ultimaAtualizacao = itensCatalogo.reduce((maisRecente, item) => {
      const data = item.atualizado_em || item.criado_em;
      if (!data) return maisRecente;
      return !maisRecente || new Date(data) > new Date(maisRecente) ? data : maisRecente;
    }, null);
    return [
      {
        icon: 'check_circle',
        label: 'Itens ativos',
        value: ativos,
        helper: secaoCatalogoAtiva?.label || 'Nenhum catálogo selecionado',
        tone: 'green',
      },
      {
        icon: 'archive',
        label: 'Itens arquivados',
        value: arquivados,
        helper: `${itensCatalogo.length} no total`,
        tone: 'indigo',
      },
      {
        icon: 'history',
        label: 'Última atualização',
        value: ultimaAtualizacao ? formatarDataHora(ultimaAtualizacao) : '—',
        helper: 'Item mais recente do catálogo atual',
        tone: 'blue',
      },
    ];
  }, [itensCatalogo, secaoCatalogoAtiva]);

  const renderUsuarios = () => {
    const podeCriar = controlador.possuiPermissao('usuarios.criar');
    const podeEditar = controlador.possuiPermissao('usuarios.editar');
    const podeExcluir = controlador.possuiPermissao('usuarios.excluir');
    const podeRedefinirSenha = controlador.possuiPermissao('usuarios.redefinir_senha');
    const podeBloquear = controlador.possuiPermissao('usuarios.bloquear');
    const podeDesbloquear = controlador.possuiPermissao('usuarios.desbloquear');
    const podeSalvar = formUsuario.id_usuario ? podeEditar : podeCriar;
    const bloqueadoLeitura = !criandoUsuario && !modoEdicaoUsuario;
    const totalUsuarios = usuariosFiltrados.length;
    const statusAtivo = normalizarBusca(formUsuario.status) === 'ativo';
    const statusBloqueado = normalizarBusca(formUsuario.status) === 'bloqueado';
    const acessoMicrosoft = normalizarBusca(formUsuario.provedor_autenticacao) === 'microsoft';
    const nomeDrawer = formUsuario.nome || formUsuario.email || (criandoUsuario ? 'Novo usuário' : 'Usuário');
    const linhasUsuarios = paginacaoUsuarios.itens.map((usuario) => ({
      usuario,
      idUsuario: textoSeguro(usuario.id_usuario, ''),
      selecionado: String(textoSeguro(usuario.id_usuario, '')) === String(usuarioSelecionadoId),
    }));

    const atualizarFiltroUsuario = (campo, valor) => {
      setFiltrosUsuarios((atuais) => ({ ...atuais, [campo]: valor }));
      setPaginaUsuarios(1);
    };

    return html`
      <div class="settings-admin-shell users-modern-page">
        <section class="users-modern-panel">
          ${controlador.possuiPermissao('usuarios.alterar_email') && solicitacoesEmailPendentes.length > 0
        ? html`
                <section class="c24-card settings-ambiente-section">
                  <h3>Solicitações de e-mail pendentes</h3>
                  <p class="settings-notifications-hint">
                    Alterações de e-mail solicitadas pelos usuários aguardando sua aprovação.
                  </p>
                  <div class="settings-notif-list">
                    ${solicitacoesEmailPendentes.map(
          (solicitacao) => html`
                        <div class="settings-notif-row" key=${solicitacao.id}>
                          <span>
                            <strong>${solicitacao.nome_usuario || solicitacao.login_usuario || 'Usuário'}</strong>
                            <small>${solicitacao.email_atual || '—'} → ${solicitacao.email_novo}</small>
                          </span>
                          <div class="settings-card-actions">
                            <button
                              type="button"
                              class="btn btn-primary btn-sm"
                              disabled=${decidindoSolicitacaoEmailId === String(solicitacao.id)}
                              onClick=${() => aprovarSolicitacaoEmailAmbiente(solicitacao.id)}
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              class="btn btn-outline-secondary btn-sm"
                              disabled=${decidindoSolicitacaoEmailId === String(solicitacao.id)}
                              onClick=${() => rejeitarSolicitacaoEmailAmbiente(solicitacao.id)}
                            >
                              Rejeitar
                            </button>
                          </div>
                        </div>
                      `,
        )}
                  </div>
                </section>
              `
        : null}

          <div class="users-modern-count">${totalUsuarios} ${totalUsuarios === 1 ? 'resultado' : 'resultados'}</div>

          <div class="users-modern-toolbar">
            <label class="users-search-field">
              <${Icone} name="search" />
              <input
                class="form-control"
                placeholder="Pesquisar usuário"
                value=${filtrosUsuarios.busca}
                onInput=${(event) => atualizarFiltroUsuario('busca', event.target.value)}
              />
            </label>

            <div class="users-filter-menu">
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm users-filter-btn"
                aria-expanded=${painelFiltrosUsuariosAberto}
                onClick=${() => setPainelFiltrosUsuariosAberto((aberto) => !aberto)}
              >
                <${Icone} name="filter_alt" />
                Filtros
                ${filtrosUsuariosAtivos ? html`<span class="users-filter-count">${filtrosUsuariosAtivos}</span>` : null}
              </button>
              ${painelFiltrosUsuariosAberto
        ? html`
                    <div class="users-filter-panel" role="dialog" aria-label="Filtros de usuários">
                      <label>
                        <span>Status</span>
                        <select
                          class="form-select"
                          value=${filtrosUsuarios.status}
                          onChange=${(event) => atualizarFiltroUsuario('status', event.target.value)}
                        >
                          ${STATUS_USUARIO.map(
          (status) => html`<option key=${status || 'todos'} value=${status}>${status || 'Todos'}</option>`,
        )}
                        </select>
                      </label>
                      <label>
                        <span>Perfil</span>
                        <select
                          class="form-select"
                          value=${filtrosUsuarios.perfil}
                          onChange=${(event) => atualizarFiltroUsuario('perfil', event.target.value)}
                        >
                          <option value="">Todos</option>
                          ${perfisVisiveis.map(
          (perfil) => html`<option key=${perfil.id} value=${perfil.id}>${perfil.nome}</option>`,
        )}
                        </select>
                      </label>
                      <label>
                        <span>Operação</span>
                        <select
                          class="form-select"
                          value=${filtrosUsuarios.area}
                          onChange=${(event) => atualizarFiltroUsuario('area', event.target.value)}
                        >
                          <option value="">Todas</option>
                          ${operacoesDisponiveis.map(
          (operacao) => html`<option key=${operacao.id_item} value=${operacao.chave || operacao.nome}>${operacao.nome}</option>`,
        )}
                        </select>
                      </label>
                      <label>
                        <span>Acesso</span>
                        <select
                          class="form-select"
                          value=${filtrosUsuarios.acesso}
                          onChange=${(event) => atualizarFiltroUsuario('acesso', event.target.value)}
                        >
                          <option value="">Todos</option>
                          <option value="recentes">Últimos 7 dias</option>
                          <option value="sem_acesso">Sem acesso</option>
                        </select>
                      </label>
                    </div>
                  `
        : null}
            </div>

            <button
              type="button"
              class="btn btn-outline-secondary btn-sm users-clear-btn"
              disabled=${!filtrosUsuariosAtivos}
              onClick=${limparFiltrosUsuarios}
            >
              Limpar tudo
            </button>
          </div>

          ${linhasUsuarios.length
        ? html`
                <div class="users-table-shell">
                  <table class="users-modern-table">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Perfil</th>
                        <th>Status</th>
                        <th>E-mail</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${linhasUsuarios.map(
          ({ usuario, idUsuario, selecionado }) => html`
                          <tr
                            key=${idUsuario || textoSeguro(usuario.email, textoSeguro(usuario.login, 'usuario'))}
                            class=${`users-row-clickable ${selecionado ? 'is-selected' : ''}`.trim()}
                            tabIndex="0"
                            role="button"
                            aria-label=${`Ver informações de ${textoSeguro(usuario.nome, 'usuário')}`}
                            onClick=${() => selecionarUsuario(usuario)}
                            onKeyDown=${(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selecionarUsuario(usuario);
              }
            }}
                          >
                            <td><span class="users-name-text">${textoSeguro(usuario.nome)}</span></td>
                            <td>${textoSeguro(usuario.perfil_nome, textoSeguro(usuario.perfil))}</td>
                            <td><${Badge} label=${textoSeguro(usuario.status, 'Sem status')} tone=${obterStatusTone(textoSeguro(usuario.status, ''))} /></td>
                            <td>${textoSeguro(usuario.email, textoSeguro(usuario.login))}</td>
                          </tr>
                        `,
        )}
                    </tbody>
                  </table>
                </div>
                <${PaginacaoCompacta}
                  paginacao=${paginacaoUsuarios}
                  label=${`Mostrando ${obterIntervaloPaginacao(paginacaoUsuarios)} de ${paginacaoUsuarios.totalItens} resultados`}
                  onChange=${setPaginaUsuarios}
                />
              `
        : html`
                <${EmptyPanel}
                  icon="groups"
                  title="Sem usuários"
                  text="Nenhum usuário corresponde aos filtros atuais."
                  action=${html`<button type="button" class="btn btn-primary btn-sm" disabled=${!podeCriar} onClick=${iniciarNovoUsuario}>Criar usuário</button>`}
                />
              `}
        </section>

        <${ModalPadrao}
          aberto=${drawerUsuarioAberto}
          titulo=${criandoUsuario ? 'Criar usuário' : 'Editar usuário'}
          subtitulo=${nomeDrawer}
          onClose=${fecharDrawerUsuario}
          acaoCabecalho=${!criandoUsuario && podeEditar
        ? html`
                <button
                  type="button"
                  class=${`btn btn-sm ${modoEdicaoUsuario ? 'btn-outline-secondary' : 'btn-primary'}`.trim()}
                  onClick=${() => setModoEdicaoUsuario((atual) => !atual)}
                >
                  <${Icone} name=${modoEdicaoUsuario ? 'lock_open' : 'edit'} />
                  ${modoEdicaoUsuario ? 'Edição liberada' : 'Editar'}
                </button>
              `
        : null}
        >
          <form class="users-drawer-form" onSubmit=${salvarUsuario}>
            <div class="users-drawer-body">
              <div class="users-drawer-form-grid">
              <label>
                        <span>Nome</span>
                        <input
                          class="form-control"
                          required
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.nome}
                          onInput=${(event) => setFormUsuario({ ...formUsuario, nome: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Perfil</span>
                        <select
                          class="form-select"
                          required
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.perfil}
                          onChange=${(event) => setFormUsuario({ ...formUsuario, perfil: event.target.value })}
                        >
                          ${perfis
          .filter((perfil) => !perfil.oculto || perfil.id === formUsuario.perfil)
          .map((perfil) => html`<option key=${perfil.id} value=${perfil.id}>${perfil.nome}</option>`)}
                        </select>
                      </label>
                      <label>
                        <span>Sobrenome</span>
                        <input
                          class="form-control"
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.sobrenome}
                          onInput=${(event) => setFormUsuario({ ...formUsuario, sobrenome: event.target.value })}
                        />
                      </label>
                      <label class="users-toggle-row">
                        <span>${statusAtivo ? 'Usuário ativo' : 'Usuário inativo'}</span>
                        <button
                          type="button"
                          class=${`users-switch ${statusAtivo ? 'is-on' : ''}`.trim()}
                          role="switch"
                          aria-checked=${statusAtivo}
                          disabled=${bloqueadoLeitura}
                          onClick=${() => setFormUsuario({ ...formUsuario, status: statusAtivo ? 'Inativo' : 'Ativo' })}
                        >
                          <i></i>
                        </button>
                      </label>
                      <label>
                        <span>E-mail</span>
                        <input
                          class="form-control"
                          type="email"
                          required
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.email}
                          onInput=${(event) => setFormUsuario({ ...formUsuario, email: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Cargo</span>
                        <input
                          class="form-control"
                          placeholder="Ex.: Analista de RH Pleno"
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.cargo}
                          onInput=${(event) => setFormUsuario({ ...formUsuario, cargo: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Login</span>
                        <input
                          class="form-control"
                          placeholder="Padrão: usa o e-mail"
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.login}
                          onInput=${(event) => setFormUsuario({ ...formUsuario, login: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Tipo de acesso</span>
                        <select
                          class="form-select"
                          required
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.provedor_autenticacao}
                          onChange=${(event) => setFormUsuario({
          ...formUsuario,
          provedor_autenticacao: event.target.value,
          senha: event.target.value === 'microsoft' ? '' : formUsuario.senha,
        })}
                        >
                          <option value="microsoft">Microsoft</option>
                          <option value="local">Local</option>
                        </select>
                      </label>
                      <${CamposVinculosMonitoria}
                        perfil=${formUsuario.perfil}
                        idUsuario=${criandoUsuario ? '' : formUsuario.id_usuario}
                        operacoes=${Array.isArray(formUsuario.operacoes) ? formUsuario.operacoes : []}
                        setOperacoes=${(lista) => setFormUsuario((atual) => ({ ...atual, operacoes: lista }))}
                        operacoesDisponiveis=${operacoesDisponiveis}
                        vinculos=${vinculosMon}
                        setVinculos=${setVinculosMon}
                        bloqueado=${bloqueadoLeitura}
                      />
                      ${!acessoMicrosoft && (criandoUsuario || (podeRedefinirSenha && !bloqueadoLeitura))
        ? html`
                            <label class="users-drawer-field-wide">
                              <span>${criandoUsuario ? 'Senha inicial' : 'Nova senha (opcional)'}</span>
                              <input
                                class="form-control"
                                type="password"
                                required=${criandoUsuario}
                                placeholder=${criandoUsuario ? '' : 'Deixe em branco para manter a senha atual'}
                                value=${formUsuario.senha}
                                onInput=${(event) => setFormUsuario({ ...formUsuario, senha: event.target.value })}
                              />
                            </label>
                          `
        : null}
                      <label class="users-drawer-field-wide">
                        <span>Justificativa</span>
                        <textarea
                          class="form-control"
                          rows="3"
                          placeholder="Obrigatória para alterações sensíveis"
                          disabled=${bloqueadoLeitura}
                          value=${formUsuario.justificativa}
                          onInput=${(event) => setFormUsuario({ ...formUsuario, justificativa: event.target.value })}
                        ></textarea>
                      </label>
                      </div>

                      ${formUsuario.id_usuario && (podeBloquear || podeDesbloquear || podeRedefinirSenha || podeExcluir)
        ? html`
                            <div class="users-critical-actions">
                              ${statusBloqueado
            ? podeDesbloquear
              ? html`
                                      <button
                                        type="button"
                                        class="btn btn-outline-secondary btn-sm"
                                        onClick=${() => alterarStatus(formUsuario, 'desbloquear')}
                                      >
                                        <span class="material-symbols-outlined">${IconeSvg('lock_open')}</span>
                                        Desbloquear usuário
                                      </button>
                                    `
              : null
            : podeBloquear
              ? html`
                                      <button
                                        type="button"
                                        class="btn btn-outline-secondary btn-sm"
                                        onClick=${() => alterarStatus(formUsuario, 'bloquear')}
                                      >
                                        <span class="material-symbols-outlined">${IconeSvg('lock')}</span>
                                        Bloquear usuário
                                      </button>
                                    `
              : null}
                              ${podeRedefinirSenha
            ? html`
                                    <button
                                      type="button"
                                      class="btn btn-outline-secondary btn-sm"
                                      onClick=${() => redefinirMfa(formUsuario)}
                                    >
                                      <span class="material-symbols-outlined">${IconeSvg('restart_alt')}</span>
                                      Redefinir MFA
                                    </button>
                                  `
            : null}
                              ${podeExcluir
            ? confirmandoExclusaoUsuario
              ? html`
                                    <span class="users-delete-confirm">
                                      <span>Excluir permanentemente?</span>
                                      <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${salvando} onClick=${() => setConfirmandoExclusaoUsuario(false)}>
                                        Cancelar
                                      </button>
                                      <button type="button" class="btn btn-danger btn-sm" disabled=${salvando} onClick=${excluirUsuarioSelecionado}>
                                        Confirmar exclusão
                                      </button>
                                    </span>
                                  `
              : html`
                                    <button type="button" class="btn btn-danger btn-sm" disabled=${salvando} onClick=${() => setConfirmandoExclusaoUsuario(true)}>
                                      <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                                      Excluir usuário
                                    </button>
                                  `
            : null}
                            </div>
                          `
        : null}
            </div>

            ${erro ? html`<div class="alert alert-danger c24-feedback users-drawer-alert" role="alert">${erro}</div>` : null}
            <footer class="rh-modal-footer">
              <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fecharDrawerUsuario}>
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary" disabled=${salvando || !podeSalvar || bloqueadoLeitura}>
                ${salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </footer>
          </form>
        </${ModalPadrao}>

        <${ModalPadrao}
          aberto=${drawerUsuarioRapidoAberto}
          titulo="Criar usuário rápido"
          subtitulo="Login para um candidato aprovado fazer treinamento. A atribuição do treinamento fica com a Gestão de Treinamentos."
          onClose=${fecharUsuarioRapido}
        >
          <form class="users-drawer-form" onSubmit=${salvarUsuarioRapido}>
            <div class="users-drawer-body">
              ${erroUsuarioRapido ? html`<div class="alert alert-danger c24-feedback">${erroUsuarioRapido}</div>` : null}

              <div class="rh-filter-field">
                <label>Candidatos aprovados</label>
                <input
                  type="search"
                  class="form-control"
                  placeholder="Buscar candidato aprovado por nome ou e-mail..."
                  value=${buscaCandidatoRapido}
                  onInput=${(event) => setBuscaCandidatoRapido(event.target.value)}
                />
              </div>
              ${carregandoCandidatosAprovados
        ? html`<p class="text-muted">Carregando candidatos aprovados...</p>`
        : candidatosAprovadosFiltrados.length
          ? html`
                    <ul class="quick-user-candidate-list">
                      ${candidatosAprovadosFiltrados.slice(0, 20).map((candidato) => html`
                        <li key=${candidato.id_registro || candidato.id_teste}>
                          <button
                            type="button"
                            class="quick-user-candidate-item"
                            onClick=${() => selecionarCandidatoAprovadoRapido(candidato)}
                          >
                            <span class="quick-user-candidate-name">${candidato.nome_candidato || candidato.nome || '-'}</span>
                            <span class="quick-user-candidate-email">${candidato.email || 'sem e-mail'}</span>
                          </button>
                        </li>
                      `)}
                    </ul>
                  `
          : html`<p class="text-muted">Nenhum candidato aprovado encontrado.</p>`}

              <div class="rh-filter-field" style=${{ marginTop: '8px' }}>
                <label>Nome</label>
                <input
                  class="form-control"
                  value=${formUsuarioRapido.nome}
                  onInput=${(event) => setFormUsuarioRapido({ ...formUsuarioRapido, nome: event.target.value })}
                  required
                />
              </div>
              <div class="rh-filter-field">
                <label>E-mail</label>
                <input
                  type="email"
                  class="form-control"
                  value=${formUsuarioRapido.email}
                  onInput=${(event) => setFormUsuarioRapido({ ...formUsuarioRapido, email: event.target.value })}
                  required
                />
              </div>
              <div class="rh-filter-field">
                <label>Senha</label>
                <input
                  type="password"
                  class="form-control"
                  value=${formUsuarioRapido.senha}
                  onInput=${(event) => setFormUsuarioRapido({ ...formUsuarioRapido, senha: event.target.value })}
                  required
                />
              </div>
            </div>

            <footer class="rh-modal-footer">
              <button type="button" class="btn btn-outline-secondary" disabled=${salvandoUsuarioRapido} onClick=${fecharUsuarioRapido}>
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary" disabled=${salvandoUsuarioRapido}>
                ${salvandoUsuarioRapido ? 'Criando...' : 'Criar usuário'}
              </button>
            </footer>
          </form>
        </${ModalPadrao}>
      </div>
    `;
  };

  const renderPerfis = () => {
    const podeEditarPerfis = controlador.possuiPermissao('configuracoes.editar');
    const sessaoAtiva = sessaoPermissaoAtiva ? SESSOES_PERMISSAO.find((sessao) => sessao.id === sessaoPermissaoAtiva) : null;
    const contagemPorSessao = (sessao) =>
      Object.entries(permissoesPorModulo)
        .filter(([modulo]) => sessao.modulos.includes(modulo))
        .reduce((total, [, itens]) => total + itens.length, 0);
    const permissoesDaSessao = sessaoAtiva
      ? permissoesFiltradasPorModulo.filter(([modulo]) => sessaoAtiva.modulos.includes(modulo))
      : [];

    return html`
      <div class="settings-admin-shell settings-profiles-page">
        <${StatGrid}
          items=${[
        { icon: 'badge', label: 'Total de perfis', value: perfis.length, helper: `${perfilMaisUsado} em destaque`, tone: 'blue' },
        { icon: 'shield', label: 'Permissões cadastradas', value: permissoes.length, helper: `${contarPor(permissoes, (item) => item.critica)} críticas`, tone: 'yellow' },
        { icon: 'groups', label: 'Usuários vinculados', value: usuarios.length, helper: 'Base real cadastrada', tone: 'green' },
      ]}
        />

        <div class="settings-profiles-toolbar">
          <p class="settings-profiles-toolbar-hint">
            Desbloqueie para editar as permissões de qualquer perfil e sessão nesta página.
          </p>
          ${podeEditarPerfis
        ? html`
                <button
                  type="button"
                  class=${`btn btn-sm ${perfisDesbloqueados ? 'btn-outline-secondary' : 'btn-primary'}`.trim()}
                  onClick=${() => setPerfisDesbloqueados((atual) => !atual)}
                >
                  <${Icone} name=${perfisDesbloqueados ? 'lock_open' : 'lock'} />
                  ${perfisDesbloqueados ? 'Edição liberada' : 'Editar configurações padrão'}
                </button>
              `
        : null}
        </div>

        ${perfis.length
        ? html`
              <nav class="settings-permission-tree">
                ${perfisVisiveis.map((perfil) => {
          const expandido = perfilSelecionado?.id === perfil.id;
          return html`
                    <div class=${`settings-permission-tree-node ${expandido ? 'is-expanded' : ''}`.trim()} key=${perfil.id}>
                      <button
                        type="button"
                        class=${`settings-permission-tree-profile ${expandido ? 'is-active' : ''}`.trim()}
                        aria-expanded=${expandido}
                        onClick=${() => selecionarPerfilPermissoes(expandido ? '' : perfil.id)}
                      >
                        <span class="settings-permission-tree-profile-icon"><${Icone} name=${ICONE_POR_PERFIL[perfil.id] || 'badge'} /></span>
                        <span class="settings-permission-tree-label">
                          <strong>${perfil.nome}</strong>
                        </span>
                        <span class="material-symbols-outlined settings-permission-tree-chevron">${IconeSvg('expand_more')}</span>
                      </button>

                      ${expandido
              ? html`
                            <div class="settings-permission-tree-children">
                              ${SESSOES_PERMISSAO.map((sessao) => {
                const sessaoExpandida = sessaoAtiva?.id === sessao.id;
                const total = contagemPorSessao(sessao);
                return html`
                                  <div class=${`settings-permission-tree-node settings-permission-tree-node--session ${sessaoExpandida ? 'is-expanded' : ''}`.trim()} key=${sessao.id}>
                                    <button
                                      type="button"
                                      class=${`settings-permission-tree-session ${sessaoExpandida ? 'is-active' : ''}`.trim()}
                                      aria-expanded=${sessaoExpandida}
                                      onClick=${() => setSessaoPermissaoAtiva(sessaoExpandida ? '' : sessao.id)}
                                    >
                                      <span>${sessao.label}</span>
                                      <small>${total}</small>
                                      <span class="material-symbols-outlined settings-permission-tree-chevron">${IconeSvg('expand_more')}</span>
                                    </button>

                                    ${sessaoExpandida
                    ? html`
                                          <div class="settings-permission-tree-content">
                                            <header class="c24-card-header settings-permission-head">
                                              <div>
                                                <span class="c24-eyebrow">${sessaoAtiva.label}</span>
                                                <h3>${perfilSelecionado.nome}</h3>
                                              </div>
                                              <div class="settings-card-actions">
                                                <label class="settings-session-master" title="Liga ou desliga o acesso deste nível a toda a sessão (menu, tela inicial e telas)">
                                                  <${ToggleSwitch}
                                                    checked=${permissoesPerfilDraft.includes(`sessao.${sessaoAtiva.id}.acessar`)}
                                                    disabled=${!perfisDesbloqueados}
                                                    onChange=${() => alternarPermissao(`sessao.${sessaoAtiva.id}.acessar`)}
                                                  />
                                                  <span>Sessão liberada</span>
                                                </label>
                                                <${Badge} label=${`${usuariosPerfilSelecionado.length} usuário(s)`} tone="info" />
                                                ${usuariosPerfilSelecionado.length
                        ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${abrirUsuariosDoPerfil}>Ver usuários</button>`
                        : null}
                                              </div>
                                            </header>

                                            ${perfisDesbloqueados
                        ? html`
                                                  <div class="c24-filter-bar settings-permission-filter">
                                                    <${FilterField} label="Buscar permissão" icon="search">
                                                      <input
                                                        class="form-control"
                                                        placeholder="Módulo, chave ou descrição"
                                                        value=${buscaPermissao}
                                                        onInput=${(event) => setBuscaPermissao(event.target.value)}
                                                      />
                                                    </${FilterField}>
                                                    <${FilterField} label="Comparar com" icon="compare_arrows">
                                                      <select
                                                        class="form-select"
                                                        value=${perfilComparadoId}
                                                        onChange=${(event) => setPerfilComparadoId(event.target.value)}
                                                      >
                                                        <option value="">Não comparar</option>
                                                        ${perfis
                            .filter((perfil2) => perfil2.id !== perfilSelecionado.id)
                            .map((perfil2) => html`<option key=${perfil2.id} value=${perfil2.id}>${perfil2.nome}</option>`)}
                                                      </select>
                                                    </${FilterField}>
                                                    <label class="c24-check-filter settings-active-filter">
                                                      <input
                                                        type="checkbox"
                                                        checked=${mostrarSomenteAtivas}
                                                        onChange=${(event) => setMostrarSomenteAtivas(event.target.checked)}
                                                      />
                                                      Ver apenas ativas
                                                    </label>
                                                    <${FilterField} label="Justificativa da alteração" icon="edit_note">
                                                      <input
                                                        class="form-control"
                                                        value=${justificativaPerfil}
                                                        placeholder="Opcional, recomendado para alterações críticas"
                                                        onInput=${(event) => setJustificativaPerfil(event.target.value)}
                                                      />
                                                    </${FilterField}>
                                                  </div>
                                                `
                        : null}

                                            <div class="settings-permission-groups">
                                              ${permissoesDaSessao.length
                        ? permissoesDaSessao.map(
                          ([modulo, itens]) => {
                            const ativos = contarPor(itens, (permissao) => permissoesPerfilDraft.includes(permissao.chave));
                            return html`
                                                          <div class="settings-permission-group" key=${modulo}>
                                                            <div class="settings-permission-group-head">
                                                              <span>
                                                                <strong>${modulo}</strong>
                                                                <small>${ativos}/${itens.length} ativas</small>
                                                              </span>
                                                              ${perfisDesbloqueados
                                ? html`
                                                                    <span class="settings-group-actions">
                                                                      <button type="button" onClick=${() => alterarGrupoPermissoes(itens, true)}>Marcar grupo</button>
                                                                      <button type="button" onClick=${() => alterarGrupoPermissoes(itens, false)}>Limpar grupo</button>
                                                                    </span>
                                                                  `
                                : null}
                                                            </div>
                                                            <div class="settings-permission-list">
                                                              ${itens.map((permissao) => {
                                  const ativa = permissoesPerfilDraft.includes(permissao.chave);
                                  const ativaComparado = perfilComparado ? permissaoEstaAtiva(perfilComparado, permissao.chave) : null;
                                  return html`
                                                                  <div class=${`settings-permission-row ${ativa ? 'is-active' : ''}`.trim()} key=${permissao.chave}>
                                                                    <${ToggleSwitch}
                                                                      checked=${ativa}
                                                                      disabled=${!perfisDesbloqueados}
                                                                      onChange=${() => alternarPermissao(permissao.chave)}
                                                                    />
                                                                    <span class="settings-permission-copy">
                                                                      <strong>${permissao.chave}</strong>
                                                                      <small>${permissao.descricao || '-'}</small>
                                                                    </span>
                                                                    <span class="settings-permission-badges">
                                                                      <${Badge} label=${permissao.critica ? 'Crítica' : 'Operacional'} tone=${permissao.critica ? 'danger' : 'muted'} />
                                                                      ${perfilComparado
                                      ? html`<${Badge} label=${ativaComparado ? 'no comparado' : 'fora do comparado'} tone=${ativaComparado ? 'success' : 'muted'} />`
                                      : null}
                                                                    </span>
                                                                  </div>
                                                                `;
                                })}
                                                            </div>
                                                          </div>
                                                        `;
                          },
                        )
                        : html`
                                                    <${EmptyPanel}
                                                      icon="shield"
                                                      title="Sem permissões nesta sessão"
                                                      text="Nenhuma permissão corresponde ao filtro atual."
                                                    />
                                                  `}
                                            </div>

                                            ${perfisDesbloqueados
                        ? html`
                                                  <footer class="rh-form-footer rh-form-footer--sticky">
                                                    <span class="rh-form-footer-hint">
                                                      ${alteracoesPendentesPerfil
                            ? `${alteracoesPendentesPerfil} alteração(ões) pendente(s) de salvar.`
                            : 'Nenhuma alteração pendente.'}
                                                    </span>
                                                    <div class="settings-card-actions">
                                                      <button
                                                        type="button"
                                                        class="btn btn-outline-secondary btn-sm"
                                                        disabled=${salvando}
                                                        onClick=${() => setPermissoesPerfilDraft(permissoesOriginaisPerfil)}
                                                      >
                                                        <${Icone} name="settings_backup_restore" /> Restaurar
                                                      </button>
                                                      <button
                                                        type="button"
                                                        class="btn btn-primary btn-sm"
                                                        disabled=${salvando || !podeEditarPerfis}
                                                        onClick=${salvarPermissoesPerfil}
                                                      >
                                                        <${Icone} name="save" /> ${salvando ? 'Salvando...' : 'Salvar matriz'}
                                                      </button>
                                                    </div>
                                                  </footer>
                                                `
                        : null}
                                          </div>
                                        `
                    : null}
                                  </div>
                                `;
              })}
                            </div>
                          `
              : null}
                    </div>
                  `;
        })}
              </nav>
            `
        : html`<${EmptyPanel} icon="groups" title="Sem perfis" text="Nenhum perfil foi retornado pelo backend." />`}
      </div>
    `;
  };

  const renderCatalogos = () => html`
    <div class="settings-admin-shell">
      <${StatGrid} items=${metricasOperacoes} />

      ${tipoCatalogo === 'operacoes'
      ? html`
          <section class="c24-card settings-rule-form-card">
            <header class="c24-card-header compact">
              <div>
                <span class="c24-eyebrow">Endereço principal</span>
                <h3>Endereço principal da empresa</h3>
              </div>
              ${controlador.possuiPermissao('configuracoes.editar') && !editandoEndereco
          ? html`
                    <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setEditandoEndereco(true)}>
                      <${Icone} name="edit" /> ${enderecoPrincipalItem ? 'Editar' : 'Cadastrar'}
                    </button>
                  `
          : null}
            </header>
            ${editandoEndereco
          ? html`
                  <form class="settings-endereco-form" onSubmit=${salvarEnderecoPrincipal}>
                    <label class="is-wide">
                      <span>Rua/Avenida</span>
                      <input class="form-control" value=${formEndereco.rua} onInput=${(event) => setFormEndereco({ ...formEndereco, rua: event.target.value })} />
                    </label>
                    <label class="endereco-numero">
                      <span>Número</span>
                      <input class="form-control" value=${formEndereco.numero} onInput=${(event) => setFormEndereco({ ...formEndereco, numero: event.target.value })} />
                    </label>
                    <label>
                      <span>Complemento</span>
                      <input class="form-control" value=${formEndereco.complemento} onInput=${(event) => setFormEndereco({ ...formEndereco, complemento: event.target.value })} />
                    </label>
                    <label>
                      <span>Bairro</span>
                      <input class="form-control" value=${formEndereco.bairro} onInput=${(event) => setFormEndereco({ ...formEndereco, bairro: event.target.value })} />
                    </label>
                    <label>
                      <span>Cidade</span>
                      <input class="form-control" value=${formEndereco.cidade} onInput=${(event) => setFormEndereco({ ...formEndereco, cidade: event.target.value })} />
                    </label>
                    <label class="endereco-uf">
                      <span>UF</span>
                      <input class="form-control" maxlength="2" value=${formEndereco.uf} onInput=${(event) => setFormEndereco({ ...formEndereco, uf: event.target.value.toUpperCase() })} />
                    </label>
                    <label class="endereco-cep">
                      <span>CEP</span>
                      <input class="form-control" value=${formEndereco.cep} onInput=${(event) => setFormEndereco({ ...formEndereco, cep: event.target.value })} />
                    </label>
                    <footer class="settings-form-footer">
                      <button type="button" class="btn btn-outline-secondary" onClick=${() => setEditandoEndereco(false)}>Cancelar</button>
                      <button type="submit" class="btn btn-primary" disabled=${salvandoEndereco}>
                        ${salvandoEndereco ? 'Salvando...' : 'Salvar endereço'}
                      </button>
                    </footer>
                  </form>
                `
          : html`
                  <p class="text-muted mb-0">
                    ${enderecoPrincipalItem
              ? `${formEndereco.rua}${formEndereco.numero ? `, ${formEndereco.numero}` : ''} — ${formEndereco.bairro || ''} ${formEndereco.cidade || ''}${formEndereco.uf ? `/${formEndereco.uf}` : ''}${formEndereco.cep ? ` — CEP ${formEndereco.cep}` : ''}`
              : 'Nenhum endereço principal cadastrado ainda.'}
                  </p>
                `}
          </section>
        `
      : null}

      <div class="settings-catalog-workspace settings-catalog-workspace--single">
        <section class=${`c24-card settings-rule-form-card ${secaoCatalogoAtiva?.tipo === 'operacoes' ? 'settings-rule-form-card--operacoes' : ''}`.trim()}>
          <header class="c24-card-header">
            <div>
              <span class="c24-eyebrow">${secaoCatalogoAtiva?.label || 'Catálogo'}</span>
              <h3>${secaoCatalogoAtiva?.tipo === 'operacoes' ? (formItem.id_item ? 'Editar operação' : 'Nova operação') : (formItem.id_item ? 'Editar regra' : 'Nova regra')}</h3>
              <p>
                ${secaoCatalogoAtiva?.tipo === 'operacoes'
      ? 'Preencha os dados desta operação — eles passam a valer em Processos, Provas e Treinamentos.'
      : 'Campos principais ficam no topo; o JSON avançado preserva integrações existentes.'}
              </p>
            </div>
            <div class="settings-card-actions">
              ${itemEmEdicao
      ? html`
                    <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => duplicarItem(itemEmEdicao)}>
                      <${Icone} name="content_copy" /> Duplicar
                    </button>
                    <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => desativarItem(itemEmEdicao)}>
                      <${Icone} name="archive" /> Arquivar
                    </button>
                  `
      : null}
            </div>
          </header>
          ${secaoCatalogoAtiva?.tipo === 'operacoes'
      ? html`
                <div class="cfg-subabas" role="tablist" aria-label="Seções da operação">
                  ${[['cadastro', 'Cadastro', 'edit_note'], ['ambiente', 'Configurar ambiente', 'tune']].map(([id, rotulo, icone]) => html`
                    <button key=${id} type="button" role="tab" aria-selected=${abaOperacao === id} class=${`cfg-subaba ${abaOperacao === id ? 'is-active' : ''}`} onClick=${() => setAbaOperacao(id)}>
                      <${Icone} name=${icone} /> ${rotulo}
                    </button>`)}
                </div>`
      : null}
          ${secaoCatalogoAtiva?.tipo === 'operacoes' && abaOperacao === 'ambiente'
      ? html`<${AbaAmbienteOperacao}
                chave=${formItem.id_item ? (formItem.chave || String(formItem.nome || '').toUpperCase()) : ''}
                nome=${formItem.nome}
                podeEditar=${controlador.possuiPermissao('configuracoes.editar')}
                podeEditarOrganizacao=${controlador.possuiPermissao('monitoria.equipes')}
                onFeedback=${setFeedback}
                onErro=${setErro}
              />`
      : html`
          <form class="c24-form-grid settings-rule-form" onSubmit=${salvarItem}>
            <${secaoCatalogoAtiva?.tipo === 'operacoes' ? 'details' : 'div'} class=${`settings-form-section ${secaoCatalogoAtiva?.tipo === 'operacoes' ? 'settings-form-accordion' : ''}`.trim()} open=${secaoCatalogoAtiva?.tipo === 'operacoes' ? true : undefined}>
            ${secaoCatalogoAtiva?.tipo === 'operacoes'
      ? html`<summary class="settings-form-section-title">Identificação</summary>`
      : html`<h4 class="settings-form-section-title">Identificação</h4>`}
            <label>
              <span>Nome</span>
              <input
                class="form-control"
                required
                value=${formItem.nome}
                onInput=${(event) => setFormItem({ ...formItem, nome: event.target.value })}
              />
            </label>
            ${secaoCatalogoAtiva?.tipo === 'operacoes'
      ? html`
                  <label>
                    <span>Chave/Tag (automática)</span>
                    <input class="form-control" disabled value=${String(formItem.nome || '').toUpperCase() || '—'} />
                    
                  </label>
                  <label>
                    <span>Cor da tag</span>
                    <input
                      type="color"
                      class="form-control form-control-color"
                      value=${formItem.corTag || '#2563eb'}
                      onInput=${(event) => setFormItem({ ...formItem, corTag: event.target.value })}
                    />
                  </label>
                `
      : html`
                  <label>
                    <span>Chave</span>
                    <input
                      class="form-control"
                      value=${formItem.chave}
                      onInput=${(event) => setFormItem({ ...formItem, chave: event.target.value })}
                    />
                  </label>
                `}
            <label>
              <span>${secaoCatalogoAtiva?.tipo === 'operacoes' ? 'Tipo de operação' : 'Categoria'}</span>
              ${secaoCatalogoAtiva?.tipo === 'operacoes'
      ? html`
                    <select
                      class="form-select"
                      value=${formItem.categoria}
                      onChange=${(event) => setFormItem({ ...formItem, categoria: event.target.value })}
                    >
                      <option value="">Selecione</option>
                      ${TIPOS_OPERACAO.map((tipo) => html`<option key=${tipo} value=${tipo}>${tipo}</option>`)}
                      ${formItem.categoria && !TIPOS_OPERACAO.includes(formItem.categoria)
          ? html`<option value=${formItem.categoria}>${formItem.categoria} (legado)</option>`
          : null}
                    </select>
                  `
      : html`
                    <input
                      class="form-control"
                      value=${formItem.categoria}
                      onInput=${(event) => setFormItem({ ...formItem, categoria: event.target.value })}
                    />
                  `}
            </label>
            <label>
              <span>Criticidade</span>
              <select
                class="form-select"
                value=${formItem.criticidade}
                onChange=${(event) => setFormItem({ ...formItem, criticidade: event.target.value })}
              >
                <option value="operacional">Operacional</option>
                <option value="atencao">Atenção</option>
                <option value="critica">Crítica</option>
              </select>
            </label>
            <label class="is-wide">
              <span>${secaoCatalogoAtiva?.tipo === 'operacoes' ? 'Visão geral e como funciona' : 'Descrição'}</span>
              <textarea
                class="form-control"
                rows=${secaoCatalogoAtiva?.tipo === 'operacoes' ? '5' : '2'}
                placeholder=${secaoCatalogoAtiva?.tipo === 'operacoes' ? 'O que é essa operação, para qual cliente, e como funciona no dia a dia — use este espaço como o formulário completo da operação.' : ''}
                value=${formItem.descricao}
                onInput=${(event) => setFormItem({ ...formItem, descricao: event.target.value })}
              ></textarea>
            </label>
            <label>
              <span>Tags</span>
              <input
                class="form-control"
                placeholder="Separadas por vírgula"
                value=${formItem.tags}
                onInput=${(event) => setFormItem({ ...formItem, tags: event.target.value })}
              />
            </label>
            <label>
              <span>Aplicável a</span>
              <select
                class="form-select"
                value=${formItem.aplicavel}
                onChange=${(event) => setFormItem({ ...formItem, aplicavel: event.target.value })}
              >
                <option value="todos">Todos os fluxos</option>
                <option value="fluxos_especificos">Fluxos específicos</option>
                <option value="somente_rh">Somente RH</option>
              </select>
            </label>
            <label class="is-wide">
              <span>Permissões relacionadas</span>
              <input
                class="form-control"
                placeholder="Ex.: configuracoes.editar, lgpd.configurar"
                value=${formItem.permissoes}
                onInput=${(event) => setFormItem({ ...formItem, permissoes: event.target.value })}
              />
            </label>
            <label class="settings-toggle-line">
              <input
                type="checkbox"
                checked=${formItem.ativo}
                onChange=${(event) => setFormItem({ ...formItem, ativo: event.target.checked })}
              />
              <span>Item ativo nos fluxos operacionais</span>
            </label>
            <//>
            ${secaoCatalogoAtiva?.tipo === 'etapas'
      ? html`
                  <label>
                    <span>Duração (minutos)</span>
                    <input
                      type="number"
                      min="0"
                      class="form-control"
                      placeholder="Ex.: 30"
                      value=${formItem.duracaoMinutos}
                      onInput=${(event) => setFormItem({ ...formItem, duracaoMinutos: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Tolerância extra (minutos)</span>
                    <input
                      type="number"
                      min="0"
                      class="form-control"
                      placeholder="Ex.: 5"
                      value=${formItem.toleranciaMinutos}
                      onInput=${(event) => setFormItem({ ...formItem, toleranciaMinutos: event.target.value })}
                    />
                  </label>
                `
      : null}
            ${secaoCatalogoAtiva?.tipo === 'motivos_eliminacao'
      ? html`
                  <label class="is-wide">
                    <span>Sub-causas deste motivo</span>
                    <input
                      class="form-control"
                      placeholder="Separadas por vírgula. Ex.: Não atendeu ligação, Cancelou por WhatsApp, Não justificou"
                      value=${formItem.subCausas}
                      onInput=${(event) => setFormItem({ ...formItem, subCausas: event.target.value })}
                    />
                    <small class="text-muted">Aparecem como detalhamento opcional ao eliminar um candidato com este motivo.</small>
                  </label>
                `
      : null}
            ${secaoCatalogoAtiva?.tipo === 'operacoes'
      ? html`
                  <details class="settings-form-section settings-form-accordion">
                  <summary class="settings-form-section-title">Cliente e escopo</summary>
                  <label>
                    <span>Cliente</span>
                    <input
                      class="form-control"
                      placeholder="Nome do cliente atendido por esta operação"
                      value=${formItem.cliente}
                      onInput=${(event) => setFormItem({ ...formItem, cliente: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Modalidade</span>
                    <select
                      class="form-select"
                      value=${formItem.modalidadeOperacao}
                      onChange=${(event) => setFormItem({ ...formItem, modalidadeOperacao: event.target.value })}
                    >
                      <option value="">Não informado</option>
                      <option value="presencial">Presencial</option>
                      <option value="hibrido">Híbrido</option>
                      <option value="remoto">Remoto</option>
                    </select>
                  </label>
                  <label>
                    <span>Previsão de colaboradores</span>
                    <input
                      type="number"
                      min="0"
                      class="form-control"
                      value=${formItem.headcountPrevisto}
                      onInput=${(event) => setFormItem({ ...formItem, headcountPrevisto: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>SLA de atendimento</span>
                    <input
                      class="form-control"
                      placeholder="Ex.: 90% das chamadas em até 20s"
                      value=${formItem.slaAtendimento}
                      onInput=${(event) => setFormItem({ ...formItem, slaAtendimento: event.target.value })}
                    />
                  </label>
                  <label class="is-wide">
                    <span>Programas e softwares utilizados</span>
                    <input
                      class="form-control"
                      placeholder="Separados por vírgula. Ex.: Excel, CRM Interno, Discador"
                      value=${formItem.softwaresUtilizados}
                      onInput=${(event) => setFormItem({ ...formItem, softwaresUtilizados: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Finalidade da operação</span>
                    <select
                      class="form-select"
                      value=${formItem.finalidadeOperacao}
                      onChange=${(event) => setFormItem({ ...formItem, finalidadeOperacao: event.target.value })}
                    >
                      <option value="">Selecione</option>
                      ${FINALIDADES_OPERACAO.map((item) => html`<option key=${item} value=${item}>${item}</option>`)}
                    </select>
                  </label>
                  <label>
                    <span>Segmento de mercado</span>
                    <select
                      class="form-select"
                      value=${formItem.segmentoMercado}
                      onChange=${(event) => setFormItem({ ...formItem, segmentoMercado: event.target.value, areaSegmento: '' })}
                    >
                      <option value="">Selecione</option>
                      ${SEGMENTOS_MERCADO.map((item) => html`<option key=${item} value=${item}>${item}</option>`)}
                    </select>
                  </label>
                  <label>
                    <span>Área específica do segmento</span>
                    ${normalizarLista(AREAS_POR_SEGMENTO[formItem.segmentoMercado]).length
          ? html`
                          <select
                            class="form-select"
                            value=${formItem.areaSegmento}
                            onChange=${(event) => setFormItem({ ...formItem, areaSegmento: event.target.value })}
                          >
                            <option value="">Selecione</option>
                            ${AREAS_POR_SEGMENTO[formItem.segmentoMercado].map(
            (area) => html`<option key=${area} value=${area}>${area}</option>`,
          )}
                          </select>
                        `
          : html`
                          <input
                            class="form-control"
                            placeholder="Detalhe a área específica deste segmento"
                            disabled=${!formItem.segmentoMercado}
                            value=${formItem.areaSegmento}
                            onInput=${(event) => setFormItem({ ...formItem, areaSegmento: event.target.value })}
                          />
                        `}
                    <small class="text-muted">Usado para personalizar automaticamente provas e a análise de currículo desta operação.</small>
                  </label>
                  </details>

                  <details class="settings-form-section settings-form-accordion">
                  <summary class="settings-form-section-title">Sistemas e acesso</summary>
                  <div class="is-wide">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                      <span>Sistemas e portais de acesso necessários</span>
                      <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${adicionarSistemaAcesso}>
                        <${Icone} name="add" /> Adicionar sistema
                      </button>
                    </div>
                    
                    ${normalizarLista(formItem.sistemasAcesso).length
          ? normalizarLista(formItem.sistemasAcesso).map(
            (sistema, indice) => html`
                            <div key=${indice} class="row g-2 align-items-start mb-2">
                              <div class="col-md-5">
                                <input
                                  class="form-control"
                                  placeholder="Nome do sistema/portal"
                                  value=${sistema.nome}
                                  onInput=${(event) => atualizarSistemaAcesso(indice, 'nome', event.target.value)}
                                />
                              </div>
                              <div class="col-md-6">
                                <input
                                  class="form-control"
                                  placeholder="Observação (opcional)"
                                  value=${sistema.descricao}
                                  onInput=${(event) => atualizarSistemaAcesso(indice, 'descricao', event.target.value)}
                                />
                              </div>
                              <div class="col-md-1">
                                <button
                                  type="button"
                                  class="btn btn-outline-danger btn-sm"
                                  aria-label="Remover sistema"
                                  onClick=${() => removerSistemaAcesso(indice)}
                                >
                                  <${Icone} name="close" />
                                </button>
                              </div>
                            </div>
                          `,
          )
          : html`<p class="text-muted small mb-0">Nenhum sistema adicionado ainda.</p>`}
                  </div>
                  </details>

                  <details class="settings-form-section settings-form-accordion">
                  <summary class="settings-form-section-title">Localização e jornada</summary>
                  <label>
                    <span>Unidade</span>
                    <select
                      class="form-select"
                      value=${formItem.unidadeTipo}
                      onChange=${(event) => setFormItem({ ...formItem, unidadeTipo: event.target.value })}
                    >
                      <option value="">Selecione</option>
                      ${UNIDADE_TIPOS_OPERACAO.map((item) => html`<option key=${item.value} value=${item.value}>${item.label}</option>`)}
                    </select>
                  </label>
                  ${formItem.unidadeTipo === 'em_loco'
          ? html`
                        <p class="is-wide text-muted small mb-0">
                          Usa o endereço principal da empresa, cadastrado no topo desta tela (acesso restrito a quem edita Configurações).
                        </p>
                      `
          : null}
                  ${formItem.unidadeTipo === 'alocado_cliente'
          ? html`
                        <label class="is-wide">
                          <span>Endereço alocado ao cliente</span>
                          <input
                            class="form-control"
                            placeholder="Endereço completo do cliente"
                            value=${formItem.unidadeEnderecoCliente}
                            onInput=${(event) => setFormItem({ ...formItem, unidadeEnderecoCliente: event.target.value })}
                          />
                        </label>
                      `
          : null}
                  ${formItem.unidadeTipo === 'hibrido'
          ? html`
                        <div class="is-wide">
                          <div class="d-flex align-items-center justify-content-between mb-2">
                            <span>Endereços do modelo híbrido</span>
                            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${adicionarEnderecoHibrido}>
                              <${Icone} name="add" /> Adicionar endereço
                            </button>
                          </div>
                          ${normalizarLista(formItem.unidadeEnderecosHibrido).length
              ? normalizarLista(formItem.unidadeEnderecosHibrido).map(
                (endereco, indice) => html`
                                <div key=${indice} class="row g-2 align-items-start mb-2">
                                  <div class="col-md-11">
                                    <input
                                      class="form-control"
                                      placeholder="Endereço"
                                      value=${endereco}
                                      onInput=${(event) => atualizarEnderecoHibrido(indice, event.target.value)}
                                    />
                                  </div>
                                  <div class="col-md-1">
                                    <button type="button" class="btn btn-outline-danger btn-sm" aria-label="Remover endereço" onClick=${() => removerEnderecoHibrido(indice)}>
                                      <${Icone} name="close" />
                                    </button>
                                  </div>
                                </div>
                              `,
              )
              : html`<p class="text-muted small mb-0">Nenhum endereço adicionado ainda.</p>`}
                        </div>
                      `
          : null}
                  <div class="is-wide">
                    <span>Jornada de trabalho</span>
                    <p class="text-muted small mb-2">Pode marcar mais de uma — supervisores e outras funções costumam ter escalas diferentes da operação.</p>
                    <div class="d-flex flex-wrap gap-3">
                      ${JORNADAS_OPERACAO.map(
            (item) => html`
                            <label key=${item.value} class="settings-toggle-line" style=${{ minWidth: '0' }}>
                              <input
                                type="checkbox"
                                checked=${normalizarLista(formItem.jornadasTrabalho).includes(item.value)}
                                onChange=${() => alternarJornadaOperacao(item.value)}
                              />
                              <span>${item.label}</span>
                            </label>
                          `,
          )}
                    </div>
                  </div>
                  <label>
                    <span>Horário da escala (turno)</span>
                    <input
                      class="form-control"
                      placeholder="Ex.: Manhã, Tarde, Madrugada/Noite ou 14:00 às 20:20"
                      value=${formItem.turnoEscala}
                      onInput=${(event) => setFormItem({ ...formItem, turnoEscala: event.target.value })}
                    />
                  </label>
                  <label class="settings-toggle-line">
                    <input
                      type="checkbox"
                      checked=${formItem.necessitaDisponibilidade}
                      onChange=${(event) => setFormItem({ ...formItem, necessitaDisponibilidade: event.target.checked })}
                    />
                    <span>Necessita disponibilidade de horário</span>
                  </label>
                  </details>

                  <details class="settings-form-section settings-form-accordion">
                  <summary class="settings-form-section-title">Descrição detalhada</summary>
                  <label class="is-wide">
                    <span>Descrição do cliente</span>
                    <textarea
                      class="form-control"
                      rows="3"
                      value=${formItem.descricaoCliente}
                      onInput=${(event) => setFormItem({ ...formItem, descricaoCliente: event.target.value })}
                    ></textarea>
                  </label>
                  <label class="is-wide">
                    <span>Descrição das atividades</span>
                    <textarea
                      class="form-control"
                      rows="3"
                      placeholder="Como funciona a operação no dia a dia"
                      value=${formItem.descricaoAtividades}
                      onInput=${(event) => setFormItem({ ...formItem, descricaoAtividades: event.target.value })}
                    ></textarea>
                  </label>
                  </details>
                `
      : null}
            <label class="is-wide">
              <span>Justificativa</span>
              <input
                class="form-control"
                value=${formItem.justificativa}
                onInput=${(event) => setFormItem({ ...formItem, justificativa: event.target.value })}
              />
            </label>
            ${!['operacoes', 'etapas', 'motivos_eliminacao'].includes(secaoCatalogoAtiva?.tipo)
      ? html`
                  <details class="settings-json-details is-wide">
                    <summary>Payload JSON avançado</summary>
                    <textarea
                      class="form-control font-monospace"
                      rows="5"
                      value=${formItem.payloadJson}
                      onInput=${(event) => setFormItem({ ...formItem, payloadJson: event.target.value })}
                    ></textarea>
                  </details>
                `
      : null}
            <footer class="settings-form-footer is-wide">
              <button type="submit" class="btn btn-primary" disabled=${salvando || !secaoCatalogoAtiva || !controlador.possuiPermissao('configuracoes.editar')}>
                <${Icone} name="check" /> ${salvando ? 'Salvando...' : 'Salvar'}
              </button>
              <button type="button" class="btn btn-outline-secondary" onClick=${() => setFormItem(FORM_ITEM_INICIAL)}>
                Limpar
              </button>
            </footer>
          </form>
          `}
        </section>

        <section class="c24-card settings-catalog-list-card">
          <header class="c24-card-header">
            <div>
              <span class="c24-eyebrow">${secaoCatalogoAtiva?.label || 'Regras'}</span>
              <h3>Itens cadastrados</h3>
              <p>Desative itens usados nos fluxos; não remova fisicamente.</p>
            </div>
            <div class="settings-card-actions">
              <button type="button" class="btn btn-primary btn-sm" onClick=${() => setFormItem(FORM_ITEM_INICIAL)}>
                <${Icone} name="add" />
              </button>
            </div>
          </header>

          <div class="c24-filter-bar settings-catalog-filter">
            <${FilterField} label="Buscar" icon="search">
              <input
                class="form-control"
                value=${filtrosCatalogo.busca}
                placeholder="Nome, chave ou categoria"
                onInput=${(event) => setFiltrosCatalogo({ ...filtrosCatalogo, busca: event.target.value })}
              />
            </${FilterField}>
            <${FilterField} label="Status">
              <select
                class="form-select"
                value=${filtrosCatalogo.status}
                onChange=${(event) => setFiltrosCatalogo({ ...filtrosCatalogo, status: event.target.value })}
              >
                ${STATUS_ITEM.map(
      (item) => html`<option key=${item.value} value=${item.value}>${item.label}</option>`,
    )}
              </select>
            </${FilterField}>
          </div>

          ${itensCatalogoFiltrados.length
      ? html`
                      <div class="settings-catalog-items">
                        ${itensCatalogoFiltrados.map(
            (item) => html`
                            <article class=${`settings-catalog-item ${String(item.id_item) === String(formItem.id_item) ? 'is-active' : ''}`.trim()} key=${item.id_item}>
                              <button type="button" class="settings-catalog-item-main" onClick=${() => editarItem(item)}>
                                <span
                                  class="settings-catalog-icon"
                                  style=${secaoCatalogoAtiva?.tipo === 'operacoes' && item.payload?.cor_tag
                ? { color: item.payload.cor_tag, borderColor: item.payload.cor_tag }
                : {}}
                                ><${Icone} name=${CATALOGO_ICONS[secaoCatalogoAtiva?.tipo] || 'settings'} /></span>
                                <span>
                                  <strong>${item.nome || '-'}</strong>
                                  <small>${item.descricao || item.categoria || item.chave || 'Sem descrição'}</small>
                                </span>
                              </button>
                              <div class="settings-catalog-item-actions">
                                <${Badge} label=${item.ativo ? 'Ativo' : 'Inativo'} tone=${item.ativo ? 'success' : 'muted'} />
                                <${MenuAcoesProcesso}
                                  ariaLabel="Ações do item"
                                  acoes=${[
                { key: 'editar', label: 'Editar', icon: 'edit', onClick: () => editarItem(item) },
                { key: 'duplicar', label: 'Duplicar', icon: 'content_copy', onClick: () => duplicarItem(item) },
                {
                  key: 'arquivar',
                  label: 'Arquivar',
                  icon: 'archive',
                  danger: true,
                  disabled: !item.ativo,
                  onClick: () => desativarItem(item),
                },
              ]}
                                />
                              </div>
                            </article>
                          `,
          )}
                      </div>
                      <div class="settings-list-footer">
                        <span>${itensCatalogoFiltrados.length} exibidos de ${itensCatalogo.length}</span>
                        <button type="button" class="c24-link-btn" onClick=${() => setFiltrosCatalogo({ busca: '', status: 'todos' })}>
                          Ver todos
                        </button>
                      </div>
                    `
          : html`
                      <${EmptyPanel}
                        icon="inventory_2"
                        title="Sem itens"
                        text="Cadastre o primeiro item reutilizável deste catálogo."
                        action=${html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => setFormItem(FORM_ITEM_INICIAL)}>Novo item</button>`}
                      />
                    `}
        </section>
      </div>
    </div>
  `;

  const alternarAutomacaoEmail = async (ativo) => {
    setSalvandoAutomacao(true);
    setErro('');
    try {
      const payload = { ...automacaoNotificacoes, email_automatico_ativo: ativo };
      await atualizarAutomacaoNotificacoes(payload);
      setAutomacaoNotificacoes(payload);
      setFeedback(
        ativo
          ? 'Automação de e-mail por etapa ativada.'
          : 'Automação de e-mail por etapa desativada.',
      );
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar a automação de notificações.');
    } finally {
      setSalvandoAutomacao(false);
    }
  };

  const alternarLembretesAutomaticos = async (ativo) => {
    setSalvandoAutomacao(true);
    setErro('');
    try {
      const payload = { ...automacaoNotificacoes, lembretes_automaticos_ativos: ativo };
      await atualizarAutomacaoNotificacoes(payload);
      setAutomacaoNotificacoes(payload);
      setFeedback(
        ativo
          ? 'Lembretes automáticos de processos parados ativados.'
          : 'Lembretes automáticos de processos parados desativados.',
      );
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar a automação de lembretes.');
    } finally {
      setSalvandoAutomacao(false);
    }
  };

  const renderNotificacoes = () => html`
    <div class="settings-admin-shell">
      <section class="c24-card">
        <header class="c24-card-header">
          <h2>E-mails automáticos por etapa</h2>
        </header>
        <div class="process-cutoff-panel">
          <label class="process-switch-row">
            <input
              type="checkbox"
              checked=${Boolean(automacaoNotificacoes.email_automatico_ativo)}
              disabled=${salvandoAutomacao}
              onChange=${(event) => alternarAutomacaoEmail(event.target.checked)}
            />
            <span class="process-switch-visual"></span>
            <span>
              <strong>Enviar e-mail automaticamente quando o candidato for aprovado</strong>
              <small>
                Reaproveita o mesmo texto que o RH prepara ao aprovar o candidato (mensagem, anexo e
                documentos). O envio manual continua disponível normalmente, mesmo com a automação
                ativada. Desligado por padrão — ative apenas quando o time estiver ciente da mudança.
              </small>
            </span>
          </label>
        </div>
        <p class="settings-notifications-hint">
          Hoje a automação cobre apenas a aprovação, por ser a única etapa com um modelo de mensagem já
          estabelecido no sistema. Outras etapas (reprovação, proposta enviada) podem ser adicionadas no
          futuro, assim como o disparo automático por WhatsApp.
        </p>
      </section>

      <section class="c24-card">
        <header class="c24-card-header">
          <h2>Lembretes e alertas automáticos</h2>
        </header>
        <div class="process-cutoff-panel">
          <label class="process-switch-row">
            <input
              type="checkbox"
              checked=${Boolean(automacaoNotificacoes.lembretes_automaticos_ativos)}
              disabled=${salvandoAutomacao}
              onChange=${(event) => alternarLembretesAutomaticos(event.target.checked)}
            />
            <span class="process-switch-visual"></span>
            <span>
              <strong>Enviar lembrete automático de processos sem movimentação</strong>
              <small>
                Um job interno do backend verifica periodicamente os processos parados (mesma regra do
                alerta de inatividade já existente) e envia um e-mail de aviso ao RH responsável, sem
                repetir o alerta para o mesmo processo em menos de 7 dias. Desligado por padrão — ative
                apenas quando o time estiver ciente da mudança.
              </small>
            </span>
          </label>
        </div>
      </section>
    </div>
  `;

  const alternarTemaAmbiente = () => {
    setTemaAmbiente(definirTema(proximoTema(temaAmbiente)));
  };

  const alternarOrientacoesAmbiente = (ativo) => {
    setOrientacoesAmbiente(definirOrientacoesAtivas(ativo));
  };

  const escolherAvatarAmbiente = async (avatarId) => {
    setSalvandoAvatar(true);
    setErro('');
    try {
      const novoId = controlador?.estado?.avatarUsuario === avatarId ? '' : avatarId;
      await controlador.atualizarAvatarUsuario(novoId);
      setFeedback(novoId ? 'Avatar atualizado.' : 'Avatar removido — voltando às iniciais.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o avatar.');
    } finally {
      setSalvandoAvatar(false);
    }
  };

  const alternarCategoriaNotificacaoAmbiente = (categoriaId, ativo) => {
    const proximas = { ...preferenciasNotificacaoAmbiente, [categoriaId]: ativo };
    setPreferenciasNotificacaoAmbiente(proximas);
    salvarPreferenciasNotificacao(proximas);
  };

  const alterarCorNotificacaoAmbiente = (categoriaId, cor) => {
    setCoresNotificacaoAmbiente(salvarCorNotificacao(categoriaId, cor));
  };

  const salvarNomeAmbiente = async () => {
    const nomeLimpo = nomeDraft.trim();
    if (!nomeLimpo) return;
    setSalvandoNome(true);
    setErro('');
    try {
      await controlador.atualizarNomeUsuario(nomeLimpo);
      setNomeDraft(nomeLimpo);
      setFeedback('Nome atualizado.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o nome.');
    } finally {
      setSalvandoNome(false);
    }
  };

  const salvarSenhaAmbiente = async () => {
    setErroSenhaAmbiente('');
    if (!formSenhaAmbiente.senhaAtual) {
      setErroSenhaAmbiente('Informe sua senha atual.');
      return;
    }
    if (formSenhaAmbiente.novaSenha.length < 8) {
      setErroSenhaAmbiente('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (formSenhaAmbiente.novaSenha !== formSenhaAmbiente.confirmarNovaSenha) {
      setErroSenhaAmbiente('A confirmação não corresponde à nova senha.');
      return;
    }
    setSalvandoSenhaAmbiente(true);
    try {
      await controlador.atualizarSenhaUsuario(formSenhaAmbiente.senhaAtual, formSenhaAmbiente.novaSenha);
      setFormSenhaAmbiente({ senhaAtual: '', novaSenha: '', confirmarNovaSenha: '' });
      setFeedback('Senha atualizada.');
    } catch (error) {
      setErroSenhaAmbiente(error?.message || 'Não foi possível atualizar a senha.');
    } finally {
      setSalvandoSenhaAmbiente(false);
    }
  };

  const salvarSobrenomeAmbiente = async () => {
    setSalvandoSobrenome(true);
    setErro('');
    try {
      await controlador.atualizarSobrenomeUsuario(sobrenomeDraft.trim());
      setFeedback('Sobrenome atualizado.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o sobrenome.');
    } finally {
      setSalvandoSobrenome(false);
    }
  };

  const salvarCargoAmbiente = async () => {
    setSalvandoCargo(true);
    setErro('');
    try {
      await controlador.atualizarCargoUsuario(cargoDraft.trim());
      setFeedback('Cargo atualizado.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o cargo.');
    } finally {
      setSalvandoCargo(false);
    }
  };

  const enviarSolicitacaoEmailAmbiente = async () => {
    setSalvandoEmail(true);
    setErro('');
    try {
      await controlador.solicitarAlteracaoEmail(emailDraft.trim());
      setEmailDraft('');
      setFeedback('Sua alteração foi enviada para aprovação do administrador.');
    } catch (error) {
      setErro(error?.message || 'Não foi possível enviar a solicitação de alteração de e-mail.');
    } finally {
      setSalvandoEmail(false);
    }
  };

  const salvarLoginLocalAmbiente = async () => {
    setErro('');
    if (formLoginLocalAmbiente.novaSenha.length < 8) {
      setErro('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (formLoginLocalAmbiente.novaSenha !== formLoginLocalAmbiente.confirmarSenha) {
      setErro('A confirmação não corresponde à nova senha.');
      return;
    }
    setSalvandoLoginLocalAmbiente(true);
    try {
      await controlador.ativarLoginLocal(formLoginLocalAmbiente.novaSenha, formLoginLocalAmbiente.confirmarSenha);
      setFormLoginLocalAmbiente({ novaSenha: '', confirmarSenha: '' });
      setMostrarFormLoginLocalAmbiente(false);
      setFeedback(
        `Login local ativado. Seu usuário de acesso é o e-mail ${controlador?.estado?.emailUsuarioAutenticado || 'cadastrado'}.`,
      );
    } catch (error) {
      setErro(error?.message || 'Não foi possível ativar o login local.');
    } finally {
      setSalvandoLoginLocalAmbiente(false);
    }
  };

  const alternarLoginMicrosoftAmbiente = async (ativarMicrosoft) => {
    setErro('');
    setSalvandoProvedorAmbiente(true);
    try {
      await controlador.atualizarProvedorAutenticacao(ativarMicrosoft ? 'microsoft' : 'local');
      setFeedback(ativarMicrosoft ? 'Login pela Microsoft reativado.' : 'Login pela Microsoft desativado.');
    } catch (error) {
      if (!ativarMicrosoft) {
        // Ainda não existe senha local cadastrada — abre o formulário para criar uma antes de desativar.
        setMostrarFormLoginLocalAmbiente(true);
      } else {
        setErro(error?.message || 'Não foi possível reativar o login pela Microsoft.');
      }
    } finally {
      setSalvandoProvedorAmbiente(false);
    }
  };

  const carregarSolicitacoesEmailPendentes = async () => {
    try {
      const resultado = await listarSolicitacoesAlteracaoEmailApi();
      setSolicitacoesEmailPendentes(Array.isArray(resultado?.solicitacoes) ? resultado.solicitacoes : []);
    } catch (error) {
      // Painel de solicitações é complementar — falha ao carregar não deve travar a tela de Usuários.
    }
  };

  const aprovarSolicitacaoEmailAmbiente = async (idSolicitacao) => {
    setDecidindoSolicitacaoEmailId(String(idSolicitacao));
    setErro('');
    try {
      await aprovarSolicitacaoAlteracaoEmailApi(idSolicitacao);
      setFeedback('Alteração de e-mail aprovada.');
      await carregarSolicitacoesEmailPendentes();
    } catch (error) {
      setErro(error?.message || 'Não foi possível aprovar a solicitação.');
    } finally {
      setDecidindoSolicitacaoEmailId('');
    }
  };

  const rejeitarSolicitacaoEmailAmbiente = async (idSolicitacao) => {
    setDecidindoSolicitacaoEmailId(String(idSolicitacao));
    setErro('');
    try {
      await rejeitarSolicitacaoAlteracaoEmailApi(idSolicitacao);
      setFeedback('Alteração de e-mail rejeitada.');
      await carregarSolicitacoesEmailPendentes();
    } catch (error) {
      setErro(error?.message || 'Não foi possível rejeitar a solicitação.');
    } finally {
      setDecidindoSolicitacaoEmailId('');
    }
  };

  const ABAS_AMBIENTE = [
    { id: 'perfil', label: 'Perfil', icon: 'person' },
    { id: 'seguranca', label: 'Segurança', icon: 'lock' },
    { id: 'aparencia', label: 'Aparência', icon: 'tune' },
    { id: 'notificacoes', label: 'Notificações', icon: 'notifications_active' },
  ];

  const renderAmbiente = () => html`
    <div class="settings-ambiente-shell">
      <div class="settings-ambiente-tabs">
        ${ABAS_AMBIENTE.map(
    (aba) => html`
            <${BotaoAba} key=${aba.id} aba=${aba} ativa=${abaAmbiente === aba.id} onClick=${() => setAbaAmbiente(aba.id)} />
          `,
  )}
      </div>

      <section class="c24-card settings-ambiente-panel">
        ${abaAmbiente === 'perfil'
      ? html`
              <div class="settings-ambiente-section">
                <h3>Nome</h3>
                <label class="settings-name-field">
                  <div class="settings-name-row">
                    <input
                      class="form-control"
                      value=${nomeDraft}
                      maxlength="120"
                      disabled=${salvandoNome}
                      onInput=${(event) => setNomeDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled=${salvandoNome || !nomeDraft.trim() || nomeDraft.trim() === (controlador?.estado?.nomeUsuarioAutenticado || '').trim()}
                      onClick=${salvarNomeAmbiente}
                    >
                      ${salvandoNome ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </label>
              </div>

              <div class="settings-ambiente-section">
                <h3>Sobrenome</h3>
                <label class="settings-name-field">
                  <div class="settings-name-row">
                    <input
                      class="form-control"
                      value=${sobrenomeDraft}
                      maxlength="180"
                      disabled=${salvandoSobrenome}
                      onInput=${(event) => setSobrenomeDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled=${salvandoSobrenome || sobrenomeDraft.trim() === (controlador?.estado?.sobrenomeUsuarioAutenticado || '').trim()}
                      onClick=${salvarSobrenomeAmbiente}
                    >
                      ${salvandoSobrenome ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </label>
              </div>

              <div class="settings-ambiente-section">
                <h3>Cargo</h3>
                <label class="settings-name-field">
                  <div class="settings-name-row">
                    <input
                      class="form-control"
                      value=${cargoDraft}
                      maxlength="180"
                      disabled=${salvandoCargo}
                      onInput=${(event) => setCargoDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled=${salvandoCargo || cargoDraft.trim() === (controlador?.estado?.cargoUsuarioAutenticado || '').trim()}
                      onClick=${salvarCargoAmbiente}
                    >
                      ${salvandoCargo ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </label>
              </div>

              <div class="settings-ambiente-section">
                <h3>E-mail</h3>
                <p class="settings-notifications-hint">
                  Alterações passam por aprovação do administrador antes de serem aplicadas.
                </p>
                <label class="settings-name-field">
                  <div class="settings-name-row">
                    <input
                      class="form-control"
                      type="email"
                      placeholder="novo-email@exemplo.com"
                      value=${emailDraft}
                      disabled=${salvandoEmail}
                      onInput=${(event) => setEmailDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      disabled=${salvandoEmail || !emailDraft.trim()}
                      onClick=${enviarSolicitacaoEmailAmbiente}
                    >
                      ${salvandoEmail ? 'Enviando...' : 'Solicitar alteração'}
                    </button>
                  </div>
                </label>
              </div>

              <div class="settings-ambiente-section">
                <div class="settings-ambiente-section-header">
                  <div>
                    <h3>Avatar</h3>
                    <p class="settings-notifications-hint">
                      Ative para escolher um avatar ilustrado para o seu perfil.
                    </p>
                  </div>
                  <div class="settings-ambiente-section-actions">
                    <label class="process-switch-row" title=${controlador?.estado?.avatarUsuario ? 'Desativar avatar' : 'Ativar avatar'}>
                      <input
                        type="checkbox"
                        checked=${Boolean(controlador?.estado?.avatarUsuario)}
                        disabled=${salvandoAvatar}
                        onChange=${(event) => {
          if (event.target.checked) {
            setAvatarExpandido(true);
          } else {
            escolherAvatarAmbiente(controlador?.estado?.avatarUsuario);
          }
        }}
                      />
                      <span class="process-switch-visual"></span>
                    </label>
                    <button
                      type="button"
                      class="settings-avatar-fold-btn"
                      aria-label=${avatarExpandido ? 'Recolher avatares' : 'Expandir avatares'}
                      onClick=${() => setAvatarExpandido((valor) => !valor)}
                    >
                      <${Icone} name=${avatarExpandido ? 'expand_less' : 'expand_more'} />
                    </button>
                  </div>
                </div>
                ${avatarExpandido
          ? html`
                      <div class="settings-avatar-grid">
                        ${AVATARES_ILUSTRADOS.map(
            (avatar) => html`
                            <button
                              key=${avatar.id}
                              type="button"
                              class=${`settings-avatar-option ${controlador?.estado?.avatarUsuario === avatar.id ? 'is-selected' : ''}`}
                              disabled=${salvandoAvatar}
                              title=${avatar.id}
                              onClick=${() => escolherAvatarAmbiente(avatar.id)}
                            >
                              <img src=${avatar.url} alt="" loading="lazy" />
                            </button>
                          `,
          )}
                      </div>
                    `
          : null}
              </div>
            `
      : null}

        ${abaAmbiente === 'seguranca'
      ? html`
              <div class="settings-ambiente-section">
                <h3>Alterar senha</h3>
                <p class="settings-notifications-hint">
                  Válido apenas para usuários com acesso local. Quem entra pela Microsoft gerencia a senha por lá.
                </p>
                ${erroSenhaAmbiente ? html`<div class="alert alert-warning">${erroSenhaAmbiente}</div>` : null}
                <div class="settings-password-grid">
                  <label class="settings-name-field">
                    <span>Senha atual</span>
                    <input
                      class="form-control"
                      type="password"
                      autocomplete="current-password"
                      value=${formSenhaAmbiente.senhaAtual}
                      disabled=${salvandoSenhaAmbiente}
                      onInput=${(event) => setFormSenhaAmbiente({ ...formSenhaAmbiente, senhaAtual: event.target.value })}
                    />
                  </label>
                  <label class="settings-name-field">
                    <span>Nova senha</span>
                    <input
                      class="form-control"
                      type="password"
                      autocomplete="new-password"
                      value=${formSenhaAmbiente.novaSenha}
                      disabled=${salvandoSenhaAmbiente}
                      onInput=${(event) => setFormSenhaAmbiente({ ...formSenhaAmbiente, novaSenha: event.target.value })}
                    />
                  </label>
                  <label class="settings-name-field">
                    <span>Confirmar nova senha</span>
                    <input
                      class="form-control"
                      type="password"
                      autocomplete="new-password"
                      value=${formSenhaAmbiente.confirmarNovaSenha}
                      disabled=${salvandoSenhaAmbiente}
                      onInput=${(event) => setFormSenhaAmbiente({ ...formSenhaAmbiente, confirmarNovaSenha: event.target.value })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled=${salvandoSenhaAmbiente || !formSenhaAmbiente.senhaAtual || !formSenhaAmbiente.novaSenha}
                  onClick=${salvarSenhaAmbiente}
                >
                  ${salvandoSenhaAmbiente ? 'Salvando...' : 'Alterar senha'}
                </button>
              </div>

              <div class="settings-ambiente-section">
                <div class="settings-ambiente-section-header">
                  <div>
                    <h3>Forma de login</h3>
                    <p class="settings-notifications-hint">
                      Os dois botões abaixo são espelhados: ativar um desativa o outro automaticamente. O login é
                      sempre o seu e-mail cadastrado.
                    </p>
                  </div>
                  <div class="settings-ambiente-section-actions">
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm"
                      onClick=${() => setEditandoLoginAmbiente((valor) => !valor)}
                    >
                      ${editandoLoginAmbiente ? 'Concluir edição' : 'Editar'}
                    </button>
                  </div>
                </div>
                <div class="process-cutoff-panel">
                  <label class="process-switch-row">
                    <input
                      type="checkbox"
                      checked=${controlador?.estado?.provedorAutenticacaoUsuario === 'microsoft'}
                      disabled=${salvandoProvedorAmbiente || !editandoLoginAmbiente}
                      onChange=${(event) => alternarLoginMicrosoftAmbiente(event.target.checked)}
                    />
                    <span class="process-switch-visual"></span>
                    <span>
                      <strong>Entrar pela Microsoft</strong>
                      <small>Login e senha gerenciados pela Microsoft (SSO).</small>
                    </span>
                  </label>
                  <label class="process-switch-row">
                    <input
                      type="checkbox"
                      checked=${controlador?.estado?.provedorAutenticacaoUsuario !== 'microsoft'}
                      disabled=${salvandoProvedorAmbiente || !editandoLoginAmbiente}
                      onChange=${(event) => alternarLoginMicrosoftAmbiente(!event.target.checked)}
                    />
                    <span class="process-switch-visual"></span>
                    <span>
                      <strong>Login com senha</strong>
                      <small>Acesso local com e-mail + senha própria do Conecta.</small>
                    </span>
                  </label>
                </div>

                ${mostrarFormLoginLocalAmbiente
          ? html`
                      <div class="settings-password-grid">
                        <label class="settings-name-field">
                          <span>Nova senha de acesso local</span>
                          <input
                            class="form-control"
                            type="password"
                            autocomplete="new-password"
                            value=${formLoginLocalAmbiente.novaSenha}
                            disabled=${salvandoLoginLocalAmbiente}
                            onInput=${(event) =>
              setFormLoginLocalAmbiente({ ...formLoginLocalAmbiente, novaSenha: event.target.value })}
                          />
                        </label>
                        <label class="settings-name-field">
                          <span>Confirmar nova senha</span>
                          <input
                            class="form-control"
                            type="password"
                            autocomplete="new-password"
                            value=${formLoginLocalAmbiente.confirmarSenha}
                            disabled=${salvandoLoginLocalAmbiente}
                            onInput=${(event) =>
              setFormLoginLocalAmbiente({ ...formLoginLocalAmbiente, confirmarSenha: event.target.value })}
                          />
                        </label>
                      </div>
                      <div class="settings-card-actions settings-card-actions--stack">
                        <button
                          type="button"
                          class="btn btn-primary btn-sm"
                          disabled=${salvandoLoginLocalAmbiente || !formLoginLocalAmbiente.novaSenha}
                          onClick=${salvarLoginLocalAmbiente}
                        >
                          ${salvandoLoginLocalAmbiente ? 'Salvando...' : 'Criar senha local'}
                        </button>
                        <button
                          type="button"
                          class="btn btn-outline-secondary btn-sm"
                          disabled=${salvandoLoginLocalAmbiente}
                          onClick=${() => {
              setMostrarFormLoginLocalAmbiente(false);
              setFormLoginLocalAmbiente({ novaSenha: '', confirmarSenha: '' });
            }}
                        >
                          Cancelar
                        </button>
                      </div>
                    `
          : null}
              </div>
            `
      : null}

        ${abaAmbiente === 'aparencia'
      ? html`
              <div class="settings-ambiente-section">
                <h3>Aparência</h3>
                <div class="process-cutoff-panel">
                  <label class="process-switch-row">
                    <input
                      type="checkbox"
                      checked=${temaAmbiente === 'escuro'}
                      onChange=${alternarTemaAmbiente}
                    />
                    <span class="process-switch-visual"></span>
                    <span>
                      <strong>Modo escuro</strong>
                      <small>Alterna o tema visual do Conecta para todas as telas.</small>
                    </span>
                  </label>
                </div>
              </div>

              <div class="settings-ambiente-section">
                <h3>Orientações</h3>
                <div class="process-cutoff-panel">
                  <label class="process-switch-row">
                    <input
                      type="checkbox"
                      checked=${orientacoesAmbiente}
                      onChange=${(event) => alternarOrientacoesAmbiente(event.target.checked)}
                    />
                    <span class="process-switch-visual"></span>
                    <span>
                      <strong>Ativar orientações guiadas</strong>
                      <small>
                        Mostra dicas passo a passo na primeira visita a cada tela e o item "Ver orientações"
                        no menu do seu perfil. Desative se preferir navegar sem os balões de ajuda.
                      </small>
                    </span>
                  </label>
                </div>
              </div>
            `
      : null}

        ${abaAmbiente === 'notificacoes'
      ? html`
              <div class="settings-ambiente-section">
                <h3>Notificações</h3>
                <p class="settings-notifications-hint">
                  Escolha quais categorias aparecem no sino de notificações no topo do Conecta, e personalize a cor de cada uma.
                </p>
                <div class="settings-notif-list">
                  ${CATEGORIAS_NOTIFICACAO.map(
        (categoria) => html`
                      <div class="settings-notif-row" key=${categoria.id}>
                        <label class="process-switch-row settings-notif-toggle">
                          <input
                            type="checkbox"
                            checked=${preferenciasNotificacaoAmbiente[categoria.id] !== false}
                            onChange=${(event) => alternarCategoriaNotificacaoAmbiente(categoria.id, event.target.checked)}
                          />
                          <span class="process-switch-visual"></span>
                          <span>
                            <strong>${categoria.label}</strong>
                            <small>${categoria.descricao}</small>
                          </span>
                        </label>
                        <label class="settings-notif-color" title="Escolher cor desta categoria">
                          <input
                            type="color"
                            value=${coresNotificacaoAmbiente[categoria.id] || categoria.cor}
                            onInput=${(event) => alterarCorNotificacaoAmbiente(categoria.id, event.target.value)}
                          />
                        </label>
                      </div>
                    `,
      )}
                </div>
              </div>
            `
      : null}
      </section>
    </div>
  `;

  // Logs do sistema e Logs da Monitoria (só Administrador) numa única tela, separados por abas.
  const renderLogsComAbas = () => {
    const temLogsMonitoria = ehAdministrador && controlador.possuiPermissao('monitoria.logs');
    if (!temLogsMonitoria) return renderLogs();
    return html`
      <div class="settings-admin-shell">
        <div class="cfg-subabas" role="tablist" aria-label="Tipo de log">
          ${[['sistema', 'Logs do sistema', 'history_edu'], ['monitoria', 'Logs da Monitoria', 'lock']].map(([id, rotulo, icone]) => html`
            <button key=${id} type="button" role="tab" aria-selected=${subAbaLogs === id} class=${`cfg-subaba ${subAbaLogs === id ? 'is-active' : ''}`} onClick=${() => setSubAbaLogs(id)}>
              <${Icone} name=${icone} /> ${rotulo}
            </button>`)}
        </div>
        ${subAbaLogs === 'monitoria' ? html`<${AbaLogsMonitoria} />` : renderLogs()}
      </div>
    `;
  };

  const renderLogs = () => html`
    <div class="settings-admin-shell">
      <${StatGrid}
        items=${[
      {
        icon: 'today',
        label: 'Ações hoje',
        value: contarPor(logs, (log) => {
          const data = new Date(log.data_hora);
          return !Number.isNaN(data.getTime()) && data.getTime() >= hojeSemHora().getTime();
        }),
        helper: 'Desde 00:00',
        tone: 'blue',
      },
      {
        icon: 'priority_high',
        label: 'Críticas',
        value: contarPor(logs, (log) => inferirCriticidadeLog(log) === 'Crítica'),
        helper: 'Permissões, senha e bloqueios',
        tone: 'yellow',
      },
      {
        icon: 'error',
        label: 'Falhas',
        value: contarPor(logs, (log) => log.sucesso === false),
        helper: 'Eventos sem sucesso',
        tone: 'red',
      },
      {
        icon: 'login',
        label: 'Logins recentes',
        value: contarPor(logs, (log) => normalizarBusca(log.acao).includes('login')),
        helper: 'Entradas e recusas',
        tone: 'green',
      },
    ]}
      />

      <section class="c24-card settings-logs-panel">
        <header class="c24-card-header">
          <div>
            <span class="c24-eyebrow">Auditoria</span>
            <h3>Logs do sistema</h3>
            <p>${logsFiltrados.length} evento(s) encontrados nos filtros atuais.</p>
          </div>
          <div class="settings-card-actions">
            <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => carregarAba(abaRenderizada)}>
              <${Icone} name="refresh" /> Atualizar
            </button>
            <button type="button" class="btn btn-primary btn-sm" disabled=${!controlador.possuiPermissao('logs.exportar')} onClick=${exportarLogs}>
              <${Icone} name="download" /> Exportar
            </button>
          </div>
        </header>

        <div class="c24-filter-bar settings-log-filter">
          <${FilterField} label="Busca" icon="search">
            <input
              class="form-control"
              value=${filtrosLogs.busca}
              placeholder="Texto livre"
              onInput=${(event) => {
      setFiltrosLogs({ ...filtrosLogs, busca: event.target.value });
      setPaginaLogs(1);
    }}
            />
          </${FilterField}>
          <${FilterField} label="Módulo">
            <select
              class="form-select"
              value=${filtrosLogs.modulo}
              onChange=${(event) => {
      setFiltrosLogs({ ...filtrosLogs, modulo: event.target.value });
      setPaginaLogs(1);
    }}
            >
              <option value="">Todos</option>
              ${modulosLogs.map((modulo) => html`<option key=${modulo} value=${modulo}>${modulo}</option>`)}
            </select>
          </${FilterField}>
          <${FilterField} label="Ação" icon="bolt">
            <select
              class="form-select"
              value=${filtrosLogs.acao}
              onChange=${(event) => {
      setFiltrosLogs({ ...filtrosLogs, acao: event.target.value });
      setPaginaLogs(1);
    }}
            >
              <option value="">Todas</option>
              ${acoesLogs.map((acao) => html`<option key=${acao} value=${acao}>${acao}</option>`)}
            </select>
          </${FilterField}>
          <${FilterField} label="Usuário" icon="person">
            <input
              class="form-control"
              value=${filtrosLogs.usuario}
              onInput=${(event) => {
      setFiltrosLogs({ ...filtrosLogs, usuario: event.target.value });
      setPaginaLogs(1);
    }}
            />
          </${FilterField}>
          <${FilterField} label="Criticidade" icon="priority_high">
            <select
              class="form-select"
              value=${filtrosLogs.criticidade}
              onChange=${(event) => {
      setFiltrosLogs({ ...filtrosLogs, criticidade: event.target.value });
      setPaginaLogs(1);
    }}
            >
              <option value="">Todas</option>
              <option value="Operacional">Operacional</option>
              <option value="Critica">Crítica</option>
              <option value="Falha">Falha</option>
            </select>
          </${FilterField}>
          <${FilterField} label="Período" icon="calendar_month">
            <select
              class="form-select"
              value=${filtrosLogs.periodo}
              onChange=${(event) => {
      setFiltrosLogs({ ...filtrosLogs, periodo: event.target.value });
      setPaginaLogs(1);
    }}
            >
              <option value="">Todo período</option>
              <option value="hoje">Hoje</option>
              <option value="7d">7 dias</option>
              <option value="30d">30 dias</option>
            </select>
          </${FilterField}>
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            onClick=${() => {
      setFiltrosLogs({ busca: '', modulo: '', acao: '', usuario: '', criticidade: '', status: '', periodo: '' });
      setPaginaLogs(1);
    }}
          >
            Limpar
          </button>
        </div>

        ${paginacaoLogs.itens.length
      ? html`
              <div class="settings-log-list">
                ${paginacaoLogs.itens.map(
        (log) => {
          const aberto = String(logExpandidoId) === String(log.id_log);
          const criticidade = inferirCriticidadeLog(log);
          return html`
                      <article class=${`settings-log-card ${aberto ? 'is-open' : ''}`.trim()} key=${log.id_log}>
                        <button
                          type="button"
                          class="settings-log-summary"
                          onClick=${() => setLogExpandidoId(aberto ? '' : log.id_log)}
                        >
                          <span class="settings-log-time">
                            <strong>${formatarData(log.data_hora)}</strong>
                            <small>${log.modulo || '-'}</small>
                          </span>
                          <span class="settings-log-user">
                            <strong>${log.nome_usuario || '-'}</strong>
                            <small>${log.perfil_nome || log.email_usuario || '-'}</small>
                          </span>
                          <span class="settings-log-action">
                            <strong>${log.acao || '-'}</strong>
                            <small>${`${log.entidade || '-'} ${log.entidade_id || ''}`}</small>
                          </span>
                          <span class="settings-log-badges">
                            <${Badge} label=${criticidade} tone=${obterStatusTone(criticidade)} />
                            <${Badge} label=${log.sucesso === false ? 'Falha' : 'Sucesso'} tone=${log.sucesso === false ? 'danger' : 'success'} />
                            <${Icone} name=${aberto ? 'expand_less' : 'expand_more'} />
                          </span>
                        </button>
                        ${aberto
              ? html`
                              <div class="settings-log-details">
                                <div>
                                  <strong>Antes</strong>
                                  <pre class="settings-log-pre">${formatarPayloadLog(log.valor_anterior)}</pre>
                                </div>
                                <div>
                                  <strong>Depois</strong>
                                  <pre class="settings-log-pre">${formatarPayloadLog(log.valor_novo)}</pre>
                                </div>
                                <div>
                                  <strong>Contexto</strong>
                                  <p>${log.justificativa || 'Sem justificativa registrada.'}</p>
                                  <small>Origem: ${log.origem || '-'}</small>
                                </div>
                              </div>
                            `
              : null}
                      </article>
                    `;
        },
      )}
              </div>
              <${PaginacaoCompacta} paginacao=${paginacaoLogs} onChange=${setPaginaLogs} />
            `
      : html`
              <${EmptyPanel}
                icon="history"
                title="Sem logs"
                text="Nenhum evento de auditoria corresponde aos filtros atuais."
              />
            `}
      </section>
    </div>
  `;

  return html`
    <${PainelRh}
      screenId="screen-settings"
      navAtiva=${telaAtual}
      subtituloMarca="Configurações"
      placeholderBusca="Configurações, usuários, permissões e logs"
      controlador=${controlador}
      mostrarAtalhos=${false}
    >
      <${PageIntro}
        kicker="Console - Administração"
        title=${abasPermitidas.find((aba) => aba.id === abaRenderizada)?.label || 'Configurações'}
        actions=${abaRenderizada === 'usuarios'
      ? html`
              <button
                type="button"
                class="c24-icon-btn"
                title="Atualizar usuários"
                aria-label="Atualizar usuários"
                disabled=${carregando}
                onClick=${() => carregarAba(abaRenderizada)}
              >
                <${Icone} name="refresh" />
              </button>
              ${ehAdministrador ? html`
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm"
                  title="Passa os operadores de um supervisor para outro (ex.: férias)"
                  onClick=${() => setTransferindoSupervisao(true)}
                >
                  Transferir supervisão
                </button>` : null}
              <button
                type="button"
                class="btn btn-outline-primary btn-sm"
                title="Criar login (nome, e-mail e senha) para um candidato aprovado fazer treinamento"
                disabled=${!controlador.possuiPermissao('usuarios.criar')}
                onClick=${abrirCriacaoUsuarioRapido}
              >
                Criar usuário rápido
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled=${!controlador.possuiPermissao('usuarios.criar')}
                onClick=${iniciarNovoUsuario}
              >
                Criar usuário
              </button>
            `
      : null}
      />

      ${erro && !drawerUsuarioAberto ? html`<div class="alert alert-danger c24-feedback">${erro}</div>` : null}
      ${feedback ? html`<div class="alert alert-success c24-feedback">${feedback}</div>` : null}
      ${ehAdministrador ? html`
        <${ModalTransferirSupervisao}
          aberto=${transferindoSupervisao}
          onClose=${() => setTransferindoSupervisao(false)}
          onFeito=${() => { setTransferindoSupervisao(false); setFeedback('Supervisão transferida.'); }}
          showToast=${(mensagem, tipo) => (tipo === 'danger' ? setErro(mensagem) : setFeedback(mensagem))}
        />` : null}
      ${carregando
      ? html`
            <div class="c24-loading-panel">
              <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
              <div>
                <strong>Carregando configurações</strong>
                <p>Buscando usuários, perfis, regras e logs de auditoria.</p>
              </div>
            </div>
          `
      : !abasPermitidas.length
        ? html`
              <${EmptyPanel}
                icon="lock"
                title="Sem permissão"
                text="Seu perfil não tem acesso a esta área administrativa."
              />
            `
        : abaRenderizada === 'usuarios'
          ? renderUsuarios()
          : abaRenderizada === 'perfis'
            ? renderPerfis()
            : abaRenderizada === 'operacoes'
              ? renderCatalogos()
              : abaRenderizada === 'catalogos'
                ? renderCatalogos()
                : abaRenderizada === 'notificacoes'
                  ? renderNotificacoes()
                  : abaRenderizada === 'ambiente'
                    ? renderAmbiente()
                    : abaRenderizada === 'equipes-catalogos'
                      ? html`<${AbaEquipesCatalogos} />`
                      : renderLogsComAbas()}
    </${PainelRh}>
  `;
}
