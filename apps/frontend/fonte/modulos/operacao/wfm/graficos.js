import { html } from '../../infraestrutura-react.js';

// Gráficos dos Relatórios do WFM, em SVG/CSS puro (sem biblioteca). Cores vêm de variáveis CSS (`--wfm-g-*`, em wfm.css),
// nunca fixas aqui; cada gráfico traz rótulos e valores em texto (legenda/tabela), então nenhuma informação depende só da cor.

const nf = (v, casas = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const fmt = nf;

// Máximo "redondo" para o eixo (1, 2, 5 × 10^n).
function maximoBonito(v) {
  if (!v || v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

// Com períodos longos, agrupa a série diária em blocos de 7 dias para o gráfico continuar legível.
export function agruparSerie(serie, limite = 62) {
  if (serie.length <= limite) return serie;
  const blocos = [];
  for (let i = 0; i < serie.length; i += 7) {
    const fatia = serie.slice(i, i + 7);
    const soma = (k) => fatia.reduce((t, x) => t + (x[k] || 0), 0);
    blocos.push({ rotulo: `${fatia[0].rotulo}–${fatia[fatia.length - 1].rotulo}`, escalados: soma('escalados'), presentes: soma('presentes'), faltas: soma('faltas'), atestados: soma('atestados'), sem: soma('sem'), horas: soma('horas') });
  }
  return blocos;
}

function Legenda({ itens }) {
  return html`<ul class="wfm-g-legenda">${itens.map((i) => html`<li key=${i.rotulo}><span class="wfm-g-chip" style=${{ background: i.cor }}></span>${i.rotulo}${i.valor !== undefined ? html`<b>${i.valor}</b>` : null}</li>`)}</ul>`;
}

// 1. Evolução diária: barras de escalados (fundo), linha de presentes e barras de faltas.
export function GraficoSerieDiaria({ serie }) {
  const dados = agruparSerie(serie);
  const largura = 720, altura = 240, ml = 40, mr = 8, mt = 16, mb = 32;
  const max = maximoBonito(Math.max(1, ...dados.map((d) => Math.max(d.escalados, d.presentes))));
  const w = largura - ml - mr, h = altura - mt - mb;
  const passo = w / dados.length;
  const y = (v) => mt + h - (v / max) * h;
  const x = (i) => ml + passo * i + passo / 2;
  const linha = dados.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.presentes).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const cadaN = Math.ceil(dados.length / 12);
  const larguraBarra = Math.max(2, Math.min(24, passo * 0.6));
  return html`
    <div>
      <svg viewBox=${`0 0 ${largura} ${altura}`} class="wfm-g-svg" role="img" aria-label="Escalados, presentes e faltas por dia">
        ${ticks.map((t) => html`<g key=${t}><line x1=${ml} x2=${largura - mr} y1=${y(t)} y2=${y(t)} class="wfm-g-grade" /><text x=${ml - 8} y=${y(t) + 4} class="wfm-g-eixo" text-anchor="end">${nf(t)}</text></g>`)}
        ${dados.map((d, i) => html`<g key=${i}>
          <rect x=${x(i) - larguraBarra / 2} y=${y(d.escalados)} width=${larguraBarra} height=${Math.max(0, mt + h - y(d.escalados))} class="wfm-g-escalados" rx="2"><title>${d.rotulo}: ${d.escalados} escalado(s), ${d.presentes} presente(s), ${d.faltas} falta(s)</title></rect>
          ${d.faltas ? html`<rect x=${x(i) - larguraBarra / 2} y=${y(d.faltas)} width=${larguraBarra} height=${Math.max(0, mt + h - y(d.faltas))} class="wfm-g-faltas" rx="2" />` : null}
          ${i % cadaN === 0 ? html`<text x=${x(i)} y=${altura - 8} class="wfm-g-eixo" text-anchor="middle">${d.rotulo}</text>` : null}
        </g>`)}
        <path d=${linha} class="wfm-g-linha" fill="none" />
        ${dados.length <= 40 ? dados.map((d, i) => html`<circle key=${i} cx=${x(i)} cy=${y(d.presentes)} r="3" class="wfm-g-ponto" />`) : null}
      </svg>
      <${Legenda} itens=${[{ rotulo: 'Escalados', cor: 'var(--wfm-g-neutro)' }, { rotulo: 'Presentes', cor: 'var(--wfm-g-marca)' }, { rotulo: 'Faltas', cor: 'var(--wfm-g-perigo)' }]} />
    </div>`;
}

// 2 e 5. Rosca com total no centro e legenda com valor e percentual.
export function GraficoRosca({ dados, cores, centro, rotuloCentro }) {
  const total = dados.reduce((t, d) => t + d.valor, 0);
  const r = 44, c = 2 * Math.PI * r;
  let acumulado = 0;
  const itens = dados.map((d, i) => ({ ...d, cor: cores[i % cores.length] }));
  return html`
    <div class="wfm-g-rosca">
      <svg viewBox="0 0 120 120" class="wfm-g-svg-rosca" role="img" aria-label=${itens.map((i) => `${i.rotulo}: ${i.valor}`).join(', ') || 'Sem dados'}>
        <circle cx="60" cy="60" r=${r} class="wfm-g-trilho" fill="none" stroke-width="16" />
        ${total ? itens.filter((i) => i.valor > 0).map((i) => {
          const len = (i.valor / total) * c;
          const el = html`<circle key=${i.rotulo} cx="60" cy="60" r=${r} fill="none" stroke-width="16" stroke=${i.cor} stroke-dasharray=${`${len} ${c - len}`} stroke-dashoffset=${-acumulado} transform="rotate(-90 60 60)"><title>${i.rotulo}: ${nf(i.valor)} (${nf((100 * i.valor) / total, 1)}%)</title></circle>`;
          acumulado += len;
          return el;
        }) : null}
        <text x="60" y="58" text-anchor="middle" class="wfm-g-centro">${centro ?? nf(total)}</text>
        <text x="60" y="74" text-anchor="middle" class="wfm-g-centro-sub">${rotuloCentro || 'total'}</text>
      </svg>
      <${Legenda} itens=${itens.map((i) => ({ rotulo: i.rotulo, cor: i.cor, valor: `${nf(i.valor)}${total ? ` · ${nf((100 * i.valor) / total, 0)}%` : ''}` }))} />
    </div>`;
}

// 3 e 6. Barras horizontais, simples ou agrupadas (séries). `series`: [{ chave, rotulo, cor }].
export function GraficoBarrasH({ dados, series, unidade = '' }) {
  if (!dados.length) return null;
  const max = Math.max(1, ...dados.flatMap((d) => series.map((s) => d[s.chave] || 0)));
  return html`
    <div>
      <ul class="wfm-g-barras">
        ${dados.map((d) => html`<li key=${d.rotulo}>
          <span class="wfm-g-barras-rotulo" title=${d.rotulo}>${d.rotulo}</span>
          <span class="wfm-g-barras-trilha">${series.map((s) => html`<span key=${s.chave} class="wfm-g-barra" style=${{ width: `${Math.max(2, ((d[s.chave] || 0) / max) * 100)}%`, background: s.cor }} title=${`${s.rotulo}: ${nf(d[s.chave] || 0, 2)}${unidade}`}></span>`)}</span>
          <span class="wfm-g-barras-valor">${series.map((s) => nf(d[s.chave] || 0, unidade === 'h' ? 1 : 0)).join(' / ')}${unidade}</span>
        </li>`)}
      </ul>
      ${series.length > 1 ? html`<${Legenda} itens=${series.map((s) => ({ rotulo: s.rotulo, cor: s.cor }))} />` : null}
    </div>`;
}

// 4. Colunas (absenteísmo por dia da semana), com a média como linha de referência.
export function GraficoColunas({ dados, media }) {
  const largura = 360, altura = 200, ml = 36, mr = 8, mt = 16, mb = 28;
  const valores = dados.map((d) => d.valor || 0);
  const max = maximoBonito(Math.max(1, ...valores, media || 0));
  const w = largura - ml - mr, h = altura - mt - mb, passo = w / dados.length;
  const y = (v) => mt + h - (v / max) * h;
  return html`
    <svg viewBox=${`0 0 ${largura} ${altura}`} class="wfm-g-svg" role="img" aria-label="Absenteísmo por dia da semana">
      ${[0, 0.5, 1].map((f) => html`<g key=${f}><line x1=${ml} x2=${largura - mr} y1=${y(f * max)} y2=${y(f * max)} class="wfm-g-grade" /><text x=${ml - 6} y=${y(f * max) + 4} class="wfm-g-eixo" text-anchor="end">${nf(f * max)}%</text></g>`)}
      ${dados.map((d, i) => {
        const v = d.valor || 0;
        const bw = Math.min(28, passo * 0.6);
        return html`<g key=${d.rotulo}>
          <rect x=${ml + passo * i + (passo - bw) / 2} y=${y(v)} width=${bw} height=${Math.max(0, mt + h - y(v))} class=${d.valor === null ? 'wfm-g-vazio' : 'wfm-g-coluna'} rx="3"><title>${d.rotulo}: ${d.valor === null ? 'sem dados apurados' : `${nf(d.valor, 1)}% (${d.faltas} falta(s) em ${d.apurados} dia(s) apurados)`}</title></rect>
          ${d.valor !== null ? html`<text x=${ml + passo * i + passo / 2} y=${y(v) - 4} class="wfm-g-valor" text-anchor="middle">${nf(d.valor, 1)}</text>` : null}
          <text x=${ml + passo * i + passo / 2} y=${altura - 8} class="wfm-g-eixo" text-anchor="middle">${d.rotulo}</text>
        </g>`;
      })}
      ${media ? html`<g><line x1=${ml} x2=${largura - mr} y1=${y(media)} y2=${y(media)} class="wfm-g-media" /><text x=${largura - mr} y=${y(media) - 4} class="wfm-g-eixo" text-anchor="end">média ${nf(media, 1)}%</text></g>` : null}
    </svg>`;
}

// 7. Barra empilhada única (partes de um todo), usada nas trocas por situação.
export function GraficoEmpilhada({ dados, cores }) {
  const total = dados.reduce((t, d) => t + d.valor, 0);
  if (!total) return null;
  return html`
    <div>
      <div class="wfm-g-empilhada" role="img" aria-label=${dados.map((d) => `${d.rotulo}: ${d.valor}`).join(', ')}>
        ${dados.map((d, i) => html`<span key=${d.rotulo} style=${{ width: `${(100 * d.valor) / total}%`, background: cores[i % cores.length] }} title=${`${d.rotulo}: ${d.valor}`}></span>`)}
      </div>
      <${Legenda} itens=${dados.map((d, i) => ({ rotulo: d.rotulo, cor: cores[i % cores.length], valor: nf(d.valor) }))} />
    </div>`;
}

export function CartaoGrafico({ titulo, subtitulo, children, largo = false }) {
  return html`<section class=${`wfm-g-cartao ${largo ? 'is-largo' : ''}`}><header><h4>${titulo}</h4>${subtitulo ? html`<p class="mon-muted">${subtitulo}</p>` : null}</header>${children}</section>`;
}
