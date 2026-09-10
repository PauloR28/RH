import { html } from '../../infraestrutura-react.js';
import { IconeSvg } from '../icone.js';
import { MetricGrid } from './feedback.js';

/*
 * Extraído da rodada 2 de promt.txt (padrão de leitura em Z): o stepper de
 * wizard existia duplicado por JSX copy-paste em `treinamentos/wizard.js` e
 * `features/gestao/index.js` (criação de processo) — mesmas classes CSS
 * (`.process-create-step`, já redesenhado na rodada 1: badge
 * quadrado-arredondado + trilho grosso), sem componente compartilhado.
 * Visual idêntico ao anterior, só deixa de estar copiado em 2 lugares.
 */
export function WizardStepper({ etapas, etapaAtual }) {
  return html`
    <div class="process-create-stepper" aria-label="Etapas">
      ${etapas.map(([numero, label], indice) => {
        const etapa = indice + 1;
        return html`
          <div
            class=${`process-create-step ${etapaAtual === etapa ? 'is-active' : ''} ${etapaAtual > etapa ? 'is-done' : ''}`}
            key=${numero}
          >
            <span>${etapaAtual > etapa ? html`<i class="material-symbols-outlined">${IconeSvg('check')}</i>` : numero}</span>
            <strong>${label}</strong>
          </div>
        `;
      })}
    </div>
  `;
}

/*
 * Substitui o antigo `<aside class="process-create-summary">` (painel
 * lateral fixo, fundo escuro isolado) por uma faixa inline logo abaixo do
 * stepper, reaproveitando o `MetricGrid` já usado nos KPIs em vez de um 3º
 * padrão visual de "card resumo" no app.
 */
export function WizardSummaryStrip({ items = [], note = null }) {
  return html`
    <section class="process-create-summary process-create-summary--inline">
      <${MetricGrid}
        items=${items.map(([label, value]) => ({
          label,
          value,
          variant: 'rh-metric-card--is-neutral',
        }))}
      />
      ${note ? html`<p class="process-create-summary-note--inline">${note}</p>` : null}
    </section>
  `;
}
