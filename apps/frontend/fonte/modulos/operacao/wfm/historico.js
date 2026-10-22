import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import { PaginaConsole, CardDados, EsqueletoLinhas, EstadoConsole, IconeCx, MenuExportar, SeletorPeriodoCx } from '../../../ui/components/console-primitivas.js?v=20261022-equipes';
import { ModuleHeader } from '../../../ui/components/modulo-primitivas.js?v=20261015-modulo8';
import { exportarHistoricoWfm, listarHistoricoWfm, opcoesHistoricoWfm } from '../../../services/api/wfm.js?v=20261020-dias';
import { baixarArquivo } from '../../../features/monitoria/comum.js';

// Histórico (antiga "Auditoria de Plantões"): quem fez o quê, quando, e o valor antes e depois.
// Lista com cursor (8 na primeira carga, +20 em "Ver mais"), seleção por id que sobrevive ao "Ver mais",
// exportação (XLSX/CSV/PDF) gerada no servidor. Hora início/fim e supervisor vêm do plantão ligado ao registro.

const ENTIDADES = ['escala', 'escala_item', 'presenca', 'atestado', 'contrato', 'turno', 'skill', 'calendario_especial', 'operador', 'tipo_escala'];
const PRIMEIRA_PAGINA = 8;
const PROXIMAS_PAGINAS = 20;

const doisDigitos = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
export function mesCorrente(hoje = new Date()) {
  return { ini: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)) };
}
const FILTROS_INICIAIS = () => ({ texto: '', operacao: '', entidade: '', operador: '', supervisor: '', ...mesCorrente() });

const PASSO = (p) => (p ? `${p.nome || '—'} · ${p.data.slice(0, 5)} às ${p.hora}` : '—');

function ListaPares({ pares, limite }) {
  if (!pares?.length) return html`<span class="cx-muted">—</span>`;
  const mostrados = limite ? pares.slice(0, limite) : pares;
  return html`${mostrados.map((p, i) => html`<span key=${i} class="cx-hist-par cx-trunca" title=${p.rotulo ? `${p.rotulo}: ${p.valor}` : p.valor}>${p.rotulo ? `${p.rotulo}: ` : ''}${p.valor}</span>`)}`;
}

function Detalhes({ item, id }) {
  const t = item.troca;
  return html`
    <div class="cx-hist-detalhes" id=${id}>
      ${item.eh_troca
      ? html`
        <div><span class="cx-hist-rot">Registrado em</span><span>${item.registrado_em}</span></div>
        <div><span class="cx-hist-rot">Quem solicitou</span><span>${PASSO(t?.solicitou)}</span></div>
        <div><span class="cx-hist-rot">Quem aceitou</span><span>${PASSO(t?.aceitou)}</span></div>
        <div><span class="cx-hist-rot">Supervisor que trocou</span><span>${PASSO(t?.efetivou)}</span></div>`
      : html`
        <div><span class="cx-hist-rot">Registrado em</span><span>${item.registrado_em}</span></div>
        <div><span class="cx-hist-rot">Operador</span><span>${item.operador || '—'}${item.perfil ? ` · ${item.perfil}` : ''}</span></div>
        <div><span class="cx-hist-rot">Supervisor</span><span>${item.supervisor || '—'}</span></div>
        <div><span class="cx-hist-rot">Entidade</span><span>${item.entidade}${item.entidade_id ? ` · ${item.entidade_id}` : ''}</span></div>`}
      <div class="cx-hist-span2"><span class="cx-hist-rot">Antes</span><span>${item.antes_texto || '—'}</span></div>
      <div><span class="cx-hist-rot">Depois</span><span>${item.depois_texto || '—'}</span></div>
      <div><span class="cx-hist-rot">Justificativa</span><span>${item.justificativa || '—'}</span></div>
    </div>`;
}

export function TelaHistorico({ contexto, showToast }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [textoDigitado, setTextoDigitado] = useState('');
  const [opcoes, setOpcoes] = useState({ operadores: [], supervisores: [] });
  const [itens, setItens] = useState(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [temMais, setTemMais] = useState(false);
  const [erro, setErro] = useState('');
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [abertos, setAbertos] = useState(() => new Set());
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [exportando, setExportando] = useState(false);
  const [erroExportacao, setErroExportacao] = useState(null);
  const cabecalhoCheck = useRef(null);

  // Busca de texto espera ~300 ms depois da última tecla; os demais filtros aplicam na hora.
  useEffect(() => {
    if (textoDigitado === filtros.texto) return undefined;
    const espera = window.setTimeout(() => setFiltros((f) => ({ ...f, texto: textoDigitado })), 300);
    return () => window.clearTimeout(espera);
  }, [textoDigitado, filtros.texto]);

  useEffect(() => {
    let ativo = true;
    opcoesHistoricoWfm(filtros.operacao).then((r) => { if (ativo && r) setOpcoes({ operadores: r.operadores || [], supervisores: r.supervisores || [] }); }).catch(() => {});
    return () => { ativo = false; };
  }, [filtros.operacao]);

  const consulta = useMemo(() => ({
    texto: filtros.texto, operacao: filtros.operacao, entidade: filtros.entidade, operador: filtros.operador,
    supervisor: filtros.supervisor, data_ini: filtros.ini, data_fim: filtros.fim,
  }), [filtros]);

  // Primeira carga (e a cada mudança de filtro): zera a lista, a seleção e os painéis abertos.
  useEffect(() => {
    let ativo = true;
    setItens(null);
    setErro('');
    setSelecionados(new Set());
    setAbertos(new Set());
    listarHistoricoWfm({ ...consulta, limite: PRIMEIRA_PAGINA })
      .then((r) => { if (!ativo) return; setItens(r.itens || []); setTotal(r.total || 0); setCursor(r.proximo_cursor || null); setTemMais(Boolean(r.tem_mais)); })
      .catch((e) => { if (ativo) setErro(e?.message || 'Não foi possível carregar o Histórico.'); });
    return () => { ativo = false; };
  }, [consulta, tentativa]);

  const verMais = useCallback(async () => {
    if (!cursor || carregandoMais) return;
    setCarregandoMais(true);
    try {
      const r = await listarHistoricoWfm({ ...consulta, cursor, limite: PROXIMAS_PAGINAS });
      setItens((atual) => [...(atual || []), ...(r.itens || [])]);  // acrescenta; não apaga o que já está na tela
      setTotal(r.total || 0);
      setCursor(r.proximo_cursor || null);
      setTemMais(Boolean(r.tem_mais));
    } catch (e) {
      showToast?.(e?.message || 'Não foi possível carregar mais registros.', 'error');
    } finally { setCarregandoMais(false); }
  }, [cursor, carregandoMais, consulta, showToast]);

  const alternarAberto = (id) => setAbertos((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo; });
  const alternarSelecao = (id) => setSelecionados((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo; });
  const todosMarcados = Boolean(itens?.length) && itens.every((i) => selecionados.has(i.id));
  const algumMarcado = Boolean(itens?.some((i) => selecionados.has(i.id)));
  useEffect(() => { if (cabecalhoCheck.current) cabecalhoCheck.current.indeterminate = algumMarcado && !todosMarcados; }, [algumMarcado, todosMarcados]);
  const alternarTodos = () => setSelecionados((atual) => {
    const novo = new Set(atual);
    if (todosMarcados) (itens || []).forEach((i) => novo.delete(i.id)); else (itens || []).forEach((i) => novo.add(i.id));
    return novo;
  });

  const exportar = async ({ formato, escopo }) => {
    setExportando(true);
    setErroExportacao(null);
    try {
      const arquivo = await exportarHistoricoWfm({ ...consulta, formato, escopo, ids: escopo === 'selecionados' ? [...selecionados] : [] });
      baixarArquivo(arquivo);
      showToast?.('Arquivo gerado.', 'success');
    } catch (e) {
      setErroExportacao({ mensagem: e?.message || 'Não foi possível exportar.', repetir: () => exportar({ formato, escopo }) });
    } finally { setExportando(false); }
  };

  const mudar = (campo) => (ev) => setFiltros((f) => ({ ...f, [campo]: ev.target.value }));
  const limparFiltros = () => { setTextoDigitado(''); setFiltros(FILTROS_INICIAIS()); };
  const nSel = selecionados.size;

  const corpo = () => {
    if (erro) return html`<${EstadoConsole} mensagem=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => setTentativa((t) => t + 1)} />`;
    if (!itens) return html`<${EsqueletoLinhas} linhas=${8} altura=${50} />`;
    if (!itens.length) return html`<${EstadoConsole} mensagem="Nenhum registro para este filtro" rotuloAcao="Limpar filtros" aoAcao=${limparFiltros} />`;
    return html`
      <table class="cx-tabela cx-hist-tabela">
        <colgroup><col style=${{ width: '36px' }} /><col style=${{ width: '92px' }} /><col style=${{ width: '80px' }} /><col style=${{ width: '80px' }} /><col style=${{ width: '128px' }} /><col style=${{ width: '128px' }} /><col style=${{ width: '140px' }} /><col style=${{ width: '140px' }} /><col class="cx-hist-ad" /><col class="cx-hist-ad" /><col style=${{ width: '104px' }} /></colgroup>
        <thead><tr>
          <th scope="col" class="cx-col-check"><input ref=${cabecalhoCheck} type="checkbox" aria-label="Selecionar todas as linhas carregadas" checked=${todosMarcados} onChange=${alternarTodos} /></th>
          <th scope="col">Data</th><th scope="col">Hora início</th><th scope="col">Hora final</th><th scope="col">Operador</th><th scope="col">Supervisor</th>
          <th scope="col">Ação</th><th scope="col">Entidade</th><th scope="col" class="cx-hist-ad">Antes</th><th scope="col" class="cx-hist-ad">Depois</th><th scope="col"><span class="cx-sr">Detalhes</span></th>
        </tr></thead>
        <tbody>${itens.map((i) => {
    const aberto = abertos.has(i.id);
    const idPainel = `hist-detalhes-${i.id}`;
    return html`
          <tr key=${i.id} class=${`cx-hist-linha ${selecionados.has(i.id) ? 'is-sel' : ''}`.trim()}>
            <td class="cx-col-check"><input type="checkbox" aria-label=${`Selecionar registro ${i.id}`} checked=${selecionados.has(i.id)} onChange=${() => alternarSelecao(i.id)} /></td>
            <td>${i.data}</td>
            <td>${i.hora_inicio || '—'}</td>
            <td>${i.hora_fim || '—'}</td>
            <td><div class="cx-linha-nome cx-trunca" title=${i.operador}>${i.operador || '—'}</div><div class="cx-linha-sub cx-trunca" title=${i.perfil}>${i.perfil}</div></td>
            <td><div class="cx-trunca" title=${i.supervisor}>${i.supervisor || '—'}</div></td>
            <td><span class="cx-hist-acao"><span class=${`cx-ponto cx-ponto--${['presente', 'troca'].includes(i.acao_tom) ? i.acao_tom : 'neutro'}`} aria-hidden="true"></span><span class="cx-trunca" title=${i.acao_nome}>${i.acao_nome}</span></span></td>
            <td><div class="cx-trunca" title=${i.entidade}>${i.entidade}</div><div class="cx-linha-sub cx-trunca" title=${i.entidade_id}>${i.entidade_id}</div></td>
            <td class="cx-hist-valor cx-hist-ad"><${ListaPares} pares=${i.antes} limite=${2} /></td>
            <td class="cx-hist-valor cx-hist-ad"><${ListaPares} pares=${i.depois} limite=${2} /></td>
            <td class="cx-col-num"><button type="button" class="cx-btn cx-btn--texto cx-btn--sm" aria-expanded=${aberto} aria-controls=${idPainel} onClick=${() => alternarAberto(i.id)}>${aberto ? 'Ver menos' : 'Ver mais'}<span class=${`cx-seta ${aberto ? 'is-aberta' : ''}`}><${IconeCx} nome="expand_more" /></span></button></td>
          </tr>
          ${aberto ? html`<tr key=${`d${i.id}`} class="cx-hist-linha-detalhe"><td colSpan="11"><${Detalhes} item=${i} id=${idPainel} /></td></tr>` : null}`;
  })}</tbody>
      </table>`;
  };

  const rodape = itens?.length ? html`
    <span>Mostrando ${itens.length} de ${total} registros</span>
    <span class="cx-rodape-espaco"></span>
    ${temMais ? html`<button type="button" class="cx-btn cx-btn--suave cx-btn--sm" disabled=${carregandoMais} onClick=${verMais}>${carregandoMais ? 'Carregando...' : `Ver mais ${PROXIMAS_PAGINAS} registros`}<${IconeCx} nome="expand_more" /></button>` : null}
    <span class="cx-rodape-espaco"></span>` : null;

  return html`
    <${PaginaConsole} className="cx-pagina--modulo">
      <${ModuleHeader} titulo="Histórico" subtitulo="Quem fez o quê, quando, e o valor antes e depois."
        abas=${html`<${MenuExportar} totalFiltro=${total} totalSelecionados=${nSel} aoExportar=${exportar} carregando=${exportando} />`} />
      <div class="cx-hist-filtros cx-fixo" role="search">
        <label class="cx-busca"><${IconeCx} nome="search" /><input type="search" value=${textoDigitado} placeholder="Buscar por operador, supervisor ou entidade" aria-label="Buscar por operador, supervisor ou entidade" onInput=${(e) => setTextoDigitado(e.target.value)} /></label>
        <select class="cx-select" aria-label="Operação" value=${filtros.operacao} onChange=${mudar('operacao')}>
          <option value="">Operação: Todas</option>${(contexto?.operacoes || []).map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>
        <select class="cx-select" aria-label="Entidade" value=${filtros.entidade} onChange=${mudar('entidade')}>
          <option value="">Entidade: Todas</option>${ENTIDADES.map((e) => html`<option key=${e} value=${e}>${e}</option>`)}</select>
        <select class="cx-select" aria-label="Operador" value=${filtros.operador} onChange=${mudar('operador')}>
          <option value="">Operador: Todos</option>${opcoes.operadores.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>
        <select class="cx-select" aria-label="Supervisor" value=${filtros.supervisor} onChange=${mudar('supervisor')}>
          <option value="">Supervisor: Todos</option>${opcoes.supervisores.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>
        <${SeletorPeriodoCx} ini=${filtros.ini} fim=${filtros.fim} aoMudar=${(ini, fim) => setFiltros((f) => ({ ...f, ini, fim }))} />
      </div>
      <div class=${`cx-hist-selecao cx-fixo ${nSel ? 'is-ativa' : ''}`.trim()} role="status" aria-live="polite">
        <span>${nSel ? `${nSel} ${nSel === 1 ? 'item selecionado' : 'itens selecionados'}` : 'Nenhum item selecionado — marque as linhas para exportar só o que precisa'}</span>
        ${nSel ? html`<button type="button" class="cx-btn cx-btn--texto cx-btn--sm" onClick=${() => setSelecionados(new Set())}>Limpar seleção</button>` : null}
        <span class="cx-rodape-espaco"></span>
        <span>${total} registros no filtro atual</span>
        <span class="cx-hist-ordem">Ordem: mais recentes primeiro</span>
      </div>
      ${erroExportacao ? html`<div class="alert alert-danger c24-feedback cx-fixo" role="alert">${erroExportacao.mensagem} <button type="button" class="cx-btn cx-btn--sm" onClick=${erroExportacao.repetir}>Tentar de novo</button></div>` : null}
      <${CardDados} className="cx-cresce cx-hist-card" rotulo="Histórico" rodape=${rodape}>${corpo()}</${CardDados}>
    </${PaginaConsole}>`;
}
