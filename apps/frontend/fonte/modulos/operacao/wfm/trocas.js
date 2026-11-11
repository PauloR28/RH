import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import {
  cancelarTrocaWfm,
  decidirTrocaWfm,
  desfazerTrocaWfm,
  listarTrocasWfm,
  responderTrocaWfm,
} from '../../../services/api/wfm.js?v=20261111-modulos-op';
import { dataHora } from './comum.js?v=20261111-modulos-op';
import { ModalResumoTroca, textoTrocaSupervisor } from './trocas-texto.js?v=20261111-texto';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, MenuAcoes, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { tomarFocoPessoa } from './foco-pessoa.js';

// Trocas de plantão (redesign Fase 15, amostra "Trocas" da Fase 12). Nenhuma troca é automática: mesmo com o colega
// de acordo, um Supervisor, Control Desk ou Gestor/RH aprova. Todas as regras (janela, prazo, skills, motor) rodam
// no servidor; a tela só mostra o que o servidor libera (pode_responder, pode_decidir, pode_cancelar, pode_desfazer).

// Estado → [rótulo, tom do selo, ícone]. Recusada/Reprovada/Bloqueada em vermelho; encerradas neutras.
const ESTADOS = {
  AGUARDANDO_B: ['Aguardando o colega', 'neutro', 'hourglass'],
  AGUARDANDO_APROVACAO: ['Aguardando aprovação', 'atencao', 'hourglass'],
  APROVADA: ['Aprovada', 'sucesso', 'check-circle'],
  REPROVADA: ['Reprovada', 'perigo', 'x-circle'],
  RECUSADA: ['Recusada pelo colega', 'perigo', 'x-circle'],
  CANCELADA: ['Cancelada', 'neutro', 'x'],
  EXPIRADA: ['Expirada', 'neutro', 'clock'],
  INVALIDADA: ['Invalidada', 'neutro', 'x'],
  BLOQUEADA: ['Bloqueada pelas regras', 'perigo', 'lock'],
  DESFEITA: ['Desfeita', 'informacao', 'arrow-counter-clockwise'],
};
const TOM_EVENTO = { SOLICITADA: 'informacao', AGUARDANDO_B: 'neutro', AGUARDANDO_APROVACAO: 'atencao', APROVADA: 'sucesso', RECUSADA: 'perigo', REPROVADA: 'perigo', EXPIRADA: 'neutro', CANCELADA: 'neutro', DESFEITA: 'informacao' };
const EM_ANDAMENTO = ['AGUARDANDO_B', 'AGUARDANDO_APROVACAO'];
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaCurto = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} ${DIAS[new Date(a, m - 1, d).getDay()]}`;
};
const rotuloEvento = (e) => (ESTADOS[e]?.[0]) || (e === 'SOLICITADA' ? 'Solicitada' : e);
const pedidaEm = (t) => (t.linha_do_tempo || [])[0]?.em || '';
// "06/11 08:40" (sem ano nem segundos) para caber na tabela densa.
const curto = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '');

function SeloTroca({ troca }) {
  const [rotulo, tom, icone] = ESTADOS[troca.estado] || [troca.estado, 'neutro', ''];
  return html`<${Selo} tom=${tom} icone=${icone}>${rotulo}<//>`;
}

// Justificativa obrigatória (reprovar / desfazer) numa janela pequena.
function JanelaJustificativa({ titulo, texto, rotuloConfirmar, onConfirmar, onClose }) {
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const confirmar = async (ev) => {
    ev.preventDefault();
    if (!motivo.trim()) return;
    setOcupado(true);
    const ok = await onConfirmar(motivo);
    setOcupado(false);
    if (ok) onClose();
  };
  return html`<${Janela} titulo=${titulo} tamanho="pequena" onClose=${onClose}>
    <form class="c-janela-form" onSubmit=${confirmar}>
      <div class="c-janela-corpo">
        <p>${texto}</p>
        <${Campo} rotulo="Justificativa" ajuda="Obrigatória. Fica registrada na linha do tempo.">
          <textarea class="c-entrada" maxlength="400" autofocus value=${motivo} onInput=${(e) => setMotivo(e.target.value)}></textarea>
        <//>
      </div>
      <div class="c-janela-rodape">
        <button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Voltar</button>
        <button type="submit" class="c-botao c-botao--perigo" aria-busy=${ocupado ? 'true' : null} disabled=${!motivo.trim() || ocupado || null}>${rotuloConfirmar}</button>
      </div>
    </form>
  <//>`;
}

function FichaTurno({ nome, rotulo, data, turno, supervisor, equipe }) {
  return html`<table class="c-diario-ficha"><tbody>
    <tr><td>${rotulo}</td><td><b>${nome}</b></td></tr>
    <tr><td>Data</td><td>${br(data)}</td></tr>
    <tr><td>Turno</td><td>${turno || '—'}</td></tr>
    ${supervisor ? html`<tr><td>Supervisor</td><td>${supervisor}</td></tr>` : null}
    ${equipe ? html`<tr><td>Equipe</td><td>${equipe}</td></tr>` : null}
  </tbody></table>`;
}

// Detalhe do pedido no painel lateral (Esc fecha). As ações chamam as mesmas rotas de antes.
function PainelTroca({ troca, acoes, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const det = (data) => (troca.detalhe || []).find((d) => d.data === data) || troca.detalhe?.[0] || {};
  const da = det(troca.data_a); const db = det(troca.data_b);
  const eventos = [...(troca.linha_do_tempo || [])].reverse();
  const prazoTxt = troca.estado === 'AGUARDANDO_APROVACAO' ? dataHora(troca.prazo_decisao) : dataHora(troca.prazo_resposta);
  return html`<aside class="c-painel-lateral c-diario c-ds" role="dialog" aria-label=${`Troca de ${troca.solicitante} com ${troca.alvo}`}>
    <div class="c-janela-cab">
      <h2>${troca.solicitante} ⇄ ${troca.alvo}<small>Pedido de troca · ${br(troca.data_a)}${troca.data_b && troca.data_b !== troca.data_a ? ` x ${br(troca.data_b)}` : ''}</small></h2>
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Fechar" title="Fechar" onClick=${onClose}><${Ic} nome="x" /></button>
    </div>
    <div class="c-janela-corpo">
      <div><${SeloTroca} troca=${troca} /></div>
      ${troca.pode_responder ? html`<${Faixa} tom="atencao" icone="clock">Responda até <b>${dataHora(troca.prazo_resposta)}</b>, ou o pedido expira.<//>` : null}
      <div class="c-colunas">
        <${FichaTurno} nome=${troca.solicitante} rotulo="Cede o dia" data=${troca.data_a} turno=${da.solicitante_antes} supervisor=${da.solicitante_supervisor} equipe=${da.solicitante_equipe} />
        <${FichaTurno} nome=${troca.alvo} rotulo="Assume o dia" data=${troca.data_b} turno=${db.alvo_antes} supervisor=${db.alvo_supervisor} equipe=${db.alvo_equipe} />
      </div>
      <table class="c-diario-ficha"><tbody>
        ${EM_ANDAMENTO.includes(troca.estado) ? html`<tr><td>${troca.estado === 'AGUARDANDO_APROVACAO' ? 'Prazo da decisão' : 'Prazo do colega'}</td><td>${prazoTxt}</td></tr>`
          : troca.prazo_resposta ? html`<tr><td>Prazo do colega</td><td>${dataHora(troca.prazo_resposta)}</td></tr>` : null}
        <tr><td>Motivo</td><td>${troca.motivo || '—'}</td></tr>
        ${troca.justificativa ? html`<tr><td>Decisão</td><td>${troca.decidido_por ? `${troca.decidido_por}: ` : ''}${troca.justificativa}</td></tr>` : null}
      </tbody></table>
      ${troca.alertas?.length ? html`<${Faixa} tom="atencao" icone="warning"><b>Alerta de risco trabalhista.</b> ${troca.alertas.map((a) => a.mensagem).join(' · ')}<//>` : null}
      ${troca.bloqueios?.length ? html`<${Faixa} tom="perigo" icone="lock"><b>Bloqueada pelas regras trabalhistas.</b> ${troca.bloqueios.map((a) => `${a.operador} · ${br(a.data)} · ${a.mensagem}`).join(' · ')}<//>` : null}
      <div>
        <h3>Linha do tempo (${eventos.length})</h3>
        <ul class="c-linha-tempo">${eventos.map((e, i) => html`<li key=${i} title=${dataHora(e.em)}>
          <time>${curto(e.em).slice(0, 5)}</time><${Ic} nome="circle" />
          <span>${e.por || 'Sistema'}${e.detalhe ? ` — ${e.detalhe}` : ''}</span>
          <${Selo} tom=${TOM_EVENTO[e.evento] || 'neutro'}>${rotuloEvento(e.evento)}<//>
        </li>`)}</ul>
      </div>
    </div>
    ${acoes ? html`<div class="c-janela-rodape">${acoes}</div>` : null}
  </aside>`;
}

export function TelaTrocas({ controlador, operacao, showToast, opcoesEscala = null, aoTrocarEscala = null }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('andamento');
  const [busca, setBusca] = useState(() => tomarFocoPessoa('trocas')); // vindo do Painel do dia: já filtrado pela pessoa
  const [situacao, setSituacao] = useState('');
  const [aberta, setAberta] = useState(null); // id da troca no painel lateral
  const [resumo, setResumo] = useState(null); // troca sendo aprovada (janela de resumo)
  const [aprovando, setAprovando] = useState(false);
  const [justificar, setJustificar] = useState(null); // { troca, tipo: 'reprovar' | 'desfazer' }
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
  const daAba = useMemo(() => (aba === 'andamento' ? ativos : (itens || []).filter((t) => !EM_ANDAMENTO.includes(t.estado))), [aba, ativos, itens]);
  const situacoes = [...new Set(daAba.map((t) => t.estado))];
  const termo = busca.trim().toLowerCase();
  const visiveis = daAba.filter((t) => (!situacao || t.estado === situacao) && (!termo || `${t.solicitante} ${t.alvo}`.toLowerCase().includes(termo)));
  const atual = (itens || []).find((t) => t.id_troca === aberta) || null;
  useEffect(() => { if (aberta && itens && !atual) setAberta(null); }, [itens, aberta, atual]);
  const trocarAba = (nova) => { setAba(nova); setSituacao(''); };

  const aceitar = (t) => executar(() => responderTrocaWfm(t.id_troca, true), 'Você aceitou. A troca segue para aprovação.');
  const recusar = (t) => executar(() => responderTrocaWfm(t.id_troca, false), 'Você recusou a troca.');
  const cancelar = (t) => executar(() => cancelarTrocaWfm(t.id_troca), 'Troca cancelada.');
  const acoesDe = (t, noPainel = false) => {
    const botoes = [];
    if (t.pode_responder) {
      botoes.push(html`<button key="rec" type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => recusar(t)}>Recusar</button>`);
      botoes.push(html`<button key="ace" type="button" class="c-botao c-botao--principal c-botao--compacto" onClick=${() => aceitar(t)}><${Ic} nome="check" />Aceitar</button>`);
    }
    if (t.pode_decidir) {
      botoes.push(noPainel
        ? html`<button key="rep" type="button" class="c-botao c-botao--secundario" onClick=${() => setJustificar({ troca: t, tipo: 'reprovar' })}>Reprovar</button>`
        : html`<span key="dec" class="c-decidir" role="group" aria-label=${`Decidir troca de ${t.solicitante}`}>
            <button type="button" class="c-botao c-botao--aprovar" aria-label="Aprovar troca" title="Aprovar troca" onClick=${() => setResumo(t)}><${Ic} nome="check" /></button>
            <button type="button" class="c-botao c-botao--reprovar" aria-label="Reprovar troca" title="Reprovar troca (pede o motivo)" onClick=${() => setJustificar({ troca: t, tipo: 'reprovar' })}><${Ic} nome="x" /></button>
          </span>`);
      if (noPainel) botoes.push(html`<button key="apr" type="button" class="c-botao c-botao--principal" onClick=${() => setResumo(t)}><${Ic} nome="check" />Aprovar</button>`);
    }
    if (noPainel && t.pode_cancelar) botoes.push(html`<button key="can" type="button" class="c-botao c-botao--secundario" onClick=${() => cancelar(t)}>Cancelar pedido</button>`);
    if (noPainel && t.pode_desfazer) botoes.push(html`<button key="des" type="button" class="c-botao c-botao--secundario" onClick=${() => setJustificar({ troca: t, tipo: 'desfazer' })}>Desfazer troca</button>`);
    return botoes;
  };

  const tabela = () => {
    if (erro) return html`<${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} />`;
    if (!itens) return html`<${Esqueleto} linhas=${4} />`;
    if (!daAba.length) return html`<${Estado} icone="arrows-left-right" titulo=${aba === 'andamento' ? 'Nenhum pedido em andamento.' : 'Nenhuma troca no histórico.'} texto=${aba === 'andamento' && podeSolicitar ? 'Para pedir uma troca, abra Minha escala e clique no dia que quer trocar.' : ''} />`;
    if (!visiveis.length) return html`<${Estado} titulo="Nenhuma troca encontrada." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setSituacao(''); }} />`;
    return html`<table class="c-tabela">
      <thead><tr><th scope="col">Solicitante</th><th scope="col">Colega</th><th scope="col">Data</th><th scope="col">Turno dele</th><th scope="col">Turno do colega</th><th scope="col">Situação</th><th scope="col" class="c-estica">Pedida</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th></tr></thead>
      <tbody>${visiveis.map((t) => {
    const d = t.detalhe?.[0] || {};
    const menu = [
      { label: 'Ver detalhe', icon: 'eye', onClick: () => setAberta(t.id_troca) },
      t.pode_cancelar ? { label: 'Cancelar pedido', icon: 'x', onClick: () => cancelar(t) } : null,
      t.pode_desfazer ? { label: 'Desfazer troca', icon: 'arrow-counter-clockwise', perigo: true, onClick: () => setJustificar({ troca: t, tipo: 'desfazer' }) } : null,
    ];
    return html`<tr key=${t.id_troca} class="c-clicavel" tabIndex="0" aria-selected=${aberta === t.id_troca ? 'true' : null}
          onClick=${(ev) => { if (!ev.target.closest('button, a, .c-abre-menu')) setAberta(t.id_troca); }}
          onKeyDown=${(ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) setAberta(t.id_troca); }}>
          <td class="c-forte">${t.solicitante}</td>
          <td>${t.alvo}</td>
          <td>${diaCurto(t.data_a)}${t.data_b && t.data_b !== t.data_a ? html` <span class="c-sec">x ${diaCurto(t.data_b)}</span>` : null}</td>
          <td>${d.solicitante_antes || '—'}</td>
          <td>${d.alvo_antes || '—'}</td>
          <td><${SeloTroca} troca=${t} /></td>
          <td class="c-estica c-secundario" title=${dataHora(pedidaEm(t))}>${curto(pedidaEm(t))}</td>
          <td class="c-acoes"><div class="c-grupo">${acoesDe(t)}<${MenuAcoes} rotulo=${`Mais ações da troca de ${t.solicitante}`} acoes=${menu} /></div></td>
        </tr>`;
  })}</tbody>
    </table>`;
  };

  const aguardamVoce = ativos.filter((t) => t.pode_decidir || t.pode_responder).length;
  const aguardamColega = ativos.filter((t) => t.estado === 'AGUARDANDO_B').length;
  return html`
    <main class="c-pagina c-conteudo">
      <div class="c-cab-linha"><h1>Trocas</h1>
        ${opcoesEscala && opcoesEscala.length > 1 && aoTrocarEscala ? html`<select class="c-entrada c-entrada--compacta c-trocar-escala" aria-label="Trocar de escala" value=${operacao} onChange=${(e) => aoTrocarEscala(e.target.value)}>${opcoesEscala.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
        ${podeSolicitar ? html`<div class="c-cab-dir"><button type="button" class="c-botao c-botao--principal" onClick=${() => controlador.irParaTelaProtegida('screen-wfm-minha-escala')}><${Ic} nome="plus" />Pedir troca</button></div>` : null}
      </div>
      <div class="c-tabela-caixa">
        <div class="c-filtros c-filtros--suave">
          <${Segmento} rotulo="Lista" valor=${aba} aoMudar=${trocarAba} opcoes=${[['andamento', 'Em andamento', itens ? ativos.length : null], ['historico', 'Histórico']]} />
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
          ${situacoes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Situação" value=${situacao} onChange=${(e) => setSituacao(e.target.value)}>
            <option value="">Todas as situações</option>
            ${situacoes.map((s) => html`<option key=${s} value=${s}>${ESTADOS[s]?.[0] || s}</option>`)}
          </select>` : null}
        </div>
        ${tabela()}
        ${itens && aba === 'andamento' && ativos.length ? html`<div class="c-legenda"><span>${aguardamVoce} aguardam você · ${aguardamColega} aguardam o colega</span><span class="c-legenda-fim">✓ aprova · ✕ reprova (pede o motivo) · clique na linha para ver o detalhe</span></div>` : null}
      </div>
    </main>
    ${atual ? html`<${PainelTroca} troca=${atual} acoes=${acoesDe(atual, true).length ? acoesDe(atual, true) : null} onClose=${() => setAberta(null)} />` : null}
    ${justificar ? html`<${JanelaJustificativa}
      titulo=${justificar.tipo === 'reprovar' ? 'Reprovar troca' : 'Desfazer troca'}
      texto=${justificar.tipo === 'reprovar' ? `A troca de ${justificar.troca.solicitante} com ${justificar.troca.alvo} será reprovada.` : `A troca de ${justificar.troca.solicitante} com ${justificar.troca.alvo} será desfeita e a escala republicada.`}
      rotuloConfirmar=${justificar.tipo === 'reprovar' ? 'Reprovar' : 'Desfazer troca'}
      onClose=${() => setJustificar(null)}
      onConfirmar=${(motivo) => (justificar.tipo === 'reprovar'
        ? executar(() => decidirTrocaWfm(justificar.troca.id_troca, false, motivo), 'Troca reprovada.')
        : executar(() => desfazerTrocaWfm(justificar.troca.id_troca, motivo), 'Troca desfeita e escala republicada.'))} />` : null}
    ${resumo ? html`<${ModalResumoTroca} ocupado=${aprovando} onClose=${() => setResumo(null)}
      texto=${textoTrocaSupervisor({ dataA: resumo.data_a, dataB: resumo.data_b, nomeA: resumo.solicitante, nomeB: resumo.alvo })}
      onConfirmar=${async () => { setAprovando(true); const ok = await executar(() => decidirTrocaWfm(resumo.id_troca, true), 'Troca aprovada e escala republicada.'); setAprovando(false); if (ok) setResumo(null); }} />` : null}`;
}
