import { html, useState } from '../../infraestrutura-react.js';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';

// WFM — peças de formulário compactas, compartilhadas por Jornadas, Cadastros e Presença.
// Campos em grade de 12 colunas (`span` = quantas colunas ocupa) para caber o máximo por linha.

export const Campo = ({ rotulo, span = 4, dica, children }) => html`<label class="wfm-campo" style=${{ gridColumn: `span ${span}` }} title=${dica || ''}><span>${rotulo}</span>${children}</label>`;

export const Marca = ({ rotulo, checked, onChange, span = 4 }) => html`<label class="wfm-marca" style=${{ gridColumn: `span ${span}` }}><input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /><span>${rotulo}</span></label>`;

export const BotaoAdicionar = ({ rotulo, onClick }) => html`<button type="button" class="btn btn-outline-secondary btn-sm wfm-btn-add" onClick=${onClick}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>${rotulo}</button>`;

export const BotaoRemover = ({ rotulo = 'Remover', onClick }) => html`<button type="button" class="wfm-btn-icone" aria-label=${rotulo} title=${rotulo} onClick=${onClick}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('close')}</span></button>`;

// Seção recolhível dos Cadastros.
export function Secao({ titulo, descricao, acoes, children, aberta = true }) {
  const [aberto, setAberto] = useState(aberta);
  return html`<section class="mon-card wfm-secao">
    <div class="wfm-cabecalho">
      <button type="button" class="wfm-secao-toggle" aria-expanded=${aberto} onClick=${() => setAberto(!aberto)}>
        <span class=${`material-symbols-outlined wfm-seta ${aberto ? 'is-aberta' : ''}`} aria-hidden="true">${IconeSvg('expand_more')}</span>
        <span><h3>${titulo}</h3>${descricao ? html`<p class="mon-muted">${descricao}</p>` : null}</span>
      </button>
      ${aberto ? html`<div class="wfm-acoes-cab">${acoes}</div>` : null}
    </div>
    ${aberto ? children : null}
  </section>`;
}

// Modal de formulário: o erro aparece DENTRO do modal (o aviso no topo da página ficava fora de vista).
export function ModalForm({ titulo, onClose, onSubmit, erro, salvando, salvarRotulo = 'Salvar', acaoEsquerda = null, children }) {
  return html`<${ModalPadrao} aberto=${true} titulo=${titulo} onClose=${onClose} className="wfm-modal">
    <form class="wfm-form-modal" noValidate onSubmit=${onSubmit}>
      ${children}
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      <div class="wfm-modal-rodape">
        <div>${acaoEsquerda}</div>
        <div class="wfm-acoes">
          <button type="button" class="btn btn-outline-secondary" onClick=${onClose}>Cancelar</button>
          <button type="submit" class="btn btn-primary" disabled=${!!salvando}>${salvando ? 'Salvando…' : salvarRotulo}</button>
        </div>
      </div>
    </form>
  </${ModalPadrao}>`;
}
