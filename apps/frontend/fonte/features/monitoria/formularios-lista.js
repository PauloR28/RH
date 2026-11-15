import { html, useEffect, useState } from '../../infraestrutura-react.js';
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
import { Campo, Esqueleto, Estado, Ic, Janela, MenuAcoes, Segmento } from '../../ui/components/ds.js?v=20261106-wfm';
import { formatarData, formatarDataHoraCurta, formatarNota } from './comum.js';
import { ChipSituacao, DialogoConfirmar, ModalComparacao, ROTULO_ACAO, SITUACOES, VersionRow, alternarMarcadas, compararConfigs } from './formularios-comum.js?v=20261109-telas-antigas';

// Lista de formulários (redesign Fase 15, fatia 4, amostra Q2 do lote 2): caixa com o filtro de situação (com contagem),
// Operação e busca; tabela Formulário · Situação · Versão · Atualizado · Monit. · Nota · [Abrir ⋯]; coluna à direita de 320 px
// com o escolhido (nome + selo, blocos e faixas, versões com caixinhas para Comparar, Abrir formulário e Duplicar).

const POR_PAGINA = 50;
const VERSOES_VISIVEIS = 5;
export const ESTADO_LISTA_INICIAL = { situacao: 'todos', operacao: '', busca: '', pagina: 1, selecionado: 0 };

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
    } finally { setOcupado(false); }
  };
  return html`<${Janela} titulo="Duplicar formulário" onClose=${aoFechar}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${aoFechar}>Cancelar</button>
      <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${!nome.trim() || !idVersao || ocupado || null} onClick=${confirmar}>${ocupado ? 'Duplicando…' : 'Duplicar'}</button>`}>
    <div class="c-janela-corpo">
      <p class="c-ajuda" style=${{ margin: 0 }}>A cópia nasce desativada${versaoEscolhida ? `, a partir da v${versaoEscolhida.numero}` : ''}. O original não muda.</p>
      <${Campo} rotulo="Nome da cópia"><input class="c-entrada" maxlength="180" value=${nome} onInput=${(e) => setNome(e.target.value)} /><//>
      <div class="c-form" style=${{ '--colunas': 2 }}>
        <${Campo} rotulo="Operação de destino"><select class="c-entrada" value=${destino} onChange=${(e) => setDestino(e.target.value)}>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select><//>
        <${Campo} rotulo="Versão de origem"><select class="c-entrada" value=${idVersao} onChange=${(e) => setIdVersao(e.target.value)}>
          ${versoes.map((v) => html`<option key=${v.id_versao} value=${String(v.id_versao)}>v${v.numero}${v.ativa ? ' · atual' : ''}</option>`)}</select><//>
      </div>
    </div>
  <//>`;
}

export function TelaListaFormularios({ contexto, podeEditar, showToast, estado, setEstado, aoAbrir, aoCriar, aoReload, recarga, aoEscolhido }) {
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [dados, setDados] = useState(null); // { itens, total, contadores }
  const [erro, setErro] = useState('');
  const [buscaTexto, setBuscaTexto] = useState(estado.busca);
  const [versoes, setVersoes] = useState(null);
  const [resumo, setResumo] = useState(null); // config da versão atual do escolhido (blocos e faixas)
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
  // Sem escolha, a coluna da direita mostra o primeiro da lista.
  const selecionado = itens.find((f) => f.id_matriz === estado.selecionado) || itens[0] || null;
  useEffect(() => { aoEscolhido?.(selecionado); }, [selecionado?.id_matriz]);

  // Versões do formulário escolhido e o resumo (blocos e faixas) da versão atual.
  useEffect(() => {
    setMarcadas([]);
    setTodasVersoes(false);
    setResumo(null);
    if (!selecionado) { setVersoes(null); return undefined; }
    let ativo = true;
    setVersoes(null);
    listarVersoesMatriz(selecionado.operacao, selecionado.id_matriz)
      .then((r) => {
        if (!ativo) return;
        const lista = r.itens || [];
        setVersoes(lista);
        const atual = lista.find((v) => v.ativa) || lista[0];
        if (atual) lerVersaoMatriz(atual.id_versao).then((v) => { if (ativo) setResumo(v.config || null); }).catch(() => {});
      })
      .catch((e) => { if (ativo) { setVersoes([]); showToast(e?.message || 'Erro ao carregar as versões.', 'danger'); } });
    return () => { ativo = false; };
  }, [selecionado?.id_matriz, selecionado?.versoes, recarga, tick]);

  const c = dados?.contadores || { todos: 0, ativo: 0, desativado: 0, arquivado: 0 };
  const opcoesSituacao = [['todos', 'Todos', c.todos], ['ativo', 'Ativos', c.ativo], ['desativado', 'Desativados', c.desativado], ['arquivado', 'Arquivados', c.arquivado]];

  const pedirAcao = async (f, acao) => {
    const base = {
      desativar: 'Ele deixa de aparecer em Nova monitoria. Versões e monitorias antigas ficam intactas.',
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
    } finally { setOcupado(false); }
  };

  const restaurarVersao = (v) => setConfirmando({ f: selecionado, acao: 'restaurar-versao', versao: v, descricao: `Criar uma nova versão com o conteúdo da v${v.numero}? O histórico continua intacto.` });
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
    } finally { setOcupado(false); }
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
      { label: 'Duplicar', icon: 'copy', onClick: () => setDuplicando(f) },
      { label: ROTULO_ACAO[info.acao], icon: info.acao === 'desativar' ? 'prohibit' : info.acao === 'restaurar' ? 'arrow-counter-clockwise' : 'check-circle', onClick: () => pedirAcao(f, info.acao) },
      f.situacao !== 'arquivado' ? { label: 'Arquivar', icon: 'archive', perigo: true, onClick: () => pedirAcao(f, 'arquivar') } : null,
    ];
  };

  const versoesVisiveis = todasVersoes ? versoes : (versoes || []).slice(0, VERSOES_VISIVEIS);
  const cheio = marcadas.length >= 2;
  const info = selecionado ? SITUACOES[selecionado.situacao] : null;
  const totalPaginas = Math.max(1, Math.ceil((dados?.total || 0) / POR_PAGINA));

  return html`
    <div class="c-fm-corpo">
      <div class="c-tabela-caixa">
        <div class="c-filtros c-filtros--suave">
          <${Segmento} mini=${true} rotulo="Situação do formulário" valor=${estado.situacao} aoMudar=${(id) => atualizar({ situacao: id, pagina: 1 })} opcoes=${opcoesSituacao} />
          ${ativas.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${estado.operacao} onChange=${(e) => atualizar({ operacao: e.target.value, pagina: 1 })}><option value="">Todas as operações</option>${ativas.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar formulário" aria-label="Buscar formulário" value=${buscaTexto} onInput=${(e) => setBuscaTexto(e.target.value)} /></div>
        </div>
        ${erro ? html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => setTick((x) => x + 1)} />`
          : !dados ? html`<${Esqueleto} linhas=${6} />`
          : !itens.length ? html`<${Estado} icone="list-checks" titulo="Nenhum formulário nesta situação." rotuloAcao=${podeEditar && (c.todos || 0) > 0 ? 'Novo formulário' : undefined} aoAcao=${podeEditar ? () => aoCriar(null) : undefined} />`
          : html`<table class="c-tabela">
            <thead><tr><th scope="col" class="c-estica">Formulário</th><th scope="col">Situação</th><th scope="col">Versão</th><th scope="col" class="c-col-opc">Atualizado</th><th scope="col" class="c-num">Monit.</th><th scope="col" class="c-num">Nota</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
            <tbody>${itens.map((f) => html`<tr key=${f.id_matriz} class="c-clicavel" aria-selected=${selecionado?.id_matriz === f.id_matriz ? 'true' : null}
              onClick=${(e) => { if (!e.target.closest('button, .c-abre-menu')) atualizar({ selecionado: f.id_matriz }); }}>
              <td class="c-estica" data-papel="titulo"><span class="c-duas"><span class="c-forte" title=${f.nome}>${f.nome}</span><small title=${`${f.operacao_nome}${f.origem ? ` · cópia de ${f.origem}` : ''}`}>${f.operacao_nome}${f.origem ? ` · cópia de ${f.origem}` : ''}</small></span></td>
              <td data-papel="selo"><${ChipSituacao} situacao=${f.situacao} /></td>
              <td class="c-forte" data-papel="info" data-prioridade="1" data-primeira="">v${f.versao_ativa ?? '—'}</td>
              <td class="c-col-opc c-secundario" title=${`${formatarDataHoraCurta(f.atualizado_em)} · ${f.atualizado_por || '—'}`}>${formatarData(f.atualizado_em)}</td>
              <td class="c-num" data-papel="info" data-prioridade="1">${f.monitorias}</td>
              <td class="c-num">${f.nota_media == null ? '—' : formatarNota(f.nota_media)}</td>
              <td class="c-acoes" data-papel="acoes"><div class="c-grupo">
                <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => aoAbrir(f)}>Abrir</button>
                <${MenuAcoes} rotulo=${`Mais ações de ${f.nome}`} acoes=${acoesLinha(f)} />
              </div></td>
            </tr>`)}</tbody>
          </table>`}
        ${dados && itens.length ? html`<div class="c-tabela-rodape">
          <span role="status">Mostrando ${itens.length} de ${dados.total} formulários</span>
          ${totalPaginas > 1 ? html`<span class="c-grupo">
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${estado.pagina <= 1 || null} onClick=${() => atualizar({ pagina: estado.pagina - 1 })}><${Ic} nome="caret-left" />Anterior</button>
            <span>${estado.pagina} de ${totalPaginas}</span>
            <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${estado.pagina >= totalPaginas || null} onClick=${() => atualizar({ pagina: estado.pagina + 1 })}>Próxima<${Ic} nome="caret-right" /></button>
          </span>` : null}
        </div>` : null}
      </div>

      <aside class="c-fm-lado" aria-label="Formulário escolhido">
        ${!selecionado ? html`<div class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Formulário escolhido</h3></div><div class="c-db-bloco-corpo"><p class="c-ajuda" style=${{ margin: 0 }}>Escolha um formulário na tabela.</p></div></div>` : html`
          <div class="c-db-bloco">
            <div class="c-db-bloco-cab"><h3 title=${selecionado.nome}>${selecionado.nome}</h3><${ChipSituacao} situacao=${selecionado.situacao} /></div>
            <div class="c-db-bloco-corpo">
              <p class="c-ajuda" style=${{ margin: 0 }}>${info.ajuda}</p>
              ${resumo ? html`<table class="c-diario-ficha"><tbody>
                <tr><td>Blocos</td><td style=${{ whiteSpace: 'normal' }}>${(resumo.blocos || []).map((b) => `${b.nome} (${formatarNota(b.valor)})`).join(' · ') || '—'}</td></tr>
                <tr><td>Faixas</td><td style=${{ whiteSpace: 'normal' }}>${(resumo.faixas || []).map((f) => html`<span key=${f.label} style=${{ marginRight: '8px', display: 'inline-block' }}><span class="c-fm-faixa" style=${{ '--f': f.cor || 'var(--cor-acao-fundo)' }}></span>${f.label} ≥ ${f.min}</span>`)}</td></tr>
              </tbody></table>` : html`<${Esqueleto} linhas=${2} />`}
            </div>
          </div>
          <div class="c-db-bloco" style=${{ borderTop: 'var(--borda-fina) solid var(--tabela-linha)' }}>
            <div class="c-db-bloco-cab"><h3>Versões</h3>
              <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${marcadas.length !== 2 || null} title="Marque duas versões para comparar" onClick=${compararSelecionadas}>Comparar (${marcadas.length}/2)</button></div>
            <div class="c-db-bloco-corpo c-fm-versoes" role="list">
              ${versoes === null ? html`<${Esqueleto} linhas=${3} />` : versoesVisiveis.map((v) => html`<${VersionRow} key=${v.id_versao} versao=${v}
                marcada=${marcadas.includes(v.id_versao)} desabilitada=${cheio} motivoDesabilitada="Já há 2 versões marcadas. Desmarque uma para escolher outra."
                aoMarcar=${(id) => setMarcadas((m) => alternarMarcadas(m, id))} aoVer=${() => aoAbrir(selecionado, v.id_versao)}
                aoRestaurar=${podeEditar && selecionado.situacao !== 'arquivado' ? restaurarVersao : null} />`)}
              ${versoes && versoes.length > VERSOES_VISIVEIS ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setTodasVersoes((x) => !x)}>${todasVersoes ? 'Mostrar menos' : `Ver todas as ${versoes.length} versões`}</button>` : null}
            </div>
          </div>
          <div class="c-fm-lado-acoes">
            <button type="button" class="c-botao c-botao--principal" onClick=${() => aoAbrir(selecionado)}>Abrir formulário</button>
            ${podeEditar ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setDuplicando(selecionado)}><${Ic} nome="copy" />Duplicar</button>` : null}
          </div>`}
      </aside>
    </div>

    <${DialogoDuplicar} formulario=${duplicando} operacoes=${ativas} showToast=${showToast} aoFechar=${() => setDuplicando(null)}
      aoConcluir=${() => { setDuplicando(null); setTick((x) => x + 1); aoReload?.(); }} />
    <${DialogoConfirmar} aberto=${Boolean(confirmando)}
      titulo=${confirmando ? (confirmando.acao === 'restaurar-versao' ? `Restaurar a v${confirmando.versao.numero}?` : `${ROTULO_ACAO[confirmando.acao]} "${confirmando.f.nome}"?`) : ''}
      descricao=${confirmando?.descricao} textoConfirmar=${confirmando ? (confirmando.acao === 'restaurar-versao' ? 'Restaurar' : ROTULO_ACAO[confirmando.acao]) : ''}
      perigo=${confirmando?.acao === 'arquivar'} ocupado=${ocupado} aoCancelar=${() => setConfirmando(null)}
      aoConfirmar=${confirmando?.acao === 'restaurar-versao' ? executarRestaurarVersao : confirmarAcao} />
    <${ModalComparacao} comparacao=${comparacao} aoFechar=${() => setComparacao(null)} />`;
}
