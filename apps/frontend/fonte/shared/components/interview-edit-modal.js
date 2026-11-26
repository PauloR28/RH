import { html } from '../../infraestrutura-react.js?v=20261126-senha';
import { formatarDataHora } from '../helpers-visuais.js?v=20261126-senha';
import { isProcessClosed } from '../process-flow.js?v=20261126-senha';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js?v=20261126-senha';

export const STATUS_ENTREVISTA = [
  'Pendente',
  'Agendado',
  'Confirmado',
  'Reagendado',
  'Não respondeu',
  'Cancelado',
  'Faltou',
  'Compareceu',
  'Aprovado',
  'Eliminado',
  'Desistente',
  'Banco de talentos',
];

export function formatarHorarioSlotEntrevista(slot) {
  if (!slot) return '-';
  const inicio = formatarDataHora(slot.inicio);
  const fim = formatarDataHora(slot.fim);
  return `${inicio} até ${fim} | ${slot.ocupados || 0}/${slot.capacidade_total || 1} ocupados`;
}

export function ModalEdicaoEntrevista({
  aberto,
  entrevista,
  formulario,
  slotsDisponiveis = [],
  salvando = false,
  onClose,
  onChange,
  onSave,
}) {
  const atualizar = (campo, valor) => {
    if (typeof onChange !== 'function') return;
    onChange({
      ...(formulario || {}),
      [campo]: valor,
    });
  };

  return html`
    <${ModalPadrao}
      aberto=${aberto}
      titulo="Atualizar entrevista"
      subtitulo="Edite status e, quando necessario, escolha novo slot para reagendar."
      onClose=${onClose}
    >
      ${entrevista
        ? html`
            <div class="rh-details-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">Candidato</label>
                  <input
                    class="form-control"
                    readonly
                    value=${entrevista.nome_candidato || ''}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Processo</label>
                  <input
                    class="form-control"
                    readonly
                    value=${entrevista.id_processo || ''}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Horário atual</label>
                  <input
                    class="form-control"
                    readonly
                    value=${formatarDataHora(entrevista.data_entrevista)}
                  />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Status</label>
                  <select
                    class="form-select"
                    value=${formulario.status_entrevista}
                    onChange=${(event) =>
                      atualizar('status_entrevista', event.target.value)}
                  >
                    ${STATUS_ENTREVISTA.map(
                      (statusItem) => html`
                        <option key=${statusItem} value=${statusItem}>
                          ${statusItem}
                        </option>
                      `,
                    )}
                  </select>
                </div>
                <div class="col-md-12">
                  <label class="form-label">Novo horário para reagendar</label>
                  <select
                    class="form-select"
                    value=${formulario.id_slot}
                    onChange=${(event) =>
                      atualizar('id_slot', event.target.value)}
                  >
                    <option value="">Manter horário atual</option>
                    ${slotsDisponiveis.map(
                      (slot) => html`
                        <option key=${slot.id_slot} value=${slot.id_slot}>
                          ${formatarHorarioSlotEntrevista(slot)}
                          | ${slot.id_processo || 'Geral'}
                        </option>
                      `,
                    )}
                  </select>
                </div>
                <div class="col-md-12">
                  <label class="form-label">Mensagem personalizada</label>
                  <textarea
                    class="form-control"
                    rows="3"
                    value=${formulario.mensagem_personalizada}
                    onInput=${(event) =>
                      atualizar('mensagem_personalizada', event.target.value)}
                  ></textarea>
                </div>
                <div class="col-md-12">
                  <label class="form-label">Observações RH</label>
                  <textarea
                    class="form-control"
                    rows="4"
                    value=${formulario.observacoes_rh}
                    onInput=${(event) =>
                      atualizar('observacoes_rh', event.target.value)}
                  ></textarea>
                </div>
              </div>
            </div>
            <footer class="rh-modal-footer">
              <button
                type="button"
                class="btn btn-outline-secondary"
                onClick=${onClose}
              >
                Cancelar
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled=${salvando || isProcessClosed(entrevista.status_processo)}
                onClick=${onSave}
              >
                ${salvando
                  ? 'Salvando...'
                  : isProcessClosed(entrevista.status_processo)
                    ? 'Processo encerrado'
                    : 'Salvar atualização'}
              </button>
            </footer>
          `
        : null}
    </${ModalPadrao}>
  `;
}
