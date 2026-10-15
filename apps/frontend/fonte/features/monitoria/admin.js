import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { EmptyState, PageIntro } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  ativarFormularioMatriz,
  lerVersaoMatriz,
  listarFormulariosMatriz,
  listarVersoesMatriz,
  restaurarVersaoMatriz,
  salvarMatriz,
} from '../../services/api/monitoria.js';
import { SelectOperacao, formatarNota } from './comum.js';
import {
  ChipSituacao,
  DialogoConfirmar,
  ModalComparacao,
  VersionRow,
  alternarMarcadas,
  compararConfigs,
} from './formularios-comum.js?v=20261014-formularios';
import { DialogoDuplicar, ESTADO_LISTA_INICIAL, TelaListaFormularios } from './formularios-lista.js?v=20261014-formularios';

// Formulários (matriz de qualidade versionada por operação): a aba abre a LISTA de formulários
// e, a partir dela, a tela do formulário (perguntas, pesos, escala, faixas e versões).
// Usuários, equipes/catálogos e logs de auditoria da Monitoria são administrados em
// Configurações (features/configuracoes/monitoria-config.js).

export { compararConfigs };

function somaPesos(bloco) {
  return (bloco.criterios || []).reduce((t, c) => t + (Number(c.peso) || 0), 0);
}

const clonar = (valor) => JSON.parse(JSON.stringify(valor));
const BLOCO_VAZIO = () => ({ nome: '', valor: 0, criterios: [{ texto: '', peso: 0 }] });
const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;
const VERSOES_NO_CARD = 3;

function BotaoIcone({ icone, titulo, onClick, perigo = false, desabilitado = false }) {
  return html`
    <button type="button" class=${`mon-icone-btn ${perigo ? 'mon-icone-btn--perigo' : ''}`} title=${titulo} aria-label=${titulo} disabled=${desabilitado} onClick=${onClick}>
      <${Icone} nome=${icone} />
    </button>`;
}

const mover = (lista, i, passo) => {
  const j = i + passo;
  if (j < 0 || j >= lista.length) return lista;
  const copia = [...lista];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
};

// Cache em memória (por sessão da página): voltar à aba mostra o último resultado na hora e
// revalida em segundo plano, em vez de esperar 2 requisições em sequência de novo.
const cacheVersoes = new Map();
const cacheVersao = new Map();

export function TelaFormularios({ controlador, contexto, showToast, subnav }) {
  const podeEditar = controlador.possuiPermissao('monitoria.matriz');
  const [alvo, setAlvo] = useState(null); // null = lista; { id_matriz, operacao, id_versao?, criar? } = tela do formulário
  const [estadoLista, setEstadoLista] = useState(ESTADO_LISTA_INICIAL);
  const [recargaLista, setRecargaLista] = useState(0);

  if (!(contexto?.operacoes || []).some((o) => o.ativo)) {
    return html`${subnav}<${EmptyState} icon="rule" title="Sem operações" text="Você não está vinculado a nenhuma operação ativa." />`;
  }
  if (alvo) {
    return html`<${TelaFormulario} key=${`${alvo.id_matriz}`} controlador=${controlador} contexto=${contexto} showToast=${showToast} subnav=${subnav} alvo=${alvo}
      aoVoltar=${() => { setAlvo(null); setRecargaLista((x) => x + 1); }} />`;
  }
  return html`
    <div class="mon-shell mon-fm-pagina">
      <${PageIntro} kicker="Monitoria" title="Formulários de monitoria" description="Matriz de qualidade versionada por operação." />
      ${subnav}
      <${TelaListaFormularios} contexto=${contexto} podeEditar=${podeEditar} showToast=${showToast} estado=${estadoLista} setEstado=${setEstadoLista}
        recarga=${recargaLista} aoReload=${() => setRecargaLista((x) => x + 1)}
        aoAbrir=${(f, idVersao) => setAlvo({ id_matriz: f.id_matriz, operacao: f.operacao, id_versao: idVersao || null })}
        aoCriar=${(f) => f && setAlvo({ id_matriz: f.id_matriz, operacao: f.operacao, criar: true })} />
    </div>`;
}

function TelaFormulario({ controlador, contexto, showToast, subnav, alvo, aoVoltar }) {
  const podeEditar = controlador.possuiPermissao('monitoria.matriz');
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const [operacao, setOperacao] = useState(alvo.operacao);
  const [formularios, setFormularios] = useState([]);
  const [idMatriz, setIdMatriz] = useState(String(alvo.id_matriz));
  const [duplicando, setDuplicando] = useState(null);
  const [comparar, setComparar] = useState([]); // ids de versão marcados (até 2)
  const [comparacao, setComparacao] = useState(null);
  const [versoes, setVersoes] = useState(null);
  const [idVersao, setIdVersao] = useState(alvo.id_versao ? String(alvo.id_versao) : '');
  const [versao, setVersao] = useState(null);
  const [config, setConfig] = useState(null);
  const [editando, setEditando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [fechados, setFechados] = useState({});
  const [todasVersoes, setTodasVersoes] = useState(false);
  const [confirmando, setConfirmando] = useState(null); // { tipo: 'sair' | 'ativar' | 'restaurar', ... }
  const [erroCarga, setErroCarga] = useState('');
  const criarDisparado = useRef(false);

  const cancelarEdicao = () => {
    setEditando(false);
    setCriando(false);
    setObservacao('');
    if (versao) setConfig(clonar(versao.config));
  };

  // Formulários da operação (o escolhido vem selecionado).
  useEffect(() => {
    if (!operacao) return undefined;
    let ativo = true;
    listarFormulariosMatriz(operacao)
      .then((r) => {
        if (!ativo) return;
        const itens = r.itens || [];
        setFormularios(itens);
        setIdMatriz((atual) => (itens.some((f) => String(f.id_matriz) === String(atual)) ? atual : String(itens.find((f) => f.ativo)?.id_matriz || itens[0]?.id_matriz || '')));
      })
      .catch(() => { if (ativo) setFormularios([]); });
    return () => { ativo = false; };
  }, [operacao, recarga]);

  // Lista as versões do formulário escolhido (a ativa vem selecionada).
  useEffect(() => {
    if (!operacao || !idMatriz) return undefined;
    let ativo = true;
    const chaveCache = `${operacao}:${idMatriz}`;
    const aplicarVersoes = (itens) => {
      setVersoes(itens);
      setIdVersao((atual) => (itens.some((v) => String(v.id_versao) === String(atual)) ? atual : String(itens.find((v) => v.ativa)?.id_versao || itens[0]?.id_versao || '')));
    };
    setComparar([]);
    setErroCarga('');
    const emCache = recarga ? null : cacheVersoes.get(chaveCache);
    if (emCache) aplicarVersoes(emCache);
    else {
      setVersoes(null);
      setVersao(null);
      setConfig(null);
    }
    listarVersoesMatriz(operacao, idMatriz)
      .then((r) => {
        if (!ativo) return;
        const itens = r.itens || [];
        cacheVersoes.set(chaveCache, itens);
        aplicarVersoes(itens);
      })
      .catch((e) => { if (ativo) { setVersoes([]); setErroCarga(e?.message || 'Erro ao carregar os formulários.'); } });
    return () => { ativo = false; };
  }, [operacao, idMatriz, recarga]);

  // Carrega a versão escolhida no terceiro select.
  useEffect(() => {
    if (!idVersao) return undefined;
    let ativo = true;
    const emCache = cacheVersao.get(String(idVersao));
    if (emCache) { setVersao(emCache); setConfig(clonar(emCache.config)); }
    lerVersaoMatriz(idVersao)
      .then((v) => {
        cacheVersao.set(String(idVersao), v);
        // Só troca o que está na tela se a versão mudou (evita apagar uma edição em andamento).
        if (!ativo) return;
        setVersao(v);
        if (!emCache) setConfig(clonar(v.config));
      })
      .catch((e) => { if (ativo) { setErroCarga(e?.message || 'Erro ao carregar o formulário.'); showToast(e?.message || 'Erro ao carregar o formulário.', 'danger'); } });
    return () => { ativo = false; };
  }, [idVersao]);

  const erros = [];
  if (config && !(config.blocos || []).length) erros.push('O formulário precisa de ao menos um bloco.');
  (config?.blocos || []).forEach((b) => {
    if (!String(b.nome || '').trim()) erros.push('Todo bloco precisa de um nome.');
    else if ((b.criterios || []).some((c) => !String(c.texto || '').trim())) erros.push(`${b.nome}: preencha o texto de todas as perguntas ou remova as vazias.`);
    if (Math.abs(somaPesos(b) - Number(b.valor || 0)) > 0.0001) erros.push(`${b.nome || 'Bloco'}: a soma dos pesos (${formatarNota(somaPesos(b))}) deve ser igual ao valor do bloco (${formatarNota(b.valor)}).`);
  });
  const alterou = Boolean(config && versao && (criando || JSON.stringify(config) !== JSON.stringify(versao.config)));
  const versaoAtiva = (versoes || []).find((v) => v.ativa);
  const formulario = formularios.find((f) => String(f.id_matriz) === String(idMatriz)) || null;
  const situacao = formulario ? (formulario.arquivado ? 'arquivado' : formulario.ativo ? 'ativo' : 'desativado') : null;
  const arquivada = Boolean(versao && versaoAtiva && versaoAtiva.id_versao !== versao.id_versao);
  const nova = versaoAtiva ? versaoAtiva.numero + 1 : (versao?.numero || 0) + 1;

  const setBloco = (i, campo, valor) => setConfig({ ...config, blocos: config.blocos.map((b, j) => (j === i ? { ...b, [campo]: valor } : b)) });
  const setCriterio = (i, k, campo, valor) => setConfig({ ...config, blocos: config.blocos.map((b, j) => (j === i ? { ...b, criterios: b.criterios.map((c, l) => (l === k ? { ...c, [campo]: valor } : c)) } : b)) });
  const setFaixa = (i, campo, valor) => setConfig({ ...config, faixas: config.faixas.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)) });
  const criar = () => {
    setConfig({ ...clonar(config), blocos: [BLOCO_VAZIO()] });
    setCriando(true);
    setEditando(true);
  };
  // "Criar formulário" na lista abre esta tela já no fluxo de hoje (formulário em branco).
  useEffect(() => {
    if (alvo.criar && config && !criarDisparado.current) {
      criarDisparado.current = true;
      criar();
    }
  }, [config]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarMatriz(operacao, config, observacao, idMatriz);
      showToast(`Nova versão ${r.numero} criada. As monitorias antigas permanecem com a versão original.`, 'success');
      setObservacao('');
      setEditando(false);
      setCriando(false);
      setIdVersao('');
      setRecarga((x) => x + 1);
    } catch (e) { showToast(e?.message || 'Não foi possível salvar.', 'danger'); } finally { setSalvando(false); }
  };

  const pedirTornarAtivo = async () => {
    if (!formulario) return;
    let aviso = '';
    const outro = formularios.find((f) => f.ativo && f.id_matriz !== formulario.id_matriz);
    if (outro) aviso = ` "${outro.nome}" deixa de ser o formulário ativo da operação.`;
    setConfirmando({ tipo: 'ativar', descricao: `Usar "${formulario.nome}" nas NOVAS monitorias de ${operacao}? As já realizadas continuam com o formulário da época.${aviso}` });
  };
  const pedirRestaurar = (v) => setConfirmando({ tipo: 'restaurar', versao: v, descricao: `Criar uma nova versão com o conteúdo da v${v.numero}? O histórico continua intacto.` });
  const pedirSair = (aoConfirmar) => {
    if (editando && alterou) setConfirmando({ tipo: 'sair', descricao: 'As alterações ainda não foram salvas e serão perdidas.', aoConfirmar });
    else aoConfirmar();
  };
  const executarConfirmacao = async () => {
    const c = confirmando;
    if (c.tipo === 'sair') { setConfirmando(null); c.aoConfirmar(); return; }
    try {
      if (c.tipo === 'ativar') {
        await ativarFormularioMatriz(operacao, formulario.id_matriz);
        showToast(`"${formulario.nome}" agora é o formulário ativo da operação.`, 'success');
      } else {
        const r = await restaurarVersaoMatriz(c.versao.id_versao);
        showToast(`Versão v${r.numero} criada a partir da v${c.versao.numero}.`, 'success');
        setIdVersao('');
      }
      setConfirmando(null);
      setRecarga((x) => x + 1);
    } catch (e) {
      setConfirmando(null);
      showToast(e?.message || 'Não foi possível concluir a ação.', 'danger');
    }
  };

  const compararSelecionadas = async () => {
    try {
      const [a, b] = await Promise.all(comparar.map((id) => lerVersaoMatriz(id)));
      const [antes, depois] = a.numero <= b.numero ? [a, b] : [b, a];
      setComparacao({ antes, depois, mudancas: compararConfigs(antes.config, depois.config) });
    } catch (e) { showToast(e?.message || 'Não foi possível comparar.', 'danger'); }
  };

  const nota = versao
    ? (editando && !criando
      ? `Editando a partir da v${versao.numero}. Ao salvar, nasce a v${nova} e a v${versaoAtiva?.numero || versao.numero} fica arquivada. As monitorias já feitas continuam com a v${versaoAtiva?.numero || versao.numero}.`
      : `${formulario ? `${formulario.nome}${formulario.ativo ? ' (formulário ativo da operação)' : ' (inativo — não é usado nas novas monitorias)'} · ` : ''}${criando ? 'Novo formulário' : `Versão v${versao.numero}${versaoAtiva?.id_versao === versao.id_versao ? ' (atual)' : ' (arquivada)'}`} · Salvar cria uma nova versão; as anteriores ficam arquivadas.`)
    : '';

  const blocos = config?.blocos || [];
  const meio = Math.ceil(blocos.length / 2);
  const colunasBlocos = [blocos.slice(0, meio).map((b, i) => [b, i]), blocos.slice(meio).map((b, i) => [b, i + meio])];
  const versoesVisiveis = todasVersoes ? versoes : (versoes || []).slice(0, VERSOES_NO_CARD);
  const marcarCheio = comparar.length >= 2;
  const ro = !editando;

  const renderBloco = ([b, i]) => {
    const chaveBloco = b.id || i;
    const fechado = Boolean(fechados[chaveBloco]);
    const soma = somaPesos(b);
    const fecha = Math.abs(soma - Number(b.valor || 0)) <= 0.0001;
    const toggle = html`<button type="button" class=${`mon-bloco-toggle ${fechado ? 'is-fechado' : ''}`} aria-expanded=${!fechado} aria-label=${`${fechado ? 'Expandir' : 'Recolher'} bloco ${b.nome || ''}`.trim()}
      onClick=${() => setFechados((f) => ({ ...f, [chaveBloco]: !fechado }))}><${Icone} nome="expand_more" /></button>`;
    return html`
      <section class=${`mon-fm-bloco ${fechado ? 'is-fechado' : ''}`} key=${chaveBloco}>
        <div class="mon-fm-bloco-cab">
          ${toggle}
          ${editando ? html`
            <input class="form-control mon-fm-in" aria-label="Nome do bloco" placeholder="Nome do bloco" value=${b.nome} onInput=${(e) => setBloco(i, 'nome', e.target.value)} />
            <input class="form-control mon-fm-in mon-fm-num" type="number" step="0.5" aria-label="Valor do bloco" value=${b.valor} onInput=${(e) => setBloco(i, 'valor', e.target.value)} />
            <${BotaoIcone} icone="arrow_upward" titulo="Mover bloco para cima" desabilitado=${i === 0} onClick=${() => setConfig({ ...config, blocos: mover(config.blocos, i, -1) })} />
            <${BotaoIcone} icone="arrow_downward" titulo="Mover bloco para baixo" desabilitado=${i === blocos.length - 1} onClick=${() => setConfig({ ...config, blocos: mover(config.blocos, i, 1) })} />
            <${BotaoIcone} icone="delete" titulo="Remover bloco" perigo=${true} onClick=${() => setConfig({ ...config, blocos: config.blocos.filter((_, j) => j !== i) })} />
          ` : html`
            <strong class="mon-fm-bloco-nome" title=${b.nome}>${b.nome}</strong>
            <span class=${`mon-fm-soma ${fecha ? '' : 'is-erro'}`}>${fechado ? `${b.criterios.length} pergunta(s)` : `Soma dos pesos: ${formatarNota(soma)} / ${formatarNota(b.valor)}`}</span>
            <strong class="mon-fm-bloco-valor">${formatarNota(b.valor)}</strong>`}
        </div>
        ${fechado ? null : html`
          <div class="mon-fm-perguntas">
            ${b.criterios.map((c, k) => html`
              <div class="mon-fm-pergunta" key=${c.id || k}>
                ${editando ? html`
                  <input class="form-control mon-fm-in" aria-label="Pergunta" placeholder="Texto da pergunta" value=${c.texto} onInput=${(e) => setCriterio(i, k, 'texto', e.target.value)} />
                  <input class="form-control mon-fm-in mon-fm-num" type="number" step="0.5" aria-label="Peso" value=${c.peso} onInput=${(e) => setCriterio(i, k, 'peso', e.target.value)} />
                  <${BotaoIcone} icone="arrow_upward" titulo="Mover pergunta para cima" desabilitado=${k === 0} onClick=${() => setBloco(i, 'criterios', mover(b.criterios, k, -1))} />
                  <${BotaoIcone} icone="arrow_downward" titulo="Mover pergunta para baixo" desabilitado=${k === b.criterios.length - 1} onClick=${() => setBloco(i, 'criterios', mover(b.criterios, k, 1))} />
                  <${BotaoIcone} icone="delete" titulo="Remover pergunta" perigo=${true} onClick=${() => setBloco(i, 'criterios', b.criterios.filter((_, l) => l !== k))} />
                ` : html`<span class="mon-fm-pergunta-txt" title=${c.texto}>${c.texto}</span><strong class="mon-fm-pergunta-peso">${formatarNota(c.peso)}</strong>`}
              </div>`)}
            ${editando ? html`
              <div class="mon-fm-bloco-rodape">
                <span class=${`mon-fm-soma ${fecha ? '' : 'is-erro'}`}>Soma dos pesos: ${formatarNota(soma)} / ${formatarNota(b.valor)}</span>
                <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setBloco(i, 'criterios', [...b.criterios, { texto: '', peso: 0 }])}><${Icone} nome="add" />Adicionar pergunta</button>
              </div>` : null}
          </div>`}
      </section>`;
  };

  return html`
    <div class="mon-shell mon-fm-pagina">
      <${PageIntro}
        kicker=${html`Monitoria<button type="button" class="mon-fm-voltar" onClick=${() => pedirSair(aoVoltar)}><${Icone} nome="chevron_left" />Todos os formulários</button>`}
        title=${html`<span class="mon-fm-titulo" title=${formulario?.nome || ''}>${formulario?.nome || 'Formulário'}</span>${situacao ? html`<${ChipSituacao} situacao=${situacao} />` : null}${versao ? html`<strong class="mon-fm-versao">v${versao.numero}${versaoAtiva?.id_versao === versao.id_versao ? ' · atual' : ' · arquivada'}</strong>` : null}`}
        description="Matriz de qualidade versionada por operação." />
      ${subnav}

      <div class="mon-fm-faixa">
        <div class="mon-fm-selecao">
          <label class="mon-fm-sel mon-fm-sel--op">Operação<${SelectOperacao} contexto=${{ operacoes: ativas }} valor=${operacao} todas=${false} desabilitado=${editando} onChange=${(v) => { setOperacao(v); setIdMatriz(''); setIdVersao(''); }} /></label>
          <label class="mon-fm-sel mon-fm-sel--form">Formulário
            <select class="form-select" value=${idMatriz} disabled=${editando || !formularios.length} onChange=${(e) => { setIdMatriz(e.target.value); setIdVersao(''); }}>
              ${formularios.map((f) => html`<option key=${f.id_matriz} value=${String(f.id_matriz)}>${f.nome}${f.ativo ? ' · ativo' : ''}</option>`)}
            </select>
          </label>
          <label class="mon-fm-sel mon-fm-sel--ver">Versão
            <select class="form-select" value=${idVersao} disabled=${editando || !versoes?.length} onChange=${(e) => setIdVersao(e.target.value)}>
              ${(versoes || []).map((v) => html`<option key=${v.id_versao} value=${String(v.id_versao)}>v${v.numero}${v.ativa ? ' · atual' : ''}${v.observacao ? ` · ${v.observacao}` : ''}</option>`)}
            </select>
          </label>
          ${editando ? html`<label class="mon-fm-sel mon-fm-sel--obs">Observação da nova versão (opcional)<input class="form-control" placeholder="O que mudou?" value=${observacao} onInput=${(e) => setObservacao(e.target.value)} /></label>` : null}
        </div>
        ${podeEditar ? html`
          <div class="mon-fm-acoes">
            ${editando ? html`
              <button type="button" class="btn btn-outline-secondary" onClick=${() => pedirSair(cancelarEdicao)}>Cancelar</button>
              <button type="button" class="btn btn-primary" disabled=${!alterou || erros.length > 0 || salvando} onClick=${salvar}>${salvando ? 'Salvando…' : 'Salvar como nova versão'}</button>` : html`
              <button type="button" class="btn btn-outline-secondary mon-btn-icone" disabled=${!config} title="Cria uma cópia inativa desta versão (para editar ou guardar como backup)"
                onClick=${() => setDuplicando({ ...formulario, operacao, id_versao_ativa: versaoAtiva?.id_versao })}><${Icone} nome="content_copy" />Duplicar</button>
              ${formulario && situacao === 'desativado' ? html`<button type="button" class="btn btn-outline-secondary mon-btn-icone" onClick=${pedirTornarAtivo}><${Icone} nome="check_circle" />Tornar ativo</button>` : null}
              ${arquivada
                ? html`<button type="button" class="btn btn-primary mon-btn-icone" disabled=${!config || situacao === 'arquivado'} onClick=${() => pedirRestaurar(versao)}><${Icone} nome="history" />Restaurar</button>`
                : html`<button type="button" class="btn btn-primary mon-btn-icone" disabled=${!config || situacao === 'arquivado'} onClick=${() => setEditando(true)}><${Icone} nome="edit" />Editar formulário</button>`}`}
          </div>` : null}
      </div>
      ${nota ? html`<p class="mon-alerta mon-alerta--info mon-alerta--linha" title=${nota}><${Icone} nome="info" /><span>${nota}</span></p>` : null}

      ${erroCarga ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erroCarga} <button type="button" class="btn btn-outline-secondary btn-sm ms-2" onClick=${() => { setErroCarga(''); setRecarga((x) => x + 1); }}>Tentar de novo</button></div>`
        : versoes && !versoes.length ? html`<${EmptyState} icon="rule" title="Formulário sem versões" text="Este formulário ainda não tem nenhuma versão." />`
        : !config ? html`<div class="mon-fm-grade" aria-busy="true" aria-label="Carregando formulário"><div class="mon-lf-esqueleto"><div></div><div></div><div></div></div><div class="mon-lf-esqueleto"><div></div><div></div></div></div>` : html`
      <div class="mon-fm-grade">
        <section class="mon-fm-card mon-fm-perguntas-card" aria-label="Perguntas e pesos">
          <header class="mon-fm-card-cab"><h2>Perguntas e pesos</h2><span class="mon-fm-colunas">Pergunta · Valor / Peso</span></header>
          <div class="mon-fm-card-corpo">
            <div class="mon-fm-blocos">
              ${colunasBlocos.map((col, n) => html`<div class="mon-fm-blocos-col" key=${n}>${col.map(renderBloco)}</div>`)}
            </div>
            ${editando ? html`<button type="button" class="btn btn-outline-secondary mon-fm-novo-bloco" onClick=${() => setConfig({ ...config, blocos: [...config.blocos, BLOCO_VAZIO()] })}><${Icone} nome="add" />Adicionar bloco</button>` : null}
          </div>
          ${editando && erros.length ? html`<ul class="mon-erros mon-fm-erros" role="alert">${erros.map((e) => html`<li key=${e}>${e}</li>`)}</ul>` : null}
        </section>

        <aside class="mon-fm-direita">
          <section class="mon-fm-card" aria-label="Escala e faixas de nota">
            <header class="mon-fm-card-cab"><h2>Escala e faixas de nota</h2></header>
            <div class="mon-fm-card-corpo">
              <div class="mon-fm-escala">
                <label class="mon-campo">Escala mínima<input class=${`form-control ${ro ? 'is-ro' : ''}`} type="number" readOnly=${ro} value=${config.escala.min} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, min: Number(e.target.value) } })} /></label>
                <label class="mon-campo">Escala máxima<input class=${`form-control ${ro ? 'is-ro' : ''}`} type="number" readOnly=${ro} value=${config.escala.max} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, max: Number(e.target.value) } })} /></label>
                <label class="mon-campo">Mínimo de blocos avaliados<input class=${`form-control ${ro ? 'is-ro' : ''}`} type="number" readOnly=${ro} value=${config.min_blocos} onInput=${(e) => setConfig({ ...config, min_blocos: Number(e.target.value) })} /></label>
              </div>
              <table class="mon-fm-faixas"><thead><tr><th scope="col">Faixa</th><th scope="col">De</th><th scope="col">Cor</th><th scope="col">Ação recomendada</th></tr></thead><tbody>
                ${config.faixas.map((f, i) => html`<tr key=${i}>
                  <td><input class=${`form-control ${ro ? 'is-ro' : ''}`} aria-label=${`Nome da faixa ${i + 1}`} readOnly=${ro} value=${f.label} onInput=${(e) => setFaixa(i, 'label', e.target.value)} /></td>
                  <td><input class=${`form-control ${ro ? 'is-ro' : ''}`} type="number" aria-label=${`Nota mínima de ${f.label}`} readOnly=${ro} value=${f.min} onInput=${(e) => setFaixa(i, 'min', Number(e.target.value))} /></td>
                  <td>${ro ? html`<span class="mon-fm-cor" style=${{ '--faixa': f.cor || 'var(--brand)' }} role="img" aria-label=${`Cor de ${f.label}`}></span>` : html`<input type="color" class="mon-fm-cor-in" aria-label=${`Cor de ${f.label}`} value=${f.cor || '#0a4b8c'} onInput=${(e) => setFaixa(i, 'cor', e.target.value)} />`}</td>
                  <td><input class=${`form-control ${ro ? 'is-ro' : ''}`} aria-label=${`Ação recomendada de ${f.label}`} title=${f.acao || ''} readOnly=${ro} value=${f.acao || ''} onInput=${(e) => setFaixa(i, 'acao', e.target.value)} /></td></tr>`)}
              </tbody></table>
            </div>
          </section>

          <section class="mon-fm-card mon-fm-versoes-card" aria-label="Histórico de versões">
            <header class="mon-fm-card-cab"><h2>Histórico de versões</h2>
              <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${comparar.length !== 2} onClick=${compararSelecionadas} title="Marque duas versões para comparar">Comparar (${comparar.length}/2)</button>
            </header>
            ${editando && !criando ? html`<div class="mon-fm-nova"><strong>v${nova} · Nova</strong> · Será criada quando você salvar.</div>` : null}
            <ul class="mon-ver-lista">
              ${versoesVisiveis.map((v) => html`<${VersionRow} key=${v.id_versao} versao=${v} marcada=${comparar.includes(v.id_versao)} desabilitada=${marcarCheio}
                motivoDesabilitada="Já há 2 versões marcadas. Desmarque uma para escolher outra."
                aoMarcar=${(id) => setComparar((m) => alternarMarcadas(m, id))}
                aoVer=${(ver) => { if (!editando) setIdVersao(String(ver.id_versao)); }}
                aoRestaurar=${podeEditar && !editando && situacao !== 'arquivado' ? pedirRestaurar : null} />`)}
            </ul>
            ${versoes && versoes.length > VERSOES_NO_CARD ? html`<button type="button" class="btn btn-link btn-sm mon-lf-ver-todas" onClick=${() => setTodasVersoes((x) => !x)}>${todasVersoes ? 'Mostrar menos' : `Ver todas as ${versoes.length} versões`}</button>` : null}
            ${formulario ? html`<p class="mon-muted mon-fm-versoes-rodape">${formulario.monitorias} monitoria(s) feitas com este formulário${formulario.origem ? ` · copiado de ${formulario.origem}` : ''}.</p>` : null}
          </section>
        </aside>
      </div>`}

      <${DialogoDuplicar} formulario=${duplicando} operacoes=${ativas} showToast=${showToast} aoFechar=${() => setDuplicando(null)}
        aoConcluir=${(r) => { setDuplicando(null); if (r.operacao === operacao) setIdMatriz(String(r.id_matriz)); setIdVersao(''); setRecarga((x) => x + 1); }} />
      <${DialogoConfirmar} aberto=${Boolean(confirmando)}
        titulo=${confirmando ? ({ sair: 'Descartar alterações?', ativar: 'Tornar ativo', restaurar: `Restaurar a v${confirmando.versao?.numero}?` }[confirmando.tipo]) : ''}
        descricao=${confirmando?.descricao} textoConfirmar=${confirmando ? ({ sair: 'Descartar', ativar: 'Tornar ativo', restaurar: 'Restaurar' }[confirmando.tipo]) : ''}
        perigo=${confirmando?.tipo === 'sair'} aoCancelar=${() => setConfirmando(null)} aoConfirmar=${executarConfirmacao} />
      <${ModalComparacao} comparacao=${comparacao} aoFechar=${() => setComparacao(null)} />
    </div>`;
}
