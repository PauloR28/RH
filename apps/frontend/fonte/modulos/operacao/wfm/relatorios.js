import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import { exportarRelatorioWfm, lerRelatorioWfm } from '../../../services/api/wfm.js';
import { baixarArquivo } from '../../../features/monitoria/comum.js';
import { CartaoGrafico, GraficoBarrasH, GraficoColunas, GraficoEmpilhada, GraficoRosca, GraficoSerieDiaria, fmt } from './graficos.js';

// Relatórios do WFM (Supervisor, Control Desk, Gestor, Analista de TI). Seis visões sobre um período de UMA escala:
// Painel (indicadores com comparação ao período anterior + gráficos), Resumo por operador, Escalas, Presenças, Trocas e Aprovações.
// O servidor aplica o escopo (Supervisor = equipe) e calcula tudo com a última versão publicada de cada mês; a tela só
// filtra, ordena, pagina, mostra e exporta. "Como é calculado" fica sempre à mão para justificar cada número.

const VISOES = [
  { id: 'painel', rotulo: 'Painel', icone: 'monitoring', dica: 'Indicadores, comparações e gráficos do período' },
  { id: 'resumo', rotulo: 'Resumo', icone: 'table_chart', dica: 'Horas, presença e faltas por operador (clique numa linha para ver o detalhe)', totais: true },
  { id: 'escalas', rotulo: 'Escalas', icone: 'history', dica: 'Versões publicadas e quem aprovou' },
  { id: 'presencas', rotulo: 'Presenças', icone: 'fact_check', dica: 'Presença e falta dia a dia', totais: true },
  { id: 'trocas', rotulo: 'Trocas', icone: 'compare_arrows', dica: 'Pedidos, aprovações e reprovações' },
  { id: 'aprovacoes', rotulo: 'Aprovações', icone: 'verified', dica: 'Envio, aprovação, declínio e publicação' },
];
const NUMERICAS = ['numero', 'horas', 'percentual', 'variacao'];
const TAMANHOS = [25, 50, 100];
const CORES_PRESENCA = ['var(--wfm-g-ok)', 'var(--wfm-g-perigo)', 'var(--wfm-g-aviso)', 'var(--wfm-g-marca-clara)', 'var(--wfm-g-neutro)'];
const CORES_TROCA = ['var(--wfm-g-ok)', 'var(--wfm-g-marca)', 'var(--wfm-g-aviso)', 'var(--wfm-g-perigo)', 'var(--wfm-g-marca-clara)', 'var(--wfm-g-neutro)'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PERIODOS = {
  mes: { rotulo: 'Mês atual', calc: () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(new Date(h.getFullYear(), h.getMonth() + 1, 0))]; } },
  anterior: { rotulo: 'Mês anterior', calc: () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]; } },
  trinta: { rotulo: 'Últimos 30 dias', calc: () => { const h = new Date(); const i = new Date(h); i.setDate(i.getDate() - 29); return [iso(i), iso(h)]; } },
  ano: { rotulo: 'Ano atual', calc: () => { const h = new Date(); return [`${h.getFullYear()}-01-01`, `${h.getFullYear()}-12-31`]; } },
};
const br = (isoData) => (isoData ? isoData.split('-').reverse().join('/') : '');

const fmtValor = (v, tipo) => {
  if (v === null || v === undefined || v === '') return '—';
  if (tipo === 'percentual') return `${fmt(v, 1)}%`;
  if (tipo === 'horas') return fmt(v, 2);
  if (tipo === 'variacao') return `${Number(v) > 0 ? '+' : ''}${fmt(v, 2)}`;
  return fmt(v);
};

// Selo do estado a partir do texto (o servidor devolve o rótulo já em português).
function tomEstado(texto) {
  const t = String(texto || '').toLowerCase();
  if (t.includes('justificada') || t.includes('aguardando') || t.includes('sem lançamento') || t.includes('enviada') || t.includes('andamento')) return 'mon-badge--pendente';
  if (/^(falta|reprovada|declinada|recusada|bloqueada|invalidada)/.test(t) || t.includes('violação')) return 'mon-badge--critico';
  if (/^(presente|aprovada|publicada|vigente)/.test(t)) return 'mon-badge--ok';
  return 'mon-badge--nula';
}

function Celula({ coluna, valor }) {
  if (coluna.tipo === 'estado') return html`<span class=${`mon-badge ${tomEstado(valor)}`}>${valor || '—'}</span>`;
  if (coluna.tipo === 'variacao') {
    const tom = valor > 0 ? 'is-sobe' : valor < 0 ? 'is-desce' : '';
    return html`<span class=${`wfm-rel-num wfm-rel-var ${tom}`}>${fmtValor(valor, 'variacao')}</span>`;
  }
  if (NUMERICAS.includes(coluna.tipo)) return html`<span class="wfm-rel-num">${fmtValor(valor, coluna.tipo)}</span>`;
  return valor === '' || valor === null || valor === undefined ? html`<span class="mon-muted">—</span>` : html`${valor}`;
}

// ---------------------------------------------------------------------------------------------------- tabela
function comparar(a, b, tipo) {
  const va = a ?? null, vb = b ?? null;
  if (va === null && vb === null) return 0;
  if (va === null) return 1; // vazio sempre no fim
  if (vb === null) return -1;
  if (NUMERICAS.includes(tipo)) return Number(va) - Number(vb);
  return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function TabelaDados({ colunas, linhas, comTotais, onLinha }) {
  const [ordem, setOrdem] = useState(null); // { chave, dir }
  const [pagina, setPagina] = useState(0);
  const [tamanho, setTamanho] = useState(TAMANHOS[0]);
  useEffect(() => { setPagina(0); }, [linhas, tamanho]);

  const ordenadas = useMemo(() => {
    if (!ordem) return linhas;
    const col = colunas.find((c) => c.chave === ordem.chave);
    const dir = ordem.dir === 'desc' ? -1 : 1;
    return [...linhas].sort((x, y) => {
      const nulos = (x[ordem.chave] ?? null) === null || (y[ordem.chave] ?? null) === null;
      return nulos ? comparar(x[ordem.chave], y[ordem.chave], col.tipo) : dir * comparar(x[ordem.chave], y[ordem.chave], col.tipo);
    });
  }, [linhas, ordem, colunas]);
  const paginas = Math.max(1, Math.ceil(ordenadas.length / tamanho));
  const atual = Math.min(pagina, paginas - 1);
  const fatia = ordenadas.slice(atual * tamanho, atual * tamanho + tamanho);
  const totais = useMemo(() => {
    if (!comTotais) return null;
    return Object.fromEntries(colunas.filter((c) => ['numero', 'horas'].includes(c.tipo)).map((c) => [c.chave, linhas.reduce((t, l) => t + (Number(l[c.chave]) || 0), 0)]));
  }, [comTotais, colunas, linhas]);

  const alternar = (chave) => setOrdem((o) => (o?.chave !== chave ? { chave, dir: 'asc' } : o.dir === 'asc' ? { chave, dir: 'desc' } : null));
  const abrir = (l) => onLinha && onLinha(l);

  return html`
    <div class="wfm-rel-tabela-bloco">
      <div class="mon-tabela-wrap wfm-rel-tabela">
        <table class="mon-tabela wfm-rel-t">
          <thead><tr>${colunas.map((c) => {
            const ativo = ordem?.chave === c.chave;
            return html`<th key=${c.chave} class=${NUMERICAS.includes(c.tipo) ? 'wfm-rel-num' : ''} aria-sort=${ativo ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" class=${`wfm-rel-ordenar ${ativo ? 'is-ativo' : ''}`} onClick=${() => alternar(c.chave)} title="Ordenar">${c.rotulo}<span aria-hidden="true">${ativo ? (ordem.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
          })}</tr></thead>
          <tbody>${fatia.map((l, i) => html`<tr key=${i} class=${onLinha ? 'is-clicavel' : ''} tabIndex=${onLinha ? 0 : undefined} onClick=${() => abrir(l)} onKeyDown=${(e) => { if (onLinha && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir(l); } }}>
            ${colunas.map((c) => html`<td key=${c.chave}><${Celula} coluna=${c} valor=${l[c.chave]} /></td>`)}</tr>`)}</tbody>
          ${totais ? html`<tfoot><tr>${colunas.map((c, i) => html`<td key=${c.chave} class=${NUMERICAS.includes(c.tipo) ? 'wfm-rel-num' : ''}>${i === 0 ? `Total (${linhas.length})` : c.chave in totais ? fmtValor(totais[c.chave], c.tipo) : ''}</td>`)}</tr></tfoot>` : null}
        </table>
      </div>
      <div class="wfm-rel-paginacao">
        <label>Linhas por página
          <select class="form-select" value=${tamanho} onChange=${(e) => setTamanho(Number(e.target.value))}>${TAMANHOS.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}</select></label>
        <span class="mon-muted">${ordenadas.length ? `${atual * tamanho + 1}–${Math.min(ordenadas.length, atual * tamanho + tamanho)} de ${fmt(ordenadas.length)}` : '0 linhas'}</span>
        <span class="wfm-rel-paginacao-botoes">
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${atual === 0} onClick=${() => setPagina(atual - 1)} aria-label="Página anterior"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <span class="mon-muted">${atual + 1} / ${paginas}</span>
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${atual >= paginas - 1} onClick=${() => setPagina(atual + 1)} aria-label="Próxima página"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
        </span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------------------------------- painel
function Indicador({ k }) {
  const sobe = k.variacao > 0, desce = k.variacao < 0;
  let tom = 'is-neutro';
  if (k.variacao !== null && k.melhor !== 'neutra') tom = (sobe && k.melhor === 'alta') || (desce && k.melhor === 'baixa') ? 'is-bom' : (sobe || desce) ? 'is-ruim' : 'is-neutro';
  const valor = k.valor === null || k.valor === undefined ? '—' : fmt(k.valor, k.unidade === 'h' || k.unidade === '%' ? (k.unidade === '%' ? 1 : 2) : 0);
  return html`<div class="wfm-rel-kpi" title=${k.dica}>
    <span>${k.rotulo}</span>
    <strong>${valor}${k.valor !== null && k.unidade ? html`<small>${k.unidade}</small>` : null}</strong>
    <em class=${`wfm-rel-delta ${tom}`}>${k.variacao === null ? 'sem base de comparação' : html`<span aria-hidden="true">${sobe ? '▲' : desce ? '▼' : '='}</span> ${k.variacao > 0 ? '+' : ''}${fmt(k.variacao, 1)}% vs. anterior`}</em>
    <small class="wfm-rel-anterior">${k.anterior === null || k.anterior === undefined ? '' : `Anterior: ${fmt(k.anterior, k.unidade === '%' ? 1 : k.unidade === 'h' ? 2 : 0)}${k.unidade}`}</small>
  </div>`;
}

function Painel({ painel, resumido = false }) {
  const g = painel.graficos;
  const semDados = !painel.totais.dias_escalados && !painel.totais.trocas;
  return html`
    ${semDados ? html`<div class="mon-alerta mon-alerta--info" role="status">Não há dias de trabalho de escala publicada neste período. Os indicadores ficam zerados até uma escala ser publicada.</div>` : null}
    <div class="wfm-rel-kpis">${painel.kpis.map((k) => html`<${Indicador} key=${k.chave} k=${k} />`)}</div>
    <p class="mon-muted">Comparado com ${br(painel.anterior.ini)} a ${br(painel.anterior.fim)} (período imediatamente anterior, mesma duração).</p>
    <div class="wfm-g-grade-cartoes">
      <${CartaoGrafico} titulo="Escalados × presentes por dia" subtitulo="Barras: escalados · linha: presentes · vermelho: faltas" largo=${true}>
        <${GraficoSerieDiaria} serie=${g.serie_diaria} /></${CartaoGrafico}>
      <${CartaoGrafico} titulo="Situação da presença" subtitulo="Dias de trabalho do período">
        <${GraficoRosca} dados=${g.presenca} cores=${CORES_PRESENCA} rotuloCentro="dias" /></${CartaoGrafico}>
      <${CartaoGrafico} titulo="Absenteísmo por dia da semana" subtitulo="Faltas ÷ dias apurados">
        <${GraficoColunas} dados=${g.absenteismo_semana} media=${painel.totais.absenteismo} /></${CartaoGrafico}>
      ${resumido ? null : html`
        <${CartaoGrafico} titulo="Horas por operador" subtitulo="Trabalhadas / escaladas (top 10)">
          <${GraficoBarrasH} dados=${g.top_operadores.map((o) => ({ rotulo: o.operador, trabalhadas: o.trabalhadas, escaladas: o.escaladas }))} series=${[{ chave: 'trabalhadas', rotulo: 'Trabalhadas', cor: 'var(--wfm-g-marca)' }, { chave: 'escaladas', rotulo: 'Escaladas', cor: 'var(--wfm-g-neutro)' }]} unidade="h" /></${CartaoGrafico}>
        <${CartaoGrafico} titulo="Horas escaladas por turno" subtitulo="Distribuição entre os turnos">
          <${GraficoBarrasH} dados=${g.horas_turno} series=${[{ chave: 'valor', rotulo: 'Horas', cor: 'var(--wfm-g-marca-clara)' }]} unidade="h" /></${CartaoGrafico}>
        <${CartaoGrafico} titulo="Trocas por situação" subtitulo="Pedidos do período">
          ${g.trocas_estado.length ? html`<${GraficoEmpilhada} dados=${g.trocas_estado} cores=${CORES_TROCA} />` : html`<p class="mon-muted">Nenhum pedido de troca no período.</p>`}</${CartaoGrafico}>
        <${CartaoGrafico} titulo="Comparação entre equipes" subtitulo="Horas trabalhadas e absenteísmo" largo=${true}>
          ${g.equipes.length ? html`<div class="mon-tabela-wrap"><table class="mon-tabela wfm-rel-t"><thead><tr><th>Equipe</th><th class="wfm-rel-num">Dias escalados</th><th class="wfm-rel-num">Faltas</th><th class="wfm-rel-num">Horas trabalhadas</th><th>Absenteísmo</th></tr></thead>
            <tbody>${g.equipes.map((e) => html`<tr key=${e.rotulo}><td>${e.rotulo}</td><td class="wfm-rel-num">${fmt(e.escalados)}</td><td class="wfm-rel-num">${fmt(e.faltas)}</td><td class="wfm-rel-num">${fmt(e.horas, 2)}</td>
              <td><span class="wfm-rel-minibarra"><i style=${{ width: `${Math.min(100, e.absenteismo || 0)}%` }}></i></span><span class="wfm-rel-num-inline">${e.absenteismo === null ? '—' : `${fmt(e.absenteismo, 1)}%`}</span></td></tr>`)}</tbody></table></div>` : html`<p class="mon-muted">Sem dados de equipes no período.</p>`}</${CartaoGrafico}>`}
    </div>`;
}

// ---------------------------------------------------------------------------------------------------- detalhe do operador
function DetalheOperador({ filtros, linha, onClose }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    const f = { ...filtros, id_operador: linha._id_operador };
    Promise.all([lerRelatorioWfm({ ...f, tipo: 'painel' }), lerRelatorioWfm({ ...f, tipo: 'presencas' })])
      .then(([p, d]) => { if (vivo) setDados({ painel: p.painel, dias: d }); })
      .catch((e) => { if (vivo) setErro(e?.message || 'Não foi possível carregar o detalhe.'); });
    return () => { vivo = false; };
  }, [filtros, linha._id_operador]);
  return html`<${ModalPadrao} aberto=${true} titulo=${`${linha.operador} — ${br(filtros.data_ini)} a ${br(filtros.data_fim)}`} onClose=${onClose} className="wfm-modal wfm-modal--largo">
    <div class="wfm-form-modal">
      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : !dados ? html`<${LoadingState} titulo="Carregando o detalhe" />` : html`
        <div class="wfm-rel-kpis">${dados.painel.kpis.map((k) => html`<${Indicador} key=${k.chave} k=${k} />`)}</div>
        <${CartaoGrafico} titulo="Dia a dia" subtitulo="Escalado × presente × falta"><${GraficoSerieDiaria} serie=${dados.painel.graficos.serie_diaria} /></${CartaoGrafico}>
        ${dados.dias.linhas.length ? html`<${TabelaDados} colunas=${dados.dias.colunas.filter((c) => ['data', 'turno', 'horario', 'horas_escaladas', 'status', 'horas_trabalhadas', 'observacao'].includes(c.chave))} linhas=${dados.dias.linhas} comTotais=${true} />`
          : html`<p class="mon-muted">Sem dias de trabalho neste período.</p>`}`}
    </div>
  </${ModalPadrao}>`;
}

// ---------------------------------------------------------------------------------------------------- exportar
function MenuExportar({ desabilitado, ocupado, onExportar }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  const escolher = (formato) => { setAberto(false); onExportar(formato); };
  return html`
    <div class="wfm-menu" ref=${raiz}>
      <button type="button" class="btn btn-primary" disabled=${desabilitado || ocupado} aria-haspopup="menu" aria-expanded=${aberto} onClick=${() => setAberto(!aberto)}>
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('download')}</span>${ocupado ? 'Gerando…' : 'Exportar'}
      </button>
      ${aberto ? html`<div class="wfm-menu-lista" role="menu">
        <button type="button" role="menuitem" onClick=${() => escolher('xlsx')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('table_chart')}</span>Este relatório (Excel)</button>
        <button type="button" role="menuitem" onClick=${() => escolher('csv')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('description')}</span>Este relatório (CSV)</button>
        <button type="button" role="menuitem" onClick=${() => escolher('completo')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('folder_zip')}</span>Todos os relatórios (Excel)</button>
      </div>` : null}
    </div>`;
}

// ---------------------------------------------------------------------------------------------------- tela
export function TelaRelatorios({ contexto, operacao, aoTrocarEscala, showToast }) {
  const [visao, setVisao] = useState('painel');
  const [preset, setPreset] = useState('mes');
  const [[ini, fim], setIntervalo] = useState(() => PERIODOS.mes.calc());
  const [idOperador, setIdOperador] = useState('');
  const [operadores, setOperadores] = useState([]);
  const [rel, setRel] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState('');
  const [detalhe, setDetalhe] = useState(null);

  const intervaloValido = !!ini && !!fim && ini <= fim;
  const filtros = useMemo(() => ({ operacao, data_ini: ini, data_fim: fim, id_operador: idOperador || undefined }), [operacao, ini, fim, idOperador]);

  const carregar = useCallback(async () => {
    if (!operacao || !intervaloValido) return;
    setErro('');
    try {
      const r = await lerRelatorioWfm({ ...filtros, tipo: visao });
      setRel(r);
      if (!idOperador && r.operadores?.length) setOperadores(r.operadores);
    } catch (e) { setRel(null); setErro(e?.message || 'Não foi possível gerar o relatório.'); }
  }, [filtros, visao, operacao, intervaloValido, idOperador]);
  useEffect(() => { setRel(null); carregar(); }, [carregar]);
  // Trocar de escala zera o filtro de operador (a lista de pessoas é outra).
  useEffect(() => { setIdOperador(''); setOperadores([]); }, [operacao]);

  const escolherPreset = (chave) => { setPreset(chave); if (chave !== 'personalizado') setIntervalo(PERIODOS[chave].calc()); };
  const exportar = async (formato) => {
    setOcupado(true);
    try {
      baixarArquivo(await exportarRelatorioWfm({ ...filtros, tipo: formato === 'completo' ? 'completo' : visao, formato: formato === 'csv' ? 'csv' : 'xlsx' }));
      showToast?.('Relatório gerado.', 'success');
    } catch (e) { showToast?.(e?.message || 'Não foi possível exportar.', 'error'); } finally { setOcupado(false); }
  };

  const linhas = useMemo(() => {
    const todas = rel?.linhas || [];
    const termo = busca.trim().toLowerCase();
    return termo ? todas.filter((l) => Object.entries(l).some(([k, v]) => !k.startsWith('_') && String(v ?? '').toLowerCase().includes(termo))) : todas;
  }, [rel, busca]);
  const visaoAtual = VISOES.find((v) => v.id === visao);
  const ehPainel = visao === 'painel';

  return html`
    <section class="mon-card wfm-rel">
      <div class="wfm-rel-filtros">
        <label class="mon-campo"><span>Escala / operação</span>
          <select class="form-select" value=${operacao} onChange=${(e) => aoTrocarEscala?.(e.target.value)}>
            ${(contexto?.operacoes || []).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}${o.escala_ativa === false ? ' (inativa)' : ''}</option>`)}
          </select>
        </label>
        <label class="mon-campo"><span>Período</span>
          <select class="form-select" value=${preset} onChange=${(e) => escolherPreset(e.target.value)}>
            ${Object.entries(PERIODOS).map(([k, p]) => html`<option key=${k} value=${k}>${p.rotulo}</option>`)}
            <option value="personalizado">Personalizado</option>
          </select>
        </label>
        <label class="mon-campo"><span>De</span>
          <input class="form-control" type="date" value=${ini} max=${fim || undefined} onChange=${(e) => { setPreset('personalizado'); setIntervalo([e.target.value, fim]); }} />
        </label>
        <label class="mon-campo"><span>Até</span>
          <input class="form-control" type="date" value=${fim} min=${ini || undefined} onChange=${(e) => { setPreset('personalizado'); setIntervalo([ini, e.target.value]); }} />
        </label>
        <label class="mon-campo"><span>Operador</span>
          <select class="form-select" value=${idOperador} onChange=${(e) => setIdOperador(e.target.value)}>
            <option value="">Todos</option>
            ${operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}
          </select>
        </label>
        <${MenuExportar} desabilitado=${!intervaloValido || !operacao} ocupado=${ocupado} onExportar=${exportar} />
      </div>

      <div class="wfm-rel-visoes" role="tablist" aria-label="Relatórios">
        ${VISOES.map((v) => html`<button key=${v.id} type="button" role="tab" aria-selected=${v.id === visao} class=${`wfm-rel-visao ${v.id === visao ? 'is-ativa' : ''}`} onClick=${() => { setVisao(v.id); setBusca(''); }} title=${v.dica}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(v.icone)}</span>${v.rotulo}</button>`)}
      </div>

      ${!intervaloValido ? html`<div class="mon-alerta mon-alerta--danger" role="alert">A data inicial precisa ser anterior ou igual à final.</div>`
        : erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`
        : !rel || rel.tipo !== visao ? html`<${LoadingState} titulo="Gerando o relatório" />`
        : html`
          ${ehPainel ? html`<${Painel} painel=${rel.painel} resumido=${!!idOperador} />` : html`
            <div class="wfm-rel-kpis">${(rel.resumo || []).map((k) => html`<div key=${k.rotulo} class="wfm-rel-kpi" title=${k.dica || ''}>
              <span>${k.rotulo}</span><strong>${k.valor === null || k.valor === undefined ? '—' : fmt(k.valor, Number.isInteger(k.valor) ? 0 : 2)}${k.valor !== null && k.valor !== undefined && k.unidade ? html`<small>${k.unidade}</small>` : null}</strong></div>`)}</div>
            <div class="wfm-rel-barra">
              <p class="mon-muted">${visaoAtual?.dica}. ${fmt(linhas.length)} linha(s).</p>
              <label class="wfm-rel-busca"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('search')}</span>
                <input class="form-control" type="search" placeholder="Filtrar linhas" value=${busca} onInput=${(e) => setBusca(e.target.value)} aria-label="Filtrar linhas do relatório" /></label>
            </div>
            ${linhas.length ? html`<${TabelaDados} key=${visao} colunas=${rel.colunas} linhas=${linhas} comTotais=${!!visaoAtual?.totais} onLinha=${visao === 'resumo' ? setDetalhe : undefined} />`
              : html`<${EmptyState} icon="analytics" title="Sem dados no período" text=${busca ? 'Nenhuma linha corresponde ao filtro.' : 'Não há registros para esta escala no período escolhido. Meses sem escala publicada não geram horas.'} />`}`}

          <details class="wfm-rel-calculo">
            <summary>Como é calculado</summary>
            <ul>${(rel.calculo || []).map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>
            <p class="mon-muted">Gerado em ${new Date(rel.gerado_em).toLocaleString('pt-BR')} · escopo do seu perfil aplicado pelo servidor.</p>
          </details>`}
    </section>
    ${detalhe ? html`<${DetalheOperador} filtros=${filtros} linha=${detalhe} onClose=${() => setDetalhe(null)} />` : null}`;
}
