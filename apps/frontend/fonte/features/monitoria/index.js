import { html, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, PageIntro, PainelRh } from '../../ui/componentes-compartilhados.js';
import { AvatarUsuario } from '../../ui/components/layout.js?v=20260921-monitoria6';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { useContextoMonitoria } from './comum.js';
import { TelaNovaMonitoria } from './formulario.js';
import { ModalDetalheMonitoria } from './detalhe.js';
import { ListaMonitorias, ModalCompartilhar, TelaPlanos, TelaRelatorios } from './listas.js';
import { TelaDashboard } from './painel.js';
import { TelaFormularios } from './admin.js';
import { TelaCentralMonitoria } from './central.js';

// Vertente Monitoria: um único módulo de telas, cada uma com sua rota (screen-monitoria*).
// Toda restrição é aplicada no backend (escopo por operação/equipe/perfil); a tela só
// esconde o que o perfil não pode usar.

export const ABAS_MONITORIA = [
  { tela: 'screen-monitoria-nova', rotulo: 'Nova monitoria', icone: 'add', permissao: 'monitoria.criar' },
  { tela: 'screen-monitoria-feedback', rotulo: 'Feedback', icone: 'rate_review', permissao: 'monitoria.feedback_aplicar' },
  { tela: 'screen-monitoria-contestacoes', rotulo: 'Contestações', icone: 'verified', permissao: 'monitoria.reanalisar' },
  { tela: 'screen-monitoria-minhas', rotulo: 'Minhas monitorias', icone: 'assignment_ind', permissao: 'monitoria.contestar' },
  { tela: 'screen-monitoria', rotulo: 'Histórico', icone: 'history', permissao: 'monitoria.visualizar' },
  { tela: 'screen-monitoria-dashboard', rotulo: 'Dashboard', icone: 'analytics', permissao: 'monitoria.dashboard' },
  { tela: 'screen-monitoria-planos', rotulo: 'Planos de ação', icone: 'task_alt', permissao: 'monitoria.plano_acao_visualizar' },
  { tela: 'screen-monitoria-relatorios', rotulo: 'Relatórios', icone: 'table_chart', permissao: 'monitoria.relatorios' },
  { tela: 'screen-monitoria-formularios', rotulo: 'Formulários', icone: 'rule', permissao: 'monitoria.matriz' },
];

const TITULOS = {
  'screen-monitoria': ['Histórico de monitorias', 'Consulte e busque as monitorias do seu escopo.'],
  'screen-monitoria-nova': ['Nova monitoria', 'Registre uma avaliação. Depois de finalizada, ela nunca mais é alterada.'],
  'screen-monitoria-feedback': ['Feedback', 'Monitorias aguardando a aplicação do feedback.'],
  'screen-monitoria-contestacoes': ['Contestações', 'Contestações do operador para reanálise.'],
  'screen-monitoria-minhas': ['Minhas monitorias', 'Acompanhe suas avaliações, confirme ou conteste.'],
  'screen-monitoria-dashboard': ['Dashboard de qualidade', 'Indicadores respeitam seu perfil, filtros e escopo.'],
  'screen-monitoria-planos': ['Planos de ação', 'Acompanhe a evolução dos operadores.'],
  'screen-monitoria-relatorios': ['Relatórios', 'Visualize e exporte (XLSX ou CSV) com os mesmos indicadores do dashboard.'],
  'screen-monitoria-formularios': ['Formulários de monitoria', 'Matriz de qualidade versionada por operação.'],
};

export function abaInicialMonitoria(controlador) {
  const ordem = ['screen-monitoria-minhas', 'screen-monitoria-feedback', 'screen-monitoria-contestacoes', 'screen-monitoria-dashboard', 'screen-monitoria'];
  const perfil = controlador?.estado?.perfilUsuario;
  if (perfil === 'operador') return 'screen-monitoria-minhas';
  if (perfil === 'qualidade' || perfil === 'supervisor') return 'screen-monitoria-feedback';
  return ordem.find((t) => controlador.podeAcessarTela(t)) || 'screen-monitoria';
}

export function TelaMonitoria({ controlador, telaAtual = 'screen-monitoria' }) {
  const { showToast, ToastHost } = useToast();
  const { contexto, erro, recarregar } = useContextoMonitoria();
  const [detalhe, setDetalhe] = useState(null);
  const [compartilhar, setCompartilhar] = useState(null);
  const [atualizacao, setAtualizacao] = useState(0);

  const abas = ABAS_MONITORIA.filter((a) => controlador.possuiPermissao(a.permissao) || controlador.podeAcessarTela(a.tela) && a.tela === 'screen-monitoria-minhas');
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS['screen-monitoria'];

  const abrirDetalhe = (ref, opcoes = {}) => {
    if (opcoes.compartilhar) return setCompartilhar(opcoes.compartilhar);
    setDetalhe(ref);
  };
  const props = { controlador, contexto, showToast };

  let corpo;
  if (erro) corpo = html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  else if (!contexto) corpo = html`<${LoadingState} titulo="Carregando a Monitoria" />`;
  else if (telaAtual === 'screen-monitoria-nova') {
    corpo = html`<${TelaNovaMonitoria} ...${props} aoConcluir=${(r) => { controlador.irParaTelaProtegida('screen-monitoria'); setTimeout(() => setDetalhe(String(r.id_monitoria)), 300); }} />`;
  } else if (telaAtual === 'screen-monitoria-dashboard') corpo = html`<${TelaDashboard} ...${props} />`;
  else if (telaAtual === 'screen-monitoria-planos') corpo = html`<${TelaPlanos} ...${props} />`;
  else if (telaAtual === 'screen-monitoria-relatorios') corpo = html`<${TelaRelatorios} ...${props} />`;
  else if (telaAtual === 'screen-monitoria-formularios') corpo = html`<${TelaFormularios} ...${props} />`;
  else {
    const modo = { 'screen-monitoria-feedback': 'feedback', 'screen-monitoria-contestacoes': 'contestacoes', 'screen-monitoria-minhas': 'minhas' }[telaAtual] || 'historico';
    corpo = html`<${ListaMonitorias} ...${props} modo=${modo} abrirDetalhe=${abrirDetalhe} atualizacao=${atualizacao} />`;
  }

  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Monitoria" placeholderBusca="Monitoria" controlador=${controlador}>
      <${ToastHost} />
      <${PageIntro} kicker="Monitoria" title=${titulo} description=${descricao} />
      <div class="mon-shell">
        <nav class="mon-subnav" aria-label="Seções da Monitoria">
          ${abas.map((a) => html`
            <button key=${a.tela} type="button" class=${`mon-subnav-btn ${a.tela === telaAtual ? 'is-active' : ''}`} onClick=${() => controlador.irParaTelaProtegida(a.tela)}>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(a.icone)}</span>${a.rotulo}
            </button>`)}
        </nav>
        ${corpo}
      </div>
      <${ModalDetalheMonitoria} referencia=${detalhe} controlador=${controlador} contexto=${contexto} showToast=${showToast}
        onClose=${() => setDetalhe(null)} onAlterou=${() => setAtualizacao((n) => n + 1)} />
      <${ModalCompartilhar} ids=${compartilhar} onClose=${() => setCompartilhar(null)} showToast=${showToast} />
    </${PainelRh}>`;
}

export function TelaCentralMonitoriaConfig({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const { contexto, erro, recarregar } = useContextoMonitoria();
  return html`
    <${PainelRh} screenId="screen-settings-monitoria" navAtiva="screen-settings-monitoria" subtituloMarca="Central de Monitoria" placeholderBusca="Configurações" controlador=${controlador}>
      <${ToastHost} />
      <${PageIntro} kicker="Configurações" title="Central de Monitoria" description="Prazos, guia, identidade visual por operação e zona de risco." />
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : !contexto ? html`<${LoadingState} titulo="Carregando" />` : html`<${TelaCentralMonitoria} contexto=${contexto} showToast=${showToast} recarregarContexto=${recarregar} />`}
    </${PainelRh}>`;
}

// ---------------------------------------------------------------------------
// Início por sessões (todos os perfis, exceto Administrador e Gestor): saudação com
// nome e avatar + uma div por sessão a que o perfil tem acesso.
// ---------------------------------------------------------------------------
const SESSOES = [
  { id: 'curriculos', titulo: 'Caixa de Currículos', icone: 'badge', desc: 'Candidatos, e-mails e banco de talentos.', telas: ['screen-candidates', 'screen-email-inbox', 'screen-talent-bank'] },
  { id: 'processos', titulo: 'Processos', icone: 'checklist', desc: 'Processos seletivos, entrevistas e decisões.', telas: ['screen-processes', 'screen-interviews', 'screen-process-decisions'] },
  { id: 'provas', titulo: 'Provas', icone: 'quiz', desc: 'Conecta Provas e resultados.', telas: ['screen-generated-exams', 'screen-provas-configuracao'] },
  { id: 'gestao', titulo: 'Gestão', icone: 'analytics', desc: 'Indicadores, calendário e mural.', telas: ['screen-dashboard-funil', 'screen-analysis-candidates', 'screen-calendario', 'screen-mural'] },
  { id: 'drive', titulo: 'Drive', icone: 'cloud', desc: 'Arquivos e documentos.', telas: ['screen-onedrive-files'] },
  { id: 'treinamentos', titulo: 'Central de Treinamento', icone: 'school', desc: 'Treinamentos, trilhas e atribuições.', telas: ['screen-training', 'screen-training-mine', 'screen-training-trilhas'] },
  { id: 'monitoria', titulo: 'Monitorias', icone: 'fact_check', desc: 'Avaliações de qualidade, feedback e indicadores.', telas: ['__monitoria__'] },
  { id: 'configuracoes', titulo: 'Configurações', icone: 'settings', desc: 'Usuários e configurações do sistema.', telas: ['screen-settings-users', 'screen-settings'] },
];

export function sessoesDoUsuario(controlador) {
  const permissoes = controlador.estado.permissoesUsuario || [];
  const usaMestras = permissoes.some((p) => p.startsWith('sessao.'));
  return SESSOES.map((sessao) => {
    if (usaMestras && !controlador.possuiPermissao(`sessao.${sessao.id}.acessar`)) return null;
    const destino = sessao.id === 'monitoria'
      ? (controlador.possuiPermissao('monitoria.visualizar') || controlador.possuiPermissao('monitoria.dashboard') ? abaInicialMonitoria(controlador) : null)
      : sessao.telas.find((tela) => controlador.podeAcessarTela(tela));
    return destino ? { ...sessao, destino } : null;
  }).filter(Boolean);
}

export function TelaInicioPorSessoes({ controlador }) {
  const estado = controlador.estado;
  const nome = estado.nomeUsuarioAutenticado || estado.usuarioAutenticado || '';
  const sessoes = sessoesDoUsuario(controlador);
  const avatar = estado.avatarUsuario || '';
  return html`
    <${PainelRh} screenId="screen-menu" navAtiva="screen-menu" subtituloMarca="Início" placeholderBusca="Conecta" controlador=${controlador}>
      <div class="mon-inicio">
        <div class="mon-saudacao">
          <${AvatarUsuario} avatar=${avatar} nome=${nome} tamanho=${56} />
          <div><h1>Olá, ${(nome || '').split(' ')[0] || 'bem-vindo(a)'}!</h1><span class="mon-muted">${estado.perfilUsuarioNome || ''} · escolha por onde começar.</span></div>
        </div>
        ${sessoes.length ? html`
          <div class="mon-sessoes">
            ${sessoes.map((s) => html`
              <button key=${s.id} type="button" class="mon-sessao" onClick=${() => controlador.irParaTelaProtegida(s.destino)}>
                <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(s.icone)}</span>
                <strong>${s.titulo}</strong><span class="desc">${s.desc}</span>
              </button>`)}
          </div>` : html`<${EmptyState} icon="lock" title="Nenhuma sessão liberada" text="Seu perfil ainda não tem acesso a nenhuma sessão. Fale com o Administrador." />`}
      </div>
    </${PainelRh}>`;
}
