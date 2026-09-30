import { html, useCallback, useEffect, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  cancelarTrocaWfm,
  decidirTrocaWfm,
  desfazerTrocaWfm,
  listarColegasTrocaWfm,
  listarTrocasWfm,
  responderTrocaWfm,
  solicitarTrocaWfm,
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

function semanaAtual() {
  const hoje = new Date();
  const seg = new Date(hoje); seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
  const dom = new Date(seg); dom.setDate(seg.getDate() + 6);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { min: iso(seg), max: iso(dom) };
}

function FormSolicitar({ operacao, onFeito, onCancelar, showToast }) {
  const [colegas, setColegas] = useState([]);
  const [form, setForm] = useState({ id_alvo: '', data_a: '', data_b: '', motivo: '' });
  const [enviando, setEnviando] = useState(false);
  const semana = semanaAtual();
  useEffect(() => { listarColegasTrocaWfm(operacao).then((r) => setColegas(r.itens || [])).catch(() => setColegas([])); }, [operacao]);
  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      await solicitarTrocaWfm({ operacao, id_alvo: Number(form.id_alvo), data_a: form.data_a, data_b: form.data_b || form.data_a, motivo: form.motivo });
      showToast?.('Troca solicitada. Seu colega tem 48 horas úteis para responder.', 'success');
      onFeito();
    } catch (err) { showToast?.(err?.message || 'Não foi possível solicitar a troca.', 'error'); } finally { setEnviando(false); }
  };
  const set = (k, v) => setForm({ ...form, [k]: v });
  return html`
    <form class="wfm-form" onSubmit=${enviar}>
      <p class="mon-muted">Regras: só de segunda a quinta, com 12 horas de antecedência, em dias da semana corrente (${br(semana.min)} a ${br(semana.max)}), entre operadores com as mesmas skills. A troca precisa da aprovação do seu supervisor ou do RH.</p>
      <div class="mon-form-grid">
        <label class="mon-campo"><span>Colega</span>
          <select class="form-select" required value=${form.id_alvo} onChange=${(e) => set('id_alvo', e.target.value)}><option value="">Selecione</option>${colegas.map((c) => html`<option key=${c.id_usuario} value=${c.id_usuario}>${c.nome}</option>`)}</select></label>
        <label class="mon-campo"><span>Dia que eu cedo</span><input class="form-control" type="date" required min=${semana.min} max=${semana.max} value=${form.data_a} onInput=${(e) => set('data_a', e.target.value)} /></label>
        <label class="mon-campo"><span>Dia do colega que eu assumo <small class="mon-muted">(vazio = o mesmo dia)</small></span><input class="form-control" type="date" min=${semana.min} max=${semana.max} value=${form.data_b} onInput=${(e) => set('data_b', e.target.value)} /></label>
        <label class="mon-campo"><span>Motivo (opcional)</span><input class="form-control" maxlength="300" value=${form.motivo} onInput=${(e) => set('motivo', e.target.value)} /></label>
      </div>
      <div class="wfm-acoes"><button type="submit" class="btn btn-primary" disabled=${enviando}>Solicitar troca</button><button type="button" class="btn btn-outline-secondary" onClick=${onCancelar}>Cancelar</button></div>
    </form>`;
}

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
        ${troca.detalhe.map((d) => html`<div key=${d.data}><dt>Turnos em ${br(d.data)}</dt><dd>${troca.solicitante.split(' ')[0]}: ${d.solicitante_antes} · ${troca.alvo.split(' ')[0]}: ${d.alvo_antes}</dd></div>`)}
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
  const [novo, setNovo] = useState(false);
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
      <div class="wfm-cabecalho">
        <div><h3>Trocas de plantão</h3></div>
        <div class="wfm-acoes-cab">
          <div class="wfm-alternador" role="group" aria-label="Filtro">
            <button type="button" class=${aba === 'andamento' ? 'is-ativo' : ''} onClick=${() => setAba('andamento')}>Em andamento (${ativos.length})</button>
            <button type="button" class=${aba === 'historico' ? 'is-ativo' : ''} onClick=${() => setAba('historico')}>Histórico</button>
          </div>
          ${podeSolicitar ? html`<button type="button" class="btn btn-outline-primary" onClick=${() => setNovo(!novo)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Solicitar troca</button>` : null}
        </div>
      </div>
      ${novo ? html`<${FormSolicitar} operacao=${operacao} showToast=${showToast} onCancelar=${() => setNovo(false)} onFeito=${() => { setNovo(false); carregar(); }} />` : null}
      ${visiveis.length ? html`<div class="wfm-trocas">${visiveis.map((t) => html`<${CartaoTroca} key=${t.id_troca} troca=${t} executar=${executar} />`)}</div>`
        : html`<${EmptyState} icon="compare_arrows" title=${aba === 'andamento' ? 'Nenhuma troca em andamento' : 'Nenhuma troca no histórico'} text=${podeSolicitar ? 'Use "Solicitar troca" para pedir uma troca de plantão a um colega.' : 'Quando houver pedidos para aprovar, eles aparecem aqui.'} />`}
    </section>`;
}
