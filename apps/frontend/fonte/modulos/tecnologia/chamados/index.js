import { html } from '../../../infraestrutura-react.js';
import { PageIntro, PainelRh } from '../../../ui/componentes-compartilhados.js';
import { useToast } from '../../../shared/hooks/use-toast.js';
import {
  ABAS_CHAMADOS, Icone, TELA_CONFIG, TELA_DASHBOARD, TELA_DETALHE, TELA_FILA, TELA_LISTA, TELA_NOVO,
} from './comum.js';
import { ListaChamados } from './lista.js';
import { NovoChamado } from './novo.js';
import { DetalheChamado } from './detalhe.js';
import { FilaChamados } from './fila.js';
import { DashboardChamados } from './dashboard.js';
import { ConfiguracoesChamados } from './configuracoes.js';

// Suporte TI (Conecta Tecnologia): abertura e gestão de chamados. As abas visíveis dependem das permissões do usuário,
// nunca do nome do perfil. Quem só abre/acompanha (ex.: Supervisor) vê apenas a página "Chamados", sem barra de abas.

const TITULOS = {
  [TELA_LISTA]: ['Suporte TI', 'Abra chamados e acompanhe o andamento da sua operação.'],
  [TELA_NOVO]: ['Novo chamado', 'Descreva o problema para a equipe de TI priorizar pelo impacto na operação.'],
  [TELA_FILA]: ['Suporte TI', 'Fila de atendimento ordenada por SLA e urgência.'],
  [TELA_DASHBOARD]: ['Suporte TI', 'Indicadores do atendimento.'],
  [TELA_CONFIG]: ['Suporte TI', 'Prazos de SLA, encerramento automático, anexos e categorias.'],
  [TELA_DETALHE]: ['Chamado', 'Acompanhe a conversa, os anexos e o prazo.'],
};
const TELAS_COM_ABAS = new Set([TELA_LISTA, TELA_FILA, TELA_DASHBOARD, TELA_CONFIG]);

function BarraAbas({ controlador, telaAtual }) {
  const visiveis = ABAS_CHAMADOS.filter((aba) => controlador.podeAcessarTela(aba.tela));
  if (visiveis.length < 2) return null;
  return html`
    <nav class="chm-abas chm-abas--pagina" role="tablist" aria-label="Suporte TI">
      ${visiveis.map((aba) => html`
        <button type="button" role="tab" key=${aba.tela} aria-selected=${aba.tela === telaAtual} class=${aba.tela === telaAtual ? 'is-on' : ''}
          onClick=${() => controlador.irParaTelaProtegida(aba.tela)}><${Icone} nome=${aba.icone} />${aba.rotulo}</button>`)}
    </nav>`;
}

export function TelaChamados({ controlador, telaAtual = TELA_LISTA }) {
  const { showToast, ToastHost } = useToast();
  const [titulo, descricao] = TITULOS[telaAtual] || TITULOS[TELA_LISTA];
  const podeAbrir = controlador.possuiPermissao('chamados.abrir');
  const mostrarNovo = podeAbrir && TELAS_COM_ABAS.has(telaAtual) && telaAtual !== TELA_CONFIG && telaAtual !== TELA_DASHBOARD;

  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Tecnologia" placeholderBusca="Buscar" controlador=${controlador}
      acaoPrimaria=${mostrarNovo ? { label: 'Novo chamado', icon: 'add', permissao: 'chamados.abrir', onClick: () => controlador.irParaTelaProtegida(TELA_NOVO) } : undefined}>
      <div class="tec-toast"><${ToastHost} /></div>
      ${telaAtual !== TELA_DETALHE ? html`<${PageIntro} kicker="Tecnologia" title=${titulo} description=${descricao} tourId=${null} />` : null}
      <div class="chm-shell">
        ${TELAS_COM_ABAS.has(telaAtual) ? html`<${BarraAbas} controlador=${controlador} telaAtual=${telaAtual} />` : null}
        ${telaAtual === TELA_LISTA ? html`<${ListaChamados} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_NOVO ? html`<${NovoChamado} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_DETALHE ? html`<${DetalheChamado} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_FILA ? html`<${FilaChamados} showToast=${showToast} />` : null}
        ${telaAtual === TELA_DASHBOARD ? html`<${DashboardChamados} />` : null}
        ${telaAtual === TELA_CONFIG ? html`<${ConfiguracoesChamados} showToast=${showToast} />` : null}
      </div>
    </${PainelRh}>`;
}
