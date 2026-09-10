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

// As 3 primeiras etapas de PIPELINE_STAGES (backend) são progressivas —
// um candidato passa por elas em sequência, por isso fazem sentido como
// funil. Aprovado/Reprovado são desfechos finais e mutuamente exclusivos,
// não mais uma etapa do funil (ver design/wireframes/README.md, seção 3:
// tratá-los como "mais uma etapa que encolhe" sugeriria uma queda que não
// existe nos dados — os dois são resultados paralelos, não sequenciais).
const ETAPAS_PROGRESSO = ['Triagem', 'Prova', 'Entrevista'];
const CORES_SEQUENCIAIS = [
  'var(--color-chart-sequential-1)',
  'var(--color-chart-sequential-2)',
  'var(--color-chart-sequential-3)',
  'var(--color-chart-sequential-4)',
  'var(--color-chart-sequential-5)',
  'var(--color-chart-sequential-6)',
];

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

function EtapaFunilBarra({ label, total, percentual, larguraRelativa, cor }) {
  const largura = Math.max(8, Math.min(100, Number(larguraRelativa) || 0));
  return html`
    <div class="funnel-chart-step">
      <div class="funnel-chart-head">
        <span class="funnel-chart-label">${label}</span>
        <span class="funnel-chart-count">${numeroInteiro(total)} · ${formatarPercentual(percentual)}</span>
      </div>
      <div class="funnel-chart-bar" style=${{ width: `${largura}%`, background: cor }}></div>
    </div>
  `;
}

function BarraOrigem({ origem, total, percentual, cor }) {
  const largura = Math.max(6, Math.min(100, Number(percentual) || 0));
  return html`
    <div class="funnel-origin-row">
      <span class="funnel-origin-label" title=${origem}>${origem}</span>
      <div class="funnel-origin-track">
        <span class="funnel-origin-fill num" style=${{ width: `${largura}%`, background: cor }}>
          ${numeroInteiro(total)}
        </span>
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

  const etapasProgresso = useMemo(
    () => funilEtapas.filter((etapa) => ETAPAS_PROGRESSO.includes(etapa.etapa)),
    [funilEtapas],
  );
  const etapasDesfecho = useMemo(
    () => funilEtapas.filter((etapa) => !ETAPAS_PROGRESSO.includes(etapa.etapa)),
    [funilEtapas],
  );
  const maiorVolumeProgresso = Math.max(
    1,
    ...etapasProgresso.map((etapa) => Number(etapa.percentual_conversao) || 0),
  );
  const aprovado = etapasDesfecho.find((etapa) => etapa.etapa === 'Aprovado');
  const reprovado = etapasDesfecho.find((etapa) => etapa.etapa === 'Reprovado');

  const metricasSecundarias = [
    {
      label: 'Candidatos no recorte',
      value: numeroInteiro(totalCandidatos),
      icon: 'groups',
      variant: 'rh-metric-card--is-neutral',
    },
    {
      label: 'Aprovados considerados',
      value: numeroInteiro(dados?.total_aprovados_considerados || 0),
      icon: 'verified',
      variant: 'rh-metric-card--is-positive',
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

      <div class="funnel-filter-bar">
        <div class="funnel-filter-field">
          <label>Data inicial</label>
          <input
            class="form-control"
            type="date"
            value=${filtros.dataInicial}
            onInput=${(event) => atualizarFiltro('dataInicial', event.target.value)}
          />
        </div>
        <div class="funnel-filter-field">
          <label>Data final</label>
          <input
            class="form-control"
            type="date"
            value=${filtros.dataFinal}
            onInput=${(event) => atualizarFiltro('dataFinal', event.target.value)}
          />
        </div>
        <div class="funnel-filter-field">
          <label>Processo (ID)</label>
          <input
            class="form-control"
            placeholder="Ex.: P-2026-014"
            value=${filtros.processo}
            onInput=${(event) => atualizarFiltro('processo', event.target.value)}
          />
        </div>
        <div class="funnel-filter-actions">
          <button type="button" class="btn btn-primary" disabled=${carregando} onClick=${aplicarFiltros}>
            <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('filter_alt')}</span>
            Aplicar filtros
          </button>
          <button type="button" class="btn btn-outline-secondary" disabled=${carregando} onClick=${limparFiltros}>
            Limpar
          </button>
        </div>
      </div>

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

          <${SectionCard}
            title="Funil de conversão"
            description="Inscritos até aprovados, em cada etapa que ainda está em andamento. Aprovado e Reprovado são desfechos finais, mostrados à parte."
          >
            ${totalCandidatos
        ? html`
                  <div class="funnel-chart">
                    ${etapasProgresso.map(
          (etapa, indice) => html`
                        <${EtapaFunilBarra}
                          key=${etapa.etapa}
                          label=${etapa.etapa}
                          total=${etapa.total}
                          percentual=${etapa.percentual_conversao}
                          larguraRelativa=${(Number(etapa.percentual_conversao) / maiorVolumeProgresso) * 100}
                          cor=${CORES_SEQUENCIAIS[indice] || CORES_SEQUENCIAIS[0]}
                        />
                      `,
        )}
                  </div>
                  <div class="funnel-outcomes">
                    <div class="funnel-outcome-card is-aprovado">
                      <span class="funnel-outcome-label">Aprovados</span>
                      <span class="funnel-outcome-value num">${numeroInteiro(aprovado?.total || 0)}</span>
                      <span class="funnel-outcome-share">${formatarPercentual(aprovado?.percentual_conversao)} do recorte</span>
                    </div>
                    <div class="funnel-outcome-card is-reprovado">
                      <span class="funnel-outcome-label">Reprovados</span>
                      <span class="funnel-outcome-value num">${numeroInteiro(reprovado?.total || 0)}</span>
                      <span class="funnel-outcome-share">${formatarPercentual(reprovado?.percentual_conversao)} do recorte</span>
                    </div>
                  </div>
                `
        : html`<${EmptyState} title="Nenhum candidato no recorte" text="Ajuste os filtros de período ou processo para visualizar o funil." />`}
          </${SectionCard}>

          <${SectionCard} title="Origem dos candidatos" description="Ranking por volume — cor sequencial indica posição, não categoria.">
            ${origemCandidatos.length
        ? html`<div class="funnel-origin-list">${origemCandidatos.map(
          (item, indice) => html`
                  <${BarraOrigem}
                    key=${item.origem}
                    origem=${item.origem}
                    total=${item.total}
                    percentual=${item.percentual}
                    cor=${CORES_SEQUENCIAIS[Math.min(indice, CORES_SEQUENCIAIS.length - 1)]}
                  />
                `,
        )}</div>`
        : html`<${EmptyState} title="Nenhuma origem registrada" text="Ajuste os filtros de período ou processo para visualizar a origem dos candidatos." />`}
          </${SectionCard}>
        `}
    </${PainelRh}>
  `;
}
