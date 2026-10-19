import { html, useCallback, useEffect, useMemo, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { aplicarPausasWfm, definirCapacidadePausasWfm, distribuirPausasWfm, lerEscalaWfm, lerPausasDiaWfm, salvarPausasWfm } from '../../../services/api/wfm.js?v=20261019-pausas';
import { ModalForm } from './formulario.js';
import { BarraSelecao, CheckTodos, FiltrosCompactos, Icone, LinhaContexto, SeletorVisao, aMin, brData, deMin, doIso, paraIso, semAcento } from './escala-ui.js?v=20261019-pausas';

// Aba "Pausas" da escala: as 3 pausas de cada colaborador escalado no dia (2 de 10 min e 1 de 20 min, todas contadas
// como jornada). Define horários à mão — por colaborador, em lote, por equipe ou por turno — e aplica ao dia, à semana ou
// ao mês; mostra a tabela com filtros e a visão macro (Gantt). Exceder o limite de colaboradores em pausa ao mesmo tempo
// é aviso (não bloqueio). Pausas emergenciais (banheiro, feedback...) não entram aqui. Estilos: bloco `.pa-*` em wfm.css.

const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
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

export function TelaEscalaPausas({ controlador, operacao, anoMes, showToast, aoDia, aoMes, aoVoltarLista, aoMudarMes, aoTrocarEscala, opcoesEscala = null }) {
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
  const [visao, setVisao] = useState('tabela');        // 'tabela' | 'gantt'
  const [painel, setPainel] = useState(false);
  const [capacidade, setCapacidade] = useState('');
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
      setDados(d); setCapacidade(String(d.capacidade)); setEdicao({}); setSel({});
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
  const pausasDe = (op) => edicao[op.id_operador] || op.pausas;
  const alteradas = Object.keys(edicao).length;

  // ---- filtros -----------------------------------------------------------------------------------------------
  const turnos = useMemo(() => [...new Map(operadores.map((o) => [o.turno.codigo, o.turno])).values()], [operadores]);
  const equipes = useMemo(() => [...new Map(operadores.filter((o) => o.id_equipe).map((o) => [o.id_equipe, o.equipe])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [operadores]);
  const supervisores = useMemo(() => [...new Map(operadores.flatMap((o) => o.supervisores || []).map((s) => [s.id_usuario, s.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), [operadores]);
  const horas = useMemo(() => [...new Set(operadores.flatMap((o) => (edicao[o.id_operador] || o.pausas).map((p) => p.inicio.slice(0, 2))))].sort(), [operadores, edicao]);
  const visiveis = useMemo(() => {
    const q = semAcento(busca);
    return operadores.filter((o) => (!q || semAcento(o.nome).includes(q))
      && (!filtroTurno || o.turno.codigo === filtroTurno)
      && (!filtroEquipe || String(o.id_equipe) === filtroEquipe)
      && (!filtroSup || (o.supervisores || []).some((s) => String(s.id_usuario) === filtroSup))
      && (!filtroHora || (edicao[o.id_operador] || o.pausas).some((p) => p.inicio.slice(0, 2) === filtroHora)));
  }, [operadores, edicao, busca, filtroTurno, filtroEquipe, filtroSup, filtroHora]);

  // ---- ocupação (inclui o que está editado e ainda não salvo): alimenta o aviso e o Gantt ---------------------
  const { ocup, excedentes } = useMemo(() => {
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
    return { ocup: mapa, excedentes: faixas };
  }, [operadores, edicao, dados]);

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
  const salvarCapacidade = () => executar(() => definirCapacidadePausasWfm({ operacao, pausas_simultaneas: Number(capacidade) }), 'Limite de colaboradores em pausa atualizado.');
  const marcados = visiveis.filter((o) => sel[o.id_operador]);
  const todosSel = visiveis.length > 0 && marcados.length === visiveis.length;
  const alternarTodos = () => setSel(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_operador, true])));
  const nomeEscala = escala?.nome_escala || opcoesEscala?.find(([c]) => c === operacao)?.[1] || operacao;
  const d0 = doIso(dia);
  const hojeIso = paraIso(new Date());
  const ultimoDia = paraIso(new Date(Number(anoMes.slice(0, 4)), Number(anoMes.slice(5)), 0));
  const resumoAplicacao = (r) => `${r.pausas_gravadas} colaborador(es)/dia gravado(s) em ${r.dias_programados} dia(s)`
    + `${r.ignoradas ? `; ${r.ignoradas} fora do turno do dia (ignorado)` : ''}${r.mantidas ? `; ${r.mantidas} mantido(s) sem substituir` : ''}`
    + `${r.dias_com_excesso ? `. Atenção: ${r.dias_com_excesso} dia(s) passam do limite de ${r.capacidade} em pausa ao mesmo tempo.` : '.'}`;

  return html`
    <${LinhaContexto} nome=${nomeEscala} operacao=${operacao} operacoes=${opcoesEscala} aoTrocarEscala=${aoTrocarEscala} anoMes=${anoMes} aoMudarMes=${aoMudarMes}
      escalados=${operadores.length} emDsr=${escala ? Math.max(0, (escala.operadores?.length || 0) - operadores.length) : 0}
      versao=${escala?.status?.versao_publicada || 0} aoVoltarLista=${aoVoltarLista} />

    <section class="mo-card-escala cx-cresce" aria-label="Pausas">
      <div class="mo-barra cx-fixo">
        <${SeletorVisao} visao="pausas" aoDia=${aoDia} aoMes=${aoMes} />
        <div class="ea-dia-nav" role="group" aria-label="Escolher o dia">
          <button type="button" class="ea-icone-btn" aria-label="Dia anterior" title="Dia anterior" disabled=${dia <= `${anoMes}-01`} onClick=${() => mover(-1)}><${Icone} nome="chevron_left" /></button>
          <label class="ea-data"><${Icone} nome="calendar_month" /><span class="ea-num">${SEMANA[d0.getDay()]}, ${brData(dia)}</span>
            <input class="ea-data-input" type="date" aria-label="Escolher data" onClick=${(e) => e.target.showPicker?.()} value=${dia} min=${`${anoMes}-01`} max=${ultimoDia} onChange=${(e) => e.target.value && e.target.value.startsWith(anoMes) && setDia(e.target.value)} /></label>
          <button type="button" class="ea-icone-btn" aria-label="Próximo dia" title="Próximo dia" disabled=${dia >= ultimoDia} onClick=${() => mover(1)}><${Icone} nome="chevron_right" /></button>
          <button type="button" class="mo-btn mo-btn--neutro mo-btn--34" disabled=${!hojeIso.startsWith(anoMes) || dia === hojeIso} onClick=${() => setDia(hojeIso)}>Hoje</button>
        </div>
        <div class="pa-barra-fim">
          <label class="pa-limite" title="Quantos colaboradores podem estar em pausa ao mesmo tempo nesta escala (recomendado; exceder gera um aviso).">
            <span>Limite simultâneo</span>
            <input class="ea-campo" type="number" min="1" max="200" disabled=${!podeCapacidade} value=${capacidade} onInput=${(e) => setCapacidade(e.target.value)} aria-label="Colaboradores em pausa ao mesmo tempo" />
            ${podeCapacidade && Number(capacidade) !== dados.capacidade ? html`<button type="button" class="ea-btn-sol" disabled=${ocupado || !(Number(capacidade) >= 1)} onClick=${salvarCapacidade}>Salvar</button>` : null}
          </label>
          <div class="ea-visao" role="group" aria-label="Forma de exibição">
            <button type="button" class=${visao === 'tabela' ? 'is-ativo' : ''} aria-pressed=${visao === 'tabela'} onClick=${() => setVisao('tabela')}>Tabela</button>
            <button type="button" class=${visao === 'gantt' ? 'is-ativo' : ''} aria-pressed=${visao === 'gantt'} onClick=${() => setVisao('gantt')}>Visão macro</button>
          </div>
          ${podeEditar ? html`<button type="button" class=${`mo-btn mo-btn--sec mo-btn--34 ${painel ? 'is-ativo' : ''}`} aria-expanded=${painel} onClick=${() => setPainel(!painel)}><${Icone} nome="schedule" />Definir horários</button>` : null}
        </div>
      </div>

      <div class="mo-barra mo-barra--filtros cx-fixo"><${FiltrosCompactos} rotuloBusca="Buscar colaborador" busca=${busca} aoBuscar=${setBusca} contagem=${`${visiveis.length} de ${operadores.length} colaborador(es)`}
        selects=${[
          { rotulo: 'Turno', padrao: 'Turno: todos', valor: filtroTurno, aoMudar: setFiltroTurno, largura: 'm', opcoes: turnos.map((t) => [t.codigo, t.codigo]) },
          { rotulo: 'Horário da pausa', padrao: 'Horário: todos', valor: filtroHora, aoMudar: setFiltroHora, largura: 'm', opcoes: horas.map((h) => [h, `${h}h`]) },
          { rotulo: 'Equipe', padrao: 'Equipe: todas', valor: filtroEquipe, aoMudar: setFiltroEquipe, largura: 'm', opcoes: equipes.map(([id, nome]) => [String(id), nome]) },
          { rotulo: 'Supervisor', padrao: 'Supervisor: todos', valor: filtroSup, aoMudar: setFiltroSup, largura: 'g', opcoes: supervisores.map(([id, nome]) => [String(id), nome]) },
        ]} /></div>

      ${podeEditar && painel ? html`<${PainelDefinir} dia=${dia} anoMes=${anoMes} dados=${dados} operadores=${operadores} marcados=${marcados} turnos=${turnos} equipes=${equipes}
        ocupado=${ocupado} executar=${executar} operacao=${operacao} resumoAplicacao=${resumoAplicacao} />` : null}

      ${podeEditar ? html`<${BarraSelecao} n=${marcados.length} aoLimpar=${() => setSel({})}>
        <button type="button" class=${`ea-btn-ctn ${painel ? 'is-ativo' : ''}`} aria-expanded=${painel} onClick=${() => setPainel(true)}>Definir horários dos selecionados</button>
      <//>` : null}

      ${excedentes.length ? html`<div class="wfm-validacao is-alerta ea-alerta" role="status"><strong>Mais colaboradores em pausa ao mesmo tempo do que o limite (${dados.capacidade})</strong>
        <ul>${excedentes.slice(0, 6).map((x, i) => html`<li key=${i}>${deMin(x.ini)}–${deMin(x.fim)}: ${x.qtd} em pausa</li>`)}${excedentes.length > 6 ? html`<li>e mais ${excedentes.length - 6} faixa(s)</li>` : null}</ul></div>` : null}

      ${!operadores.length
        ? html`<${EmptyState} icon="schedule" title="Ninguém escalado neste dia" text="As pausas são programadas para quem tem turno de trabalho no dia. Monte a escala de turnos primeiro." />`
        : visao === 'gantt'
          ? html`<${Gantt} linhas=${visiveis} pausasDe=${pausasDe} ocup=${ocup} capacidade=${dados.capacidade} />`
          : html`<div class="mo-mat ea-tabela cx-cresce">
            <div class="ea-rolagem mo-rolagem" role="region" aria-label="Pausas do dia" tabindex="0">
              <table class=${`ea-tab pa-tab ${podeEditar ? 'ea-tab--sel' : ''}`}>
                <colgroup>${podeEditar ? html`<col style=${{ width: '44px' }} />` : null}<col /><col style=${{ width: '176px' }} />${dados.pausas_padrao.map((p) => html`<col key=${p.ordem} style=${{ width: '152px' }} />`)}${podeEditar ? html`<col style=${{ width: '128px' }} />` : null}</colgroup>
                <thead><tr>
                  ${podeEditar ? html`<th scope="col" class="ea-c-sel"><${CheckTodos} rotulo="Selecionar todos os colaboradores" total=${visiveis.length} marcados=${marcados.length} aoAlternar=${alternarTodos} /></th>` : null}
                  <th scope="col" class="ea-c-nome">Colaborador</th><th scope="col">Turno</th>
                  ${dados.pausas_padrao.map((p) => html`<th scope="col" key=${p.ordem}>Pausa ${p.ordem} · ${p.duracao_min} min</th>`)}
                  ${podeEditar ? html`<th scope="col">Ações</th>` : null}
                </tr></thead>
                <tbody>
                  ${visiveis.length ? visiveis.map((op) => { const pausas = pausasDe(op); const pend = !!edicao[op.id_operador]; return html`<tr key=${op.id_operador} class=${`${pend ? 'is-pendente' : ''} ${sel[op.id_operador] ? 'is-sel' : ''}`}>
                    ${podeEditar ? html`<td class="ea-c-sel"><input type="checkbox" class="ea-check" aria-label=${`Selecionar ${op.nome}`} checked=${!!sel[op.id_operador]} onChange=${() => setSel({ ...sel, [op.id_operador]: !sel[op.id_operador] })} /></td>` : null}
                    <td class="ea-c-nome"><strong class="pa-nome">${op.nome}</strong><small class="pa-sub">${[op.equipe, (op.supervisores || []).map((s) => s.nome).join(', ')].filter(Boolean).join(' · ') || '—'}</small>${op.erros.length ? html`<small class="wfm-alerta-txt">${op.erros[0]}</small>` : null}</td>
                    <td><span class="pa-turno"><strong>${op.turno.codigo}</strong><span class="ea-muted ea-num">${op.turno.entrada}–${op.turno.saida}</span></span></td>
                    ${dados.pausas_padrao.map((padrao) => { const p = pausas.find((x) => x.ordem === padrao.ordem);
                      return html`<td key=${padrao.ordem}>${p
                        ? (podeEditar ? html`<input class="ea-campo pa-hora" type="time" step="300" aria-label=${`${op.nome}, pausa ${padrao.ordem}`} value=${p.inicio} onInput=${(e) => mudar(op, padrao.ordem, e.target.value)} />` : html`<strong class="ea-num">${p.inicio}</strong>`)
                        : (podeEditar && padrao.ordem === 1 ? html`<button type="button" class="wfm-link" onClick=${() => iniciar(op)}>Definir manualmente</button>` : html`<span class="ea-muted">—</span>`)}</td>`; })}
                    ${podeEditar ? html`<td><button type="button" class="ea-btn-ctn" disabled=${!pausas.length || pend} title=${pend ? 'Salve as alterações antes de duplicar.' : 'Copiar estas pausas para outros colaboradores'} onClick=${() => setDuplicando(op)}>Duplicar</button></td>` : null}
                  </tr>`; }) : html`<tr><td class="ea-vazio" colspan=${podeEditar ? 7 : 5}>Nenhum colaborador encontrado com estes filtros.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>`}

      ${podeEditar && alteradas ? html`<footer class="mo-rodape cx-fixo">
        <div class="mo-rodape-esq"><span class="mo-rodape-txt">${alteradas} colaborador(es) com alteração não salva</span></div>
        <div class="mo-rodape-dir">
          <button type="button" class="btn btn-outline-secondary" onClick=${() => setEdicao({})}>Descartar</button>
          <button type="button" class="btn btn-primary" disabled=${ocupado} onClick=${salvar}>Salvar pausas (${alteradas})</button>
        </div></footer>` : null}
    </section>

    ${duplicando ? html`<${ModalDuplicar} origem=${duplicando} pausas=${pausasDe(duplicando)} dia=${dia} anoMes=${anoMes} operadores=${operadores} operacao=${operacao}
      executar=${executar} resumoAplicacao=${resumoAplicacao} aoFechar=${() => setDuplicando(null)} />` : null}`;
}

function SeletorPeriodo({ escopo, aoEscopo, dias, aoDias, rotuloDia }) {
  return html`<div class="pa-periodo">
    <label class="wfm-campo"><span>Aplicar em</span><select class="form-select" value=${escopo} onChange=${(e) => aoEscopo(e.target.value)}>
      <option value="dia">Só ${rotuloDia}</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select></label>
    ${escopo !== 'dia' ? html`<span class="wfm-dias-chips" role="group" aria-label="Dias da semana atingidos">${SEMANA_CURTA.map((nome, i) => html`<button key=${nome} type="button" class=${`wfm-dia-chip ${dias[i] ? 'is-ativo' : ''}`} aria-pressed=${dias[i]} onClick=${() => aoDias(dias.map((v, j) => (j === i ? !v : v)))}>${nome}</button>`)}</span>` : null}
  </div>`;
}

// Painel "Definir horários": três horários à mão para um grupo (selecionados, equipe ou turno), num período.
function PainelDefinir({ dia, anoMes, dados, operadores, marcados, turnos, equipes, ocupado, executar, operacao, resumoAplicacao }) {
  const [horarios, setHorarios] = useState(() => dados.pausas_padrao.map(() => ''));
  const [alvo, setAlvo] = useState('selecionados'); // 'selecionados' | 'equipe' | 'turno'
  const [equipe, setEquipe] = useState('');
  const [turno, setTurno] = useState('');
  const [escopo, setEscopo] = useState('dia');
  const [dias, setDias] = useState(TODOS_DIAS);
  const [sobrescrever, setSobrescrever] = useState(true);
  const ids = alvo === 'selecionados' ? marcados.map((o) => o.id_operador)
    : alvo === 'equipe' ? (equipe ? operadores.filter((o) => String(o.id_equipe) === equipe).map((o) => o.id_operador) : [])
      : (turno ? operadores.filter((o) => o.turno.codigo === turno).map((o) => o.id_operador) : []);
  const completo = horarios.every(Boolean);
  const [ini, fim] = periodoDe(escopo, dia, anoMes);
  const diasSemana = diasEscolhidos(escopo, dias);
  const pausas = dados.pausas_padrao.map((p, i) => ({ ordem: p.ordem, tipo: p.tipo, inicio: horarios[i], duracao_min: p.duracao_min }));
  const aplicar = () => executar(() => aplicarPausasWfm({ operacao, data_ini: ini, data_fim: fim, ids, pausas, dias_semana: diasSemana, sobrescrever }), resumoAplicacao);
  const distribuir = () => executar(
    () => distribuirPausasWfm({ operacao, data: ini, ids, sobrescrever, ...(escopo === 'dia' ? {} : { data_fim: fim, dias_semana: diasSemana }) }),
    'Pausas distribuídas respeitando o limite de colaboradores em pausa ao mesmo tempo.',
  );
  const semAlvo = !ids.length;
  return html`<div class="wfm-lote-dia ea-painel-massa pa-painel">
    <div class="pa-painel-linha">
      <strong class="pa-painel-rotulo">Horários</strong>
      ${dados.pausas_padrao.map((p, i) => html`<label key=${p.ordem} class="wfm-campo"><span>Pausa ${p.ordem} · ${ROTULO_TIPO[p.tipo]} ${p.duracao_min} min</span>
        <input class="form-control pa-hora" type="time" step="300" value=${horarios[i]} onInput=${(e) => setHorarios(horarios.map((h, j) => (j === i ? e.target.value : h)))} /></label>`)}
    </div>
    <div class="pa-painel-linha">
      <strong class="pa-painel-rotulo">Para quem</strong>
      <div class="ea-visao" role="group" aria-label="Quem recebe os horários">
        ${[['selecionados', `Selecionados (${marcados.length})`], ['equipe', 'Equipe'], ['turno', 'Turno']].map(([id, rotulo]) => html`<button key=${id} type="button" class=${alvo === id ? 'is-ativo' : ''} aria-pressed=${alvo === id} onClick=${() => setAlvo(id)}>${rotulo}</button>`)}
      </div>
      ${alvo === 'equipe' ? html`<label class="wfm-campo"><span>Equipe</span><select class="form-select" value=${equipe} onChange=${(e) => setEquipe(e.target.value)}><option value="">Escolha…</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select></label>` : null}
      ${alvo === 'turno' ? html`<label class="wfm-campo"><span>Turno</span><select class="form-select" value=${turno} onChange=${(e) => setTurno(e.target.value)}><option value="">Escolha…</option>${turnos.map((t) => html`<option key=${t.codigo} value=${t.codigo}>${t.codigo} · ${t.entrada}–${t.saida}</option>`)}</select></label>` : null}
      <span class="ea-muted">${ids.length} colaborador(es)</span>
    </div>
    <div class="pa-painel-linha">
      <strong class="pa-painel-rotulo">Período</strong>
      <${SeletorPeriodo} escopo=${escopo} aoEscopo=${setEscopo} dias=${dias} aoDias=${setDias} rotuloDia=${`este dia (${brData(dia).slice(0, 5)})`} />
      <label class="wfm-check"><input type="checkbox" checked=${sobrescrever} onChange=${(e) => setSobrescrever(e.target.checked)} /> Substituir pausas já programadas</label>
    </div>
    <div class="pa-painel-linha">
      <button type="button" class="btn btn-primary btn-sm" disabled=${ocupado || semAlvo || !completo} onClick=${aplicar}>Aplicar horários</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" disabled=${ocupado || semAlvo} onClick=${distribuir} title="Em vez de horários fixos, distribui as pausas automaticamente respeitando o limite simultâneo">Distribuir automaticamente</button>
      <span class="ea-muted">${semAlvo ? 'Escolha quem recebe os horários.' : !completo ? 'Preencha os três horários.' : 'O horário que não couber no turno de um dia é ignorado nesse dia; passar do limite só gera aviso.'}</span>
    </div>
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

// Visão macro: uma linha por colaborador sobre o eixo de horas, com as pausas como blocos e, no topo, quantos estão em pausa.
function Gantt({ linhas, pausasDe, ocup, capacidade }) {
  if (!linhas.length) return html`<${EmptyState} icon="schedule" title="Nenhum colaborador com estes filtros" text="Ajuste os filtros para ver as pausas no gráfico." />`;
  const janelas = linhas.map((o) => janela(o.turno));
  const inicio = Math.floor(Math.min(...janelas.map((j) => j[0])) / 60) * 60;
  const fim = Math.ceil(Math.max(...janelas.map((j) => j[1])) / 60) * 60;
  const span = fim - inicio;
  const pct = (m) => `${((m - inicio) / span) * 100}%`;
  const largura = (min) => `${(min / span) * 100}%`;
  const horas = []; for (let m = inicio; m < fim; m += 60) horas.push(m);
  const fatias = []; for (let m = inicio; m < fim; m += 15) { let q = 0; for (let k = m; k < m + 15; k += PASSO) q = Math.max(q, ocup.get(k) || 0); fatias.push([m, q]); }
  const mostrarNumero = span <= 14 * 60;
  return html`<div class="pa-gantt mo-mat cx-cresce" role="region" aria-label="Visão macro das pausas" tabindex="0">
    <div class="pa-g-legenda"><span class="ea-rotulo">LEGENDA</span>
      <span class="pa-g-leg"><span class="pa-g-amostra pa-g-bloco--DESCANSO" aria-hidden="true"></span>Descanso (10 min)</span>
      <span class="pa-g-leg"><span class="pa-g-amostra pa-g-bloco--REFEICAO" aria-hidden="true"></span>Refeição (20 min)</span>
      <span class="pa-g-leg"><span class="pa-g-amostra pa-g-ocup--excesso" aria-hidden="true"></span>Acima do limite (${capacidade})</span></div>
    <div class="pa-g-grade">
      <div class="pa-g-linha pa-g-linha--cab"><div class="pa-g-nome">Horário</div>
        <div class="pa-g-trilha">${horas.map((m) => html`<span key=${m} class="pa-g-hora" style=${{ left: pct(m) }}>${deMin(m).slice(0, 2)}h</span>`)}</div></div>
      <div class="pa-g-linha pa-g-linha--ocup"><div class="pa-g-nome">Em pausa<small>limite ${capacidade}</small></div>
        <div class="pa-g-trilha">${fatias.map(([m, q]) => html`<span key=${m} class=${`pa-g-ocup ${q > capacidade ? 'pa-g-ocup--excesso' : q === capacidade ? 'pa-g-ocup--limite' : q ? 'pa-g-ocup--ok' : ''}`} style=${{ left: pct(m), width: largura(15) }} title=${`${deMin(m)}–${deMin(m + 15)}: ${q} em pausa`}>${q && mostrarNumero ? q : ''}</span>`)}</div></div>
      ${linhas.map((o, i) => { const [ji, jf] = janelas[i]; return html`<div key=${o.id_operador} class="pa-g-linha">
        <div class="pa-g-nome" title=${o.nome}>${o.nome}<small>${o.turno.codigo} ${o.turno.entrada}–${o.turno.saida}</small></div>
        <div class="pa-g-trilha">
          ${horas.map((m) => html`<span key=${m} class="pa-g-vao" style=${{ left: pct(m) }} aria-hidden="true"></span>`)}
          <span class="pa-g-turno" style=${{ left: pct(ji), width: largura(jf - ji) }} aria-hidden="true"></span>
          ${pausasDe(o).filter((p) => p.inicio).map((p) => { const m = desenrolar(p.inicio, ji); return html`<span key=${p.ordem} class=${`pa-g-bloco pa-g-bloco--${p.tipo}`} style=${{ left: pct(m), width: largura(p.duracao_min) }}
            title=${`${o.nome} · Pausa ${p.ordem} (${ROTULO_TIPO[p.tipo] || p.tipo}) · ${p.inicio}–${deMin(m + p.duracao_min)} · ${p.duracao_min} min`}></span>`; })}
        </div></div>`; })}
    </div>
  </div>`;
}
