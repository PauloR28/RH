import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import {
  concluirTurnoDiario,
  corrigirAbsDiario,
  criarIntercorrenciaDiario,
  editarIntercorrenciaDiario,
  encerrarDiaDiario,
  excluirIntercorrenciaDiario,
  excluirParcialDiario,
  lerDiaDiario,
  marcarEdicaoTurno,
  reabrirDiaDiario,
  reabrirTurnoDiario,
  salvarEncerramentoDiario,
  salvarParcialDiario,
  salvarTurnoDiario,
} from '../../../services/api/diario.js';
import { Esqueleto, Estado, Ic, MenuAcoes, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { JanelaAbs, JanelaIntercorrencia, JanelaMotivo, JanelaParcial } from './janelas.js';
import { JanelaFechamento } from './fechamento.js';
import {
  ENCERRAMENTOS, ROTULO_CANAL, ROTULO_TURNO, ROTULO_TURNO_CURTO, TURNOS, avisosDoTurno, consolidar, dataHoraBr, diaCurto, hhmm, nf,
  numeroOuVazio, pct, pctCampo, pctOuVazio, somarDias, tratadas,
} from './regras.js';

// Diário de bordo › Hoje (amostra aprovada em 08/11/2026, quadros 1, 2 e 4). Um diário por dia por operação, 3 turnos
// (rascunho → concluído) e a visão Dia (consolidado + ABS + encerramento). Salva sozinho a cada mudança; erro de gravação
// vira faixa vermelha e o que foi digitado continua na tela. Quem decide tudo é o servidor (/diario/*).

const ST = {
  concluido: ['check-circle', 'c-db-st--ok', 'Concluído'],
  rascunho: ['pencil-simple', 'c-db-st--rasc', 'Rascunho'],
  reaberto: ['arrow-counter-clockwise', 'c-db-st--rasc', 'Reaberto'],
  vazio: ['circle-dashed', 'c-db-st--vazio', 'Não começou'],
};
export const SinalTurno = ({ estado }) => {
  const [icone, classe, rotulo] = ST[estado] || ST.vazio;
  return html`<span class=${`c-db-st ${classe}`} title=${rotulo} role="img" aria-label=${rotulo}><${Ic} nome=${icone} /></span>`;
};
const tomNs = (v) => (v === null || v === undefined ? '' : v >= 95 ? '' : v >= 85 ? 'atencao' : 'perigo');
const msg = (e) => e?.message || 'Não foi possível gravar.';
const DEBOUNCE_MS = 1200;

// ── Registro de um turno ────────────────────────────────────────────────
function CorpoTurno({ dados, turno, pode, onSalvo, onMudarVivo, recarregar, abrir, operacao }) {
  const cad = dados.cadastros;
  const demandas = cad.filter((c) => c.tipo === 'demanda' && (dados.ids_demanda || []).includes(c.id_item));
  const canaisNs = cad.filter((c) => c.tipo === 'canal_ns' && (dados.ids_ns || []).includes(c.id_item));
  const diaAberto = dados.dia?.status === 'aberto';
  const [valores, setValores] = useState(() => Object.fromEntries(demandas.map((c) => {
    const d = turno.demandas[c.id_item];
    return [c.id_item, { inicio: d?.inicio ?? '', fim: d?.fim ?? '' }];
  })));
  const [ns, setNs] = useState(() => Object.fromEntries(canaisNs.map((c) => [c.id_item, pctCampo(turno.ns[c.id_item])])));
  const [obs, setObs] = useState(turno.observacoes || '');
  const [sujo, setSujo] = useState(false);
  const [salvoEm, setSalvoEm] = useState(turno.salvo_em);
  const [erroSalvar, setErroSalvar] = useState('');
  const [erroAcao, setErroAcao] = useState('');
  const [editandoOutro, setEditandoOutro] = useState(turno.editando);
  const [ocupado, setOcupado] = useState(false);
  const versao = useRef(turno.versao);
  const salvando = useRef(false);
  const deNovo = useRef(false);
  const atual = useRef({ valores, ns, obs });
  atual.current = { valores, ns, obs };

  const podeEditar = pode.preencher && diaAberto && turno.status !== 'concluido';
  const editavel = podeEditar && !editandoOutro;

  // Avisa o servidor que estou neste turno (o outro vê "Fulano está editando"); renova a cada minuto.
  useEffect(() => {
    if (!podeEditar) return undefined;
    let vivo = true;
    const marcar = () => marcarEdicaoTurno(turno.id_turno, false).then((r) => { if (vivo && r && !r.ok) setEditandoOutro(r.editando); }).catch(() => {});
    if (!turno.editando) marcar();
    const t = setInterval(() => { if (!editandoOutro) marcar(); }, 60000);
    return () => { vivo = false; clearInterval(t); };
  }, [turno.id_turno, podeEditar, Boolean(editandoOutro)]);

  const payload = () => ({
    versao: versao.current,
    demandas: Object.entries(atual.current.valores).map(([id, v]) => ({ id_item: Number(id), inicio: numeroOuVazio(v.inicio), fim: numeroOuVazio(v.fim) })),
    ns: Object.entries(atual.current.ns).map(([id, v]) => ({ id_item: Number(id), valor: pctOuVazio(v) })),
    observacoes: atual.current.obs,
  });

  const salvar = useCallback(async () => {
    if (salvando.current) { deNovo.current = true; return false; }
    salvando.current = true;
    const corpo = payload();
    try {
      const r = await salvarTurnoDiario(turno.id_turno, corpo);
      versao.current = r.versao;
      setSalvoEm(r.salvo_em);
      setErroSalvar('');
      onSalvo(turno.id_turno, { versao: r.versao, salvo_em: r.salvo_em, corpo });
      if (!deNovo.current) setSujo(false);
      return true;
    } catch (e) {
      setErroSalvar(msg(e));
      return false;
    } finally {
      salvando.current = false;
      if (deNovo.current) { deNovo.current = false; salvar(); }
    }
  }, [turno.id_turno]);

  useEffect(() => {
    if (!sujo || !editavel) return undefined;
    const t = setTimeout(salvar, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [valores, ns, obs, sujo, editavel]);

  // Valores vivos para os números do dia lá em cima.
  useEffect(() => {
    onMudarVivo(turno.turno, {
      demandas: Object.fromEntries(Object.entries(valores).map(([id, v]) => [id, { inicio: numeroOuVazio(v.inicio), fim: numeroOuVazio(v.fim) }])),
      ns: Object.fromEntries(Object.entries(ns).map(([id, v]) => [id, pctOuVazio(v)])),
    });
  }, [valores, ns]);

  const mudarCampo = (id, campo) => (e) => { setValores((v) => ({ ...v, [id]: { ...v[id], [campo]: e.target.value.replace(/[^\d]/g, '') } })); setSujo(true); };
  const linhas = demandas.map((c) => ({ id_item: c.id_item, nome: c.nome, inicio: numeroOuVazio(valores[c.id_item]?.inicio), fim: numeroOuVazio(valores[c.id_item]?.fim) }));
  const avisos = avisosDoTurno(linhas);
  const avisoDe = Object.fromEntries(avisos.map((a) => [a.id_item, a]));
  const soma = (k) => linhas.reduce((s, l) => s + (l[k] || 0), 0);
  const somaTrat = linhas.reduce((s, l) => s + (tratadas(l.inicio, l.fim) || 0), 0);

  const concluir = async () => {
    setOcupado(true); setErroAcao('');
    try {
      if (sujo) { const ok = await salvar(); if (!ok) { setOcupado(false); return; } }
      await concluirTurnoDiario(turno.id_turno, versao.current);
      await recarregar();
    } catch (e) { setErroAcao(msg(e)); setOcupado(false); }
  };

  const campo = (c, k, rot) => {
    const v = valores[c.id_item]?.[k] ?? '';
    const erro = k === 'fim' && avisoDe[c.id_item]?.tipo === 'fim_maior';
    return html`<input class=${`c-entrada c-db-campo${v === '' ? ' c-db-campo--vazio' : ''}${erro ? ' c-db-campo--erro' : ''}`} inputmode="numeric" placeholder="—"
      value=${v} readOnly=${!editavel || null} aria-label=${`${c.nome} · ${rot}`} onInput=${mudarCampo(c.id_item, k)} />`;
  };

  const nomesAvisos = [...new Set(avisos.map((a) => a.nome))];
  const textoAvisos = `${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}: ${nomesAvisos.slice(0, 3).join(', ')}${nomesAvisos.length > 3 ? ` e mais ${nomesAvisos.length - 3}` : ''}. Dá para salvar; para concluir, explique em Observações ou preencha.`;

  const rodape = turno.status === 'concluido'
    ? html`<div class="c-db-rodape"><span class="c-db-salvo"><${Ic} nome="lock" />Concluído ${hhmm(turno.concluido_em)} por ${turno.concluido_por}. Só leitura.</span>
        <div class="c-grupo">${pode.reabrir && turno.status === 'concluido' ? html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => abrir({ tipo: 'reabrir-turno', turno })}><${Ic} nome="lock-open" />Reabrir</button>` : null}</div></div>`
    : html`<div class="c-db-rodape">
        ${avisos.length && podeEditar ? html`<span class="c-db-avisos"><${Ic} nome="warning" />${textoAvisos}</span>` : !podeEditar ? html`<span class="c-db-salvo">${!pode.preencher ? 'Só leitura (sem permissão para preencher).' : !diaAberto ? 'Dia encerrado: só leitura.' : ''}</span>` : null}
        <div class="c-grupo">
          ${salvoEm ? html`<span class="c-db-salvo" aria-live="polite"><${Ic} nome="check-circle" />Salvo ${hhmm(salvoEm)}</span>` : null}
          ${editavel ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || null} onClick=${() => salvar()}><${Ic} nome="floppy-disk" />Salvar rascunho</button>
            <button type="button" class="c-botao c-botao--principal" disabled=${ocupado || null} onClick=${concluir}><${Ic} nome="lock" />Concluir turno</button>` : null}
        </div></div>`;

  const ferramentas = cad.filter((c) => c.tipo === 'ferramenta');
  return html`
    ${editandoOutro && podeEditar ? html`<div class="c-db-faixa"><div class="c-faixa c-faixa--atencao" role="status"><${Ic} nome="user" /><div class="c-faixa-txt"><p><b>${editandoOutro.nome} está editando este turno</b> (desde ${hhmm(editandoOutro.desde)}). Você vê só leitura para não sobrescrever o que ele(a) digita.</p>
      <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${async () => { await marcarEdicaoTurno(turno.id_turno, true); setEditandoOutro(null); recarregar(); }}>Editar mesmo assim</button></div></div></div>` : null}
    ${erroSalvar ? html`<div class="c-db-faixa"><div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p><b>Não foi salvo.</b> ${erroSalvar} O que você digitou continua na tela.</p>
      <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => salvar()}>Tentar de novo</button><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${recarregar}>Recarregar</button></div></div></div>` : null}
    ${erroAcao ? html`<div class="c-db-faixa"><div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erroAcao}</p></div></div></div>` : null}
    <div class="c-db-corpo">
      <div>
        <table class="c-tabela c-tabela--compacta c-db-tab">
          <thead><tr><th class="c-col-nome" scope="col">Tipo de demanda</th><th class="c-num" scope="col">Início do turno</th><th class="c-num" scope="col">Fim do turno</th><th class="c-num" scope="col">Tratadas</th><th class="c-estica" scope="col"><span class="c-oculto">Aviso</span></th></tr></thead>
          <tbody>${demandas.map((c) => {
            const l = linhas.find((x) => x.id_item === c.id_item); const tr = tratadas(l.inicio, l.fim); const av = avisoDe[c.id_item];
            return html`<tr key=${c.id_item}><td class="c-col-nome c-forte">${c.nome}${c.ativo ? null : html` <small class="c-secundario">(desligado)</small>`}</td>
              <td class="c-num">${campo(c, 'inicio', 'Início')}</td><td class="c-num">${campo(c, 'fim', 'Fim')}</td>
              <td class="c-num">${tr === null ? html`<span class="c-db-nada" title="Não informado">—</span>` : html`<span class="c-db-calc">${tr}</span>`}</td>
              <td class="c-estica">${av && av.tipo === 'fim_maior' ? html`<span class="c-db-obs" title="Entraram demandas novas durante o turno? Explique em Observações."><${Ic} nome="warning" />${av.texto}</span>`
                : av && (l.inicio !== null || l.fim !== null) ? html`<span class="c-db-obs"><${Ic} nome="warning" />${av.texto}</span>` : null}</td></tr>`;
          })}</tbody>
          <tfoot><tr><td class="c-col-nome">Total</td><td class="c-num">${soma('inicio')}</td><td class="c-num">${soma('fim')}</td><td class="c-num">${somaTrat}</td><td class="c-estica c-db-nada c-db-regra">Tratadas = início − fim (calcula sozinho)</td></tr></tfoot>
        </table>
        <div class="c-campo c-db-obs-turno"><label class="c-rotulo" for=${`db-obs-${turno.turno}`}>Observações do turno <span class="c-opcional">(${avisos.length ? 'obrigatório para concluir com avisos' : 'opcional'})</span></label>
          <input class="c-entrada" id=${`db-obs-${turno.turno}`} readOnly=${!editavel || null} placeholder="Ex.: Reclame Aqui (portal) recebeu 4 novos às 18:20" value=${obs} maxLength="1000"
            onInput=${(e) => { setObs(e.target.value); setSujo(true); }} /></div>
      </div>
      <div class="c-db-lado">
        <section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Nível de serviço do turno</h3></div><div class="c-db-bloco-corpo"><div class="c-db-ns">
          ${canaisNs.map((c) => html`<div class="c-campo" key=${c.id_item}><label class="c-rotulo" for=${`ns-${turno.turno}-${c.id_item}`}>${c.nome}</label>
            <span class="c-db-pct"><input class=${`c-entrada c-db-campo${ns[c.id_item] === '' ? ' c-db-campo--vazio' : ''}`} id=${`ns-${turno.turno}-${c.id_item}`} inputmode="decimal" placeholder="—" readOnly=${!editavel || null}
              value=${ns[c.id_item]} onInput=${(e) => { setNs((x) => ({ ...x, [c.id_item]: e.target.value.replace(/[^\d,.]/g, '') })); setSujo(true); }} /><span>%</span></span>
            ${ns[c.id_item] === '' ? html`<span class="c-ajuda">Vazio = "não informado" (não vira 0)</span>` : null}</div>`)}
        </div></div></section>
        <${BlocoParciais} dados=${dados} pode=${pode} abrir=${abrir} />
        <${BlocoIntercorrencias} dados=${dados} pode=${pode} abrir=${abrir} ferramentas=${ferramentas} operacao=${operacao} />
      </div>
    </div>
    ${rodape}`;
}

function BlocoParciais({ dados, pode, abrir }) {
  const canais = dados.cadastros.filter((c) => c.tipo === 'canal_parcial');
  const editavel = pode.preencher && dados.dia?.status === 'aberto';
  const nomeCurto = (n) => (n === 'Web Chat' ? 'Chat' : n);
  return html`<section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Parciais do dia</h3>
    ${editavel ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => abrir({ tipo: 'parcial' })}><${Ic} nome="plus" />Parcial</button>` : null}</div>
    <div class="c-db-bloco-corpo c-db-bloco-corpo--lista">${dados.parciais.length ? html`<ul class="c-db-itens">
      ${dados.parciais.map((p) => html`<li key=${p.id_parcial}><span class="c-db-hora">${p.hora}</span>
        <small title=${canais.map((c) => `${c.nome} ${nf(p.valores[c.id_item] ?? null)}`).join(' · ')}>${canais.map((c) => `${nomeCurto(c.nome)} ${nf(p.valores[c.id_item] ?? null)}`).join(' · ')}</small><b class="c-db-fim">${nf(p.total)}</b>
        ${editavel ? html`<${MenuAcoes} rotulo=${`Ações da parcial das ${p.hora}`} acoes=${[
          { label: 'Editar', icon: 'pencil-simple', onClick: () => abrir({ tipo: 'parcial', item: p }) },
          { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => abrir({ tipo: 'excluir-parcial', item: p }) },
        ]} />` : null}</li>`)}</ul>` : html`<p class="c-ajuda c-db-vazio">Nenhuma parcial registrada.</p>`}</div></section>`;
}

function BlocoIntercorrencias({ dados, pode, abrir }) {
  const lista = dados.intercorrencias.filter((i) => !i.excluida);
  return html`<section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Intercorrências</h3>
    ${pode.preencher && dados.dia?.status === 'aberto' ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => abrir({ tipo: 'interc' })}><${Ic} nome="plus" />Registrar</button>` : null}</div>
    <div class="c-db-bloco-corpo c-db-bloco-corpo--lista">${lista.length ? html`<ul class="c-db-itens">
      ${lista.map((f) => html`<li key=${f.id_intercorrencia}><span class="c-db-hora">${hhmm(f.inicio)}</span>
        <span class="c-db-txt"><b>${f.ferramenta}</b><small>${f.de_outro_dia ? `desde ${dataHoraBr(f.inicio).slice(0, 5)} · ` : ''}${ROTULO_TURNO[f.turno]} · ${ROTULO_CANAL[f.canal] || f.canal} · ${f.fim ? `até ${hhmm(f.fim)}` : 'sem hora de fim'}</small></span>
        ${f.fim ? html`<${Selo} tom="sucesso" icone="check-circle">Encerrada<//>` : html`<${Selo} tom="perigo" icone="warning-octagon">Em aberto<//>`}
        ${pode.preencher ? html`<${MenuAcoes} rotulo=${`Ações da intercorrência ${f.ferramenta}`} acoes=${[
          { label: f.fim ? 'Ver e editar' : 'Encerrar ou editar', icon: 'pencil-simple', onClick: () => abrir({ tipo: 'interc', item: f }) },
          dados.dia?.status === 'aberto' && !f.de_outro_dia ? { label: 'Excluir', icon: 'trash', perigo: true, onClick: () => abrir({ tipo: 'excluir-interc', item: f }) } : null,
        ]} />` : null}</li>`)}</ul>` : html`<p class="c-ajuda c-db-vazio">Nenhuma intercorrência.</p>`}</div></section>`;
}

// ── Visão Dia: consolidado + ABS + encerramento ─────────────────────────
function CorpoDia({ dados, cons, pode, abrir, recarregar, operacao }) {
  const cad = Object.fromEntries(dados.cadastros.map((c) => [c.id_item, c]));
  const dia = dados.dia;
  const abs = dados.abs?.vigente;
  const presenca = dados.abs?.presenca;
  const corr = dados.abs?.correcoes?.[0];
  const [tipo, setTipo] = useState(dia?.encerramento_tipo || '');
  const [passagem, setPassagem] = useState(dia?.passagem || '');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const versaoDia = useRef(dia?.versao);
  const aberto = dia?.status === 'aberto';
  const podeEnc = pode.preencher && aberto;
  const concluidos = dados.turnos.filter((t) => t.status === 'concluido').length;
  const deTurno = (t, ultimo) => (t && t !== ultimo ? html` <small class="c-secundario" title=${`Vale o do ${ROTULO_TURNO[t]}`}>(${ROTULO_TURNO_CURTO[t]})</small>` : null);
  const ultimoTurno = [...TURNOS].reverse().find((t) => dados.turnos.find((x) => x.turno === t && x.estado !== 'vazio')) || null;

  const gravar = async (encerrar) => {
    setOcupado(true); setErro(''); setOk('');
    try {
      const corpo = { versao: versaoDia.current, encerramento_tipo: tipo || null, passagem };
      const r = encerrar ? await encerrarDiaDiario(dia.id_dia, corpo) : await salvarEncerramentoDiario(dia.id_dia, corpo);
      versaoDia.current = r.versao;
      if (encerrar) await recarregar(); else setOk('Salvo.');
    } catch (e) { setErro(msg(e)); }
    setOcupado(false);
  };

  return html`<div class="c-db-dia">
    <div>
      <section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Fluxo de demandas do dia</h3></div>
        <table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col">Tipo</th><th class="c-num" scope="col">Início do dia</th><th class="c-num" scope="col">Tratadas</th><th class="c-num" scope="col">Pendente no fim</th></tr></thead>
          <tbody>${cons.demandas.map((d) => html`<tr key=${d.id_item}><td class="c-forte">${cad[d.id_item]?.nome}</td><td class="c-num">${nf(d.inicio)}</td><td class="c-num">${nf(d.tratadas)}</td>
            <td class="c-num">${nf(d.pendente)}${deTurno(d.pendente_de, ultimoTurno)}</td></tr>`)}</tbody>
          <tfoot><tr><td>Total</td><td class="c-num">${nf(cons.totais.inicio)}</td><td class="c-num">${nf(cons.totais.tratadas)}</td><td class="c-num">${nf(cons.totais.pendente)}</td></tr></tfoot></table></section>
      <section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Nível de serviço</h3><small>vale o último turno preenchido, não a média</small></div>
        <table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col">Canal</th>${TURNOS.map((t) => html`<th key=${t} class="c-num" scope="col">${t === 'intermediario' ? 'Interm.' : ROTULO_TURNO[t]}</th>`)}<th class="c-num" scope="col">Final do dia</th></tr></thead>
          <tbody>${cons.ns.map((n) => html`<tr key=${n.id_item}><td class="c-forte">${cad[n.id_item]?.nome}</td>
            ${TURNOS.map((t) => { const v = dados.vivos?.[t]?.ns?.[n.id_item] ?? dados.turnos.find((x) => x.turno === t)?.ns?.[n.id_item]; return html`<td key=${t} class="c-num">${v === null || v === undefined ? html`<span class="c-db-nada" title="Não informado">—</span>` : pct(v)}</td>`; })}
            <td class="c-num c-forte">${pct(n.valor)}${deTurno(n.de, 'fechamento')}</td></tr>`)}</tbody></table></section>
    </div>
    <div>
      <section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Absenteísmo (ABS)</h3>
        <span class="c-db-origem">${abs?.origem === 'correcao' ? html`<${Ic} nome="pencil-simple" />Corrigido por ${corr?.corrigido_por} · ${dataHoraBr(corr?.corrigido_em)}` : html`<${Ic} nome="user-check" />Vem da Presença${presenca?.lancamentos ? '' : ' (sem lançamentos)'}`}</span></div>
        <div class="c-db-bloco-corpo">
          <div class="c-db-abs"><span>Escalados<b>${abs?.escalados ?? 0}</b></span><span>Presentes<b>${abs?.presentes ?? 0}</b></span><span>Faltas<b>${abs?.faltas ?? 0}</b></span><span>Justificadas<b>${abs?.justificadas ?? 0}</b></span>
            <span>Folgas · Férias<b>${abs?.folgas ?? 0} · ${abs?.ferias ?? 0}</b></span><span class="c-db-abs-total">ABS<b>${pct(abs?.abs)}</b></span></div>
          ${abs?.origem === 'correcao' ? html`<span class="c-ajuda">Presença: ABS ${pct(presenca?.abs)} (${presenca?.escalados ?? 0} escalados). ${corr?.origem === 'importacao' ? 'Valor digitado no diário antigo.' : `Motivo: ${corr?.motivo}`}</span>`
            : html`<span class="c-ajuda">ABS = faltas ÷ escalados. Folga e férias não contam (são ausências planejadas). Vem da Presença; quem fecha pode corrigir com motivo.</span>`}
          ${podeEnc ? html`<div><button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => abrir({ tipo: 'abs', atual: abs })}><${Ic} nome="pencil-simple" />Corrigir ABS</button></div>` : null}
        </div></section>
      <section class="c-db-bloco"><div class="c-db-bloco-cab"><h3>Encerramento do dia</h3><small>feito por quem fecha</small></div>
        <div class="c-db-bloco-corpo">
          ${!aberto ? html`<${Selo} tom="sucesso" icone="lock">Dia encerrado ${dataHoraBr(dia?.encerrado_em)} · ${dia?.encerrado_por}<//>` : null}
          <div class="c-db-opcoes" role="radiogroup" aria-label="Como o dia termina">${ENCERRAMENTOS.map(([v, r]) => html`<label key=${v} class="c-marcar"><input type="radio" name="db-enc" checked=${tipo === v} disabled=${!podeEnc || null} onChange=${() => setTipo(v)} /> ${r}</label>`)}</div>
          <div class="c-campo"><label class="c-rotulo" for="db-pass">Passagem para o próximo dia</label>
            <textarea class="c-entrada" id="db-pass" rows="2" maxLength="2000" readOnly=${!podeEnc || null} value=${passagem} onInput=${(e) => setPassagem(e.target.value)}></textarea>
            <span class="c-ajuda">A Abertura de amanhã vê este texto no topo do diário.</span></div>
          ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
          ${podeEnc ? html`<div class="c-grupo c-db-acoes-dia">
            ${ok ? html`<span class="c-db-salvo"><${Ic} nome="check-circle" />${ok}</span>` : null}
            <button type="button" class="c-botao c-botao--secundario" disabled=${ocupado || null} onClick=${() => gravar(false)}><${Ic} nome="floppy-disk" />Salvar</button>
            <button type="button" class="c-botao c-botao--principal" disabled=${ocupado || concluidos < 3 || null} title=${concluidos < 3 ? `Faltam ${3 - concluidos} turno(s) concluído(s)` : null} onClick=${() => gravar(true)}><${Ic} nome="lock" />Encerrar o dia</button></div>`
            : !aberto && pode.reabrir ? html`<div class="c-grupo c-db-acoes-dia"><button type="button" class="c-botao c-botao--secundario" onClick=${() => abrir({ tipo: 'reabrir-dia' })}><${Ic} nome="lock-open" />Reabrir o dia</button></div>` : null}
        </div></section>
    </div></div>`;
}

// ── Aba Hoje ────────────────────────────────────────────────────────────
export function AbaHoje({ contexto, operacao, setOperacao, data, setData, showToast, controlador }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(null);
  const [recarga, setRecarga] = useState(0);
  const [janela, setJanela] = useState(null);
  const [vivos, setVivos] = useState({});
  const pode = contexto.pode;
  const hoje = contexto.hoje;

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const d = await lerDiaDiario(operacao, data);
      setDados(d); setVivos({}); setRecarga((n) => n + 1);
    } catch (e) { setErro(msg(e)); }
  }, [operacao, data]);
  useEffect(() => { setDados(null); setVer(null); carregar(); }, [carregar]);
  useEffect(() => { if (dados && !ver) setVer(data === hoje && dados.dia ? (dados.turno_atual || 'abertura') : 'dia'); }, [dados, ver]);

  const onSalvo = useCallback((idTurno, { versao, salvo_em: salvoEm, corpo }) => {
    setDados((d) => ({ ...d, turnos: d.turnos.map((t) => (t.id_turno !== idTurno ? t : {
      ...t, versao, salvo_em: salvoEm, salvo_por: 'você', estado: t.estado === 'vazio' ? 'rascunho' : t.estado, observacoes: corpo.observacoes || '',
      demandas: Object.fromEntries(corpo.demandas.map((x) => [x.id_item, { inicio: x.inicio, fim: x.fim }])),
      ns: Object.fromEntries(corpo.ns.map((x) => [x.id_item, x.valor])), editando: null,
    })) }));
  }, []);
  const onMudarVivo = useCallback((turno, v) => setVivos((x) => ({ ...x, [turno]: v })), []);

  const cons = useMemo(() => {
    if (!dados?.dia) return null;
    const turnos = {};
    dados.turnos.forEach((t) => {
      const vivo = vivos[t.turno];
      if (t.estado === 'vazio' && !vivo) return;
      turnos[t.turno] = vivo || { demandas: t.demandas, ns: t.ns };
    });
    return consolidar(turnos, dados.ids_demanda.map(String), dados.ids_ns.map(String));
  }, [dados, vivos]);

  const tituloDia = `${data === hoje ? 'Hoje, ' : ''}${diaCurto(data)}`;
  const navDia = html`<div class="c-grupo c-navegar" role="group" aria-label="Dia" style=${{ gap: 0, flexWrap: 'nowrap' }}>
    <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Dia anterior" title="Dia anterior" onClick=${() => setData(somarDias(data, -1))}><${Ic} nome="caret-left" /></button>
    ${data === hoje ? html`<span class="c-botao c-botao--texto c-botao--compacto c-db-dia-rot" aria-live="polite">${tituloDia}</span>`
      : html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-db-dia-rot" aria-live="polite" title="Voltar para hoje" onClick=${() => setData(hoje)}>${tituloDia}</button>`}
    <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Próximo dia" title="Próximo dia" disabled=${data >= hoje || null} onClick=${() => setData(somarDias(data, 1))}><${Ic} nome="caret-right" /></button>
  </div>`;
  const selOperacao = html`<select class="c-entrada c-entrada--compacta" aria-label="Operação" value=${operacao} onChange=${(e) => setOperacao(e.target.value)}>
    ${contexto.operacoes.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>`;

  const cab = html`<div class="c-cab-linha"><h1>Diário de bordo</h1><div class="c-cab-dir">
    ${dados?.dia && pode.ver ? html`<button type="button" class="c-botao c-botao--principal" onClick=${() => setJanela({ tipo: 'fechamento' })}><${Ic} nome="share-network" />Gerar fechamento</button>` : null}</div></div>`;

  if (erro) return html`${cab}<div class="c-tabela-caixa"><div class="c-filtros c-filtros--suave">${navDia}${selOperacao}</div><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /></div>`;
  if (!dados) return html`${cab}<div class="c-tabela-caixa"><div class="c-filtros c-filtros--suave">${navDia}${selOperacao}</div><${Esqueleto} linhas=${8} /></div>`;

  // Qualidade: só as intercorrências do dia.
  if (dados.so_intercorrencias) {
    return html`${cab}<div class="c-tabela-caixa"><div class="c-filtros c-filtros--suave">${navDia}${selOperacao}<span class="c-db-quem c-fim">Você vê só as intercorrências</span></div>
      ${dados.intercorrencias.length ? html`<table class="c-tabela c-tabela--compacta"><thead><tr><th scope="col">Começou</th><th scope="col">Terminou</th><th scope="col">Ferramenta</th><th scope="col">Canal</th><th scope="col">Turno</th><th class="c-estica" scope="col">O que aconteceu</th><th scope="col">Situação</th></tr></thead>
        <tbody>${dados.intercorrencias.map((f) => html`<tr key=${f.id_intercorrencia}><td>${dataHoraBr(f.inicio)}</td><td>${f.fim ? dataHoraBr(f.fim) : '—'}</td><td class="c-forte">${f.ferramenta}</td><td>${ROTULO_CANAL[f.canal] || f.canal}</td><td>${ROTULO_TURNO[f.turno]}</td>
          <td class="c-estica">${f.descricao}${f.acao ? html`<br /><small class="c-secundario">Feito: ${f.acao}</small>` : null}</td><td>${f.fim ? html`<${Selo} tom="sucesso" icone="check-circle">Encerrada<//>` : html`<${Selo} tom="perigo" icone="warning-octagon">Em aberto<//>`}</td></tr>`)}</tbody></table>`
        : html`<${Estado} icone="check-circle" titulo="Nenhuma intercorrência neste dia" />`}</div>`;
  }

  if (!dados.dia) {
    const futuro = data > hoje;
    return html`${cab}<div class="c-tabela-caixa"><div class="c-filtros c-filtros--suave">${navDia}${selOperacao}</div>
      <${Estado} icone="notebook" titulo=${futuro ? 'Este dia ainda não começou' : 'Nenhum registro neste dia'} texto=${futuro ? '' : 'Ninguém abriu o diário desta operação neste dia.'} /></div>`;
  }

  const turnoSel = dados.turnos.find((t) => t.turno === ver);
  const concluidos = dados.turnos.filter((t) => t.status === 'concluido').length;
  const quem = ver === 'dia'
    ? (dados.dia.status === 'encerrado' ? `Dia encerrado ${hhmm(dados.dia.encerrado_em)} · ${dados.dia.encerrado_por}` : `Dia aberto · ${concluidos} de 3 turnos concluídos`)
    : !turnoSel ? '' : turnoSel.status === 'concluido' ? `Concluído ${hhmm(turnoSel.concluido_em)} · ${turnoSel.concluido_por}`
      : turnoSel.estado === 'vazio' ? 'Não começou' : `${turnoSel.estado === 'reaberto' ? 'Reaberto' : 'Rascunho'} · salvo ${hhmm(turnoSel.salvo_em)} · ${turnoSel.salvo_por}`;

  const abs = dados.abs?.vigente;
  const interc = dados.intercorrencias.filter((i) => !i.excluida);
  const cad = Object.fromEntries(dados.cadastros.map((c) => [String(c.id_item), c]));
  const resumo = html`<div class="c-pd-resumo c-db-resumo" role="group" aria-label="O dia até agora">
    ${[['Início do dia', nf(cons.totais.inicio)], ['Tratadas', nf(cons.totais.tratadas)], ['Pendentes', nf(cons.totais.pendente)],
      ...cons.ns.map((n) => [`NS ${cad[n.id_item]?.nome || ''}`, pct(n.valor), tomNs(n.valor)]),
      ['ABS', pct(abs?.abs)], ['Intercorrências', String(interc.length), interc.some((i) => !i.fim) ? 'perigo' : '']]
      .map(([r, n, tom]) => html`<div key=${r} class=${`c-pd-num${tom ? ` c-pd-num--${tom}` : ''}`}><b>${n}</b><small>${r}</small></div>`)}
  </div>`;

  const fechar = () => setJanela(null);
  const depois = async (promessa, texto) => { await promessa; showToast?.(texto); await carregar(); };
  const j = janela;
  const ferramentas = dados.cadastros.filter((c) => c.tipo === 'ferramenta');
  const janelaAberta = !j ? null
    : j.tipo === 'fechamento' ? html`<${JanelaFechamento} dados=${dados} cons=${cons} vivos=${vivos} ver=${ver} operacaoNome=${contexto.operacoes.find((o) => o.chave === operacao)?.nome || operacao}
        controlador=${controlador} onClose=${fechar} />`
      : j.tipo === 'interc' ? html`<${JanelaIntercorrencia} operacao=${operacao} data=${data} item=${j.item} ferramentas=${ferramentas} onClose=${fechar}
        onSalvar=${(corpo) => depois(j.item ? editarIntercorrenciaDiario(j.item.id_intercorrencia, corpo) : criarIntercorrenciaDiario(corpo), j.item ? 'Intercorrência salva.' : 'Intercorrência registrada.')} />`
        : j.tipo === 'excluir-interc' ? html`<${JanelaMotivo} titulo="Excluir intercorrência" texto="Nada é apagado: ela fica marcada como excluída no histórico do dia." salvarRotulo="Excluir" onClose=${fechar}
          onConfirmar=${(m) => depois(excluirIntercorrenciaDiario(j.item.id_intercorrencia, m), 'Intercorrência excluída.')} />`
          : j.tipo === 'parcial' ? html`<${JanelaParcial} canais=${dados.cadastros.filter((c) => c.tipo === 'canal_parcial' && (c.ativo || j.item?.valores?.[c.id_item] !== undefined))} item=${j.item} onClose=${fechar}
            onSalvar=${(corpo) => depois(salvarParcialDiario(dados.dia.id_dia, j.item?.id_parcial, corpo), 'Parcial salva.')} />`
            : j.tipo === 'excluir-parcial' ? html`<${JanelaMotivo} titulo=${`Excluir a parcial das ${j.item.hora}`} rotulo="Por quê?" salvarRotulo="Excluir" onClose=${fechar}
              onConfirmar=${() => depois(excluirParcialDiario(dados.dia.id_dia, j.item.id_parcial), 'Parcial excluída.')} />`
              : j.tipo === 'abs' ? html`<${JanelaAbs} atual=${j.atual} onClose=${fechar} onSalvar=${(corpo) => depois(corrigirAbsDiario(dados.dia.id_dia, corpo), 'ABS corrigido.')} />`
                : j.tipo === 'reabrir-turno' ? html`<${JanelaMotivo} titulo=${`Reabrir ${j.turno.rotulo}`} texto="O turno volta a rascunho e o motivo fica no histórico do dia." salvarRotulo="Reabrir" onClose=${fechar}
                  onConfirmar=${(m) => depois(reabrirTurnoDiario(j.turno.id_turno, m), 'Turno reaberto.')} />`
                  : j.tipo === 'reabrir-dia' ? html`<${JanelaMotivo} titulo="Reabrir o dia" texto="O dia volta a aceitar mudanças e o motivo fica no histórico." salvarRotulo="Reabrir" onClose=${fechar}
                    onConfirmar=${(m) => depois(reabrirDiaDiario(dados.dia.id_dia, m), 'Dia reaberto.')} />` : null;

  const pass = dados.passagem_anterior;
  return html`${cab}
    ${pass && pass.passagem ? html`<div class="c-faixa c-faixa--informacao c-db-passagem" role="status"><${Ic} nome="moon" /><div class="c-faixa-txt"><p><b>Passagem de ${diaCurto(pass.data)}</b> (${pass.encerrado_por}, ${hhmm(pass.encerrado_em)}): ${pass.passagem}</p></div></div>` : null}
    <div class="c-tabela-caixa">
      <div class="c-filtros c-filtros--suave">${navDia}${contexto.operacoes.length > 1 ? selOperacao : html`<span class="c-db-op">${contexto.operacoes[0]?.nome}</span>`}
        <div class="c-segmento c-db-reg" role="group" aria-label="Registro do dia">
          ${dados.turnos.map((t) => html`<button key=${t.turno} type="button" class="c-botao" aria-pressed=${ver === t.turno ? 'true' : 'false'} onClick=${() => setVer(t.turno)}><${SinalTurno} estado=${t.estado} />${t.rotulo}</button>`)}
          <button type="button" class="c-botao" aria-pressed=${ver === 'dia' ? 'true' : 'false'} onClick=${() => setVer('dia')}><${Ic} nome="calendar-check" />Dia</button>
        </div>
        <span class="c-db-quem c-fim">${quem}</span>
      </div>
      ${resumo}
      ${ver === 'dia' || !turnoSel
    ? html`<${CorpoDia} key=${`dia-${recarga}`} dados=${{ ...dados, vivos }} cons=${cons} pode=${pode} abrir=${setJanela} recarregar=${carregar} operacao=${operacao} />`
    : html`<${CorpoTurno} key=${`${turnoSel.id_turno}-${recarga}`} dados=${dados} turno=${turnoSel} pode=${pode} onSalvo=${onSalvo} onMudarVivo=${onMudarVivo} recarregar=${carregar} abrir=${setJanela} operacao=${operacao} />`}
    </div>
    ${janelaAberta}`;
}
