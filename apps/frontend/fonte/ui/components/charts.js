import { html } from '../../infraestrutura-react.js';

const SEQUENCIAL = [
  'var(--color-chart-sequential-1)',
  'var(--color-chart-sequential-2)',
  'var(--color-chart-sequential-3)',
  'var(--color-chart-sequential-4)',
  'var(--color-chart-sequential-5)',
  'var(--color-chart-sequential-6)',
];

function corSequencial(indice) {
  return SEQUENCIAL[indice % SEQUENCIAL.length];
}

export function BarComparisonChart({
  items = [],
  height = 28,
  gap = 10,
  valueFormatter = (v) => v,
  emptyText = 'Sem dados para comparar.',
}) {
  if (!items.length) {
    return html`<p class="rh-chart-empty">${emptyText}</p>`;
  }
  const maximo = Math.max(1, ...items.map((item) => Number(item.value) || 0));

  return html`
    <div class="rh-chart rh-chart--bars" role="img" aria-label="Gráfico de barras comparativo">
      ${items.map((item, indice) => {
        const valor = Number(item.value) || 0;
        const percentual = Math.max(2, Math.round((valor / maximo) * 100));
        return html`
          <div class="rh-chart-bar-row" key=${item.label ?? indice} style=${{ marginBottom: indice === items.length - 1 ? 0 : `${gap}px` }}>
            <span class="rh-chart-bar-label">${item.label}</span>
            <div class="rh-chart-bar-track" style=${{ height: `${height}px` }}>
              <div
                class="rh-chart-bar-fill"
                style=${{ width: `${percentual}%`, background: item.color || corSequencial(indice) }}
              ></div>
            </div>
            <span class="rh-chart-bar-value">${valueFormatter(valor)}</span>
          </div>
        `;
      })}
    </div>
  `;
}

export function AcceptanceDonutChart({
  aceitos = 0,
  reprovados = 0,
  size = 148,
  strokeWidth = 18,
  labelAceitos = 'Aprovados',
  labelReprovados = 'Reprovados',
}) {
  const total = aceitos + reprovados;
  const raio = (size - strokeWidth) / 2;
  const circunferencia = 2 * Math.PI * raio;
  const fracaoAceitos = total > 0 ? aceitos / total : 0;
  const percentualAceitos = Math.round(fracaoAceitos * 100);
  const centro = size / 2;

  return html`
    <div class="rh-chart rh-chart--donut">
      <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} role="img" aria-label=${`${percentualAceitos}% de aprovação`}>
        <circle
          cx=${centro}
          cy=${centro}
          r=${raio}
          fill="none"
          stroke="var(--status-danger-bg)"
          stroke-width=${strokeWidth}
        />
        ${total > 0
          ? html`
              <circle
                cx=${centro}
                cy=${centro}
                r=${raio}
                fill="none"
                stroke="var(--status-success)"
                stroke-width=${strokeWidth}
                stroke-dasharray=${`${circunferencia * fracaoAceitos} ${circunferencia}`}
                stroke-linecap="round"
                transform=${`rotate(-90 ${centro} ${centro})`}
              />
            `
          : null}
        <text
          x=${centro}
          y=${centro - 2}
          text-anchor="middle"
          class="rh-chart-donut-value"
          style=${{ fontVariantNumeric: 'tabular-nums' }}
        >${total > 0 ? `${percentualAceitos}%` : '—'}</text>
        <text x=${centro} y=${centro + 16} text-anchor="middle" class="rh-chart-donut-caption">
          ${labelAceitos}
        </text>
      </svg>
      <div class="rh-chart-legend">
        <span class="rh-chart-legend-item"><i style=${{ background: 'var(--status-success)' }}></i>${labelAceitos} (${aceitos})</span>
        <span class="rh-chart-legend-item"><i style=${{ background: 'var(--status-danger-bg)', border: '1px solid var(--status-danger)' }}></i>${labelReprovados} (${reprovados})</span>
      </div>
    </div>
  `;
}

export function ScoreRadarChart({ axes = [], series = [], size = 240 }) {
  if (!axes.length || !series.length) {
    return html`<p class="rh-chart-empty">Sem dados suficientes para o radar.</p>`;
  }
  const margemRotulo = 110;
  const tela = size + margemRotulo * 2;
  const centro = tela / 2;
  const raioMax = size / 2;
  const angulo = (indice) => (Math.PI * 2 * indice) / axes.length - Math.PI / 2;
  const ponto = (valor, indice) => {
    const raio = (Math.max(0, Math.min(100, valor)) / 100) * raioMax;
    return [centro + raio * Math.cos(angulo(indice)), centro + raio * Math.sin(angulo(indice))];
  };
  const aneis = [0.25, 0.5, 0.75, 1];

  return html`
    <div class="rh-chart rh-chart--radar">
      <svg width=${tela} height=${tela} viewBox=${`0 0 ${tela} ${tela}`} role="img" aria-label="Comparativo de notas por dimensão">
        ${aneis.map((fracao) => html`
          <polygon
            key=${fracao}
            points=${axes.map((_, indice) => ponto(fracao * 100, indice).join(',')).join(' ')}
            fill="none"
            stroke="var(--line)"
          />
        `)}
        ${axes.map((eixo, indice) => {
          const [x, y] = ponto(100, indice);
          return html`<line key=${eixo.key ?? indice} x1=${centro} y1=${centro} x2=${x} y2=${y} stroke="var(--line)" />`;
        })}
        ${series.map((serieItem, indiceSerie) => html`
          <polygon
            key=${serieItem.name ?? indiceSerie}
            points=${axes.map((eixo, indice) => ponto(serieItem.values?.[eixo.key] ?? 0, indice).join(',')).join(' ')}
            fill=${serieItem.color || corSequencial(indiceSerie)}
            fill-opacity="0.18"
            stroke=${serieItem.color || corSequencial(indiceSerie)}
            stroke-width="2"
          />
        `)}
        ${axes.map((eixo, indice) => {
          const [x, y] = ponto(120, indice);
          const alinhamento = x < centro - 4 ? 'end' : x > centro + 4 ? 'start' : 'middle';
          return html`
            <text key=${`label-${eixo.key ?? indice}`} x=${x} y=${y} text-anchor=${alinhamento} class="rh-chart-radar-axis-label">
              ${eixo.label}
            </text>
          `;
        })}
      </svg>
      <div class="rh-chart-legend">
        ${series.map((serieItem, indice) => html`
          <span class="rh-chart-legend-item" key=${serieItem.name ?? indice}>
            <i style=${{ background: serieItem.color || corSequencial(indice) }}></i>${serieItem.name}
          </span>
        `)}
      </div>
    </div>
  `;
}

export function StageFunnelChart({ stages = [], valueFormatter = (v) => v }) {
  if (!stages.length) {
    return html`<p class="rh-chart-empty">Sem etapas para comparar.</p>`;
  }
  const maximo = Math.max(1, ...stages.map((etapa) => Number(etapa.value) || 0));

  return html`
    <div class="rh-chart rh-chart--funnel" role="img" aria-label="Funil de etapas do processo">
      ${stages.map((etapa, indice) => {
        const valor = Number(etapa.value) || 0;
        const percentual = Math.max(6, Math.round((valor / maximo) * 100));
        return html`
          <div class="rh-chart-funnel-row" key=${etapa.label ?? indice}>
            <span class="rh-chart-funnel-label">${etapa.label}</span>
            <div class="rh-chart-funnel-track">
              <div
                class="rh-chart-funnel-fill"
                style=${{ width: `${percentual}%`, background: corSequencial(indice) }}
              >
                <span>${valueFormatter(valor)}</span>
              </div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

export function ScoreDistributionChart({ buckets = [], height = 140 }) {
  if (!buckets.length) {
    return html`<p class="rh-chart-empty">Sem notas suficientes para distribuir.</p>`;
  }
  const maximo = Math.max(1, ...buckets.map((b) => Number(b.count) || 0));

  return html`
    <div class="rh-chart rh-chart--columns" style=${{ height: `${height}px` }} role="img" aria-label="Distribuição de notas">
      ${buckets.map((bucket, indice) => {
        const valor = Number(bucket.count) || 0;
        const percentual = Math.max(2, Math.round((valor / maximo) * 100));
        return html`
          <div class="rh-chart-column" key=${bucket.label ?? indice}>
            <span class="rh-chart-column-value">${valor}</span>
            <div class="rh-chart-column-track">
              <div class="rh-chart-column-fill" style=${{ height: `${percentual}%`, background: 'var(--brand)' }}></div>
            </div>
            <span class="rh-chart-column-label">${bucket.label}</span>
          </div>
        `;
      })}
    </div>
  `;
}
