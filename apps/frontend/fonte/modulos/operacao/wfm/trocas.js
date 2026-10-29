import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
import {
  cancelarTrocaWfm,
  decidirTrocaWfm,
  desfazerTrocaWfm,
  listarTrocasWfm,
  responderTrocaWfm,
} from '../../../services/api/wfm.js?v=20261029-fix';
import { dataHora } from './comum.js?v=20261029-fix';
import { ModalResumoTroca, textoTrocaSupervisor } from './trocas-texto.js';

// Trocas de plantão. Nenhuma troca é automática: mesmo com o colega de acordo, um Supervisor,
// Control Desk ou Gestor/RH aprova. Todas as regras (janela, prazo, skills, motor) rodam no servidor.

const ESTADOS = {
  AGUARDANDO_B: { rotulo: 'Aguardando o colega', classe: 'pendente' },
  AGUARDANDO_APROVACAO: { rotulo: 'Aguardando aprovação', classe: 'pendente' },
  APROVADA: { rotulo: 'Aprovada', classe: 'ok' },
  REPROVADA: { rotulo: 'Reprovada', classe: 'nula' },
  RECUSADA: { rotulo: 'Recusada pelo colega', classe: 'nula' },
  CANCELADA: { rotulo: 'Cancelada', classe: 'nula' },
  EXPIRADA: { rotulo: 'Expirada', classe: 'nula' },
  INVALIDADA: { rotulo: 'Invalidada', classe: 'nula' },
  BLOQUEADA: { rotulo: 'Bloqueada pelas regras', classe: 'nula' },
  DESFEITA: { rotulo: 'Desfeita', classe: 'info' },
};
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

const EM_ANDAMENTO = ['AGUARDANDO_B', 'AGUARDANDO_APROVACAO'];
// Recusada/Reprovada/Bloqueada ficam em vermelho; Expirada e demais encerradas, neutras.
const classeEstado = (estado, base) => (['RECUSADA', 'REPROVADA', 'BLOQUEADA'].includes(estado) ? 'critico' : base || 'nula');
const rotuloEvento = (e) => (ESTADOS[e]?.rotulo) || (e === 'SOLICITADA' ? 'Solicitada' : e);
const COR_EVENTO = { SOLICITADA: 'info', AGUARDANDO_B: 'pendente', AGUARDANDO_APROVACAO: 'pendente', APROVADA: 'ok', RECUSADA: 'critico', REPROVADA: 'critico', EXPIRADA: 'nula', CANCELADA: 'nula', DESFEITA: 'info' };

function Status({ troca }) {
  const est = ESTADOS[troca.estado] || { rotulo: troca.estado, classe: '' };
  return html`<span class=${`mon-badge mon-badge--${classeEstado(troca.estado, est.classe)} tr-status`}>${est.rotulo}</span>`;
}

function LinhaPedido({ troca, ativa, onSelecionar }) {
  const turnos = troca.detalhe?.[0];
  const resumo = [br(troca.data_a), turnos ? `${turnos.solicitante_antes} ⇄ ${turnos.alvo_antes}` : ''].filter(Boolean).join(' · ');
  return html`<button type="button" data-id=${troca.id_troca} class=${`tr-linha ${ativa ? 'is-ativa' : ''}`} aria-pressed=${ativa} onClick=${() => onSelecionar(troca.id_troca)}>
    <span class="tr-linha-txt">
      <strong>${troca.solicitante}</strong>
      <span class="tr-linha-colega">⇄ ${troca.alvo}</span>
      <small>${resumo}</small>
    </span>
    <${Status} troca=${troca} />
  </button>`;
}

function CartaoTurno({ nome, rotulo, data, turno, supervisor, equipe }) {
  return html`<div class="tr-turno">
    <strong class="tr-turno-nome">${nome}</strong>
    <span class="tr-rotulo">${rotulo}</span>
    <span class="tr-turno-data">${br(data)}</span>
    ${turno ? html`<span class="tr-turno-chip">${turno}</span>` : null}
    ${supervisor ? html`<small>Sup. ${supervisor}</small>` : null}
    ${equipe ? html`<small>Equipe ${equipe}</small>` : null}
  </div>`;
}

function DetalheTroca({ troca, executar }) {
  const [pendente, setPendente] = useState(null); // 'reprovar' | 'desfazer'
  const [texto, setTexto] = useState('');
  const [resumo, setResumo] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  useEffect(() => { setResumo(false); setPendente(null); setTexto(''); }, [troca.id_troca]);
  const confirmar = async () => {
    if (!texto.trim()) return;
    const ok = await executar(() => (pendente === 'reprovar' ? decidirTrocaWfm(troca.id_troca, false, texto) : desfazerTrocaWfm(troca.id_troca, texto)),
      pendente === 'reprovar' ? 'Troca reprovada.' : 'Troca desfeita e escala republicada.');
    if (ok) { setPendente(null); setTexto(''); }
  };
  const det = (data) => (troca.detalhe || []).find((d) => d.data === data) || troca.detalhe?.[0] || {};
  const da = det(troca.data_a); const db = det(troca.data_b);
  const aguardandoColega = troca.estado === 'AGUARDANDO_B';
  const temAcao = troca.pode_responder || troca.pode_cancelar || troca.pode_decidir || troca.pode_desfazer;
  const eventos = [...(troca.linha_do_tempo || [])].reverse();
  const prazoTxt = troca.estado === 'AGUARDANDO_APROVACAO' ? dataHora(troca.prazo_decisao) : dataHora(troca.prazo_resposta);
  return html`<section class="tr-detalhe" aria-label="Detalhe do pedido">
    <header class="tr-detalhe-cab">
      <div class="tr-detalhe-nomes"><strong>${troca.solicitante}</strong> <span class="wfm-troca-seta">⇄</span> <strong>${troca.alvo}</strong></div>
      <${Status} troca=${troca} />
    </header>
    <div class="tr-detalhe-corpo">
      <div class="tr-col-principal">
        <p class="tr-rotulo">Turnos em ${br(troca.data_a)}</p>
        <div class="tr-turnos">
          <${CartaoTurno} nome=${troca.solicitante} rotulo="Dia cedido" data=${troca.data_a} turno=${da.solicitante_antes} supervisor=${da.solicitante_supervisor} equipe=${da.solicitante_equipe} />
          <span class="tr-troca-icone" aria-hidden="true"><span class="material-symbols-outlined">${IconeSvg('compare_arrows')}</span></span>
          <${CartaoTurno} nome=${troca.alvo} rotulo="Dia assumido" data=${troca.data_b} turno=${db.alvo_antes} supervisor=${db.alvo_supervisor} equipe=${db.alvo_equipe} />
        </div>
        <div class="tr-caixas">
          ${EM_ANDAMENTO.includes(troca.estado) ? html`<div class=${`tr-caixa ${aguardandoColega ? 'is-ambar' : ''}`}><span class="tr-rotulo">${troca.estado === 'AGUARDANDO_APROVACAO' ? 'Prazo da decisão' : 'Prazo do colega'}</span><strong>${prazoTxt}</strong></div>`
            : troca.prazo_resposta ? html`<div class="tr-caixa"><span class="tr-rotulo">Prazo do colega</span><strong>${dataHora(troca.prazo_resposta)}</strong></div>` : null}
          <div class="tr-caixa"><span class="tr-rotulo">Motivo</span><strong>${troca.motivo || '—'}</strong></div>
        </div>
        ${troca.alertas.length ? html`<div class="wfm-validacao is-alerta"><strong>Alerta de risco trabalhista</strong><ul>${troca.alertas.map((a, i) => html`<li key=${i}>${a.mensagem}</li>`)}</ul></div>` : null}
        ${troca.bloqueios.length ? html`<div class="wfm-validacao is-bloqueio"><strong>Bloqueada pelas regras trabalhistas</strong><ul>${troca.bloqueios.map((a, i) => html`<li key=${i}>${a.operador} · ${br(a.data)} · ${a.mensagem}</li>`)}</ul></div>` : null}
        ${troca.justificativa ? html`<p class="mon-muted">${troca.decidido_por ? `${troca.decidido_por}: ` : ''}${troca.justificativa}</p>` : null}
        ${pendente ? html`<div class="wfm-acoes">
          <label class="mon-campo wfm-just"><span>Justificativa (obrigatória)</span><input class="form-control" maxlength="400" value=${texto} onInput=${(e) => setTexto(e.target.value)} /></label>
          <button type="button" class="btn btn-primary btn-sm" disabled=${!texto.trim()} onClick=${confirmar}>Confirmar</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => { setPendente(null); setTexto(''); }}>Voltar</button></div>` : null}
      </div>
      <aside class="tr-col-tempo" aria-label="Linha do tempo e avisos">
        <h4 class="tr-rotulo">Linha do tempo e avisos (${eventos.length})</h4>
        <ul class="tr-tempo">${eventos.map((e, i) => html`<li key=${i} class=${`is-${COR_EVENTO[e.evento] || 'nula'}`}>
          <span class="tr-ponto" aria-hidden="true"></span>
          <div><span><b>${e.por || 'Sistema'}</b> · ${rotuloEvento(e.evento)}${e.detalhe ? ` — ${e.detalhe}` : ''}</span><small>${dataHora(e.em)}</small></div></li>`)}</ul>
      </aside>
    </div>
    ${temAcao ? html`<footer class="tr-barra">
      <span class="tr-barra-txt">${troca.pode_responder ? html`Responda até <b class="tr-prazo">${dataHora(troca.prazo_resposta)}</b>, ou o pedido expira.` : ''}</span>
      <div class="wfm-acoes">
        ${troca.pode_responder ? html`<button type="button" class="btn btn-outline-secondary btn-sm tr-recusar" onClick=${() => executar(() => responderTrocaWfm(troca.id_troca, false), 'Você recusou a troca.')}>Recusar</button><button type="button" class="btn btn-primary btn-sm" onClick=${() => executar(() => responderTrocaWfm(troca.id_troca, true), 'Você aceitou. A troca segue para aprovação.')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Aceitar</button>` : null}
        ${troca.pode_cancelar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => executar(() => cancelarTrocaWfm(troca.id_troca), 'Troca cancelada.')}>Cancelar pedido</button>` : null}
        ${troca.pode_decidir ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPendente('reprovar')}>Reprovar</button><button type="button" class="btn btn-primary btn-sm" onClick=${() => setResumo(true)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Aprovar</button>` : null}
        ${troca.pode_desfazer ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPendente('desfazer')}>Desfazer troca</button>` : null}
      </div>
    </footer>` : null}
    ${resumo ? html`<${ModalResumoTroca} ocupado=${aprovando} onClose=${() => setResumo(false)}
      texto=${textoTrocaSupervisor({ dataA: troca.data_a, dataB: troca.data_b, nomeA: troca.solicitante, nomeB: troca.alvo })}
      onConfirmar=${async () => { setAprovando(true); const ok = await executar(() => decidirTrocaWfm(troca.id_troca, true), 'Troca aprovada e escala republicada.'); setAprovando(false); if (ok) setResumo(false); }} />` : null}
  </section>`;
}

export function TelaTrocas({ controlador, operacao, showToast }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('andamento');
  const [sel, setSel] = useState(null);
  const podeSolicitar = controlador.possuiPermissao('wfm.troca.solicitar');

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try { setItens((await listarTrocasWfm(operacao)).itens); } catch (e) { setItens(null); setErro(e?.message || 'Não foi possível carregar as trocas.'); }
  }, [operacao]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);
  // Atualiza sozinha (a cada 15 s e ao voltar para a aba): quem pediu a troca via "aguardando aprovação" depois da decisão do supervisor.
  useEffect(() => {
    if (!operacao) return undefined;
    const silencioso = () => { if (!document.hidden) listarTrocasWfm(operacao).then((r) => setItens(r.itens), () => {}); };
    const timer = setInterval(silencioso, 15000);
    document.addEventListener('visibilitychange', silencioso);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', silencioso); };
  }, [operacao]);

  const executar = async (fn, sucesso) => {
    try { await fn(); showToast?.(sucesso, 'success'); await carregar(); return true; } catch (e) { showToast?.(e?.message || 'Não foi possível concluir.', 'error'); await carregar(); return false; }
  };

  const ativos = useMemo(() => (itens || []).filter((t) => EM_ANDAMENTO.includes(t.estado)), [itens]);
  const visiveis = useMemo(() => (aba === 'andamento' ? ativos : (itens || []).filter((t) => !EM_ANDAMENTO.includes(t.estado))), [aba, ativos, itens]);
  // Seleção: mantém o pedido escolhido enquanto ele estiver na lista; senão, o primeiro.
  useEffect(() => {
    if (!itens) return;
    setSel((atual) => (visiveis.some((t) => t.id_troca === atual) ? atual : (visiveis[0]?.id_troca ?? null)));
  }, [itens, visiveis]);
  const trocarAba = (nova) => { setAba(nova); setSel(null); };
  const aoTeclar = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = visiveis.findIndex((t) => t.id_troca === sel);
    const prox = visiveis[Math.min(visiveis.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (prox) { setSel(prox.id_troca); e.currentTarget.querySelector(`[data-id="${prox.id_troca}"]`)?.focus(); }
  };
  const atual = visiveis.find((t) => t.id_troca === sel) || null;

  let lista = null; let detalhe;
  if (erro) {
    detalhe = html`<div class="tr-detalhe tr-detalhe--vazio"><div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${carregar}>Tentar de novo</button></div>`;
  } else if (!itens) {
    lista = html`<div class="tr-esqueleto" aria-busy="true">${[0, 1, 2].map((i) => html`<span key=${i}></span>`)}</div>`;
    detalhe = html`<div class="tr-detalhe tr-esqueleto-det" aria-busy="true"><span></span><span></span><span></span></div>`;
  } else {
    lista = visiveis.length ? html`<div class="tr-lista-itens" role="group" aria-label="Pedidos" onKeyDown=${aoTeclar}>${visiveis.map((t) => html`<${LinhaPedido} key=${t.id_troca} troca=${t} ativa=${t.id_troca === sel} onSelecionar=${setSel} />`)}</div>`
      : html`<div class="tr-vazio"><strong>${aba === 'andamento' ? 'Nenhum pedido em andamento.' : 'Nenhuma troca no histórico.'}</strong>${aba === 'andamento' ? html`<span>Use Pedir troca ou abra Minha escala.</span>` : null}</div>`;
    detalhe = atual ? html`<${DetalheTroca} troca=${atual} executar=${executar} />` : html`<div class="tr-detalhe tr-detalhe--vazio">Selecione um pedido para ver os detalhes.</div>`;
  }
  return html`
    <section class="mon-card tr-card">
      <div class="tr-topo">
        <div>
          <h3>Pedidos de troca</h3>
          ${podeSolicitar ? html`<p class="mon-muted wfm-dica">Para pedir uma troca, abra <b>Minha escala</b> e clique no dia que quer trocar. Aqui você acompanha e responde os pedidos.</p>` : null}
        </div>
        <div class="wfm-acoes-cab">
          <div class="wfm-alternador" role="tablist" aria-label="Filtro">
            <button type="button" role="tab" aria-selected=${aba === 'andamento'} class=${aba === 'andamento' ? 'is-ativo' : ''} onClick=${() => trocarAba('andamento')}>Em andamento (${ativos.length})</button>
            <button type="button" role="tab" aria-selected=${aba === 'historico'} class=${aba === 'historico' ? 'is-ativo' : ''} onClick=${() => trocarAba('historico')}>Histórico</button>
          </div>
          ${podeSolicitar ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => controlador.irParaTelaProtegida('screen-wfm-minha-escala')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Pedir troca</button>` : null}
        </div>
      </div>
      <div class="tr-corpo">
        ${lista !== null ? html`<div class="tr-lista"><div class="tr-lista-cab"><span>${aba === 'andamento' ? 'Pedidos em andamento' : 'Pedidos encerrados'}</span><span>Status</span></div>${lista}</div>` : null}
        ${detalhe}
      </div>
    </section>`;
}
