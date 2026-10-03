import { html, useCallback, useEffect, useMemo, useState } from '../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';
import {
  definirCapacidadePausasWfm,
  distribuirPausasWfm,
  lancarHoraExtraWfm,
  lancarPresencaWfm,
  lerEscalaWfm,
  lerPausasDiaWfm,
  listarContratosWfm,
  listarHorasExtrasWfm,
  listarPresencasWfm,
  listarSupervisoresWfm,
  publicarEscalaWfm,
  salvarItensEscalaWfm,
  salvarPausasWfm,
} from '../../services/api/wfm.js';
import { SIGLA_PRESENCA, ROTULO_STATUS_PRESENCA, minutosParaHoras } from './comum.js';
import { ModalTurno, TURNO_VAZIO, turnoParaEdicao } from './cadastros.js';
import { PainelAprovacao } from './aprovacao.js';
import { MenuCompartilharEscala } from './compartilhar.js';
import { ModalConfigEscala } from './configuracao.js';

// Escala do dia — a tela única do Control Desk. Um dia por vez, uma linha por colaborador, com tudo no lugar:
// turno, entrada/saída, 3 pausas, presença e hora extra. Dias sem turno são DSR (padrão). Turno e horário podem ser
// aplicados ao dia, à semana ou ao mês; pausas são programadas ao salvar. Nada exige trocar de aba.

const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const SEMANA_CURTA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const br = (iso) => iso.split('-').reverse().join('/');
const paraMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m; };
const duracao = (e, s) => (e && s ? (((paraMin(s) - paraMin(e)) % 1440) + 1440) % 1440 : 0);
const diaSemanaSegunda = (iso) => (doIso(iso).getDay() + 6) % 7; // 0 = segunda
const chave = (id, data) => `${id}:${data}`;
const ROTULO_PAUSA = { DESCANSO: 'Descanso', REFEICAO: 'Refeição', LANCHE: 'Lanche', OUTRA: 'Pausa', INTERVALO: 'Intervalo' };

export function TelaEscalaTabela({ controlador, contexto, operacao, anoMes, showToast, aoVerMes, aoVoltarLista }) {
  const [dia, setDia] = useState(() => { const hoje = paraIso(new Date()); return hoje.startsWith(anoMes) ? hoje : `${anoMes}-01`; });
  const [dados, setDados] = useState(null);
  const [extras, setExtras] = useState([]);
  const [presencas, setPresencas] = useState({});
  const [pausasDia, setPausasDia] = useState(null);
  const [contratos, setContratos] = useState([]);
  const [supervisoresOp, setSupervisoresOp] = useState([]);
  const [erro, setErro] = useState('');
  const [pend, setPend] = useState({});
  const [sel, setSel] = useState({});
  const [lote, setLote] = useState({ turno: '', entrada: '', saida: '', escopo: 'dia', dias: [true, true, true, true, true, true, true] });
  const [programarPausas, setProgramarPausas] = useState(true);
  const [filtroSup, setFiltroSup] = useState('');
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [busca, setBusca] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [pedirJust, setPedirJust] = useState(false);
  const [modalTurno, setModalTurno] = useState(null);
  const [capacidade, setCapacidade] = useState('');
  const [configurando, setConfigurando] = useState(false);
  const [versaoLista, setVersaoLista] = useState(0);
  const [verMassa, setVerMassa] = useState(false);
  const [verTurnos, setVerTurnos] = useState(false);
  const podePublicar = controlador.possuiPermissao('wfm.escala.publicar');
  const podePresenca = controlador.possuiPermissao('wfm.presenca.lancar');
  const podeCadastros = controlador.possuiPermissao('wfm.cadastros.editar');

  useEffect(() => { if (!dia.startsWith(anoMes)) setDia(`${anoMes}-01`); }, [anoMes]);

  const carregarPausas = useCallback(async () => {
    if (!operacao) return;
    try { const p = await lerPausasDiaWfm(operacao, dia); setPausasDia(p); setCapacidade(String(p.capacidade)); } catch { setPausasDia(null); }
  }, [operacao, dia]);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const [d, e, pr, c, sv] = await Promise.all([
        lerEscalaWfm(operacao, anoMes),
        listarHorasExtrasWfm(operacao, anoMes).catch(() => ({ itens: [] })),
        listarPresencasWfm(operacao, anoMes).catch(() => ({ itens: [] })),
        listarContratosWfm(operacao).catch(() => ({ itens: [] })),
        listarSupervisoresWfm(operacao).catch(() => ({ itens: [] })),
      ]);
      setDados(d);
      setExtras(e.itens || []);
      setPresencas(Object.fromEntries((pr.itens || []).map((p) => [chave(p.id_operador, p.data), p.status])));
      setContratos(c.itens || []);
      setSupervisoresOp(sv.itens || []);
      setPend({});
      await carregarPausas();
    } catch (err) { setDados(null); setErro(err?.message || 'Não foi possível carregar a escala.'); }
  }, [operacao, anoMes, carregarPausas]);
  useEffect(() => { setDados(null); carregar(); }, [operacao, anoMes]);
  useEffect(() => { carregarPausas(); }, [carregarPausas]);

  const turnos = useMemo(() => Object.fromEntries((dados?.turnos || []).map((t) => [t.id_turno, t])), [dados]);
  const itens = useMemo(() => Object.fromEntries((dados?.itens || []).map((i) => [chave(i.id_operador, i.data), i])), [dados]);
  const extraSalvo = useMemo(() => Object.fromEntries(extras.map((x) => [chave(x.id_operador, x.data), x.minutos])), [extras]);
  const pausasDeOp = useMemo(() => Object.fromEntries((pausasDia?.operadores || []).map((o) => [o.id_operador, o])), [pausasDia]);

  if (erro) return html`<div class="mon-alerta mon-alerta--danger" role="alert">${erro}</div>`;
  if (!dados) return html`<${LoadingState} titulo="Carregando a escala" />`;
  if (!dados.operadores.length) return html`<${EmptyState} icon="groups" title="Nenhum operador" text="Não há operadores visíveis para você nesta operação." />`;

  const editavel = dados.pode_editar;
  const fechada = dados.status.fechada;
  const d0 = doIso(dia);
  const turnosSelecionaveis = dados.turnos.filter((t) => t.tipo !== 'DSR' && t.ativo !== false);

  // ---- leitura de uma célula (colaborador × data), já com o que está pendente ----
  const itemDe = (id, data) => itens[chave(id, data)];
  const turnoIdDe = (id, data) => { const p = pend[chave(id, data)]; return p && 'id_turno' in p ? p.id_turno : itemDe(id, data)?.id_turno ?? null; };
  const turnoDe = (id, data) => turnos[turnoIdDe(id, data)];
  const trabalha = (id, data) => turnoDe(id, data)?.tipo === 'TRABALHO';
  const entradaDe = (id, data) => {
    const p = pend[chave(id, data)];
    if (p && p.entrada !== undefined) return p.entrada;
    const t = turnoDe(id, data);
    if (p && 'id_turno' in p) return t?.entrada || '';
    return itemDe(id, data)?.entrada_ajuste || t?.entrada || '';
  };
  const saidaDe = (id, data) => {
    const p = pend[chave(id, data)];
    if (p && p.saida !== undefined) return p.saida;
    const t = turnoDe(id, data);
    if (p && 'id_turno' in p) return t?.saida || '';
    return itemDe(id, data)?.saida_ajuste || t?.saida || '';
  };
  const ajustado = (id, data) => trabalha(id, data) && (entradaDe(id, data) !== turnoDe(id, data).entrada || saidaDe(id, data) !== turnoDe(id, data).saida);
  const extraDe = (id, data) => { const p = pend[chave(id, data)]; return p && 'he' in p ? p.he : extraSalvo[chave(id, data)] || 0; };
  const extraMes = (id) => {
    const salvos = extras.filter((x) => x.id_operador === id && !('he' in (pend[chave(id, x.data)] || {}))).reduce((a, x) => a + x.minutos, 0);
    const pendentes = Object.entries(pend).filter(([k, p]) => k.startsWith(`${id}:`) && 'he' in p).reduce((a, [, p]) => a + (p.he || 0), 0);
    return salvos + pendentes;
  };
  const presencaDe = (id, data) => { const p = pend[chave(id, data)]; return p && 'pres' in p ? p.pres : presencas[chave(id, data)] || ''; };
  // Pausas só existem para quem já está escalado (salvo) no dia; edição pendente fica em `pausas`.
  const pausasDe = (id, data) => { const p = pend[chave(id, data)]; return p?.pausas || (data === dia ? pausasDeOp[id]?.pausas : null) || []; };
  const escalaSalva = (id, data) => { const t = turnos[itemDe(id, data)?.id_turno]; return t?.tipo === 'TRABALHO'; };

  const mudou = (id, data) => {
    const k = chave(id, data);
    const p = pend[k];
    if (!p) return { escala: false, extra: false, pres: false, pausas: false };
    const a = itemDe(id, data);
    const escala = ('id_turno' in p && (p.id_turno ?? null) !== (a?.id_turno ?? null))
      || (trabalha(id, data) && (entradaDe(id, data) !== (a?.entrada_ajuste || turnoDe(id, data).entrada) || saidaDe(id, data) !== (a?.saida_ajuste || turnoDe(id, data).saida)));
    return {
      escala,
      extra: 'he' in p && (p.he || 0) !== (extraSalvo[k] || 0),
      pres: 'pres' in p && (p.pres || '') !== (presencas[k] || ''),
      pausas: !!p.pausas,
    };
  };
  const celulasAlteradas = Object.keys(pend).map((k) => { const [id, data] = k.split(':'); return { id: Number(id), data, ...mudou(Number(id), data) }; })
    .filter((c) => c.escala || c.extra || c.pres || c.pausas);

  // ---- edição ----
  const mudar = (id, data, campos) => setPend((p) => ({ ...p, [chave(id, data)]: { ...(p[chave(id, data)] || {}), ...campos } }));
  const mudarTurno = (id, data, valor) => setPend((p) => {
    const { entrada, saida, ...resto } = p[chave(id, data)] || {};
    return { ...p, [chave(id, data)]: { ...resto, id_turno: valor === '' ? null : Number(valor) } };
  });
  const mudarHorario = (id, data, campo, valor) => mudar(id, data, { entrada: campo === 'entrada' ? valor : entradaDe(id, data), saida: campo === 'saida' ? valor : saidaDe(id, data) });
  const mudarPausa = (id, data, ordem, inicio) => {
    const base = (pausasDe(id, data).length ? pausasDe(id, data) : (pausasDia?.pausas_padrao || []).map((p) => ({ ...p, inicio: entradaDe(id, data) })))
      .map((p) => (p.ordem === ordem ? { ...p, inicio } : p));
    mudar(id, data, { pausas: base });
  };
  const definirPausas = (id, data) => mudar(id, data, { pausas: (pausasDia?.pausas_padrao || []).map((p) => ({ ordem: p.ordem, tipo: p.tipo, duracao_min: p.duracao_min, inicio: entradaDe(id, data) })) });

  const visiveis = dados.operadores.filter((o) => (!filtroEquipe || String(o.id_equipe || '') === filtroEquipe)
    && (!filtroSup || (o.supervisores || []).some((s) => String(s.id_usuario) === filtroSup))
    && (!busca || o.nome.toLowerCase().includes(busca.toLowerCase())));
  const equipes = [...new Map(dados.operadores.filter((o) => o.id_equipe).map((o) => [o.id_equipe, o.equipe])).entries()];
  const supervisores = [...new Map(dados.operadores.flatMap((o) => o.supervisores || []).map((s) => [s.id_usuario, s.nome])).entries()];
  const marcados = visiveis.filter((o) => sel[o.id_usuario]);
  const alvos = marcados.length ? marcados : visiveis;
  const todosSel = visiveis.length > 0 && marcados.length === visiveis.length;
  const escalados = dados.operadores.filter((o) => trabalha(o.id_usuario, dia)).length;

  // Datas atingidas pelo "Aplicar": o dia, a semana (seg–dom) ou o mês, filtradas pelos dias da semana marcados.
  const datasAlvo = (() => {
    if (lote.escopo === 'dia') return [dia];
    const base = lote.escopo === 'mes' ? dados.dias : dados.dias.filter((d) => {
      const seg = new Date(d0); seg.setDate(seg.getDate() - diaSemanaSegunda(dia));
      const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
      return d >= paraIso(seg) && d <= paraIso(dom);
    });
    return base.filter((d) => lote.dias[diaSemanaSegunda(d)]);
  })();

  const aplicarLote = () => {
    const temHorario = lote.entrada && lote.saida;
    if (lote.turno === '' && !temHorario) { showToast?.('Escolha um turno (ou DSR) ou informe entrada e saída.', 'info'); return; }
    if ((lote.entrada && !lote.saida) || (!lote.entrada && lote.saida)) { showToast?.('Informe entrada e saída juntas.', 'info'); return; }
    if (!datasAlvo.length) { showToast?.('Nenhum dia da semana marcado no período escolhido.', 'info'); return; }
    setPend((p) => {
      const novo = { ...p };
      alvos.forEach((o) => datasAlvo.forEach((data) => {
        const k = chave(o.id_usuario, data);
        const base = { ...(novo[k] || {}) };
        if (lote.turno !== '') { delete base.entrada; delete base.saida; base.id_turno = lote.turno === 'dsr' ? null : Number(lote.turno); }
        const idFinal = 'id_turno' in base ? base.id_turno : itemDe(o.id_usuario, data)?.id_turno ?? null;
        if (temHorario && turnos[idFinal]?.tipo === 'TRABALHO') { base.entrada = lote.entrada; base.saida = lote.saida; }
        novo[k] = base;
      }));
      return novo;
    });
    showToast?.(`Aplicado a ${alvos.length} colaborador(es) em ${datasAlvo.length} dia(s). Revise e clique em "Salvar".`, 'success');
  };

  const salvar = async () => {
    setOcupado(true);
    try {
      const itensSalvar = celulasAlteradas.filter((c) => c.escala && (turnoIdDe(c.id, c.data) !== null || itemDe(c.id, c.data))).map((c) => ({
        id_operador: c.id, data: c.data, id_turno: turnoIdDe(c.id, c.data), versao_linha: itemDe(c.id, c.data)?.versao_linha ?? null,
        ajustar_horario: true, entrada: ajustado(c.id, c.data) ? entradaDe(c.id, c.data) : '', saida: ajustado(c.id, c.data) ? saidaDe(c.id, c.data) : '',
      }));
      for (let i = 0; i < itensSalvar.length; i += 1000) {
        await salvarItensEscalaWfm({ operacao, ano_mes: anoMes, itens: itensSalvar.slice(i, i + 1000), justificativa });
      }
      for (const c of celulasAlteradas.filter((x) => x.extra)) {
        await lancarHoraExtraWfm({ operacao, id_operador: c.id, data: c.data, minutos: Number(pend[chave(c.id, c.data)].he) || 0, observacao: '' });
      }
      for (const c of celulasAlteradas.filter((x) => x.pres && pend[chave(x.id, x.data)].pres)) {
        await lancarPresencaWfm({ operacao, id_operador: c.id, data: c.data, status: pend[chave(c.id, c.data)].pres });
      }
      // Pausas editadas à mão (por dia), depois a programação automática de quem ficou sem pausas.
      const porDia = {};
      celulasAlteradas.filter((x) => x.pausas).forEach((c) => { (porDia[c.data] = porDia[c.data] || []).push({ id_operador: c.id, pausas: pend[chave(c.id, c.data)].pausas }); });
      for (const [data, lista] of Object.entries(porDia)) await salvarPausasWfm({ operacao, data, itens: lista });
      let msg = '';
      if (programarPausas) {
        const datas = [...new Set(itensSalvar.filter((i) => i.id_turno !== null).map((i) => i.data))].sort();
        let feitos = 0;
        for (const data of datas) { try { const r = await distribuirPausasWfm({ operacao, data }); if (r.operadores) feitos += 1; } catch { /* dia fechado ou sem escalados */ } }
        if (datas.length) msg = ` Pausas programadas em ${feitos} dia(s).`;
      }
      showToast?.(`${celulasAlteradas.length} alteração(ões) salva(s).${msg}`, 'success');
      setJustificativa('');
      await carregar();
    } catch (err) {
      showToast?.(err?.message || 'Não foi possível salvar.', 'error');
      await carregar();
    } finally { setOcupado(false); }
  };

  const publicar = async () => {
    setOcupado(true);
    try {
      const r = await publicarEscalaWfm({ operacao, ano_mes: anoMes, justificativa });
      showToast?.(`Escala publicada (versão ${r.versao}).`, 'success');
      setJustificativa('');
      setPedirJust(false);
      await carregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível publicar.', 'error'); setPedirJust(true); } finally { setOcupado(false); }
  };

  const salvarCapacidade = async () => {
    try { await definirCapacidadePausasWfm({ operacao, pausas_simultaneas: Number(capacidade) }); showToast?.('Limite de pausas atualizado.', 'success'); await carregarPausas(); }
    catch (err) { showToast?.(err?.message || 'Não foi possível salvar o limite.', 'error'); }
  };

  const mover = (n) => { const d = doIso(dia); d.setDate(d.getDate() + n); const iso = paraIso(d); if (iso.startsWith(anoMes)) setDia(iso); };
  const rotuloEscopo = { dia: `${br(dia).slice(0, 5)}`, semana: 'a semana', mes: 'o mês' }[lote.escopo];
  const ordensPausa = (pausasDia?.pausas_padrao || [{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }]).map((p) => p.ordem);
  const excedentes = pausasDia?.excedentes || [];
  const nomeOperacao = (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao;
  const nomeEscala = dados.nome_escala || nomeOperacao;

  const pendentes = celulasAlteradas.length;
  const bloqueioPublicar = pendentes > 0 ? 'Salve as alterações antes de publicar.' : (!fechada && dados.aprovacao?.estado !== 'APROVADA') ? 'A escala precisa ser aprovada pelo Gestor ou Supervisor antes de publicar.' : '';
  return html`
    <section class="mon-card wfm-escala">
      <div class="wfm-cabecalho wfm-cabecalho--centro">
        <div><h3>${nomeEscala}</h3>
          <p class="wfm-resumo-linha"><span class="mon-badge mon-badge--ok">${escalados} escalado(s)</span><span class="mon-badge mon-badge--nula">${dados.operadores.length - escalados} em DSR/folga</span>${dados.status.versao_publicada ? html`<span class="mon-badge mon-badge--pendente">Publicada v${dados.status.versao_publicada}</span>` : null}</p></div>
        <div class="wfm-acoes-cab">
          ${aoVoltarLista ? html`<button type="button" class="btn btn-outline-secondary btn-sm" onClick=${aoVoltarLista}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('arrow_back')}</span>Escalas</button>` : null}
          <span class="wfm-acoes-direita"><${MenuCompartilharEscala} operacao=${operacao} anoMes=${anoMes} dados=${dados} nomeOperacao=${nomeEscala} showToast=${showToast} aoVerMes=${aoVerMes} aoConfigurar=${() => setConfigurando(true)} /></span>
        </div>
      </div>

      <${PainelAprovacao} operacao=${operacao} anoMes=${anoMes} aprovacao=${dados.aprovacao} onMudou=${carregar} showToast=${showToast} desabilitado=${pendentes > 0} />

      <div class="wfm-barra-dia">
        <div class="wfm-navdia" role="group" aria-label="Escolher o dia">
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Dia anterior" disabled=${dia <= `${anoMes}-01`} onClick=${() => mover(-1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_left')}</span></button>
          <input class="form-control wfm-data" type="date" aria-label="Dia" value=${dia} min=${`${anoMes}-01`} max=${dados.dias[dados.dias.length - 1]} onChange=${(e) => e.target.value && e.target.value.startsWith(anoMes) && setDia(e.target.value)} />
          <button type="button" class="btn btn-outline-secondary btn-sm" aria-label="Próximo dia" onClick=${() => mover(1)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('chevron_right')}</span></button>
          <strong class="wfm-dia-extenso">${SEMANA[d0.getDay()]}, ${br(dia)}</strong>
        </div>
        <div class="wfm-ferramentas">
          ${editavel ? html`<button type="button" class=${`btn btn-sm ${verMassa ? 'btn-primary' : 'btn-outline-secondary'}`} aria-expanded=${verMassa} onClick=${() => setVerMassa(!verMassa)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('edit_calendar')}</span>Preencher em massa</button>` : null}
          <button type="button" class=${`btn btn-sm ${verTurnos ? 'btn-primary' : 'btn-outline-secondary'}`} aria-expanded=${verTurnos} onClick=${() => setVerTurnos(!verTurnos)}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('schedule')}</span>Turnos${podeCadastros ? ' e pausas' : ''}</button>
        </div>
      </div>

      ${verTurnos ? html`<div class="wfm-turnos-faixa">
        <span class="wfm-turnos-rotulo">Turnos</span>
        ${turnosSelecionaveis.map((t) => html`<button key=${t.id_turno} type="button" class="wfm-turno-pill" disabled=${!podeCadastros} title=${t.entrada ? `${t.nome} · ${t.entrada}–${t.saida} · ${minutosParaHoras(t.minutos || 0)}${podeCadastros ? ' (clique para editar)' : ''}` : t.nome} onClick=${() => setModalTurno(turnoParaEdicao(t))}>
          <span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span><span>${t.entrada ? `${t.entrada}–${t.saida}` : t.nome}</span></button>`)}
        ${podeCadastros ? html`<button type="button" class="wfm-turno-pill wfm-turno-pill--novo" onClick=${() => setModalTurno({ ...TURNO_VAZIO, pausas: [] })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo turno</button>` : null}
        ${podeCadastros && pausasDia ? html`<span class="wfm-capacidade"><label for="wfm-cap">Em pausa ao mesmo tempo</label><input id="wfm-cap" class="form-control" type="number" min="1" max="200" value=${capacidade} onInput=${(e) => setCapacidade(e.target.value)} />${Number(capacidade) !== pausasDia.capacidade ? html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${salvarCapacidade}>OK</button>` : null}</span>` : null}
      </div>` : null}

      ${editavel && verMassa ? html`<div class="wfm-lote-dia">
        <div class="wfm-lote-dia-linha">
          <strong>Aplicar a ${marcados.length ? `${marcados.length} selecionado(s)` : `todos os ${visiveis.length} exibidos`}</strong>
          <label class="wfm-campo"><span>Turno</span><select class="form-select" value=${lote.turno} onChange=${(e) => setLote({ ...lote, turno: e.target.value })}><option value="">Manter</option>${turnosSelecionaveis.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}<option value="dsr">DSR (sem turno)</option></select></label>
          <label class="wfm-campo"><span>Entrada</span><input class="form-control" type="time" value=${lote.entrada} onInput=${(e) => setLote({ ...lote, entrada: e.target.value })} /></label>
          <label class="wfm-campo"><span>Saída</span><input class="form-control" type="time" value=${lote.saida} onInput=${(e) => setLote({ ...lote, saida: e.target.value })} /></label>
          <label class="wfm-campo"><span>Em</span><select class="form-select" value=${lote.escopo} onChange=${(e) => setLote({ ...lote, escopo: e.target.value })}><option value="dia">Só este dia</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select></label>
          <button type="button" class="btn btn-primary btn-sm" onClick=${aplicarLote}>Aplicar em ${rotuloEscopo}</button>
          ${lote.escopo !== 'dia' ? html`<span class="wfm-dias-chips" role="group" aria-label="Dias da semana atingidos">${SEMANA_CURTA.map((nome, i) => html`<button key=${nome} type="button" class=${`wfm-dia-chip ${lote.dias[i] ? 'is-ativo' : ''}`} aria-pressed=${lote.dias[i]} onClick=${() => setLote({ ...lote, dias: lote.dias.map((v, j) => (j === i ? !v : v)) })}>${nome}</button>`)}<span class="wfm-contagem-dias">${datasAlvo.length} dia(s)</span></span>` : null}
        </div>
        <p class="mon-muted wfm-dica">Marque colaboradores na tabela para aplicar só a eles; sem seleção, vale para todos os exibidos.</p>
      </div>` : null}

      <div class="wfm-filtros-escala wfm-filtros-escala--compacto">
        <label class="mon-campo"><span>Buscar colaborador</span><input class="form-control" value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Nome" /></label>
        <label class="mon-campo"><span>Supervisor</span><select class="form-select" value=${filtroSup} onChange=${(e) => setFiltroSup(e.target.value)}><option value="">Todos</option>${supervisores.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select></label>
        <label class="mon-campo"><span>Equipe</span><select class="form-select" value=${filtroEquipe} onChange=${(e) => setFiltroEquipe(e.target.value)}><option value="">Todas</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select></label>
        <span class="wfm-contagem">${visiveis.length} de ${dados.operadores.length} colaborador(es)</span>
      </div>

      ${excedentes.length ? html`<div class="wfm-validacao is-alerta" role="status"><strong>Mais operadores em pausa do que o limite</strong>
        <ul>${excedentes.slice(0, 6).map((x, i) => html`<li key=${i}>${x.inicio}–${x.fim}: ${x.qtd} em pausa (limite ${x.capacidade})</li>`)}</ul></div>` : null}

      <div class="mon-tabela-wrap"><table class="mon-tabela wfm-tabela wfm-tabela-dia">
        <thead><tr>
          ${editavel ? html`<th class="wfm-col-sel-dia"><input type="checkbox" aria-label="Selecionar todos os exibidos" checked=${todosSel} onChange=${() => setSel(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_usuario, true])))} /></th>` : null}
          <th>Colaborador</th><th>Turno</th><th>Horário</th><th>Pausas</th><th>Presença</th><th title="Hora extra do dia (minutos) e total no mês">Hora extra</th>
        </tr></thead>
        <tbody>
          ${visiveis.map((o) => { const id = o.id_usuario; const t = turnoDe(id, dia); const trab = trabalha(id, dia); const m = mudou(id, dia);
            const pausas = pausasDe(id, dia); const salvaTrab = escalaSalva(id, dia) && !m.escala; const pres = presencaDe(id, dia);
            return html`<tr key=${id} class=${m.escala || m.extra || m.pres || m.pausas ? 'is-pendente' : ''}>
              ${editavel ? html`<td class="wfm-col-sel-dia"><input type="checkbox" aria-label=${`Selecionar ${o.nome}`} checked=${!!sel[id]} onChange=${() => setSel({ ...sel, [id]: !sel[id] })} /></td>` : null}
              <td><span class="wfm-nome-dia">${o.nome}</span><small class="wfm-sup-dia">${(o.supervisores || []).map((s) => s.nome.split(' ')[0]).join(', ')}</small></td>
              <td>${editavel ? html`<select class="form-select wfm-turno-in" aria-label=${`Turno de ${o.nome}`} value=${turnoIdDe(id, dia) ?? ''} onChange=${(e) => mudarTurno(id, dia, e.target.value)}><option value="">DSR</option>${turnosSelecionaveis.map((x) => html`<option key=${x.id_turno} value=${x.id_turno}>${x.codigo}</option>`)}</select>` : (t ? html`<span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span>` : html`<span class="wfm-dsr">DSR</span>`)}</td>
              <td>${trab ? html`<span class="wfm-horario">
                <input class=${`form-control wfm-hora-in ${ajustado(id, dia) ? 'is-ajustado' : ''}`} type="time" aria-label=${`Entrada de ${o.nome}`} disabled=${!editavel} value=${entradaDe(id, dia)} onInput=${(e) => mudarHorario(id, dia, 'entrada', e.target.value)} />
                <span class="wfm-ate" aria-hidden="true">–</span>
                <input class=${`form-control wfm-hora-in ${ajustado(id, dia) ? 'is-ajustado' : ''}`} type="time" aria-label=${`Saída de ${o.nome}`} disabled=${!editavel} value=${saidaDe(id, dia)} onInput=${(e) => mudarHorario(id, dia, 'saida', e.target.value)} />
                <small class="wfm-duracao" title="Duração da jornada">${minutosParaHoras(duracao(entradaDe(id, dia), saidaDe(id, dia)))}</small></span>` : html`<span class="mon-muted">—</span>`}</td>
              <td class="wfm-col-pausas">${trab ? (salvaTrab || m.pausas) ? (pausas.length
                ? html`<span class="wfm-pausas-in">${ordensPausa.map((ord) => { const p = pausas.find((x) => x.ordem === ord); return p ? html`<input key=${ord} class="form-control wfm-pausa-in" type="time" disabled=${!editavel} title=${`Pausa ${ord} · ${ROTULO_PAUSA[p.tipo] || 'Pausa'} ${p.duracao_min} min`} aria-label=${`Pausa ${ord} de ${o.nome}`} value=${p.inicio} onInput=${(e) => mudarPausa(id, dia, ord, e.target.value)} />` : null; })}</span>`
                : (editavel ? html`<button type="button" class="wfm-link" onClick=${() => definirPausas(id, dia)}>Definir</button>` : html`<span class="mon-muted">—</span>`))
                : html`<span class="mon-muted" title="As pausas são programadas ao salvar">ao salvar</span>` : html`<span class="mon-muted">—</span>`}</td>
              <td>${trab ? html`<select class=${`wfm-select wfm-pres-sel wfm-pres-${pres.toLowerCase()}`} aria-label=${`Presença de ${o.nome}`} disabled=${!podePresenca} value=${pres} onChange=${(e) => mudar(id, dia, { pres: e.target.value })}><option value="">·</option>${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k} title=${ROTULO_STATUS_PRESENCA[k]}>${s}</option>`)}</select>` : '—'}</td>
              <td>${trab ? html`<span class="wfm-extra">${podePresenca ? html`<input class="form-control wfm-min-in" type="number" min="0" max="720" step="5" aria-label=${`Hora extra de ${o.nome} (minutos)`} title="Minutos de hora extra neste dia" value=${extraDe(id, dia) || ''} placeholder="min" onInput=${(e) => mudar(id, dia, { he: Number(e.target.value) || 0 })} />` : html`<span>${extraDe(id, dia) || '—'}</span>`}${extraMes(id) ? html`<small class="wfm-duracao" title="Total de hora extra no mês">mês ${minutosParaHoras(extraMes(id))}</small>` : null}</span>` : '—'}</td>
            </tr>`; })}
        </tbody>
      </table></div>
      <div class="wfm-legenda-pres">${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<span key=${k}><span class=${`wfm-pres wfm-pres-${k.toLowerCase()}`}>${s}</span>${ROTULO_STATUS_PRESENCA[k]}</span>`)}<span><span class="wfm-dsr">DSR</span>Dia sem turno</span></div>

      ${(fechada && editavel && pendentes) || pedirJust ? html`<label class="wfm-campo wfm-just"><span>${pedirJust ? 'Justificativa (para publicar com violação ou após o fechamento)' : 'Justificativa (período fechado)'}</span><input class="form-control" maxlength="400" value=${justificativa} onInput=${(e) => setJustificativa(e.target.value)} /></label>` : null}
      <div class="wfm-acoes wfm-acoes--rodape wfm-barra-salvar">
        <span class="wfm-barra-status">${pendentes ? `${pendentes} alteração(ões) não salva(s)` : 'Tudo salvo'}</span>
        ${editavel ? html`<label class="wfm-check"><input type="checkbox" checked=${programarPausas} onChange=${(e) => setProgramarPausas(e.target.checked)} /> Programar pausas de quem ficar sem</label>` : null}
        ${pendentes ? html`<button type="button" class="btn btn-outline-secondary" onClick=${() => setPend({})}>Descartar</button>` : null}
        <button type="button" class="btn btn-primary" disabled=${ocupado || !pendentes || (fechada && !justificativa.trim())} onClick=${salvar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>Salvar${pendentes ? ` (${pendentes})` : ''}</button>
        ${podePublicar ? html`<button type="button" class="btn btn-outline-primary wfm-publicar" disabled=${ocupado || pendentes > 0 || (!fechada && dados.aprovacao?.estado !== 'APROVADA')} title=${bloqueioPublicar} onClick=${publicar}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('event_available')}</span>Publicar</button>` : null}
      </div>
    </section>
    ${configurando ? html`<${ModalConfigEscala} operacao=${operacao} nomePadrao=${nomeOperacao} showToast=${showToast} onClose=${() => setConfigurando(false)} onSalvo=${() => { setConfigurando(false); setVersaoLista((v) => v + 1); carregar(); }} onMudouLista=${() => { setConfigurando(false); aoVoltarLista?.(); }} />` : null}
    ${modalTurno ? html`<${ModalTurno} operacao=${operacao} inicial=${modalTurno} contratos=${contratos} supervisores=${supervisoresOp} showToast=${showToast} onClose=${() => setModalTurno(null)} onSalvo=${() => { setModalTurno(null); carregar(); }} />` : null}`;
}
