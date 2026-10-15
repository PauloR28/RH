import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { EmptyState, ModalPadrao } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  calcularPrevia,
  descartarRascunho,
  lerMatriz,
  listarCatalogoMonitoria,
  listarOperadoresMonitoria,
  listarRascunhos,
  realizarMonitoria,
  salvarRascunho,
} from '../../services/api/monitoria.js';
import { RESPOSTAS, formatarNota, hoje, SelectOperacao } from './comum.js';
import { AnswerSegmented, ProgressBar, RatingScale, StepRail } from './nova-componentes.js?v=20261014-nova';

// Formulário de monitoria (avaliador), em etapas: trilho + resumo fixos à esquerda e a etapa
// aberta à direita. A nota exibida é sempre calculada pelo servidor (mesmo motor da gravação) —
// o navegador nunca tem uma segunda fórmula.

const ESTADO_INICIAL = {
  id_operador: '',
  canal: '',
  tipo_atendimento: '',
  data_contato: hoje(),
  telefone: '',
  id_interacao: '',
  respostas: {},
  pilares: { conhecimento: {}, encantamento: {} },
  motivo_ncg: '',
  justificativa_anulacao: '',
  observacao: '',
  sugestao_feedback: '',
};

const ETAPA_CONTATO = 'contato';
const ETAPA_PILARES = 'pilares';
const ETAPA_OBS = 'obs';
const idBloco = (b) => `bloco:${b.id}`;
const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

export function TelaNovaMonitoria({ controlador, contexto, aoConcluir, showToast }) {
  const operacoesAtivas = (contexto?.operacoes || []).filter((op) => op.ativo);
  const [operacao, setOperacao] = useState(operacoesAtivas.length === 1 ? operacoesAtivas[0].chave : '');
  const [dados, setDados] = useState(ESTADO_INICIAL);
  const [matriz, setMatriz] = useState(null);
  const [operadores, setOperadores] = useState([]);
  const [canais, setCanais] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [rascunhos, setRascunhos] = useState([]);
  const [idRascunho, setIdRascunho] = useState(0);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [etapa, setEtapa] = useState(ETAPA_CONTATO);
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const temporizador = useRef(null);

  useEffect(() => {
    listarRascunhos().then((r) => setRascunhos(r?.itens || [])).catch(() => setRascunhos([]));
  }, []);

  useEffect(() => {
    if (!operacao) {
      setMatriz(null);
      return undefined;
    }
    let ativo = true;
    setCarregando(true);
    setErro('');
    Promise.all([
      lerMatriz(operacao, true),
      listarOperadoresMonitoria(operacao),
      listarCatalogoMonitoria('canal', operacao),
      listarCatalogoMonitoria('tipo_atendimento', operacao),
    ])
      .then(([m, ops, cs, ts]) => {
        if (!ativo) return;
        setMatriz(m?.versao_ativa || null);
        setOperadores(ops?.itens || []);
        setCanais(cs?.itens || []);
        setTipos(ts?.itens || []);
      })
      .catch((e) => { if (ativo) { setMatriz(null); setErro(e?.message || 'Não foi possível carregar o formulário desta operação.'); } })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [operacao, tentativa]);

  // Prévia da nota (servidor) com debounce.
  useEffect(() => {
    if (!operacao || !matriz) return undefined;
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => {
      calcularPrevia(operacao, dados.respostas).then(setPrevia).catch(() => setPrevia(null));
    }, 250);
    return () => window.clearTimeout(temporizador.current);
  }, [operacao, matriz, dados.respostas]);

  const config = matriz?.config;
  const blocos = config?.blocos || [];
  const operadorSelecionado = operadores.find((o) => String(o.id_usuario) === String(dados.id_operador));
  const blocosStatus = useMemo(() => Object.fromEntries((previa?.blocos || []).map((b) => [b.id, b])), [previa]);

  const atualizar = (campo, valor) => setDados((atual) => ({ ...atual, [campo]: valor }));
  // Tipos de atendimento pertencem a um canal (id_item_canal); os sem canal valem para todos.
  const canalSelecionado = canais.find((c) => c.valor === dados.canal);
  const tiposDisponiveis = tipos
    .filter((t) => !t.id_item_canal || !canalSelecionado || t.id_item_canal === canalSelecionado.id_item)
    .filter((t, i, lista) => lista.findIndex((o) => o.valor === t.valor) === i);
  const trocarCanal = (valor) => {
    const canal = canais.find((c) => c.valor === valor);
    setDados((atual) => {
      const tipoAtual = tipos.find((t) => t.valor === atual.tipo_atendimento);
      const mantem = !tipoAtual || !canal || !tipoAtual.id_item_canal || tipos.some((t) => t.valor === atual.tipo_atendimento && (!t.id_item_canal || t.id_item_canal === canal.id_item));
      return { ...atual, canal: valor, tipo_atendimento: mantem ? atual.tipo_atendimento : '' };
    });
  };
  // Clicar de novo na resposta marcada a desmarca (valor null remove a chave).
  const responder = (idCriterio, valor) =>
    setDados((atual) => {
      const respostas = { ...atual.respostas };
      if (valor == null) delete respostas[idCriterio];
      else respostas[idCriterio] = valor;
      return { ...atual, respostas };
    });
  const notaPilar = (tipo, indicador, valor) =>
    setDados((atual) => ({ ...atual, pilares: { ...atual.pilares, [tipo]: { ...atual.pilares[tipo], [indicador]: valor } } }));

  const pendentesPilares = ['conhecimento', 'encantamento'].reduce(
    (total, tipo) => total + (config?.pilares?.[tipo] || []).filter((p) => !dados.pilares[tipo]?.[p.chave]).length,
    0,
  );
  const totalPilares = ['conhecimento', 'encantamento'].reduce((t, tipo) => t + (config?.pilares?.[tipo] || []).length, 0);

  // Validações: a mesma lista alimenta "O que falta para finalizar" e o botão Finalizar.
  const problemas = [];
  if (!dados.id_operador) problemas.push('Selecione o operador.');
  if (!dados.canal || !dados.tipo_atendimento) problemas.push('Informe o canal e o tipo de atendimento.');
  if (!dados.data_contato) problemas.push('Informe a data do contato.');
  if (previa && previa.pendentes > 0) problemas.push(`Responda todos os critérios (${previa.pendentes} pendente(s)).`);
  if (pendentesPilares > 0) problemas.push('Avalie todos os indicadores dos pilares.');
  if (previa?.possui_ncg && !dados.motivo_ncg.trim()) problemas.push('Informe o motivo da NCG.');
  if (previa?.anulada && !dados.justificativa_anulacao.trim()) problemas.push('Informe a justificativa da anulação (menos de 3 blocos avaliados).');

  // Etapas: Dados do contato, um bloco por linha do formulário, Pilares e Observação e feedback.
  const camposContato = [dados.id_operador, dados.canal, dados.tipo_atendimento, dados.data_contato].map(Boolean);
  const faltamContato = camposContato.filter((v) => !v).length;
  const respondidosDoBloco = (bloco) => bloco.criterios.filter((c) => dados.respostas[c.id]).length;
  const etapas = [
    { id: ETAPA_CONTATO, rotulo: 'Dados do contato', contador: faltamContato ? `${faltamContato} faltam` : 'completo', aviso: faltamContato > 0, completa: faltamContato === 0 && Boolean(config) },
    ...blocos.map((b) => ({ id: idBloco(b), rotulo: b.nome, contador: `${respondidosDoBloco(b)}/${b.criterios.length}`, completa: respondidosDoBloco(b) === b.criterios.length })),
    ...(config ? [{ id: ETAPA_PILARES, rotulo: 'Pilares', contador: `${totalPilares - pendentesPilares}/${totalPilares}`, completa: pendentesPilares === 0 }] : []),
    ...(config ? [{ id: ETAPA_OBS, rotulo: 'Observação e feedback', contador: 'opcional', completa: false }] : []),
  ];
  const indiceEtapa = Math.max(0, etapas.findIndex((e) => e.id === etapa));
  const etapaAtual = etapas[indiceEtapa] || etapas[0];
  const blocoAtual = blocos.find((b) => idBloco(b) === etapa) || null;

  const irPrimeiraPendencia = () => {
    if (faltamContato > 0) return setEtapa(ETAPA_CONTATO);
    const bloco = blocos.find((b) => respondidosDoBloco(b) < b.criterios.length);
    if (bloco) return setEtapa(idBloco(bloco));
    if (pendentesPilares > 0) return setEtapa(ETAPA_PILARES);
    return setEtapa(ETAPA_OBS);
  };

  const corpo = () => ({ ...dados, operacao, id_operador: Number(dados.id_operador) });

  const salvarComoRascunho = async () => {
    try {
      const r = await salvarRascunho({ operacao, payload: dados }, idRascunho || null);
      setIdRascunho(r.id_rascunho);
      showToast('Rascunho salvo. Só você o vê e pode descartá-lo.', 'success');
    } catch (e) {
      showToast(e?.message || 'Não foi possível salvar o rascunho.', 'danger');
    }
  };

  const abrirRascunho = (r) => {
    setOperacao(r.operacao);
    setDados({ ...ESTADO_INICIAL, ...r.payload });
    setIdRascunho(r.id_rascunho);
    setEtapa(ETAPA_CONTATO);
  };

  // Finalizar fica clicável com pendências: mostra as validações e leva à primeira etapa pendente.
  const tentarFinalizar = () => {
    if (problemas.length) {
      setMostrarPendencias(true);
      irPrimeiraPendencia();
      return;
    }
    setConfirmando(true);
  };

  const finalizar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const r = await realizarMonitoria(corpo(), idRascunho);
      setConfirmando(false);
      showToast(`Monitoria #${r.codigo} realizada. Nota ${formatarNota(r.nota)}${r.anulada ? ' (anulada)' : ''}.`, 'success');
      aoConcluir?.(r);
    } catch (e) {
      setErro(e?.message || 'Não foi possível finalizar a monitoria.');
      setConfirmando(false);
    } finally {
      setSalvando(false);
    }
  };

  if (!operacoesAtivas.length) {
    return html`<${EmptyState} icon="fact_check" title="Nenhuma operação ativa" text="Você não está vinculado a nenhuma operação ativa para realizar monitorias." />`;
  }

  // ---- conteúdo da etapa ---------------------------------------------------
  const etapaContato = html`
    <div class="mon-nm-contato">
      ${rascunhos.length ? html`
        <div class="mon-nm-rascunhos"><strong>Meus rascunhos</strong>
          ${rascunhos.map((r) => html`
            <span key=${r.id_rascunho} class="mon-nm-rascunho">
              <button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirRascunho(r)}>${r.operacao} · ${new Date(r.atualizado_em).toLocaleString('pt-BR')}</button>
              <button type="button" class="btn btn-link btn-sm text-danger" title="Descartar rascunho"
                onClick=${async () => { await descartarRascunho(r.id_rascunho); setRascunhos((l) => l.filter((x) => x.id_rascunho !== r.id_rascunho)); if (idRascunho === r.id_rascunho) setIdRascunho(0); }}>Descartar</button>
            </span>`)}
        </div>` : null}
      <div class="mon-nm-grade4">
        <label class="mon-campo">Operação
          <${SelectOperacao} contexto=${{ operacoes: operacoesAtivas }} valor=${operacao} todas=${false}
            onChange=${(v) => { setOperacao(v); setDados({ ...ESTADO_INICIAL }); setIdRascunho(0); setPrevia(null); }} />
        </label>
        ${operacao ? html`
          <label class="mon-campo">Operador
            <select class="form-select" value=${dados.id_operador} onChange=${(e) => atualizar('id_operador', e.target.value)}>
              <option value="">Selecione…</option>
              ${operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}
            </select>
          </label>
          <label class="mon-campo">Equipe
            <input class="form-control" readOnly value=${operadorSelecionado?.equipe_nome || (dados.id_operador ? 'Sem equipe' : '')} />
          </label>
          <label class="mon-campo">Canal de atendimento
            <select class="form-select" value=${dados.canal} onChange=${(e) => trocarCanal(e.target.value)}>
              <option value="">Selecione…</option>
              ${canais.map((c) => html`<option key=${c.id_item} value=${c.valor}>${c.valor}</option>`)}
            </select>
          </label>
          <label class="mon-campo">Tipo de atendimento
            <select class="form-select" value=${dados.tipo_atendimento} onChange=${(e) => atualizar('tipo_atendimento', e.target.value)}>
              <option value="">Selecione…</option>
              ${tiposDisponiveis.map((c) => html`<option key=${c.id_item} value=${c.valor}>${c.valor}</option>`)}
            </select>
          </label>
          <label class="mon-campo">Data do contato
            <input class="form-control" type="date" max=${hoje()} value=${dados.data_contato} onInput=${(e) => atualizar('data_contato', e.target.value)} />
          </label>
          <label class="mon-campo">Telefone (opcional)
            <input class="form-control" value=${dados.telefone} maxlength="40" onInput=${(e) => atualizar('telefone', e.target.value)} />
          </label>
          <label class="mon-campo">ID da interação (opcional)
            <input class="form-control" value=${dados.id_interacao} maxlength="120" onInput=${(e) => atualizar('id_interacao', e.target.value)} />
          </label>` : null}
      </div>
      ${operacao && matriz ? html`<p class="mon-alerta mon-alerta--info mon-alerta--linha"><${Icone} nome="info" /><span>Formulário: ${matriz.nome} · versão ${matriz.numero}. O ID de 8 dígitos é gerado ao finalizar.</span></p>` : null}
    </div>`;

  const etapaBloco = blocoAtual ? html`
    <div class="mon-nm-criterios">
      ${blocoAtual.criterios.map((criterio) => html`
        <div class="mon-nm-criterio" key=${criterio.id}>
          <div class="mon-nm-criterio-texto"><span title=${criterio.texto}>${criterio.texto}</span><small>peso ${formatarNota(criterio.peso)}</small></div>
          <${AnswerSegmented} opcoes=${RESPOSTAS} valor=${dados.respostas[criterio.id] || null} rotulo=${criterio.texto} aoMudar=${(v) => responder(criterio.id, v)} />
        </div>`)}
    </div>` : null;

  const etapaPilares = config ? html`
    <div class="mon-nm-pilares">
      ${['conhecimento', 'encantamento'].map((tipo) => html`
        <section class="mon-nm-pilar-card" key=${tipo}>
          <header><h3>Pilar de ${tipo === 'conhecimento' ? 'Conhecimento' : 'Encantamento'}</h3><span>Não altera a nota de 0 a 100 · escala ${config.escala.min}–${config.escala.max}</span></header>
          ${(config.pilares[tipo] || []).map((p) => html`
            <div class="mon-nm-pilar" key=${p.chave}>
              <div class="mon-nm-pilar-txt"><strong>${p.chave}</strong><small>${p.desc}</small></div>
              <${RatingScale} min=${config.escala.min} max=${config.escala.max} valor=${dados.pilares[tipo]?.[p.chave] || null}
                rotulo=${`${p.chave}: nota de ${config.escala.min} a ${config.escala.max}`} aoMudar=${(n) => notaPilar(tipo, p.chave, n)} />
            </div>`)}
        </section>`)}
    </div>` : null;

  const etapaObs = config ? html`
    <div class="mon-nm-obs">
      ${previa?.possui_ncg ? html`
        <label class="mon-campo mon-nm-obs-extra">Motivo da NCG (obrigatório)
          <textarea class="form-control" rows="2" value=${dados.motivo_ncg} placeholder="Ex.: rudeza, discussão ou ofensa ao cliente" onInput=${(e) => atualizar('motivo_ncg', e.target.value)}></textarea>
        </label>` : null}
      ${previa?.anulada ? html`
        <label class="mon-campo mon-nm-obs-extra">Justificativa da anulação (obrigatória)
          <textarea class="form-control" rows="2" value=${dados.justificativa_anulacao} onInput=${(e) => atualizar('justificativa_anulacao', e.target.value)}></textarea>
        </label>` : null}
      <div class="mon-nm-obs-grade">
        <label class="mon-campo">Campo de observação
          <textarea class="form-control" value=${dados.observacao} onInput=${(e) => atualizar('observacao', e.target.value)}></textarea>
        </label>
        <label class="mon-campo">Sugestão de feedback
          <textarea class="form-control" value=${dados.sugestao_feedback} onInput=${(e) => atualizar('sugestao_feedback', e.target.value)}></textarea>
          <small class="mon-muted">Aparece como “Sugestão do avaliador” quando o operador for aplicar o feedback.</small>
        </label>
      </div>
    </div>` : null;

  const conteudoEtapa = etapa === ETAPA_CONTATO || !config ? etapaContato : etapa === ETAPA_PILARES ? etapaPilares : etapa === ETAPA_OBS ? etapaObs : etapaBloco;

  // Cabeçalho da etapa: título/apoio e, à direita, progresso + pontos do bloco + barra.
  const cab = (() => {
    if (!config || etapa === ETAPA_CONTATO) {
      const preenchidos = camposContato.filter(Boolean).length;
      return { titulo: 'Dados do contato', apoio: '', progresso: '', valor: preenchidos, total: 0 };
    }
    if (blocoAtual) {
      const st = blocosStatus[blocoAtual.id];
      const total = blocoAtual.criterios.length;
      const resp = respondidosDoBloco(blocoAtual);
      return {
        titulo: `${blocoAtual.nome} · peso ${formatarNota(blocoAtual.valor)}`,
        apoio: `${total} critérios. Responda SIM, NÃO, NCG ou N/A em cada um.`,
        progresso: `${resp} de ${total} respondidos`,
        pontos: st?.status === 'NULO' ? 'Bloco nulo (N/A): peso redistribuído' : st ? `${formatarNota(st.pontos)} / ${formatarNota(st.valor_efetivo)}` : '',
        valor: resp, total,
      };
    }
    if (etapa === ETAPA_PILARES) return { titulo: 'Pilares', apoio: '', progresso: `${totalPilares - pendentesPilares} de ${totalPilares} avaliados`, valor: totalPilares - pendentesPilares, total: totalPilares };
    return { titulo: 'Observação e feedback', apoio: '', progresso: '', total: 0 };
  })();

  return html`
    <div class="mon-nm" data-etapa=${etapa}>
      <aside class="mon-nm-esq" aria-label="Resumo e etapas">
        <section class="mon-nm-resumo" aria-label="Resumo da nota">
          <div class="mon-nm-resumo-topo">
            <div class="mon-nm-nota-grande" role="status" aria-live="polite">
              <span class="mon-muted">Nota de avaliação${previa?.pendentes > 0 ? ' (parcial)' : ''}</span>
              <strong>${previa ? formatarNota(previa.nota) : '—'}<small>/100</small></strong>
            </div>
            <div class="mon-nm-resumo-lado">
              <span class="mon-muted">Nível</span>
              <strong class="mon-nm-nivel" style=${{ '--faixa': previa?.faixa?.cor || 'var(--ink)' }}>${previa?.faixa?.label || '—'}</strong>
              <span class="mon-muted">Blocos avaliados</span>
              <strong>${previa && config ? `${previa.blocos_avaliados}/${blocos.length}` : '—'}</strong>
            </div>
          </div>
          ${previa?.possui_ncg ? html`<span class="mon-tag mon-tag--ncg">NCG: nota zerada</span>` : null}
          ${previa?.anulada ? html`<span class="mon-tag mon-tag--anulada">Menos de ${previa.min_blocos} blocos: será anulada</span>` : null}
          ${config ? html`<div class="mon-nm-pend" role="status" aria-live="polite">
            <p class="mon-lf-rotulo">O que falta para finalizar</p>
            ${problemas.length
              ? html`<ul>${problemas.map((p) => html`<li key=${p}>${p}</li>`)}</ul>`
              : html`<p class="mon-nm-pronto">Tudo pronto para finalizar.</p>`}
          </div>` : null}
        </section>
        <section class="mon-nm-etapas" aria-label="Etapas da avaliação">
          <p class="mon-lf-rotulo">Etapas da avaliação</p>
          <${StepRail} etapas=${etapas} ativa=${etapaAtual.id} aoEscolher=${setEtapa} />
        </section>
      </aside>

      <section class="mon-nm-painel" aria-label=${etapaAtual.rotulo}>
        ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}
          ${operacao && !matriz ? html` <button type="button" class="btn btn-outline-secondary btn-sm ms-2" onClick=${() => setTentativa((n) => n + 1)}>Tentar de novo</button>` : null}</div>` : null}
        <header class="mon-nm-cab">
          <div><h2>${cab.titulo}</h2>${cab.apoio ? html`<p class="mon-muted">${cab.apoio}</p>` : null}</div>
          ${cab.total ? html`<div class="mon-nm-prog">
            <span role="status" aria-live="polite">${cab.progresso}</span>
            ${cab.pontos ? html`<strong>${cab.pontos}</strong>` : null}
            <${ProgressBar} valor=${cab.valor} total=${cab.total} rotulo=${`Progresso: ${cab.titulo}`} />
          </div>` : null}
        </header>
        <div class="mon-nm-corpo">
          ${carregando ? html`<div class="mon-lf-esqueleto" aria-busy="true" aria-label="Carregando o formulário"><div></div><div></div><div></div><div></div></div>` : conteudoEtapa}
          ${mostrarPendencias && problemas.length ? html`<ul class="mon-erros mon-nm-erros" role="alert">${problemas.map((p) => html`<li key=${p}>${p}</li>`)}</ul>` : null}
        </div>
        <footer class="mon-nm-rodape">
          <div class="mon-nm-rodape-esq">
            <button type="button" class="btn btn-outline-secondary" disabled=${indiceEtapa <= 0} onClick=${() => setEtapa(etapas[indiceEtapa - 1].id)}>Anterior</button>
            <button type="button" class="btn btn-outline-secondary" disabled=${indiceEtapa >= etapas.length - 1} onClick=${() => setEtapa(etapas[indiceEtapa + 1].id)}>Próxima etapa</button>
          </div>
          <div class="mon-nm-rodape-dir">
            <button type="button" class="btn btn-outline-secondary" disabled=${!operacao || salvando} onClick=${salvarComoRascunho}>Salvar rascunho</button>
            <button type="button" class=${`btn btn-primary ${problemas.length ? 'is-pendente' : ''}`} disabled=${!config || salvando} onClick=${tentarFinalizar}>Finalizar monitoria</button>
          </div>
        </footer>
      </section>

      <${ModalPadrao} aberto=${confirmando} titulo="Finalizar monitoria" subtitulo="Após finalizada, a monitoria não poderá mais ser alterada." onClose=${() => setConfirmando(false)}>
        <div class="mon-shell">
          <dl class="mon-dl">
            <div><dt>Operador</dt><dd>${operadorSelecionado?.nome || '—'}</dd></div>
            <div><dt>Nota</dt><dd>${previa ? formatarNota(previa.nota) : '—'} (${previa?.faixa?.label || ''})</dd></div>
            <div><dt>Blocos avaliados / nulos</dt><dd>${previa ? `${previa.blocos_avaliados} / ${previa.blocos_nulos}` : '—'}</dd></div>
            <div><dt>NCG</dt><dd>${previa?.possui_ncg ? 'Sim' : 'Não'}</dd></div>
          </dl>
          ${previa?.anulada ? html`<div class="mon-alerta">Menos de ${previa.min_blocos} blocos avaliados: a monitoria será <strong>anulada</strong> e ficará apenas no histórico.</div>` : null}
          <div class="mon-acoes-fixas">
            <button type="button" class="btn btn-outline-secondary" onClick=${() => setConfirmando(false)}>Voltar</button>
            <button type="button" class="btn btn-primary" disabled=${salvando} onClick=${finalizar}>${salvando ? 'Salvando…' : 'Confirmar e finalizar'}</button>
          </div>
        </div>
      </${ModalPadrao}>
    </div>
  `;
}
