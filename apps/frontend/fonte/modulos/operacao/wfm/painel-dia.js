import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../../infraestrutura-react.js';
import {
  lancarPresencaWfm,
  lerEscalaWfm,
  lerLoginsDiaWfm,
  lerPausasDiaWfm,
  listarPresencasWfm,
  listarTrocasWfm,
} from '../../../services/api/wfm.js?v=20261108-painel-dia';
import { ROTULO_STATUS_PRESENCA, SIGLA_PRESENCA, rotuloPresenca, siglaPresenca } from './comum.js?v=20261104-leitura';
import { Esqueleto, Estado, Ic, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';
import { pedirFocoPessoa, tomarFocoPessoa } from './foco-pessoa.js';
import { FaixaDiarioPainel } from '../diario/ligacoes.js';

// Turnos e Plantões › Painel (amostra "Painel do dia", aprovada em 08/11/2026): o dia inteiro do Supervisor numa tela.
// Escala, turno, pausas PREVISTAS, trocas e presença vêm das rotas que já existem. "Logado" e a hora de entrada vêm do
// 1º login do dia no Conecta (GET /wfm/painel-dia/logins): não é ponto nem login na plataforma de atendimento, e o
// Conecta não recebe pausa real — por isso "Em pausa" fica "—" e as pausas aparecem só como previstas.
// O escopo (equipe, operação, perfil) é todo do servidor; "Só minha equipe" só filtra o que já veio.

const pad = (n) => String(n).padStart(2, '0');
export const paraIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const somarDias = (iso, n) => { const d = doIso(iso); d.setDate(d.getDate() + n); return paraIso(d); };
const paraMin = (hhmm) => { if (!hhmm) return null; const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const hora = (min) => { const t = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const rotuloDiaCurto = (iso) => `${SEMANA_CURTA[doIso(iso).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const rotuloDiaMes = (iso) => `${SEMANA_CURTA[doIso(iso).getDay()]}, ${Number(iso.slice(8, 10))} ${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}`;
// Iniciais do avatar: as duas primeiras palavras do nome, sem "da/de/do/dos/das" (como na amostra: Adais Pires da Silva → AP).
export const iniciais = (nome) => String(nome || '').trim().split(/\s+/).filter((p) => p && !/^(da|de|do|das|dos|e)$/i.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Régua do dia: 06:00 → 00:30 (mesma da amostra). Turno fora dela é cortado nas pontas.
const EIXO_INI = 360;
const EIXO_FIM = 1470;
export const pctEixo = (min) => Math.max(0, Math.min(100, ((min - EIXO_INI) / (EIXO_FIM - EIXO_INI)) * 100));
const MARCAS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
export function EixoHoras() {
  return html`<div class="c-pd-eixo" aria-hidden="true">${MARCAS.map((h) => html`<span key=${h} style=${{ left: `${pctEixo(h * 60).toFixed(2)}%` }}>${pad(h % 24)}h</span>`)}</div>`;
}
export const faixa = (ini, fim) => ({ left: `${pctEixo(ini).toFixed(2)}%`, width: `calc(${pctEixo(fim).toFixed(2)}% - ${pctEixo(ini).toFixed(2)}%)` });

// Presença que tira a pessoa do turno (não conta como "não logou" nem "sem presença").
const AFASTAMENTO = new Set(['ATESTADO', 'FERIAS', 'FOLGA', 'DAY_OFF', 'FOLGA_COMP_BH', 'SERVICO_EXTERNO', 'FALTA_JUSTIFICADA']);
const TOM_SIGLA = { PRESENTE: 'sucesso', FALTA: 'perigo', FALTA_JUSTIFICADA: 'atencao', ATESTADO: 'informacao', SERVICO_EXTERNO: 'informacao' };
const ORDEM_SIGLAS = ['PRESENTE', 'FALTA', 'FALTA_JUSTIFICADA', 'ATESTADO', 'SERVICO_EXTERNO', 'DAY_OFF', 'FOLGA', 'FOLGA_COMP_BH', 'FERIAS'];
const ATRASO_TOLERANCIA = 5; // minutos depois da entrada prevista

// Lê o dia de uma escala. `todasEquipes`: Supervisor consulta as outras equipes (somente leitura no servidor).
export async function carregarDia(operacao, dia, todasEquipes) {
  const anoMes = dia.slice(0, 7);
  const [escala, presencas, pausas, trocas, logins] = await Promise.all([
    lerEscalaWfm(operacao, anoMes, false, todasEquipes),
    listarPresencasWfm(operacao, anoMes, todasEquipes).catch(() => ({ itens: [] })),
    lerPausasDiaWfm(operacao, dia, todasEquipes).catch(() => null),
    listarTrocasWfm(operacao, 'APROVADA').catch(() => ({ itens: [] })),
    lerLoginsDiaWfm(operacao, dia, todasEquipes).catch(() => null),
  ]);
  return {
    escala,
    presencas: Object.fromEntries((presencas.itens || []).filter((p) => p.data === dia).map((p) => [p.id_operador, p.status])),
    pausas: Object.fromEntries((pausas?.operadores || []).map((o) => [o.id_operador, o])),
    trocas: (trocas.itens || []).filter((t) => t.estado === 'APROVADA' && (t.data_a === dia || t.data_b === dia)),
    logins: logins ? Object.fromEntries((logins.itens || []).map((l) => [l.id_operador, l])) : null,
  };
}

// Minuto "agora" no dia mostrado: passado = depois de tudo, futuro = antes de tudo.
export function agoraNoDia(dia, agora = new Date()) {
  const hoje = paraIso(agora);
  if (dia < hoje) return Infinity;
  if (dia > hoje) return -Infinity;
  return agora.getHours() * 60 + agora.getMinutes();
}

// Uma linha por pessoa escalada em turno de TRABALHO no dia, já com o estado de agora.
export function montarLinhas(bruto, dia, agora, presencas = bruto.presencas) {
  const { escala, pausas, trocas, logins } = bruto;
  const turnos = Object.fromEntries((escala.turnos || []).map((t) => [t.id_turno, t]));
  const itens = Object.fromEntries((escala.itens || []).filter((i) => i.data === dia).map((i) => [i.id_operador, i]));
  const comLogin = Boolean(logins);
  return (escala.operadores || []).flatMap((o) => {
    const item = itens[o.id_usuario];
    const turno = turnos[item?.id_turno];
    if (!turno || turno.tipo !== 'TRABALHO') return [];
    const entrada = item.entrada_ajuste || turno.entrada;
    const saida = item.saida_ajuste || turno.saida;
    const ini = paraMin(entrada);
    let fim = paraMin(saida);
    if (fim <= ini) fim += 1440;
    const presenca = presencas[o.id_usuario] || '';
    const afastado = AFASTAMENTO.has(presenca);
    const comecou = agora >= ini;
    const acabou = agora >= fim;
    const login = comLogin ? logins[o.id_usuario] || null : null;
    const loginMin = login ? paraMin(login.primeiro_login.slice(11, 16)) : null;
    const logado = comLogin ? Boolean(login) && !afastado : null;
    const atraso = logado && loginMin > ini + ATRASO_TOLERANCIA ? loginMin - ini : 0;
    const naoLogou = comLogin ? comecou && !logado && !afastado : null;
    const listaPausas = [...(pausas[o.id_usuario]?.pausas || [])].sort((a, b) => a.ordem - b.ordem).map((p) => {
      let pi = paraMin(p.inicio);
      if (pi < ini) pi += 1440;
      return { ...p, ini: pi, fim: pi + (Number(p.duracao_min) || 0) };
    });
    const proxima = comecou && !acabou && !afastado ? listaPausas.findIndex((p) => p.ini > agora) : -1;
    const troca = trocas.find((t) => t.id_solicitante === o.id_usuario || t.id_alvo === o.id_usuario);
    const outro = troca ? (troca.id_solicitante === o.id_usuario ? troca.alvo : troca.solicitante) : '';
    return [{
      id: o.id_usuario, nome: o.nome, equipe: o.equipe || '', idEquipe: o.id_equipe, minha: o.minha_equipe !== false,
      turno, idTurno: turno.id_turno, entrada, saida, ini, fim, presenca, afastado, comecou, acabou,
      login, loginMin, logado, atraso, naoLogou, pausas: listaPausas, proxima,
      troca: troca ? { id: troca.id_troca, texto: `Troca c/ ${outro}`, outro } : null,
    }];
  });
}

// Grupos por turno, na ordem do dia.
export function agruparPorTurno(linhas) {
  const grupos = new Map();
  linhas.forEach((l) => {
    if (!grupos.has(l.idTurno)) {
      const ini = paraMin(l.turno.entrada);
      let fim = paraMin(l.turno.saida);
      if (fim <= ini) fim += 1440;
      grupos.set(l.idTurno, { id: l.idTurno, nome: l.turno.nome, cor: l.turno.cor || 'var(--cor-acao-fundo)', entrada: l.turno.entrada, saida: l.turno.saida, ini, fim, linhas: [] });
    }
    grupos.get(l.idTurno).linhas.push(l);
  });
  return [...grupos.values()].sort((a, b) => a.ini - b.ini || a.nome.localeCompare(b.nome)).map((g) => {
    const linhasOrd = [...g.linhas].sort((a, b) => a.nome.localeCompare(b.nome));
    const presentes = linhasOrd.filter((l) => !l.afastado);
    return {
      ...g, linhas: linhasOrd,
      comecou: linhasOrd.some((l) => l.comecou),
      logados: presentes.filter((l) => l.logado).length,
      esperados: presentes.length,
      naoLogaram: linhasOrd.filter((l) => l.naoLogou).length,
      comLogin: linhasOrd.every((l) => l.logado !== null),
    };
  });
}

export const resumoGrupo = (g) => (g.comecou
  ? (g.comLogin ? `${g.logados} de ${g.esperados} logados` : `${g.linhas.length} ${g.linhas.length === 1 ? 'pessoa' : 'pessoas'} no turno`)
  : `${g.linhas.length} ${g.linhas.length === 1 ? 'pessoa' : 'pessoas'} · entram ${g.entrada}`);

const FILTROS = [
  ['todos', 'Escalados'],
  ['logado', 'Logados'],
  ['pausa', 'Em pausa'],
  ['nao', 'Não logaram', 'perigo'],
  ['atraso', 'Atrasos', 'atencao'],
  ['vai', 'A entrar'],
  ['troca', 'Com troca'],
  ['sempres', 'Sem presença', 'atencao'],
];
const passa = (l, f) => {
  if (f === 'todos') return true;
  if (f === 'logado') return Boolean(l.logado);
  if (f === 'pausa') return false; // o Conecta não recebe pausa real
  if (f === 'nao') return Boolean(l.naoLogou);
  if (f === 'atraso') return l.atraso > 0;
  if (f === 'vai') return !l.comecou;
  if (f === 'troca') return Boolean(l.troca);
  if (f === 'sempres') return l.comecou && !l.presenca && !l.afastado;
  return true;
};

function SeloAgora({ l, comLogin }) {
  if (l.afastado) return html`<${Selo} tom="neutro">${rotuloPresenca(l.presenca)}<//>`;
  if (!l.comecou) return html`<${Selo} tom="neutro" icone="clock">Entra ${l.entrada}<//>`;
  if (comLogin && l.logado) return l.acabou ? html`<${Selo} tom="neutro" icone="check">Turno encerrado<//>` : html`<${Selo} tom="sucesso" icone="check-circle">Logado<//>`;
  if (comLogin) return html`<${Selo} tom="perigo" icone="warning-octagon">Não logou<//>`;
  return html`<${Selo} tom="neutro">${l.acabou ? 'Turno encerrado' : 'No turno'}<//>`;
}

function Entrada({ l, comLogin }) {
  const origem = l.login?.origem === 'ultimo_acesso' ? ' (último acesso do dia)' : '';
  if (l.afastado || !l.comecou || !comLogin) return html`<span class="c-pd-prev" title="Prevista">${l.entrada}</span>`;
  if (l.logado && l.atraso) return html`<span class="c-pd-atraso" title=${`Prevista ${l.entrada} · 1º login no Conecta${origem}`}>${hora(l.loginMin)} <small>+${l.atraso} min</small></span>`;
  if (l.logado) return html`<span class="c-pd-ok" title=${`Prevista ${l.entrada} · 1º login no Conecta${origem}`}><${Ic} nome="check-circle" />${hora(l.loginMin)}</span>`;
  return html`<span class="c-pd-falta" title=${`Prevista ${l.entrada} · sem login no Conecta hoje`}><${Ic} nome="warning-octagon" />—</span>`;
}

function Pausas({ l }) {
  if (l.afastado || !l.pausas.length) return html`<span class="c-pd-prev">—</span>`;
  return html`<span class="c-pd-pausas">${l.pausas.map((p, i) => html`<span key=${p.ordem}
    class=${`c-pd-pausa ${i === l.proxima ? 'c-pd-pausa--prox' : ''}`.trim()}
    title=${`${p.ordem}ª pausa · prevista ${hora(p.ini)} (${p.duracao_min} min)`}>${hora(p.ini)}</span>`)}</span>`;
}

// Menu solto dentro do <main> (não é cortado pela rolagem da tabela). Esc fecha e devolve o foco a quem abriu.
function MenuSolto({ menu, fechar, rotulo, classe = '', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const itens = () => [...(ref.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
    itens()[0]?.focus();
    const fora = (ev) => { if (ref.current && !ref.current.contains(ev.target) && ev.target !== menu.ancora && !menu.ancora?.contains(ev.target)) fechar(false); };
    const tecla = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); fechar(true); return; }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      const lista = itens();
      if (!lista.length) return;
      ev.preventDefault();
      const i = lista.indexOf(document.activeElement);
      lista[(i + (ev.key === 'ArrowDown' ? 1 : -1) + lista.length) % lista.length].focus();
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [menu]);
  return html`<div ref=${ref} class=${`c-menu c-pd-menu ${classe}`.trim()} role="menu" aria-label=${rotulo} style=${menu.right !== undefined ? { top: `${menu.top}px`, right: `${menu.right}px` } : { top: `${menu.top}px`, left: `${menu.left}px` }}>${children}</div>`;
}

export function TelaPainelDia({ controlador, contexto, operacao, showToast, aoTrocarEscala, aoVerEscalaMes }) {
  const ehSupervisor = controlador.estado?.perfilUsuario === 'supervisor';
  const podeLancar = controlador.possuiPermissao('wfm.presenca.lancar');
  const [dia, setDia] = useState(() => paraIso(new Date()));
  const [bruto, setBruto] = useState(null);
  const [presencas, setPresencas] = useState({});
  const [erro, setErro] = useState('');
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const [agoraRef, setAgoraRef] = useState(() => new Date());
  const [busca, setBusca] = useState('');
  const [equipe, setEquipe] = useState('');
  const [turno, setTurno] = useState(() => tomarFocoPessoa('painel-turno'));
  const [soMinha, setSoMinha] = useState(false);
  const [visao, setVisao] = useState('lista');
  const [filtro, setFiltro] = useState('todos');
  const [dobra, setDobra] = useState({}); // id do turno → aberto (true/false); sem valor = regra padrão
  const [menu, setMenu] = useState(null); // { tipo, id, top, left, ancora }
  const [aviso, setAviso] = useState(null); // { id, texto, desfazer }
  const mainRef = useRef(null);
  const pendente = useRef(null); // lançamento adiado (sem valor anterior não há como "apagar": grava só depois dos 5 s)

  const operacoesAtivas = (contexto?.operacoes || []).filter((o) => o.escala_ativa !== false);
  const hoje = paraIso(agoraRef);

  const carregar = useCallback(async (silencioso = false) => {
    if (!operacao) return;
    if (!silencioso) { setBruto(null); setErro(''); }
    try {
      const dados = await carregarDia(operacao, dia, ehSupervisor);
      setBruto(dados);
      setPresencas((atual) => (pendente.current ? { ...dados.presencas, [pendente.current.id]: atual[pendente.current.id] } : dados.presencas));
      setAtualizadoEm(new Date());
      setAgoraRef(new Date());
    } catch (e) {
      if (!silencioso) { setBruto(null); setErro(e?.message || 'Não foi possível carregar o painel do dia.'); }
    }
  }, [operacao, dia, ehSupervisor]);
  useEffect(() => { carregar(); }, [carregar]);
  // Atualiza sozinho a cada minuto (sem piscar a tela).
  useEffect(() => {
    const t = setInterval(() => carregar(true), 60000);
    return () => clearInterval(t);
  }, [carregar]);

  // Lançamento adiado: grava ao sair da tela ou quando outro lançamento começa.
  const gravarPendente = () => {
    const p = pendente.current;
    if (!p) return;
    pendente.current = null;
    clearTimeout(p.timer);
    p.gravar();
  };
  useEffect(() => () => gravarPendente(), []);
  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso((a) => (a && a.id === aviso.id ? null : a)), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const agora = agoraNoDia(dia, agoraRef);
  const comLogin = Boolean(bruto?.logins);
  const linhas = useMemo(() => (bruto ? montarLinhas(bruto, dia, agora, presencas) : []), [bruto, dia, agora, presencas]);
  const equipes = useMemo(() => [...new Set(linhas.map((l) => l.equipe).filter(Boolean))].sort(), [linhas]);
  const turnosDoDia = useMemo(() => agruparPorTurno(linhas).map((g) => [String(g.id), g.nome]), [linhas]);
  const termo = busca.trim().toLowerCase();
  const filtradas = linhas.filter((l) => (!termo || l.nome.toLowerCase().includes(termo))
    && (!equipe || l.equipe === equipe) && (!turno || String(l.idTurno) === turno) && (!soMinha || l.minha));
  const grupos = agruparPorTurno(filtradas);
  const contagem = Object.fromEntries(FILTROS.map(([f]) => [f, filtradas.filter((l) => passa(l, f)).length]));
  const editavel = (l) => podeLancar && (!bruto?.escala?.todas_equipes || l.minha);
  const loteAlvo = linhas.filter((l) => l.logado && !l.presenca && editavel(l));

  const fecharMenu = (devolverFoco) => { const anc = menu?.ancora; setMenu(null); if (devolverFoco) anc?.focus?.(); };
  const abrirMenu = (tipo, id, ev) => {
    const ancora = ev.currentTarget;
    if (menu && menu.tipo === tipo && menu.id === id) { fecharMenu(true); return; }
    const caixa = mainRef.current.getBoundingClientRect();
    const r = ancora.getBoundingClientRect();
    // Presença: o menu cola pela direita do botão (a coluna fica na borda). Abre para cima quando não cabe embaixo.
    const altura = tipo === 'sigla' ? 368 : 216;
    const acima = r.bottom + altura + 8 > window.innerHeight && r.top - altura - 8 > 0;
    const top = acima ? r.top - caixa.top - altura - 4 : r.bottom - caixa.top + 4;
    setMenu(tipo === 'sigla'
      ? { tipo, id, ancora, top, right: Math.max(0, caixa.right - r.right) }
      : { tipo, id, ancora, top, left: Math.max(0, Math.min(r.left - caixa.left, caixa.width - 256)) });
  };

  const salvar = async (l, status) => {
    try { await lancarPresencaWfm({ operacao, id_operador: l.id, data: dia, status }); return true; } catch (e) {
      showToast?.(`Falha ao lançar a presença de ${l.nome}: ${e?.message || 'tente de novo.'}`, 'error');
      return false;
    }
  };
  const lancar = (l, status) => {
    setMenu(null);
    l.ancoraFoco?.focus?.();
    const anterior = l.presenca || '';
    if (!status || status === anterior) return;
    gravarPendente();
    setPresencas((p) => ({ ...p, [l.id]: status }));
    const texto = `${siglaPresenca(status)} lançado para ${l.nome}.`;
    if (anterior) {
      salvar(l, status).then((ok) => { if (!ok) setPresencas((p) => ({ ...p, [l.id]: anterior })); });
      setAviso({ id: Date.now(), texto, desfazer: () => { setPresencas((p) => ({ ...p, [l.id]: anterior })); salvar(l, anterior); } });
      return;
    }
    const reverter = () => setPresencas((p) => { const n = { ...p }; delete n[l.id]; return n; });
    pendente.current = { id: l.id, gravar: () => salvar(l, status).then((ok) => { if (!ok) reverter(); }) };
    pendente.current.timer = setTimeout(gravarPendente, 5000);
    setAviso({ id: Date.now(), texto, desfazer: () => { const p = pendente.current; if (p) { clearTimeout(p.timer); pendente.current = null; } reverter(); } });
  };
  const marcarLote = () => {
    const alvo = loteAlvo;
    if (!alvo.length) return;
    gravarPendente();
    setPresencas((p) => ({ ...p, ...Object.fromEntries(alvo.map((l) => [l.id, 'PRESENTE'])) }));
    const reverter = () => setPresencas((p) => { const n = { ...p }; alvo.forEach((l) => { delete n[l.id]; }); return n; });
    pendente.current = {
      id: null,
      gravar: async () => {
        const falhas = (await Promise.all(alvo.map((l) => salvar(l, 'PRESENTE').then((ok) => (ok ? null : l))))).filter(Boolean);
        if (falhas.length) setPresencas((p) => { const n = { ...p }; falhas.forEach((l) => { delete n[l.id]; }); return n; });
      },
    };
    pendente.current.timer = setTimeout(gravarPendente, 5000);
    setAviso({ id: Date.now(), texto: `P lançado para ${alvo.length} ${alvo.length === 1 ? 'pessoa que logou' : 'pessoas que logaram'}.`, desfazer: () => { const p = pendente.current; if (p) { clearTimeout(p.timer); pendente.current = null; } reverter(); } });
  };

  const irPara = (tela, destinoFoco, l) => {
    setMenu(null);
    pedirFocoPessoa(destinoFoco, l.nome);
    controlador.irParaTelaProtegida(tela);
  };
  const pode = (tela) => controlador.podeAcessarTela?.(tela) !== false;

  const aberto = (g) => (filtro !== 'todos' ? true : dobra[g.id] ?? g.comecou);
  const mudarFiltro = (f) => setFiltro((atual) => (atual === f || f === 'pausa' ? 'todos' : f));

  const tituloDia = `${dia === hoje ? 'Hoje, ' : ''}${rotuloDiaCurto(dia)}`;
  const nColunas = visao === 'lista' ? 8 : 4;

  const botaoNome = (l) => html`<button type="button" class="c-pd-nome" aria-haspopup="menu" aria-expanded=${menu?.tipo === 'pessoa' && menu.id === l.id ? 'true' : 'false'}
    onClick=${(ev) => abrirMenu('pessoa', l.id, ev)}>${l.nome}<${Ic} nome="caret-down" /></button>`;
  const botaoSigla = (l) => {
    const exp = menu?.tipo === 'sigla' && menu.id === l.id ? 'true' : 'false';
    const pode = editavel(l);
    const titulo = pode ? null : 'Só o supervisor da equipe lança a presença';
    if (l.presenca) {
      return html`<button type="button" class=${`c-pd-sigla c-sigla c-selo--${TOM_SIGLA[l.presenca] || 'neutro'}`} aria-haspopup="menu" aria-expanded=${exp}
        aria-label=${`Presença: ${siglaPresenca(l.presenca)}${pode ? '. Mudar' : ''}`} title=${titulo || rotuloPresenca(l.presenca)} disabled=${!pode || null}
        onClick=${(ev) => abrirMenu('sigla', l.id, ev)}>${siglaPresenca(l.presenca)}</button>`;
    }
    if (l.comecou && !l.afastado) {
      return html`<button type="button" class="c-pd-sigla c-pd-sigla--pendente" aria-haspopup="menu" aria-expanded=${exp} aria-label="Lançar presença" title=${titulo}
        disabled=${!pode || null} onClick=${(ev) => abrirMenu('sigla', l.id, ev)}>—</button>`;
    }
    return html`<button type="button" class="c-pd-sigla c-pd-sigla--vazia" aria-haspopup="menu" aria-expanded=${exp} aria-label="Lançar presença"
      title=${titulo || 'Lança quando a pessoa entrar'} disabled=${!pode || null} onClick=${(ev) => abrirMenu('sigla', l.id, ev)}>·</button>`;
  };

  const cabGrupo = (g) => html`<tr class="c-pd-grupo-cab"><td colspan=${nColunas}>
    <button type="button" class="c-pd-dobra" aria-expanded=${aberto(g) ? 'true' : 'false'} onClick=${() => setDobra((d) => ({ ...d, [g.id]: !aberto(g) }))}>
      <span class="c-pd-seta"><${Ic} nome="caret-right" /></span><span class="c-traco" style=${{ background: g.cor }}></span><b>${g.nome}</b><span>${g.entrada}–${g.saida}</span>
      <span class="c-pd-grupo-n">${resumoGrupo(g)}</span>
      ${g.naoLogaram ? html`<${Selo} tom="perigo" icone="warning-octagon">${g.naoLogaram} não logou<//>` : null}
    </button></td></tr>`;

  const linhaLista = (l) => html`<tr key=${l.id} hidden=${!passa(l, filtro) || null}>
    <td class="c-col-nome"><span class="c-abre-menu">${botaoNome(l)}</span></td>
    <td>${l.equipe ? (bruto.escala.todas_equipes && l.minha ? html`<span class="c-pd-minha">${l.equipe}</span>` : l.equipe) : html`<span class="c-pd-prev">—</span>`}</td>
    <td><${SeloAgora} l=${l} comLogin=${comLogin} /></td>
    <td><${Entrada} l=${l} comLogin=${comLogin} /></td>
    <td><${Pausas} l=${l} /></td>
    <td><span class="c-pd-prev">${l.saida}</span></td>
    <td class="c-estica">${l.troca ? html`<a class="c-pd-troca" href="#" title="Abrir a troca" onClick=${(ev) => { ev.preventDefault(); irPara('screen-wfm-trocas', 'trocas', l); }}><${Ic} nome="arrows-left-right" />${l.troca.texto}</a>` : null}</td>
    <td class="c-centro c-abre-menu">${botaoSigla(l)}</td>
  </tr>`;

  const mostraAgora = dia === hoje && agora >= EIXO_INI && agora <= EIXO_FIM;
  const linhaTempo = (l) => {
    const classe = `c-pd-barra ${l.afastado ? 'c-pd-barra--fora' : l.naoLogou ? 'c-pd-barra--falta' : ''}`.trim();
    const feitoIni = l.logado ? Math.max(Math.min(l.loginMin, l.ini), l.ini - 30) : null;
    const feitoFim = Math.min(agora, l.fim);
    return html`<tr key=${l.id} hidden=${!passa(l, filtro) || null}>
      <td class="c-col-nome"><span class="c-abre-menu">${botaoNome(l)}</span></td>
      <td><${SeloAgora} l=${l} comLogin=${comLogin} /></td>
      <td class="c-pd-tempo"><div class="c-pd-trilho" style=${{ '--t': l.turno.cor || 'var(--cor-acao-fundo)' }}>
        <span class=${classe} style=${faixa(l.ini, l.fim)} title=${`${l.turno.nome} ${l.entrada}–${l.saida}`}></span>
        ${l.logado && l.comecou && Number.isFinite(feitoFim) ? html`<span class="c-pd-feito" style=${faixa(feitoIni, feitoFim)} title=${`1º login ${hora(l.loginMin)}`}></span>` : null}
        ${l.afastado ? null : l.pausas.map((p) => html`<span key=${p.ordem} class="c-pd-p" style=${faixa(p.ini, p.fim)} title=${`Pausa prevista ${hora(p.ini)} (${p.duracao_min} min)`}></span>`)}
        ${mostraAgora ? html`<span class="c-pd-agora" style=${{ left: `${pctEixo(agora).toFixed(2)}%` }}></span>` : null}
      </div></td>
      <td class="c-centro c-abre-menu">${botaoSigla(l)}</td>
    </tr>`;
  };

  const menuAtual = menu ? linhas.find((l) => l.id === menu.id) : null;
  const cabecalho = html`<div class="c-cab-linha"><h1>Painel</h1>
    <div class="c-cab-dir">
      ${atualizadoEm ? html`<span class="c-secundario c-pd-atual" title="Atualiza sozinho a cada minuto"><${Ic} nome="arrows-clockwise" />Atualizado às ${hora(atualizadoEm.getHours() * 60 + atualizadoEm.getMinutes())}</span>` : null}
      ${podeLancar ? html`<button type="button" class="c-botao c-botao--secundario" disabled=${!loteAlvo.length || null}
        title=${comLogin ? (loteAlvo.length ? 'Lança P para quem já logou no Conecta hoje e ainda não tem presença' : 'Ninguém logado sem presença') : 'Sem dado de login no momento'}
        onClick=${marcarLote}><${Ic} nome="list-checks" />Marcar P em quem logou <span class="c-conta">${loteAlvo.length}</span></button>` : null}
    </div></div>`;

  const pagina = (conteudo) => html`<main class="c-pagina c-conteudo c-pd" ref=${mainRef} style=${{ position: 'relative' }}>${cabecalho}${conteudo}</main>`;
  if (erro) return pagina(html`<div class="c-tabela-caixa"><${Estado} titulo=${erro} rotuloAcao="Tentar de novo" aoAcao=${() => carregar()} /></div>`);

  const filtros = html`<div class="c-filtros c-filtros--suave">
    <div class="c-grupo c-navegar" role="group" aria-label="Dia" style=${{ gap: 0, flexWrap: 'nowrap' }}>
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Dia anterior" title="Dia anterior" onClick=${() => setDia(somarDias(dia, -1))}><${Ic} nome="caret-left" /></button>
      ${dia === hoje ? html`<span class="c-botao c-botao--texto c-botao--compacto" aria-live="polite" style=${{ cursor: 'default', color: 'var(--cor-texto-padrao)' }}>${tituloDia}</span>`
        : html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" aria-live="polite" title="Voltar para hoje" onClick=${() => setDia(hoje)}>${tituloDia}</button>`}
      <button type="button" class="c-botao c-botao--texto c-botao--icone c-botao--compacto" aria-label="Próximo dia" title="Próximo dia" onClick=${() => setDia(somarDias(dia, 1))}><${Ic} nome="caret-right" /></button>
    </div>
    ${operacoesAtivas.length > 1 ? html`<select class="c-entrada c-entrada--compacta" aria-label="Escala" value=${operacao} onChange=${(e) => { setTurno(''); setEquipe(''); aoTrocarEscala?.(e.target.value); }}>
      ${operacoesAtivas.map((o) => html`<option key=${o.chave} value=${o.chave}>${o.nome}</option>`)}</select>` : null}
    <div class="c-com-icone c-com-icone--compacta c-busca"><${Ic} nome="magnifying-glass" /><input class="c-entrada c-entrada--compacta" type="search" placeholder="Buscar" aria-label="Buscar colaborador" value=${busca} onInput=${(e) => setBusca(e.target.value)} /></div>
    <select class="c-entrada c-entrada--compacta" aria-label="Equipe" value=${equipe} onChange=${(e) => setEquipe(e.target.value)}>
      <option value="">Todas as equipes</option>${equipes.map((e) => html`<option key=${e} value=${e}>${e}</option>`)}</select>
    <select class="c-entrada c-entrada--compacta" aria-label="Turno" value=${turno} onChange=${(e) => setTurno(e.target.value)}>
      <option value="">Todos os turnos</option>${turnosDoDia.map(([id, nome]) => html`<option key=${id} value=${id}>${nome}</option>`)}</select>
    ${ehSupervisor ? html`<label class="c-interruptor c-pd-minha-eq"><input type="checkbox" checked=${soMinha} onChange=${(e) => setSoMinha(e.target.checked)} /><span>Só minha equipe</span></label>` : null}
    <div class="c-segmento c-fim" role="group" aria-label="Visão">
      <button type="button" class="c-botao" aria-pressed=${visao === 'lista' ? 'true' : 'false'} onClick=${() => setVisao('lista')}><${Ic} nome="list" />Lista</button>
      <button type="button" class="c-botao" aria-pressed=${visao === 'tempo' ? 'true' : 'false'} onClick=${() => setVisao('tempo')}><${Ic} nome="chart-bar" />Linha do tempo</button>
    </div>
  </div>`;

  if (!bruto) return pagina(html`<div class="c-tabela-caixa">${filtros}<${Esqueleto} linhas=${8} /></div>`);

  const resumo = html`<div class="c-pd-resumo" role="group" aria-label="Resumo do dia (clique para filtrar)">
    ${FILTROS.map(([f, rotulo, tom]) => {
    const semDado = f === 'pausa' || (!comLogin && ['logado', 'nao', 'atraso'].includes(f));
    const n = contagem[f];
    const classe = `c-pd-num ${!semDado && tom && n > 0 ? `c-pd-num--${tom}` : ''}`.trim();
    const titulo = f === 'pausa' ? 'O Conecta ainda não recebe as pausas reais' : semDado ? 'Sem dado de login no momento' : null;
    return html`<button key=${f} type="button" class=${classe} aria-pressed=${filtro === f ? 'true' : 'false'} title=${titulo} aria-disabled=${semDado ? 'true' : null}
      onClick=${() => { if (!semDado) mudarFiltro(f); }}><b>${semDado ? '—' : n}</b><small>${rotulo}</small></button>`;
  })}
  </div>`;

  const vazio = !grupos.length;
  const tabela = visao === 'lista'
    ? html`<table class="c-tabela c-tabela--compacta c-pd-lista">
        <thead><tr><th class="c-col-nome" scope="col">Colaborador</th><th scope="col">Equipe</th><th scope="col">Agora</th><th scope="col">Entrada</th><th scope="col">Pausas</th><th scope="col">Saída</th><th class="c-estica" scope="col">Troca</th><th class="c-centro" scope="col">Presença</th></tr></thead>
        ${grupos.map((g) => html`<tbody key=${g.id} class="c-pd-grupo" hidden=${!g.linhas.some((l) => passa(l, filtro)) || null}>${cabGrupo(g)}${aberto(g) ? g.linhas.map(linhaLista) : null}</tbody>`)}
      </table>`
    : html`<table class="c-tabela c-tabela--compacta c-pd-lista c-pd-lista--tempo">
        <thead><tr><th class="c-col-nome" scope="col">Colaborador</th><th scope="col">Agora</th><th class="c-pd-tempo" scope="col"><span class="c-oculto">Linha do tempo</span><${EixoHoras} /></th><th class="c-centro" scope="col">Presença</th></tr></thead>
        ${grupos.map((g) => html`<tbody key=${g.id} class="c-pd-grupo" hidden=${!g.linhas.some((l) => passa(l, filtro)) || null}>${cabGrupo(g)}${aberto(g) ? g.linhas.map(linhaTempo) : null}</tbody>`)}
      </table>`;
  const algumVisivel = grupos.some((g) => g.linhas.some((l) => passa(l, filtro)));

  return html`${pagina(html`
    <div class="c-tabela-caixa">
      ${filtros}
      ${dia === hoje ? html`<${FaixaDiarioPainel} controlador=${controlador} operacao=${operacao} />` : null}
      ${resumo}
      ${vazio ? html`<${Estado} icone="calendar-blank" titulo=${linhas.length ? 'Ninguém com estes filtros.' : 'Ninguém escalado para trabalhar neste dia.'}
          rotuloAcao=${linhas.length ? 'Limpar filtros' : null} aoAcao=${linhas.length ? () => { setBusca(''); setEquipe(''); setTurno(''); setSoMinha(false); setFiltro('todos'); } : null} />`
        : html`${tabela}${algumVisivel ? null : html`<${Estado} titulo="Ninguém neste número agora." rotuloAcao="Ver todos os escalados" aoAcao=${() => setFiltro('todos')} />`}`}
      <div class="c-tabela-rodape c-pd-legenda">
        <span class="c-pd-l-prox">próxima pausa</span>
        <span>pausas previstas na escala</span>
        <span class="c-fim">Clique no nome para ver o diário · clique na presença para lançar</span>
      </div>
    </div>
    ${menu && menuAtual && menu.tipo === 'pessoa' ? html`<${MenuSolto} menu=${menu} fechar=${fecharMenu} rotulo=${`Ações de ${menuAtual.nome}`}>
      <div class="c-pd-menu-cab"><b>${menuAtual.nome}</b><small>${[menuAtual.equipe, menuAtual.turno.nome].filter(Boolean).join(' · ')}</small></div>
      <button type="button" role="menuitem" class="c-menu-item" disabled=${!pode('screen-equipes-controle') || null} onClick=${() => irPara('screen-equipes-controle', 'equipes', menuAtual)}><${Ic} nome="book-open" />Ver diário<span class="c-pd-breve">em breve</span></button>
      <button type="button" role="menuitem" class="c-menu-item" disabled=${!aoVerEscalaMes || null} onClick=${() => { setMenu(null); pedirFocoPessoa('escala-mes', menuAtual.nome); aoVerEscalaMes?.(dia.slice(0, 7)); }}><${Ic} nome="calendar-dots" />Ver escala do mês</button>
      <button type="button" role="menuitem" class="c-menu-item" disabled=${!pode('screen-wfm-presenca') || null} onClick=${() => irPara('screen-wfm-presenca', 'presenca', menuAtual)}><${Ic} nome="user-check" />Ver presença da semana</button>
      <button type="button" role="menuitem" class="c-menu-item" disabled=${!pode('screen-wfm-trocas') || null} onClick=${() => irPara('screen-wfm-trocas', 'trocas', menuAtual)}><${Ic} nome="arrows-left-right" />Ver trocas</button>
    <//>` : null}
    ${menu && menuAtual && menu.tipo === 'sigla' ? html`<${MenuSolto} menu=${menu} fechar=${fecharMenu} classe="c-pd-menu--siglas" rotulo=${`Presença de ${menuAtual.nome}`}>
      ${ORDEM_SIGLAS.map((k) => html`<button key=${k} type="button" role="menuitem" class="c-menu-item" aria-current=${menuAtual.presenca === k ? 'true' : null}
        onClick=${() => lancar({ ...menuAtual, ancoraFoco: menu.ancora }, k)}><span class=${`c-sigla c-selo--${TOM_SIGLA[k] || 'neutro'}`}>${SIGLA_PRESENCA[k]}</span>${ROTULO_STATUS_PRESENCA[k]}</button>`)}
      <button type="button" role="menuitem" class="c-menu-item" disabled title="O Conecta ainda não permite apagar um lançamento de presença"><span class="c-sigla c-selo--neutro">—</span>Sem lançamento</button>
    <//>` : null}
    ${aviso ? html`<div class="c-aviso c-pd-aviso" role="status" key=${aviso.id}>
      <${Ic} nome="check-circle" /><p>${aviso.texto}</p>
      ${aviso.desfazer ? html`<button type="button" class="c-botao c-botao--texto c-botao--compacto" onClick=${() => { aviso.desfazer(); setAviso(null); }}>Desfazer</button>` : null}
    </div>` : null}
  `)}`;
}
