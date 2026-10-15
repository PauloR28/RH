import { html, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { MenuAcoesProcesso } from '../../ui/components/menu-acoes.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  alterarSituacaoFormulario,
  ativarFormularioMatriz,
  duplicarFormularioMatriz,
  lerVersaoMatriz,
  listarFormulariosGeral,
  listarFormulariosMatriz,
  listarVersoesMatriz,
  restaurarVersaoMatriz,
} from '../../services/api/monitoria.js';
import { SelectOperacao, formatarDataHoraCurta, formatarNota } from './comum.js';
import {
  AbasSituacao,
  ChipSituacao,
  DialogoConfirmar,
  ModalComparacao,
  ROTULO_ACAO,
  SITUACOES,
  VersionRow,
  alternarMarcadas,
  compararConfigs,
} from './formularios-comum.js';

// Lista de formulários: porta de entrada da aba Formulários. Mostra todos os formulários do
// escopo, filtra por situação/operação/busca e mostra o controle de versões do escolhido.

const POR_PAGINA = 50;
const VERSOES_VISIVEIS = 5;
export const ESTADO_LISTA_INICIAL = { situacao: 'todos', operacao: '', busca: '', pagina: 1, selecionado: 0 };

const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

// Duplicar: nome, operação de destino e versão de origem (a atual por padrão).
export function DialogoDuplicar({ formulario, operacoes, aoFechar, aoConcluir, showToast }) {
  const [nome, setNome] = useState('');
  const [destino, setDestino] = useState('');
  const [versoes, setVersoes] = useState([]);
  const [idVersao, setIdVersao] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!formulario) return undefined;
    let ativo = true;
    setNome(`Cópia de ${formulario.nome}`);
    setDestino(formulario.operacao);
    setIdVersao(String(formulario.id_versao_ativa || ''));
    listarVersoesMatriz(formulario.operacao, formulario.id_matriz)
      .then((r) => {
        if (!ativo) return;
        const itens = r.itens || [];
        setVersoes(itens);
        setIdVersao(String(itens.find((v) => v.ativa)?.id_versao || itens[0]?.id_versao || ''));
      })
      .catch(() => ativo && setVersoes([]));
    return () => { ativo = false; };
  }, [formulario?.id_matriz]);

  if (!formulario) return null;
  const versaoEscolhida = versoes.find((v) => String(v.id_versao) === String(idVersao));
  const confirmar = async () => {
    setOcupado(true);
    try {
      const r = await duplicarFormularioMatriz({ operacao: formulario.operacao, id_versao: Number(idVersao), nome, operacao_destino: destino });
      showToast(`Cópia "${r.nome}" criada (inativa). Edite-a e use "Tornar ativo" quando quiser usá-la nas monitorias.`, 'success');
      aoConcluir(r);
    } catch (e) {
      showToast(e?.message || 'Não foi possível duplicar.', 'danger');
    } finally {
      setOcupado(false);
    }
  };
  return html`
    <${ModalPadrao} aberto=${true} titulo="Duplicar formulário" subtitulo=${`A cópia nasce inativa, a partir da v${versaoEscolhida?.numero || ''}. O original não muda.`} onClose=${aoFechar}>
      <div class="mon-form-grid">
        <label class="mon-campo">Nome da cópia<input class="form-control" maxlength="180" value=${nome} onInput=${(e) => setNome(e.target.value)} /></label>
        <label class="mon-campo">Operação de destino<${SelectOperacao} contexto=${{ operacoes }} valor=${destino} todas=${false} onChange=${setDestino} /></label>
        <label class="mon-campo">Versão de origem
          <select class="form-select" value=${idVersao} onChange=${(e) => setIdVersao(e.target.value)}>
            ${versoes.map((v) => html`<option key=${v.id_versao} value=${String(v.id_versao)}>v${v.numero}${v.ativa ? ' · atual' : ''}</option>`)}
          </select>
        </label>
      </div>
      <div class="mon-acoes-fixas"><button type="button" class="btn btn-primary" disabled=${!nome.trim() || !idVersao || ocupado} onClick=${confirmar}>${ocupado ? 'Duplicando…' : 'Duplicar'}</button></div>
    </${ModalPadrao}>`;
}

export function TelaListaFormularios({ contexto, podeEditar, showToast, estado, setEstado, aoAbrir, aoCriar, aoReload, recarga }) {
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [dados, setDados] = useState(null); // { itens, total, contadores }
  const [erro, setErro] = useState('');
  const [buscaTexto, setBuscaTexto] = useState(estado.busca);
  const [versoes, setVersoes] = useState(null);
  const [marcadas, setMarcadas] = useState([]);
  const [todasVersoes, setTodasVersoes] = useState(false);
  const [comparacao, setComparacao] = useState(null);
  const [duplicando, setDuplicando] = useState(null);
  const [confirmando, setConfirmando] = useState(null); // { f, acao, descricao }
  const [ocupado, setOcupado] = useState(false);
  const [tick, setTick] = useState(0);
  const atualizar = (parcial) => setEstado((e) => ({ ...e, ...parcial }));

  useEffect(() => {
    const t = window.setTimeout(() => { if (buscaTexto !== estado.busca) atualizar({ busca: buscaTexto, pagina: 1 }); }, 300);
    return () => window.clearTimeout(t);
  }, [buscaTexto]);

  useEffect(() => {
    let ativo = true;
    setErro('');
    listarFormulariosGeral({ operacao: estado.operacao, situacao: estado.situacao === 'todos' ? '' : estado.situacao, busca: estado.busca, pagina: estado.pagina, por_pagina: POR_PAGINA })
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) { setDados(null); setErro(e?.message || 'Erro ao carregar os formulários.'); } });
    return () => { ativo = false; };
  }, [estado.operacao, estado.situacao, estado.busca, estado.pagina, recarga, tick]);

  const itens = dados?.itens || [];
  const selecionado = itens.find((f) => f.id_matriz === estado.selecionado) || null;

  // Versões do formulário escolhido.
  useEffect(() => {
    setMarcadas([]);
    setTodasVersoes(false);
    if (!selecionado) { setVersoes(null); return undefined; }
    let ativo = true;
    setVersoes(null);
    listarVersoesMatriz(selecionado.operacao, selecionado.id_matriz)
      .then((r) => { if (ativo) setVersoes(r.itens || []); })
      .catch((e) => { if (ativo) { setVersoes([]); showToast(e?.message || 'Erro ao carregar as versões.', 'danger'); } });
    return () => { ativo = false; };
  }, [selecionado?.id_matriz, selecionado?.versoes, recarga, tick]);

  const abas = useMemo(() => {
    const c = dados?.contadores || { todos: 0, ativo: 0, desativado: 0, arquivado: 0 };
    return [
      { id: 'todos', rotulo: 'Todos', total: c.todos },
      { id: 'ativo', rotulo: 'Ativos', total: c.ativo },
      { id: 'desativado', rotulo: 'Desativados', total: c.desativado },
      { id: 'arquivado', rotulo: 'Arquivados', total: c.arquivado },
    ];
  }, [dados]);

  const pedirAcao = async (f, acao) => {
    const base = {
      desativar: `Ele deixa de aparecer em Nova monitoria. Versões e monitorias antigas ficam intactas.`,
      arquivar: `Tira de uso e guarda só para consulta. Versões e monitorias antigas ficam intactas.${f.situacao === 'ativo' ? ' A operação ficará sem formulário ativo.' : ''}`,
      restaurar: 'Volta para Desativado. Não liga sozinho.',
    };
    if (acao !== 'ativar') { setConfirmando({ f, acao, descricao: base[acao] }); return; }
    let aviso = '';
    try {
      const outros = ((await listarFormulariosMatriz(f.operacao)).itens || []).filter((x) => x.ativo && x.id_matriz !== f.id_matriz);
      if (outros.length) aviso = ` "${outros[0].nome}" deixa de ser o formulário ativo da operação.`;
    } catch { /* o aviso é opcional */ }
    setConfirmando({ f, acao, descricao: `Usar "${f.nome}" nas NOVAS monitorias de ${f.operacao_nome}? As já realizadas continuam com o formulário da época.${aviso}` });
  };

  const confirmarAcao = async () => {
    const { f, acao } = confirmando;
    setOcupado(true);
    try {
      if (acao === 'ativar') await ativarFormularioMatriz(f.operacao, f.id_matriz);
      else await alterarSituacaoFormulario(f.id_matriz, acao);
      showToast(`Formulário "${f.nome}": ${ROTULO_ACAO[acao].toLowerCase()} concluído.`, 'success');
      setConfirmando(null);
      setTick((x) => x + 1);
    } catch (e) {
      showToast(e?.message || 'Não foi possível concluir a ação.', 'danger');
    } finally {
      setOcupado(false);
    }
  };

  const restaurarVersao = async (v) => {
    setConfirmando({ f: selecionado, acao: 'restaurar-versao', versao: v, descricao: `Criar uma nova versão com o conteúdo da v${v.numero}? O histórico continua intacto.` });
  };
  const executarRestaurarVersao = async () => {
    const { versao } = confirmando;
    setOcupado(true);
    try {
      const r = await restaurarVersaoMatriz(versao.id_versao);
      showToast(`Versão v${r.numero} criada a partir da v${versao.numero}.`, 'success');
      setConfirmando(null);
      setTick((x) => x + 1);
    } catch (e) {
      showToast(e?.message || 'Não foi possível restaurar a versão.', 'danger');
    } finally {
      setOcupado(false);
    }
  };

  const compararSelecionadas = async () => {
    try {
      const [a, b] = await Promise.all(marcadas.map((id) => lerVersaoMatriz(id)));
      const [antes, depois] = a.numero <= b.numero ? [a, b] : [b, a];
      setComparacao({ antes, depois, mudancas: compararConfigs(antes.config, depois.config) });
    } catch (e) { showToast(e?.message || 'Não foi possível comparar.', 'danger'); }
  };

  const acoesLinha = (f) => {
    const info = SITUACOES[f.situacao];
    if (!podeEditar) return [];
    return [
      { label: ROTULO_ACAO[info.acao], icon: info.acao === 'desativar' ? 'block' : info.acao === 'restaurar' ? 'history' : 'check_circle', onClick: () => pedirAcao(f, info.acao) },
      f.situacao !== 'arquivado' ? { label: 'Arquivar', icon: 'archive', onClick: () => pedirAcao(f, 'arquivar') } : null,
    ];
  };

  const versoesVisiveis = todasVersoes ? versoes : (versoes || []).slice(0, VERSOES_VISIVEIS);
  const cheio = marcadas.length >= 2;
  const info = selecionado ? SITUACOES[selecionado.situacao] : null;
  const totalPaginas = Math.max(1, Math.ceil((dados?.total || 0) / POR_PAGINA));

  return html`
    <div class="mon-lf">
      <div class="mon-lf-filtros">
        <${AbasSituacao} itens=${abas} ativa=${estado.situacao} aoMudar=${(id) => atualizar({ situacao: id, pagina: 1 })} />
        <div class="mon-lf-filtros-dir">
          <label class="mon-lf-campo"><span class="visually-hidden">Operação</span>
            <${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${estado.operacao} onChange=${(v) => atualizar({ operacao: v, pagina: 1 })} />
          </label>
          <label class="mon-lf-campo mon-lf-busca"><span class="visually-hidden">Buscar formulário</span>
            <input class="form-control" type="search" placeholder="Buscar formulário" value=${buscaTexto} onInput=${(e) => setBuscaTexto(e.target.value)} />
          </label>
          ${podeEditar ? html`<button type="button" class="btn btn-primary mon-btn-icone" disabled=${!itens.length} onClick=${() => aoCriar(selecionado || itens[0])}><${Icone} nome="add" />Criar formulário</button>` : null}
        </div>
      </div>

      <div class="mon-lf-grade">
        <section class="mon-lf-tabela-card" aria-label="Formulários">
          ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro} <button type="button" class="btn btn-outline-secondary btn-sm ms-2" onClick=${() => setTick((x) => x + 1)}>Tentar de novo</button></div>`
            : !dados ? html`<div class="mon-lf-esqueleto" aria-busy="true" aria-label="Carregando">${Array.from({ length: 6 }, (_, i) => html`<div key=${i}></div>`)}</div>`
            : !itens.length ? html`<div class="mon-lf-vazio" role="status"><p>Nenhum formulário nesta situação.</p>${podeEditar && (dados.contadores?.todos || 0) > 0 ? html`<button type="button" class="btn btn-primary" onClick=${() => aoCriar(null)}>Criar formulário</button>` : null}</div>`
            : html`
              <div class="mon-lf-rolagem">
                <table class="mon-lf-tabela">
                  <thead><tr>
                    <th scope="col">Formulário</th><th scope="col">Situação</th><th scope="col">Versão</th><th scope="col">Atualizado</th>
                    <th scope="col" class="num">Monit.</th><th scope="col" class="num">Nota</th><th scope="col"><span class="visually-hidden">Ações</span></th>
                  </tr></thead>
                  <tbody>
                    ${itens.map((f) => html`
                      <tr key=${f.id_matriz} class=${f.id_matriz === estado.selecionado ? 'is-selecionada' : ''} aria-current=${f.id_matriz === estado.selecionado ? 'true' : undefined}>
                        <td>
                          <button type="button" class="mon-lf-nome" title=${f.nome} onClick=${() => atualizar({ selecionado: f.id_matriz })}>${f.nome}</button>
                          <div class="mon-lf-sub" title=${`${f.operacao_nome}${f.origem ? ` · duplicado de ${f.origem}` : ''}`}>${f.operacao_nome}${f.origem ? ` · duplicado de ${f.origem}` : ''}</div>
                        </td>
                        <td><${ChipSituacao} situacao=${f.situacao} /></td>
                        <td><strong>v${f.versao_ativa ?? '—'}</strong><div class="mon-lf-sub">atual</div></td>
                        <td>${formatarDataHoraCurta(f.atualizado_em)}<div class="mon-lf-sub">${f.atualizado_por || '—'}</div></td>
                        <td class="num">${f.monitorias}</td>
                        <td class="num">${f.nota_media == null ? '—' : formatarNota(f.nota_media)}</td>
                        <td class="mon-lf-acoes">
                          <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => aoAbrir(f)}>Abrir</button>
                          ${podeEditar ? html`<button type="button" class="mon-icone-btn" title="Duplicar" aria-label=${`Duplicar ${f.nome}`} onClick=${() => setDuplicando(f)}><${Icone} nome="content_copy" /></button>` : null}
                          <${MenuAcoesProcesso} acoes=${acoesLinha(f)} ariaLabel=${`Mais ações de ${f.nome}`} />
                        </td>
                      </tr>`)}
                  </tbody>
                </table>
              </div>
              <div class="mon-lf-rodape">
                <span role="status">Mostrando ${itens.length} de ${dados.total} formulários</span>
                ${totalPaginas > 1 ? html`<span class="mon-lf-pag">
                  <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${estado.pagina <= 1} onClick=${() => atualizar({ pagina: estado.pagina - 1 })}>Anterior</button>
                  <span>${estado.pagina} / ${totalPaginas}</span>
                  <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${estado.pagina >= totalPaginas} onClick=${() => atualizar({ pagina: estado.pagina + 1 })}>Próxima</button>
                </span>` : null}
              </div>`}
        </section>

        <aside class="mon-lf-painel" aria-label="Formulário escolhido">
          ${!selecionado ? html`<div class="mon-lf-painel-vazio"><p class="mon-lf-rotulo">Formulário escolhido</p><p class="mon-muted">Escolha um formulário na tabela para ver a situação e o controle de versões.</p></div>` : html`
            <div class="mon-lf-painel-topo">
              <div class="mon-lf-painel-linha">
                <div><p class="mon-lf-rotulo">Formulário escolhido</p><h2 class="mon-lf-painel-nome" title=${selecionado.nome}>${selecionado.nome}</h2></div>
                <${ChipSituacao} situacao=${selecionado.situacao} />
              </div>
              <p class="mon-muted mon-lf-ajuda">${info.ajuda}</p>
              <div class="mon-lf-painel-botoes">
                <button type="button" class="btn btn-primary" onClick=${() => aoAbrir(selecionado)}>Abrir formulário</button>
                ${podeEditar ? html`
                  <button type="button" class="btn btn-outline-secondary" onClick=${() => setDuplicando(selecionado)}>Duplicar</button>
                  <button type="button" class="btn btn-outline-secondary" onClick=${() => pedirAcao(selecionado, info.acao)}>${ROTULO_ACAO[info.acao]}</button>` : null}
              </div>
            </div>
            <div class="mon-lf-versoes-cab">
              <span class="mon-lf-rotulo">Controle de versões</span>
              <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${marcadas.length !== 2} onClick=${compararSelecionadas} title="Marque duas versões para comparar">Comparar (${marcadas.length}/2)</button>
            </div>
            <ul class="mon-ver-lista">
              ${versoes === null ? html`<li class="mon-muted" aria-busy="true">Carregando versões…</li>` : versoesVisiveis.map((v) => html`<${VersionRow} key=${v.id_versao} versao=${v}
                marcada=${marcadas.includes(v.id_versao)} desabilitada=${cheio}
                motivoDesabilitada="Já há 2 versões marcadas. Desmarque uma para escolher outra."
                aoMarcar=${(id) => setMarcadas((m) => alternarMarcadas(m, id))}
                aoVer=${() => aoAbrir(selecionado, v.id_versao)}
                aoRestaurar=${podeEditar && selecionado.situacao !== 'arquivado' ? restaurarVersao : null} />`)}
            </ul>
            ${versoes && versoes.length > VERSOES_VISIVEIS ? html`<button type="button" class="btn btn-link btn-sm mon-lf-ver-todas" onClick=${() => setTodasVersoes((x) => !x)}>${todasVersoes ? 'Mostrar menos' : `Ver todas as ${versoes.length} versões`}</button>` : null}
            <p class="mon-muted mon-lf-painel-rodape">Salvar cria uma nova versão. As anteriores ficam arquivadas.</p>`}
        </aside>
      </div>

      <${DialogoDuplicar} formulario=${duplicando} operacoes=${ativas} showToast=${showToast} aoFechar=${() => setDuplicando(null)}
        aoConcluir=${() => { setDuplicando(null); setTick((x) => x + 1); aoReload?.(); }} />
      <${DialogoConfirmar} aberto=${Boolean(confirmando)}
        titulo=${confirmando ? (confirmando.acao === 'restaurar-versao' ? `Restaurar a v${confirmando.versao.numero}?` : `${ROTULO_ACAO[confirmando.acao]} "${confirmando.f.nome}"?`) : ''}
        descricao=${confirmando?.descricao} textoConfirmar=${confirmando ? (confirmando.acao === 'restaurar-versao' ? 'Restaurar' : ROTULO_ACAO[confirmando.acao]) : ''}
        perigo=${confirmando?.acao === 'arquivar'} ocupado=${ocupado} aoCancelar=${() => setConfirmando(null)}
        aoConfirmar=${confirmando?.acao === 'restaurar-versao' ? executarRestaurarVersao : confirmarAcao} />
      <${ModalComparacao} comparacao=${comparacao} aoFechar=${() => setComparacao(null)} />
    </div>`;
}
