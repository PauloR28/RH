import { html } from '../../infraestrutura-react.js?v=20261126-senha';
import { IconeSvg } from '../../ui/icone.js?v=20261126-senha';

export function AcaoSair({ controlador }) {
  return html`
    <button
      type="button"
      class="btn btn-outline-secondary rh-modern-secondary-btn rh-action-btn"
      onClick=${() => controlador.sair()}
    >
      <span class="material-symbols-outlined">${IconeSvg('logout')}</span>
      Sair
    </button>
  `;
}
