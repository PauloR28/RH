import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { listarChamados } from '../../../services/api/chamados.js?v=20261005-redesign16';
import { DataTable, SplitView, Toolbar } from '../../../ui/components/layout-primitivas.js?v=20261005-redesign16';
import { DetalheChamado } from './detalhe.js?v=20261005-redesign16';
import { Pill, PillStatus, RodapePaginacao, formatarDataHora, useDebounce, useMetaChamados } from './comum.js?v=20261005-redesign16';

// Aba "Chamados": lista + detalhe lado a lado (abaixo de 1280px o detalhe abre em painel sobre a lista).
// Duas dimensões, nunca misturadas: escopo (Meus / Da operação) e fase (Em aberto / Resolvidos / Histórico).

const FASES = [
  { id: 'aberto', rotulo: 'Em aberto' },
  { id: 'resolvidos', rotulo: 'Resolvidos' },
  { id: 'historico', rotulo: 'Histórico' },
];
const TAMANHO = 15;

export function ListaChamados({ controlador, showToast }) {
  const { meta, erro: erroMeta } = useMetaChamados();
  const podeOperacao = controlador.possuiPermissao('chamados.ver_operacao');
  const [escopo, setEscopo] = useState('meus');
  const [fase, setFase] = useState('aberto');
  const [busca, setBusca] = useState('');
  const [operacao, setOperacao] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [selecionado, setSelecionado] = useState(null);
  const buscaAtual = useDebounce(busca, 300);
  const operacoes = meta?.operacoes || [];

  const carregar = useCallback(() => {
    setErro('');
    listarChamados({ escopo, fase, q: buscaAtual, operacao: escopo === 'operacao' ? operacao : '', page: pagina, page_size: TAMANHO })
      .then(setDados)
      .catch((e) => setErro(e?.message || 'Não foi possível carregar os chamados.'));
  }, [escopo, fase, buscaAtual, operacao, pagina]);
  useEffect(carregar, [carregar]);
  useEffect(() => { setPagina(1); setSelecionado(null); }, [escopo, fase, buscaAtual, operacao]);

  const contagem = (id) => dados?.resumo?.fases?.[id];
  const nomeOperacao = (chave) => operacoes.find((o) => o.chave === chave)?.nome || chave;

  const colunas = [
    { chave: 'numero', rotulo: 'ID', prioridade: 1, fixa: true, largura: '80px', alinhar: 'direita', render: (c) => `#${c.numero}` },
    { chave: 'operacao', rotulo: 'Operação', prioridade: 3, largura: '144px', render: (c) => nomeOperacao(c.operacao) },
    { chave: 'solicitante', rotulo: 'Solicitante', prioridade: 2, largura: '176px', render: (c) => c.solicitante?.nome },
    { chave: 'titulo', rotulo: 'Título', prioridade: 1,
      render: (c) => html`<span title=${c.titulo}>${c.titulo}</span>${c.reaberto_vezes ? html` <${Pill} tom="warn" semPonto=${true}>Reaberto ${c.reaberto_vezes}×</${Pill}>` : ''}` },
    { chave: 'status', rotulo: 'Status', prioridade: 1, largura: '176px',
      render: (c) => html`<${PillStatus} status=${c.status} rotulo=${c.status === 'aguardando_solicitante' && escopo === 'meus' ? 'Aguardando você' : ''} />` },
    { chave: 'criado_em', rotulo: 'Data inicial', prioridade: 2, largura: '128px', render: (c) => formatarDataHora(c.criado_em) },
  ];

  const filtros = html`
    ${podeOperacao ? html`
      <div class="chm-seg" role="tablist" aria-label="Escopo">
        <button type="button" role="tab" aria-selected=${escopo === 'meus'} class=${escopo === 'meus' ? 'is-on' : ''} onClick=${() => setEscopo('meus')}>Meus chamados</button>
        <button type="button" role="tab" aria-selected=${escopo === 'operacao'} class=${escopo === 'operacao' ? 'is-on' : ''} onClick=${() => setEscopo('operacao')}>Da operação</button>
      </div>` : null}
    <div class="chm-seg" role="tablist" aria-label="Fase">
      ${FASES.map((f) => html`
        <button type="button" role="tab" key=${f.id} aria-selected=${fase === f.id} class=${fase === f.id ? 'is-on' : ''} onClick=${() => setFase(f.id)}>
          ${f.rotulo}${contagem(f.id) !== undefined ? html` <span class="chm-cnt">${contagem(f.id)}</span>` : null}
        </button>`)}
    </div>
    ${escopo === 'operacao' && operacoes.length > 1 ? html`
      <select aria-label="Operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
        <option value="">Todas as operações</option>
        ${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
      </select>` : null}`;

  const vazioTexto = buscaAtual ? 'Nenhum resultado para a busca.'
    : fase === 'aberto' ? 'Nenhum chamado em aberto.' : fase === 'resolvidos' ? 'Nenhum chamado resolvido.' : 'Nenhum chamado no histórico.';

  const lista = html`
    <${Toolbar} busca=${busca} aoBuscar=${setBusca} placeholder="Buscar por número ou título" filtros=${filtros}
      fim=${dados ? `${dados.total} chamado${dados.total === 1 ? '' : 's'}` : ''} />
    <${DataTable} colunas=${colunas} linhas=${dados?.itens || []} aoClicarLinha=${(c) => setSelecionado(c.id)} carregando=${!dados && !erro && !erroMeta}
      erro=${erro || erroMeta || ''} aoTentar=${carregar}
      vazio=${{ texto: vazioTexto }}
      rodape=${dados ? html`<${RodapePaginacao} pagina=${pagina} tamanho=${TAMANHO} total=${dados.total} aoMudar=${setPagina} />` : null} />`;

  return html`
    <${SplitView} lista=${lista} aberto=${Boolean(selecionado)} aoFechar=${() => setSelecionado(null)} tituloDetalhe="Chamado"
      detalhe=${selecionado ? html`<${DetalheChamado} key=${selecionado} id=${selecionado} controlador=${controlador} showToast=${showToast} embutido=${true}
        aoMudar=${carregar} />` : null} />`;
}
