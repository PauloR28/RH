import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { lerDashboardChamados } from '../../../services/api/chamados.js?v=20261005-redesign16';
import { Section, Toolbar } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { EstadoErro, Indicador } from './comum.js?v=20261005-redesign16';

// Dashboard (`chamados.dashboard`): indicadores do momento e blocos do período. Cada bloco pode ser visto como tabela, pizza ou barras.
// Gráficos em SVG/CSS com os tokens do Conecta (sem biblioteca).

const PERIODOS = [7, 30, 90];
const VISTAS = [{ id: 'tabela', rotulo: 'Tabela' }, { id: 'pizza', rotulo: 'Pizza' }, { id: 'barras', rotulo: 'Barras' }];
// Paleta sóbria de tokens; a cor é só um apoio, o número e o nome sempre aparecem ao lado.
const PALETA = ['var(--color-primary)', 'var(--color-info)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)', 'var(--color-scheduled)', 'var(--color-accent)', 'var(--color-text-muted)'];
const COR_STATUS = { aberto: 'var(--color-text-muted)', em_andamento: 'var(--color-info)', aguardando_solicitante: 'var(--color-warning)', resolvido: 'var(--color-success)' };

const corDe = (item, i, usarStatus) => (usarStatus && COR_STATUS[item.chave]) || PALETA[i % PALETA.length];
const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : 0);

function Pizza({ itens, usarStatus }) {
  const total = itens.reduce((soma, i) => soma + i.total, 0);
  const raio = 14;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;
  return html`
    <div class="chm-rosca">
      <svg viewBox="0 0 36 36" width="144" height="144" role="img" aria-label="Gráfico de pizza">
        <g fill="none" strokeWidth="4" transform="rotate(-90 18 18)">
          <circle cx="18" cy="18" r=${raio} stroke="var(--color-border)" />
          ${itens.map((item, i) => {
            const parte = (item.total / total) * circunferencia;
            const deslocamento = -acumulado;
            acumulado += parte;
            return html`<circle key=${item.chave} cx="18" cy="18" r=${raio} stroke=${corDe(item, i, usarStatus)}
              strokeDasharray=${`${parte} ${circunferencia - parte}`} strokeDashoffset=${deslocamento}><title>${`${item.rotulo}: ${item.total} (${pct(item.total, total)}%)`}</title></circle>`;
          })}
        </g>
        <text x="18" y="19.5" textAnchor="middle" class="chm-rosca-total">${total}</text>
      </svg>
      <ul class="chm-legenda">
        ${itens.map((item, i) => html`
          <li key=${item.chave}><i style=${{ background: corDe(item, i, usarStatus) }}></i><span class="lp-trunca" title=${item.rotulo}>${item.rotulo}</span>
            <b>${item.total} · ${pct(item.total, total)}%</b></li>`)}
      </ul>
    </div>`;
}

function Barras({ itens }) {
  const maximo = Math.max(1, ...itens.map((i) => i.total));
  return html`
    <div class="chm-barras">
      ${itens.map((item) => html`
        <div class="chm-barra" key=${item.chave}>
          <span class="lp-trunca" title=${item.rotulo}>${item.rotulo}</span>
          <div class="chm-barra-trilho"><i style=${{ width: `${(item.total / maximo) * 100}%` }}></i></div>
          <b>${item.total}</b>
        </div>`)}
    </div>`;
}

function TabelaSimples({ itens, rotuloColuna }) {
  const total = itens.reduce((soma, i) => soma + i.total, 0);
  return html`
    <table class="lp-tabela chm-mini">
      <thead><tr><th>${rotuloColuna}</th><th class="lp-dir">Chamados</th><th class="lp-dir">%</th></tr></thead>
      <tbody>${itens.map((item) => html`
        <tr key=${item.chave}><td><div class="lp-trunca" title=${item.rotulo}>${item.rotulo}</div></td><td class="lp-dir">${item.total}</td><td class="lp-dir">${pct(item.total, total)}%</td></tr>`)}</tbody>
    </table>`;
}

function Bloco({ titulo, rotuloColuna, itens, vista, usarStatus = false, vazio = 'Sem dados no período.', extra = null }) {
  const lista = itens || [];
  return html`
    <${Section} titulo=${titulo}>
      ${extra}
      ${!lista.length ? html`<p class="chm-vazio">${vazio}</p>`
        : vista === 'pizza' ? html`<${Pizza} itens=${lista} usarStatus=${usarStatus} />`
        : vista === 'barras' ? html`<${Barras} itens=${lista} />`
        : html`<${TabelaSimples} itens=${lista} rotuloColuna=${rotuloColuna} />`}
    <//>`;
}

export function DashboardChamados() {
  const [dias, setDias] = useState(30);
  const [vista, setVista] = useState('barras');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => {
    setErro('');
    lerDashboardChamados(dias).then(setDados).catch((e) => setErro(e?.message || 'Não foi possível carregar o dashboard.'));
  }, [dias]);
  useEffect(carregar, [carregar]);

  const k = dados?.kpis;
  const re = dados?.reabertos;
  const seletores = html`
    <div class="chm-seg" role="tablist" aria-label="Período">
      ${PERIODOS.map((p) => html`<button type="button" role="tab" key=${p} aria-selected=${dias === p} class=${dias === p ? 'is-on' : ''} onClick=${() => setDias(p)}>${p} dias</button>`)}
    </div>
    <div class="chm-seg" role="tablist" aria-label="Visualização">
      ${VISTAS.map((v) => html`<button type="button" role="tab" key=${v.id} aria-selected=${vista === v.id} class=${vista === v.id ? 'is-on' : ''} onClick=${() => setVista(v.id)}>${v.rotulo}</button>`)}
    </div>`;

  return html`
    <div class="lp-shell">
      <${Toolbar} filtros=${seletores} fim=${dados ? `Últimos ${dados.dias} dias` : ''} />
      ${erro ? html`<${EstadoErro} erro=${erro} aoTentar=${carregar} />` : null}
      <div class="chm-kpis chm-kpis--seis">
        <${Indicador} icone="warning" valor=${k?.sla_vencido} rotulo="SLA vencido" tom="bad" />
        <${Indicador} icone="schedule" valor=${k?.vencem_hoje} rotulo="Vencem hoje" tom="warn" />
        <${Indicador} icone="inbox" valor=${k?.abertos} rotulo="Abertos" />
        <${Indicador} icone="person" valor=${k?.aguardando_solicitante} rotulo="Aguardando solicitante" />
        <${Indicador} icone="build" valor=${k?.sem_responsavel} rotulo="Sem responsável" />
        <${Indicador} icone="refresh" valor=${k?.reabertos} rotulo="Reabertos no período" tom="warn" />
      </div>
      ${dados ? html`
        <div class="chm-graficos">
          <${Bloco} titulo="Por solicitante (quem abriu)" rotuloColuna="Solicitante" itens=${dados.por_solicitante} vista=${vista} />
          <${Bloco} titulo="Chamados reabertos" rotuloColuna="Categoria" itens=${re.por_categoria} vista=${vista} vazio="Nenhum chamado reaberto no período."
            extra=${html`<p class="chm-ajuda-topo">${re.total} chamado${re.total === 1 ? '' : 's'} (${String(re.taxa).replace('.', ',')}% dos abertos no período) · ${re.reaberturas} reabertura${re.reaberturas === 1 ? '' : 's'} no total. Um chamado reaberto continua sendo um só.</p>`} />
          <${Bloco} titulo="Reabertos por solicitante" rotuloColuna="Solicitante" itens=${re.por_solicitante} vista=${vista} vazio="Nenhum chamado reaberto no período." />
          <${Bloco} titulo="Não encerrados por status" rotuloColuna="Status" itens=${dados.por_status} vista=${vista} usarStatus=${true} vazio="Nenhum chamado não encerrado no período." />
          <${Bloco} titulo="Por operação" rotuloColuna="Operação" itens=${dados.por_operacao} vista=${vista} />
          <${Bloco} titulo="Por urgência" rotuloColuna="Urgência" itens=${dados.por_urgencia} vista=${vista} />
          <${Bloco} titulo="Por categoria" rotuloColuna="Categoria" itens=${dados.por_categoria} vista=${vista} />
        </div>` : (!erro ? html`<p class="chm-vazio">Carregando indicadores…</p>` : null)}
    </div>`;
}
