import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  atualizarDataComemorativa,
  criarDataComemorativa,
  listarDatasComemorativas,
  listarEventosCalendario,
  removerDataComemorativa,
} from '../../servico-api.js';
import {
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { IconeSvg } from '../../ui/icone.js';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const FORM_INICIAL = { id_data: '', titulo: '', dia: '', mes: '', descricao: '' };

function formatarData(item) {
  const dia = String(item?.dia || '').padStart(2, '0');
  const mesIndice = Number(item?.mes || 1) - 1;
  const nomeMes = MESES[mesIndice] || '';
  return `${dia} de ${nomeMes}`;
}

function formatarProximidade(item) {
  const dias = Number(item?.dias_para_proxima_ocorrencia);
  if (Number.isNaN(dias)) return '';
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Amanhã';
  return `Em ${dias} dias`;
}

function formatarDataHoraEntrevista(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TelaCalendario({ controlador }) {
  const [datas, setDatas] = useState([]);
  const [eventosEntrevista, setEventosEntrevista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');

  const podeEditar = !!controlador?.possuiPermissao?.('calendario.editar');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const [datasResp, eventosResp] = await Promise.allSettled([
        listarDatasComemorativas(),
        listarEventosCalendario(),
      ]);
      if (datasResp.status === 'fulfilled') {
        setDatas(Array.isArray(datasResp.value) ? datasResp.value : []);
      } else {
        setErro(datasResp.reason?.message || 'Não foi possível carregar as datas comemorativas.');
      }
      if (eventosResp.status === 'fulfilled') {
        const eventos = Array.isArray(eventosResp.value) ? eventosResp.value : [];
        setEventosEntrevista(eventos.filter((evento) => evento?.tipo === 'entrevista'));
      }
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const abrirNovo = () => {
    setForm(FORM_INICIAL);
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (item) => {
    setForm({
      id_data: item.id_data,
      titulo: item.titulo || '',
      dia: String(item.dia || ''),
      mes: String(item.mes || ''),
      descricao: item.descricao || '',
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setForm(FORM_INICIAL);
    setErroForm('');
  };

  const salvar = async () => {
    setErroForm('');
    const payload = {
      titulo: form.titulo.trim(),
      dia: Number(form.dia),
      mes: Number(form.mes),
      descricao: form.descricao.trim(),
    };

    setSalvando(true);
    try {
      if (form.id_data) {
        await atualizarDataComemorativa(form.id_data, payload);
      } else {
        await criarDataComemorativa(payload);
      }
      fechar();
      await carregar();
    } catch (error) {
      setErroForm(error?.message || 'Não foi possível salvar a data comemorativa.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (item) => {
    const confirmar = window.confirm(`Remover "${item.titulo}" do calendário?`);
    if (!confirmar) return;
    try {
      await removerDataComemorativa(item.id_data);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível remover a data comemorativa.');
    }
  };

  const totalColunas = podeEditar ? 4 : 3;

  const datasOrdenadas = useMemo(() => datas, [datas]);

  return html`
    <${PainelRh}
      screenId="screen-calendario"
      navAtiva="screen-calendario"
      subtituloMarca="Calendário de datas comemorativas"
      placeholderBusca="Datas comemorativas"
      controlador=${controlador}
      acaoPrimaria=${podeEditar
      ? {
          label: 'Nova data',
          icon: 'add',
          onClick: abrirNovo,
          permissao: 'calendario.editar',
        }
      : null}
    >
      <${PageIntro}
        kicker="RH"
        title="Calendário de datas comemorativas"
        description="Datas relevantes de RH e da empresa, ordenadas pela próxima ocorrência."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Próximas datas" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Data</th>
                <th>Descrição</th>
                ${podeEditar ? html`<th>Ações</th>` : null}
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${totalColunas} linhas=${4} />`
      : datasOrdenadas.length
        ? datasOrdenadas.map(
          (item) => html`
                      <tr key=${item.id_data}>
                        <td>
                          <strong>${item.titulo}</strong>
                          ${formatarProximidade(item)
              ? html`<div class="rh-chip-wrap"><span class="rh-chip">${formatarProximidade(item)}</span></div>`
              : null}
                        </td>
                        <td>${formatarData(item)}</td>
                        <td>${item.descricao || '-'}</td>
                        ${podeEditar
              ? html`
                              <td>
                                <div class="d-flex gap-2">
                                  <button
                                    type="button"
                                    class="btn btn-outline-secondary btn-sm"
                                    onClick=${() => abrirEdicao(item)}
                                  >
                                    <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    class="btn btn-outline-danger btn-sm"
                                    onClick=${() => excluir(item)}
                                  >
                                    <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                                    Remover
                                  </button>
                                </div>
                              </td>
                            `
              : null}
                      </tr>
                    `,
        )
        : html`
                      <${TabelaVazia}
                        colunas=${totalColunas}
                        texto="Nenhuma data comemorativa cadastrada."
                        icone="celebration"
                      />
                    `}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${SectionCard} title="Entrevistas agendadas" className="rh-section-card--flat">
        <div class="table-responsive">
          <table class="table align-middle rh-modern-history-table">
            <thead>
              <tr>
                <th>Candidato</th>
                <th>Vaga</th>
                <th>Data e hora</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${carregando
      ? html`<${SkeletonTableRows} colunas=${4} linhas=${3} />`
      : eventosEntrevista.length
        ? eventosEntrevista.map(
          (evento) => html`
                      <tr key=${evento.id}>
                        <td><strong>${evento.titulo}</strong></td>
                        <td>${evento.vaga || '-'}</td>
                        <td>${formatarDataHoraEntrevista(evento.data)}</td>
                        <td>${evento.status || '-'}</td>
                      </tr>
                    `,
        )
        : html`
                      <${TabelaVazia}
                        colunas=${4}
                        texto="Nenhuma entrevista agendada no momento."
                        icone="event_available"
                      />
                    `}
            </tbody>
          </table>
        </div>
      </${SectionCard}>

      <${ModalPadrao}
        aberto=${modalAberto}
        titulo=${form.id_data ? 'Editar data comemorativa' : 'Nova data comemorativa'}
        subtitulo="Datas informativas, sem integração com outros fluxos."
        onClose=${fechar}
      >
        <div class="rh-details-body">
          ${erroForm ? html`<div class="alert alert-warning">${erroForm}</div>` : null}

          <div class="rh-filter-field">
            <label>Título</label>
            <input
              class="form-control"
              value=${form.titulo}
              onInput=${(event) => setForm({ ...form, titulo: event.target.value })}
              placeholder="Ex.: Dia do Trabalho"
            />
          </div>

          <div class="d-flex gap-3">
            <div class="rh-filter-field">
              <label>Dia</label>
              <input
                type="number"
                min="1"
                max="31"
                class="form-control"
                value=${form.dia}
                onInput=${(event) => setForm({ ...form, dia: event.target.value })}
              />
            </div>
            <div class="rh-filter-field">
              <label>Mês</label>
              <select
                class="form-select"
                value=${form.mes}
                onChange=${(event) => setForm({ ...form, mes: event.target.value })}
              >
                <option value="">Selecione</option>
                ${MESES.map(
        (nome, indice) => html`
                    <option key=${nome} value=${indice + 1}>${nome}</option>
                  `,
      )}
              </select>
            </div>
          </div>

          <div class="rh-filter-field">
            <label>Descrição (opcional)</label>
            <textarea
              class="form-control"
              rows="3"
              value=${form.descricao}
              onInput=${(event) => setForm({ ...form, descricao: event.target.value })}
            ></textarea>
          </div>
        </div>

        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button type="button" class="btn btn-outline-secondary" disabled=${salvando} onClick=${fechar}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${salvando || !form.titulo.trim() || !form.dia || !form.mes}
              onClick=${salvar}
            >
              ${salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
