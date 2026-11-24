import { html } from '../../../infraestrutura-react.js?v=20261124-cache';
import { IconeSvg } from '../../../ui/icone.js?v=20261124-cache';

export function BlocoFiltro({ children, tourId = '' }) {
  return html`
    <section class="rh-filter-card" data-tour-id=${tourId || null}>
      ${children}
    </section>
  `;
}

export function CampoFiltro({ label, icon, children }) {
  return html`
    <div class="rh-filter-field">
      <label>${label}</label>
      <div class="rh-modern-input-shell">
        <span class="material-symbols-outlined">${IconeSvg(icon)}</span>
        ${children}
      </div>
    </div>
  `;
}
