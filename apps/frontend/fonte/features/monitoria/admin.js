import { html, useEffect, useRef, useState, React } from '../../infraestrutura-react.js';
import {
  ativarFormularioMatriz,
  lerVersaoMatriz,
  listarFormulariosMatriz,
  listarVersoesMatriz,
  restaurarVersaoMatriz,
  salvarMatriz,
} from '../../services/api/monitoria.js';
import { Esqueleto, Estado, Ic, MenuAcoes, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { formatarNota } from './comum.js';
import {
  ChipSituacao,
  DialogoConfirmar,
  ModalComparacao,
  VersionRow,
  alternarMarcadas,
  compararConfigs,
} from './formularios-comum.js?v=20261109-telas-antigas';
import { DialogoDuplicar, ESTADO_LISTA_INICIAL, TelaListaFormularios } from './formularios-lista.js?v=20261109-telas-antigas';

const Fragment = React.Fragment;

// Formulários (matriz de qualidade versionada por operação; redesign Fase 15, fatia 4, amostras Q2 e Q3 do lote 2):
// a aba abre a LISTA de formulários e, a partir dela, o formulário aberto — uma tabela única "Perguntas e pesos" com os
// blocos como linhas de grupo, e a coluna da direita com Escala e faixas e Versões. Salvar sempre cria uma nova versão.
// Usuários, equipes/catálogos e logs da Monitoria ficam em Configurações (features/configuracoes/monitoria-config.js).

export { compararConfigs };

function somaPesos(bloco) {
  return (bloco.criterios || []).reduce((t, c) => t + (Number(c.peso) || 0), 0);
}

const clonar = (valor) => JSON.parse(JSON.stringify(valor));
const BLOCO_VAZIO = () => ({ nome: '', valor: 0, criterios: [{ texto: '', peso: 0 }] });
const VERSOES_NO_CARD = 4;

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

export function TelaFormularios({ controlador, contexto, showToast }) {
  const podeEditar = controlador.possuiPermissao('monitoria.matriz');
  const [alvo, setAlvo] = useState(null); // null = lista; { id_matriz, operacao, id_versao?, criar? } = formulário aberto
  const [estadoLista, setEstadoLista] = useState(ESTADO_LISTA_INICIAL);
  const [recargaLista, setRecargaLista] = useState(0);
  const [base, setBase] = useState(null); // formulário escolhido na lista: base do "Novo formulário"

  if (!(contexto?.operacoes || []).some((o) => o.ativo)) {
    return html`<main class="c-pagina c-conteudo"><div class="c-cab-linha"><h1>Formulários</h1></div>
      <div class="c-tabela-caixa"><${Estado} icone="list-checks" titulo="Sem operações" texto="Você não está vinculado a nenhuma operação ativa." /></div></main>`;
  }
  if (alvo) {
    return html`<${TelaFormulario} key=${`${alvo.id_matriz}`} controlador=${controlador} contexto=${contexto} showToast=${showToast} alvo=${alvo}
      aoVoltar=${() => { setAlvo(null); setRecargaLista((x) => x + 1); }} />`;
  }
  // "Novo formulário" segue o fluxo de antes: abre um formulário da operação já no modo de criação (formulário em branco).
  const criarDe = (f) => f && setAlvo({ id_matriz: f.id_matriz, operacao: f.operacao, criar: true });
  return html`<main class="c-pagina c-conteudo">
    <div class="c-cab-linha"><h1>Formulários</h1>
      ${podeEditar ? html`<div class="c-cab-dir"><button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${!base || null} onClick=${() => criarDe(base)}><${Ic} nome="plus" />Novo formulário</button></div>` : null}</div>
    <${TelaListaFormularios} contexto=${contexto} podeEditar=${podeEditar} showToast=${showToast} estado=${estadoLista} setEstado=${setEstadoLista}
      recarga=${recargaLista} aoReload=${() => setRecargaLista((x) => x + 1)}
      aoAbrir=${(f, idVersao) => setAlvo({ id_matriz: f.id_matriz, operacao: f.operacao, id_versao: idVersao || null })}
      aoCriar=${criarDe} aoEscolhido=${setBase} />
  </main>`;
}

function TelaFormulario({ controlador, contexto, showToast, alvo, aoVoltar }) {
  const podeEditar = controlador.possuiPermissao('monitoria.matriz');
  const ativas = (contexto?.operacoes || []).filter((o) => o.ativo);
  const operacao = alvo.operacao;
  const [formularios, setFormularios] = useState([]);
  const idMatriz = String(alvo.id_matriz);
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

  // Formulários da operação (para saber a situação deste e se outro está ativo).
  useEffect(() => {
    if (!operacao) return undefined;
    let ativo = true;
    listarFormulariosMatriz(operacao).then((r) => { if (ativo) setFormularios(r.itens || []); }).catch(() => { if (ativo) setFormularios([]); });
    return () => { ativo = false; };
  }, [operacao, recarga]);

  // Versões do formulário (a ativa vem selecionada).
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
    else { setVersoes(null); setVersao(null); setConfig(null); }
    listarVersoesMatriz(operacao, idMatriz)
      .then((r) => {
        if (!ativo) return;
        const itens = r.itens || [];
        cacheVersoes.set(chaveCache, itens);
        aplicarVersoes(itens);
      })
      .catch((e) => { if (ativo) { setVersoes([]); setErroCarga(e?.message || 'Erro ao carregar o formulário.'); } });
    return () => { ativo = false; };
  }, [operacao, idMatriz, recarga]);

  // Carrega a versão escolhida.
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
  // "Novo formulário" na lista abre esta tela já no fluxo de criação (formulário em branco).
  useEffect(() => {
    if (alvo.criar && config && !criarDisparado.current) { criarDisparado.current = true; criar(); }
  }, [config]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarMatriz(operacao, config, observacao, idMatriz);
      showToast(`Nova versão ${r.numero} criada. As monitorias antigas permanecem com a versão original.`, 'success');
      setObservacao(''); setEditando(false); setCriando(false); setIdVersao(''); setRecarga((x) => x + 1);
    } catch (e) { showToast(e?.message || 'Não foi possível salvar.', 'danger'); } finally { setSalvando(false); }
  };

  const pedirTornarAtivo = async () => {
    if (!formulario) return;
    const outro = formularios.find((f) => f.ativo && f.id_matriz !== formulario.id_matriz);
    const aviso = outro ? ` "${outro.nome}" deixa de ser o formulário ativo da operação.` : '';
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

  const blocos = config?.blocos || [];
  const totalValores = blocos.reduce((t, b) => t + (Number(b.valor) || 0), 0);
  const totalOk = Math.abs(totalValores - 100) <= 0.0001;
  const versoesVisiveis = todasVersoes ? versoes : (versoes || []).slice(0, VERSOES_NO_CARD);
  const marcarCheio = comparar.length >= 2;
  const ro = !editando;
  const seloCab = editando
    ? html`<${Selo} tom="informacao" icone="pencil-simple">${criando ? 'Novo formulário' : `Editando · v${nova}`}<//>`
    : situacao ? html`<${ChipSituacao} situacao=${situacao} extra=${versao ? `v${versao.numero}${arquivada ? ' (arquivada)' : ''}` : ''} />` : null;

  const linhasBloco = (b, i) => {
    const chaveBloco = b.id || i;
    const fechado = Boolean(fechados[chaveBloco]);
    const soma = somaPesos(b);
    const fecha = Math.abs(soma - Number(b.valor || 0)) <= 0.0001;
    return html`<${Fragment} key=${chaveBloco}>
      <tr class="c-gab-bloco">
        <td colspan="2">
          <span class="c-grupo" style=${{ flexWrap: 'nowrap' }}>
            <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-expanded=${!fechado} aria-label=${`${fechado ? 'Abrir' : 'Fechar'} bloco ${b.nome || ''}`.trim()} onClick=${() => setFechados((f) => ({ ...f, [chaveBloco]: !fechado }))}><${Ic} nome=${fechado ? 'caret-right' : 'caret-down'} /></button>
            ${editando ? html`<input class="c-entrada c-entrada--compacta c-fm-bloco-nome" aria-label="Nome do bloco" placeholder="Nome do bloco" value=${b.nome} onInput=${(e) => setBloco(i, 'nome', e.target.value)} />`
              : html`<span class="c-fm-bloco-nome" title=${b.nome}>${b.nome}</span>`}
            <span class=${`c-fm-soma ${fecha ? '' : 'c-fm-soma--erro'}`} title="Soma dos pesos das perguntas / valor do bloco"><${Ic} nome=${fecha ? 'check-circle' : 'warning'} />${formatarNota(soma)} de ${formatarNota(b.valor)}</span>
          </span>
        </td>
        <td class="c-num">${editando ? html`<input class="c-entrada c-entrada--compacta c-fm-peso" type="number" step="0.5" aria-label=${`Valor do bloco ${b.nome || ''}`.trim()} value=${b.valor} onInput=${(e) => setBloco(i, 'valor', e.target.value)} />` : html`<b>${formatarNota(b.valor)}</b>`}</td>
        <td class="c-acoes">${editando ? html`<${MenuAcoes} rotulo=${`Ações do bloco ${b.nome || ''}`.trim()} acoes=${[
          { label: 'Mover para cima', icon: 'arrow-up', disabled: i === 0, onClick: () => setConfig({ ...config, blocos: mover(config.blocos, i, -1) }) },
          { label: 'Mover para baixo', icon: 'arrow-down', disabled: i === blocos.length - 1, onClick: () => setConfig({ ...config, blocos: mover(config.blocos, i, 1) }) },
          { label: 'Remover bloco', icon: 'trash', perigo: true, onClick: () => setConfig({ ...config, blocos: config.blocos.filter((_, j) => j !== i) }) },
        ]} />` : html`<span class="c-ajuda">${b.criterios.length} perg.</span>`}</td>
      </tr>
      ${fechado ? null : b.criterios.map((c, k) => html`<tr key=${c.id || k}>
        <td style=${{ width: '32px' }}></td>
        <td class="c-estica">${editando ? html`<input class="c-entrada c-entrada--compacta" aria-label="Pergunta" placeholder="Texto da pergunta" value=${c.texto} onInput=${(e) => setCriterio(i, k, 'texto', e.target.value)} />`
          : html`<span class="c-quebra">${c.texto}</span>`}</td>
        <td class="c-num">${editando ? html`<input class="c-entrada c-entrada--compacta c-fm-peso" type="number" step="0.5" aria-label=${`Peso de ${c.texto || 'pergunta'}`} value=${c.peso} onInput=${(e) => setCriterio(i, k, 'peso', e.target.value)} />` : formatarNota(c.peso)}</td>
        <td class="c-acoes">${editando ? html`<span class="c-grupo" style=${{ flexWrap: 'nowrap' }}>
          <${MenuAcoes} rotulo=${`Mover pergunta ${k + 1}`} icone="arrows-clockwise" acoes=${[
            { label: 'Mover para cima', icon: 'arrow-up', disabled: k === 0, onClick: () => setBloco(i, 'criterios', mover(b.criterios, k, -1)) },
            { label: 'Mover para baixo', icon: 'arrow-down', disabled: k === b.criterios.length - 1, onClick: () => setBloco(i, 'criterios', mover(b.criterios, k, 1)) },
          ]} />
          <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Remover pergunta" title="Remover pergunta" onClick=${() => setBloco(i, 'criterios', b.criterios.filter((_, l) => l !== k))}><${Ic} nome="trash" /></button>
        </span>` : null}</td>
      </tr>`)}
      ${editando && !fechado ? html`<tr><td></td><td colspan="3"><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setBloco(i, 'criterios', [...b.criterios, { texto: '', peso: 0 }])}><${Ic} nome="plus" />Pergunta</button></td></tr>` : null}
    <//>`;
  };

  return html`<main class="c-pagina c-conteudo">
    <div class="c-cab-linha c-cab-escala">
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Voltar para Formulários" title="Voltar para Formulários" onClick=${() => pedirSair(aoVoltar)}><${Ic} nome="arrow-left" /></button>
      <h1 title=${formulario?.nome || ''}>${formulario?.nome || 'Formulário'}</h1>
      ${seloCab}
      ${formulario ? html`<span class="c-ajuda">${formulario.operacao_nome || operacao} · ${formulario.monitorias ?? 0} monitoria(s)${formulario.origem ? ` · cópia de ${formulario.origem}` : ''}</span>` : null}
      ${podeEditar ? html`<div class="c-cab-dir">
        ${editando ? html`
          <label class="c-fm-obs"><span class="c-oculto">O que mudou</span><input class="c-entrada c-entrada--compacta" placeholder="O que mudou" aria-label="O que mudou (opcional)" value=${observacao} onInput=${(e) => setObservacao(e.target.value)} /></label>
          <button type="button" class="c-botao c-botao--secundario" onClick=${() => pedirSair(cancelarEdicao)}>Cancelar</button>
          <button type="button" class="c-botao c-botao--principal" aria-busy=${salvando ? 'true' : null} disabled=${!alterou || erros.length > 0 || salvando || null} title=${erros[0] || null} onClick=${salvar}>${salvando ? 'Salvando…' : `Salvar como v${nova}`}</button>`
        : html`
          <button type="button" class="c-botao c-botao--secundario" disabled=${!config || null} title="Cria uma cópia desativada desta versão" onClick=${() => setDuplicando({ ...formulario, operacao, id_versao_ativa: versaoAtiva?.id_versao })}><${Ic} nome="copy" />Duplicar</button>
          ${formulario && situacao === 'desativado' ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${pedirTornarAtivo}><${Ic} nome="check-circle" />Tornar ativo</button>` : null}
          ${arquivada
            ? html`<button type="button" class="c-botao c-botao--principal" disabled=${!config || situacao === 'arquivado' || null} onClick=${() => pedirRestaurar(versao)}><${Ic} nome="arrow-counter-clockwise" />Restaurar esta versão</button>`
            : html`<button type="button" class="c-botao c-botao--principal" disabled=${!config || situacao === 'arquivado' || null} onClick=${() => setEditando(true)}><${Ic} nome="pencil-simple" />Editar formulário</button>`}`}
      </div>` : null}
    </div>

    ${erroCarga ? html`<div class="c-tabela-caixa"><${Estado} titulo=${erroCarga} rotuloAcao="Tentar de novo" aoAcao=${() => { setErroCarga(''); setRecarga((x) => x + 1); }} /></div>`
      : versoes && !versoes.length ? html`<div class="c-tabela-caixa"><${Estado} icone="list-checks" titulo="Formulário sem versões" texto="Este formulário ainda não tem nenhuma versão." /></div>`
      : !config ? html`<div class="c-tabela-caixa"><${Esqueleto} linhas=${8} /></div>` : html`
    ${arquivada && !editando ? html`<div class="c-faixa c-faixa--informacao" role="status"><${Ic} nome="info" /><div class="c-faixa-txt"><p>Você está vendo a v${versao.numero}, arquivada. A atual é a v${versaoAtiva?.numero}.</p></div></div>` : null}
    <div class="c-fm-corpo">
      <div class="c-tabela-caixa">
        <div class="c-filtros c-filtros--suave">
          <h2 class="c-cad-titulo">Perguntas e pesos</h2>
          <span class=${`c-fm-soma ${totalOk ? '' : 'c-fm-soma--erro'}`} title="Soma dos valores dos blocos"><${Ic} nome=${totalOk ? 'check-circle' : 'warning'} />Soma dos pesos: ${formatarNota(totalValores)} de 100</span>
          ${editando ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" style=${{ marginLeft: 'auto' }} onClick=${() => setConfig({ ...config, blocos: [...config.blocos, BLOCO_VAZIO()] })}><${Ic} nome="plus" />Novo bloco</button>` : null}
        </div>
        <table class="c-tabela c-tabela--compacta c-fm-ed">
          <thead><tr><th scope="col" style=${{ width: '32px' }}><span class="c-oculto">Abrir</span></th><th scope="col" class="c-estica">Pergunta</th><th scope="col" class="c-num">Peso</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${blocos.map(linhasBloco)}</tbody>
        </table>
        ${editando && erros.length ? html`<div class="c-faixa c-faixa--perigo" role="alert" style=${{ margin: 'var(--espaco-2) var(--espaco-3)' }}><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erros.join(' · ')}</p></div></div>` : null}
      </div>

      <div class="c-fm-lado-col">
        <section class="c-db-bloco" aria-label="Escala e faixas">
          <div class="c-db-bloco-cab"><h3>Escala e faixas</h3></div>
          <div class="c-db-bloco-corpo">
            <div class="c-form" style=${{ '--colunas': 3, gap: 'var(--espaco-2)' }}>
              <label class="c-campo"><span class="c-rotulo">Pilares de</span><input class="c-entrada c-entrada--compacta" type="number" readOnly=${ro} value=${config.escala.min} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, min: Number(e.target.value) } })} /></label>
              <label class="c-campo"><span class="c-rotulo">até</span><input class="c-entrada c-entrada--compacta" type="number" readOnly=${ro} value=${config.escala.max} onInput=${(e) => setConfig({ ...config, escala: { ...config.escala, max: Number(e.target.value) } })} /></label>
              <label class="c-campo"><span class="c-rotulo">Blocos mín.</span><input class="c-entrada c-entrada--compacta" type="number" readOnly=${ro} value=${config.min_blocos} onInput=${(e) => setConfig({ ...config, min_blocos: Number(e.target.value) })} /></label>
            </div>
            <p class="c-ajuda" style=${{ margin: 0 }}>Nota de 0 a 100 (soma dos pesos atendidos).</p>
            <table class="c-tabela c-tabela--compacta">
              <thead><tr><th scope="col">Faixa</th><th scope="col">De</th><th scope="col">Ação</th></tr></thead>
              <tbody>${config.faixas.map((f, i) => html`<tr key=${i}>
                <td>${ro ? html`<span><span class="c-fm-faixa" style=${{ '--f': f.cor || 'var(--cor-acao-fundo)' }}></span>${f.label}</span>`
                  : html`<span class="c-grupo" style=${{ flexWrap: 'nowrap' }}><input type="color" aria-label=${`Cor de ${f.label}`} value=${f.cor || '#0a4b8c'} onInput=${(e) => setFaixa(i, 'cor', e.target.value)} style=${{ width: '24px', height: '24px', padding: 0, border: 0 }} /><input class="c-entrada c-entrada--compacta" aria-label=${`Nome da faixa ${i + 1}`} value=${f.label} onInput=${(e) => setFaixa(i, 'label', e.target.value)} /></span>`}</td>
                <td>${ro ? formatarNota(f.min) : html`<input class="c-entrada c-entrada--compacta" type="number" aria-label=${`Nota mínima de ${f.label}`} value=${f.min} onInput=${(e) => setFaixa(i, 'min', Number(e.target.value))} />`}</td>
                <td>${ro ? html`<span class="c-quebra c-secundario">${f.acao || '—'}</span>` : html`<input class="c-entrada c-entrada--compacta" aria-label=${`Ação recomendada de ${f.label}`} value=${f.acao || ''} onInput=${(e) => setFaixa(i, 'acao', e.target.value)} />`}</td>
              </tr>`)}</tbody>
            </table>
          </div>
        </section>

        <section class="c-db-bloco" aria-label="Versões">
          <div class="c-db-bloco-cab"><h3>Versões</h3>
            <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${comparar.length !== 2 || null} title="Marque duas versões para comparar" onClick=${compararSelecionadas}>Comparar (${comparar.length}/2)</button></div>
          <div class="c-db-bloco-corpo c-fm-versoes" role="list">
            ${editando && !criando ? html`<div class="c-fm-versao c-fm-versao--ro" role="listitem"><b>v${nova}</b><span><small>Nova · nasce quando você salvar</small></span><${Selo} tom="informacao">Editando<//></div>` : null}
            ${versoesVisiveis.map((v) => html`<${VersionRow} key=${v.id_versao} versao=${v} atual=${String(v.id_versao) === String(idVersao)} marcada=${comparar.includes(v.id_versao)} desabilitada=${marcarCheio}
              motivoDesabilitada="Já há 2 versões marcadas. Desmarque uma para escolher outra."
              aoMarcar=${(id) => setComparar((m) => alternarMarcadas(m, id))}
              aoVer=${(ver) => { if (!editando) setIdVersao(String(ver.id_versao)); }}
              aoRestaurar=${podeEditar && !editando && situacao !== 'arquivado' ? pedirRestaurar : null} />`)}
            ${versoes && versoes.length > VERSOES_NO_CARD ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => setTodasVersoes((x) => !x)}>${todasVersoes ? 'Mostrar menos' : `Ver todas as ${versoes.length} versões`}</button>` : null}
            <p class="c-ajuda" style=${{ margin: 0 }}>Salvar cria uma nova versão; as anteriores ficam arquivadas e as monitorias feitas continuam com a versão da época.</p>
          </div>
        </section>
      </div>
    </div>`}

    <${DialogoDuplicar} formulario=${duplicando} operacoes=${ativas} showToast=${showToast} aoFechar=${() => setDuplicando(null)}
      aoConcluir=${() => { setDuplicando(null); setRecarga((x) => x + 1); }} />
    <${DialogoConfirmar} aberto=${Boolean(confirmando)}
      titulo=${confirmando ? ({ sair: 'Descartar alterações?', ativar: 'Tornar ativo', restaurar: `Restaurar a v${confirmando.versao?.numero}?` }[confirmando.tipo]) : ''}
      descricao=${confirmando?.descricao} textoConfirmar=${confirmando ? ({ sair: 'Descartar', ativar: 'Tornar ativo', restaurar: 'Restaurar' }[confirmando.tipo]) : ''}
      perigo=${confirmando?.tipo === 'sair'} aoCancelar=${() => setConfirmando(null)} aoConfirmar=${executarConfirmacao} />
    <${ModalComparacao} comparacao=${comparacao} aoFechar=${() => setComparacao(null)} />
  </main>`;
}
