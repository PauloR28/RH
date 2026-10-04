import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { listarChamados } from '../../../services/api/chamados.js';
import {
  Avatar, EstadoErro, Icone, Paginacao, PillSla, PillStatus, PillUrgencia, TELA_NOVO, irParaChamado, tempoRelativo,
  useDebounce, useMetaChamados,
} from './comum.js';

// Aba "Chamados": o solicitante vê os próprios; com `chamados.ver_operacao` também alterna para "Da operação".
// Duas dimensões, nunca misturadas: escopo (Meus / Da operação) e fase (Em aberto / Resolvidos / Histórico).

const FASES = [
  { id: 'aberto', rotulo: 'Em aberto' },
  { id: 'resolvidos', rotulo: 'Resolvidos' },
  { id: 'historico', rotulo: 'Histórico' },
];
const TAMANHO = 10;

export function Indicador({ icone, valor, rotulo, tom = '' }) {
  return html`
    <div class=${`chm-kpi ${tom ? `chm-kpi--${tom}` : ''}`.trim()}>
      <span class="chm-kpi-icone"><${Icone} nome=${icone} grande=${true} /></span>
      <div><strong>${valor ?? '—'}</strong><small>${rotulo}</small></div>
    </div>`;
}

export function CelulaImpactados({ item }) {
  if (item.tipo_impacto === 'celula') {
    return html`<div class="chm-quem"><span class="chm-avatar chm-avatar--p chm-avatar--grupo"><${Icone} nome="group" /></span>Célula</div>`;
  }
  const nome = item.agente_primeiro || '';
  const extra = item.agentes_total > 1 ? ` +${item.agentes_total - 1}` : '';
  return nome ? html`<div class="chm-quem"><${Avatar} nome=${nome} pequeno=${true} /><span class="chm-trunca">${nome}${extra}</span></div>` : html`<span class="chm-muted">—</span>`;
}

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
  const buscaAtual = useDebounce(busca, 300);
  const operacoes = meta?.operacoes || [];

  const carregar = useCallback(() => {
    setErro('');
    listarChamados({ escopo, fase, q: buscaAtual, operacao: escopo === 'operacao' ? operacao : '', page: pagina, page_size: TAMANHO })
      .then(setDados)
      .catch((e) => setErro(e?.message || 'Não foi possível carregar os chamados.'));
  }, [escopo, fase, buscaAtual, operacao, pagina]);
  useEffect(carregar, [carregar]);
  useEffect(() => { setPagina(1); }, [escopo, fase, buscaAtual, operacao]);

  const resumo = dados?.resumo;
  const status = resumo?.por_status || {};
  const contagem = (id) => resumo?.fases?.[id];

  return html`
    <div class="chm-pagina">
      <div class="chm-kpis">
        <${Indicador} icone="inbox" valor=${resumo ? status.aberto || 0 : null} rotulo="Abertos" />
        <${Indicador} icone="schedule" valor=${resumo ? status.em_andamento || 0 : null} rotulo="Em andamento" />
        <${Indicador} icone="person" valor=${resumo ? status.aguardando_solicitante || 0 : null} rotulo=${escopo === 'meus' ? 'Aguardando você' : 'Aguardando solicitante'} tom="warn" />
        <${Indicador} icone="check_circle" valor=${resumo ? resumo.resolvidos_mes : null} rotulo="Resolvidos no mês" tom="ok" />
      </div>

      <section class="chm-card chm-card--tabela">
        <div class="chm-toolbar">
          ${podeOperacao ? html`
            <div class="chm-seg" role="tablist" aria-label="Escopo">
              <button type="button" role="tab" aria-selected=${escopo === 'meus'} class=${escopo === 'meus' ? 'is-on' : ''} onClick=${() => setEscopo('meus')}>Meus chamados</button>
              <button type="button" role="tab" aria-selected=${escopo === 'operacao'} class=${escopo === 'operacao' ? 'is-on' : ''} onClick=${() => setEscopo('operacao')}>Da operação</button>
            </div>` : null}
          <label class="chm-busca">
            <${Icone} nome="search" />
            <input type="search" value=${busca} placeholder="Buscar por número ou assunto" aria-label="Buscar chamados" onInput=${(e) => setBusca(e.target.value)} />
          </label>
          ${escopo === 'operacao' && operacoes.length > 1 ? html`
            <select class="chm-select" aria-label="Operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
              <option value="">Todas as operações</option>
              ${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}
            </select>` : null}
        </div>
        <div class="chm-toolbar chm-toolbar--sub">
          <div class="chm-seg" role="tablist" aria-label="Fase">
            ${FASES.map((f) => html`
              <button type="button" role="tab" key=${f.id} aria-selected=${fase === f.id} class=${fase === f.id ? 'is-on' : ''} onClick=${() => setFase(f.id)}>
                ${f.rotulo}${contagem(f.id) !== undefined ? html` <span class="chm-cnt">${contagem(f.id)}</span>` : null}
              </button>`)}
          </div>
        </div>

        ${erro || erroMeta ? html`<${EstadoErro} erro=${erro || erroMeta} aoTentar=${carregar} />` : null}
        ${!dados && !erro ? html`<${LoadingState} titulo="Carregando chamados" />` : null}
        ${dados && !dados.itens.length ? html`
          <${EmptyState} icon="inbox"
            title=${fase === 'aberto' ? 'Nenhum chamado em aberto' : fase === 'resolvidos' ? 'Nenhum chamado resolvido' : 'Nenhum chamado no histórico'}
            text=${buscaAtual ? 'Nenhum resultado para a busca.' : fase === 'aberto' ? 'Tudo certo por aqui. Quando precisar, abra um chamado.' : 'Os chamados aparecem aqui quando houver.'}
            action=${controlador.possuiPermissao('chamados.abrir') && fase === 'aberto' ? { label: 'Novo chamado', icon: 'add', onClick: () => controlador.irParaTelaProtegida(TELA_NOVO) } : null} />` : null}
        ${dados && dados.itens.length ? html`
          <div class="chm-tabela-wrap">
            <table class="chm-tabela">
              <thead><tr>
                <th style=${{ width: '34%' }}>Chamado</th><th>Impactados</th><th>PA</th><th>Urgência</th><th>Status</th><th>SLA</th><th>Atualizado</th>
              </tr></thead>
              <tbody>
                ${dados.itens.map((item) => html`
                  <tr key=${item.id} class=${`chm-linha ${item.status === 'resolvido' && fase === 'resolvidos' ? 'is-destaque' : ''}`.trim()} tabIndex="0"
                    onClick=${() => irParaChamado(item.id)} onKeyDown=${(e) => { if (e.key === 'Enter') irParaChamado(item.id); }}>
                    <td><div class="chm-assunto"><b>#${item.numero}</b> ${item.titulo}</div>
                      <span class="chm-sub">${item.categoria}${escopo === 'operacao' ? ` · ${item.solicitante.nome}` : ''}</span></td>
                    <td><${CelulaImpactados} item=${item} /></td>
                    <td>${item.pa_posto || '—'}</td>
                    <td><${PillUrgencia} urgencia=${item.urgencia} /></td>
                    <td><${PillStatus} status=${item.status} rotulo=${item.status === 'aguardando_solicitante' && escopo === 'meus' ? 'Aguardando você' : ''} /></td>
                    <td><${PillSla} item=${item} /></td>
                    <td class="chm-muted">${tempoRelativo(item.atualizado_em)}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
          <${Paginacao} pagina=${pagina} tamanho=${TAMANHO} total=${dados.total} aoMudar=${setPagina} />` : null}
      </section>
      <p class="chm-rodape">Operadores devem reportar o problema ao seu supervisor.</p>
    </div>`;
}
