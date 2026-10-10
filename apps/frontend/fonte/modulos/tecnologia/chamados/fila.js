import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { assumirChamado, listarFilaChamados } from '../../../services/api/chamados.js?v=20261005-redesign16';
import { listarOperacoes } from '../../../services/api/operations.js';
import { DataTable, SplitView, Toolbar } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { DetalheChamado } from './detalhe.js?v=20261005-redesign16';
import {
  ORDEM_URGENCIA, PillSla, PillStatus, PillUrgencia, RodapePaginacao, ROTULO_STATUS, ROTULO_URGENCIA, useDebounce, useMetaChamados,
} from './comum.js?v=20261005-redesign16';

// Fila do Suporte (`chamados.atender`): todos os chamados, SLA vencido primeiro, depois urgência e prazo mais próximo.

const TAMANHO = 15;
const STATUS_FILTRO = ['aberto', 'em_andamento', 'aguardando_solicitante', 'resolvido', 'encerrado', 'cancelado'];
const ATIVOS = ['aberto', 'em_andamento', 'aguardando_solicitante'];

export function FilaChamados({ controlador, showToast }) {
  const { meta } = useMetaChamados();
  const [filtros, setFiltros] = useState({ q: '', status: '', urgencia: '', categoria_id: '', operacao: '', sem_responsavel: false });
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [operacoes, setOperacoes] = useState([]);
  const [selecionado, setSelecionado] = useState(null);
  const q = useDebounce(filtros.q, 300);

  useEffect(() => {
    listarOperacoes()
      .then((r) => {
        const lista = Array.isArray(r) ? r : r?.itens || [];
        setOperacoes(lista.filter((o) => o.chave).map((o) => ({ chave: o.chave, nome: o.nome || o.chave })));
      })
      .catch(() => setOperacoes([]));
  }, []);

  const carregar = useCallback(() => {
    setErro('');
    listarFilaChamados({ ...filtros, q, page: pagina, page_size: TAMANHO })
      .then(setDados)
      .catch((e) => setErro(e?.message || 'Não foi possível carregar a fila.'));
  }, [filtros.status, filtros.urgencia, filtros.categoria_id, filtros.operacao, filtros.sem_responsavel, q, pagina]);
  useEffect(carregar, [carregar]);
  useEffect(() => { setPagina(1); }, [filtros.status, filtros.urgencia, filtros.categoria_id, filtros.operacao, filtros.sem_responsavel, q]);

  const mudar = (parcial) => setFiltros((f) => ({ ...f, ...parcial }));
  const semResp = dados?.resumo?.sem_responsavel;
  const assumir = async (item) => {
    try {
      await assumirChamado(item.id);
      showToast(`Você assumiu o chamado #${item.numero}.`, 'success');
      carregar();
    } catch (ex) {
      showToast(ex?.message || 'Não foi possível assumir o chamado.', 'error');
    }
  };
  const nomeOperacao = (chave) => operacoes.find((o) => o.chave === chave)?.nome || chave;

  const colunas = [
    { chave: 'numero', rotulo: 'ID', prioridade: 1, fixa: true, largura: '80px', alinhar: 'direita', render: (c) => `#${c.numero}` },
    { chave: 'titulo', rotulo: 'Título', prioridade: 1, render: (c) => html`<span title=${c.titulo}>${c.titulo}</span>` },
    { chave: 'operacao', rotulo: 'Operação', prioridade: 3, largura: '144px', render: (c) => nomeOperacao(c.operacao) },
    { chave: 'urgencia', rotulo: 'Urgência', prioridade: 1, largura: '112px', render: (c) => html`<${PillUrgencia} urgencia=${c.urgencia} />` },
    { chave: 'status', rotulo: 'Status', prioridade: 2, largura: '176px', render: (c) => html`<${PillStatus} status=${c.status} />` },
    { chave: 'sla', rotulo: 'SLA', prioridade: 1, largura: '160px', render: (c) => html`<${PillSla} item=${c} />` },
    { chave: 'responsavel', rotulo: 'Responsável', prioridade: 2, largura: '160px', render: (c) => c.responsavel?.nome || html`<span class="chm-muted">Sem responsável</span>` },
    { chave: 'acao', rotulo: '', prioridade: 2, largura: '96px', alinhar: 'direita',
      render: (c) => (!c.responsavel && ATIVOS.includes(c.status)
        ? html`<button type="button" class="btn btn-sm btn-primary" onClick=${(e) => { e.stopPropagation(); assumir(c); }}>Assumir</button>` : '') },
  ];

  const filtrosUi = html`
    <div class="chm-fila-selects">    <select aria-label="Status" value=${filtros.status} onChange=${(e) => mudar({ status: e.target.value })}>
      <option value="">Status</option>${STATUS_FILTRO.map((s) => html`<option key=${s} value=${s}>${ROTULO_STATUS[s]}</option>`)}</select>
    <select aria-label="Urgência" value=${filtros.urgencia} onChange=${(e) => mudar({ urgencia: e.target.value })}>
      <option value="">Urgência</option>${[...ORDEM_URGENCIA].reverse().map((u) => html`<option key=${u} value=${u}>${ROTULO_URGENCIA[u]}</option>`)}</select>
    <select aria-label="Categoria" value=${filtros.categoria_id} onChange=${(e) => mudar({ categoria_id: e.target.value })}>
      <option value="">Categoria</option>${(meta?.categorias || []).map((c) => html`<option key=${c.id} value=${c.id}>${c.nome}</option>`)}</select>
    <select aria-label="Operação" value=${filtros.operacao} onChange=${(e) => mudar({ operacao: e.target.value })}>
      <option value="">Operação</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>
    </div>
    <div class="chm-seg" role="tablist" aria-label="Responsável">
      <button type="button" role="tab" aria-selected=${!filtros.sem_responsavel} class=${!filtros.sem_responsavel ? 'is-on' : ''} onClick=${() => mudar({ sem_responsavel: false })}>Todos</button>
      <button type="button" role="tab" aria-selected=${filtros.sem_responsavel} class=${filtros.sem_responsavel ? 'is-on' : ''} onClick=${() => mudar({ sem_responsavel: true })}>
        Sem responsável${semResp !== undefined ? html` <span class="chm-cnt">${semResp}</span>` : null}</button>
    </div>`;

  const lista = html`<div class="chm-fila">
    <${Toolbar} busca=${filtros.q} aoBuscar=${(valor) => mudar({ q: valor })} placeholder="Buscar por número ou título"
      fim=${dados ? `${dados.total} chamado${dados.total === 1 ? '' : 's'}` : ''} />
    <div class="chm-fila-filtros">${filtrosUi}</div>
    <${DataTable} colunas=${colunas} linhas=${dados?.itens || []} aoClicarLinha=${(c) => setSelecionado(c.id)} carregando=${!dados && !erro} erro=${erro} aoTentar=${carregar}
      vazio=${{ texto: 'Fila vazia: nenhum chamado corresponde aos filtros.' }}
      rodape=${dados ? html`<${RodapePaginacao} pagina=${pagina} tamanho=${TAMANHO} total=${dados.total} aoMudar=${setPagina} />` : null} /></div>`;

  return html`
    <${SplitView} lista=${lista} aberto=${Boolean(selecionado)} aoFechar=${() => setSelecionado(null)} tituloDetalhe="Chamado"
      detalhe=${selecionado ? html`<${DetalheChamado} key=${selecionado} id=${selecionado} controlador=${controlador} showToast=${showToast} embutido=${true}
        aoMudar=${carregar} />` : null} />`;
}
