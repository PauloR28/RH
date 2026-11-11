import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import {
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
} from '../../../services/api/wfm.js?v=20261104-leitura';
import { SIGLA_PRESENCA, ROTULO_STATUS_PRESENCA, dataHora, falhaAo, minutosParaHoras, rotuloPresenca, siglaPresenca } from './comum.js?v=20261104-leitura';
import { ModalTurno, TURNO_VAZIO } from './cadastros.js?v=20261104-leitura';
import { MenuCompartilharEscala } from './compartilhar.js?v=20261106-wfm';
import { ModalConfigEscala } from './configuracao.js?v=20261109-proprio';
import { GavetaAjusteDia } from './ajuste.js?v=20261104-leitura';
import { faixaTurno, semAcento, useVisaoEquipes } from './escala-ui.js?v=20261104-leitura';
import { AcoesAprovacao, estadoEscala } from './escala.js?v=20261111-padrao';
import { Campo, Esqueleto, Estado, Faixa, Ic, Janela, MenuAcoes, Navegar, Segmento, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

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
const TOM_SIGLA = { PRESENTE: 'sucesso', FALTA: 'perigo', FALTA_JUSTIFICADA: 'atencao', ATESTADO: 'informacao' };

export function TelaEscalaTabela({ controlador, contexto, operacao, anoMes, showToast, aoVerMes, aoPausas, aoVoltarLista, aoMudarMes, aoTrocarEscala, opcoesEscala = null, somenteLeitura = false }) {
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
  const [configurando, setConfigurando] = useState(false);
  const [versaoLista, setVersaoLista] = useState(0);
  const [verMassa, setVerMassa] = useState(false);
  const [editHe, setEditHe] = useState(null); // id do colaborador com a hora extra em edição
  const [filtroTurno, setFiltroTurno] = useState(''); // '' = todos | 'dsr' | id do turno
  const [limite, setLimite] = useState(50);
  const [gaveta, setGaveta] = useState(null); // { id, nome, data, secao }
  const [editHor, setEditHor] = useState(null); // id do colaborador com o horário em edição inline
  const ehSupervisor = controlador.estado?.perfilUsuario === 'supervisor';
  const [todasEquipes, setTodasEquipes] = useVisaoEquipes(ehSupervisor);
  // Somente leitura: Supervisor sem 'criar escala' (só consulta) ou vendo 'Todas as equipes' (o servidor também recusa a escrita).
  const leitura = somenteLeitura || todasEquipes;
  const podePublicar = controlador.possuiPermissao('wfm.escala.publicar') && !leitura;
  const podePresenca = controlador.possuiPermissao('wfm.presenca.lancar') && !leitura;
  const podeCadastros = controlador.possuiPermissao('wfm.cadastros.editar') && !leitura;

  useEffect(() => { if (!dia.startsWith(anoMes)) setDia(`${anoMes}-01`); }, [anoMes]);

  const carregarPausas = useCallback(async () => {
    if (!operacao) return;
    try { const p = await lerPausasDiaWfm(operacao, dia, todasEquipes); setPausasDia(p); } catch { setPausasDia(null); }
  }, [operacao, dia, todasEquipes]);

  const carregar = useCallback(async () => {
    if (!operacao) return;
    setErro('');
    try {
      const [d, e, pr, c, sv] = await Promise.all([
        lerEscalaWfm(operacao, anoMes, false, todasEquipes),
        listarHorasExtrasWfm(operacao, anoMes, todasEquipes).catch(() => ({ itens: [] })),
        listarPresencasWfm(operacao, anoMes, todasEquipes).catch(() => ({ itens: [] })),
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
  }, [operacao, anoMes, carregarPausas, todasEquipes]);
  useEffect(() => { setDados(null); carregar(); }, [operacao, anoMes, todasEquipes]);
  useEffect(() => { carregarPausas(); }, [carregarPausas]);

  const turnos = useMemo(() => Object.fromEntries((dados?.turnos || []).map((t) => [t.id_turno, t])), [dados]);
  const itens = useMemo(() => Object.fromEntries((dados?.itens || []).map((i) => [chave(i.id_operador, i.data), i])), [dados]);
  const extraSalvo = useMemo(() => Object.fromEntries(extras.map((x) => [chave(x.id_operador, x.data), x.minutos])), [extras]);
  const pausasDeOp = useMemo(() => Object.fromEntries((pausasDia?.operadores || []).map((o) => [o.id_operador, o])), [pausasDia]);

  const nomeOp0 = (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao;
  const voltar0 = aoVoltarLista ? html`<button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Voltar para Escalas" title="Voltar para Escalas" onClick=${aoVoltarLista}><${Ic} nome="arrow-left" /></button>` : null;
  if (erro) return html`<main class="c-pagina c-conteudo"><div class="c-cab-linha">${voltar0}<h1>${nomeOp0}</h1></div><div class="c-tabela-caixa"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${carregar} /></div></main>`;
  if (!dados) return html`<main class="c-pagina c-conteudo" aria-busy="true"><div class="c-cab-linha">${voltar0}<h1>${nomeOp0}</h1></div><div class="c-tabela-caixa"><${Esqueleto} linhas=${10} /></div></main>`;

  const editavel = dados.pode_editar && !leitura;
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
      showToast?.(falhaAo('salvar a escala', err), 'error');
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
    } catch (err) { showToast?.(falhaAo('publicar a escala', err), 'error'); setPedirJust(true); } finally { setOcupado(false); }
  };

  const mover = (n) => { const d = doIso(dia); d.setDate(d.getDate() + n); const iso = paraIso(d); if (iso.startsWith(anoMes)) setDia(iso); };
  const rotuloEscopo = { dia: `${br(dia).slice(0, 5)}`, semana: 'a semana', mes: 'o mês' }[lote.escopo];
  const excedentes = pausasDia?.excedentes || [];
  const nomeOperacao = (contexto?.operacoes || []).find((o) => o.chave === operacao)?.nome || operacao;
  const nomeEscala = dados.nome_escala || nomeOperacao;

  const pendentes = celulasAlteradas.length;
  const bloqueioPublicar = pendentes > 0 ? 'Salve as alterações antes de publicar.' : (!fechada && dados.aprovacao?.estado !== 'APROVADA') ? 'A escala precisa ser aprovada pelo Gestor ou Supervisor antes de publicar.' : '';
  const abrirGaveta = (o, secao) => setGaveta({ id: o.id_usuario, nome: o.nome, data: dia, secao });
  const mostradas = visiveis.slice(0, limite);
  const hojeIso = paraIso(new Date());
  const alternarTodos = () => setSel(todosSel ? {} : Object.fromEntries(visiveis.map((o) => [o.id_usuario, true])));

  const aprov = dados.aprovacao;
  const aprovada = !!(aprov?.exige && aprov.estado === 'APROVADA');
  const mostrarJust = (fechada && editavel && pendentes) || pedirJust;

  const [rotuloEstado, tomEstado, iconeEstado, proximoPasso] = estadoEscala(dados);
  const turnosFiltro = turnosSelecionaveis.map((t) => [String(t.id_turno), `${t.nome}${t.entrada ? ` ${faixaTurno(t)}` : ''}`]);
  const extrasMenu = [
    podeCadastros ? { label: 'Novo turno', icon: 'plus', onClick: () => setModalTurno({ ...TURNO_VAZIO, pausas: [] }) } : null,
  ];
  const menuCab = html`<${MenuCompartilharEscala} novo=${true} extras=${extrasMenu} operacao=${operacao} anoMes=${anoMes} dados=${dados} nomeOperacao=${nomeEscala} showToast=${showToast} aoVerMes=${() => aoVerMes?.('mes')} rotuloVer="Escala do mês" aoConfigurar=${podeCadastros ? () => setConfigurando(true) : undefined} />`;
  const nomePausaCurto = (p, i) => `${i + 1}ª pausa${p?.tipo && ROTULO_PAUSA[p.tipo] ? ` · ${ROTULO_PAUSA[p.tipo]}` : ''}`;

  // Linha da tabela: Equipe · Turno e horário · 3 pausas · Presença · Hora extra · ⋯ (amostra Q1, lote 1).
  const linha = (o) => {
    const id = o.id_usuario; const t = turnoDe(id, dia); const trab = trabalha(id, dia); const m = mudou(id, dia);
    const pausas = pausasDe(id, dia); const salvaTrab = escalaSalva(id, dia) && !m.escala; const pres = presencaDe(id, dia);
    const turnoLinha = t && t.tipo !== 'DSR' ? t : null;
    const pendente = m.escala || m.extra || m.pres || m.pausas;
    const ent = entradaDe(id, dia); const sai = saidaDe(id, dia);
    const bloco = turnoLinha
      ? html`<span class="c-dia-bloco" style=${{ '--t': turnoLinha.cor || 'var(--cor-acao-fundo)' }}>${turnoLinha.codigo}<small>${trab && ent ? `${ent}–${sai}` : turnoLinha.nome}${ajustado(id, dia) ? ' *' : ''}</small>${editavel ? html`<${Ic} nome="caret-down" />` : null}</span>`
      : html`<span class="c-dia-bloco--dsr">DSR</span>`;
    const he = extraDe(id, dia);
    return html`<tr key=${id} class=${pendente ? 'c-cel-pendente' : ''} aria-selected=${sel[id] ? 'true' : null}>
      ${editavel ? html`<td><label class="c-marcar"><input type="checkbox" aria-label=${`Selecionar ${o.nome}`} checked=${!!sel[id]} onChange=${() => setSel({ ...sel, [id]: !sel[id] })} /></label></td>` : null}
      <td class="c-forte c-estica" title=${(o.supervisores || []).length ? `Supervisor: ${(o.supervisores || []).map((s) => s.nome).join(', ')}` : null}>${o.nome}</td>
      <td class="c-secundario">${o.equipe || '—'}</td>
      <td>${editHor === id && editavel && trab
        ? html`<${CelulaHorario} nome=${o.nome} entrada=${ent} saida=${sai} aoFechar=${() => setEditHor(null)} aoMudar=${(campo, valor) => mudarHorario(id, dia, campo, valor)} />`
        : editavel
          ? html`<span class="c-dia-turno-sel" title=${turnoLinha ? `${turnoLinha.nome}${trab ? ` · ${ent}–${sai}` : ''} (clique para trocar o turno)` : 'Sem turno neste dia (DSR). Clique para escalar.'}>${bloco}
              <select aria-label=${`Turno de ${o.nome}`} value=${turnoLinha ? String(turnoLinha.id_turno) : ''} onChange=${(e) => mudarTurno(id, dia, e.target.value)}>
                ${turnosSelecionaveis.map((x) => html`<option key=${x.id_turno} value=${x.id_turno}>${x.nome}${x.entrada ? ` ${faixaTurno(x)}` : ''}</option>`)}<option value="">DSR (sem turno)</option>
              </select></span>`
          : bloco}</td>
      ${[0, 1, 2].map((i) => {
        const p = pausas[i];
        if (!trab) return html`<td key=${i} class="c-secundario">—</td>`;
        if (!(salvaTrab || m.pausas)) return html`<td key=${i} class="c-secundario" title="As pausas são programadas ao salvar">${i === 0 ? 'ao salvar' : ''}</td>`;
        if (!p) return html`<td key=${i}>${editavel && i === pausas.length ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-dia-add" aria-label=${`Definir pausas de ${o.nome}`} onClick=${() => abrirGaveta(o, 'pausas')}>+ Definir</button>` : html`<span class="c-secundario">—</span>`}</td>`;
        return html`<td key=${i} class="c-num-esq">${editavel
          ? html`<span class="c-dia-pausas"><button type="button" title=${`${nomePausaCurto(p, i)} · ${p.duracao_min} min (clique para editar)`} aria-label=${`Editar ${i + 1}ª pausa de ${o.nome}: ${p.inicio}`} onClick=${() => abrirGaveta(o, 'pausas')}>${p.inicio}</button></span>`
          : html`<span title=${`${nomePausaCurto(p, i)} · ${p.duracao_min} min`}>${p.inicio}</span>`}</td>`;
      })}
      <td>${trab
        ? (podePresenca
          ? html`<span class="c-dia-pres" title=${pres ? rotuloPresenca(pres) : 'Lançar presença'}>${pres ? html`<span class=${`c-sigla c-selo--${TOM_SIGLA[pres] || 'neutro'}`}>${siglaPresenca(pres)}</span>` : html`<span class="c-sigla c-selo--neutro">·</span>`}
              <select aria-label=${`Presença de ${o.nome}`} value=${pres} onChange=${(e) => mudar(id, dia, { pres: e.target.value })}><option value="">— Sem lançamento</option>${Object.entries(SIGLA_PRESENCA).map(([k, s]) => html`<option key=${k} value=${k}>${s} · ${ROTULO_STATUS_PRESENCA[k]}</option>`)}</select></span>`
          : (pres ? html`<span class=${`c-sigla c-selo--${TOM_SIGLA[pres] || 'neutro'}`} title=${rotuloPresenca(pres)}>${siglaPresenca(pres)}</span>` : html`<span class="c-secundario">—</span>`))
        : html`<span class="c-secundario">—</span>`}</td>
      <td>${!trab ? html`<span class="c-secundario">—</span>`
        : podePresenca && editHe === id
          ? html`<input class="c-entrada c-entrada--compacta c-dia-he-campo" type="number" min="0" max="720" step="5" inputmode="numeric" autoFocus aria-label=${`Hora extra de ${o.nome} (minutos)`} placeholder="min"
              value=${he || ''} onInput=${(e) => mudar(id, dia, { he: Number(e.target.value) || 0 })} onBlur=${() => setEditHe(null)} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditHe(null); }} />`
          : he
            ? (podePresenca
              ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-dia-he" title=${`Total no mês: ${minutosParaHoras(extraMes(id))} (clique para editar)`} onClick=${() => setEditHe(id)}><${Ic} nome="clock" />+${minutosParaHoras(he)}</button>`
              : html`<span class="c-dia-he" title=${`Total no mês: ${minutosParaHoras(extraMes(id))}`}><${Ic} nome="clock" />+${minutosParaHoras(he)}</span>`)
            : (podePresenca ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto c-dia-add" aria-label=${`Adicionar hora extra de ${o.nome}`} onClick=${() => setEditHe(id)}>+ Adicionar</button>` : html`<span class="c-secundario">—</span>`)}</td>
      <td class="c-acoes">${editavel || podePresenca ? html`<${MenuAcoes} rotulo=${`Mais ações para ${o.nome}`} acoes=${[
        editavel && trab ? { label: 'Ajustar horário', icon: 'clock', onClick: () => setEditHor(id) } : null,
        podePresenca && trab ? { label: 'Lançar atestado', icon: 'clipboard-text', onClick: () => mudar(id, dia, { pres: 'ATESTADO' }) } : null,
        editavel && trab ? { label: 'Editar pausas', icon: 'pause-circle', onClick: () => abrirGaveta(o, 'pausas') } : null,
        editavel ? { label: 'Ajustar dia (turno, horário, pausas)', icon: 'pencil-simple', onClick: () => abrirGaveta(o, 'turno') } : null,
      ]} />` : null}</td>
    </tr>`;
  };

  return html`
    <main class="c-pagina c-conteudo">
      <div class="c-cab-linha c-cab-escala">
        ${voltar0}
        <h1 title=${nomeEscala}>${nomeEscala}</h1>
        ${opcoesEscala && opcoesEscala.length > 1 && aoTrocarEscala ? html`<select class="c-entrada c-entrada--compacta c-trocar-escala" aria-label="Trocar de escala" value=${operacao} onChange=${(e) => aoTrocarEscala(e.target.value)}>${opcoesEscala.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
        <${Selo} tom=${tomEstado} icone=${iconeEstado} title="Caminho: Rascunho › Aprovação › Publicada › Fechada">${rotuloEstado}<//>
        ${proximoPasso ? html`<span class="c-ajuda">${proximoPasso}</span>` : null}
        <div class="c-cab-dir">
          ${pendentes ? html`<span class="c-ajuda c-pendencias" role="status">${pendentes} alteração(ões) não salva(s)</span>` : null}
          ${menuCab}
          ${pendentes ? html`<button type="button" class="c-botao c-botao--texto" onClick=${() => setPend({})}>Descartar</button>` : null}
          ${editavel ? html`<button type="button" class="c-botao c-botao--secundario" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || !pendentes || (fechada && !justificativa.trim()) || null} onClick=${salvar}>Salvar${pendentes ? ` (${pendentes})` : ''}</button>` : null}
          ${!todasEquipes ? html`<${AcoesAprovacao} operacao=${operacao} anoMes=${anoMes} aprovacao=${aprov} onMudou=${carregar} showToast=${showToast} desabilitado=${pendentes > 0} />` : null}
          ${podePublicar && !(aprovada && dados.status.versao_publicada > 0 && !pendentes) ? html`<button type="button" class=${`c-botao ${aprov?.pode_enviar || aprov?.pode_aprovar ? 'c-botao--secundario' : 'c-botao--principal'}`} disabled=${ocupado || pendentes > 0 || (!fechada && dados.aprovacao?.estado !== 'APROVADA') || null} title=${bloqueioPublicar || null} onClick=${publicar}><${Ic} nome="send" />Publicar</button>` : null}
        </div>
      </div>

      ${aprov?.declinada && aprov.motivo ? html`<${Faixa} tom="perigo" icone="x-circle"><b>Declinada por ${aprov.decidido_por || '—'}${aprov.decidido_em ? ` em ${dataHora(aprov.decidido_em)}` : ''}:</b> ${aprov.motivo}<//>` : null}
      ${aprov?.invalidada && !aprov?.declinada ? html`<${Faixa} tom="atencao" icone="warning">A escala foi alterada depois do envio/aprovação: envie novamente para aprovação.<//>` : null}
      ${aprov?.estado === 'EM_APROVACAO' ? html`<${Faixa} tom="informacao" icone="hourglass">Aguardando aprovação ${aprov.aprovadores_configurados ? 'dos aprovadores configurados' : 'de quem tem permissão para aprovar'}. Enviada por ${aprov.enviado_por || '—'} em ${dataHora(aprov.enviado_em)}.<//>` : null}
      ${excedentes.length ? html`<${Faixa} tom="atencao" icone="warning"><b>Mais pessoas em pausa do que o limite.</b> ${excedentes.slice(0, 4).map((x) => `${x.inicio}–${x.fim}: ${x.qtd} (limite ${x.capacidade})`).join(' · ')}${excedentes.length > 4 ? ` · e mais ${excedentes.length - 4}` : ''}<//>` : null}
      ${mostrarJust ? html`<div class="c-cartao c-cartao-corpo"><${Campo} rotulo=${pedirJust ? 'Justificativa (para publicar com violação ou após o fechamento)' : 'Justificativa (período fechado, obrigatória)'}>
        <input class="c-entrada" maxlength="400" value=${justificativa} onInput=${(e) => setJustificativa(e.target.value)} />
      <//></div>` : null}

      <div class="c-tabela-caixa">
        ${editavel && marcados.length ? html`<div class="c-selecao">
          <span>${marcados.length} selecionado(s)</span>
          <select class="c-entrada c-entrada--compacta" aria-label="Turno a atribuir" value=${turnoTodos} onChange=${(e) => setTurnoTodos(e.target.value)}>
            <option value="">Atribuir turno…</option>${turnosSelecionaveis.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.nome}${t.entrada ? ` ${faixaTurno(t)}` : ''}</option>`)}<option value="dsr">DSR (sem turno)</option></select>
          <button type="button" class="c-botao c-botao--principal c-botao--compacto" disabled=${turnoTodos === '' || null} onClick=${aplicarTurnoTodos}>Aplicar turno</button>
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setVerMassa(true)}>Preencher em massa</button>
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setVerPausasLote(true)}>Replicar pausas</button>
          <button type="button" class="c-botao c-botao--texto c-botao--compacto c-fim" onClick=${() => setSel({})}>Limpar seleção</button>
        </div>` : null}
        <div class="c-filtros c-filtros--suave c-filtros--quebra">
          <${Segmento} rotulo="Visão" valor="dia" aoMudar=${(v) => { if (v === 'semana' || v === 'mes') aoVerMes?.(v); else if (v === 'pausas') aoPausas?.(); }}
            opcoes=${[['semana', 'Semana'], ['mes', 'Mês'], ['dia', 'Do dia'], ...(aoPausas ? [['pausas', 'Pausas']] : [])]} />
          <${Navegar} grupo="Dia" rotulo=${`${SEMANA[d0.getDay()].slice(0, 3)}, ${br(dia).slice(0, 5)}`} rotuloAnterior="Dia anterior" rotuloProximo="Próximo dia" aoAnterior=${() => mover(-1)} aoProximo=${() => mover(1)} />
          <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${!hojeIso.startsWith(anoMes) || dia === hojeIso || null} onClick=${() => setDia(hojeIso)}>Hoje</button>
          <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar colaborador" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
          ${ehSupervisor ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipes exibidas" value=${todasEquipes ? 'todas' : ''} onChange=${(e) => setTodasEquipes(e.target.value === 'todas')}><option value="">Minha equipe</option><option value="todas">Todas as equipes</option></select>` : null}
          ${equipes.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Equipe" value=${filtroEquipe} onChange=${(e) => setFiltroEquipe(e.target.value)}><option value="">Equipe: todas</option>${equipes.map(([id, nome]) => html`<option key=${id} value=${String(id)}>${nome}</option>`)}</select>` : null}
          ${supervisores.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Supervisor" value=${filtroSup} onChange=${(e) => setFiltroSup(e.target.value)}><option value="">Supervisor: todos</option>${supervisores.map(([id, nome]) => html`<option key=${id} value=${String(id)}>${nome}</option>`)}</select>` : null}
          ${cargos.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Cargo" value=${filtroCargo} onChange=${(e) => setFiltroCargo(e.target.value)}><option value="">Cargo: todos</option>${cargos.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}</select>` : null}
          <select class="c-entrada c-entrada--compacta" aria-label="Turno" value=${filtroTurno} onChange=${(e) => setFiltroTurno(e.target.value)}><option value="">Turno: todos</option>${turnosFiltro.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}<option value="dsr">DSR (sem turno)</option></select>
          <span class="c-contador" aria-live="polite">${visiveis.length} de ${dados.operadores.length} · ${escalados} escalado(s)${dados.todas_equipes ? ' · todas as equipes, somente leitura' : ''}</span>
        </div>

        ${!dados.operadores.length ? html`<${Estado} icone="users" titulo="Nenhum operador" texto="Não há operadores visíveis para você nesta operação." />`
          : !visiveis.length ? html`<${Estado} titulo="Nenhum colaborador com estes filtros." rotuloAcao="Limpar filtros" aoAcao=${() => { setBusca(''); setFiltroEquipe(''); setFiltroSup(''); setFiltroCargo(''); setFiltroTurno(''); }} />`
          : html`<table class="c-tabela c-dia-tabela c-tabela-digita" aria-label=${`Escala do dia ${br(dia)}`}>
            <thead><tr>
              ${editavel ? html`<th scope="col" style=${{ width: '40px' }}><label class="c-marcar"><input type="checkbox" aria-label="Selecionar todos os colaboradores" checked=${todosSel}
                ref=${(el) => { if (el) el.indeterminate = marcados.length > 0 && !todosSel; }} onChange=${alternarTodos} /></label></th>` : null}
              <th scope="col" class="c-estica">Colaborador</th><th scope="col">Equipe</th><th scope="col">Turno e horário</th>
              <th scope="col">1ª pausa</th><th scope="col">2ª pausa</th><th scope="col">3ª pausa</th>
              <th scope="col">Presença</th><th scope="col">Hora extra</th><th scope="col" class="c-acoes"><span class="c-oculto">Ações</span></th>
            </tr></thead>
            <tbody>${mostradas.map(linha)}</tbody>
          </table>`}

        <div class="c-caixa-rodape">
          <span class="c-ajuda" aria-live="polite">Mostrando ${mostradas.length} de ${visiveis.length}</span>
          ${mostradas.length < visiveis.length ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => setLimite((l) => l + 50)}>Mostrar mais</button>` : null}
          ${aprovada ? html`<span class="c-ajuda">Aprovada por ${aprov.decidido_por || '—'} em ${dataHora(aprov.decidido_em)}</span>` : null}
          <span class="c-fim">${editavel ? html`<label class="c-interruptor c-interruptor-linha"><input type="checkbox" role="switch" checked=${programarPausas} onChange=${(e) => setProgramarPausas(e.target.checked)} />Programar pausas de quem ficar sem</label>` : html`<span class="c-ajuda">Somente leitura</span>`}</span>
        </div>
      </div>
    </main>

    ${verMassa && editavel && marcados.length ? html`<${Janela} titulo=${`Preencher em massa · ${marcados.length} selecionado(s)`} onClose=${() => setVerMassa(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setVerMassa(false)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" onClick=${() => { aplicarLote(); setVerMassa(false); }}>Aplicar em ${rotuloEscopo}</button>`}>
      <div class="c-janela-corpo">
        <${Campo} rotulo="Turno"><select class="c-entrada" value=${lote.turno} onChange=${(e) => setLote({ ...lote, turno: e.target.value })}><option value="">Manter</option>${turnosSelecionaveis.map((t) => html`<option key=${t.id_turno} value=${t.id_turno}>${t.codigo} · ${t.nome}</option>`)}<option value="dsr">DSR (sem turno)</option></select><//>
        <div class="c-grupo">
          <${Campo} rotulo="Entrada" opcional=${true}><input class="c-entrada" type="time" value=${lote.entrada} onInput=${(e) => setLote({ ...lote, entrada: e.target.value })} /><//>
          <${Campo} rotulo="Saída" opcional=${true}><input class="c-entrada" type="time" value=${lote.saida} onInput=${(e) => setLote({ ...lote, saida: e.target.value })} /><//>
        </div>
        <${Campo} rotulo="Em"><select class="c-entrada" value=${lote.escopo} onChange=${(e) => setLote({ ...lote, escopo: e.target.value })}><option value="dia">Só este dia</option><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select><//>
        ${lote.escopo !== 'dia' ? html`<fieldset class="c-padrao-dias"><legend class="c-rotulo">Dias da semana atingidos · ${datasAlvo.length} dia(s)</legend>
          ${SEMANA_CURTA.map((nome, i) => html`<label key=${nome} class="c-marcar"><input type="checkbox" checked=${lote.dias[i]} onChange=${() => setLote({ ...lote, dias: lote.dias.map((v, j) => (j === i ? !v : v)) })} /><span>${nome}</span></label>`)}</fieldset>` : null}
        <p class="c-ajuda">Fica pendente até você clicar em Salvar.</p>
      </div>
    <//>` : null}

    ${verPausasLote && editavel && marcados.length ? html`<${Janela} titulo=${`Replicar as pausas de ${br(dia).slice(0, 5)} (${SEMANA[d0.getDay()]})`} onClose=${() => setVerPausasLote(false)}
      rodape=${html`<button type="button" class="c-botao c-botao--secundario" onClick=${() => setVerPausasLote(false)}>Cancelar</button>
        <button type="button" class="c-botao c-botao--principal" aria-busy=${ocupado ? 'true' : null} disabled=${ocupado || pendentes > 0 || !pausasDoDiaDefinidas || !diasDasPausas.length || null} onClick=${async () => { await replicarPausas(); setVerPausasLote(false); }}>Aplicar pausas</button>`}>
      <div class="c-janela-corpo">
        <${Campo} rotulo="Em"><select class="c-entrada" value=${lotePausas.escopo} onChange=${(e) => setLotePausas({ ...lotePausas, escopo: e.target.value })}><option value="semana">Toda a semana</option><option value="mes">Todo o mês</option></select><//>
        <fieldset class="c-padrao-dias"><legend class="c-rotulo">Dias da semana · ${diasDasPausas.length} dia(s)</legend>
          ${SEMANA_CURTA.map((nome, i) => html`<label key=${nome} class="c-marcar"><input type="checkbox" checked=${lotePausas.dias[i]} onChange=${() => setLotePausas({ ...lotePausas, dias: lotePausas.dias.map((v, j) => (j === i ? !v : v)) })} /><span>${nome}</span></label>`)}</fieldset>
        <label class="c-marcar"><input type="checkbox" checked=${lotePausas.sobrescrever} onChange=${(e) => setLotePausas({ ...lotePausas, sobrescrever: e.target.checked })} /><span>Substituir pausas já programadas</span></label>
        <p class="c-ajuda">${pendentes > 0 ? 'Salve as alterações do dia antes de replicar as pausas.' : !pausasDoDiaDefinidas ? 'Defina e salve as pausas deste dia primeiro: elas servem de modelo.' : `Copia os horários de pausa de ${marcados.length} selecionado(s) para os dias marcados em que a pessoa trabalha. Só o que passar do limite${pausasDia ? ` de ${pausasDia.capacidade}` : ''} em pausa ao mesmo tempo é deslocado para o horário livre mais próximo.`}</p>
      </div>
    <//>` : null}

    ${gaveta && editavel ? html`<${GavetaAjusteDia} alvo=${gaveta} dados=${dados} operacao=${operacao} anoMes=${anoMes} fechada=${fechada} showToast=${showToast}
      bloqueio=${pendentes > 0 ? 'Há alterações não salvas na tela. Salve ou descarte antes de ajustar um dia.' : ''}
      aoFechar=${() => setGaveta(null)} aoSalvo=${(ok) => { if (ok) setGaveta(null); carregar(); }} />` : null}
    ${configurando ? html`<${ModalConfigEscala} operacao=${operacao} nomePadrao=${nomeOperacao} showToast=${showToast} onClose=${() => setConfigurando(false)} onSalvo=${() => { setConfigurando(false); setVersaoLista((v) => v + 1); carregar(); }} onMudouLista=${() => { setConfigurando(false); aoVoltarLista?.(); }} />` : null}
    ${modalTurno ? html`<${ModalTurno} operacao=${operacao} inicial=${modalTurno} contratos=${contratos} supervisores=${supervisoresOp} showToast=${showToast} onClose=${() => setModalTurno(null)} onSalvo=${() => { setModalTurno(null); carregar(); }} />` : null}`;
}

// Horário da linha em edição (⋯ › Ajustar horário): dois campos de hora com a duração recalculada. Enter/Esc ou sair fecha.
function CelulaHorario({ nome, entrada, saida, aoMudar, aoFechar }) {
  const raiz = useRef(null);
  const dur = minutosParaHoras(duracao(entrada, saida));
  const sair = (e) => { if (!raiz.current?.contains(e.relatedTarget)) aoFechar(); };
  return html`<span class="c-grupo" ref=${raiz} onKeyDown=${(e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); aoFechar(); } }}>
    <input type="time" class="c-entrada c-entrada--compacta c-pausa-hora" autoFocus aria-label=${`Entrada de ${nome}`} value=${entrada} onInput=${(e) => aoMudar('entrada', e.target.value)} onBlur=${sair} />
    <span aria-hidden="true">–</span>
    <input type="time" class="c-entrada c-entrada--compacta c-pausa-hora" aria-label=${`Saída de ${nome}`} value=${saida} onInput=${(e) => aoMudar('saida', e.target.value)} onBlur=${sair} />
    <span class="c-ajuda" aria-live="polite">${dur}</span>
  </span>`;
}
