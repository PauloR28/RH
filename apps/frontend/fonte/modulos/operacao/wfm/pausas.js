import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { aplicarPausasWfm, definirCapacidadePausasWfm, distribuirPausasWfm, lerEscalaWfm, lerPausasDiaWfm, salvarPausasWfm } from '../../../services/api/wfm.js?v=20261026-trocas';
import { ModalForm } from './formulario.js';
import { CheckTodos, FiltrosCompactos, Icone, LinhaContexto, SeletorVisao, aMin, brData, deMin, doIso, paraIso, semAcento } from './escala-ui.js?v=20261023-ajustes';

// Aba "Pausas" da escala: as 3 pausas de cada colaborador escalado no dia (2 de 10 min e 1 de 20 min, todas contadas
// como jornada). Define horários à mão — por colaborador, em lote, por equipe ou por turno — e aplica ao dia, à semana ou
// ao mês; mostra a tabela com filtros e a visão macro (Gantt). Exceder o limite de colaboradores em pausa ao mesmo tempo
// é aviso (não bloqueio). Pausas emergenciais (banheiro, feedback...) não entram aqui. Estilos: bloco `.pa-*` em wfm.css.

const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const SEMANA_CURTA_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA_CURTA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const TODOS_DIAS = [true, true, true, true, true, true, true];
const ROTULO_TIPO = { DESCANSO: 'Descanso', REFEICAO: 'Refeição' };
const PASSO = 5;

// Linha do tempo do turno em minutos desde 00:00 do dia em que ele começa (turno que vira a noite passa de 1440).
const janela = (turno) => { const ini = aMin(turno.entrada); const fim = aMin(turno.saida); return [ini, fim <= ini ? fim + 1440 : fim]; };
const desenrolar = (hhmm, ini) => { const t = aMin(hhmm); return t < ini ? t + 1440 : t; };

// Período atingido: só o dia, a semana (seg–dom) ou o mês inteiro, sempre dentro do mês aberto.
function periodoDe(escopo, dia, anoMes) {
  const [a, m] = anoMes.split('-').map(Number);
  const ultimo = paraIso(new Date(a, m, 0));
  if (escopo === 'dia') return [dia, dia];
  if (escopo === 'mes') return [`${anoMes}-01`, ultimo];
  const base = doIso(dia);
  const seg = new Date(base); seg.setDate(seg.getDate() - ((base.getDay() + 6) % 7));
  const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
  const ini = paraIso(seg); const fim = paraIso(dom);
  return [ini < `${anoMes}-01` ? `${anoMes}-01` : ini, fim > ultimo ? ultimo : fim];
}

const diasEscolhidos = (escopo, dias) => (escopo === 'dia' ? null : dias.map((v, i) => (v ? i : null)).filter((i) => i !== null));

const FILTROS_RAPIDOS = [['todos', 'Todos'], ['sem', 'Sem pausas'], ['nao', 'Não salvas']];

export function TelaEscalaPausas({ controlador, contexto, operacao, anoMes, showToast, aoDia, aoMes, aoVoltarLista, aoMudarMes, aoTrocarEscala, opcoesEscala = null }) {
  const [dia, setDia] = useState(() => { const hoje = paraIso(new Date()); return hoje.startsWith(anoMes) ? hoje : `${anoMes}-01`; });
  const [dados, setDados] = useState(null);
  const [escala, setEscala] = useState(null);
  const [erro, setErro] = useState('');
  const [edicao, setEdicao] = useState({});            // id_operador -> pausas editadas (pendentes de salvar)
  const [sel, setSel] = useState({});
  const [busca, setBusca] = useState('');
  const [filtroTurno, setFiltroTurno] = useState('');
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroSup, setFiltroSup] = useState('');
  const [filtroHora, setFiltroHora] = useState('');
  const [rapido, setRapido] = useState('todos');       // 'todos' | 'sem' | 'nao'
  const [visao, setVisao] = useState('tabela');        // 'tabela' | 'gantt'
  const [ocupado, setOcupado] = useState(false);
  const [duplicando, setDuplicando] = useState(null);  // colaborador de origem
  const podeEditar = controlador.possuiPermissao('wfm.escala.editar');
  const podeCapacidade = controlador.possuiPermissao('wfm.cadastros.editar');

  useEffect(() => { if (!dia.startsWith(anoMes)) setDia(`${anoMes}-01`); }, [anoMes]);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const d = await lerPausasDiaWfm(operacao, dia);
      setDados(d); setEdicao({}); setSel({});
    } catch (e) { setDados(null); setErro(e?.message || 'Não foi possível carregar as pausas.'); }
  }, [operacao, dia]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  useEffect(() => {
    let vivo = true;
    setEscala(null);
    lerEscalaWfm(operacao, anoMes).then((e) => { if (vivo) setEscala(e); }).catch(() => {});
    return () => { vivo = false; };
  }, [operacao, anoMes]);

  const executar = async (fn, sucesso) => {
    setOcupado(true);
    try {
      const r = await fn();
      showToast?.(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
      await carregar();
      return true;
    } catch (e) { showToast?.(e?.message || 'Não foi possível concluir.', 'error'); return false; } finally { setOcupado(false); }
  };

  const operadores = dados?.operadores || [];
  const semEscala = dados?.sem_escala || [];
  const capacidade = dados?.capacidade || 1;
  const pausasDe = (op) => edicao[op.id_operador] || op.pausas;
  const alteradas = Object.keys(edicao).length;

  // ---- filtros -----------------------------------------------------------------------------------------------
  const turnos = useMemo(() => [...new Map(operadores.map((o) => [o.turno.codigo, o.turno])).values()], [operadores]);
  const equipes = useMemo(() => [...new Map([...operadores, ...semEscala].filter((o) => o.id_equipe).map((o) => [o.id_equipe, o.equipe])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [operadores, semEscala]);
  const supervisores = useMemo(() => [...new Map([...operadores, ...semEscala].flatMap((o) => o.supervisores || []).map((s) => [s.id_usuario, s.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [operadores, semEscala]);
  const horas = useMemo(() => [...new Set(operadores.flatMap((o) => (edicao[o.id_operador] || o.pausas).map((p) => p.inicio.slice(0, 2))))].sort(), [operadores, edicao]);
  const passaBasico = (o) => {
    const q = semAcento(busca);
    return (!q || semAcento(o.nome).includes(q)) && (!filtroEquipe || String(o.id_equipe) === filtroEquipe)
      && (!filtroSup || (o.supervisores || []).some((s) => String(s.id_usuario) === filtroSup));
  };
  const baseEscalados = useMemo(() => operadores.filter((o) => passaBasico(o) && (!filtroTurno || o.turno.codigo === filtroTurno)
    && (!filtroHora || (edicao[o.id_operador] || o.pausas).some((p) => p.inicio.slice(0, 2) === filtroHora))), [operadores, edicao, busca, filtroTurno, filtroEquipe, filtroSup, filtroHora]);
  const baseSem = useMemo(() => (filtroTurno || filtroHora ? [] : semEscala.filter(passaBasico)), [semEscala, busca, filtroTurno, filtroEquipe, filtroSup, filtroHora]);
  const nSem = baseEscalados.filter((o) => !(edicao[o.id_operador] || o.pausas).length).length;
  const nNao = baseEscalados.filter((o) => edicao[o.id_operador]).length;
  const visiveis = baseEscalados.filter((o) => rapido === 'todos' || (rapido === 'sem' ? !(edicao[o.id_operador] || o.pausas).length : !!edicao[o.id_operador]));
  const visiveisSem = rapido === 'todos' ? baseSem : [];

  // ---- ocupação (inclui o que está editado e ainda não salvo): alimenta o aviso, o Gantt e o anel de conflito ---------
  const { ocup, excedentes, emConflito } = useMemo(() => {
    const mapa = new Map();
    for (const o of operadores) {
      const [ini] = janela(o.turno);
      for (const p of (edicao[o.id_operador] || o.pausas)) {
        if (!p.inicio) continue;
        const i = desenrolar(p.inicio, ini);
        for (let m = i - (i % PASSO); m < i + p.duracao_min; m += PASSO) if (m + PASSO > i) mapa.set(m, (mapa.get(m) || 0) + 1);
      }
    }
    const lim = dados?.capacidade || 1;
    const faixas = [];
    for (const [m, q] of [...mapa.entries()].sort((a, b) => a[0] - b[0])) {
      if (q <= lim) continue;
      const ult = faixas[faixas.length - 1];
      if (ult && ult.fim === m && ult.qtd === q) ult.fim = m + PASSO; else faixas.push({ ini: m, fim: m + PASSO, qtd: q });
    }
    const conflito = new Set();
    for (const o of operadores) {
      const [ini] = janela(o.turno);
      for (const p of (edicao[o.id_operador] || o.pausas)) {
        if (!p.inicio) continue;
        const i = desenrolar(p.inicio, ini);
        for (let m = i - (i % PASSO); m < i + p.duracao_min; m += PASSO) if ((mapa.get(m) || 0) > lim) conflito.add(`${o.id_operador}:${p.ordem}`);
      }
    }
    return { ocup: mapa, excedentes: faixas, emConflito: conflito };
  }, [operadores, edicao, dados]);
  const opsEmConflito = new Set([...emConflito].map((k) => k.split(':')[0])).size;

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando as pausas" />`;

  const mover = (n) => { const d = doIso(dia); d.setDate(d.getDate() + n); const iso = paraIso(d); if (iso.startsWith(anoMes)) setDia(iso); };
  const mudar = (op, ordem, valor) => {
    const base = pausasDe(op).map((p) => ({ ...p }));
    setEdicao({ ...edicao, [op.id_operador]: base.map((p) => (p.ordem === ordem ? { ...p, inicio: valor } : p)) });
  };
  const iniciar = (op) => setEdicao({ ...edicao, [op.id_operador]: dados.pausas_padrao.map((p) => ({ ordem: p.ordem, tipo: p.tipo, inicio: op.turno.entrada, duracao_min: p.duracao_min })) });
  const salvar = () => executar(
    () => salvarPausasWfm({ operacao, data: dia, itens: Object.entries(edicao).map(([id, pausas]) => ({ id_operador: Number(id), pausas })) }),
    'Pausas salvas.',
  );
  const alterarCapacidade = async (n) => {
    if (!podeCapacidade || n < 1 || n > 200 || n === capacidade) return;
    try { await definirCapacidadePausasWfm({ operacao, pausas_simultaneas: n }); setDados((d) => ({ ...d, capacidade: n })); }
    catch (e) { showToast?.(e?.message || 'Não foi possível alterar o limite.', 'error'); }
  };
  const distribuirConflito = async () => {
    if (alteradas && !window.confirm('Há alterações não salvas: distribuir recarrega a tela e as descarta. Continuar?')) return;
    const ids = operadores.filter((o) => o.pausas.length).map((o) => o.id_operador);
    await executar(() => distribuirPausasWfm({ operacao, data: dia, ids, sobrescrever: true }), 'Pausas distribuídas respeitando o limite de colaboradores em pausa ao mesmo tempo.');
  };
  const marcados = visiveis.filter((o) => sel[o.id_operador]);
  const todosSel = visiveis.length > 0 && marcados.length === visiveis.length;
  const alternarTodos = () => setSel(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_operador, true])));
  const nomeEscala = escala?.nome_escala || opcoesEscala?.find(([c]) => c === operacao)?.[1] || operacao;
  const d0 = doIso(dia);
  const hojeIso = paraIso(new Date());
  const ultimoDia = paraIso(new Date(Number(anoMes.slice(0, 4)), Number(anoMes.slice(5)), 0));
  const totalColab = operadores.length + semEscala.length;
  const resumoAplicacao = (r) => `${r.pausas_gravadas} colaborador(es)/dia gravado(s) em ${r.dias_programados} dia(s)`
    + `${r.ignoradas ? `; ${r.ignoradas} fora do turno do dia (ignorado)` : ''}${r.mantidas ? `; ${r.mantidas} mantido(s) sem substituir` : ''}`
    + `${r.dias_com_excesso ? `. Atenção: ${r.dias_com_excesso} dia(s) passam do limite de ${r.capacidade} em pausa ao mesmo tempo.` : '.'}`;
  // "Aplicar" no dia aberto: as pausas ficam como alteração não salva (Salvar pausas grava); os demais períodos gravam no servidor.
  const enfileirar = (ids, pausas, sobrescrever) => {
    const novo = { ...edicao }; let ok = 0; let fora = 0; let mantidas = 0;
    for (const id of ids) {
      const op = operadores.find((o) => o.id_operador === id);
      if (!op) continue;
      if (!sobrescrever && pausasDe(op).length) { mantidas += 1; continue; }
      const [ini, fim] = janela(op.turno);
      if (!pausas.every((p) => { const m = desenrolar(p.inicio, ini); return m >= ini && m + p.duracao_min <= fim; })) { fora += 1; continue; }
      novo[id] = pausas.map((p) => ({ ...p })); ok += 1;
    }
    setEdicao(novo);
    showToast?.(`${ok} colaborador(es) com pausas definidas (não salvas)${fora ? `; ${fora} com horário fora do turno (ignorado)` : ''}${mantidas ? `; ${mantidas} mantido(s) sem substituir` : ''}.`, ok ? 'success' : 'error');
  };
  const nTabelaCols = dados.pausas_padrao.length;

  return html`
    <${LinhaContexto} nome=${nomeEscala} operacao=${operacao} operacoes=${opcoesEscala} aoTrocarEscala=${aoTrocarEscala} anoMes=${anoMes} aoMudarMes=${aoMudarMes} ocultarEscala=${(contexto?.operacoes || []).length <= 1}
      escalados=${operadores.length} emDsr=${semEscala.length}
      versao=${escala?.status?.versao_publicada || 0} aoVoltarLista=${aoVoltarLista} />

    <section class="mo-card-escala cx-cresce pa-card" aria-label="Pausas">
      <div class="mo-barra cx-fixo">
        <${SeletorVisao} visao="pausas" aoDia=${aoDia} aoMes=${aoMes} />
        <div class="ea-dia-nav" role="group" aria-label="Escolher o dia">
          <button type="button" class="ea-icone-btn" aria-label="Dia anterior" title="Dia anterior" disabled=${dia <= `${anoMes}-01`} onClick=${() => mover(-1)}><${Icone} nome="chevron_left" /></button>
          <label class="ea-data"><${Icone} nome="calendar_month" /><span class="ea-num">${SEMANA_CURTA_DIA[d0.getDay()]} · ${brData(dia)}</span>
            <input class="ea-data-input" type="date" aria-label="Escolher data" onClick=${(e) => e.target.showPicker?.()} value=${dia} min=${`${anoMes}-01`} max=${ultimoDia} onChange=${(e) => e.target.value && e.target.value.startsWith(anoMes) && setDia(e.target.value)} /></label>
          <button type="button" class="ea-icone-btn" aria-label="Próximo dia" title="Próximo dia" disabled=${dia >= ultimoDia} onClick=${() => mover(1)}><${Icone} nome="chevron_right" /></button>
          <button type="button" class="mo-btn mo-btn--neutro mo-btn--34" disabled=${!hojeIso.startsWith(anoMes) || dia === hojeIso} onClick=${() => setDia(hojeIso)}>Hoje</button>
        </div>
        <div class="pa-barra-fim">
          <span class="pa-ver-como" id="pa-ver-como">Ver como</span>
          <div class="ea-visao" role="group" aria-labelledby="pa-ver-como">
            <button type="button" class=${visao === 'tabela' ? 'is-ativo' : ''} aria-pressed=${visao === 'tabela'} onClick=${() => setVisao('tabela')}>Tabela</button>
            <button type="button" class=${visao === 'gantt' ? 'is-ativo' : ''} aria-pressed=${visao === 'gantt'} onClick=${() => setVisao('gantt')}>Visão macro</button>
          </div>
        </div>
      </div>

      <div class="mo-barra mo-barra--filtros cx-fixo"><${FiltrosCompactos} rotuloBusca="Buscar colaborador" busca=${busca} aoBuscar=${setBusca}
        contagem=${`${visiveis.length + visiveisSem.length} de ${totalColab} colaborador(es)`}
        meio=${html`<div class="ea-visao pa-rapido" role="group" aria-label="Filtro rápido">${FILTROS_RAPIDOS.map(([id, rotulo]) => html`<button key=${id} type="button" class=${rapido === id ? 'is-ativo' : ''} aria-pressed=${rapido === id} onClick=${() => setRapido(id)}>${rotulo} (${id === 'todos' ? baseEscalados.length + baseSem.length : id === 'sem' ? nSem : nNao})</button>`)}</div>`}
        selects=${[
          { rotulo: 'Turno', padrao: 'Turno: todos', valor: filtroTurno, aoMudar: setFiltroTurno, largura: 'm', opcoes: turnos.map((t) => [t.codigo, t.codigo]) },
          { rotulo: 'Horário da pausa', padrao: 'Horário: todos', valor: filtroHora, aoMudar: setFiltroHora, largura: 'm', opcoes: horas.map((h) => [h, `${h}h`]) },
          { rotulo: 'Equipe', padrao: 'Equipe: todas', valor: filtroEquipe, aoMudar: setFiltroEquipe, largura: 'm', opcoes: equipes.map(([id, nome]) => [String(id), nome]) },
          { rotulo: 'Supervisor', padrao: 'Supervisor: todos', valor: filtroSup, aoMudar: setFiltroSup, largura: 'g', opcoes: supervisores.map(([id, nome]) => [String(id), nome]) },
        ]} /></div>

      <div class="pa-corpo">
        <div class="pa-principal">
          ${excedentes.length ? html`<div class="pa-aviso" role="status">
            <span class="pa-aviso-txt"><${Icone} nome="warning" /><span><strong>${opsEmConflito} colaborador(es)</strong> com pausa ao mesmo tempo (limite ${capacidade}). Ajuste os horários ou deixe o sistema distribuir.</span></span>
            ${podeEditar ? html`<button type="button" class="mo-btn mo-btn--neutro mo-btn--34" disabled=${ocupado} onClick=${distribuirConflito}>Distribuir automaticamente</button>` : null}</div>` : null}

          ${!operadores.length && !semEscala.length
            ? html`<${EmptyState} icon="schedule" title="Ninguém neste dia" text="Não há colaboradores nesta escala. Monte a escala de turnos primeiro." />`
            : visao === 'gantt'
              ? html`<${Gantt} linhas=${visiveis} pausasDe=${pausasDe} ocup=${ocup} capacidade=${capacidade} emConflito=${emConflito} />`
              : html`<div class="ea-rolagem mo-rolagem pa-rolagem" role="region" aria-label="Pausas do dia" tabindex="0">
              <table class=${`ea-tab pa-tab ${podeEditar ? 'ea-tab--sel' : ''}`}>
                <colgroup>${podeEditar ? html`<col style=${{ width: '44px' }} />` : null}<col /><col style=${{ width: '184px' }} />${dados.pausas_padrao.map((p) => html`<col key=${p.ordem} style=${{ width: '144px' }} />`)}${podeEditar ? html`<col style=${{ width: '96px' }} />` : null}</colgroup>
                <thead><tr>
                  ${podeEditar ? html`<th scope="col" class="ea-c-sel"><${CheckTodos} rotulo="Selecionar todos os colaboradores" total=${visiveis.length} marcados=${marcados.length} aoAlternar=${alternarTodos} /></th>` : null}
                  <th scope="col" class="ea-c-nome">Colaborador</th><th scope="col">Turno</th>
                  ${dados.pausas_padrao.map((p) => html`<th scope="col" key=${p.ordem}>Pausa ${p.ordem} · ${p.duracao_min} min</th>`)}
                  ${podeEditar ? html`<th scope="col">Ações</th>` : null}
                </tr></thead>
                <tbody>
                  ${visiveis.map((op) => { const pausas = pausasDe(op); const pend = !!edicao[op.id_operador]; const conf = pausas.some((p) => emConflito.has(`${op.id_operador}:${p.ordem}`));
                    return html`<tr key=${op.id_operador} class=${`${pend ? 'is-pendente' : ''} ${conf ? 'is-conflito' : ''} ${sel[op.id_operador] ? 'is-sel' : ''}`}>
                    ${podeEditar ? html`<td class="ea-c-sel"><input type="checkbox" class="ea-check" aria-label=${`Selecionar ${op.nome}`} checked=${!!sel[op.id_operador]} onChange=${() => setSel({ ...sel, [op.id_operador]: !sel[op.id_operador] })} /></td>` : null}
                    <td class="ea-c-nome"><strong class="pa-nome">${op.nome}</strong><small class="pa-sub">${[op.equipe, (op.supervisores || []).map((s) => s.nome).join(', ')].filter(Boolean).join(' · ') || '—'}</small>${op.erros.length ? html`<small class="wfm-alerta-txt">${op.erros[0]}</small>` : null}</td>
                    <td><span class="pa-turno"><strong>${op.turno.codigo}</strong><span class="ea-muted ea-num">${op.turno.entrada}–${op.turno.saida} · ${op.turno.dias_rotulo}</span></span></td>
                    ${dados.pausas_padrao.map((padrao) => { const p = pausas.find((x) => x.ordem === padrao.ordem);
                      return html`<td key=${padrao.ordem}>${p
                        ? (podeEditar ? html`<input class="ea-campo pa-hora" type="time" step="300" aria-label=${`${op.nome}, pausa ${padrao.ordem}`} value=${p.inicio} onInput=${(e) => mudar(op, padrao.ordem, e.target.value)} />` : html`<strong class="ea-num">${p.inicio}</strong>`)
                        : (podeEditar && padrao.ordem === 1 ? html`<button type="button" class="wfm-link" onClick=${() => iniciar(op)}>Definir manualmente</button>` : html`<span class="ea-muted">—</span>`)}</td>`; })}
                    ${podeEditar ? html`<td><button type="button" class="ea-btn-ctn" disabled=${!pausas.length || pend} title=${pend ? 'Salve as alterações antes de duplicar.' : 'Copiar estas pausas para outros colaboradores'} onClick=${() => setDuplicando(op)}>Duplicar</button></td>` : null}
                  </tr>`; })}
                  ${visiveisSem.map((op) => html`<tr key=${`s${op.id_operador}`} class="is-sem-escala">
                    ${podeEditar ? html`<td class="ea-c-sel"><input type="checkbox" class="ea-check" disabled aria-label=${`${op.nome} está sem escala neste dia`} /></td>` : null}
                    <td class="ea-c-nome"><strong class="pa-nome">${op.nome}</strong><small class="pa-sub">${[op.equipe, (op.supervisores || []).map((s) => s.nome).join(', ')].filter(Boolean).join(' · ') || '—'}</small></td>
                    <td><span class="pa-turno"><strong>SEM ESCALA</strong><span class="ea-muted">${op.motivo}</span></span></td>
                    <td class="pa-sem-txt" colspan=${nTabelaCols}>Sem escala · sem pausa</td>
                    ${podeEditar ? html`<td><span class="ea-muted">—</span></td>` : null}
                  </tr>`)}
                  ${visiveis.length + visiveisSem.length ? null : html`<tr><td class="ea-vazio" colspan=${(podeEditar ? 3 : 2) + nTabelaCols + (podeEditar ? 0 : 0)}>Nenhum colaborador encontrado com estes filtros.</td></tr>`}
                </tbody>
              </table>
            </div>`}
        </div>

        ${podeEditar ? html`<${PainelDefinir} dia=${dia} anoMes=${anoMes} dados=${dados} operadores=${operadores} semEscala=${semEscala} marcados=${marcados} turnos=${turnos} equipes=${equipes}
          ocupado=${ocupado} executar=${executar} operacao=${operacao} resumoAplicacao=${resumoAplicacao} enfileirar=${enfileirar}
          capacidade=${capacidade} podeCapacidade=${podeCapacidade} aoCapacidade=${alterarCapacidade} />` : null}
      </div>

      ${podeEditar ? html`<footer class="mo-rodape cx-fixo pa-rodape">
        <div class="mo-rodape-esq"><span class=${`pa-ponto ${alteradas ? 'is-pendente' : ''}`} aria-hidden="true"></span><span class="mo-rodape-txt">${alteradas ? `${alteradas} colaborador(es) com alteração não salva` : 'Nenhuma alteração pendente'}</span></div>
        <div class="mo-rodape-dir">
          <button type="button" class="btn btn-outline-secondary" disabled=${!alteradas} onClick=${() => setEdicao({})}>Descartar</button>
          <button type="button" class="btn btn-primary" disabled=${ocupado || !alteradas} onClick=${salvar}>Salvar pausas (${alteradas})</button>
        </div></footer>` : null}
    </section>

    ${duplicando ? html`<${ModalDuplicar} origem=${duplicando} pausas=${pausasDe(duplicando)} dia=${dia} anoMes=${anoMes} operadores=${operadores} operacao=${operacao}
      executar=${executar} resumoAplicacao=${resumoAplicacao} aoFechar=${() => setDuplicando(null)} />` : null}`;
}

const QUANDO = {
  escala: ['Aplicar na escala', 'Segue os dias do turno de cada colaborador', 'Cada colaborador recebe as pausas só nos dias do seu turno (no mês aberto).'],
  dia: ['Só este dia', 'Apenas o dia aberto na tela', 'Fica como alteração não salva até você usar Salvar pausas.'],
  semana: ['Toda a semana', 'Segunda a domingo, só onde há escala', 'Quem não tem escala em um dia da semana não recebe pausa nele.'],
  mes: ['Todo o mês', 'Do dia 1 ao último, só onde há escala', 'Quem não tem escala em um dia não recebe pausa nele.'],
  personalizar: ['Personalizar', 'Escolher os dias da semana', 'Só os dias marcados, no mês aberto e onde há escala.'],
};

// Painel lateral "Definir pausas" (sempre aberto): 1. Quem recebe · 2. Horários · 3. Quando. Quem está sem escala no dia fica fora.
function PainelDefinir({ dia, anoMes, dados, operadores, semEscala, marcados, turnos, equipes, ocupado, executar, operacao, resumoAplicacao, enfileirar, capacidade, podeCapacidade, aoCapacidade }) {
  const [horarios, setHorarios] = useState(() => dados.pausas_padrao.map(() => ''));
  const [alvo, setAlvo] = useState('selecionados'); // 'selecionados' | 'equipe' | 'turno'
  const [equipe, setEquipe] = useState('');
  const [turno, setTurno] = useState('');
  const [quando, setQuando] = useState('escala');
  const [dias, setDias] = useState([true, true, true, true, true, false, false]);
  const [sobrescrever, setSobrescrever] = useState(true);
  const ids = alvo === 'selecionados' ? marcados.map((o) => o.id_operador)
    : alvo === 'equipe' ? (equipe ? operadores.filter((o) => String(o.id_equipe) === equipe).map((o) => o.id_operador) : [])
      : (turno ? operadores.filter((o) => o.turno.codigo === turno).map((o) => o.id_operador) : []);
  const semNoAlvo = alvo === 'equipe' && equipe ? semEscala.filter((o) => String(o.id_equipe) === equipe).length : 0;
  const completo = horarios.every(Boolean);
  const [ano, mes] = anoMes.split('-').map(Number);
  const ultimo = paraIso(new Date(ano, mes, 0));
  const periodo = quando === 'dia' ? [dia, dia] : quando === 'semana' ? periodoDe('semana', dia, anoMes) : [`${anoMes}-01`, ultimo];
  const diasSemana = quando === 'personalizar' ? dias.map((v, i) => (v ? i : null)).filter((i) => i !== null) : null;
  const semDiasPersonalizados = quando === 'personalizar' && !diasSemana.length;
  const pausas = dados.pausas_padrao.map((p, i) => ({ ordem: p.ordem, tipo: p.tipo, inicio: horarios[i], duracao_min: p.duracao_min }));
  const semAlvo = !ids.length;
  const aplicar = () => {
    if (quando === 'dia') { enfileirar(ids, pausas, sobrescrever); return undefined; }
    return executar(() => aplicarPausasWfm({ operacao, data_ini: periodo[0], data_fim: periodo[1], ids, pausas, dias_semana: diasSemana, sobrescrever }), resumoAplicacao);
  };
  const distribuir = () => executar(
    () => distribuirPausasWfm({ operacao, data: periodo[0], ids, sobrescrever, ...(quando === 'dia' ? {} : { data_fim: periodo[1], dias_semana: diasSemana }) }),
    'Pausas distribuídas respeitando o limite de colaboradores em pausa ao mesmo tempo.',
  );
  const ajuda = alvo === 'selecionados' ? (marcados.length ? `${marcados.length} selecionado(s) com escala.` : 'Marque os colaboradores na tabela.')
    : alvo === 'equipe' ? (equipe ? `${equipes.find(([id]) => String(id) === equipe)?.[1] || 'Equipe'} · ${ids.length} com escala${semNoAlvo ? ` (${semNoAlvo} sem escala ficam de fora)` : ''}.` : 'Escolha a equipe.')
      : (turno ? `Turno ${turno} · ${ids.length} com escala.` : 'Escolha o turno.');
  const aviso = alvo === 'selecionados' && !marcados.length;
  return html`<aside class="pa-lado" aria-label="Definir pausas">
    <div class="pa-lado-corpo">
      <section class="pa-passo" aria-labelledby="pa-p1">
        <h3 id="pa-p1"><span class="pa-num" aria-hidden="true">1</span>Quem recebe</h3>
        <div class="ea-visao pa-seg" role="group" aria-label="Quem recebe os horários">
          ${[['selecionados', `Selecionados (${marcados.length})`], ['equipe', 'Equipe'], ['turno', 'Turno']].map(([id, rotulo]) => html`<button key=${id} type="button" class=${alvo === id ? 'is-ativo' : ''} aria-pressed=${alvo === id} onClick=${() => setAlvo(id)}>${rotulo}</button>`)}
        </div>
        ${alvo === 'equipe' ? html`<select class="ea-campo pa-campo-cheio" aria-label="Equipe" value=${equipe} onChange=${(e) => setEquipe(e.target.value)}><option value="">Escolha…</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select>` : null}
        ${alvo === 'turno' ? html`<select class="ea-campo pa-campo-cheio" aria-label="Turno" value=${turno} onChange=${(e) => setTurno(e.target.value)}><option value="">Escolha…</option>${turnos.map((t) => html`<option key=${t.codigo} value=${t.codigo}>${t.codigo} · ${t.entrada}–${t.saida}</option>`)}</select>` : null}
        <p class=${`pa-ajuda ${aviso ? 'is-aviso' : ''}`}>${ajuda}</p>
      </section>

      <section class="pa-passo" aria-labelledby="pa-p2">
        <h3 id="pa-p2"><span class="pa-num" aria-hidden="true">2</span>Horários</h3>
        ${dados.pausas_padrao.map((p, i) => html`<label key=${p.ordem} class="pa-linha-hora"><span>Pausa ${p.ordem} · ${ROTULO_TIPO[p.tipo]} ${p.duracao_min} min</span>
          <input class="ea-campo pa-hora" type="time" step="300" value=${horarios[i]} onInput=${(e) => setHorarios(horarios.map((h, j) => (j === i ? e.target.value : h)))} /></label>`)}
      </section>

      <section class="pa-passo" aria-labelledby="pa-p3">
        <h3 id="pa-p3"><span class="pa-num" aria-hidden="true">3</span>Quando</h3>
        <select class="ea-campo pa-campo-cheio" aria-label="Quando aplicar" value=${quando} onChange=${(e) => setQuando(e.target.value)}>
          ${Object.entries(QUANDO).map(([id, [rotulo]]) => html`<option key=${id} value=${id}>${rotulo}</option>`)}</select>
        <p class="pa-quando-desc"><strong>${QUANDO[quando][0]}</strong> · ${QUANDO[quando][1]}</p>
        <p class="pa-ajuda">${QUANDO[quando][2]}</p>
        ${quando === 'personalizar' ? html`<div class="pa-dias" role="group" aria-label="Dias da semana atingidos">${SEMANA_CURTA.map((nome, i) => html`<button key=${nome} type="button" role="checkbox" aria-checked=${dias[i]} class=${`pa-dia ${dias[i] ? 'is-marcado' : ''}`} onClick=${() => setDias(dias.map((v, j) => (j === i ? !v : v)))}>${nome}</button>`)}</div>` : null}
        <label class="wfm-check pa-sobrescrever"><input type="checkbox" checked=${sobrescrever} onChange=${(e) => setSobrescrever(e.target.checked)} /> Substituir pausas já programadas</label>
      </section>
    </div>

    <div class="pa-lado-fim">
      <button type="button" class="btn btn-primary pa-aplicar" disabled=${ocupado || semAlvo || !completo || semDiasPersonalizados} onClick=${aplicar}>${semAlvo ? 'Escolha quem recebe os horários' : `Aplicar a ${ids.length} colaborador(es)`}</button>
      ${!semAlvo && !completo ? html`<p class="pa-ajuda">Preencha os três horários.</p>` : null}
      ${semDiasPersonalizados ? html`<p class="pa-ajuda is-aviso">Marque pelo menos um dia da semana.</p>` : null}
      <button type="button" class="btn btn-outline-secondary pa-distribuir" disabled=${ocupado || semAlvo || semDiasPersonalizados} onClick=${distribuir} title="Em vez de horários fixos, distribui as pausas automaticamente respeitando o limite simultâneo">Distribuir automaticamente</button>
      <div class="pa-limite-linha"><span id="pa-limite-r">Máx. de pessoas em pausa juntas</span>
        <span class="pa-stepper" role="group" aria-labelledby="pa-limite-r">
          <button type="button" aria-label="Diminuir o limite" disabled=${!podeCapacidade || capacidade <= 1} onClick=${() => aoCapacidade(capacidade - 1)}>−</button>
          <output aria-live="polite">${capacidade}</output>
          <button type="button" aria-label="Aumentar o limite" disabled=${!podeCapacidade || capacidade >= 200} onClick=${() => aoCapacidade(capacidade + 1)}>+</button></span></div>
    </div>
  </aside>`;
}

function SeletorPeriodo({ escopo, aoEscopo, dias, aoDias, rotuloDia }) {
  return html`<div class="pa-periodo">
    <label class="wfm-campo"><span>Aplicar em</span><select class="form-select" value=${escopo} onChange=${(e) => aoEscopo(e.target.value)}>
      <option value="dia">Só ${rotuloDia}</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select></label>
    ${escopo !== 'dia' ? html`<span class="wfm-dias-chips" role="group" aria-label="Dias da semana atingidos">${SEMANA_CURTA.map((nome, i) => html`<button key=${nome} type="button" class=${`wfm-dia-chip ${dias[i] ? 'is-ativo' : ''}`} aria-pressed=${dias[i]} onClick=${() => aoDias(dias.map((v, j) => (j === i ? !v : v)))}>${nome}</button>`)}</span>` : null}
  </div>`;
}

// Duplicar as pausas de um colaborador para outros (neste dia, na semana ou no mês).
function ModalDuplicar({ origem, pausas, dia, anoMes, operadores, operacao, executar, resumoAplicacao, aoFechar }) {
  const [destinos, setDestinos] = useState({});
  const [busca, setBusca] = useState('');
  const [escopo, setEscopo] = useState('dia');
  const [dias, setDias] = useState(TODOS_DIAS);
  const [sobrescrever, setSobrescrever] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const q = semAcento(busca);
  const candidatos = operadores.filter((o) => o.id_operador !== origem.id_operador && (!q || semAcento(o.nome).includes(q)));
  const ids = Object.keys(destinos).filter((k) => destinos[k]).map(Number);
  const [ini, fim] = periodoDe(escopo, dia, anoMes);
  const enviar = async (ev) => {
    ev.preventDefault();
    if (!ids.length) return;
    setSalvando(true);
    const ok = await executar(() => aplicarPausasWfm({
      operacao, data_ini: ini, data_fim: fim, ids, dias_semana: diasEscolhidos(escopo, dias), sobrescrever,
      pausas: pausas.map((p) => ({ ordem: p.ordem, tipo: p.tipo, inicio: p.inicio, duracao_min: p.duracao_min })),
    }), resumoAplicacao);
    setSalvando(false);
    if (ok) aoFechar();
  };
  return html`<${ModalForm} titulo=${`Duplicar pausas de ${origem.nome}`} onClose=${aoFechar} onSubmit=${enviar} salvando=${salvando} salvarRotulo=${`Duplicar para ${ids.length} colaborador(es)`}>
    <p class="mon-muted">Copia ${pausas.map((p) => `${p.inicio} (${p.duracao_min} min)`).join(' · ')} para os colaboradores escolhidos. Em cada dia, só quem trabalha e tem o horário dentro do turno recebe as pausas.</p>
    <div class="pa-dup" role="group" aria-label="Colaboradores de destino">
      <input type="search" class="ea-campo" placeholder="Buscar colaborador" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} />
      <div class="pa-dup-itens">${candidatos.map((o) => html`<label key=${o.id_operador} class="wfm-check"><input type="checkbox" checked=${!!destinos[o.id_operador]} onChange=${() => setDestinos({ ...destinos, [o.id_operador]: !destinos[o.id_operador] })} />
        <span>${o.nome}</span><span class="ea-muted ea-num">${o.turno.codigo} ${o.turno.entrada}–${o.turno.saida}</span></label>`)}
        ${candidatos.length ? null : html`<span class="ea-muted">Nenhum colaborador encontrado.</span>`}</div>
    </div>
    <${SeletorPeriodo} escopo=${escopo} aoEscopo=${setEscopo} dias=${dias} aoDias=${setDias} rotuloDia=${`este dia (${brData(dia).slice(0, 5)})`} />
    <label class="wfm-check"><input type="checkbox" checked=${sobrescrever} onChange=${(e) => setSobrescrever(e.target.checked)} /> Substituir pausas já programadas</label>
  </${ModalForm}>`;
}

// Visão macro: uma linha por colaborador COM escala sobre o eixo de horas (a faixa vem do horário real dos turnos), as pausas como
// blocos (1 azul, 2 âmbar, 3 índigo) e, no rodapé, quantos estão em pausa ao mesmo tempo por hora.
function Gantt({ linhas, pausasDe, ocup, capacidade, emConflito }) {
  if (!linhas.length) return html`<${EmptyState} icon="schedule" title="Nenhum colaborador com escala e estes filtros" text="Ajuste os filtros para ver as pausas no gráfico." />`;
  const janelas = linhas.map((o) => janela(o.turno));
  const inicio = Math.floor(Math.min(...janelas.map((j) => j[0])) / 60) * 60;
  const fim = Math.ceil(Math.max(...janelas.map((j) => j[1])) / 60) * 60;
  const span = fim - inicio;
  const pct = (m) => `${((m - inicio) / span) * 100}%`;
  const largura = (min) => `${(min / span) * 100}%`;
  const horas = []; for (let m = inicio; m < fim; m += 60) horas.push(m);
  const porHora = horas.map((m) => { let q = 0; for (let k = m; k < m + 60; k += PASSO) q = Math.max(q, ocup.get(k) || 0); return [m, q]; });
  const rotuloOrdem = { 1: 'azul', 2: 'âmbar', 3: 'índigo' };
  return html`<div class="pa-gantt cx-cresce" role="region" aria-label="Visão macro das pausas" tabindex="0">
    <div class="pa-g-legenda"><span class="ea-rotulo">LEGENDA</span>
      ${[1, 2, 3].map((o) => html`<span key=${o} class="pa-g-leg"><span class=${`pa-g-amostra pa-g-bloco--${o}`} aria-hidden="true"></span>Pausa ${o}</span>`)}
      <span class="pa-g-leg"><span class="pa-g-amostra pa-g-amostra--faixa" aria-hidden="true"></span>Turno</span>
      <span class="pa-g-leg"><span class="pa-g-amostra pa-g-amostra--conflito" aria-hidden="true"></span>Acima do limite (${capacidade})</span></div>
    <div class="pa-g-grade">
      <div class="pa-g-linha pa-g-linha--cab"><div class="pa-g-nome">Horário</div>
        <div class="pa-g-trilha">${horas.map((m) => html`<span key=${m} class="pa-g-hora" style=${{ left: pct(m) }}>${deMin(m).slice(0, 2)}h</span>`)}</div></div>
      ${linhas.map((o, i) => { const [ji, jf] = janelas[i]; return html`<div key=${o.id_operador} class="pa-g-linha">
        <div class="pa-g-nome" title=${o.nome}>${o.nome}<small>${o.turno.codigo} ${o.turno.entrada}–${o.turno.saida}</small></div>
        <div class="pa-g-trilha">
          ${horas.map((m) => html`<span key=${m} class="pa-g-vao" style=${{ left: pct(m) }} aria-hidden="true"></span>`)}
          <span class="pa-g-turno" style=${{ left: pct(ji), width: largura(jf - ji) }} aria-hidden="true"></span>
          ${pausasDe(o).filter((p) => p.inicio).map((p) => { const m = desenrolar(p.inicio, ji); const conf = emConflito.has(`${o.id_operador}:${p.ordem}`); return html`<span key=${p.ordem} class=${`pa-g-bloco pa-g-bloco--${p.ordem} ${conf ? 'is-conflito' : ''}`} style=${{ left: pct(m), width: largura(p.duracao_min) }}
            title=${`${o.nome} · Pausa ${p.ordem} (${ROTULO_TIPO[p.tipo] || p.tipo}, ${rotuloOrdem[p.ordem] || ''}) · ${p.inicio}–${deMin(m + p.duracao_min)} · ${p.duracao_min} min${conf ? ' · acima do limite' : ''}`}></span>`; })}
        </div></div>`; })}
      <div class="pa-g-linha pa-g-linha--ocup"><div class="pa-g-nome">Ao mesmo tempo<small>limite: ${capacidade}</small></div>
        <div class="pa-g-trilha">${porHora.map(([m, q]) => html`<span key=${m} class=${`pa-g-ocup ${q > capacidade ? 'pa-g-ocup--excesso' : q ? 'pa-g-ocup--ok' : 'pa-g-ocup--zero'}`} style=${{ left: pct(m), width: largura(60) }}
          title=${`${deMin(m)}–${deMin(m + 60)}: ${q} em pausa${q > capacidade ? ' (acima do limite)' : ''}`}>${q}</span>`)}</div></div>
    </div>
  </div>`;
}
