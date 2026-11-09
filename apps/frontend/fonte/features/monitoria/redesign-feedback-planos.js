import { html, useEffect, useMemo, useRef, useState } from '../../infraestrutura-react.js';
import { aplicarFeedback, criarPlano, lerMonitoria, lerPlano, listarMonitorias, listarOperadoresMonitoria, listarPlanos, revisarPlano } from '../../services/api/monitoria.js';
import { marcarNotificacoesEntidadeLidas } from '../../services/api/notifications.js?v=20260921-alertas';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, MenuAcoes, Selo } from '../../ui/components/ds.js?v=20261106-wfm';
import { formatarData, formatarDataHoraCurta, formatarNota, hoje } from './comum.js';
import { textoPrazo } from './redesign-listas.js?v=20261108-fatia2';

// Monitoria › Feedback e Planos de ação no desenho novo (Fase 15, fatia 4, amostras Q5 e Q6 do lote 1).
// Mesmas rotas e regras de antes: a monitoria nunca é editada; o feedback só acrescenta o registro da conversa.

const pad = (n) => String(n).padStart(2, '0');
const diaMes = (iso) => { if (!iso) return '—'; const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso); return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const idCurto = (codigo) => String(codigo || '').slice(-5);
const limiteDoPrazo = (sla) => (sla && sla.estado !== 'VENCIDO' && Number(sla.restante_h) > 0 ? new Date(Date.now() + Number(sla.restante_h) * 3600000) : null);
const quando = (d) => {
  if (!d) return '';
  const h = new Date(); const am = new Date(h); am.setDate(h.getDate() + 1);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  return `${mesmo(d, h) ? 'hoje' : mesmo(d, am) ? 'amanhã' : diaMes(d.toISOString())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Vence antes, aparece antes (vencidas primeiro, pelo atraso).
const ordemPrazo = (m) => (m.sla?.estado === 'VENCIDO' ? -Number(m.sla.atraso_h || 0) : Number(m.sla?.restante_h ?? 1e9));
const PRAZOS = [['', 'Prazo: todos'], ['VENCIDO', 'Venceu'], ['PROXIMO_DO_VENCIMENTO', 'Vence em breve'], ['DENTRO_DO_PRAZO', 'No prazo']];
const POR_PAGINA = 50;

// Painel lateral (padrão c-diario da Fase 14). `largura` em px.
function PainelLateral({ rotulo, titulo, sub, onClose, rodape = null, largura = 600, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const anterior = document.activeElement;
    ref.current?.focus();
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.c-fundo-janela')) onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); if (anterior && document.contains(anterior)) anterior.focus?.(); };
  }, []);
  return html`<aside ref=${ref} tabIndex="-1" class="c-painel-lateral c-diario c-ds" style=${{ width: `min(${largura}px, 100%)` }} role="dialog" aria-label=${rotulo}>
    <div class="c-janela-cab"><h2>${titulo}${sub ? html`<small>${sub}</small>` : null}</h2>
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Fechar" title="Fechar" style=${{ marginLeft: 'auto' }} onClick=${onClose}><${Ic} nome="x" /></button></div>
    <div class="c-janela-corpo">${children}</div>
    ${rodape ? html`<div class="c-janela-rodape">${rodape}</div>` : null}
  </aside>`;
}

// ---------------------------------------------------------------------------
// Q5 · Feedback: fila de monitorias aguardando o feedback (72 h; vence antes, aparece antes)
// ---------------------------------------------------------------------------
export function ListaFeedback({ controlador, contexto, abrirDetalhe, atualizacao, showToast, aoAlterou }) {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [operacao, setOperacao] = useState('');
  const [avaliador, setAvaliador] = useState('');
  const [prazo, setPrazo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState(null);
  const [versao, setVersao] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [busca]);

  useEffect(() => {
    let ativo = true;
    setErro('');
    const ehCodigo = /^\d{8}$/.test(buscaAplicada);
    listarMonitorias({ status: 'FEEDBACK_PENDENTE', operacao, codigo: ehCodigo ? buscaAplicada : '', operador: !/^\d{3,8}$/.test(buscaAplicada) ? buscaAplicada : '', pagina, por_pagina: POR_PAGINA })
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) { setDados({ itens: [], total: 0 }); setErro(e?.message || 'Não foi possível carregar a fila de feedback.'); } });
    return () => { ativo = false; };
  }, [buscaAplicada, operacao, pagina, atualizacao, versao]);

  const brutos = dados?.itens || [];
  const avaliadores = useMemo(() => [...new Set(brutos.map((m) => m.avaliador_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [brutos]);
  const itens = useMemo(() => brutos
    .filter((m) => (!/^\d{3,7}$/.test(buscaAplicada) || String(m.codigo).includes(buscaAplicada)) && (!avaliador || m.avaliador_nome === avaliador) && (!prazo || m.sla?.estado === prazo))
    .sort((a, b) => ordemPrazo(a) - ordemPrazo(b)), [brutos, buscaAplicada, avaliador, prazo]);
  const total = dados?.total || 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const operacoes = contexto?.operacoes || [];
  const vencidas = brutos.filter((m) => m.sla?.estado === 'VENCIDO').length;

  return html`
    <div class="c-tabela-caixa">
      <div class="c-filtros c-filtros--suave">
        <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="ID ou operador" aria-label="Buscar por ID ou operador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
        ${operacoes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${operacao} onChange=${(e) => { setOperacao(e.target.value); setPagina(1); }}><option value="">Todas as operações</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
        ${avaliadores.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Avaliador" value=${avaliador} onChange=${(e) => setAvaliador(e.target.value)}><option value="">Avaliador: todos</option>${avaliadores.map((a) => html`<option key=${a} value=${a}>${a}</option>`)}</select>` : null}
        <select class="c-entrada c-entrada--compacta" aria-label="Prazo" value=${prazo} onChange=${(e) => setPrazo(e.target.value)}>${PRAZOS.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>
        <span class="c-contador" aria-live="polite">${total} aguardando${vencidas ? html` · <span class="c-tom-perigo">${vencidas} vencida(s)</span>` : ''}</span>
      </div>
      ${!dados ? html`<${Esqueleto} linhas=${8} />` : html`
      <table class="c-tabela">
        <thead><tr><th scope="col">ID</th><th scope="col">Data</th><th scope="col" class="c-col-nome">Operador</th><th scope="col">Operação</th><th scope="col">Avaliador</th><th scope="col" class="c-num">Nota</th><th scope="col">Prazo (72 h)</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
        <tbody>${itens.length ? itens.map((m) => {
          const [texto, classe] = textoPrazo(m.sla);
          const abrir = () => setAberta(String(m.id_monitoria));
          return html`<tr key=${m.id_monitoria} class="c-clicavel" tabIndex="0" data-mon-id=${m.id_monitoria} aria-selected=${aberta === String(m.id_monitoria) ? 'true' : null}
            onClick=${abrir} onKeyDown=${(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir(); } }}>
            <td class="c-secundario" title=${`ID ${m.codigo}`} data-papel="info" data-prioridade="1" data-primeira="">${idCurto(m.codigo)}</td>
            <td data-papel="info" data-prioridade="1">${diaMes(m.data_monitoria)}</td>
            <td class="c-forte c-col-nome" data-papel="titulo">${m.operador_nome}</td>
            <td class="c-col-opc">${m.operacao_nome || m.operacao}</td>
            <td class="c-col-opc">${m.avaliador_nome}</td>
            <td class="c-num c-forte" data-papel="info" data-prioridade="1">${formatarNota(m.nota)}</td>
            <td class=${classe} data-papel="selo">${texto}</td>
            <td class="c-acoes" data-papel="acoes" onClick=${(e) => e.stopPropagation()}><div class="c-grupo">
              <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${abrir}>Aplicar</button>
              <${MenuAcoes} rotulo=${`Mais ações da monitoria ${idCurto(m.codigo)}`} acoes=${[{ label: 'Abrir detalhe completo', icon: 'arrow-square-out', onClick: () => abrirDetalhe(String(m.id_monitoria)) }]} />
            </div></td>
          </tr>`; })
          : html`<tr><td colspan="8"><${Estado} icone="check-circle" titulo=${erro || (brutos.length ? 'Nenhuma monitoria com estes filtros.' : 'Nenhum feedback pendente.')} /></td></tr>`}
        </tbody>
      </table>`}
      <div class="c-legenda">
        <span>Vence antes, aparece antes · laranja = vence em breve · vermelho = venceu</span>
        ${totalPaginas > 1 ? html`<span class="c-grupo" style=${{ marginLeft: 'auto' }}>
          <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${pagina <= 1 || null} onClick=${() => setPagina(pagina - 1)}><${Ic} nome="caret-left" />Anterior</button>
          <span>Página ${pagina} de ${totalPaginas}</span>
          <button type="button" class="c-botao c-botao--texto c-botao--compacto" disabled=${pagina >= totalPaginas || null} onClick=${() => setPagina(pagina + 1)}>Próxima<${Ic} nome="caret-right" /></button>
        </span>` : null}
      </div>
    </div>
    ${aberta ? html`<${PainelFeedback} key=${aberta} referencia=${aberta} controlador=${controlador} showToast=${showToast} abrirDetalhe=${abrirDetalhe}
      onClose=${() => setAberta(null)} onAplicado=${() => { setAberta(null); setVersao((v) => v + 1); aoAlterou?.(); }} />` : null}`;
}

// Painel de 600 px: nota, quantos "Não", até quando; onde perdeu pontos (só os "Não"); sugestão do avaliador;
// "O que foi conversado" (obrigatório) + complemento; caixinha "Abrir um plano de ação depois".
function PainelFeedback({ referencia, controlador, showToast, onClose, onAplicado, abrirDetalhe }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [observacao, setObservacao] = useState('');
  const [complemento, setComplemento] = useState('');
  const [comPlano, setComPlano] = useState(false);
  const [plano, setPlano] = useState(null); // monitoria para a qual abrir o plano depois do feedback
  const [ocupado, setOcupado] = useState(false);
  const carregar = async () => { try { setD(await lerMonitoria(referencia)); setErro(''); } catch (e) { setErro(e?.message || 'Não foi possível carregar a monitoria.'); } };
  useEffect(() => { carregar(); }, [referencia]);
  useEffect(() => { if (d?.id_monitoria) marcarNotificacoesEntidadeLidas('monitoria', d.id_monitoria).catch(() => {}); }, [d?.id_monitoria]);
  const podePlano = controlador.possuiPermissao('monitoria.plano_acao');

  if (erro) return html`<${PainelLateral} rotulo="Aplicar feedback" titulo="Aplicar feedback" onClose=${onClose}><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /><//>`;
  if (!d) return html`<${PainelLateral} rotulo="Aplicar feedback" titulo="Aplicar feedback" onClose=${onClose}><${Esqueleto} linhas=${6} /><//>`;
  if (plano) return html`<${JanelaPlano} monitoria=${plano} showToast=${showToast} onClose=${onAplicado} onCriado=${onAplicado} />`;

  const naos = (d.config?.blocos || []).flatMap((b) => b.criterios.filter((c) => ['NAO', 'NCG'].includes(d.respostas?.[c.id])).map((c) => ({ ...c, bloco: b.nome, ncg: d.respostas?.[c.id] === 'NCG' })));
  const limite = limiteDoPrazo(d.sla);
  const vencido = d.sla?.estado === 'VENCIDO';
  const aplicar = async () => {
    setOcupado(true);
    try {
      await aplicarFeedback(d.codigo, { observacao: observacao.trim(), complemento: complemento.trim() });
      showToast?.('Feedback registrado. O operador tem 48 horas para se manifestar.', 'success');
      if (comPlano && podePlano) setPlano(d); else onAplicado?.();
    } catch (e) { showToast?.(e?.message || 'Não foi possível registrar o feedback.', 'danger'); } finally { setOcupado(false); }
  };
  return html`<${PainelLateral} rotulo=${`Aplicar feedback · ${idCurto(d.codigo)}`} titulo=${`Aplicar feedback · ${d.operador_nome}`}
      sub=${`ID ${idCurto(d.codigo)} · ${d.operacao_nome || d.operacao} · ${diaMes(d.data_monitoria)} · avaliada por ${d.avaliador_nome || '—'}`} onClose=${onClose}
      rodape=${html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" style=${{ marginRight: 'auto' }} onClick=${() => abrirDetalhe(String(d.id_monitoria))}><${Ic} nome="arrow-square-out" />Monitoria completa</button>
        <button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !observacao.trim() || null} title=${observacao.trim() ? null : 'Conte o que foi conversado'} onClick=${aplicar}><${Ic} nome="check" />Registrar feedback</button>`}>
    <div class="c-diario-numeros" style=${{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <div><small>Nota</small><b>${formatarNota(d.nota)}</b><em>${d.faixa?.label || 'de 100'}</em></div>
      <div><small>Respostas "Não"</small><b class=${naos.length ? 'c-tom-perigo' : ''}>${naos.length}</b><em>${naos.some((c) => c.ncg) ? 'inclui NCG' : 'critérios'}</em></div>
      <div><small>Aplicar até</small><b class=${vencido ? 'c-prazo--perigo' : 'c-prazo--atencao'}>${vencido ? 'Venceu' : limite ? `${pad(limite.getHours())}:${pad(limite.getMinutes())}` : '—'}</b><em>${vencido ? `há ${Math.round(Number(d.sla.atraso_h || 0))} h` : limite ? quando(limite).split(' ')[0] : 'prazo de 72 h'}</em></div>
    </div>
    <div><h3>Onde perdeu pontos</h3>
      ${naos.length ? html`<ul class="c-fb-nao">${naos.map((c) => html`<li key=${c.id}><b>${c.bloco}</b>${c.texto}${c.ncg ? html` <${Selo} tom="perigo">NCG<//>` : null}<span>−${formatarNota(c.peso)}</span></li>`)}</ul>`
        : html`<p class="c-ajuda" style=${{ margin: 0 }}>Nenhum "Não" nesta monitoria.</p>`}
    </div>
    ${d.sugestao_feedback ? html`<div class="c-feedback"><h3>Sugestão do avaliador</h3><p>${d.sugestao_feedback}</p></div>` : null}
    <${Campo} rotulo="O que foi conversado" ajuda="Obrigatório. O operador lê este texto."><textarea class="c-entrada" rows="3" value=${observacao} onInput=${(e) => setObservacao(e.target.value)}></textarea><//>
    <${Campo} rotulo="Complemento" opcional=${true}><textarea class="c-entrada" rows="2" value=${complemento} onInput=${(e) => setComplemento(e.target.value)}></textarea><//>
    ${podePlano ? html`<label class="c-marcar c-fb-plano"><input type="checkbox" checked=${comPlano} onChange=${(e) => setComPlano(e.target.checked)} /><span>Abrir um plano de ação depois</span></label>` : null}
    ${vencido ? html`<${Faixa} tom="perigo" icone="warning">O prazo de 72 horas venceu. O feedback ainda pode ser registrado e fica marcado como fora do prazo.<//>` : null}
  <//>`;
}

// ---------------------------------------------------------------------------
// Q6 · Planos de ação
// ---------------------------------------------------------------------------
const STATUS_PLANO = { ABERTO: 'Aberto', EM_ANDAMENTO: 'Em andamento', EM_REVISAO: 'Em revisão', CONCLUIDO: 'Concluído' };
const TOM_PLANO = { ABERTO: 'informacao', EM_ANDAMENTO: 'atencao', EM_REVISAO: 'informacao', CONCLUIDO: 'sucesso' };
const PROXIMOS = { ABERTO: ['EM_ANDAMENTO'], EM_ANDAMENTO: ['EM_REVISAO'], EM_REVISAO: ['EM_ANDAMENTO', 'CONCLUIDO'], CONCLUIDO: [] };
const FAIXA = [['', 'Todos', ''], ['ABERTO', 'Abertos', ''], ['EM_ANDAMENTO', 'Em andamento', ''], ['EM_REVISAO', 'Em revisão', ''], ['CONCLUIDO', 'Concluídos', ''], ['vencidos', 'Vencidos', 'perigo']];

export function TelaPlanosNova({ controlador, contexto, showToast, novoAberto = false, aoFecharNovo }) {
  const podeEditar = controlador.possuiPermissao('monitoria.plano_acao');
  const [operacao, setOperacao] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('');
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null); // { id, acao: 'ver' | 'atualizar' | 'concluir' }
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let ativo = true;
    listarPlanos({ operacao, por_pagina: 100 }).then((r) => { if (ativo) { setDados(r); setErro(''); } })
      .catch((e) => { if (ativo) { setDados({ itens: [] }); setErro(e?.message || 'Não foi possível carregar os planos.'); } });
    return () => { ativo = false; };
  }, [operacao, recarga]);
  const todos = dados?.itens || [];
  const contagem = (f) => (f === '' ? todos.length : f === 'vencidos' ? todos.filter((p) => p.vencido).length : todos.filter((p) => p.status === f).length);
  const q = busca.trim().toLowerCase();
  const itens = todos.filter((p) => (filtro === '' || (filtro === 'vencidos' ? p.vencido : p.status === filtro))
    && (!q || `${p.operador_nome} ${p.problema} ${p.responsavel || ''}`.toLowerCase().includes(q)));
  const operacoes = contexto?.operacoes || [];
  const recarregar = () => setRecarga((r) => r + 1);

  return html`
    <div class="c-tabela-caixa">
      <div class="c-pd-resumo" role="group" aria-label="Planos por situação (clique para filtrar)">
        ${FAIXA.map(([f, rotulo, tom]) => { const n = contagem(f); return html`<button key=${f || 'todos'} type="button" class=${`c-pd-num ${tom && n ? `c-pd-num--${tom}` : ''}`.trim()} aria-pressed=${filtro === f ? 'true' : 'false'} onClick=${() => setFiltro(f)}><b>${dados ? n : '—'}</b><small>${rotulo}</small></button>`; })}
      </div>
      <div class="c-filtros c-filtros--suave">
        <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Operador ou problema" aria-label="Buscar por operador ou problema" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
        ${operacoes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}><option value="">Todas as operações</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
        <span class="c-contador">${itens.length} de ${todos.length}</span>
      </div>
      ${!dados ? html`<${Esqueleto} linhas=${6} />` : !itens.length ? html`<${Estado} icone="list-checks" titulo=${erro || (todos.length ? 'Nenhum plano com este filtro.' : 'Nenhum plano de ação.')} texto=${todos.length ? '' : 'Planos criados a partir das monitorias aparecem aqui.'} />`
        : html`<table class="c-tabela">
          <thead><tr><th scope="col" class="c-col-nome">Operador</th><th scope="col" class="c-estica">Problema</th><th scope="col" class="c-col-opc">Objetivo</th><th scope="col" class="c-col-opc">Responsável</th><th scope="col">Prazo</th><th scope="col">Situação</th><th scope="col" class="c-num" title="Nota antes → depois do plano">Nota</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
          <tbody>${itens.map((p) => {
            const subiu = p.nota_depois != null && p.nota_antes != null && Number(p.nota_depois) > Number(p.nota_antes);
            const prox = PROXIMOS[p.status] || [];
            return html`<tr key=${p.id_plano} class="c-clicavel" onClick=${(e) => { if (!e.target.closest('button, .c-abre-menu')) setAberto({ id: p.id_plano, acao: 'ver' }); }}>
              <td class="c-forte c-col-nome" data-papel="titulo">${p.operador_nome}</td>
              <td class="c-estica c-plano-texto" data-papel="info" data-prioridade="1" data-primeira="">${p.problema}</td>
              <td class="c-col-opc c-secundario c-plano-texto">${p.objetivo || '—'}</td>
              <td class="c-col-opc">${p.responsavel || '—'}</td>
              <td class=${p.vencido ? 'c-prazo c-prazo--perigo' : ''} data-papel="info" data-prioridade="1">${formatarData(p.prazo)}${p.vencido ? ' · vencido' : ''}</td>
              <td data-papel="selo"><${Selo} tom=${TOM_PLANO[p.status] || 'neutro'}>${p.status_rotulo || STATUS_PLANO[p.status] || p.status}<//></td>
              <td class="c-num">${formatarNota(p.nota_antes)} → <span class=${subiu ? 'c-plano-subiu c-forte' : ''}>${p.nota_depois == null ? '—' : formatarNota(p.nota_depois)}</span></td>
              <td class="c-acoes" data-papel="acoes">${podeEditar && prox.length
                ? (p.status === 'EM_REVISAO'
                  ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setAberto({ id: p.id_plano, acao: 'concluir' })}>Concluir</button>`
                  : html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setAberto({ id: p.id_plano, acao: 'atualizar' })}>Atualizar</button>`)
                : null}</td>
            </tr>`; })}</tbody>
        </table>`}
    </div>
    ${aberto ? html`<${JanelaDetalhePlano} id=${aberto.id} acao=${aberto.acao} podeEditar=${podeEditar} showToast=${showToast} onClose=${() => setAberto(null)} onAlterou=${() => { setAberto(null); recarregar(); }} />` : null}
    ${novoAberto ? html`<${JanelaPlano} contexto=${contexto} showToast=${showToast} onClose=${aoFecharNovo} onCriado=${() => { aoFecharNovo?.(); recarregar(); }} />` : null}`;
}

// Plano: dados + histórico; "Atualizar" (próxima situação + observação) ou "Concluir" (pede o resultado).
function JanelaDetalhePlano({ id, acao, podeEditar, showToast, onClose, onAlterou }) {
  const [p, setP] = useState(null);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState({ status: acao === 'concluir' ? 'CONCLUIDO' : '', resultado: '', observacoes: '' });
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState(acao);
  useEffect(() => { lerPlano(id).then((r) => { setP(r); if (acao === 'atualizar') setForm((f) => ({ ...f, status: (PROXIMOS[r.status] || [])[0] || '' })); }).catch((e) => setErro(e?.message || 'Não foi possível carregar o plano.')); }, [id]);
  const passarPara = () => { const alvo = p.status === 'EM_REVISAO' ? 'CONCLUIDO' : (PROXIMOS[p.status] || [])[0] || ''; setForm({ ...form, status: alvo }); setModo(alvo === 'CONCLUIDO' ? 'concluir' : 'atualizar'); };
  const prox = p ? PROXIMOS[p.status] || [] : [];
  const concluindo = form.status === 'CONCLUIDO';
  const salvar = async () => {
    setOcupado(true);
    try { await revisarPlano(p.id_plano, form); showToast?.(concluindo ? 'Plano concluído.' : 'Plano atualizado.', 'success'); onAlterou?.(); }
    catch (e) { showToast?.(e?.message || 'Não foi possível atualizar o plano.', 'danger'); } finally { setOcupado(false); }
  };
  const editando = podeEditar && prox.length && modo !== 'ver';
  return html`<${Janela} titulo=${p ? `Plano de ação · ${p.operador_nome}` : 'Plano de ação'} onClose=${onClose}
    rodape=${editando ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
      <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !form.status || (concluindo && !form.resultado.trim()) || null} onClick=${salvar}>${concluindo ? 'Concluir plano' : 'Salvar'}</button>`
      : html`${podeEditar && p && prox.length ? html`<button type="button" class="c-botao c-botao--secundario" style=${{ marginRight: 'auto' }} onClick=${passarPara}>${p.status === 'EM_REVISAO' ? 'Concluir' : 'Atualizar'}</button>` : null}<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Fechar</button>`}>
    <div class="c-janela-corpo">
      ${erro ? html`<${Faixa} tom="perigo" icone="warning">${erro}<//>` : !p ? html`<${Esqueleto} linhas=${5} />` : html`
        <table class="c-diario-ficha"><tbody>
          <tr><td>Situação</td><td><${Selo} tom=${TOM_PLANO[p.status] || 'neutro'}>${STATUS_PLANO[p.status] || p.status}<//>${p.vencido ? html` <${Selo} tom="perigo">Vencido<//>` : null}</td></tr>
          <tr><td>Problema</td><td class="c-quebra">${p.problema}</td></tr>
          ${p.criterio ? html`<tr><td>Critério</td><td class="c-quebra">${p.criterio}</td></tr>` : null}
          <tr><td>Objetivo</td><td class="c-quebra">${p.objetivo}</td></tr>
          <tr><td>Ação</td><td class="c-quebra">${p.acao}</td></tr>
          <tr><td>Responsável</td><td>${p.responsavel || '—'}</td></tr>
          <tr><td>Prazo</td><td>${formatarData(p.prazo)}</td></tr>
          <tr><td>Origem</td><td>${p.origem || '—'}</td></tr>
          <tr><td>Nota</td><td>${formatarNota(p.nota_antes)} → ${p.nota_depois == null ? '—' : formatarNota(p.nota_depois)}</td></tr>
          ${p.resultado ? html`<tr><td>Resultado</td><td class="c-quebra">${p.resultado}</td></tr>` : null}
        </tbody></table>
        ${editando ? html`
          ${prox.length > 1 && !concluindo ? html`<${Campo} rotulo="Nova situação"><select class="c-entrada" value=${form.status} onChange=${(e) => setForm({ ...form, status: e.target.value })}>${prox.map((s) => html`<option key=${s} value=${s}>${STATUS_PLANO[s]}</option>`)}</select><//>`
            : html`<p class="c-ajuda" style=${{ margin: 0 }}>Passa para <b>${STATUS_PLANO[form.status] || '—'}</b>.</p>`}
          <${Campo} rotulo=${concluindo ? 'Resultado obtido' : 'Resultado até aqui'} opcional=${!concluindo}><input class="c-entrada" maxlength="400" value=${form.resultado} onInput=${(e) => setForm({ ...form, resultado: e.target.value })} /><//>
          <${Campo} rotulo="Observações" opcional=${true}><input class="c-entrada" maxlength="400" value=${form.observacoes} onInput=${(e) => setForm({ ...form, observacoes: e.target.value })} /><//>` : null}
        ${(p.historico || []).length ? html`<div><h3 class="c-rotulo" style=${{ margin: '0 0 var(--espaco-2)' }}>Histórico</h3><ol class="c-md-linha">${p.historico.map((h, i) => html`<li key=${i}><span class="c-md-quando">${formatarDataHoraCurta(h.em)}</span><div><b>${h.evento === 'criacao' ? 'Criado' : STATUS_PLANO[h.para] || h.evento}</b> · ${h.por}${h.detalhe ? html`<p>${h.detalhe}</p>` : null}</div></li>`)}</ol></div>` : null}`}
    </div>
  <//>`;
}

// Novo plano (janela 560). Com `monitoria`, o plano nasce ligado a ela (operação e operador vêm da monitoria).
function JanelaPlano({ contexto, monitoria = null, showToast, onClose, onCriado }) {
  const operacoes = (contexto?.operacoes || []).filter((o) => o.ativo !== false);
  const [operacao, setOperacao] = useState(operacoes.length === 1 ? operacoes[0].chave : '');
  const [operadores, setOperadores] = useState([]);
  const primeiroNao = monitoria ? (monitoria.config?.blocos || []).flatMap((b) => b.criterios).find((c) => ['NAO', 'NCG'].includes(monitoria.respostas?.[c.id])) : null;
  const [f, setF] = useState({ id_operador: '', origem: 'Manual', problema: '', criterio: primeiroNao?.texto || '', objetivo: '', acao: '', prazo: '' });
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (!monitoria && operacao) listarOperadoresMonitoria(operacao).then((r) => setOperadores(r.itens || [])).catch(() => setOperadores([])); }, [operacao]);
  const pronto = (monitoria || (operacao && f.id_operador)) && f.problema.trim() && f.objetivo.trim() && f.acao.trim() && f.prazo;
  const criar = async () => {
    setOcupado(true);
    try {
      await criarPlano(monitoria ? { problema: f.problema, criterio: f.criterio, objetivo: f.objetivo, acao: f.acao, prazo: f.prazo, id_monitoria: monitoria.id_monitoria } : { ...f, operacao, id_operador: Number(f.id_operador) });
      showToast?.('Plano de ação criado.', 'success');
      onCriado?.();
    } catch (e) { showToast?.(e?.message || 'Não foi possível criar o plano.', 'danger'); } finally { setOcupado(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<${Janela} titulo=${monitoria ? `Plano de ação · ${monitoria.operador_nome}` : 'Novo plano de ação'} onClose=${onClose}
    rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>${monitoria ? 'Agora não' : 'Cancelar'}</button>
      <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !pronto || null} onClick=${criar}>Criar plano</button>`}>
    <div class="c-janela-corpo">
      ${monitoria ? html`<p class="c-ajuda" style=${{ margin: 0 }}>Ligado à monitoria ${idCurto(monitoria.codigo)} · ${monitoria.operacao_nome || monitoria.operacao} · nota ${formatarNota(monitoria.nota)}.</p>` : html`
        <div class="c-form" style=${{ '--colunas': 2 }}>
          <${Campo} rotulo="Operação"><select class="c-entrada" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}><option value="">Selecione…</option>${operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select><//>
          <${Campo} rotulo="Operador"><select class="c-entrada" value=${f.id_operador} disabled=${!operacao || null} onChange=${set('id_operador')}><option value="">Selecione…</option>${operadores.map((o) => html`<option key=${o.id_usuario} value=${o.id_usuario}>${o.nome}</option>`)}</select><//>
        </div>`}
      <${Campo} rotulo="Problema identificado"><input class="c-entrada" maxlength="400" value=${f.problema} onInput=${set('problema')} /><//>
      <${Campo} rotulo="Critério relacionado" opcional=${true}><input class="c-entrada" maxlength="400" value=${f.criterio} onInput=${set('criterio')} /><//>
      <${Campo} rotulo="Objetivo"><input class="c-entrada" maxlength="400" value=${f.objetivo} onInput=${set('objetivo')} /><//>
      <${Campo} rotulo="Ação proposta"><input class="c-entrada" maxlength="400" value=${f.acao} onInput=${set('acao')} /><//>
      <${Campo} rotulo="Prazo"><input class="c-entrada" type="date" min=${hoje()} value=${f.prazo} onInput=${set('prazo')} /><//>
    </div>
  <//>`;
}
