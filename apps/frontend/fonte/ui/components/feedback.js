import { html } from '../../infraestrutura-react.js';
import { construirModeloPaginacao } from '../../utilitarios.js';

function BotaoPaginacao({ pagina, ativa, onClick }) {
  return html`
    <button
      type="button"
      class=${`btn ${ativa ? 'btn-primary' : 'btn-outline-secondary'} btn-sm`}
      onClick=${onClick}
    >
      ${pagina}
    </button>
  `;
}

export function GrupoPaginacao({ paginaAtual, totalPaginas, onChange }) {
  const itens = construirModeloPaginacao(paginaAtual, totalPaginas);
  if (itens.length <= 1) return null;

  return html`
    <div class="rh-pagination-wrap">
      ${itens.map(
        (item) => html`
          <${BotaoPaginacao}
            key=${item.pagina}
            pagina=${item.pagina}
            ativa=${item.ativa}
            onClick=${() => onChange(item.pagina)}
          />
        `,
      )}
    </div>
  `;
}

export function MetricGrid({ items = [] }) {
  return html`
    <div class="rh-metric-grid">
      ${items.map(
        (item, indice) => html`
          <article
            key=${item.label || indice}
            class=${`rh-metric-card ${item.variant || ''} ${item.onClick ? 'is-clickable' : ''}`.trim()}
            role=${item.onClick ? 'button' : null}
            tabIndex=${item.onClick ? 0 : null}
            onClick=${item.onClick || null}
            onKeyDown=${item.onClick
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    item.onClick();
                  }
                }
              : null}
          >
            ${item.icon
              ? html`
                  <span class="material-symbols-outlined rh-metric-icon">
                    ${item.icon}
                  </span>
                `
              : null}
            <span class="rh-metric-content">
              <span class="rh-metric-label">${item.label}</span>
              <strong class="rh-metric-value">${item.value}</strong>
              ${item.helper
                ? html`<span class="rh-metric-helper">${item.helper}</span>`
                : null}
            </span>
          </article>
        `,
      )}
    </div>
  `;
}

export function EmptyState({ title, text, icon = '', action = null }) {
  return html`
    <div class="rh-empty-state">
      ${icon
        ? html`
            <span class="rh-empty-state-icon material-symbols-outlined" aria-hidden="true">
              ${icon}
            </span>
          `
        : null}
      <h3>${title}</h3>
      <p>${text}</p>
      ${action
        ? html`
            <button
              type="button"
              class="btn btn-primary rh-empty-state-action"
              onClick=${action.onClick}
            >
              ${action.icon
                ? html`<span class="material-symbols-outlined">${action.icon}</span>`
                : null}
              ${action.label}
            </button>
          `
        : null}
    </div>
  `;
}

export function LoadingState({
  titulo = 'Carregando dados',
  descricao = 'Aguarde enquanto as informações são atualizadas.',
}) {
  return html`
    <div class="rh-loading-state c24-loading-panel">
      <div
        class="spinner-border text-primary"
        role="status"
        aria-hidden="true"
      ></div>
      <div>
        <strong>${titulo}</strong>
        <p>${descricao}</p>
      </div>
    </div>
  `;
}
