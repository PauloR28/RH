import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { construirModeloPaginacao } from '../../utilitarios.js';
import { IconeSvg } from '../icone.js';

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
                  <span class="material-symbols-outlined rh-metric-icon">${IconeSvg(item.icon)}</span>
                `
        : null}
            <span class="rh-metric-content">
              <span class="rh-metric-label">${item.label}</span>
              <strong class="rh-metric-value">${item.value}</strong>
            
            </span>
          </article>
        `,
  )}
    </div>
  `;
}

export function IlustracaoEstadoVazio() {
  return html`
    <svg
      class="rh-empty-state-illustration"
      width="96"
      height="96"
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
    >
      <rect x="20" y="14" width="44" height="56" rx="6" stroke="currentColor" stroke-width="2.5" />
      <line x1="30" y1="30" x2="54" y2="30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      <line x1="30" y1="40" x2="54" y2="40" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      <line x1="30" y1="50" x2="46" y2="50" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      <circle cx="66" cy="64" r="12" stroke="currentColor" stroke-width="2.5" />
      <line x1="75" y1="73" x2="84" y2="82" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  `;
}

export function EmptyState({ title, text, icon = '', ilustracao = null, action = null }) {
  return html`
    <div class="rh-empty-state">
      ${ilustracao
      ? ilustracao
      : icon
        ? html`
            <span class="rh-empty-state-icon material-symbols-outlined" aria-hidden="true">${IconeSvg(icon)}</span>
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
          ? html`<span class="material-symbols-outlined">${IconeSvg(action.icon)}</span>`
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
  mensagens = null,
}) {
  const listaMensagens = Array.isArray(mensagens) ? mensagens.filter(Boolean) : [];
  const [indiceMensagem, setIndiceMensagem] = useState(0);

  useEffect(() => {
    if (listaMensagens.length < 2) return undefined;
    const intervalo = setInterval(() => {
      setIndiceMensagem((atual) => (atual + 1) % listaMensagens.length);
    }, 2200);
    return () => clearInterval(intervalo);
  }, [listaMensagens.length]);

  const textoExibido = listaMensagens.length ? listaMensagens[indiceMensagem % listaMensagens.length] : descricao;

  return html`
    <div class="rh-loading-state c24-loading-panel">
      <div
        class="spinner-border text-primary"
        role="status"
        aria-hidden="true"
      ></div>
      <div>
        <strong>${titulo}</strong>
        <p>${textoExibido}</p>
      </div>
    </div>
  `;
}
