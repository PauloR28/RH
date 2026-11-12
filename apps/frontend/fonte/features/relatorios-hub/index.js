import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { PainelRh } from '../../ui/componentes-compartilhados.js';
import { Esqueleto, Estado, Ic, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { useToast } from '../../shared/hooks/use-toast.js';
import { telaEmAreaInativa } from '../../shared/areas.js';
import { baixarArquivo } from '../monitoria/comum.js';
import { exportarRelatorioHub } from '../../services/api/relatorios-hub.js';
import { CHAVE_SELECAO_RELATORIO } from '../../shared/relatorios-hub.js';
import { AREAS, PERIODOS, PERMISSAO_BASE, RELATORIOS, carregarOperacoes } from './adaptadores.js?v=20261111-escalados';

// Relatórios e Históricos (23/out/2026): todos os relatórios e históricos do Conecta num ambiente só. Cada relatório só
// aparece se o perfil tem a chave `relhub.*` (Perfis e Permissões); o servidor continua aplicando escopo e permissão de
// origem em cada consulta.
// Redesign Fase 15 (fatia 4, lote 3, amostra Fase 12 · quadro 12): 1 molde para todos — lista de relatórios à esquerda
// (por área), título + Exportar, caixa com os filtros na faixa, números do resumo, tabela justa com ordenação e "Colunas"
// (a tela abre com as colunas mais usadas; o arquivo exportado leva todas), rodapé com a contagem e a paginação.
// Painel e Dashboard abrem na própria seção (↗); se a pessoa não abre a seção, continuam aqui dentro, como antes.

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
// Relatórios com gráficos que têm tela própria na seção (abre lá; sem acesso à seção, fica embutido aqui).
const DESTINO_SECAO = { 'wfm.painel': 'screen-wfm-painel', 'monitoria.dashboard': 'screen-monitoria-dashboard' };

// Colunas que a tela abre DESLIGADAS (amostra aprovada da Fase 12). Os demais relatórios: até 10 colunas, todas; mais
// que isso, as 8 primeiras. "Colunas" liga o resto e a escolha fica guardada neste navegador, por pessoa.
const COLUNAS_DESLIGADAS = {
  'wfm.resumo': ['Dias escalados', 'Faltas justificadas', 'Atestados', 'Outras ausências', 'Horas extras', 'Total de horas', 'Trocas aprovadas'],
  'wfm.escalas': ['Aprovada por'],
  'wfm.presencas': ['Horas escaladas', 'Lançado por'],
  'wfm.trocas': ['Turno (solicitante)', 'Horário (solicitante)', 'Pausas (solicitante)', 'Turno (colega)', 'Horário (colega)', 'Pausas (colega)', 'Decidido por', 'Decidido em', 'Justificativa da decisão'],
  'monitoria.historico': ['Data do contato', 'Equipe', 'Operação', 'Contestação', 'Anulada', 'Confirmação'],
  'monitoria.qualidade': ['Período inicial', 'Período final', 'Operação'],
  'monitoria.planos': ['Operação', 'Origem', 'Critério', 'Objetivo', 'Data da revisão', 'Resultado', 'Observações', 'Vencido'],
};
const MAX_SEM_ESCOLHA = 10;
const PADRAO_SEM_ESCOLHA = 8;

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
// Situação em selo: a cor nunca vem sozinha, sempre com a palavra.
const tomEstado = (texto) => {
  const t = String(texto || '').toLowerCase();
  if (t.includes('justificada') || t.includes('aguardando') || t.includes('enviada') || t.includes('andamento')) return 'atencao';
  if (/^(falta|reprovada|declinada|recusada|bloqueada|invalidada)/.test(t) || t.includes('violação')) return 'perigo';
  if (/^(presente|aprovada|publicada|vigente)/.test(t)) return 'sucesso';
  return 'neutro';
};

// Filtros que dependem das colunas da planilha carregada (equipe, supervisor, operador, status): aparecem só se a coluna existe.
const COLUNA_DO_FILTRO = {
  equipe: /^equipe/i, supervisor: /^supervisor/i, operador: /^(operador|avaliado|candidato)/i, status: /^(status|situa|trocou)/i,
};
const ROTULO_FILTRO = { equipe: 'Equipe', supervisor: 'Supervisor', operador: 'Operador', status: 'Status' };

// Escolha de colunas guardada no navegador (conveniência; se o navegador não guardar, volta ao padrão).
const chaveColunas = (usuario, id) => `c24_relhub_colunas:${usuario || 'anon'}:${id}`;
const lerEscolha = (usuario, id) => { try { const v = JSON.parse(window.localStorage.getItem(chaveColunas(usuario, id)) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const gravarEscolha = (usuario, id, rotulos) => { try { window.localStorage.setItem(chaveColunas(usuario, id), JSON.stringify(rotulos)); } catch { /* sem storage */ } };
function colunasPadrao(id, colunas) {
  const desligadas = COLUNAS_DESLIGADAS[id];
  if (desligadas) return colunas.filter((c, i) => i === 0 || !desligadas.includes(c.rotulo)).map((c) => c.rotulo);
  return (colunas.length > MAX_SEM_ESCOLHA ? colunas.slice(0, PADRAO_SEM_ESCOLHA) : colunas).map((c) => c.rotulo);
}

// Menu solto (Exportar, Colunas): fecha com clique fora e Esc.
function useMenu() {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  const botao = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (ev) => { if (raiz.current && !raiz.current.contains(ev.target)) setAberto(false); };
    const esc = (ev) => { if (ev.key === 'Escape') { setAberto(false); botao.current?.focus(); } };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return { aberto, setAberto, raiz, botao };
}

function MenuExportar({ desabilitado, exportando, totalColunas, aoExportar }) {
  const m = useMenu();
  return html`<div class="c-abre-menu" ref=${m.raiz}>
    <button type="button" class="c-botao c-botao--secundario c-botao--compacto" ref=${m.botao} aria-haspopup="menu" aria-expanded=${m.aberto ? 'true' : 'false'}
      disabled=${desabilitado || null} aria-busy=${exportando ? 'true' : null} onClick=${() => m.setAberto((v) => !v)}>
      <${Ic} nome="tray-arrow-down" />${exportando ? 'Gerando…' : 'Exportar'}<${Ic} nome="caret-down" /></button>
    ${m.aberto ? html`<div class="c-menu c-menu--solto" role="menu">
      ${[['xlsx', 'Excel (XLSX)'], ['csv', 'CSV'], ['pdf', 'PDF']].map(([f, r]) => html`<button key=${f} type="button" role="menuitem" class="c-menu-item" onClick=${() => { m.setAberto(false); aoExportar(f); }}>${r}</button>`)}
      <div class="c-menu-separador"></div><span class="c-menu-nota">O arquivo leva as ${totalColunas} colunas</span>
    </div>` : null}
  </div>`;
}

function MenuColunas({ colunas, visiveis, aoMudar }) {
  const m = useMenu();
  const ligadas = colunas.filter((c) => visiveis.includes(c.rotulo)).length;
  return html`<div class="c-fim c-abre-menu" ref=${m.raiz}>
    <button type="button" class="c-botao c-botao--texto c-botao--compacto" ref=${m.botao} aria-haspopup="true" aria-expanded=${m.aberto ? 'true' : 'false'} onClick=${() => m.setAberto((v) => !v)}>
      <${Ic} nome="table" />Colunas · ${ligadas} de ${colunas.length}<${Ic} nome="caret-down" /></button>
    ${m.aberto ? html`<div class="c-menu c-menu--solto c-menu--colunas" role="group" aria-label="Colunas da tabela">
      ${colunas.map((c, i) => html`<label key=${c.chave} class="c-menu-item"><input type="checkbox" checked=${visiveis.includes(c.rotulo)} disabled=${i === 0 || null}
        onChange=${(e) => aoMudar(e.target.checked ? [...visiveis, c.rotulo] : visiveis.filter((r) => r !== c.rotulo))} />${c.rotulo}</label>`)}
    </div>` : null}
  </div>`;
}

const Indicadores = ({ resumo }) => html`<div class="c-indicadores">${resumo.map((k) => html`<div key=${k.rotulo} class="c-indicador" title=${k.dica || null}>
  <span class="c-ind-rotulo">${k.rotulo}</span>
  <span class="c-ind-valor">${k.valor === null || k.valor === undefined ? '—' : Number(k.valor).toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(k.valor) ? 0 : 2 })}${k.valor !== null && k.valor !== undefined && k.unidade ? html`<small>${k.unidade}</small>` : null}</span>
  <span class="c-ind-nota">${k.dica || ' '}</span>
</div>`)}</div>`;

function Celula({ coluna: c, linha: l }) {
  const v = l[c.chave];
  const num = NUMERICOS.includes(c.tipo);
  const longo = typeof v === 'string' && v.length > 40;
  const balao = typeof v === 'string' && (longo || COLUNA_PESSOA.test(c.rotulo));
  return html`<td class=${num ? 'c-num' : longo ? 'c-secundario c-rh-longo' : ''} title=${balao ? v : undefined}>
    ${c.tipo === 'estado' ? (v === null || v === undefined || v === '' ? '—' : html`<${Selo} tom=${tomEstado(v)}>${valorTexto(v)}<//>`)
    : num ? formatarNumero(v, c.tipo) : COLUNA_PESSOA.test(c.rotulo) && typeof v === 'string' ? (nomeCurto(v) || '—') : valorTexto(v)}</td>`;
}

// Tabela do relatório: ordenação, paginação, total e as colunas escolhidas. O arquivo exportado leva TODAS as colunas.
function Planilha({ relatorio, dados, filtrosColuna, busca, visiveis, aoLinhas, aoLimpar, aoMesAnterior }) {
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
  useEffect(() => { aoLinhas(ordenadas); }, [ordenadas]);
  useEffect(() => { setPagina(0); }, [linhas, tamanho]);
  const paginas = Math.max(1, Math.ceil(ordenadas.length / tamanho));
  const atual = Math.min(pagina, paginas - 1);
  const fatia = ordenadas.slice(atual * tamanho, atual * tamanho + tamanho);
  const colunas = dados.colunas.filter((c, i) => i === 0 || visiveis.includes(c.rotulo));
  const totais = useMemo(() => (relatorio.totais
    ? Object.fromEntries(dados.colunas.filter((c) => ['numero', 'horas'].includes(c.tipo)).map((c) => [c.chave, linhas.reduce((t, l) => t + (Number(l[c.chave]) || 0), 0)]))
    : null), [relatorio, dados, linhas]);
  const alternar = (chave) => setOrdem((o) => (o?.chave !== chave ? { chave, dir: 'asc' } : o.dir === 'asc' ? { chave, dir: 'desc' } : null));
  const ordenadoPor = ordem ? dados.colunas.find((c) => c.chave === ordem.chave)?.rotulo : '';

  if (!linhas.length) {
    // Sem dados: o aviso já oferece o próximo passo (lista 10/11, item 11).
    const filtrado = termo || Object.values(filtrosColuna).some(Boolean);
    return html`<${Estado} icone="table" titulo="Sem dados" texto=${filtrado ? 'Nenhuma linha corresponde aos filtros.' : 'Não há registros para os filtros escolhidos.'}
      rotuloAcao=${filtrado ? 'Limpar filtros' : aoMesAnterior ? 'Ver mês anterior' : null} aoAcao=${filtrado ? aoLimpar : aoMesAnterior} />`;
  }
  return html`
    <table class="c-tabela c-tabela--justa c-rh-tabela">
      <thead><tr>${colunas.map((c) => {
    const ativo = ordem?.chave === c.chave;
    return html`<th key=${c.chave} scope="col" class=${NUMERICOS.includes(c.tipo) ? 'c-num' : ''} aria-sort=${ativo ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : null}>
          <button type="button" class="c-ordenar" title="Ordenar" onClick=${() => alternar(c.chave)}>${c.rotulo}${ativo ? html`<${Ic} nome=${ordem.dir === 'asc' ? 'caret-up' : 'caret-down'} />` : null}</button></th>`;
  })}</tr></thead>
      <tbody>${fatia.map((l, i) => html`<tr key=${i}>${colunas.map((c) => html`<${Celula} key=${c.chave} coluna=${c} linha=${l} />`)}</tr>`)}</tbody>
      ${totais ? html`<tfoot><tr>${colunas.map((c, i) => html`<td key=${c.chave} class=${NUMERICOS.includes(c.tipo) ? 'c-num c-forte' : 'c-forte'}>${i === 0 ? `Total (${linhas.length})` : c.chave in totais ? formatarNumero(totais[c.chave], c.tipo) : ''}</td>`)}</tr></tfoot>` : null}
    </table>
    <div class="c-tabela-rodape">
      <span>${ordenadas.length > tamanho ? `${(atual * tamanho + 1).toLocaleString('pt-BR')}–${Math.min(ordenadas.length, atual * tamanho + tamanho).toLocaleString('pt-BR')} de ` : ''}${ordenadas.length.toLocaleString('pt-BR')} ${ordenadas.length === 1 ? 'linha' : 'linhas'}${ordenadoPor ? ` · ordenado por ${ordenadoPor}` : ''}${dados.aviso ? ` · ${dados.aviso}` : ''}</span>
      <span class="c-rh-paginas">
        <select class="c-entrada c-entrada--compacta" aria-label="Linhas por página" value=${tamanho} onChange=${(e) => setTamanho(Number(e.target.value))}>${TAMANHOS.map((t) => html`<option key=${t} value=${t}>${t} por página</option>`)}</select>
        ${paginas > 1 ? html`<button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" disabled=${atual === 0 || null} aria-label="Página anterior" title="Página anterior" onClick=${() => setPagina(atual - 1)}><${Ic} nome="caret-left" /></button>
        <span>${atual + 1} / ${paginas}</span>
        <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" disabled=${atual >= paginas - 1 || null} aria-label="Próxima página" title="Próxima página" onClick=${() => setPagina(atual + 1)}><${Ic} nome="caret-right" /></button>` : null}
      </span>
    </div>`;
}

// Telas com gráficos (Painel do WFM, Dashboard da Monitoria) quando a pessoa não abre a seção de origem; e atalhos.
function TelaEmbutida({ relatorio, controlador, filtros, showToast }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    let ativo = true;
    if (relatorio.tela === 'painel-wfm') import('../../modulos/operacao/wfm/relatorios.js?v=20261112-exporta-filtro').then((m) => ativo && setComp(() => m.PainelWfmHub));
    if (relatorio.tela === 'dashboard-monitoria') {
      Promise.all([import('../monitoria/painel.js?v=20261023-ajustes'), import('../monitoria/comum.js')]).then(([p, c]) => ativo && setComp(() => function Dashboard() {
        const { contexto, erro } = c.useContextoMonitoria();
        if (erro) return html`<${Estado} titulo=${erro} />`;
        if (!contexto) return html`<${Esqueleto} linhas=${6} />`;
        return html`<${p.TelaDashboard} controlador=${controlador} contexto=${contexto} showToast=${showToast} />`;
      }));
    }
    return () => { ativo = false; };
  }, [relatorio.tela]);
  if (relatorio.tela === 'atalho') {
    return html`<${Estado} icone="arrow-square-out" titulo=${relatorio.rotulo} texto=${relatorio.descricao} rotuloAcao=${`Abrir ${relatorio.rotulo}`} aoAcao=${() => controlador.irParaTelaProtegida(relatorio.destino)} />`;
  }
  if (!Comp) return html`<${Esqueleto} linhas=${6} />`;
  return html`<${Comp} operacao=${filtros.operacao} ini=${filtros.ini} fim=${filtros.fim} />`;
}

const Seletor = ({ rotulo, valor, opcoes, aoMudar, todos = 'Todos' }) => html`<select class="c-entrada c-entrada--compacta" aria-label=${rotulo} title=${rotulo} value=${valor} onChange=${(e) => aoMudar(e.target.value)}>
  ${todos === null ? null : html`<option value="">${todos}</option>`}${opcoes.map((o) => (Array.isArray(o) ? html`<option key=${o[0]} value=${o[0]}>${o[1]}</option>` : html`<option key=${o} value=${o}>${o}</option>`))}</select>`;

const FILTROS_PADRAO = () => { const [ini, fim] = PERIODOS.mes.calc(); return { preset: 'mes', ini, fim, operacao: '', operador: '', equipe: '', supervisor: '', status: '', busca: '' }; };

export function TelaRelatoriosHub({ controlador }) {
  const { showToast, ToastHost } = useToast();
  const usuario = controlador.estado?.usuarioAutenticado || '';
  // Sem useMemo: a lista de áreas inativas chega depois (GET /core/acesso) e a de permissões pode mudar com o perfil.
  const disponiveis = RELATORIOS.filter((r) => controlador.possuiPermissao(r.permissao) && controlador.possuiPermissao(PERMISSAO_BASE[r.id]) && !telaEmAreaInativa(r.origem));
  const porArea = AREAS.map((a) => ({ ...a, itens: disponiveis.filter((r) => r.area === a.id) })).filter((a) => a.itens.length);
  // Relatório com tela própria na seção: abre lá (se a pessoa abre a seção); senão, segue embutido aqui.
  const naSecao = (r) => (DESTINO_SECAO[r.id] && controlador.podeAcessarTela(DESTINO_SECAO[r.id]) ? DESTINO_SECAO[r.id] : null);
  const [selecionado, setSelecionado] = useState(() => {
    // Vem do link (?r=) ou de um redirecionamento de tela antiga (guardado só até ser lido).
    let guardado = '';
    try { guardado = window.sessionStorage.getItem(CHAVE_SELECAO_RELATORIO) || ''; window.sessionStorage.removeItem(CHAVE_SELECAO_RELATORIO); } catch { /* sem storage */ }
    return new URLSearchParams(window.location.search).get('r') || guardado;
  });
  const relatorio = disponiveis.find((r) => r.id === selecionado && !naSecao(r)) || disponiveis.find((r) => !naSecao(r)) || null;
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [operacoes, setOperacoes] = useState([]);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [exportando, setExportando] = useState(false);
  const [visiveis, setVisiveis] = useState([]);
  const linhasAtuais = useRef([]);
  const [nLinhas, setNLinhas] = useState(0);

  const escolher = (r) => {
    const destino = naSecao(r);
    if (destino) { controlador.irParaTelaProtegida(destino); return; }
    setSelecionado(r.id);
    setFiltros((f) => ({ ...FILTROS_PADRAO(), preset: f.preset, ini: f.ini, fim: f.fim }));
    window.history.replaceState(null, '', `/relatorios-historicos?r=${encodeURIComponent(r.id)}`);
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

  // Colunas visíveis: a escolha guardada da pessoa (se ainda valer para as colunas de agora) ou o padrão do relatório.
  const assinaturaColunas = dados ? dados.colunas.map((c) => c.rotulo).join('|') : '';
  useEffect(() => {
    if (!dados || !relatorio) return;
    const guardada = lerEscolha(usuario, relatorio.id);
    const rotulos = dados.colunas.map((c) => c.rotulo);
    const valida = guardada && guardada.filter((r) => rotulos.includes(r));
    setVisiveis(valida && valida.length ? [...new Set([...valida, ...rotulos.filter((r) => r === '_escala' || r === 'Escala')])] : colunasPadrao(relatorio.id, dados.colunas));
  }, [relatorio?.id, assinaturaColunas]);
  const mudarColunas = (lista) => { setVisiveis(lista); gravarEscolha(usuario, relatorio.id, lista); };

  const filtrosColuna = useMemo(() => ({ equipe: filtros.equipe, supervisor: filtros.supervisor, operador: relatorio?.area === 'wfm' ? '' : filtros.operador, status: filtros.status }), [filtros, relatorio]);
  const opcoesColuna = useCallback((campo) => {
    const coluna = dados?.colunas.find((c) => COLUNA_DO_FILTRO[campo].test(c.rotulo));
    if (!coluna) return null;
    return [...new Set(dados.linhas.map((l) => l[coluna.chave]).filter((v) => v !== '' && v !== null && v !== undefined).map(String))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [dados]);

  const exportar = async (formato) => {
    const linhas = linhasAtuais.current;
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
  const podeExportar = relatorio && !relatorio.tela && controlador.possuiPermissao(exportarPermissao(relatorio.id));
  const ehPlanilha = relatorio && !relatorio.tela;

  const faixaFiltros = relatorio && (relatorio.filtros || []).length ? html`
    <div class="c-filtros c-filtros--suave c-filtros--quebra">
      ${usa('operacao') && (opcoesOperacao.length > 1) ? html`<${Seletor} rotulo=${relatorio.area === 'wfm' ? 'Escala / operação' : 'Operação'} valor=${filtros.operacao} opcoes=${opcoesOperacao} aoMudar=${mudar('operacao')} todos=${relatorio.operacaoObrigatoria ? null : relatorio.area === 'wfm' ? 'Todas as escalas' : 'Todas as operações'} />` : null}
      ${usa('periodo') ? html`
        <${Seletor} rotulo="Período" valor=${filtros.preset} todos=${null} opcoes=${[...Object.entries(PERIODOS).map(([k, p]) => [k, p.rotulo]), ['personalizado', 'Personalizado']]}
          aoMudar=${(v) => setFiltros((f) => (v === 'personalizado' ? { ...f, preset: v } : { ...f, preset: v, ini: PERIODOS[v].calc()[0], fim: PERIODOS[v].calc()[1] }))} />
        ${filtros.preset === 'personalizado' ? html`
          <input class="c-entrada c-entrada--compacta" type="date" aria-label="De" title="De" value=${filtros.ini} max=${filtros.fim || undefined} onInput=${(e) => setFiltros((f) => ({ ...f, preset: 'personalizado', ini: e.target.value }))} />
          <input class="c-entrada c-entrada--compacta" type="date" aria-label="Até" title="Até" value=${filtros.fim} min=${filtros.ini || undefined} onInput=${(e) => setFiltros((f) => ({ ...f, preset: 'personalizado', fim: e.target.value }))} />` : null}` : null}
      ${['equipe', 'supervisor'].map((campo) => (usa(campo) && opcoesColuna(campo)?.length ? html`<${Seletor} key=${campo} rotulo=${ROTULO_FILTRO[campo]} valor=${filtros[campo]} opcoes=${opcoesColuna(campo)} aoMudar=${mudar(campo)} todos=${campo === 'equipe' ? 'Todas as equipes' : 'Todos os supervisores'} />` : null))}
      ${usa('operador') ? (opcoesOperador?.length ? html`<${Seletor} rotulo="Operador" valor=${filtros.operador} opcoes=${opcoesOperador} aoMudar=${mudar('operador')} todos="Todos os operadores" />`
        : opcoesColuna('operador')?.length ? html`<${Seletor} rotulo="Operador" valor=${filtros.operador} opcoes=${opcoesColuna('operador')} aoMudar=${mudar('operador')} todos="Todos os operadores" />` : null) : null}
      ${usa('status') && opcoesColuna('status')?.length ? html`<${Seletor} rotulo="Status" valor=${filtros.status} opcoes=${opcoesColuna('status')} aoMudar=${mudar('status')} todos="Todas as situações" />` : null}
      ${usa('busca') ? html`<div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar nas linhas" aria-label="Buscar nas linhas" value=${filtros.busca} onInput=${(e) => mudar('busca')(e.target.value)} /></div>` : null}
      ${ehPlanilha && dados && dados.colunas.length > 1 ? html`<${MenuColunas} colunas=${dados.colunas} visiveis=${visiveis} aoMudar=${mudarColunas} />` : null}
    </div>` : null;

  let corpo;
  if (!relatorio) corpo = html`<div class="c-tabela-caixa"><${Estado} icone="lock" titulo="Nenhum relatório liberado" texto="Seu perfil ainda não tem acesso a nenhum relatório ou histórico. Fale com o Administrador." /></div>`;
  else if (relatorio.tela) corpo = html`${faixaFiltros ? html`<div class="c-tabela-caixa">${faixaFiltros}</div>` : null}<${TelaEmbutida} key=${relatorio.id} relatorio=${relatorio} controlador=${controlador} filtros=${filtros} showToast=${showToast} />`;
  else {
    corpo = html`<div class="c-tabela-caixa">
      ${faixaFiltros}
      ${erro ? html`<${Estado} icone="warning" titulo=${erro} />`
    : !dados ? html`<${Esqueleto} linhas=${8} />`
      : html`${(dados.resumo || []).length ? html`<${Indicadores} resumo=${dados.resumo} />` : null}
        <${Planilha} key=${relatorio.id} relatorio=${relatorio} dados=${dados} filtrosColuna=${filtrosColuna} busca=${filtros.busca} visiveis=${visiveis} aoLinhas=${(l) => { linhasAtuais.current = l; setNLinhas(l.length); }}
          aoLimpar=${() => setFiltros((f) => ({ ...f, busca: '', equipe: '', supervisor: '', status: '', operador: relatorio.area === 'wfm' ? f.operador : '' }))}
          aoMesAnterior=${filtros.preset === 'mes' ? () => setFiltros((f) => ({ ...f, preset: 'anterior', ini: PERIODOS.anterior.calc()[0], fim: PERIODOS.anterior.calc()[1] })) : null} />`}
    </div>`;
  }

  return html`
    <${PainelRh} screenId="screen-relatorios" navAtiva="screen-relatorios" subtituloMarca="Relatórios e Históricos" placeholderBusca="Relatórios e Históricos" controlador=${controlador} buscaGlobal=${false}>
      <${ToastHost} />
      <main class="c-pagina c-conteudo">
        <div class="c-rel">
          <nav class="c-rel-lista" aria-label="Relatórios e históricos">
            ${porArea.map((a) => html`<h3 key=${`t-${a.id}`}>${a.rotulo}</h3>
              ${a.itens.map((r) => { const destino = naSecao(r); return html`<a key=${r.id} href=${destino ? '#' : `/relatorios-historicos?r=${encodeURIComponent(r.id)}`} title=${r.descricao}
                aria-current=${!destino && relatorio?.id === r.id ? 'page' : null} onClick=${(ev) => { ev.preventDefault(); escolher(r); }}>${r.rotulo}${destino ? html` <small>na seção ↗</small>` : null}</a>`; })}`)}
          </nav>
          <div class="c-rel-corpo" aria-live="polite">
            ${relatorio ? html`<div class="c-cab-linha"><h1 title=${relatorio.descricao}>${relatorio.rotulo}</h1>
              ${podeExportar && dados ? html`<div class="c-cab-dir"><${MenuExportar} desabilitado=${exportando || !nLinhas} exportando=${exportando} totalColunas=${dados.colunas.length} aoExportar=${exportar} /></div>` : null}</div>` : null}
            ${corpo}
          </div>
        </div>
      </main>
    </${PainelRh}>`;
}
