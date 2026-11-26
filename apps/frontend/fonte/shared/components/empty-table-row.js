import { html } from '../../infraestrutura-react.js?v=20261126-painel-relatorios';
import { IconeSvg } from '../../ui/icone.js?v=20261126-painel-relatorios';

export function TabelaVazia({ colunas, texto, icone = '' }) {
  const carregando = String(texto || '').toLowerCase().includes('carregando');

  return html`
    <tr>
      <td colspan=${colunas} class="text-center text-muted py-4">
        ${carregando
          ? html`
              <div class="rh-loading-state c24-loading-panel">
                <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
                <div>
                  <strong>${texto}</strong>
                  <p>Aguarde enquanto as informações são atualizadas.</p>
                </div>
              </div>
            `
          : icone
            ? html`
                <div class="c24-table-empty-state">
                  <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(icone)}</span>
                  <span class="c24-table-empty-state-text">${texto}</span>
                </div>
              `
            : texto}
      </td>
    </tr>
  `;
}
