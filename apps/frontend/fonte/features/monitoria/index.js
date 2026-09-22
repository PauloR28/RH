import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, PageIntro, PainelRh } from '../../ui/componentes-compartilhados.js';
import { AvatarUsuario } from '../../ui/components/layout.js?v=20260922-collapsible';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { useAlertasMonitoria } from '../../shared/notificacoes.js?v=20260921-alertas';
import { listarMeusTreinamentos } from '../../services/api/onboarding.js?v=20260922-meus-treinamentos';
import { useContextoMonitoria } from './comum.js';
import { TelaNovaMonitoria } from './formulario.js?v=20260921-alertas';
import { ModalDetalheMonitoria } from './detalhe.js?v=20260921-alertas';
import { ListaMonitorias, ModalCompartilhar, TelaPlanos, TelaRelatorios } from './listas.js?v=20260921-operador';
import { TelaDashboard } from './painel.js';
import { TelaFormularios } from './admin.js?v=20260921-alertas';
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
  const [alertasTick, setAlertasTick] = useState(0);
  const alertas = useAlertasMonitoria(controlador, alertasTick);
  // Bolinha vermelha por aba: contestação/réplica -> Contestações; feedback pendente -> Feedback; novidades do operador -> Minhas monitorias.
  const alertaDaAba = { 'screen-monitoria-contestacoes': alertas.contestacoes, 'screen-monitoria-feedback': alertas.feedback, 'screen-monitoria-minhas': alertas.minhas };

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
              ${alertaDaAba[a.tela] > 0 ? html`<i class="mon-alerta-bolinha" role="img" aria-label=${`${alertaDaAba[a.tela]} novidade(s)`}></i>` : null}
            </button>`)}
        </nav>
        ${corpo}
      </div>
      <${ModalDetalheMonitoria} referencia=${detalhe} controlador=${controlador} contexto=${contexto} showToast=${showToast}
        onClose=${() => setDetalhe(null)} onAlterou=${() => setAtualizacao((n) => n + 1)} onLida=${() => setAlertasTick((n) => n + 1)} />
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

export function sessoesDoUsuario(controlador, { ocultarTreinamentosSemAgenda = false } = {}) {
  const permissoes = controlador.estado.permissoesUsuario || [];
  const usaMestras = permissoes.some((p) => p.startsWith('sessao.'));
  return SESSOES.map((sessao) => {
    if (usaMestras && !controlador.possuiPermissao(`sessao.${sessao.id}.acessar`)) return null;
    if (sessao.id === 'treinamentos' && ocultarTreinamentosSemAgenda) return null;
    const destino = sessao.id === 'monitoria'
      ? (controlador.possuiPermissao('monitoria.visualizar') || controlador.possuiPermissao('monitoria.dashboard') ? abaInicialMonitoria(controlador) : null)
      : sessao.telas.find((tela) => controlador.podeAcessarTela(tela));
    return destino ? { ...sessao, destino } : null;
  }).filter(Boolean);
}

export function TelaInicioPorSessoes({ controlador }) {
  const estado = controlador.estado;
  const nome = estado.nomeUsuarioAutenticado || estado.usuarioAutenticado || '';
  const avatar = estado.avatarUsuario || '';
  const alertas = useAlertasMonitoria(controlador);

  // O Operador só usa a Central de Treinamento como autoatendimento dos
  // próprios treinamentos atribuídos (sem onboarding.criar/editar/gerenciar) —
  // a div só aparece na Início por sessões quando há algo agendado para ele.
  // Outros perfis (RH, Gestor, Supervisor...) administram a área e continuam
  // vendo a div independente de haver treinamento agendado.
  const ehOperador = estado.perfilUsuario === 'operador';
  const [temTreinamentoAgendado, setTemTreinamentoAgendado] = useState(!ehOperador);
  useEffect(() => {
    if (!ehOperador) return undefined;
    let ativo = true;
    listarMeusTreinamentos()
      .then((lista) => { if (ativo) setTemTreinamentoAgendado(Array.isArray(lista) && lista.length > 0); })
      .catch(() => { if (ativo) setTemTreinamentoAgendado(false); });
    return () => { ativo = false; };
  }, [ehOperador]);

  const sessoes = sessoesDoUsuario(controlador, {
    ocultarTreinamentosSemAgenda: ehOperador && !temTreinamentoAgendado,
  });
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
                ${s.id === 'monitoria' && alertas.total > 0 ? html`<i class="mon-alerta-bolinha mon-alerta-bolinha--canto" role="img" aria-label=${`${alertas.total} novidade(s) em monitorias`}></i>` : null}
              </button>`)}
          </div>` : html`<${EmptyState} icon="lock" title="Nenhuma sessão liberada" text="Seu perfil ainda não tem acesso a nenhuma sessão. Fale com o Administrador." />`}
      </div>
    </${PainelRh}>`;
}
