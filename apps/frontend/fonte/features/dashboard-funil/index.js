import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { lerFunilDashboard } from '../../servico-api.js';
import {
  EmptyState,
  LoadingState,
  MetricGrid,
  PageIntro,
  PainelRh,
  SectionCard,
} from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';

const FILTROS_INICIAIS = { dataInicial: '', dataFinal: '', processo: '' };

function numeroInteiro(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR') : '0';
}

function formatarDias(value) {
  if (value === null || value === undefined) return '–';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '–';
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatarPercentual(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0%';
  return `${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function BarraFunil({ label, total, percentual }) {
  const largura = Math.max(0, Math.min(100, Number(percentual) || 0));
  return html`
    <div class="funnel-stage-row">
      <div class="funnel-stage-label">
        <span>${label}</span>
        <span class="funnel-stage-count">${numeroInteiro(total)} · ${formatarPercentual(percentual)}</span>
      </div>
      <div class="funnel-stage-track">
        <span class="funnel-stage-fill" style=${{ width: `${largura}%` }}></span>
      </div>
    </div>
  `;
}

function BarraOrigem({ origem, total, percentual }) {
  const largura = Math.max(0, Math.min(100, Number(percentual) || 0));
  return html`
    <div class="funnel-origin-row">
      <div class="funnel-origin-label">
        <span>${origem}</span>
        <span class="funnel-origin-count">${numeroInteiro(total)} · ${formatarPercentual(percentual)}</span>
      </div>
      <div class="funnel-origin-track">
        <span class="funnel-origin-fill" style=${{ width: `${largura}%` }}></span>
      </div>
    </div>
  `;
}

export function TelaDashboardFunil({ controlador }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [filtrosAplicados, setFiltrosAplicados] = useState(FILTROS_INICIAIS);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = async (filtrosAtuais) => {
    setCarregando(true);
    setErro('');
    try {
      const resultado = await lerFunilDashboard(filtrosAtuais);
      setDados(resultado);
    } catch (error) {
      setErro(error?.message || 'Não foi possível carregar o dashboard de funil.');
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar(filtrosAplicados);
  }, [filtrosAplicados]);

  const atualizarFiltro = (campo, valor) => {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  };

  const aplicarFiltros = () => {
    setFiltrosAplicados({ ...filtros });
  };

  const limparFiltros = () => {
    setFiltros(FILTROS_INICIAIS);
    setFiltrosAplicados(FILTROS_INICIAIS);
  };

  const totalCandidatos = dados?.total_candidatos || 0;
  const funilEtapas = dados?.funil_etapas || [];
  const origemCandidatos = useMemo(() => {
    const lista = dados?.origem_candidatos || [];
    return lista.map((item) => ({
      ...item,
      percentual: totalCandidatos ? (Number(item.total) / totalCandidatos) * 100 : 0,
    }));
  }, [dados, totalCandidatos]);

  const metricasSecundarias = [
    { label: 'Candidatos no recorte', value: numeroInteiro(totalCandidatos), icon: 'groups' },
    {
      label: 'Aprovados considerados',
      value: numeroInteiro(dados?.total_aprovados_considerados || 0),
      icon: 'verified',
      variant: 'is-approved',
    },
  ];

  return html`
    <${PainelRh}
      screenId="screen-dashboard-funil"
      navAtiva="screen-dashboard-funil"
      subtituloMarca="Dashboard de funil"
      placeholderBusca="Dashboard de funil"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Relatórios"
        title="Dashboard de funil e métricas"
      />

      ${erro ? html`<div class="alert alert-warning">${erro}</div>` : null}

      <${SectionCard} title="Filtros" className="funnel-dashboard-filter-panel">
        <div class="rh-filter-grid rh-filter-grid--wide">
          <div class="rh-filter-field">
            <label>Data inicial</label>
            <input
              class="form-control"
              type="date"
              value=${filtros.dataInicial}
              onInput=${(event) => atualizarFiltro('dataInicial', event.target.value)}
            />
          </div>
          <div class="rh-filter-field">
            <label>Data final</label>
            <input
              class="form-control"
              type="date"
              value=${filtros.dataFinal}
              onInput=${(event) => atualizarFiltro('dataFinal', event.target.value)}
            />
          </div>
          <div class="rh-filter-field">
            <label>Processo (ID)</label>
            <input
              class="form-control"
              placeholder="Ex.: P-2026-014"
              value=${filtros.processo}
              onInput=${(event) => atualizarFiltro('processo', event.target.value)}
            />
          </div>
          <div class="rh-filter-field funnel-dashboard-filter-actions">
            <button type="button" class="btn btn-primary" disabled=${carregando} onClick=${aplicarFiltros}>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('filter_alt')}</span>
              Aplicar filtros
            </button>
            <button type="button" class="btn btn-outline-secondary" disabled=${carregando} onClick=${limparFiltros}>
              Limpar
            </button>
          </div>
        </div>
      </${SectionCard}>

      ${carregando
      ? html`<${LoadingState} titulo="Carregando dashboard" descricao="Calculando funil, origem e time-to-hire do período selecionado." />`
      : html`
          <div class="funnel-dashboard-hero-grid">
            <section class="funnel-dashboard-hero funnel-dashboard-hero--principal">
              <div class="funnel-dashboard-hero-label">
                <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('flag')}</span>
                <span>Tempo de preenchimento de vaga</span>
              </div>
              <div class="funnel-dashboard-hero-value">
                ${dados?.time_to_fill_medio_dias === null || dados?.time_to_fill_medio_dias === undefined
        ? html`<span class="funnel-dashboard-hero-empty">Sem dados suficientes</span>`
        : html`<strong>${formatarDias(dados.time_to_fill_medio_dias)}</strong><span>dias</span>`}
              </div>
              <p class="funnel-dashboard-hero-helper">
                Média entre a abertura da vaga e a aprovação do candidato que completou a cota, considerando apenas
                processos com todas as vagas preenchidas no recorte filtrado.
              </p>
            </section>

            <section class="funnel-dashboard-hero">
              <div class="funnel-dashboard-hero-label">
                <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('schedule')}</span>
                <span>Time-to-hire médio</span>
              </div>
              <div class="funnel-dashboard-hero-value">
                ${dados?.time_to_hire_medio_dias === null || dados?.time_to_hire_medio_dias === undefined
        ? html`<span class="funnel-dashboard-hero-empty">Sem dados suficientes</span>`
        : html`<strong>${formatarDias(dados.time_to_hire_medio_dias)}</strong><span>dias</span>`}
              </div>
              <p class="funnel-dashboard-hero-helper">
                Média entre a entrada do candidato no processo e a aprovação final, considerando apenas candidatos
                aprovados no recorte filtrado.
              </p>
            </section>
          </div>

          <${MetricGrid} items=${metricasSecundarias} />

          <${SectionCard} title="Funil por etapa">
            ${totalCandidatos
        ? html`<div class="funnel-stage-list">${funilEtapas.map(
          (etapa) => html`
                  <${BarraFunil}
                    key=${etapa.etapa}
                    label=${etapa.etapa}
                    total=${etapa.total}
                    percentual=${etapa.percentual_conversao}
                  />
                `,
        )}</div>`
        : html`<${EmptyState} title="Nenhum candidato no recorte" text="Ajuste os filtros de período ou processo para visualizar o funil." />`}
          </${SectionCard}>

          <${SectionCard} title="Origem dos candidatos">
            ${origemCandidatos.length
        ? html`<div class="funnel-origin-list">${origemCandidatos.map(
          (item) => html`
                  <${BarraOrigem}
                    key=${item.origem}
                    origem=${item.origem}
                    total=${item.total}
                    percentual=${item.percentual}
                  />
                `,
        )}</div>`
        : html`<${EmptyState} title="Nenhuma origem registrada" text="Ajuste os filtros de período ou processo para visualizar a origem dos candidatos." />`}
          </${SectionCard}>
        `}
    </${PainelRh}>
  `;
}
