import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import { EmptyState, LoadingState } from '../../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../../ui/icone.js';
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
  replicarPausasWfm,
  salvarItensEscalaWfm,
  salvarPausasWfm,
} from '../../../services/api/wfm.js';
import { SIGLA_PRESENCA, ROTULO_STATUS_PRESENCA, minutosParaHoras } from './comum.js';
import { ModalTurno, TURNO_VAZIO, turnoParaEdicao } from './cadastros.js';
import { PainelAprovacao } from './aprovacao.js?v=20261007-admin-escala';
import { MenuCompartilharEscala } from './compartilhar.js?v=20261007-admin-escala';
import { ModalConfigEscala } from './configuracao.js';
import { GavetaAjusteDia } from './ajuste.js';
import { BarraSelecao, CheckTodos, FiltrosCompactos, Icone, SeletorTurnoLinha, SeletorVisao, TituloEscala, Quadrado, faixaTurno, semAcento } from './escala-ui.js';
import { LinhaTempo } from './minha.js?v=20261007-admin-escala';

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
  // Replicar as pausas do dia: semana ou mês, só nos dias da semana marcados (0 = segunda).
  const [lotePausas, setLotePausas] = useState({ escopo: 'mes', dias: [true, true, true, true, true, true, true], sobrescrever: true });
  const [verPausasLote, setVerPausasLote] = useState(false);
  const [filtroSup, setFiltroSup] = useState('');
  const [filtroEquipe, setFiltroEquipe] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [turnoTodos, setTurnoTodos] = useState('');
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
  const [filtroTurno, setFiltroTurno] = useState(''); // '' = todos | 'dsr' | id do turno
  const [limite, setLimite] = useState(50);
  const [gaveta, setGaveta] = useState(null); // { id, nome, data, secao }
  const [editHor, setEditHor] = useState(null); // id do colaborador com o horário em edição inline
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

  const visiveis = dados.operadores.filter((o) => (!filtroEquipe || String(o.id_equipe || '') === filtroEquipe)
    && (!filtroSup || (o.supervisores || []).some((s) => String(s.id_usuario) === filtroSup))
    && (!filtroCargo || (o.cargo || '') === filtroCargo)
    && (!filtroTurno || (filtroTurno === 'dsr' ? turnoIdDe(o.id_usuario, dia) == null : String(turnoIdDe(o.id_usuario, dia)) === filtroTurno))
    && (!busca || semAcento(o.nome).includes(semAcento(busca.trim()))));
  const cargos = [...new Set(dados.operadores.map((o) => o.cargo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

  // Barra de ações em massa: o turno (ou DSR) vai só para os colaboradores marcados; fica pendente até clicar em Salvar.
  const aplicarTurnoTodos = () => {
    if (turnoTodos === '') { showToast?.('Escolha o turno que será aplicado.', 'info'); return; }
    marcados.forEach((o) => mudarTurno(o.id_usuario, dia, turnoTodos === 'dsr' ? '' : turnoTodos));
    showToast?.(`Turno aplicado a ${marcados.length} colaborador(es) em ${br(dia).slice(0, 5)}. Revise e clique em "Salvar".`, 'success');
  };

  // Replicar as pausas deste dia: período = semana (seg–dom) ou mês, sempre dentro do mês aberto; filtra pelos dias marcados.
  const periodoPausas = (() => {
    const primeiro = dados.dias[0]; const ultimo = dados.dias[dados.dias.length - 1];
    if (lotePausas.escopo === 'mes') return [primeiro, ultimo];
    const seg = new Date(d0); seg.setDate(seg.getDate() - diaSemanaSegunda(dia));
    const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
    return [paraIso(seg) < primeiro ? primeiro : paraIso(seg), paraIso(dom) > ultimo ? ultimo : paraIso(dom)];
  })();
  const diasDasPausas = dados.dias.filter((x) => x >= periodoPausas[0] && x <= periodoPausas[1] && x !== dia && lotePausas.dias[diaSemanaSegunda(x)]);
  const pausasDoDiaDefinidas = (pausasDia?.operadores || []).some((o) => o.pausas.length);
  const replicarPausas = async () => {
    if (!diasDasPausas.length) { showToast?.('Nenhum dia da semana marcado no período escolhido.', 'info'); return; }
    setOcupado(true);
    try {
      const r = await replicarPausasWfm({
        operacao, data_origem: dia, data_ini: periodoPausas[0], data_fim: periodoPausas[1],
        dias_semana: lotePausas.dias.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
        ids: marcados.length ? marcados.map((o) => o.id_usuario) : null, sobrescrever: lotePausas.sobrescrever,
      });
      const extras = [
        r.deslocadas ? `${r.deslocadas} pausa(s) ajustada(s) de horário para respeitar o limite de ${r.capacidade} em pausa ao mesmo tempo` : '',
        r.dias_com_excesso ? `${r.dias_com_excesso} dia(s) ainda acima do limite (sem horário livre)` : '',
        r.periodos_fechados ? `${r.periodos_fechados} dia(s) em período fechado foram pulados` : '',
      ].filter(Boolean).join('; ');
      showToast?.(`Pausas aplicadas em ${r.dias_programados} dia(s)${extras ? ` — ${extras}` : ''}.`, r.dias_com_excesso ? 'info' : 'success');
      await carregar();
    } catch (err) { showToast?.(err?.message || 'Não foi possível aplicar as pausas.', 'error'); } finally { setOcupado(false); }
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
  const abrirGaveta = (o, secao) => setGaveta({ id: o.id_usuario, nome: o.nome, data: dia, secao });
  const mostradas = visiveis.slice(0, limite);
  const hojeIso = paraIso(new Date());
  const alternarTodos = () => setSel(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_usuario, true])));
  const menuAcoes = html`<${MenuCompartilharEscala} operacao=${operacao} anoMes=${anoMes} dados=${dados} nomeOperacao=${nomeEscala} showToast=${showToast} aoVerMes=${aoVerMes} aoConfigurar=${() => setConfigurando(true)} />`;

  return html`
    <section class="mon-card wfm-escala ea-raiz">
      <${TituloEscala} nome=${nomeEscala} escalados=${escalados} emDsr=${dados.operadores.length - escalados} versao=${dados.status.versao_publicada} aoVoltarLista=${aoVoltarLista} menu=${menuAcoes} />

      <${PainelAprovacao} operacao=${operacao} anoMes=${anoMes} aprovacao=${dados.aprovacao} onMudou=${carregar} showToast=${showToast} desabilitado=${pendentes > 0} compacto />

      <div class="ea-nav">
        <div class="ea-nav-esq">
          <${SeletorVisao} visao="dia" aoMes=${aoVerMes} />
          <div class="ea-dia-nav" role="group" aria-label="Escolher o dia">
            <button type="button" class="ea-icone-btn" aria-label="Dia anterior" disabled=${dia <= `${anoMes}-01`} onClick=${() => mover(-1)}><${Icone} nome="chevron_left" /></button>
            <label class="ea-data"><${Icone} nome="calendar_month" /><span class="ea-num">${SEMANA[d0.getDay()]}, ${br(dia)}</span>
              <input class="ea-data-input" type="date" aria-label="Escolher data" onClick=${(e) => e.target.showPicker?.()} value=${dia} min=${`${anoMes}-01`} max=${dados.dias[dados.dias.length - 1]} onChange=${(e) => e.target.value && e.target.value.startsWith(anoMes) && setDia(e.target.value)} /></label>
            <button type="button" class="ea-icone-btn" aria-label="Próximo dia" disabled=${dia >= dados.dias[dados.dias.length - 1]} onClick=${() => mover(1)}><${Icone} nome="chevron_right" /></button>
            <button type="button" class="btn btn-outline-secondary ea-btn-44" disabled=${!hojeIso.startsWith(anoMes) || dia === hojeIso} onClick=${() => setDia(hojeIso)}>Hoje</button>
          </div>
        </div>
        <button type="button" class=${`btn btn-outline-secondary ea-btn-44 ${verTurnos ? 'is-ativo' : ''}`} aria-expanded=${verTurnos} onClick=${() => setVerTurnos(!verTurnos)}><${Icone} nome="schedule" />Turnos e pausas</button>
      </div>

      ${verTurnos ? html`<div class="wfm-turnos-faixa">
        <span class="wfm-turnos-rotulo">Turnos</span>
        ${turnosSelecionaveis.map((t) => html`<button key=${t.id_turno} type="button" class="wfm-turno-pill" disabled=${!podeCadastros} title=${t.entrada ? `${t.nome} · ${t.entrada}–${t.saida} · ${minutosParaHoras(t.minutos || 0)}${podeCadastros ? ' (clique para editar)' : ''}` : t.nome} onClick=${() => setModalTurno(turnoParaEdicao(t))}>
          <span class="wfm-chip" style=${{ '--wfm-cor': t.cor }}>${t.codigo}</span><span>${t.entrada ? `${t.entrada}–${t.saida}` : t.nome}</span></button>`)}
        ${podeCadastros ? html`<button type="button" class="wfm-turno-pill wfm-turno-pill--novo" onClick=${() => setModalTurno({ ...TURNO_VAZIO, pausas: [] })}><span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('add')}</span>Novo turno</button>` : null}
        ${podeCadastros && pausasDia ? html`<span class="wfm-capacidade"><label for="wfm-cap">Em pausa ao mesmo tempo</label><input id="wfm-cap" class="form-control" type="number" min="1" max="200" value=${capacidade} onInput=${(e) => setCapacidade(e.target.value)} />${Number(capacidade) !== pausasDia.capacidade ? html`<button type="button" class="btn btn-outline-primary btn-sm" onClick=${salvarCapacidade}>OK</button>` : null}</span>` : null}
      </div>` : null}

      <${FiltrosCompactos} rotuloBusca="Buscar colaborador" busca=${busca} aoBuscar=${setBusca} contagem=${`${visiveis.length} de ${dados.operadores.length} colaborador(es)`}
        selects=${[
          { rotulo: 'Supervisor', padrao: 'Supervisor: todos', valor: filtroSup, aoMudar: setFiltroSup, largura: 'g', opcoes: supervisores.map(([id, nome]) => [String(id), nome]) },
          { rotulo: 'Equipe', padrao: 'Equipe: todas', valor: filtroEquipe, aoMudar: setFiltroEquipe, largura: 'm', opcoes: equipes.map(([id, nome]) => [String(id), nome]) },
          { rotulo: 'Cargo', padrao: 'Cargo: todos', valor: filtroCargo, aoMudar: setFiltroCargo, largura: 'p', opcoes: cargos.map((c) => [c, c]) },
        ]} />

      <div class="ea-chips" role="group" aria-label="Filtrar por turno">
        <span class="ea-rotulo">TURNO</span>
        <button type="button" class=${`ea-chip ${filtroTurno === '' ? 'is-ativo' : ''}`} aria-pressed=${filtroTurno === ''} onClick=${() => setFiltroTurno('')}>Todos</button>
        ${turnosSelecionaveis.map((t) => html`<button key=${t.id_turno} type="button" class=${`ea-chip ${filtroTurno === String(t.id_turno) ? 'is-ativo' : ''}`} aria-pressed=${filtroTurno === String(t.id_turno)} onClick=${() => setFiltroTurno(filtroTurno === String(t.id_turno) ? '' : String(t.id_turno))}>
          <${Quadrado} cor=${t.cor} />${t.nome}${t.entrada ? html`<span class="ea-muted ea-num">${faixaTurno(t)}</span>` : null}</button>`)}
        <button type="button" class=${`ea-chip ${filtroTurno === 'dsr' ? 'is-ativo' : ''}`} aria-pressed=${filtroTurno === 'dsr'} onClick=${() => setFiltroTurno(filtroTurno === 'dsr' ? '' : 'dsr')}><${Quadrado} dsr=${true} />DSR</button>
      </div>

      ${editavel ? html`<${BarraSelecao} n=${marcados.length} aoLimpar=${() => setSel({})}>
        <label class="visually-hidden" for="ea-turno-massa">Turno a aplicar</label>
        <select id="ea-turno-massa" class="ea-campo ea-select ea-select--turno ea-campo--massa" value=${turnoTodos} onChange=${(e) => setTurnoTodos(e.target.value)}>
          <option value="">Turno…</option>${turnosSelecionaveis.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.nome}${t.entrada ? ` ${faixaTurno(t)}` : ''}</option>`)}<option value="dsr">DSR (sem turno)</option></select>
        <button type="button" class="ea-btn-sol" disabled=${turnoTodos === ''} onClick=${aplicarTurnoTodos}>Aplicar turno</button>
        <button type="button" class=${`ea-btn-ctn ${verMassa ? 'is-ativo' : ''}`} aria-expanded=${verMassa} onClick=${() => setVerMassa(!verMassa)}>Preencher em massa</button>
        <button type="button" class=${`ea-btn-ctn ${verPausasLote ? 'is-ativo' : ''}`} aria-expanded=${verPausasLote} onClick=${() => setVerPausasLote(!verPausasLote)}>Replicar pausas</button>
      <//>` : null}

      ${editavel && marcados.length && verPausasLote ? html`<div class="wfm-lote-dia wfm-lote-pausas ea-painel-massa">
        <div class="wfm-lote-dia-linha">
          <strong>Replicar as pausas de ${br(dia).slice(0, 5)} (${SEMANA[d0.getDay()]})</strong>
          <label class="wfm-campo"><span>Em</span><select class="form-select" value=${lotePausas.escopo} onChange=${(e) => setLotePausas({ ...lotePausas, escopo: e.target.value })}><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select></label>
          <button type="button" class="btn btn-primary btn-sm" disabled=${ocupado || pendentes > 0 || !pausasDoDiaDefinidas || !diasDasPausas.length} onClick=${replicarPausas}>Aplicar pausas</button>
          <span class="wfm-dias-chips" role="group" aria-label="Dias da semana em que as pausas se aplicam">${SEMANA_CURTA.map((nome, i) => html`<button key=${nome} type="button" class=${`wfm-dia-chip ${lotePausas.dias[i] ? 'is-ativo' : ''}`} aria-pressed=${lotePausas.dias[i]} onClick=${() => setLotePausas({ ...lotePausas, dias: lotePausas.dias.map((v, j) => (j === i ? !v : v)) })}>${nome}</button>`)}<span class="wfm-contagem-dias">${diasDasPausas.length} dia(s)</span></span>
          <label class="wfm-check"><input type="checkbox" checked=${lotePausas.sobrescrever} onChange=${(e) => setLotePausas({ ...lotePausas, sobrescrever: e.target.checked })} /> Substituir pausas já programadas</label>
        </div>
        <p class="mon-muted wfm-dica">${pendentes > 0 ? 'Salve as alterações do dia antes de replicar as pausas.' : !pausasDoDiaDefinidas ? 'Defina e salve as pausas deste dia primeiro: elas servem de modelo.' : `Copia os horários de pausa de ${marcados.length} selecionado(s) para os dias marcados em que o colaborador trabalha. Vários colaboradores podem pausar no mesmo horário até o limite${pausasDia ? ` de ${pausasDia.capacidade}` : ''}; só o que passar do limite é deslocado para o horário livre mais próximo.`}</p>
      </div>` : null}

      ${editavel && marcados.length && verMassa ? html`<div class="wfm-lote-dia ea-painel-massa">
        <div class="wfm-lote-dia-linha">
          <strong>Aplicar a ${marcados.length} selecionado(s)</strong>
          <label class="wfm-campo"><span>Turno</span><select class="form-select" value=${lote.turno} onChange=${(e) => setLote({ ...lote, turno: e.target.value })}><option value="">Manter</option>${turnosSelecionaveis.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}<option value="dsr">DSR (sem turno)</option></select></label>
          <label class="wfm-campo"><span>Entrada</span><input class="form-control" type="time" value=${lote.entrada} onInput=${(e) => setLote({ ...lote, entrada: e.target.value })} /></label>
          <label class="wfm-campo"><span>Saída</span><input class="form-control" type="time" value=${lote.saida} onInput=${(e) => setLote({ ...lote, saida: e.target.value })} /></label>
          <label class="wfm-campo"><span>Em</span><select class="form-select" value=${lote.escopo} onChange=${(e) => setLote({ ...lote, escopo: e.target.value })}><option value="dia">Só este dia</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select></label>
          <button type="button" class="btn btn-primary btn-sm" onClick=${aplicarLote}>Aplicar em ${rotuloEscopo}</button>
          ${lote.escopo !== 'dia' ? html`<span class="wfm-dias-chips" role="group" aria-label="Dias da semana atingidos">${SEMANA_CURTA.map((nome, i) => html`<button key=${nome} type="button" class=${`wfm-dia-chip ${lote.dias[i] ? 'is-ativo' : ''}`} aria-pressed=${lote.dias[i]} onClick=${() => setLote({ ...lote, dias: lote.dias.map((v, j) => (j === i ? !v : v)) })}>${nome}</button>`)}<span class="wfm-contagem-dias">${datasAlvo.length} dia(s)</span></span>` : null}
        </div>
      </div>` : null}

      ${excedentes.length ? html`<div class="wfm-validacao is-alerta ea-alerta" role="status"><strong>Mais operadores em pausa do que o limite</strong>
        <ul>${excedentes.slice(0, 6).map((x, i) => html`<li key=${i}>${x.inicio}–${x.fim}: ${x.qtd} em pausa (limite ${x.capacidade})</li>`)}</ul></div>` : null}

      <div class="ea-tabela">
        <div class="ea-rolagem" role="region" aria-label="Escala do dia" tabindex="0">
          <table class=${`ea-tab ${editavel ? 'ea-tab--sel' : ''}`}>
            <colgroup>${editavel ? html`<col style=${{ width: '44px' }} />` : null}<col /><col style=${{ width: '170px' }} /><col style=${{ width: '200px' }} /><col style=${{ width: '230px' }} /><col style=${{ width: '100px' }} /><col style=${{ width: '120px' }} /></colgroup>
            <thead><tr>
              ${editavel ? html`<th scope="col" class="ea-c-sel"><${CheckTodos} rotulo="Selecionar todos os colaboradores" total=${visiveis.length} marcados=${marcados.length} aoAlternar=${alternarTodos} /></th>` : null}
              <th scope="col" class="ea-c-nome">Colaborador</th><th scope="col">Turno</th><th scope="col">Horário</th><th scope="col">Pausas</th><th scope="col">Presença</th><th scope="col">Hora extra</th>
            </tr></thead>
            <tbody>
              ${mostradas.length ? mostradas.map((o) => { const id = o.id_usuario; const t = turnoDe(id, dia); const trab = trabalha(id, dia); const m = mudou(id, dia);
                const pausas = pausasDe(id, dia); const salvaTrab = escalaSalva(id, dia) && !m.escala; const pres = presencaDe(id, dia);
                const turnoLinha = t && t.tipo !== 'DSR' ? t : null;
                const pausasItem = { entrada: entradaDe(id, dia), saida: saidaDe(id, dia), pausas };
                return html`<tr key=${id} class=${`${sel[id] ? 'is-sel' : ''} ${m.escala || m.extra || m.pres || m.pausas ? 'is-pendente' : ''}`.trim()}>
                  ${editavel ? html`<td class="ea-c-sel"><input type="checkbox" class="ea-check" aria-label=${`Selecionar ${o.nome}`} checked=${!!sel[id]} onChange=${() => setSel({ ...sel, [id]: !sel[id] })} /></td>` : null}
                  <td class="ea-c-nome"><span class="ea-nome" title=${o.nome}>${o.nome}</span><span class="ea-sup">${(o.supervisores || []).map((s) => s.nome.split(' ')[0]).join(', ')}</span></td>
                  <td>${editavel
                    ? html`<${SeletorTurnoLinha} turno=${turnoLinha} turnos=${turnosSelecionaveis} rotuloAria=${`Alterar turno de ${o.nome}`} aoEscolher=${(v) => mudarTurno(id, dia, v)} />`
                    : html`<span class="ea-turno-ro"><${Quadrado} cor=${turnoLinha?.cor} dsr=${!turnoLinha} />${turnoLinha ? turnoLinha.nome : 'DSR'}</span>`}</td>
                  <td><${CelulaHorario} nome=${o.nome} trab=${trab} editavel=${editavel} entrada=${entradaDe(id, dia)} saida=${saidaDe(id, dia)} ajustado=${ajustado(id, dia)}
                    editando=${editHor === id} aoEditar=${(v) => setEditHor(v ? id : null)} aoMudar=${(campo, valor) => mudarHorario(id, dia, campo, valor)} /></td>
                  <td>${!trab ? html`<span class="ea-muted">—</span>`
                    : !(salvaTrab || m.pausas) ? html`<span class="ea-muted" title="As pausas são programadas ao salvar">ao salvar</span>`
                    : pausas.length ? (editavel
                      ? html`<button type="button" class="ea-pausas-btn" aria-label=${`Editar pausas de ${o.nome}`} onClick=${() => abrirGaveta(o, 'pausas')}>${pausasItem.entrada && pausasItem.saida ? html`<${LinhaTempo} item=${pausasItem} mini />` : null}<span>${pausas.length} pausa${pausas.length > 1 ? 's' : ''}</span></button>`
                      : html`<span class="ea-pausas-ro">${pausasItem.entrada && pausasItem.saida ? html`<${LinhaTempo} item=${pausasItem} mini />` : null}<span>${pausas.length} pausa${pausas.length > 1 ? 's' : ''}</span></span>`)
                    : (editavel ? html`<button type="button" class="ea-definir" aria-label=${`Definir pausas de ${o.nome}`} onClick=${() => abrirGaveta(o, 'pausas')}><${Icone} nome="add" />Definir</button>` : html`<span class="ea-muted">—</span>`)}</td>
                  <td>${trab ? html`<select class=${`ea-campo ea-select ea-select--pres wfm-pres-${pres.toLowerCase()}`} aria-label=${`Presença de ${o.nome}`} disabled=${!podePresenca} value=${pres} onChange=${(e) => mudar(id, dia, { pres: e.target.value })}><option value="">·</option>${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k} title=${ROTULO_STATUS_PRESENCA[k]}>${s}</option>`)}</select>` : html`<span class="ea-muted">—</span>`}</td>
                  <td>${trab ? (podePresenca
                    ? html`<input class="ea-campo ea-in-min" type="number" min="0" max="720" step="5" inputmode="numeric" aria-label=${`Hora extra de ${o.nome} (minutos)`} title=${extraMes(id) ? `Minutos de hora extra neste dia. Total no mês: ${minutosParaHoras(extraMes(id))}` : 'Minutos de hora extra neste dia'} value=${extraDe(id, dia) || ''} placeholder="min" onInput=${(e) => mudar(id, dia, { he: Number(e.target.value) || 0 })} />`
                    : html`<span class="ea-num">${extraDe(id, dia) || '—'}</span>`) : html`<span class="ea-muted">—</span>`}</td>
                </tr>`; })
                : html`<tr><td class="ea-vazio" colspan=${editavel ? 7 : 6}>Nenhum colaborador encontrado com estes filtros.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="ea-rodape">
          <span class="ea-muted" aria-live="polite">Mostrando ${mostradas.length} de ${visiveis.length} colaboradores</span>
          ${mostradas.length < visiveis.length ? html`<button type="button" class="btn btn-outline-secondary ea-btn-40" onClick=${() => setLimite((l) => l + 50)}>Mostrar mais</button>` : null}
        </div>
      </div>
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
    ${gaveta && editavel ? html`<${GavetaAjusteDia} alvo=${gaveta} dados=${dados} operacao=${operacao} anoMes=${anoMes} fechada=${fechada} showToast=${showToast}
      bloqueio=${pendentes > 0 ? 'Há alterações não salvas na tela. Salve ou descarte antes de ajustar um dia.' : ''}
      aoFechar=${() => setGaveta(null)} aoSalvo=${(ok) => { if (ok) setGaveta(null); carregar(); }} />` : null}
    ${configurando ? html`<${ModalConfigEscala} operacao=${operacao} nomePadrao=${nomeOperacao} showToast=${showToast} onClose=${() => setConfigurando(false)} onSalvo=${() => { setConfigurando(false); setVersaoLista((v) => v + 1); carregar(); }} onMudouLista=${() => { setConfigurando(false); aoVoltarLista?.(); }} />` : null}
    ${modalTurno ? html`<${ModalTurno} operacao=${operacao} inicial=${modalTurno} contratos=${contratos} supervisores=${supervisoresOp} showToast=${showToast} onClose=${() => setModalTurno(null)} onSalvo=${() => { setModalTurno(null); carregar(); }} />` : null}`;
}

// Horário da linha: texto clicável (36px) que vira dois campos de hora com a duração recalculada. Edita o mesmo estado pendente de antes.
function CelulaHorario({ nome, trab, editavel, entrada, saida, ajustado, editando, aoEditar, aoMudar }) {
  const raiz = useRef(null);
  if (!trab) return html`<span class="ea-muted">—</span>`;
  const dur = minutosParaHoras(duracao(entrada, saida));
  if (!editavel) return html`<span class="ea-hor-ro"><span class="ea-hor-txt ea-num">${entrada} – ${saida}</span><span class="ea-muted">${dur}</span></span>`;
  if (!editando) {
    return html`<button type="button" class=${`ea-hor-btn ${ajustado ? 'is-ajustado' : ''}`} aria-label=${`Editar horário de ${nome}`} title=${ajustado ? 'Horário diferente do padrão do turno' : 'Editar horário'} onClick=${() => aoEditar(true)}>
      <span class="ea-hor-txt ea-num">${entrada} – ${saida}</span><span class="ea-muted">${dur}</span></button>`;
  }
  const sair = (e) => { if (!raiz.current?.contains(e.relatedTarget)) aoEditar(false); };
  return html`<span class="ea-hor-edit" ref=${raiz} onKeyDown=${(e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); aoEditar(false); } }}>
    <input type="time" class="ea-campo ea-in-hora" autoFocus aria-label=${`Entrada de ${nome}`} value=${entrada} onInput=${(e) => aoMudar('entrada', e.target.value)} onBlur=${sair} />
    <span aria-hidden="true">–</span>
    <input type="time" class="ea-campo ea-in-hora" aria-label=${`Saída de ${nome}`} value=${saida} onInput=${(e) => aoMudar('saida', e.target.value)} onBlur=${sair} />
    <span class="ea-muted" aria-live="polite">${dur}</span>
  </span>`;
}
