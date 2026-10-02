import { html, useCallback, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  cancelarTrocaWfm,
  decidirTrocaWfm,
  desfazerTrocaWfm,
  listarTrocasWfm,
  responderTrocaWfm,
} from '../../services/api/wfm.js';
import { dataHora } from './comum.js';

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

function CartaoTroca({ troca, executar }) {
  const [pendente, setPendente] = useState(null); // 'reprovar' | 'desfazer'
  const [texto, setTexto] = useState('');
  const est = ESTADOS[troca.estado] || { rotulo: troca.estado, classe: '' };
  const confirmar = async () => {
    if (!texto.trim()) return;
    const ok = await executar(() => (pendente === 'reprovar' ? decidirTrocaWfm(troca.id_troca, false, texto) : desfazerTrocaWfm(troca.id_troca, texto)),
      pendente === 'reprovar' ? 'Troca reprovada.' : 'Troca desfeita e escala republicada.');
    if (ok) { setPendente(null); setTexto(''); }
  };
  return html`
    <article class="wfm-troca">
      <header>
        <div><strong>${troca.solicitante}</strong> <span class="wfm-troca-seta">⇄</span> <strong>${troca.alvo}</strong></div>
        <span class=${`mon-badge mon-badge--${est.classe}`}>${est.rotulo}</span>
      </header>
      <dl class="wfm-troca-dados">
        <div><dt>Dia cedido</dt><dd>${br(troca.data_a)}</dd></div>
        <div><dt>Dia assumido</dt><dd>${br(troca.data_b)}</dd></div>
        ${troca.detalhe.map((d) => html`<div key=${d.data} class="wfm-troca-largo"><dt>Turnos em ${br(d.data)}</dt>
          <dd class="wfm-troca-turnos">${[[troca.solicitante, d.solicitante_antes, d.solicitante_supervisor, d.solicitante_equipe], [troca.alvo, d.alvo_antes, d.alvo_supervisor, d.alvo_equipe]].map(([nome, turno, sup, eq]) => html`<span key=${nome}><b>${nome.split(' ')[0]}</b> ${turno}${sup ? html` · Sup. ${sup}` : ''}${eq ? html` · Equipe ${eq}` : ''}</span>`)}</dd></div>`)}
        ${troca.estado === 'AGUARDANDO_B' ? html`<div><dt>Prazo do colega</dt><dd>${dataHora(troca.prazo_resposta)}</dd></div>` : null}
        ${troca.estado === 'AGUARDANDO_APROVACAO' ? html`<div><dt>Prazo da decisão</dt><dd>${dataHora(troca.prazo_decisao)}</dd></div>` : null}
        ${troca.motivo ? html`<div class="wfm-troca-largo"><dt>Motivo</dt><dd>${troca.motivo}</dd></div>` : null}
      </dl>
      ${troca.alertas.length ? html`<div class="wfm-validacao is-alerta"><strong>Alerta de risco trabalhista</strong><ul>${troca.alertas.map((a, i) => html`<li key=${i}>${a.mensagem}</li>`)}</ul></div>` : null}
      ${troca.bloqueios.length ? html`<div class="wfm-validacao is-bloqueio"><strong>Bloqueada pelas regras trabalhistas</strong><ul>${troca.bloqueios.map((a, i) => html`<li key=${i}>${a.operador} · ${br(a.data)} · ${a.mensagem}</li>`)}</ul></div>` : null}
      ${troca.justificativa ? html`<p class="mon-muted">${troca.decidido_por ? `${troca.decidido_por}: ` : ''}${troca.justificativa}</p>` : null}
      <div class="wfm-acoes">
        ${troca.pode_responder ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => executar(() => responderTrocaWfm(troca.id_troca, true), 'Você aceitou. A troca segue para aprovação.')}>Aceitar</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => executar(() => responderTrocaWfm(troca.id_troca, false), 'Você recusou a troca.')}>Recusar</button>` : null}
        ${troca.pode_cancelar ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => executar(() => cancelarTrocaWfm(troca.id_troca), 'Troca cancelada.')}>Cancelar pedido</button>` : null}
        ${troca.pode_decidir ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => executar(() => decidirTrocaWfm(troca.id_troca, true), 'Troca aprovada e escala republicada.')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Aprovar</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPendente('reprovar')}>Reprovar</button>` : null}
        ${troca.pode_desfazer ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => setPendente('desfazer')}>Desfazer troca</button>` : null}
      </div>
      ${pendente ? html`<div class="wfm-acoes">
        <label class="mon-campo wfm-just"><span>Justificativa (obrigatória)</span><input class="form-control" maxlength="400" value=${texto} onInput=${(e) => setTexto(e.target.value)} /></label>
        <button type="button" class="btn btn-primary btn-sm" disabled=${!texto.trim()} onClick=${confirmar}>Confirmar</button><button type="button" class="btn btn-outline-secondary btn-sm" onClick=${() => { setPendente(null); setTexto(''); }}>Voltar</button></div>` : null}
      <details class="wfm-versoes"><summary>Linha do tempo e avisos (${troca.linha_do_tempo.length})</summary>
        <ul class="wfm-linha-tempo">${troca.linha_do_tempo.map((e, i) => html`<li key=${i}><span>${dataHora(e.em)}</span> <b>${e.por || 'Sistema'}</b> · ${(ESTADOS[e.evento]?.rotulo) || (e.evento === 'SOLICITADA' ? 'Solicitada' : e.evento)}${e.detalhe ? ` — ${e.detalhe}` : ''}</li>`)}</ul></details>
    </article>`;
}

export function TelaTrocas({ controlador, operacao, showToast }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('andamento');
  const podeSolicitar = controlador.possuiPermissao('wfm.troca.solicitar');

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try { setItens((await listarTrocasWfm(operacao)).itens); } catch (e) { setItens(null); setErro(e?.message || 'Não foi possível carregar as trocas.'); }
  }, [operacao]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);

  const executar = async (fn, sucesso) => {
    try { await fn(); showToast?.(sucesso, 'success'); await carregar(); return true; } catch (e) { showToast?.(e?.message || 'Não foi possível concluir.', 'error'); await carregar(); return false; }
  };

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!itens) return html`<${LoadingState} titulo="Carregando as trocas" />`;
  const ativos = itens.filter((t) => ['AGUARDANDO_B', 'AGUARDANDO_APROVACAO'].includes(t.estado));
  const visiveis = aba === 'andamento' ? ativos : itens.filter((t) => !['AGUARDANDO_B', 'AGUARDANDO_APROVACAO'].includes(t.estado));
  return html`
    <section class="mon-card">
      <div class="wfm-cabecalho wfm-cabecalho--centro">
        <div><h3>Pedidos de troca</h3></div>
        <div class="wfm-acoes-cab">
          <div class="wfm-alternador" role="group" aria-label="Filtro">
            <button type="button" class=${aba === 'andamento' ? 'is-ativo' : ''} onClick=${() => setAba('andamento')}>Em andamento (${ativos.length})</button>
            <button type="button" class=${aba === 'historico' ? 'is-ativo' : ''} onClick=${() => setAba('historico')}>Histórico</button>
          </div>
          ${podeSolicitar ? html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${() => controlador.irParaTelaProtegida('screen-wfm-minha-escala')}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Pedir troca</button>` : null}
        </div>
      </div>
      ${podeSolicitar ? html`<p class="mon-muted wfm-dica">Para pedir uma troca, abra <b>Minha escala</b> e clique no dia que quer trocar. Aqui você acompanha e responde os pedidos.</p>` : null}
      ${visiveis.length ? html`<div class="wfm-trocas">${visiveis.map((t) => html`<${CartaoTroca} key=${t.id_troca} troca=${t} executar=${executar} />`)}</div>`
        : html`<${EmptyState} icon="compare_arrows" title=${aba === 'andamento' ? 'Nenhuma troca em andamento' : 'Nenhuma troca no histórico'} text=${podeSolicitar ? 'Para pedir uma troca, clique em um dia da sua escala em Minha escala.' : 'Quando houver pedidos para aprovar, eles aparecem aqui.'} />`}
    </section>`;
}
