import { html } from '../../infraestrutura-react.js';
import { GrupoPaginacao } from './feedback.js';
import { ModalPadrao } from './modals.js';
import { IconeSvg } from '../icone.js';


export function Button({ label = '', icon = '', variant = 'primary', className = '', children, ...props }) {
  return html`
    <button class=${`btn btn-${variant} ${className}`.trim()} ...${props}>
      ${icon ? html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(icon)}</span>` : null}
      ${children || label}
    </button>
  `;
}

export function Badge({ label, tone = 'secondary', className = '' }) {
  return html`<span class=${`badge text-bg-${tone} ${className}`.trim()}>${label}</span>`;
}

// Mesmo componente/estilo usado em Perfis e Permissões (configuracoes/index.js)
// — extraído para cá para ser reaproveitado por outras telas (Correções.txt
// item 7: Zona de risco precisa do mesmo estilo turn on/off).
export function ToggleSwitch({ checked, disabled, onChange }) {
  return html`
    <label class=${`c24-toggle-switch ${disabled ? 'is-disabled' : ''}`.trim()}>
      <input type="checkbox" checked=${checked} disabled=${disabled} onChange=${onChange} />
      <span class="c24-toggle-switch-track"><span class="c24-toggle-switch-thumb"></span></span>
    </label>
  `;
}

export function FormField({ label, help = '', error = '', required = false, children }) {
  return html`
    <label class="form-field">
      <span class="form-label">${label}${required ? ' *' : ''}</span>
      ${children}
      ${error
        ? html`<small class="text-danger" role="alert">${error}</small>`
        : help
          ? html`<small class="form-text">${help}</small>`
          : null}
    </label>
  `;
}

export function Table({ columns = [], rows = [], rowKey = 'id', renderCell = null, emptyText = 'Nenhum registro.', emptyIcon = '' }) {
  return html`
    <div class="table-responsive">
      <table class="table align-middle">
        <thead><tr>${columns.map((column) => html`<th key=${column.key}>${column.label}</th>`)}</tr></thead>
        <tbody>
          ${rows.length
            ? rows.map((row, index) => html`
                <tr key=${row?.[rowKey] ?? index}>
                  ${columns.map((column) => html`
                    <td key=${column.key}>${renderCell ? renderCell(row, column) : row?.[column.key]}</td>
                  `)}
                </tr>
              `)
            : html`
                <tr>
                  <td colspan=${Math.max(1, columns.length)}>
                    ${emptyIcon
                      ? html`
                          <div class="c24-table-empty-state">
                            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(emptyIcon)}</span>
                            <span class="c24-table-empty-state-text">${emptyText}</span>
                          </div>
                        `
                      : emptyText}
                  </td>
                </tr>
              `}
        </tbody>
      </table>
    </div>
  `;
}

export function ToastAlert({ message, tone = 'info', onClose = null }) {
  return html`
    <div class=${`alert alert-${tone} d-flex align-items-center justify-content-between`.trim()} role="alert">
      <span>${message}</span>
      ${onClose ? html`<button class="btn-close" aria-label="Fechar" onClick=${onClose}></button>` : null}
    </div>
  `;
}

export const Modal = ModalPadrao;
export const Pagination = GrupoPaginacao;
