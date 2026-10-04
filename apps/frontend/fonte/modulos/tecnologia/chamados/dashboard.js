import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { LoadingState } from '../../../ui/componentes-compartilhados.js';
import { lerDashboardChamados } from '../../../services/api/chamados.js';
import { EstadoErro } from './comum.js';
import { Indicador } from './lista.js';

// Dashboard (`chamados.dashboard`): indicadores do momento e gráficos do período. Gráficos em SVG/CSS com os tokens do Conecta.

const PERIODOS = [7, 30, 90];
// Cores por status na rosca: tokens semânticos (neutro, info, aviso, sucesso).
const COR_STATUS = {
  aberto: 'var(--color-text-muted)',
  em_andamento: 'var(--color-info)',
  aguardando_solicitante: 'var(--color-warning)',
  resolvido: 'var(--color-success)',
};

function Rosca({ itens }) {
  const total = itens.reduce((soma, i) => soma + i.total, 0);
  if (!total) return html`<p class="chm-vazio">Nenhum chamado não encerrado no período.</p>`;
  const raio = 14;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;
  return html`
    <div class="chm-rosca">
      <svg viewBox="0 0 36 36" width="144" height="144" role="img" aria-label="Chamados não encerrados por status">
        <g fill="none" strokeWidth="4" transform="rotate(-90 18 18)">
          <circle cx="18" cy="18" r=${raio} stroke="var(--color-border)" />
          ${itens.map((item) => {
            const parte = (item.total / total) * circunferencia;
            const deslocamento = -acumulado;
            acumulado += parte;
            return html`<circle key=${item.chave} cx="18" cy="18" r=${raio} stroke=${COR_STATUS[item.chave] || 'var(--color-primary)'}
              strokeDasharray=${`${parte} ${circunferencia - parte}`} strokeDashoffset=${deslocamento}><title>${`${item.rotulo}: ${item.total} (${Math.round((item.total / total) * 100)}%)`}</title></circle>`;
          })}
        </g>
        <text x="18" y="19.5" textAnchor="middle" class="chm-rosca-total">${total}</text>
      </svg>
      <ul class="chm-legenda">
        ${itens.map((item) => html`
          <li key=${item.chave}><i style=${{ background: COR_STATUS[item.chave] || 'var(--color-primary)' }}></i><span>${item.rotulo}</span>
            <b>${item.total} · ${Math.round((item.total / total) * 100)}%</b></li>`)}
      </ul>
    </div>`;
}

function Barras({ itens, vazio = 'Sem dados no período.' }) {
  if (!itens.length) return html`<p class="chm-vazio">${vazio}</p>`;
  const maximo = Math.max(1, ...itens.map((i) => i.total));
  return html`
    <div class="chm-barras">
      ${itens.map((item) => html`
        <div class="chm-barra" key=${item.chave}>
          <span class="chm-trunca" title=${item.rotulo}>${item.rotulo}</span>
          <div class="chm-barra-trilho"><i style=${{ width: `${(item.total / maximo) * 100}%` }}></i></div>
          <b>${item.total}</b>
        </div>`)}
    </div>`;
}

export function DashboardChamados() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => {
    setErro('');
    lerDashboardChamados(dias).then(setDados).catch((e) => setErro(e?.message || 'Não foi possível carregar o dashboard.'));
  }, [dias]);
  useEffect(carregar, [carregar]);

  if (erro) return html`<${EstadoErro} erro=${erro} aoTentar=${carregar} />`;
  if (!dados) return html`<${LoadingState} titulo="Carregando indicadores" />`;
  const k = dados.kpis;
  return html`
    <div class="chm-pagina">
      <div class="chm-dash-topo">
        <h3>Indicadores do atendimento</h3>
        <div class="chm-seg" role="tablist" aria-label="Período">
          ${PERIODOS.map((p) => html`<button type="button" role="tab" key=${p} aria-selected=${dias === p} class=${dias === p ? 'is-on' : ''} onClick=${() => setDias(p)}>${p} dias</button>`)}
        </div>
      </div>
      <div class="chm-kpis chm-kpis--cinco">
        <${Indicador} icone="warning" valor=${k.sla_vencido} rotulo="SLA vencido" tom="bad" />
        <${Indicador} icone="schedule" valor=${k.vencem_hoje} rotulo="Vencem hoje" tom="warn" />
        <${Indicador} icone="inbox" valor=${k.abertos} rotulo="Abertos" />
        <${Indicador} icone="person" valor=${k.aguardando_solicitante} rotulo="Aguardando solicitante" />
        <${Indicador} icone="build" valor=${k.sem_responsavel} rotulo="Sem responsável" />
      </div>
      <div class="chm-graficos">
        <section class="chm-card chm-card--grafico"><h3>Não encerrados por status</h3><${Rosca} itens=${dados.por_status} /></section>
        <section class="chm-card chm-card--grafico"><h3>Por operação</h3><${Barras} itens=${dados.por_operacao} /></section>
        <section class="chm-card chm-card--grafico"><h3>Por urgência</h3><${Barras} itens=${dados.por_urgencia} /></section>
        <section class="chm-card chm-card--grafico"><h3>Por categoria</h3><${Barras} itens=${dados.por_categoria} /></section>
      </div>
    </div>`;
}
