import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, PainelRh } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import { useToast } from '../../shared/hooks/use-toast.js';
import { telaEmAreaInativa } from '../../shared/areas.js';
import { BotaoExportar, baixarArquivo } from '../monitoria/comum.js';
import { exportarRelatorioHub } from '../../services/api/relatorios-hub.js';
import { CHAVE_SELECAO_RELATORIO } from '../../shared/relatorios-hub.js';
import { AREAS, PERIODOS, PERMISSAO_BASE, RELATORIOS, carregarOperacoes } from './adaptadores.js?v=20261023-ajustes';

// Relatórios e Históricos (23/out/2026): todos os relatórios e históricos do Conecta num ambiente só. Menu lateral por área,
// filtros unificados, uma planilha e exportação XLSX/CSV/PDF. Cada relatório só aparece se o perfil tem a chave `relhub.*`
// (Perfis e Permissões); o servidor continua aplicando escopo e permissão de origem em cada consulta.

const TAMANHOS = [25, 50, 100];
const NUMERICOS = ['numero', 'horas', 'percentual', 'variacao'];
// Permissão de EXPORTAR por relatório (o servidor confere de novo em /relatorios-hub/exportar).
const exportarPermissao = (id) => (id === 'wfm.historico' ? 'wfm.auditoria'
  : id.startsWith('wfm.') ? 'wfm.relatorios'
    : id === 'monitoria.logs' ? 'monitoria.logs'
      : id.startsWith('monitoria.') ? 'monitoria.exportar'
        : id === 'rh.exames' ? 'candidatos.consultar_historico'
          : id.startsWith('rh.') ? 'relatorios.exportar'
            : 'logs.exportar');

// Colunas com nome de pessoa mostram só o primeiro e o segundo nome (o nome completo fica no balão e na exportação).
const COLUNA_PESSOA = /^(operador|candidato|avaliad|monitor|supervisor|usu[aá]rio|solicitante|colega|alvo|aprovador|nome|quem|decidido)/i;
const nomeCurto = (valor) => {
  const t = String(valor ?? '').trim();
  if (!t || t.includes('@') || /\d/.test(t)) return t;
  const partes = t.split(/\s+/);
  return partes.length > 2 ? partes.slice(0, 2).join(' ') : t;
};
const br = (d) => (d ? d.split('-').reverse().join('/') : '');
const valorTexto = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v));
// Horas decimais (7,5) -> "hh:mm" (07:30).
const hhmm = (v) => {
  const total = Math.round((Number(v) || 0) * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const formatarNumero = (v, tipo) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (tipo === 'percentual') return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (tipo === 'horas') return hhmm(n);
  if (tipo === 'variacao') return `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};
const comparar = (a, b, tipo) => {
  const va = a ?? null, vb = b ?? null;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  if (NUMERICOS.includes(tipo)) return Number(va) - Number(vb);
  return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' });
};
const tomEstado = (texto) => {
  const t = String(texto || '').toLowerCase();
  if (t.includes('justificada') || t.includes('aguardando') || t.includes('enviada') || t.includes('andamento')) return 'mon-badge--pendente';
  if (/^(falta|reprovada|declinada|recusada|bloqueada|invalidada)/.test(t) || t.includes('violação')) return 'mon-badge--critico';
  if (/^(presente|aprovada|publicada|vigente)/.test(t)) return 'mon-badge--ok';
  return 'mon-badge--nula';
};

// Filtros que dependem das colunas da planilha carregada (equipe, supervisor, operador, status): aparecem só se a coluna existe.
const COLUNA_DO_FILTRO = {
  equipe: /^equipe/i, supervisor: /^supervisor/i, operador: /^(operador|avaliado|candidato)/i, status: /^(status|situa)/i,
};
const ROTULO_FILTRO = { equipe: 'Equipe', supervisor: 'Supervisor', operador: 'Operador', status: 'Status' };

function Planilha({ relatorio, dados, filtrosColuna, busca, onExportar, exportando, podeExportar }) {
  const [ordem, setOrdem] = useState(null);
  const [pagina, setPagina] = useState(0);
  const [tamanho, setTamanho] = useState(TAMANHOS[0]);
  const termo = busca.trim().toLowerCase();
  const linhas = useMemo(() => dados.linhas.filter((l) => {
    for (const [campo, valor] of Object.entries(filtrosColuna)) {
      const coluna = dados.colunas.find((c) => COLUNA_DO_FILTRO[campo]?.test(c.rotulo));
      if (valor && coluna && String(l[coluna.chave] ?? '') !== valor) return false;
    }
    return !termo || dados.colunas.some((c) => String(l[c.chave] ?? '').toLowerCase().includes(termo));
  }), [dados, filtrosColuna, termo]);
  const ordenadas = useMemo(() => {
    if (!ordem) return linhas;
    const coluna = dados.colunas.find((c) => c.chave === ordem.chave);
    const dir = ordem.dir === 'desc' ? -1 : 1;
    return [...linhas].sort((x, y) => dir * comparar(x[ordem.chave], y[ordem.chave], coluna?.tipo));
  }, [linhas, ordem, dados]);
  useEffect(() => { setPagina(0); }, [linhas, tamanho]);
  const paginas = Math.max(1, Math.ceil(ordenadas.length / tamanho));
  const atual = Math.min(pagina, paginas - 1);
  const fatia = ordenadas.slice(atual * tamanho, atual * tamanho + tamanho);
  const totais = useMemo(() => (relatorio.totais
    ? Object.fromEntries(dados.colunas.filter((c) => ['numero', 'horas'].includes(c.tipo)).map((c) => [c.chave, linhas.reduce((t, l) => t + (Number(l[c.chave]) || 0), 0)]))
    : null), [relatorio, dados, linhas]);
  const alternar = (chave) => setOrdem((o) => (o?.chave !== chave ? { chave, dir: 'asc' } : o.dir === 'asc' ? { chave, dir: 'desc' } : null));

  return html`
    <div class="rhub-barra">
      <span class="rhub-contagem" role="status">${linhas.length.toLocaleString('pt-BR')} linha(s)${dados.aviso ? ` · ${dados.aviso}` : ''}</span>
      ${podeExportar ? html`<${BotaoExportar} desabilitado=${exportando || !linhas.length} rotulo=${exportando ? 'Gerando…' : 'Exportar'} opcoes=${[
        { rotulo: 'Exportar XLSX', onSelecionar: () => onExportar('xlsx', ordenadas) },
        { rotulo: 'Exportar CSV', onSelecionar: () => onExportar('csv', ordenadas) },
        { rotulo: 'Exportar PDF', onSelecionar: () => onExportar('pdf', ordenadas) },
      ]} />` : null}
    </div>
    ${(dados.resumo || []).length ? html`<div class="rhub-resumo">${dados.resumo.map((k) => html`<div key=${k.rotulo} class="rhub-kpi" title=${k.dica || ''}><span>${k.rotulo}</span><strong>${k.valor === null || k.valor === undefined ? '—' : Number(k.valor).toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(k.valor) ? 0 : 2 })}${k.valor !== null && k.valor !== undefined && k.unidade ? html`<small>${k.unidade}</small>` : null}</strong></div>`)}</div>` : null}
    ${!linhas.length ? html`<${EmptyState} icon="table_chart" title="Sem dados" text=${termo || Object.values(filtrosColuna).some(Boolean) ? 'Nenhuma linha corresponde aos filtros.' : 'Não há registros para os filtros escolhidos.'} />` : html`
      <div class="rhub-tabela-wrap">
        <table class="mon-tabela rhub-tabela">
          <thead><tr>${dados.colunas.map((c) => {
    const ativo = ordem?.chave === c.chave;
    return html`<th key=${c.chave} class=${NUMERICOS.includes(c.tipo) ? 'is-num' : ''} aria-sort=${ativo ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type="button" class=${`rhub-ordenar ${ativo ? 'is-ativo' : ''}`} onClick=${() => alternar(c.chave)} title="Ordenar">${c.rotulo}<span aria-hidden="true">${ativo ? (ordem.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
  })}</tr></thead>
          <tbody>${fatia.map((l, i) => html`<tr key=${i}>${dados.colunas.map((c) => html`<td key=${c.chave} class=${NUMERICOS.includes(c.tipo) ? 'is-num' : ''} title=${typeof l[c.chave] === 'string' && (l[c.chave].length > 40 || COLUNA_PESSOA.test(c.rotulo)) ? l[c.chave] : undefined}>
            ${c.tipo === 'estado' ? html`<span class=${`mon-badge ${tomEstado(l[c.chave])}`}>${valorTexto(l[c.chave])}</span>`
    : NUMERICOS.includes(c.tipo) ? formatarNumero(l[c.chave], c.tipo) : COLUNA_PESSOA.test(c.rotulo) && typeof l[c.chave] === 'string' ? (nomeCurto(l[c.chave]) || '—') : valorTexto(l[c.chave])}</td>`)}</tr>`)}</tbody>
          ${totais ? html`<tfoot><tr>${dados.colunas.map((c, i) => html`<td key=${c.chave} class=${NUMERICOS.includes(c.tipo) ? 'is-num' : ''}>${i === 0 ? `Total (${linhas.length})` : c.chave in totais ? formatarNumero(totais[c.chave], c.tipo) : ''}</td>`)}</tr></tfoot>` : null}
        </table>
      </div>
      <div class="rhub-paginacao">
        <label>Linhas por página
          <select class="form-select" value=${tamanho} onChange=${(e) => setTamanho(Number(e.target.value))}>${TAMANHOS.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}</select></label>
        <span>${ordenadas.length ? `${atual * tamanho + 1}–${Math.min(ordenadas.length, atual * tamanho + tamanho)} de ${ordenadas.length.toLocaleString('pt-BR')}` : '0 linhas'}</span>
        <span class="rhub-paginacao-botoes">
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${atual === 0} onClick=${() => setPagina(atual - 1)} aria-label="Página anterior"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <span>${atual + 1} / ${paginas}</span>
          <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${atual >= paginas - 1} onClick=${() => setPagina(atual + 1)} aria-label="Próxima página"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
        </span>
      </div>`}`;
}

// Telas com gráficos, duplicadas da origem: carregadas sob demanda.
function TelaEmbutida({ relatorio, controlador, filtros, showToast }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    let ativo = true;
    if (relatorio.tela === 'painel-wfm') import('../../modulos/operacao/wfm/relatorios.js?v=20261026-trocas').then((m) => ativo && setComp(() => m.PainelWfmHub));
    if (relatorio.tela === 'dashboard-monitoria') {
      Promise.all([import('../monitoria/painel.js?v=20261023-ajustes'), import('../monitoria/comum.js')]).then(([p, c]) => ativo && setComp(() => function Dashboard() {
        const { contexto, erro } = c.useContextoMonitoria();
        if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
        if (!contexto) return html`<${LoadingState} titulo="Carregando" />`;
        return html`<${p.TelaDashboard} controlador=${controlador} contexto=${contexto} showToast=${showToast} />`;
      }));
    }
    return () => { ativo = false; };
  }, [relatorio.tela]);
  if (relatorio.tela === 'atalho') {
    return html`<div class="rhub-atalho"><p>${relatorio.descricao}</p>
      <button type="button" class="btn btn-primary" onClick=${() => controlador.irParaTelaProtegida(relatorio.destino)}>Abrir ${relatorio.rotulo}</button></div>`;
  }
  if (!Comp) return html`<${LoadingState} titulo="Carregando" />`;
  return html`<${Comp} operacao=${filtros.operacao} ini=${filtros.ini} fim=${filtros.fim} />`;
}

const Seletor = ({ rotulo, valor, opcoes, aoMudar, todos = 'Todos' }) => html`<label class="rhub-filtro"><span>${rotulo}</span>
  <select class="form-select" value=${valor} onChange=${(e) => aoMudar(e.target.value)}>
    ${todos === null ? null : html`<option value="">${todos}</option>`}${opcoes.map((o) => (Array.isArray(o) ? html`<option key=${o[0]} value=${o[0]}>${o[1]}</option>` : html`<option key=${o} value=${o}>${o}</option>`))}</select></label>`;

const FILTROS_PADRAO = () => { const [ini, fim] = PERIODOS.mes.calc(); return { preset: 'mes', ini, fim, operacao: '', operador: '', equipe: '', supervisor: '', status: '', busca: '' }; };

export function TelaRelatoriosHub({ controlador }) {
  const { showToast, ToastHost } = useToast();
  // Sem useMemo: a lista de áreas inativas chega depois (GET /core/acesso) e a de permissões pode mudar com o perfil.
  const disponiveis = RELATORIOS.filter((r) => controlador.possuiPermissao(r.permissao) && controlador.possuiPermissao(PERMISSAO_BASE[r.id]) && !telaEmAreaInativa(r.origem));
  const porArea = AREAS.map((a) => ({ ...a, itens: disponiveis.filter((r) => r.area === a.id) })).filter((a) => a.itens.length);
  const [selecionado, setSelecionado] = useState(() => {
    // Vem do link (?r=) ou de um redirecionamento de tela antiga (guardado só até ser lido).
    let guardado = '';
    try { guardado = window.sessionStorage.getItem(CHAVE_SELECAO_RELATORIO) || ''; window.sessionStorage.removeItem(CHAVE_SELECAO_RELATORIO); } catch { /* sem storage */ }
    return new URLSearchParams(window.location.search).get('r') || guardado;
  });
  const relatorio = disponiveis.find((r) => r.id === selecionado) || disponiveis[0] || null;
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [operacoes, setOperacoes] = useState([]);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [exportando, setExportando] = useState(false);
  const [fechadas, setFechadas] = useState(() => new Set()); // áreas recolhidas no menu

  const escolher = (id) => {
    const area = RELATORIOS.find((r) => r.id === id)?.area;
    if (area) setFechadas((atual) => { if (!atual.has(area)) return atual; const novo = new Set(atual); novo.delete(area); return novo; });
    setSelecionado(id);
    setFiltros((f) => ({ ...FILTROS_PADRAO(), preset: f.preset, ini: f.ini, fim: f.fim }));
    window.history.replaceState(null, '', `/relatorios-historicos?r=${encodeURIComponent(id)}`);
  };
  const mudar = (campo) => (valor) => setFiltros((f) => ({ ...f, [campo]: valor }));

  // Opções de operação por área; a operação obrigatória (WFM) começa na primeira escala ativa.
  useEffect(() => {
    if (!relatorio) return undefined;
    let ativo = true;
    setOperacoes([]);
    carregarOperacoes(relatorio.area).then((lista) => {
      if (!ativo) return;
      setOperacoes(lista);
      if (relatorio.operacaoObrigatoria) setFiltros((f) => (lista.some(([k]) => k === f.operacao) ? f : { ...f, operacao: (lista.find(([k]) => !String(k).includes('inativa')) || lista[0] || ['', ''])[0] }));
    }).catch(() => ativo && setOperacoes([]));
    return () => { ativo = false; };
  }, [relatorio?.id]);

  // Recarrega quando muda o que o servidor filtra (período, operação e, no WFM, operador).
  const chaveCarga = relatorio && !relatorio.tela ? JSON.stringify([relatorio.id, filtros.ini, filtros.fim, filtros.operacao, relatorio.area === 'wfm' ? filtros.operador : '', relatorio.id === 'wfm.historico' || relatorio.id === 'monitoria.logs' || relatorio.id === 'rh.exames' || relatorio.id === 'sistema.logs' ? filtros.busca : '']) : '';
  useEffect(() => {
    if (!chaveCarga) { setDados(null); return undefined; }
    if (relatorio.operacaoObrigatoria && !filtros.operacao) return undefined;
    if (filtros.ini && filtros.fim && filtros.ini > filtros.fim) { setErro('A data inicial precisa ser anterior ou igual à final.'); setDados(null); return undefined; }
    let ativo = true;
    setErro(''); setDados(null);
    const espera = setTimeout(() => {
      relatorio.carregar(filtros)
        .then((r) => { if (ativo) setDados(r); })
        .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível gerar o relatório.'); });
    }, 250);
    return () => { ativo = false; clearTimeout(espera); };
  }, [chaveCarga]);

  const filtrosColuna = useMemo(() => ({ equipe: filtros.equipe, supervisor: filtros.supervisor, operador: relatorio?.area === 'wfm' ? '' : filtros.operador, status: filtros.status }), [filtros, relatorio]);
  const opcoesColuna = useCallback((campo) => {
    const coluna = dados?.colunas.find((c) => COLUNA_DO_FILTRO[campo].test(c.rotulo));
    if (!coluna) return null;
    return [...new Set(dados.linhas.map((l) => l[coluna.chave]).filter((v) => v !== '' && v !== null && v !== undefined).map(String))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [dados]);

  const exportar = async (formato, linhas) => {
    setExportando(true);
    try {
      const operacaoRotulo = (operacoes.find(([k]) => k === filtros.operacao) || [])[1];
      const filtrosTexto = [['Relatório', relatorio.rotulo], ['Período', `${br(filtros.ini)} a ${br(filtros.fim)}`], ['Operação', operacaoRotulo || ''], ['Equipe', filtros.equipe], ['Supervisor', filtros.supervisor], ['Operador', filtros.operador], ['Status', filtros.status], ['Busca', filtros.busca]].filter(([, v]) => v);
      const arquivo = await exportarRelatorioHub({
        relatorio: relatorio.id, formato, titulo: `${relatorio.rotulo}`, filtros: filtrosTexto,
        colunas: dados.colunas.map((c) => c.rotulo),
        linhas: linhas.map((l) => dados.colunas.map((c) => (c.tipo === 'horas' && l[c.chave] !== '' && l[c.chave] !== null && !Number.isNaN(Number(l[c.chave])) ? hhmm(l[c.chave]) : NUMERICOS.includes(c.tipo) && l[c.chave] !== '' && l[c.chave] !== null && !Number.isNaN(Number(l[c.chave])) ? Number(l[c.chave]) : (l[c.chave] ?? '')))),
      });
      baixarArquivo(arquivo);
      showToast('Arquivo gerado.', 'success');
    } catch (e) { showToast(e?.message || 'Não foi possível exportar.', 'error'); } finally { setExportando(false); }
  };

  const usa = (campo) => relatorio?.filtros?.includes(campo);
  const opcoesOperador = relatorio?.area === 'wfm' ? dados?.operadores : null;
  const opcoesOperacao = relatorio?.operacoes || dados?.operacoes || operacoes;
  const barraFiltros = relatorio ? html`
    <div class="rhub-filtros">
      ${usa('periodo') ? html`
        <${Seletor} rotulo="Período" valor=${filtros.preset} todos=${null} opcoes=${[...Object.entries(PERIODOS).map(([k, p]) => [k, p.rotulo]), ['personalizado', 'Personalizado']]}
          aoMudar=${(v) => setFiltros((f) => (v === 'personalizado' ? { ...f, preset: v } : { ...f, preset: v, ini: PERIODOS[v].calc()[0], fim: PERIODOS[v].calc()[1] }))} />
        <label class="rhub-filtro rhub-filtro--data"><span>De</span><input class="form-control" type="date" value=${filtros.ini} max=${filtros.fim || undefined} onInput=${(e) => setFiltros((f) => ({ ...f, preset: 'personalizado', ini: e.target.value }))} /></label>
        <label class="rhub-filtro rhub-filtro--data"><span>Até</span><input class="form-control" type="date" value=${filtros.fim} min=${filtros.ini || undefined} onInput=${(e) => setFiltros((f) => ({ ...f, preset: 'personalizado', fim: e.target.value }))} /></label>` : null}
      ${usa('operacao') && (opcoesOperacao.length > 1) ? html`<${Seletor} rotulo=${relatorio.area === 'wfm' ? 'Escala / operação' : 'Operação'} valor=${filtros.operacao} opcoes=${opcoesOperacao} aoMudar=${mudar('operacao')} todos=${relatorio.operacaoObrigatoria ? null : relatorio.area === 'wfm' ? 'Todas as escalas' : 'Todas'} />` : null}
      ${['equipe', 'supervisor'].map((campo) => (usa(campo) && opcoesColuna(campo)?.length ? html`<${Seletor} key=${campo} rotulo=${ROTULO_FILTRO[campo]} valor=${filtros[campo]} opcoes=${opcoesColuna(campo)} aoMudar=${mudar(campo)} />` : null))}
      ${usa('operador') ? (opcoesOperador?.length ? html`<${Seletor} rotulo="Operador" valor=${filtros.operador} opcoes=${opcoesOperador} aoMudar=${mudar('operador')} />`
        : opcoesColuna('operador')?.length ? html`<${Seletor} rotulo="Operador" valor=${filtros.operador} opcoes=${opcoesColuna('operador')} aoMudar=${mudar('operador')} />` : null) : null}
      ${usa('status') && opcoesColuna('status')?.length ? html`<${Seletor} rotulo="Status" valor=${filtros.status} opcoes=${opcoesColuna('status')} aoMudar=${mudar('status')} />` : null}
      ${usa('busca') ? html`<label class="rhub-filtro rhub-filtro--busca"><span>Buscar</span>
        <span class="rhub-busca"><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('search')}</span>
          <input class="form-control" type="search" placeholder="Filtrar linhas" value=${filtros.busca} onInput=${(e) => mudar('busca')(e.target.value)} aria-label="Buscar na planilha" /></span></label>` : null}
    </div>` : null;

  let corpo;
  if (!relatorio) corpo = html`<${EmptyState} icon="lock" title="Nenhum relatório liberado" text="Seu perfil ainda não tem acesso a nenhum relatório ou histórico. Fale com o Administrador." />`;
  else if (relatorio.tela) corpo = html`<${TelaEmbutida} key=${relatorio.id} relatorio=${relatorio} controlador=${controlador} filtros=${filtros} showToast=${showToast} />`;
  else if (erro) corpo = html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  else if (!dados) corpo = html`<${LoadingState} titulo="Gerando o relatório" />`;
  else corpo = html`<${Planilha} key=${relatorio.id} relatorio=${relatorio} dados=${dados} filtrosColuna=${filtrosColuna} busca=${filtros.busca} onExportar=${exportar} exportando=${exportando}
    podeExportar=${controlador.possuiPermissao(exportarPermissao(relatorio.id))} />`;

  return html`
    <${PainelRh} screenId="screen-relatorios" navAtiva="screen-relatorios" subtituloMarca="Relatórios e Históricos" placeholderBusca="Relatórios e Históricos" controlador=${controlador} buscaGlobal=${false}>
      <${ToastHost} />
      <div class="rhub">
        <nav class="rhub-menu" aria-label="Relatórios e históricos">
          ${porArea.map((a) => { const aberta = !fechadas.has(a.id); return html`<div key=${a.id} class="rhub-grupo">
            <button type="button" class="rhub-grupo-titulo" aria-expanded=${aberta} onClick=${() => setFechadas((atual) => { const novo = new Set(atual); if (novo.has(a.id)) novo.delete(a.id); else novo.add(a.id); return novo; })}>
              <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(a.icone)}</span><span class="rhub-grupo-nome">${a.rotulo}</span>
              <span class=${`material-symbols-outlined rhub-chevron ${aberta ? 'is-aberto' : ''}`} aria-hidden="true">${IconeSvg('expand_more')}</span></button>
            ${aberta ? a.itens.map((r) => html`<button key=${r.id} type="button" class=${`rhub-item ${relatorio?.id === r.id ? 'is-ativo' : ''}`} aria-current=${relatorio?.id === r.id ? 'page' : undefined} onClick=${() => escolher(r.id)}>${r.rotulo}</button>`) : null}
          </div>`; })}
        </nav>
        <section class="rhub-principal" aria-live="polite">
          ${relatorio ? html`<header class="rhub-cab"><h1>${relatorio.rotulo}</h1><p>${relatorio.descricao}</p></header>` : null}
          ${barraFiltros}
          ${corpo}
        </section>
      </div>
    </${PainelRh}>`;
}

