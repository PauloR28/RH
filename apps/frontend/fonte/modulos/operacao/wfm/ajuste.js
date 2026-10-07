import { html, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import {
  lancarHoraExtraWfm,
  lerPausasDiaWfm,
  listarHorasExtrasWfm,
  salvarItensEscalaWfm,
  salvarPausasWfm,
} from '../../../services/api/wfm.js';
import { minutosParaHoras } from './comum.js';
import { Icone, Quadrado, SEMANA_LONGA, aMin, brData, deMin, doIso, duracaoMin } from './escala-ui.js';
import { LinhaTempo } from './minha.js?v=20261007-admin-escala';

// Gaveta "Ajustar dia": turno, horário, hora extra e pausas de UM colaborador em UM dia, com a opção de repetir o
// ajuste em outros dias do mês. Salva direto na API existente (itens da escala, pausas e hora extra); regras de negócio,
// escopo e período fechado continuam sendo validados no servidor. Aberta só quando a escala é editável.

const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição' };
const PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
const ARTIGO = ['Todos os', 'Todas as', 'Todas as', 'Todas as', 'Todas as', 'Todas as', 'Todos os'];
const MAX_PAUSAS = 6;
const nomePausa = (p, i) => ROTULO_PAUSA[p.tipo] || `Pausa ${i + 1}`;

// Erros de cada pausa: dentro da jornada e sem sobreposição. O servidor valida de novo (limites, tipos, capacidade).
function validarPausas(pausas, entrada, dur) {
  return pausas.map((p, i) => {
    if (!p.inicio) return 'Informe o horário.';
    if (p.duracao_min < 1) return 'O fim deve ser depois do início.';
    if (p.duracao_min > 120) return 'Duração máxima de 120 min.';
    if (!entrada || !dur) return '';
    const ini = (aMin(p.inicio) - aMin(entrada) + 1440) % 1440;
    if (ini + p.duracao_min > dur) return 'A pausa precisa ficar dentro da jornada.';
    for (let j = 0; j < pausas.length; j += 1) {
      if (j === i || !pausas[j].inicio || pausas[j].duracao_min < 1) continue;
      const iniJ = (aMin(pausas[j].inicio) - aMin(entrada) + 1440) % 1440;
      if (ini < iniJ + pausas[j].duracao_min && iniJ < ini + p.duracao_min && j < i) return `Sobrepõe a ${nomePausa(pausas[j], j)}.`;
    }
    return '';
  });
}

export function GavetaAjusteDia({ alvo, dados, operacao, anoMes, fechada, bloqueio = '', showToast, aoFechar, aoSalvo }) {
  const itens = useMemo(() => new Map((dados.itens || []).map((i) => [`${i.id_operador}:${i.data}`, i])), [dados]);
  const turnosPorId = useMemo(() => Object.fromEntries((dados.turnos || []).map((t) => [t.id_turno, t])), [dados]);
  const item = itens.get(`${alvo.id}:${alvo.data}`) || null;
  const turnoSalvo = turnosPorId[item?.id_turno];
  const selecionaveis = (dados.turnos || []).filter((t) => (t.tipo !== 'DSR' && t.ativo !== false) || t.id_turno === item?.id_turno);

  const [idTurno, setIdTurno] = useState(item?.id_turno ?? null);
  const [entrada, setEntrada] = useState(item?.entrada_ajuste || turnoSalvo?.entrada || '');
  const [saida, setSaida] = useState(item?.saida_ajuste || turnoSalvo?.saida || '');
  const [he, setHe] = useState('');
  const [heOrig, setHeOrig] = useState(0);
  const [pausas, setPausas] = useState(null); // null = carregando
  const [pausasOrig, setPausasOrig] = useState('[]');
  const [padroes, setPadroes] = useState([]);
  const [escopo, setEscopo] = useState('dia');
  const [justificativa, setJustificativa] = useState('');
  const [progresso, setProgresso] = useState(null);
  const [falhas, setFalhas] = useState([]);
  const caixa = useRef(null);
  const secaoPausas = useRef(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  useEffect(() => {
    let vivo = true;
    Promise.all([
      lerPausasDiaWfm(operacao, alvo.data).catch(() => null),
      listarHorasExtrasWfm(operacao, anoMes).catch(() => ({ itens: [] })),
    ]).then(([p, h]) => {
      if (!vivo) return;
      const lista = ((p?.operadores || []).find((o) => o.id_operador === alvo.id)?.pausas || []).map((x) => ({ ordem: x.ordem, tipo: x.tipo, inicio: x.inicio, duracao_min: x.duracao_min }));
      setPausas(lista);
      setPausasOrig(JSON.stringify(lista));
      setPadroes(p?.pausas_padrao || []);
      const minutos = (h.itens || []).find((x) => x.id_operador === alvo.id && x.data === alvo.data)?.minutos || 0;
      setHe(minutos ? String(minutos) : '');
      setHeOrig(minutos);
    });
    return () => { vivo = false; };
  }, [operacao, anoMes, alvo.id, alvo.data]);

  useEffect(() => {
    if (pausas !== null && alvo.secao === 'pausas') secaoPausas.current?.scrollIntoView?.({ block: 'nearest' });
  }, [pausas === null]);

  // Foco preso na gaveta, Esc fecha e o foco volta para quem abriu.
  useEffect(() => {
    const anterior = document.activeElement;
    const el = caixa.current;
    el?.querySelector('[data-foco-inicial]')?.focus();
    const aoTeclar = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const foco = [...el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')].filter((n) => n.offsetParent !== null);
      if (!foco.length) return;
      const primeiro = foco[0]; const ultimo = foco[foco.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => { document.removeEventListener('keydown', aoTeclar); anterior?.focus?.(); };
  }, []);

  const turno = turnosPorId[idTurno];
  const trabalha = turno?.tipo === 'TRABALHO';
  const dur = trabalha ? duracaoMin(entrada, saida) : 0;
  const lista = pausas || [];
  const errosPausa = trabalha ? validarPausas(lista, entrada, dur) : [];
  const dow = doIso(alvo.data).getDay();
  const diaNum = Number(alvo.data.slice(8));
  const datasEscopo = escopo === 'dia' ? [alvo.data]
    : escopo === 'semana' ? (dados.dias || []).filter((d) => doIso(d).getDay() === dow)
      : (dados.dias || []).filter((d) => d >= alvo.data);
  const ajustado = (t) => !!t && trabalha && (entrada !== t.entrada || saida !== t.saida);
  const itemParaSalvar = (data) => {
    const atual = itens.get(`${alvo.id}:${data}`);
    const ajust = ajustado(turno);
    return {
      mudou: (atual?.id_turno ?? null) !== idTurno || (atual?.entrada_ajuste || '') !== (ajust ? entrada : '') || (atual?.saida_ajuste || '') !== (ajust ? saida : ''),
      corpo: { id_operador: alvo.id, data, id_turno: idTurno, versao_linha: atual?.versao_linha ?? null, ajustar_horario: true, entrada: ajust ? entrada : '', saida: ajust ? saida : '' },
    };
  };
  const pausasEditadas = JSON.stringify(lista) !== pausasOrig;
  const heNumero = Number(he) || 0;
  const mudouBase = itemParaSalvar(alvo.data).mudou || (trabalha && pausasEditadas) || (trabalha && heNumero !== heOrig);
  const exigeJust = fechada;
  const podeSalvar = !bloqueio && pausas !== null && !progresso && (mudouBase || escopo !== 'dia') && !errosPausa.some(Boolean)
    && (!trabalha || (entrada && saida && dur > 0)) && (!exigeJust || justificativa.trim());

  const escolherTurno = (t) => {
    setIdTurno(t ? t.id_turno : null);
    setEntrada(t?.entrada || '');
    setSaida(t?.saida || '');
  };
  const mudarPausa = (i, campos) => setPausas(lista.map((p, j) => (j === i ? { ...p, ...campos } : p)));
  const mudarInicio = (i, valor) => mudarPausa(i, { inicio: valor });
  const mudarFim = (i, valor) => mudarPausa(i, { duracao_min: valor ? duracaoMin(lista[i].inicio, valor) : 0 });
  const removerPausa = (i) => setPausas(lista.filter((_, j) => j !== i));
  const adicionarPausa = () => {
    const usadas = new Set(lista.map((p) => p.ordem));
    const ordem = [1, 2, 3, 4, 5, 6].find((o) => !usadas.has(o));
    const base = padroes.find((p) => p.ordem === ordem) || padroes[0] || { tipo: 'DESCANSO', duracao_min: 10 };
    const meio = entrada ? Math.round((aMin(entrada) + Math.floor(dur / 2)) / 5) * 5 : 0;
    setPausas([...lista, { ordem, tipo: base.tipo, inicio: entrada ? deMin(meio) : '', duracao_min: base.duracao_min }]);
  };

  const salvar = async () => {
    const datas = [alvo.data, ...datasEscopo.filter((d) => d !== alvo.data)];
    const preservados = [];
    const alvos = datas.filter((d) => {
      if (d === alvo.data) return true;
      if (turnosPorId[itens.get(`${alvo.id}:${d}`)?.id_turno]?.tipo !== 'TRABALHO') { preservados.push(d); return false; } // DSR/folga não é sobrescrito
      return true;
    });
    const itensEnviar = alvos.map(itemParaSalvar).filter((x) => x.mudou).map((x) => x.corpo);
    const diasPausa = trabalha && pausasEditadas ? alvos : [];
    const total = (itensEnviar.length ? 1 : 0) + diasPausa.length + (trabalha && heNumero !== heOrig ? 1 : 0);
    let feitos = 0;
    const erros = [];
    setFalhas([]);
    setProgresso({ feitos, total });
    const passo = () => { feitos += 1; setProgresso({ feitos, total }); };
    try {
      if (itensEnviar.length) {
        try { await salvarItensEscalaWfm({ operacao, ano_mes: anoMes, itens: itensEnviar, justificativa }); passo(); }
        catch (e) { showToast?.(e?.message || 'Não foi possível salvar o turno.', 'error'); setFalhas([e?.message || 'Não foi possível salvar o turno.']); aoSalvo(false); return; }
      }
      for (const data of diasPausa) {
        try {
          await salvarPausasWfm({ operacao, data, itens: [{ id_operador: alvo.id, pausas: lista.map((p) => ({ ordem: p.ordem, tipo: p.tipo, inicio: p.inicio, duracao_min: p.duracao_min })) }] });
        } catch (e) { erros.push(`${brData(data).slice(0, 5)}: ${e?.message || 'não foi possível salvar as pausas.'}`); }
        passo();
      }
      if (trabalha && heNumero !== heOrig) {
        try { await lancarHoraExtraWfm({ operacao, id_operador: alvo.id, data: alvo.data, minutos: heNumero, observacao: '' }); }
        catch (e) { erros.push(`Hora extra: ${e?.message || 'não foi possível salvar.'}`); }
        passo();
      }
    } finally { setProgresso(null); }
    if (erros.length) {
      setFalhas(erros);
      showToast?.(`Ajuste salvo com ${erros.length} pendência(s). Veja os detalhes na gaveta.`, 'warning');
      aoSalvo(false);
      return;
    }
    const nDias = alvos.length;
    showToast?.(`Ajuste salvo${nDias > 1 ? ` em ${nDias} dia(s)` : ''}${preservados.length ? `; ${preservados.length} dia(s) de DSR preservado(s)` : ''}.`, 'success');
    aoSalvo(true);
  };

  const tituloData = `${SEMANA_LONGA[dow]}, ${brData(alvo.data)}`;
  const nomeDow = PLURAL[dow];
  const opcoesEscopo = [
    ['dia', 'Só este dia'],
    ['semana', `${ARTIGO[dow]} ${nomeDow} deste mês`],
    ['resto', `Do dia ${diaNum} até o fim do mês`],
  ];

  return html`<div class="ea-gaveta-fundo" onMouseDown=${(e) => e.target === e.currentTarget && aoFechar()}>
    <aside class="ea-gaveta" role="dialog" aria-modal="true" aria-labelledby="ea-gaveta-titulo" ref=${caixa}>
      <header class="ea-gaveta-cab">
        <div class="ea-gaveta-tit">
          <span class="ea-rotulo">AJUSTAR DIA</span>
          <h2 id="ea-gaveta-titulo">${alvo.nome}</h2>
          <span class="ea-muted">${tituloData}</span>
        </div>
        <button type="button" class="ea-fechar" aria-label="Fechar" onClick=${aoFechar}><${Icone} nome="close" /></button>
      </header>

      <div class="ea-gaveta-corpo">
        ${bloqueio ? html`<p class="ea-aviso" role="status">${bloqueio}</p>` : null}

        <section class="ea-sec" aria-labelledby="ea-sec-turno">
          <h3 class="ea-sec-rotulo" id="ea-sec-turno">TURNO</h3>
          <div class="ea-turnos-grade" role="radiogroup" aria-labelledby="ea-sec-turno">
            ${selecionaveis.map((t) => html`<button type="button" key=${t.id_turno} role="radio" aria-checked=${idTurno === t.id_turno} data-foco-inicial=${idTurno === t.id_turno ? '' : undefined} title=${t.nome}
              class=${`ea-turno-opcao ${idTurno === t.id_turno ? 'is-ativo' : ''}`} onClick=${() => escolherTurno(t)}><${Quadrado} cor=${t.cor} /><span>${t.nome}</span></button>`)}
            <button type="button" role="radio" aria-checked=${idTurno === null} data-foco-inicial=${idTurno === null ? '' : undefined} class=${`ea-turno-opcao is-dsr ${idTurno === null ? 'is-ativo' : ''}`} onClick=${() => escolherTurno(null)}><${Quadrado} dsr=${true} /><span>DSR</span></button>
          </div>
        </section>

        <fieldset class=${`ea-sec ea-sec--grupo ${trabalha ? '' : 'is-off'}`} disabled=${!trabalha}>
          <legend class="ea-sec-rotulo">HORÁRIO</legend>
          <div class="ea-horario-grade">
            <label class="ea-lab"><span>Início</span><input type="time" class="ea-in" value=${entrada} onInput=${(e) => setEntrada(e.target.value)} /></label>
            <label class="ea-lab"><span>Fim</span><input type="time" class="ea-in" value=${saida} onInput=${(e) => setSaida(e.target.value)} /></label>
            <label class="ea-lab"><span>Hora extra (min)</span><input type="number" min="0" max="720" step="5" inputmode="numeric" class="ea-in" placeholder="min" value=${he} onInput=${(e) => setHe(e.target.value)} /></label>
          </div>
          <p class="ea-ajuda">${trabalha ? `${minutosParaHoras(dur)} de jornada. O horário vem do turno; edite só se este dia for exceção.` : 'Dia sem turno de trabalho: horário, hora extra e pausas ficam desligados.'}</p>
        </fieldset>

        <fieldset class=${`ea-sec ea-sec--grupo ${trabalha ? '' : 'is-off'}`} disabled=${!trabalha} ref=${secaoPausas}>
          <legend class="ea-sec-rotulo ea-sec-rotulo--linha"><span>PAUSAS</span><span class="ea-muted">${pausas === null ? 'carregando…' : `${lista.length} programada${lista.length === 1 ? '' : 's'}`}</span></legend>
          ${trabalha && entrada && dur > 0 && lista.some((p) => p.inicio && p.duracao_min > 0) ? html`<${LinhaTempo} item=${{ entrada, saida, pausas: lista.filter((p) => p.inicio && p.duracao_min > 0) }} />` : null}
          ${lista.length ? html`<ul class="ea-pausas">${lista.map((p, i) => html`<li key=${p.ordem} class=${errosPausa[i] ? 'has-erro' : ''}>
            <div class="ea-pausa-linha">
              <span class="ea-ponto" aria-hidden="true"></span>
              <span class="ea-pausa-nome">${nomePausa(p, i)}</span>
              <span class="ea-pausa-int">
                <input type="time" class="ea-in ea-in--sm" aria-label=${`Início da pausa ${i + 1}`} value=${p.inicio} onInput=${(e) => mudarInicio(i, e.target.value)} />
                <span aria-hidden="true">–</span>
                <input type="time" class="ea-in ea-in--sm" aria-label=${`Fim da pausa ${i + 1}`} value=${p.inicio ? deMin(aMin(p.inicio) + p.duracao_min) : ''} onInput=${(e) => mudarFim(i, e.target.value)} />
              </span>
              <button type="button" class="ea-lixeira" aria-label=${`Remover pausa ${i + 1}`} onClick=${() => removerPausa(i)}><${Icone} nome="delete" /></button>
            </div>
            ${errosPausa[i] ? html`<p class="ea-erro" role="alert">${errosPausa[i]}</p>` : null}
          </li>`)}</ul>` : null}
          <button type="button" class="ea-adicionar" disabled=${lista.length >= MAX_PAUSAS || pausas === null} onClick=${adicionarPausa}><${Icone} nome="add" />Adicionar pausa</button>
        </fieldset>

        <section class="ea-sec" aria-labelledby="ea-sec-aplicar">
          <h3 class="ea-sec-rotulo" id="ea-sec-aplicar">APLICAR EM</h3>
          <div class="ea-radios" role="radiogroup" aria-labelledby="ea-sec-aplicar">
            ${opcoesEscopo.map(([valor, rotulo]) => html`<label key=${valor} class=${`ea-radio ${escopo === valor ? 'is-ativo' : ''}`}>
              <input type="radio" name="ea-escopo" checked=${escopo === valor} onChange=${() => setEscopo(valor)} />${rotulo}</label>`)}
          </div>
          ${escopo !== 'dia' ? html`<p class="ea-ajuda">Turno e horário valem para ${datasEscopo.length} dia(s); dias de DSR não são sobrescritos. A hora extra vale só para este dia.</p>` : null}
        </section>

        ${exigeJust ? html`<label class="ea-lab"><span>Justificativa (período fechado, obrigatória)</span><input class="ea-in" maxlength="400" value=${justificativa} onInput=${(e) => setJustificativa(e.target.value)} /></label>` : null}
        ${falhas.length ? html`<ul class="ea-falhas" role="alert">${falhas.map((f, i) => html`<li key=${i}>${f}</li>`)}</ul>` : null}
      </div>

      <footer class="ea-gaveta-rodape">
        <button type="button" class="btn btn-outline-secondary" onClick=${aoFechar}>Cancelar</button>
        <button type="button" class="btn btn-primary" disabled=${!podeSalvar} onClick=${salvar}>${progresso ? `Salvando… ${progresso.total > 1 ? `${progresso.feitos}/${progresso.total}` : ''}` : 'Salvar alteração'}</button>
      </footer>
    </aside>
  </div>`;
}
