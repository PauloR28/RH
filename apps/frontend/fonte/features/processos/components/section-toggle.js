import { html } from '../../../infraestrutura-react.js?v=20261125-deploy';
import { IconeSvg } from '../../../ui/icone.js?v=20261125-deploy';

export function CabecalhoSecaoColapsavel({ aberto, titulo, onClick }) {
  return html`
    <button
      type="button"
      class="btn btn-link text-decoration-none p-0 d-flex align-items-center gap-2"
      onClick=${onClick}
    >
      <span class="material-symbols-outlined">${IconeSvg(aberto ? 'expand_less' : 'expand_more')}</span>
      <h3 class="h5 mb-0">${titulo}</h3>
    </button>
  `;
}
