import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import {
  atualizarDataComemorativa,
  buscarEnderecoEmpresaCalendario,
  criarDataComemorativa,
  listarAmbientesCalendario,
  listarDatasComemorativas,
  listarEventosCalendario,
  removerDataComemorativa,
  uploadImagemCalendario,
} from '../../servico-api.js';
import {
  EmptyState,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { TabelaVazia } from '../../shared/components/empty-table-row.js';
import { SkeletonTableRows } from '../../shared/components/skeleton.js';
import { obterClasseStatusEntrevista } from '../../shared/helpers-visuais.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { ToggleSwitch } from '../../ui/components/primitives.js';
import { IconeSvg } from '../../ui/icone.js';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// Correções.txt item 10 — categorias fixas do formulário de evento.
const CATEGORIAS_EVENTO = ['Reunião', 'Feriado', 'Aniversário', 'Evento', 'Confraternização', 'Data especial'];

const AMBIENTE_PADRAO_NOME = 'Conecta - Intranet';

const FORM_INICIAL = {
  id_data: '',
  titulo: '',
  data_inicio: '',
  data_fim: '',
  dia_inteiro: true,
  local: '',
  link: '',
  categoria: '',
  descricao: '',
  imagem_url: '',
  id_ambiente: '',
};

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

function paraDatetimeLocal(valorIso) {
  if (!valorIso) return '';
  const data = new Date(valorIso);
  if (Number.isNaN(data.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(data.getHours())}:${pad(data.getMinutes())}`;
}

function paraData(valorIso) {
  return paraDatetimeLocal(valorIso).slice(0, 10);
}

function SincronizacaoBadge({ item }) {
  if (!item.id_ambiente) return null;
  const mapa = {
    enviado: { tom: 'success', texto: 'Publicado na intranet' },
    erro: { tom: 'danger', texto: 'Falha ao publicar' },
    pendente: { tom: 'muted', texto: 'Publicando...' },
  };
  const info = mapa[item.status_sincronizacao] || mapa.pendente;
  if (item.status_sincronizacao === 'enviado' && item.sharepoint_web_url) {
    return html`
      <a
        href=${item.sharepoint_web_url}
        target="_blank"
        rel="noreferrer"
        class=${`rh-status-pill mural-ambiente-pill mural-ambiente-pill--${info.tom} mural-ambiente-pill--link`}
      >
        ${info.texto}
      </a>
    `;
  }
  return html`
    <span
      class=${`rh-status-pill mural-ambiente-pill mural-ambiente-pill--${info.tom}`}
      title=${item.mensagem_sincronizacao || ''}
    >
      ${info.texto}
    </span>
  `;
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
  const [ambientesDisponiveis, setAmbientesDisponiveis] = useState([]);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const { showToast, ToastHost } = useToast();

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
    if (podeEditar) {
      listarAmbientesCalendario()
        .then((resposta) => setAmbientesDisponiveis(resposta?.itens || []))
        .catch(() => setAmbientesDisponiveis([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ambientePadraoId = useMemo(() => {
    const padrao = ambientesDisponiveis.find((item) => item.nome === AMBIENTE_PADRAO_NOME);
    return padrao ? String(padrao.id_ambiente) : (ambientesDisponiveis[0] ? String(ambientesDisponiveis[0].id_ambiente) : '');
  }, [ambientesDisponiveis]);

  const abrirNovo = () => {
    setForm({ ...FORM_INICIAL, id_ambiente: ambientePadraoId });
    setErroForm('');
    setModalAberto(true);
  };

  const abrirEdicao = (item) => {
    setForm({
      id_data: item.id_data,
      titulo: item.titulo || '',
      data_inicio: item.dia_inteiro ? paraData(item.data_inicio) : paraDatetimeLocal(item.data_inicio),
      data_fim: item.dia_inteiro ? paraData(item.data_fim) : paraDatetimeLocal(item.data_fim),
      dia_inteiro: item.dia_inteiro !== false,
      local: item.local || '',
      link: item.link || '',
      categoria: item.categoria || '',
      descricao: item.descricao || '',
      imagem_url: item.imagem_url || '',
      id_ambiente: item.id_ambiente ? String(item.id_ambiente) : '',
    });
    setErroForm('');
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setForm(FORM_INICIAL);
    setErroForm('');
  };

  const usarEnderecoEmpresa = async () => {
    setBuscandoEndereco(true);
    try {
      const resposta = await buscarEnderecoEmpresaCalendario();
      if (resposta?.endereco) {
        setForm((valor) => ({ ...valor, local: resposta.endereco }));
      } else {
        showToast('Nenhum endereço principal cadastrado em Configurações › Operações.', 'aviso');
      }
    } catch (error) {
      showToast(error?.message || 'Não foi possível buscar o endereço da empresa.', 'danger');
    } finally {
      setBuscandoEndereco(false);
    }
  };

  const enviarImagem = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setEnviandoImagem(true);
    try {
      const resultado = await uploadImagemCalendario(arquivo);
      setForm((valor) => ({ ...valor, imagem_url: resultado.url }));
    } catch (error) {
      showToast(error?.message || 'Não foi possível enviar a imagem.', 'danger');
    } finally {
      setEnviandoImagem(false);
    }
  };

  const salvar = async () => {
    setErroForm('');
    if (!form.data_inicio) {
      setErroForm('Informe a data de início do evento.');
      return;
    }
    const sufixoInicio = form.dia_inteiro ? 'T00:00:00' : '';
    const sufixoFim = form.dia_inteiro ? 'T23:59:59' : '';
    const payload = {
      titulo: form.titulo.trim(),
      data_inicio: `${form.data_inicio}${form.data_inicio.length === 10 ? sufixoInicio : ''}`,
      data_fim: form.data_fim
        ? `${form.data_fim}${form.data_fim.length === 10 ? sufixoFim : ''}`
        : `${form.data_inicio}${form.data_inicio.length === 10 ? sufixoFim : ''}`,
      dia_inteiro: form.dia_inteiro,
      local: form.local.trim(),
      link: form.link.trim(),
      categoria: form.categoria,
      descricao: form.descricao.trim(),
      imagem_url: form.imagem_url,
      id_ambiente: form.id_ambiente ? Number(form.id_ambiente) : null,
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
      setErroForm(error?.message || 'Não foi possível salvar o evento.');
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
      setErro(error?.message || 'Não foi possível remover o evento.');
    }
  };

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
          label: 'Novo evento',
          icon: 'add',
          onClick: abrirNovo,
          permissao: 'calendario.editar',
        }
      : null}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="RH"
        title="Calendário de datas comemorativas"
        description="Datas relevantes de RH e da empresa. Ao cadastrar um evento com uma intranet selecionada, ele é publicado automaticamente no calendário do SharePoint."
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Próximas datas" description="Ordenadas pela próxima ocorrência anual." className="rh-section-card--flat">
        ${carregando
      ? html`
              <div class="calendar-date-grid">
                ${[1, 2, 3, 4].map((chave) => html`<div class="calendar-date-card is-skeleton" key=${chave}></div>`)}
              </div>
            `
      : datasOrdenadas.length
        ? html`
              <div class="calendar-date-grid">
                ${datasOrdenadas.map(
          (item) => html`
                    <article class="calendar-date-card" key=${item.id_data}>
                      <div class="calendar-date-badge">
                        <strong>${String(item.dia || '').padStart(2, '0')}</strong>
                        <span>${MESES_ABREV[Number(item.mes || 1) - 1] || ''}</span>
                      </div>
                      <div class="calendar-date-content">
                        <strong>${item.titulo}</strong>
                        ${item.descricao ? html`<p>${item.descricao}</p>` : null}
                        ${item.local ? html`<p class="calendar-date-meta"><span class="material-symbols-outlined">${IconeSvg('location_on')}</span> ${item.local}</p>` : null}
                        <div class="calendar-date-chips">
                          ${formatarProximidade(item)
              ? html`<span class="rh-chip">${formatarProximidade(item)}</span>`
              : null}
                          ${item.categoria ? html`<span class="rh-chip calendar-date-category">${item.categoria}</span>` : null}
                          ${item.link ? html`<a href=${item.link} target="_blank" rel="noreferrer" class="rh-chip calendar-date-link">Abrir link</a>` : null}
                          <${SincronizacaoBadge} item=${item} />
                        </div>
                      </div>
                      ${podeEditar
              ? html`
                            <div class="calendar-date-actions">
                              <button
                                type="button"
                                class="btn btn-outline-secondary btn-sm"
                                title="Editar"
                                onClick=${() => abrirEdicao(item)}
                              >
                                <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                              </button>
                              <button
                                type="button"
                                class="btn btn-outline-danger btn-sm"
                                title="Remover"
                                onClick=${() => excluir(item)}
                              >
                                <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                              </button>
                            </div>
                          `
              : null}
                    </article>
                  `,
        )}
              </div>
            `
        : html`
              <${EmptyState}
                title="Nenhuma data comemorativa cadastrada"
                text="Cadastre datas relevantes de RH e da empresa para acompanhá-las aqui."
                icon="celebration"
              />
            `}
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
                        <td>
                          ${evento.status
              ? html`<span class=${`rh-status-pill ${obterClasseStatusEntrevista(evento.status)}`}>${evento.status}</span>`
              : '-'}
                        </td>
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
        titulo=${form.id_data ? 'Editar evento' : 'Novo evento'}
        subtitulo="Datas de RH e da empresa — quando publicadas numa intranet, aparecem automaticamente no calendário do SharePoint."
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

          <label class="users-toggle-row">
            <span>${form.dia_inteiro ? 'Dia inteiro' : 'Com horário definido'}</span>
            <${ToggleSwitch}
              checked=${form.dia_inteiro}
              onChange=${(event) => {
      const diaInteiro = event.target.checked;
      setForm((valor) => ({
        ...valor,
        dia_inteiro: diaInteiro,
        data_inicio: diaInteiro ? valor.data_inicio.slice(0, 10) : valor.data_inicio,
        data_fim: diaInteiro ? valor.data_fim.slice(0, 10) : valor.data_fim,
      }));
    }}
            />
          </label>

          <div class="d-flex gap-3">
            <div class="rh-filter-field">
              <label>Data início</label>
              <input
                type=${form.dia_inteiro ? 'date' : 'datetime-local'}
                class="form-control"
                value=${form.data_inicio}
                onInput=${(event) => setForm({ ...form, data_inicio: event.target.value })}
              />
            </div>
            <div class="rh-filter-field">
              <label>Data final</label>
              <input
                type=${form.dia_inteiro ? 'date' : 'datetime-local'}
                class="form-control"
                value=${form.data_fim}
                onInput=${(event) => setForm({ ...form, data_fim: event.target.value })}
              />
            </div>
          </div>

          <div class="rh-filter-field">
            <label>Local</label>
            <div class="d-flex gap-2">
              <input
                class="form-control"
                value=${form.local}
                onInput=${(event) => setForm({ ...form, local: event.target.value })}
                placeholder="Endereço do evento"
              />
              <button
                type="button"
                class="btn btn-outline-secondary text-nowrap"
                disabled=${buscandoEndereco}
                onClick=${usarEnderecoEmpresa}
              >
                ${buscandoEndereco ? 'Buscando...' : 'Usar endereço da empresa'}
              </button>
            </div>
          </div>

          <div class="d-flex gap-3">
            <div class="rh-filter-field" style=${{ flex: 1 }}>
              <label>Link (opcional)</label>
              <input
                type="url"
                class="form-control"
                value=${form.link}
                onInput=${(event) => setForm({ ...form, link: event.target.value })}
                placeholder="https://..."
              />
            </div>
            <div class="rh-filter-field" style=${{ flex: 1 }}>
              <label>Categoria</label>
              <select
                class="form-select"
                value=${form.categoria}
                onChange=${(event) => setForm({ ...form, categoria: event.target.value })}
              >
                <option value="">Selecione</option>
                ${CATEGORIAS_EVENTO.map((opcao) => html`<option key=${opcao} value=${opcao}>${opcao}</option>`)}
              </select>
            </div>
          </div>

          <div class="rh-filter-field">
            <label>Sobre o evento</label>
            <textarea
              class="form-control"
              rows="3"
              value=${form.descricao}
              onInput=${(event) => setForm({ ...form, descricao: event.target.value })}
            ></textarea>
          </div>

          <div class="rh-filter-field">
            <label>Imagem (opcional)</label>
            ${form.imagem_url
      ? html`
                  <div class="calendar-event-image-preview">
                    <img src=${form.imagem_url} alt="" />
                    <button type="button" class="btn btn-outline-danger btn-sm" onClick=${() => setForm({ ...form, imagem_url: '' })}>
                      Remover imagem
                    </button>
                  </div>
                `
      : html`
                  <label class=${`btn btn-outline-secondary ${enviandoImagem ? 'is-disabled' : ''}`}>
                    <span class="material-symbols-outlined">${IconeSvg('upload')}</span>
                    ${enviandoImagem ? 'Enviando...' : 'Adicionar imagem'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      style=${{ display: 'none' }}
                      disabled=${enviandoImagem}
                      onChange=${enviarImagem}
                    />
                  </label>
                `}
          </div>

          <div class="rh-filter-field">
            <label>Publicar no calendário da intranet</label>
            <select
              class="form-select"
              value=${form.id_ambiente}
              onChange=${(event) => setForm({ ...form, id_ambiente: event.target.value })}
            >
              <option value="">Não publicar</option>
              ${ambientesDisponiveis.map(
      (ambiente) => html`
                  <option key=${ambiente.id_ambiente} value=${String(ambiente.id_ambiente)}>
                    ${ambiente.nome}${ambiente.operacao_nome ? ` · ${ambiente.operacao_nome}` : ''}
                  </option>
                `,
    )}
            </select>
            ${!ambientesDisponiveis.length
      ? html`<small class="text-muted">Nenhuma intranet conectada ainda — cadastre em Parâmetros › Conectores Externos.</small>`
      : null}
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
              disabled=${salvando || !form.titulo.trim() || !form.data_inicio}
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
