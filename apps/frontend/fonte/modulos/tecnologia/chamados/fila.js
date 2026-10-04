import { html, useCallback, useEffect, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { assumirChamado, listarFilaChamados } from '../../../services/api/chamados.js';
import { listarOperacoes } from '../../../services/api/operations.js';
import {
  Avatar, EstadoErro, Icone, ORDEM_URGENCIA, Paginacao, PillSla, PillStatus, PillUrgencia, ROTULO_STATUS, ROTULO_URGENCIA, irParaChamado,
  useDebounce, useMetaChamados,
} from './comum.js';

// Fila do Suporte (`chamados.atender`): todos os chamados, SLA vencido primeiro, depois urgência e prazo mais próximo.

const TAMANHO = 15;
const STATUS_FILTRO = ['aberto', 'em_andamento', 'aguardando_solicitante', 'resolvido', 'encerrado', 'cancelado'];

export function FilaChamados({ showToast }) {
  const { meta } = useMetaChamados();
  const [filtros, setFiltros] = useState({ q: '', status: '', urgencia: '', categoria_id: '', operacao: '', sem_responsavel: false });
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [operacoes, setOperacoes] = useState([]);
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

  return html`
    <div class="chm-pagina">
      <section class="chm-card chm-card--tabela">
        <div class="chm-toolbar chm-toolbar--filtros">
          <label class="chm-busca">
            <${Icone} nome="search" />
            <input type="search" value=${filtros.q} placeholder="Buscar por número ou assunto" aria-label="Buscar na fila" onInput=${(e) => mudar({ q: e.target.value })} />
          </label>
          <select class="chm-select" aria-label="Status" value=${filtros.status} onChange=${(e) => mudar({ status: e.target.value })}>
            <option value="">Status</option>${STATUS_FILTRO.map((s) => html`<option key=${s} value=${s}>${ROTULO_STATUS[s]}</option>`)}</select>
          <select class="chm-select" aria-label="Urgência" value=${filtros.urgencia} onChange=${(e) => mudar({ urgencia: e.target.value })}>
            <option value="">Urgência</option>${[...ORDEM_URGENCIA].reverse().map((u) => html`<option key=${u} value=${u}>${ROTULO_URGENCIA[u]}</option>`)}</select>
          <select class="chm-select" aria-label="Categoria" value=${filtros.categoria_id} onChange=${(e) => mudar({ categoria_id: e.target.value })}>
            <option value="">Categoria</option>${(meta?.categorias || []).map((c) => html`<option key=${c.id} value=${c.id}>${c.nome}</option>`)}</select>
          <select class="chm-select" aria-label="Operação" value=${filtros.operacao} onChange=${(e) => mudar({ operacao: e.target.value })}>
            <option value="">Operação</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>
          <div class="chm-seg" role="tablist" aria-label="Responsável">
            <button type="button" role="tab" aria-selected=${!filtros.sem_responsavel} class=${!filtros.sem_responsavel ? 'is-on' : ''} onClick=${() => mudar({ sem_responsavel: false })}>Todos</button>
            <button type="button" role="tab" aria-selected=${filtros.sem_responsavel} class=${filtros.sem_responsavel ? 'is-on' : ''} onClick=${() => mudar({ sem_responsavel: true })}>
              Sem responsável${semResp !== undefined ? html` <span class="chm-cnt">${semResp}</span>` : null}</button>
          </div>
        </div>

        ${erro ? html`<${EstadoErro} erro=${erro} aoTentar=${carregar} />` : null}
        ${!dados && !erro ? html`<${LoadingState} titulo="Carregando a fila" />` : null}
        ${dados && !dados.itens.length ? html`<${EmptyState} icon="check_circle" title="Fila vazia" text="Nenhum chamado corresponde aos filtros." />` : null}
        ${dados && dados.itens.length ? html`
          <div class="chm-tabela-wrap">
            <table class="chm-tabela">
              <thead><tr><th style=${{ width: '32%' }}>Chamado</th><th>Operação</th><th>Urgência</th><th>Status</th><th>SLA</th><th>Responsável</th><th style=${{ width: '176px' }}></th></tr></thead>
              <tbody>
                ${dados.itens.map((item) => html`
                  <tr key=${item.id} class="chm-linha" tabIndex="0" onClick=${() => irParaChamado(item.id)} onKeyDown=${(e) => { if (e.key === 'Enter') irParaChamado(item.id); }}>
                    <td><div class="chm-assunto"><b>#${item.numero}</b> ${item.titulo}</div>
                      <span class="chm-sub">${item.categoria}${item.pa_posto ? ` · ${item.pa_posto}` : ''}${item.pa_parada ? ' parada' : ''}${item.tipo_impacto === 'celula' ? ' · célula inteira' : ''}</span></td>
                    <td>${item.operacao}</td>
                    <td><${PillUrgencia} urgencia=${item.urgencia} /></td>
                    <td><${PillStatus} status=${item.status} /></td>
                    <td><${PillSla} item=${item} /></td>
                    <td>${item.responsavel ? html`<div class="chm-quem"><${Avatar} nome=${item.responsavel.nome} pequeno=${true} /><span class="chm-trunca">${item.responsavel.nome}</span></div>` : html`<span class="chm-muted">Sem responsável</span>`}</td>
                    <td class="chm-acoes-linha" onClick=${(e) => e.stopPropagation()}>
                      ${!item.responsavel && ['aberto', 'em_andamento', 'aguardando_solicitante'].includes(item.status)
                        ? html`<button type="button" class="btn btn-sm btn-primary" onClick=${() => assumir(item)}>Assumir</button>` : null}
                      <button type="button" class="btn btn-sm btn-outline-secondary" onClick=${() => irParaChamado(item.id)}>Abrir</button>
                    </td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
          <${Paginacao} pagina=${pagina} tamanho=${TAMANHO} total=${dados.total} aoMudar=${setPagina} />` : null}
      </section>
    </div>`;
}
