import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState, ModalPadrao, SectionCard } from '../../ui/componentes-compartilhados.js';
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

// Formulário de monitoria (avaliador). A nota exibida é sempre calculada pelo
// servidor (mesmo motor da gravação) — o navegador nunca tem uma segunda fórmula.

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
  const temporizador = useRef(null);

  useEffect(() => {
    listarRascunhos().then((r) => setRascunhos(r?.itens || [])).catch(() => setRascunhos([]));
  }, []);

  useEffect(() => {
    if (!operacao) {
      setMatriz(null);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setErro('');
    Promise.all([
      lerMatriz(operacao),
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
      .catch((e) => ativo && setErro(e?.message || 'Não foi possível carregar o formulário desta operação.'))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [operacao]);

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
  const responder = (idCriterio, valor) =>
    setDados((atual) => ({ ...atual, respostas: { ...atual.respostas, [idCriterio]: valor } }));
  const notaPilar = (tipo, indicador, valor) =>
    setDados((atual) => ({ ...atual, pilares: { ...atual.pilares, [tipo]: { ...atual.pilares[tipo], [indicador]: valor } } }));

  const pendentesPilares = ['conhecimento', 'encantamento'].reduce(
    (total, tipo) => total + (config?.pilares?.[tipo] || []).filter((p) => !dados.pilares[tipo]?.[p.chave]).length,
    0,
  );

  const problemas = [];
  if (!dados.id_operador) problemas.push('Selecione o operador.');
  if (!dados.canal || !dados.tipo_atendimento) problemas.push('Informe o canal e o tipo de atendimento.');
  if (!dados.data_contato) problemas.push('Informe a data do contato.');
  if (previa && previa.pendentes > 0) problemas.push(`Responda todos os critérios (${previa.pendentes} pendente(s)).`);
  if (pendentesPilares > 0) problemas.push('Avalie todos os indicadores dos pilares.');
  if (previa?.possui_ncg && !dados.motivo_ncg.trim()) problemas.push('Informe o motivo da NCG.');
  if (previa?.anulada && !dados.justificativa_anulacao.trim()) problemas.push('Informe a justificativa da anulação (menos de 3 blocos avaliados).');

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

  return html`
    <div class="mon-shell">
      ${rascunhos.length
        ? html`
            <${SectionCard} title="Meus rascunhos" className="rh-section-card--flat">
              <div class="mon-acoes">
                ${rascunhos.map(
                  (r) => html`
                    <button key=${r.id_rascunho} type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => abrirRascunho(r)}>
                      ${r.operacao} · ${new Date(r.atualizado_em).toLocaleString('pt-BR')}
                    </button>
                    <button type="button" class="btn btn-link btn-sm text-danger" title="Descartar rascunho"
                      onClick=${async () => { await descartarRascunho(r.id_rascunho); setRascunhos((l) => l.filter((x) => x.id_rascunho !== r.id_rascunho)); if (idRascunho === r.id_rascunho) setIdRascunho(0); }}>Descartar</button>
                  `,
                )}
              </div>
            </${SectionCard}>
          `
        : null}

      <${SectionCard} title="Dados do contato">
        <div class="mon-form-grid">
          <label>Operação
            <${SelectOperacao} contexto=${{ operacoes: operacoesAtivas }} valor=${operacao} todas=${false}
              onChange=${(v) => { setOperacao(v); setDados({ ...ESTADO_INICIAL }); setIdRascunho(0); }} />
          </label>
          ${operacao ? html`
            <label>Operador
              <select class="form-select" value=${dados.id_operador} onChange=${(e) => atualizar('id_operador', e.target.value)}>
                <option value="">Selecione…</option>
                ${operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}
              </select>
            </label>
            <label>Equipe
              <input class="form-control" readOnly value=${operadorSelecionado?.equipe_nome || (dados.id_operador ? 'Sem equipe' : '')} />
            </label>
            <label>Canal de atendimento
              <select class="form-select" value=${dados.canal} onChange=${(e) => trocarCanal(e.target.value)}>
                <option value="">Selecione…</option>
                ${canais.map((c) => html`<option key=${c.id_item} value=${c.valor}>${c.valor}</option>`)}
              </select>
            </label>
            <label>Tipo de atendimento
              <select class="form-select" value=${dados.tipo_atendimento} onChange=${(e) => atualizar('tipo_atendimento', e.target.value)}>
                <option value="">Selecione…</option>
                ${tiposDisponiveis.map((c) => html`<option key=${c.id_item} value=${c.valor}>${c.valor}</option>`)}
              </select>
            </label>
            <label>Data do contato
              <input class="form-control" type="date" max=${hoje()} value=${dados.data_contato} onInput=${(e) => atualizar('data_contato', e.target.value)} />
            </label>
            <label>Telefone (opcional)
              <input class="form-control" value=${dados.telefone} maxlength="40" onInput=${(e) => atualizar('telefone', e.target.value)} />
            </label>
            <label>ID da interação (opcional)
              <input class="form-control" value=${dados.id_interacao} maxlength="120" onInput=${(e) => atualizar('id_interacao', e.target.value)} />
            </label>
          ` : null}
        </div>
        ${operacao && matriz ? html`<p class="mon-muted">Formulário: ${matriz.nome} · versão ${matriz.numero}. O ID de 8 dígitos é gerado ao finalizar.</p>` : null}
      </${SectionCard}>

      ${erro ? html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>` : null}
      ${carregando ? html`<${LoadingState} titulo="Carregando o formulário" />` : null}

      ${config && !carregando ? html`
        <div class="mon-nota-fixa" aria-live="polite">
          <div><span class="mon-muted">Nota de avaliação${previa?.pendentes > 0 ? ' (parcial)' : ''}</span><br /><strong>${previa ? formatarNota(previa.nota) : '—'}<small>/100</small></strong></div>
          <div><span class="mon-muted">Nível</span><br /><strong style=${{ fontSize: '16px', color: previa?.faixa?.cor || 'inherit' }}>${previa?.faixa?.label || '—'}</strong></div>
          <div><span class="mon-muted">Blocos avaliados</span><br /><strong style=${{ fontSize: '16px' }}>${previa ? `${previa.blocos_avaliados}/${config.blocos.length}` : '—'}</strong></div>
          ${previa?.possui_ncg ? html`<span class="mon-tag mon-tag--ncg">NCG: nota zerada</span>` : null}
          ${previa?.anulada ? html`<span class="mon-tag mon-tag--anulada">Menos de ${previa.min_blocos} blocos: será anulada</span>` : null}
        </div>

        ${config.blocos.map((bloco) => {
          const st = blocosStatus[bloco.id];
          const nulo = st?.status === 'NULO';
          return html`
            <section class=${`mon-bloco ${nulo ? 'is-nulo' : ''}`} key=${bloco.id}>
              <div class="mon-bloco-cab">
                <h3>${bloco.nome} <small class="mon-muted">· peso ${formatarNota(bloco.valor)}</small></h3>
                <span class="mon-muted">${nulo ? 'Bloco nulo (N/A): peso redistribuído' : st ? `${formatarNota(st.pontos)} / ${formatarNota(st.valor_efetivo)}` : ''}</span>
              </div>
              ${bloco.criterios.map((criterio) => html`
                <div class="mon-criterio" key=${criterio.id}>
                  <div class="mon-criterio-texto">${criterio.texto}<small>peso ${formatarNota(criterio.peso)}</small></div>
                  <div class="mon-resp" role="radiogroup" aria-label=${criterio.texto}>
                    ${RESPOSTAS.map((r) => html`
                      <button key=${r.valor} type="button" role="radio" aria-checked=${dados.respostas[criterio.id] === r.valor}
                        class=${`${r.classe} ${dados.respostas[criterio.id] === r.valor ? 'is-on' : ''}`}
                        onClick=${() => responder(criterio.id, r.valor)}>${r.rotulo}</button>
                    `)}
                  </div>
                </div>
              `)}
            </section>
          `;
        })}

        ${previa?.possui_ncg ? html`
          <${SectionCard} title="Motivo da NCG (obrigatório)">
            <textarea class="form-control" rows="3" value=${dados.motivo_ncg} placeholder="Ex.: rudeza, discussão ou ofensa ao cliente" onInput=${(e) => atualizar('motivo_ncg', e.target.value)}></textarea>
          </${SectionCard}>` : null}
        ${previa?.anulada ? html`
          <${SectionCard} title="Justificativa da anulação (obrigatória)">
            <textarea class="form-control" rows="3" value=${dados.justificativa_anulacao} onInput=${(e) => atualizar('justificativa_anulacao', e.target.value)}></textarea>
          </${SectionCard}>` : null}

        ${['conhecimento', 'encantamento'].map((tipo) => html`
          <section class="mon-bloco" key=${tipo}>
            <div class="mon-bloco-cab"><h3>Pilar de ${tipo === 'conhecimento' ? 'Conhecimento' : 'Encantamento'}</h3><span class="mon-muted">Não altera a nota de 0 a 100 · escala ${config.escala.min}–${config.escala.max}</span></div>
            ${(config.pilares[tipo] || []).map((p) => html`
              <div class="mon-pilar" key=${p.chave}>
                <div><strong>${p.chave}</strong><br /><small class="mon-muted">${p.desc}</small></div>
                <div class="mon-pilar-notas">
                  ${Array.from({ length: config.escala.max - config.escala.min + 1 }, (_, i) => config.escala.min + i).map((n) => html`
                    <button key=${n} type="button" class=${dados.pilares[tipo]?.[p.chave] === n ? 'is-on' : ''} onClick=${() => notaPilar(tipo, p.chave, n)}>${n}</button>
                  `)}
                </div>
              </div>
            `)}
          </section>
        `)}

        <${SectionCard} title="Observação e sugestão de feedback">
          <div class="mon-form-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <label>Campo de observação
              <textarea class="form-control" rows="4" value=${dados.observacao} onInput=${(e) => atualizar('observacao', e.target.value)}></textarea>
            </label>
            <label>Sugestão de feedback
              <textarea class="form-control" rows="4" value=${dados.sugestao_feedback} onInput=${(e) => atualizar('sugestao_feedback', e.target.value)}></textarea>
            </label>
          </div>
        </${SectionCard}>

        ${problemas.length ? html`<ul class="mon-erros">${problemas.map((p) => html`<li key=${p}>${p}</li>`)}</ul>` : null}
        <div class="mon-acoes-fixas">
          <button type="button" class="btn btn-outline-secondary" onClick=${salvarComoRascunho}>Salvar rascunho</button>
          <button type="button" class="btn btn-primary" disabled=${problemas.length > 0 || salvando} onClick=${() => setConfirmando(true)}>Finalizar monitoria</button>
        </div>
      ` : null}

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
