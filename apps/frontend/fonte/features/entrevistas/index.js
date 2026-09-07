import {
  html,
  useEffect,
  useMemo,
  useState,
} from '../../infraestrutura-react.js';
import {
  atualizarEntrevista,
  atualizarSlotEntrevista,
  criarSlotsEntrevista,
  excluirSlotEntrevista,
  lerEntrevistas,
  lerProcessos,
  lerSlotsEntrevista,
} from '../../app/controlador-aplicacao.js';
import {
  formatarDataHora,
  obterClasseStatusEntrevista,
} from '../../shared/helpers-visuais.js';
import { copiarTexto } from '../../shared/browser-utils.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import {
  ModalEdicaoEntrevista,
  STATUS_ENTREVISTA,
} from '../../shared/components/interview-edit-modal.js';
import {
  CANDIDATE_STATUS_PENDING_CONFIRMATION,
  canonicalizeCandidateStatus,
  isProcessClosed,
} from '../../shared/process-flow.js';
import { validarFormularioEntrevista } from '../../shared/validacoes.js';
import {
  LoadingState,
  ModalPadrao,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import {
  obterChaveProcesso,
  obterReferenciaProcesso,
} from '../../shared/process-reference.js';
import { obterItensPaginados } from '../../utilitarios.js';
import { IconeSvg } from '../../ui/icone.js';

const STATUS_SLOT_DISPONIVEL = 'Disponivel';
const STATUS_SLOT_BLOQUEADO = 'Bloqueado';
const TAMANHO_PAGINA_SLOTS_ENTREVISTAS = 4;
const TAMANHO_PAGINA_AGENDA_ENTREVISTAS = 4;
const TAMANHO_RESUMO_DIA_ENTREVISTAS = 4;

function hojeIsoLocal() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function criarDataLocal(valor) {
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [ano, mes, dia] = texto.split('-').map(Number);
    return new Date(ano, mes - 1, dia);
  }

  const data = texto ? new Date(texto) : new Date();
  return Number.isNaN(data.getTime()) ? new Date() : data;
}

function formatarIsoLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function moverDataIso(valor, dias) {
  const data = criarDataLocal(valor);
  data.setDate(data.getDate() + dias);
  return formatarIsoLocal(data);
}

function formatarDataLonga(valor) {
  return criarDataLocal(valor).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatarDataCurtaLocal(valor) {
  return criarDataLocal(valor).toLocaleDateString('pt-BR');
}

function obterResponsavelEntrevista(item) {
  return String(
    item?.responsavel ||
      item?.responsavel_rh ||
      item?.entrevistador ||
      item?.usuario_responsavel ||
      item?.criado_por ||
      item?.observacoes_rh ||
      '',
  ).trim();
}

function gerarDiasResumo(valor) {
  const base = criarDataLocal(valor);
  return [-1, 0, 1, 2, 3, 4].map((deslocamento) => {
    const data = new Date(base);
    data.setDate(base.getDate() + deslocamento);
    return {
      iso: formatarIsoLocal(data),
      semana: data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase(),
      dia: data.toLocaleDateString('pt-BR', { day: '2-digit' }),
      ativo: deslocamento === 0,
    };
  });
}

function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatarHorarioSlot(slot) {
  if (!slot) return '-';
  const inicio = formatarDataHora(slot.inicio);
  const fim = formatarDataHora(slot.fim);
  return `${inicio} até ${fim}`;
}

function obterSlotDisponivel(slot) {
  const statusSlot = normalizarTexto(slot?.status_calculado || slot?.status_slot);
  return statusSlot !== normalizarTexto(STATUS_SLOT_BLOQUEADO) && statusSlot !== 'lotado' && Number(slot?.disponiveis ?? 1) > 0;
}

function obterClasseStatusSlot(slot) {
  const statusSlot = normalizarTexto(slot?.status_calculado || slot?.status_slot);
  if (statusSlot === 'lotado' || statusSlot === 'bloqueado') return 'is-eliminated';
  if (statusSlot === 'parcialmente ocupado') return 'is-analysis';
  return 'is-highlight';
}

function formatarOcupacaoSlot(slot) {
  return `${Number(slot?.ocupados || 0)}/${Number(slot?.capacidade_total || 1)} ocupados`;
}

function PaginacaoCompacta({
  paginaAtual = 1,
  totalPaginas = 1,
  totalItens = 0,
  tamanhoPagina = 1,
  itensNaPagina = 0,
  onChange,
}) {
  const total = Number(totalItens || 0);
  if (!total || total <= Math.max(1, Number(tamanhoPagina || 1))) return null;

  const totalPaginasSeguro = Math.max(1, Number(totalPaginas || 1));
  const paginaSegura = Math.min(Math.max(1, Number(paginaAtual || 1)), totalPaginasSeguro);
  const inicio = ((paginaSegura - 1) * Math.max(1, Number(tamanhoPagina || 1))) + 1;
  const fim = Math.min(total, inicio + Math.max(0, Number(itensNaPagina || 0)) - 1);
  const podeVoltar = paginaSegura > 1;
  const podeAvancar = paginaSegura < totalPaginasSeguro;

  return html`
    <div class="c24-pagination-bar">
      <span>Mostrando ${inicio}-${fim} de ${total}</span>
      ${totalPaginasSeguro > 1
        ? html`
            <div class="c24-pagination-actions">
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                disabled=${!podeVoltar}
                onClick=${() => podeVoltar && onChange?.(paginaSegura - 1)}
              >
                Anterior
              </button>
              <span class="c24-pagination-current">${paginaSegura} de ${totalPaginasSeguro}</span>
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                disabled=${!podeAvancar}
                onClick=${() => podeAvancar && onChange?.(paginaSegura + 1)}
              >
                Próximo
              </button>
            </div>
          `
        : null}
    </div>
  `;
}

export function TelaEntrevistas({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [entrevistas, setEntrevistas] = useState([]);
  const [slots, setSlots] = useState([]);
  const [processos, setProcessos] = useState([]);
  const [filtros, setFiltros] = useState({
    processo: '',
    status: '',
    busca: '',
    data: hojeIsoLocal(),
  });
  const [formularioSlots, setFormularioSlots] = useState({
    id_processo_ref: '',
    data: hojeIsoLocal(),
    somente_dia: false,
    hora_inicio: '09:00',
    hora_fim: '12:00',
    duracao_minutos: 30,
    capacidade_total: 1,
    observacoes_rh: '',
  });
  const [entrevistaEdicao, setEntrevistaEdicao] = useState(null);
  const [formularioEdicao, setFormularioEdicao] = useState({
    id_slot: '',
    status_entrevista: CANDIDATE_STATUS_PENDING_CONFIRMATION,
    observacoes_rh: '',
    mensagem_personalizada: '',
  });
  const [slotEdicao, setSlotEdicao] = useState(null);
  const [formularioSlotEdicao, setFormularioSlotEdicao] = useState({
    capacidade_total: 1,
    status_slot: STATUS_SLOT_DISPONIVEL,
    observacoes_rh: '',
  });
  const [paginaSlots, setPaginaSlots] = useState(1);
  const [paginaAgenda, setPaginaAgenda] = useState(1);
  const [modalResumoDiaAberto, setModalResumoDiaAberto] = useState(false);

  const carregar = async ({ forcar = false } = {}) => {
    setCarregando(true);
    setErro('');

    try {
      const [listaEntrevistas, listaProcessos, listaSlots] = await Promise.all([
        lerEntrevistas({
          idProcesso: filtros.processo,
          statusEntrevista: filtros.status,
          search: filtros.busca,
        }),
        lerProcessos({ forcar }),
        lerSlotsEntrevista({
          idProcesso: filtros.processo,
          date: filtros.data,
        }),
      ]);

      setEntrevistas(Array.isArray(listaEntrevistas) ? listaEntrevistas : []);
      setProcessos(Array.isArray(listaProcessos) ? listaProcessos : []);
      setSlots(Array.isArray(listaSlots) ? listaSlots : []);
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível carregar a agenda de entrevistas.',
      );
      setEntrevistas([]);
      setSlots([]);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [filtros.processo, filtros.status, filtros.busca, filtros.data]);

  const slotsDisponiveis = useMemo(
    () => slots.filter((slot) => obterSlotDisponivel(slot)),
    [slots],
  );
  const processosAbertos = useMemo(
    () => processos.filter((processo) => !isProcessClosed(processo.status)),
    [processos],
  );
  const entrevistasOperacionais = useMemo(
    () => {
      const statusFiltro = canonicalizeCandidateStatus(filtros.status);
      if (statusFiltro === 'Cancelado') return entrevistas;
      return entrevistas.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) !== 'Cancelado',
      );
    },
    [entrevistas, filtros.status],
  );

  const resumo = useMemo(
    () => ({
      total: entrevistasOperacionais.length,
      disponiveis: slotsDisponiveis.length,
      ocupados: slots.filter((slot) => normalizarTexto(slot.status_slot) === 'ocupado').length,
      parcialmenteOcupados: slots.filter((slot) => normalizarTexto(slot.status_calculado || slot.status_slot) === 'parcialmente ocupado').length,
      lotados: slots.filter((slot) => normalizarTexto(slot.status_calculado || slot.status_slot) === 'lotado').length,
      pendentes: entrevistasOperacionais.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) === CANDIDATE_STATUS_PENDING_CONFIRMATION,
      ).length,
      agendadas: entrevistasOperacionais.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) === 'Agendado',
      ).length,
      confirmadas: entrevistasOperacionais.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) === 'Confirmado',
      ).length,
      reagendadas: entrevistasOperacionais.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) === 'Reagendado',
      ).length,
      compareceram: entrevistasOperacionais.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) === 'Compareceu',
      ).length,
      faltas: entrevistasOperacionais.filter(
        (item) => canonicalizeCandidateStatus(item.status_entrevista) === 'Faltou',
      ).length,
    }),
    [entrevistasOperacionais, slots, slotsDisponiveis.length],
  );
  const diasResumo = useMemo(() => gerarDiasResumo(filtros.data), [filtros.data]);
  const entrevistasDoDia = useMemo(
    () =>
      (Array.isArray(entrevistasOperacionais) ? entrevistasOperacionais : []).filter(
        (item) =>
          item.data_entrevista &&
          formatarIsoLocal(criarDataLocal(item.data_entrevista)) === filtros.data,
      ),
    [entrevistasOperacionais, filtros.data],
  );
  const entrevistasResumoDia = useMemo(
    () => entrevistasDoDia.slice(0, TAMANHO_RESUMO_DIA_ENTREVISTAS),
    [entrevistasDoDia],
  );
  const slotsPaginados = useMemo(
    () => obterItensPaginados(slots, paginaSlots, TAMANHO_PAGINA_SLOTS_ENTREVISTAS),
    [slots, paginaSlots],
  );
  const entrevistasPaginadas = useMemo(
    () =>
      obterItensPaginados(
        entrevistasOperacionais,
        paginaAgenda,
        TAMANHO_PAGINA_AGENDA_ENTREVISTAS,
      ),
    [entrevistasOperacionais, paginaAgenda],
  );

  useEffect(() => {
    setPaginaSlots(1);
  }, [slots.length, filtros.data, filtros.processo]);

  useEffect(() => {
    setPaginaAgenda(1);
  }, [entrevistasOperacionais.length, filtros.data, filtros.processo, filtros.status, filtros.busca]);

  useEffect(() => {
    setModalResumoDiaAberto(false);
  }, [filtros.data]);

  const selecionarData = (data) => setFiltros({ ...filtros, data });
  const limparFiltros = () =>
    setFiltros({
      processo: '',
      status: '',
      busca: '',
      data: hojeIsoLocal(),
    });

  const criarDisponibilidade = async () => {
    if (!formularioSlots.data) {
      setErro('Informe a data para gerar o horário.');
      return;
    }
    if (!formularioSlots.somente_dia && (!formularioSlots.hora_inicio || !formularioSlots.hora_fim)) {
      setErro('Informe hora inicial e final, ou marque "somente o dia".');
      return;
    }
    if (Number(formularioSlots.capacidade_total || 0) < 1) {
      setErro('A capacidade por slot deve ser maior que zero.');
      return;
    }

    setSalvando(true);
    setErro('');

    try {
      const processoSelecionado = processos.find(
        (processo) =>
          obterReferenciaProcesso(processo) === formularioSlots.id_processo_ref,
      );
      if (processoSelecionado && isProcessClosed(processoSelecionado.status)) {
        setErro('O processo selecionado está encerrado e não permite criar horários.');
        return;
      }

      const resultado = await criarSlotsEntrevista({
        ...formularioSlots,
        id_processo: processoSelecionado?.id_processo || '',
      });

      await carregar();
      showToast(
        `Slots criados: ${resultado?.created || 0}. Ignorados por conflito: ${resultado?.skipped || 0}.`,
        'success',
      );
    } catch (error) {
      setErro(error?.message || 'Não foi possível criar os horários.');
    } finally {
      setSalvando(false);
    }
  };

  const abrirEdicaoSlot = (slot) => {
    setSlotEdicao(slot);
    setFormularioSlotEdicao({
      capacidade_total: Number(slot.capacidade_total || 1),
      status_slot: slot.status_calculado === STATUS_SLOT_BLOQUEADO ? STATUS_SLOT_BLOQUEADO : (normalizarTexto(slot.status_slot) === 'bloqueado' ? STATUS_SLOT_BLOQUEADO : STATUS_SLOT_DISPONIVEL),
      observacoes_rh: slot.observacoes_rh || '',
    });
  };

  const salvarSlot = async () => {
    if (!slotEdicao) return;
    const capacidade = Number(formularioSlotEdicao.capacidade_total || 0);
    if (capacidade < 1) {
      setErro('A capacidade do slot deve ser maior que zero.');
      return;
    }
    if (capacidade < Number(slotEdicao.ocupados || 0)) {
      setErro('A capacidade não pode ser menor que a quantidade já ocupada.');
      return;
    }

    setSalvando(true);
    setErro('');
    try {
      await atualizarSlotEntrevista(slotEdicao.id_slot, {
        capacidade_total: capacidade,
        status_slot: formularioSlotEdicao.status_slot,
        observacoes_rh: formularioSlotEdicao.observacoes_rh || '',
      });
      setSlotEdicao(null);
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível atualizar o slot.');
    } finally {
      setSalvando(false);
    }
  };

  const excluirSlot = async (slot) => {
    if (!slot?.id_slot) return;

    if (Number(slot.ocupados || 0) > 0) {
      setErro('Este horário possui candidato(s) agendado(s). Remova ou reagende os candidatos antes de excluir o slot.');
      return;
    }

    if (!window.confirm('Tem certeza que deseja excluir este slot?')) return;

    setSalvando(true);
    setErro('');
    try {
      await excluirSlotEntrevista(slot.id_slot);
      setSlots((atuais) =>
        atuais.filter((item) => Number(item.id_slot || 0) !== Number(slot.id_slot || 0)),
      );
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Não foi possível excluir o slot.');
    } finally {
      setSalvando(false);
    }
  };

  const apagarEntrevistaAgendada = async (entrevista) => {
    if (!entrevista?.id_entrevista) return;
    if (isProcessClosed(entrevista?.status_processo)) {
      setErro('Processo encerrado. Nao e possivel apagar esta entrevista.');
      return;
    }

    if (!window.confirm('Tem certeza que deseja apagar esta entrevista agendada?')) return;

    setSalvando(true);
    setErro('');
    try {
      await atualizarEntrevista(entrevista.id_entrevista, {
        status_entrevista: 'Cancelado',
        observacoes_rh: entrevista.observacoes_rh || '',
        mensagem_personalizada: entrevista.mensagem_personalizada || '',
      });
      setEntrevistas((atuais) =>
        atuais.filter(
          (item) => Number(item.id_entrevista || 0) !== Number(entrevista.id_entrevista || 0),
        ),
      );
      await carregar();
    } catch (error) {
      setErro(error?.message || 'Nao foi possivel apagar a entrevista agendada.');
    } finally {
      setSalvando(false);
    }
  };

  const abrirEdicao = (entrevista) => {
    if (isProcessClosed(entrevista?.status_processo)) {
      setErro('O processo seletivo desta entrevista está encerrado e não permite atualização operacional.');
      return;
    }

    setEntrevistaEdicao(entrevista);
    setFormularioEdicao({
      id_slot: '',
      status_entrevista: entrevista.status_entrevista || CANDIDATE_STATUS_PENDING_CONFIRMATION,
      observacoes_rh: entrevista.observacoes_rh || '',
      mensagem_personalizada: entrevista.mensagem_personalizada || '',
    });
  };

  const salvar = async () => {
    if (!entrevistaEdicao) return;
    if (isProcessClosed(entrevistaEdicao.status_processo)) {
      setErro('O processo seletivo desta entrevista está encerrado e não permite atualização operacional.');
      return;
    }

    const mensagemErro = validarFormularioEntrevista({
      id_registro: entrevistaEdicao.id_registro,
      ...formularioEdicao,
    });
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }

    setSalvando(true);
    setErro('');

    try {
      const payload = {
        status_entrevista: formularioEdicao.status_entrevista,
        observacoes_rh: formularioEdicao.observacoes_rh,
        mensagem_personalizada: formularioEdicao.mensagem_personalizada,
      };
      if (formularioEdicao.id_slot) {
        payload.id_slot = Number(formularioEdicao.id_slot);
        if (Number(formularioEdicao.id_slot) !== Number(entrevistaEdicao.id_slot || 0)) {
          payload.status_entrevista = 'Reagendado';
        }
      }

      await atualizarEntrevista(entrevistaEdicao.id_entrevista, payload);

      setEntrevistaEdicao(null);
      await carregar();
    } catch (error) {
      setErro(
        error?.message || 'Não foi possível atualizar a entrevista selecionada.',
      );
    } finally {
      setSalvando(false);
    }
  };

  return html`
    <${PainelRh}
      screenId="screen-interviews"
      navAtiva="screen-interviews"
      subtituloMarca="Agenda de entrevistas"
      placeholderBusca="Entrevistas e confirmações"
      controlador=${controlador}
    >
      <${ToastHost} />
      <${PageIntro}
        kicker="Console | Entrevistas"
        title="Calendário de entrevistas"
        actions=${html`
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => carregar()}
          >
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('refresh')}</span>
            Atualizar
          </button>
        `}
      />

      ${erro ? html`<div class="rh-inline-alert">${erro}</div>` : null}

      <div class="interview-dashboard-grid">
        <${SectionCard}
          title="Visão Executiva"
          className="interview-executive-card compact-dashboard-card"
        >
          <div class="interview-stat-grid">
            ${[
              { icon: 'groups', label: 'Entrevistas', value: resumo.total || 0, variant: 'is-blue' },
              { icon: 'event_available', label: 'Slots livres', value: resumo.disponiveis || 0, variant: 'is-blue' },
              { icon: 'hourglass_top', label: 'Pendentes', value: resumo.pendentes || 0, variant: 'is-purple' },
              { icon: 'schedule', label: 'Agendado', value: resumo.agendadas || 0, variant: 'is-blue' },
              { icon: 'sync', label: 'Reagendado', value: resumo.reagendadas || 0, variant: 'is-purple' },
              { icon: 'person_check', label: 'Compareceu', value: resumo.compareceram || 0, variant: 'is-green' },
              { icon: 'person_cancel', label: 'Faltou', value: resumo.faltas || 0, variant: 'is-red' },
            ].map(
              (item) => html`
                <article class=${`interview-stat-card ${item.variant}`} key=${item.label}>
                  <span class="material-symbols-outlined">${IconeSvg(item.icon)}</span>
                  <div>
                    <small>${item.label}</small>
                    <strong>${item.value}</strong>
                  </div>
                </article>
              `,
            )}
          </div>
        </${SectionCard}>
      </div>

      <div class="interview-main-grid">
        <${SectionCard}
          title="Resumo do dia"
          className="interview-day-card compact-dashboard-card"
          actions=${html`
            <button
              type="button"
              class="calendar-arrow-btn"
              aria-label="Dia anterior"
              onClick=${() => selecionarData(moverDataIso(filtros.data, -1))}
            >
              <span class="material-symbols-outlined">${IconeSvg('chevron_left')}</span>
            </button>
            <span class="interview-day-title">${formatarDataLonga(filtros.data)}</span>
            <button
              type="button"
              class="calendar-arrow-btn"
              aria-label="Próximo dia"
              onClick=${() => selecionarData(moverDataIso(filtros.data, 1))}
            >
              <span class="material-symbols-outlined">${IconeSvg('chevron_right')}</span>
            </button>
          `}
        >
          <div class="interview-day-strip">
            ${diasResumo.map(
              (dia) => html`
                <button
                  type="button"
                  key=${dia.iso}
                  class=${`interview-day-pill ${dia.ativo ? 'is-active' : ''}`}
                  onClick=${() => selecionarData(dia.iso)}
                >
                  <span>${dia.semana}</span>
                  <strong>${dia.dia}</strong>
                </button>
              `,
            )}
          </div>

          ${entrevistasDoDia.length
            ? html`
                <div class="interview-day-list">
                  ${entrevistasResumoDia.map(
                    (item) => html`
                      <article class="interview-day-row" key=${item.id_entrevista}>
                        <span class="material-symbols-outlined">${IconeSvg('event_available')}</span>
                        <div>
                          <strong>${item.nome_candidato || '-'}</strong>
                          <small> ${formatarDataHora(item.data_entrevista)}</small>
                        </div>
                        <span class=${`rh-status-pill ${obterClasseStatusEntrevista(item.status_entrevista)}`}>
                          ${item.status_entrevista || '-'}
                        </span>
                      </article>
                    `,
                  )}
                </div>
                ${entrevistasDoDia.length > TAMANHO_RESUMO_DIA_ENTREVISTAS
                  ? html`
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-secondary interview-day-more-btn"
                        onClick=${() => setModalResumoDiaAberto(true)}
                      >
                        Ver mais
                      </button>
                    `
                  : null}
              `
            : html`
                <div class="c24-empty-state c24-empty-state-horizontal">
                  <span class="material-symbols-outlined">${IconeSvg('calendar_clock')}</span>
                  <div>
                    <h3>Nenhuma entrevista registrada hoje</h3>
                    <p>Use os slots ou confirmações para registrar entrevistas.</p>
                  </div>
                </div>
              `}
        </${SectionCard}>

      <${SectionCard}
        title="Criar disponibilidade"
        className="availability-card"
      >
        <div class="availability-form-grid">
          <div class="rh-filter-field">
            <label>Processo</label>
            <select
              class="form-select"
              value=${formularioSlots.id_processo_ref}
              disabled=${salvando}
              onChange=${(event) =>
                setFormularioSlots({
                  ...formularioSlots,
                  id_processo_ref: event.target.value,
                })}
            >
              <option value="">Geral</option>
              ${processosAbertos.map(
                (processo) => html`
                  <option
                    key=${obterChaveProcesso(processo)}
                    value=${obterReferenciaProcesso(processo)}
                  >
                    ${processo.id_processo} | ${processo.vaga}
                  </option>
                `,
              )}
            </select>
          </div>
          <div class="rh-filter-field">
            <label>Data</label>
            <input
              class="form-control"
              type="date"
              value=${formularioSlots.data}
              disabled=${salvando}
              onInput=${(event) =>
                setFormularioSlots({ ...formularioSlots, data: event.target.value })}
            />
          </div>
          <div class="rh-filter-field availability-somente-dia-field">
            <label class="availability-somente-dia">
              <input
                type="checkbox"
                checked=${formularioSlots.somente_dia}
                disabled=${salvando}
                onChange=${(event) =>
                  setFormularioSlots({ ...formularioSlots, somente_dia: event.target.checked })}
              />
              Somente o dia (sem horário definido)
            </label>
          </div>
          ${!formularioSlots.somente_dia
            ? html`
                <div class="rh-filter-field">
                  <label>Início</label>
                  <input
                    class="form-control"
                    type="time"
                    value=${formularioSlots.hora_inicio}
                    disabled=${salvando}
                    onInput=${(event) =>
                      setFormularioSlots({
                        ...formularioSlots,
                        hora_inicio: event.target.value,
                      })}
                  />
                </div>
                <div class="rh-filter-field">
                  <label>Fim</label>
                  <input
                    class="form-control"
                    type="time"
                    value=${formularioSlots.hora_fim}
                    disabled=${salvando}
                    onInput=${(event) =>
                      setFormularioSlots({
                        ...formularioSlots,
                        hora_fim: event.target.value,
                      })}
                  />
                </div>
                <div class="rh-filter-field">
                  <label>Duração (min)</label>
                  <input
                    class="form-control"
                    type="number"
                    min="5"
                    max="240"
                    step="5"
                    value=${formularioSlots.duracao_minutos}
                    disabled=${salvando}
                    onInput=${(event) =>
                      setFormularioSlots({
                        ...formularioSlots,
                        duracao_minutos: Number(event.target.value || 30),
                      })}
                  />
                </div>
              `
            : null}
          <div class="rh-filter-field availability-field-capacidade">
            <label>Capacidade por slot</label>
            <input
              class="form-control"
              type="number"
              min="1"
              step="1"
              value=${formularioSlots.capacidade_total}
              disabled=${salvando}
              onInput=${(event) =>
                setFormularioSlots({
                  ...formularioSlots,
                  capacidade_total: Number(event.target.value || 1),
                })}
            />
          </div>
        </div>
        <div class="availability-submit">
          <button
            type="button"
            class="btn btn-primary rh-action-btn"
            disabled=${salvando}
            onClick=${criarDisponibilidade}
          >
            <span class="material-symbols-outlined">${IconeSvg('calendar_add_on')}</span>
            ${salvando ? 'Salvando...' : 'Gerar slots'}
          </button>
        </div>
      </${SectionCard}>
      </div>

      <${SectionCard}
        title="Filtros"
        className="interview-filter-card"
        tourId="interview-filters"
      >
        <div class="interview-filter-toolbar">
          <div class="rh-filter-field">
            <label>Data</label>
            <input
              class="form-control"
              type="date"
              value=${filtros.data}
              onInput=${(event) => setFiltros({ ...filtros, data: event.target.value })}
            />
          </div>
          <div class="rh-filter-field">
            <label>Processo</label>
            <select
              class="form-select"
              value=${filtros.processo}
              onChange=${(event) =>
                setFiltros({ ...filtros, processo: event.target.value })}
            >
              <option value="">Todos os processos</option>
              ${processos.map(
                (processo) => html`
                  <option
                    key=${obterChaveProcesso(processo)}
                    value=${obterReferenciaProcesso(processo)}
                  >
                    ${processo.id_processo} | ${processo.vaga}
                  </option>
                `,
              )}
            </select>
          </div>
          <div class="rh-filter-field">
            <label>Status</label>
            <select
              class="form-select"
              value=${filtros.status}
              onChange=${(event) =>
                setFiltros({ ...filtros, status: event.target.value })}
            >
              <option value="">Todos</option>
              ${STATUS_ENTREVISTA.map(
                (statusItem) => html`
                  <option key=${statusItem} value=${statusItem}>${statusItem}</option>
                `,
              )}
            </select>
          </div>
          <div class="rh-filter-field interview-search-field">
            <label>Busca</label>
            <input
              class="form-control"
              placeholder="Candidato, vaga, processo, tag..."
              value=${filtros.busca}
              onInput=${(event) =>
                setFiltros({ ...filtros, busca: event.target.value })}
            />
          </div>
          <div class="interview-filter-actions">
            <button
              type="button"
              class="btn btn-primary btn-sm rh-action-btn interview-compact-action"
              title="Aplicar filtros"
              onClick=${() => carregar({ forcar: true })}
            >
              <span class="material-symbols-outlined">${IconeSvg('filter_alt')}</span>
              Aplicar
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm rh-action-btn interview-compact-action"
              title="Limpar filtros"
              onClick=${limparFiltros}
            >
              <span class="material-symbols-outlined">${IconeSvg('refresh')}</span>
              Limpar
            </button>
          </div>
        </div>
      </${SectionCard}>

      <div class="interview-bottom-grid">
        <${SectionCard}
          title="Slots do dia"
          className="interview-slots-card compact-dashboard-card"
        >
          ${carregando
            ? html`
                <${LoadingState}
                  titulo="Carregando horários"
                  descricao="Buscando slots internos da agenda."
                />
              `
            : slots.length
              ? html`
                  <div class="interview-slot-list">
                    ${slotsPaginados.itens.map(
                      (slot) => html`
                        <article class="interview-slot-card c24-fade-in" key=${slot.id_slot}>
                          <div>
                            <strong>${formatarHorarioSlot(slot)}</strong>
                            <span>${slot.id_processo || 'Geral'}</span>
                          </div>
                          <div class="interview-slot-meta">
                            <span>${formatarOcupacaoSlot(slot)}</span>
                            <span>${Number(slot.disponiveis || 0)} disponiveis</span>
                          </div>
                          <span class=${`rh-status-pill ${obterClasseStatusSlot(slot)}`}>
                            ${slot.status_calculado || slot.status_slot || '-'}
                          </span>
                          <small>
                            ${slot.nome_candidato
                              ? `${slot.nome_candidato}${Number(slot.ocupados || 0) > 1 ? ` (+${Number(slot.ocupados || 0) - 1})` : ''}`
                              : 'Nenhum candidato'}
                          </small>
                          <div class="interview-row-actions">
                            <button
                              type="button"
                              class="c24-icon-btn interview-icon-btn"
                              title="Editar slot"
                              aria-label="Editar slot"
                              onClick=${() => abrirEdicaoSlot(slot)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('edit')}</span>
                            </button>
                            <button
                              type="button"
                              class="c24-icon-btn is-danger interview-icon-btn"
                              title="Excluir slot"
                              aria-label="Excluir slot"
                              disabled=${salvando}
                              onClick=${() => excluirSlot(slot)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                            </button>
                          </div>
                        </article>
                      `,
                    )}
                  </div>
                  <${PaginacaoCompacta}
                    paginaAtual=${slotsPaginados.paginaAtual}
                    totalPaginas=${slotsPaginados.totalPaginas}
                    totalItens=${slotsPaginados.totalItens}
                    tamanhoPagina=${TAMANHO_PAGINA_SLOTS_ENTREVISTAS}
                    itensNaPagina=${slotsPaginados.itens.length}
                    onChange=${setPaginaSlots}
                  />
                `
              : html`
                  <div class="c24-empty-state c24-empty-state-horizontal">
                    <span class="material-symbols-outlined">${IconeSvg('calendar_month')}</span>
                    <div>
                      <h3>Nenhum slot para o filtro</h3>
                      <p>Crie disponibilidade para o dia desejado ou ajuste os filtros.</p>
                    </div>
                  </div>
                `}
        </${SectionCard}>

        <${SectionCard}
          title="Agenda operacional"
          className="interview-operation-card compact-dashboard-card"
          tourId="interview-agenda"
        >
          ${carregando
            ? html`
                <${LoadingState}
                  titulo="Carregando entrevistas"
                  descricao="Buscando agenda, status e candidatos associados."
                />
              `
            : entrevistas.length
              ? html`
                  <div class="interview-operation-list">
                    ${entrevistasPaginadas.itens.map(
                      (item) => html`
                        <article class="interview-operation-row c24-fade-in" key=${item.id_entrevista}>
                          <div>
                            <strong>${item.nome_candidato || '-'}</strong>
                            <span>${item.vaga || item.id_processo || '-'}</span>
                            ${item.tags?.length
                              ? html`
                                  <div class="rh-chip-wrap mt-2">
                                    ${item.tags.slice(0, 3).map(
                                      (tag) => html`
                                        <span key=${tag} class="rh-chip">${tag}</span>
                                      `,
                                    )}
                                  </div>
                                `
                              : null}
                          </div>
                          <div>
                            <span>${formatarDataHora(item.data_entrevista)}</span>
                            <small>${item.id_slot ? 'Calendário interno' : 'Registro legado'}</small>
                          </div>
                          <span class=${`rh-status-pill ${obterClasseStatusEntrevista(item.status_entrevista)}`}>
                            ${item.status_entrevista || '-'}
                          </span>
                          <p>${item.observacoes_rh || 'Sem observações.'}</p>
                          <div class="interview-row-actions">
                            <button
                              type="button"
                              class="c24-icon-btn interview-icon-btn"
                              title="Copiar mensagem"
                              aria-label="Copiar mensagem"
                              onClick=${() =>
                                copiarTexto(item.mensagem_base || '')
                                  .then(() =>
                                    showToast('Mensagem copiada para a área de transferência.', 'success'),
                                  )
                                  .catch(() =>
                                    showToast('Não foi possível copiar a mensagem automaticamente.', 'error'),
                                  )}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('content_copy')}</span>
                            </button>
                            <button
                              type="button"
                              class="c24-icon-btn interview-icon-btn"
                              title=${isProcessClosed(item.status_processo)
                                ? 'Processo encerrado'
                                : 'Editar entrevista'}
                              aria-label=${isProcessClosed(item.status_processo)
                                ? 'Processo encerrado'
                                : 'Editar entrevista'}
                              disabled=${isProcessClosed(item.status_processo)}
                              onClick=${() => abrirEdicao(item)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('edit_calendar')}</span>
                            </button>
                            <button
                              type="button"
                              class="c24-icon-btn is-danger interview-icon-btn"
                              title=${isProcessClosed(item.status_processo)
                                ? 'Processo encerrado'
                                : 'Apagar entrevista agendada'}
                              aria-label=${isProcessClosed(item.status_processo)
                                ? 'Processo encerrado'
                                : 'Apagar entrevista agendada'}
                              disabled=${salvando || isProcessClosed(item.status_processo)}
                              onClick=${() => apagarEntrevistaAgendada(item)}
                            >
                              <span class="material-symbols-outlined">${IconeSvg('delete')}</span>
                            </button>
                          </div>
                        </article>
                      `,
                    )}
                  </div>
                  <${PaginacaoCompacta}
                    paginaAtual=${entrevistasPaginadas.paginaAtual}
                    totalPaginas=${entrevistasPaginadas.totalPaginas}
                    totalItens=${entrevistasPaginadas.totalItens}
                    tamanhoPagina=${TAMANHO_PAGINA_AGENDA_ENTREVISTAS}
                    itensNaPagina=${entrevistasPaginadas.itens.length}
                    onChange=${setPaginaAgenda}
                  />
                `
              : html`
                  <div class="c24-empty-state c24-empty-state-horizontal">
                    <span class="material-symbols-outlined">${IconeSvg('assignment')}</span>
                    <div>
                      <h3>Nenhuma entrevista encontrada</h3>
                      <p>Agende entrevistas a partir do detalhe do processo para acompanhar a jornada por aqui.</p>
                    </div>
                  </div>
                `}
        </${SectionCard}>
      </div>

      <${ModalEdicaoEntrevista}
        aberto=${!!entrevistaEdicao}
        entrevista=${entrevistaEdicao}
        formulario=${formularioEdicao}
        slotsDisponiveis=${slotsDisponiveis}
        salvando=${salvando}
        onClose=${() => setEntrevistaEdicao(null)}
        onChange=${setFormularioEdicao}
        onSave=${salvar}
      />

      <${ModalPadrao}
        aberto=${modalResumoDiaAberto}
        titulo=${`Agendamentos de ${formatarDataCurtaLocal(filtros.data)}`}
        subtitulo="Todos os agendamentos registrados para o dia selecionado."
        className="interview-day-modal-dialog"
        onClose=${() => setModalResumoDiaAberto(false)}
      >
        <div class="interview-day-modal-list">
          ${entrevistasDoDia.map(
            (item) => html`
              <article class="interview-day-modal-row" key=${item.id_entrevista}>
                <div>
                  <span>Horário</span>
                  <strong>${formatarDataHora(item.data_entrevista)}</strong>
                </div>
                <div>
                  <span>Candidato</span>
                  <strong>${item.nome_candidato || '-'}</strong>
                </div>
                <div>
                  <span>Processo/vaga</span>
                  <strong>${item.vaga || item.id_processo || '-'}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>${item.status_entrevista || '-'}</strong>
                </div>
                <div>
                  <span>Responsável/observação</span>
                  <strong>${obterResponsavelEntrevista(item) || '-'}</strong>
                </div>
              </article>
            `,
          )}
        </div>
        <footer class="rh-modal-footer">
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick=${() => setModalResumoDiaAberto(false)}
          >
            Fechar
          </button>
        </footer>
      </${ModalPadrao}>

      <${ModalPadrao}
        aberto=${!!slotEdicao}
        titulo="Editar slot"
        subtitulo="Altere capacidade, status operacional e observações do horário."
        onClose=${() => setSlotEdicao(null)}
      >
        ${slotEdicao
          ? html`
              <div class="rh-details-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">Horário</label>
                    <input class="form-control" readonly value=${formatarHorarioSlot(slotEdicao)} />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Ocupados</label>
                    <input class="form-control" readonly value=${Number(slotEdicao.ocupados || 0)} />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Capacidade</label>
                    <input
                      class="form-control"
                      type="number"
                      min=${Math.max(1, Number(slotEdicao.ocupados || 0))}
                      step="1"
                      value=${formularioSlotEdicao.capacidade_total}
                      onInput=${(event) =>
                        setFormularioSlotEdicao({
                          ...formularioSlotEdicao,
                          capacidade_total: Number(event.target.value || 1),
                        })}
                    />
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Status</label>
                    <select
                      class="form-select"
                      value=${formularioSlotEdicao.status_slot}
                      onChange=${(event) =>
                        setFormularioSlotEdicao({
                          ...formularioSlotEdicao,
                          status_slot: event.target.value,
                        })}
                    >
                      <option value=${STATUS_SLOT_DISPONIVEL}>Disponível</option>
                      <option value=${STATUS_SLOT_BLOQUEADO}>Bloqueado</option>
                    </select>
                  </div>
                  <div class="col-md-12">
                    <label class="form-label">Observações</label>
                    <textarea
                      class="form-control"
                      rows="4"
                      value=${formularioSlotEdicao.observacoes_rh}
                      onInput=${(event) =>
                        setFormularioSlotEdicao({
                          ...formularioSlotEdicao,
                          observacoes_rh: event.target.value,
                        })}
                    ></textarea>
                  </div>
                </div>
              </div>
              <footer class="rh-modal-footer">
                <button type="button" class="btn btn-outline-secondary" onClick=${() => setSlotEdicao(null)}>
                  Cancelar
                </button>
                <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${salvarSlot}>
                  ${salvando ? 'Salvando...' : 'Salvar slot'}
                </button>
              </footer>
            `
          : null}
      </${ModalPadrao}>
    </${PainelRh}>
  `;
}
