import { html } from '../../../infraestrutura-react.js';
import { PainelRh } from '../../../ui/componentes-compartilhados.js';
import { PageHeader, PageShell } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign15';
import { useToast } from '../../../shared/hooks/use-toast.js';
import {
  ABAS_CHAMADOS, Icone, TELA_CONFIG, TELA_DASHBOARD, TELA_DETALHE, TELA_FILA, TELA_LISTA, TELA_NOVO,
} from './comum.js?v=20261005-redesign15';
import { ListaChamados } from './lista.js?v=20261005-redesign15';
import { NovoChamado } from './novo.js?v=20261005-redesign15';
import { PaginaDetalheChamado } from './detalhe.js?v=20261005-redesign15';
import { FilaChamados } from './fila.js?v=20261005-redesign15';
import { DashboardChamados } from './dashboard.js?v=20261005-redesign15';
import { ConfiguracoesChamados } from './configuracoes.js?v=20261005-redesign15';

// Suporte TI (Conecta Tecnologia): abertura e gestão de chamados. As abas visíveis dependem das permissões do usuário,
// nunca do nome do perfil. Quem só abre/acompanha (ex.: Supervisor) vê apenas a página "Chamados", sem barra de abas.
// Novo chamado e Detalhe montam o próprio cabeçalho (têm ações e títulos próprios).

const TITULOS = {
  [TELA_LISTA]: ['Suporte TI', 'Abra chamados e acompanhe o andamento. Operadores devem reportar o problema ao seu supervisor.'],
  [TELA_FILA]: ['Suporte TI', 'Fila de atendimento ordenada por SLA e urgência.'],
  [TELA_DASHBOARD]: ['Suporte TI', 'Indicadores do atendimento.'],
  [TELA_CONFIG]: ['Suporte TI', 'Prazos de SLA, encerramento, reabertura, anexos, categorias e lembretes por e-mail.'],
};
const TELAS_COM_ABAS = new Set([TELA_LISTA, TELA_FILA, TELA_DASHBOARD, TELA_CONFIG]);

function BarraAbas({ controlador, telaAtual }) {
  const visiveis = ABAS_CHAMADOS.filter((aba) => controlador.podeAcessarTela(aba.tela));
  if (visiveis.length < 2) return null;
  return html`
    <nav class="chm-abas" role="tablist" aria-label="Suporte TI">
      ${visiveis.map((aba) => html`
        <button type="button" role="tab" key=${aba.tela} aria-selected=${aba.tela === telaAtual} class=${aba.tela === telaAtual ? 'is-on' : ''}
          onClick=${() => controlador.irParaTelaProtegida(aba.tela)}><${Icone} nome=${aba.icone} />${aba.rotulo}</button>`)}
    </nav>`;
}

export function TelaChamados({ controlador, telaAtual = TELA_LISTA }) {
  const { showToast, ToastHost } = useToast();
  const titulos = TITULOS[telaAtual];
  const podeAbrir = controlador.possuiPermissao('chamados.abrir');
  const mostrarNovo = podeAbrir && (telaAtual === TELA_LISTA || telaAtual === TELA_FILA);

  return html`
    <${PainelRh} screenId=${telaAtual} navAtiva=${telaAtual} subtituloMarca="Tecnologia" placeholderBusca="Buscar" controlador=${controlador} buscaGlobal=${false}
      acaoPrimaria=${mostrarNovo ? { label: 'Novo chamado', icon: 'add', permissao: 'chamados.abrir', onClick: () => controlador.irParaTelaProtegida(TELA_NOVO) } : undefined}>
      <div class="tec-toast"><${ToastHost} /></div>
      <${PageShell}>
        ${titulos ? html`<${PageHeader} titulo=${titulos[0]} subtitulo=${titulos[1]} />` : null}
        ${TELAS_COM_ABAS.has(telaAtual) ? html`<${BarraAbas} controlador=${controlador} telaAtual=${telaAtual} />` : null}
        ${telaAtual === TELA_LISTA ? html`<${ListaChamados} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_NOVO ? html`<${NovoChamado} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_DETALHE ? html`<${PaginaDetalheChamado} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_FILA ? html`<${FilaChamados} controlador=${controlador} showToast=${showToast} />` : null}
        ${telaAtual === TELA_DASHBOARD ? html`<${DashboardChamados} />` : null}
        ${telaAtual === TELA_CONFIG ? html`<${ConfiguracoesChamados} showToast=${showToast} />` : null}
      <//>
    </${PainelRh}>`;
}
