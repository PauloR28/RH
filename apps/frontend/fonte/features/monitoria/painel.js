import { html, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, SectionCard } from '../../ui/componentes-compartilhados.js';
import { BarComparisonChart, LineTrendChart, ScoreRadarChart } from '../../ui/components/charts.js';
import { lerDashboard } from '../../services/api/monitoria.js';
import { SelectOperacao, TagOperacao, formatarNota } from './comum.js';

// Dashboard (4 modos: Geral, Equipe, Período, Operador). Tudo vem do servidor —
// o motor único de indicadores (o mesmo dos relatórios e exportações).

const MODOS = [
  ['geral', 'Geral'],
  ['equipe', 'Por equipe'],
  ['periodo', 'Por período'],
  ['operador', 'Por operador'],
];

function Kpi({ rotulo, valor, detalhe, alerta = false }) {
  return html`<div class=${`mon-kpi ${alerta ? 'is-alerta' : ''}`}><span>${rotulo}</span><strong>${valor}</strong>${detalhe ? html`<small>${detalhe}</small>` : null}</div>`;
}

function EscalaOperador({ escala }) {
  const faixas = [...(escala?.faixas || [])].sort((a, b) => a.min - b.min);
  const nota = escala?.nota_operador;
  return html`
    <${SectionCard} title="Sua nota na escala de qualidade">
      <div class="mon-escala" role="img" aria-label=${`Sua nota: ${formatarNota(nota)}`}>
        ${faixas.map((f) => html`<div key=${f.label} class="mon-escala-faixa" title=${`${f.label}: ${f.min}–${Math.min(100, Math.ceil(f.max))}`}
          style=${{ width: `${Math.max(1, Math.ceil(f.max) - f.min + (f.max >= 99 ? 1 : 0))}%`, background: f.cor, opacity: 0.85 }}></div>`)}
        ${nota !== null && nota !== undefined ? html`<div class="mon-escala-marcador" style=${{ left: `${Math.max(0, Math.min(100, nota))}%` }}></div>` : null}
      </div>
      <div class="mon-escala-legenda">${faixas.map((f) => html`<span key=${f.label}><i class="mon-cor-amostra" style=${{ background: f.cor, width: '12px', height: '12px' }}></i> ${f.label} (${f.min}+)</span>`)}</div>
      <p class="mon-muted">Sua nota média: <strong>${formatarNota(nota)}</strong>${escala?.faixa_operador ? ` — ${escala.faixa_operador.label}` : ''} · Média da operação: <strong>${formatarNota(escala?.media_operacao)}</strong></p>
    </${SectionCard}>`;
}

export function TelaDashboard({ controlador, contexto, showToast }) {
  const perfil = controlador?.estado?.perfilUsuario;
  const [filtros, setFiltros] = useState({ modo: 'geral', top: 5, granularidade: 'mes', operacao: '', id_equipe: '', id_operador: '', data_inicio: '', data_fim: '' });
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [opcoesOperador, setOpcoesOperador] = useState([]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    lerDashboard(filtros)
      .then((r) => { if (!ativo) return; setD(r); setErro(''); if (!filtros.id_operador) setOpcoesOperador((r.por_operador || []).map((o) => ({ chave: o.chave, rotulo: o.rotulo }))); })
      .catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar o dashboard.'))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [filtros]);

  const campo = (k, v) => setFiltros((f) => ({ ...f, [k]: v }));
  const r = d?.resumo;
  const ehOperador = perfil === 'operador';

  const pontosEvolucao = (d?.evolucao || []).map((e) => ({ label: e.periodo.slice(filtros.granularidade === 'mes' ? 0 : 5), value: e.nota_media, extra: `${e.quantidade} monitoria(s)` }));
  const eixosPilar = ['conhecimento', 'encantamento'].flatMap((t) => Object.keys(r?.pilares?.[t]?.indicadores || {}).map((k) => ({ key: `${t}:${k}`, label: k })));
  const valoresPilar = Object.fromEntries(['conhecimento', 'encantamento'].flatMap((t) => Object.entries(r?.pilares?.[t]?.indicadores || {}).map(([k, v]) => [`${t}:${k}`, (v || 0) * 10])));

  const comparativo = filtros.modo === 'equipe' ? d?.por_equipe : filtros.modo === 'operador' ? d?.por_operador : d?.por_operacao;
  const rotuloComparativo = filtros.modo === 'equipe' ? 'Equipe' : filtros.modo === 'operador' ? 'Operador' : 'Operação';

  return html`
    <div class="mon-shell">
      <div class="mon-acoes">${MODOS.filter(([k]) => !ehOperador || k === 'geral' || k === 'periodo').map(([k, rot]) => html`<button key=${k} type="button" class=${`mon-subnav-btn ${filtros.modo === k ? 'is-active' : ''}`} onClick=${() => campo('modo', k)}>${rot}</button>`)}</div>

      <div class="mon-filtros">
        ${(contexto?.operacoes || []).length > 1 ? html`<label>Operação<${SelectOperacao} contexto=${contexto} valor=${filtros.operacao} onChange=${(v) => campo('operacao', v)} /></label>` : null}
        <label>Período inicial<input class="form-control" type="date" value=${filtros.data_inicio} onInput=${(e) => campo('data_inicio', e.target.value)} /></label>
        <label>Período final<input class="form-control" type="date" value=${filtros.data_fim} onInput=${(e) => campo('data_fim', e.target.value)} /></label>
        ${filtros.modo === 'periodo' ? html`<label>Agrupar por<select class="form-select" value=${filtros.granularidade} onChange=${(e) => campo('granularidade', e.target.value)}><option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option></select></label>` : null}
        ${!ehOperador && filtros.modo === 'operador' ? html`<label>Operador<select class="form-select" value=${filtros.id_operador} onChange=${(e) => campo('id_operador', e.target.value)}><option value="">Todos</option>${opcoesOperador.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.rotulo}</option>`)}</select></label>` : null}
        ${!ehOperador ? html`<label>Top<select class="form-select" value=${filtros.top} onChange=${(e) => campo('top', Number(e.target.value))}>${[3, 5, 10, 15].map((n) => html`<option key=${n} value=${n}>Top ${n}</option>`)}</select></label>` : null}
      </div>

      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      ${carregando && !d ? html`<${LoadingState} titulo="Carregando indicadores" />` : !r ? null : html`
        ${r.quantidade_realizadas === 0 ? html`<${EmptyState} icon="analytics" title="Sem monitorias no período" text="Ajuste os filtros para ver os indicadores." />` : html`
        <div class="mon-kpis">
          <${Kpi} rotulo="Nota média (válidas)" valor=${formatarNota(r.nota_media)} detalhe=${r.faixa?.label || ''} />
          <${Kpi} rotulo="Monitorias realizadas" valor=${r.quantidade_realizadas} detalhe=${`${r.quantidade_validas} válidas · ${r.quantidade_anuladas} anuladas`} />
          <${Kpi} rotulo="NCG" valor=${r.ncg} detalhe=${`${formatarNota(r.monitorias_ncg_pct)}% das monitorias`} alerta=${r.ncg > 0} />
          <${Kpi} rotulo="Melhor nota" valor=${formatarNota(r.melhor_nota)} />
          ${!ehOperador ? html`<${Kpi} rotulo="Operadores avaliados" valor=${r.operadores_avaliados} />` : null}
          <${Kpi} rotulo="Pilar de Conhecimento" valor=${formatarNota(r.pilares.conhecimento.media)} detalhe="escala 1–10" />
          <${Kpi} rotulo="Pilar de Encantamento" valor=${formatarNota(r.pilares.encantamento.media)} detalhe="escala 1–10" />
        </div>
        <div class="mon-kpis">
          <${Kpi} rotulo="Feedbacks pendentes" valor=${r.pendencias.feedbacks_pendentes} alerta=${r.pendencias.feedbacks_vencidos > 0} detalhe=${r.pendencias.feedbacks_vencidos ? `${r.pendencias.feedbacks_vencidos} vencido(s)` : ''} />
          <${Kpi} rotulo="Feedbacks aplicados" valor=${r.pendencias.feedbacks_aplicados} />
          <${Kpi} rotulo="Confirmações e contestações pendentes" valor=${r.pendencias.confirmacoes_e_contestacoes_pendentes} />
          <${Kpi} rotulo="Reanálises pendentes (manter ou anular)" valor=${r.pendencias.baixas_ou_confirmacoes_pendentes} />
        </div>

        ${ehOperador ? html`<${EscalaOperador} escala=${d.escala} />` : null}
        ${perfil === 'supervisor' && d.visao_operacao ? html`
          <${SectionCard} title="Visão geral da operação (consolidada)">
            <div class="mon-kpis">
              <${Kpi} rotulo="Nota média da operação" valor=${formatarNota(d.visao_operacao.nota_media)} />
              <${Kpi} rotulo="Monitorias da operação" valor=${d.visao_operacao.quantidade_realizadas} />
              <${Kpi} rotulo="NCG na operação" valor=${d.visao_operacao.ncg} />
            </div>
            <p class="mon-muted">Você vê o detalhe apenas da(s) sua(s) equipe(s); os números acima consolidam toda a operação.</p>
          </${SectionCard}>` : null}

        <div class="mon-grid-2">
          <div class="mon-card"><h3>Evolução da nota</h3><${LineTrendChart} points=${pontosEvolucao} valueFormatter=${(v) => formatarNota(v)} /></div>
          <div class="mon-card"><h3>Pilares (indicadores, escala 1–10)</h3>
            ${eixosPilar.length >= 3 ? html`<${ScoreRadarChart} axes=${eixosPilar} series=${[{ name: 'Média', values: valoresPilar }]} size=${200} />` : html`<p class="rh-chart-empty">Sem dados de pilares.</p>`}</div>
          <div class="mon-card"><h3>Desempenho por bloco (% de acerto)</h3>
            <${BarComparisonChart} items=${(d.desempenho_blocos || []).map((b) => ({ label: b.bloco, value: b.percentual_medio || 0 }))} valueFormatter=${(v) => `${formatarNota(v)}%`} /></div>
          ${!ehOperador && (d.por_operador || []).length ? html`<div class="mon-card"><h3>Nota média por operador</h3>
            <${BarComparisonChart} items=${d.por_operador.filter((o) => o.nota_media !== null).slice(0, 15).map((o) => ({ label: o.rotulo, value: o.nota_media }))} valueFormatter=${(v) => formatarNota(v)} /></div>` : null}
          <div class="mon-card"><h3>Distribuição por faixa de nota</h3>
            <${BarComparisonChart} items=${(r.distribuicao_faixas || []).map((f) => ({ label: f.label, value: f.quantidade, color: f.cor }))} valueFormatter=${(v) => v} /></div>
        </div>

        <div class="mon-grid-2">
          <div class="mon-card"><h3>Critérios com maior índice de erro</h3>
            ${(d.criterios_erro || []).length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>Critério</th><th class="num">NÃO</th><th class="num">% erro</th><th class="num">NCG</th></tr></thead><tbody>
              ${d.criterios_erro.map((c) => html`<tr key=${c.id_criterio}><td>${c.pergunta}<br /><small class="mon-muted">${c.bloco}</small></td><td class="num">${c.nao}/${c.avaliados}</td><td class="num"><strong>${formatarNota(c.pct_erro)}%</strong></td><td class="num">${c.ncg}</td></tr>`)}</tbody></table></div>` : html`<p class="mon-muted">Nenhum erro registrado no período.</p>`}
            <p class="mon-muted">N/A não é erro e sai do denominador; NÃO e NCG são contados separadamente.</p></div>
          ${!ehOperador ? html`<div class="mon-card"><h3>Top ${d.top_n} — nota média</h3>
            ${(d.top || []).length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>#</th><th>Operador</th><th class="num">Nota média</th><th class="num">Monitorias</th></tr></thead><tbody>
              ${d.top.map((t) => html`<tr key=${t.id_operador}><td>${t.posicao}</td><td>${t.operador_nome} <${TagOperacao} chave=${t.operacao} contexto=${contexto} /></td><td class="num"><strong>${formatarNota(t.nota_media)}</strong></td><td class="num">${t.quantidade_validas}</td></tr>`)}</tbody></table></div>` : html`<p class="mon-muted">Sem monitorias válidas.</p>`}
            <p class="mon-muted">Desempate: mais monitorias válidas, depois ordem alfabética.</p></div>` : null}
        </div>

        ${!ehOperador && comparativo?.length ? html`
          <${SectionCard} title=${`Comparativo por ${rotuloComparativo.toLowerCase()}`}>
            <div class="mon-tabela-wrap"><table class="mon-tabela"><thead><tr><th>${rotuloComparativo}</th><th class="num">Realizadas</th><th class="num">Válidas</th><th class="num">Nota média</th><th class="num">NCG</th><th class="num">Conhecimento</th><th class="num">Encantamento</th></tr></thead><tbody>
              ${comparativo.map((c) => html`<tr key=${String(c.chave)}><td>${filtros.modo === 'geral' || filtros.modo === 'periodo' ? html`<${TagOperacao} chave=${c.chave} nome=${c.rotulo} contexto=${contexto} />` : c.rotulo}</td><td class="num">${c.quantidade_realizadas}</td><td class="num">${c.quantidade_validas}</td><td class="num"><strong>${formatarNota(c.nota_media)}</strong></td><td class="num">${c.ncg}</td><td class="num">${formatarNota(c.pilar_conhecimento)}</td><td class="num">${formatarNota(c.pilar_encantamento)}</td></tr>`)}
            </tbody></table></div>
          </${SectionCard}>` : null}
        `}`}
    </div>`;
}
