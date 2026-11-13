// Diário de bordo · regras de tela (espelho de rh_api/services/diario_regras.py, só para mostrar enquanto a pessoa digita).
// Quem decide de verdade é o servidor; aqui só se evita esperar a resposta para ver "Tratadas" e os avisos.
// VAZIO NUNCA VIRA 0: `null` atravessa as contas e aparece como "—".

export const TURNOS = ['abertura', 'intermediario', 'fechamento'];
export const ROTULO_TURNO = { abertura: 'Abertura', intermediario: 'Intermediário', fechamento: 'Fechamento' };
export const ROTULO_TURNO_CURTO = { abertura: 'Abert.', intermediario: 'Interm.', fechamento: 'Fech.' };
export const ENCERRAMENTOS = [['sem_pendencias', 'Sem pendências'], ['com_pendencias', 'Com pendências para o próximo dia'], ['outro', 'Outro']];
export const ROTULO_ENCERRAMENTO = Object.fromEntries(ENCERRAMENTOS);
export const CANAIS = [['digital', 'Digital'], ['voz', 'Voz'], ['ambos', 'Os dois'], ['interno', 'Só interno']];
export const ROTULO_CANAL = Object.fromEntries(CANAIS);

export const numeroOuVazio = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
};
export const pctOuVazio = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
// Turno pela hora (mesmos limites do servidor): Abertura até 11:59, Intermediário 12:00–16:59, Fechamento 17:00+.
export const turnoPelaHora = (hhmmTxt) => (hhmmTxt >= '17:00' ? 'fechamento' : hhmmTxt >= '12:00' ? 'intermediario' : 'abertura');
export const tratadas = (ini, fim) => (ini === null || fim === null || ini === undefined || fim === undefined ? null : Math.max(0, ini - fim));
export const somaOuVazio = (lista) => { const v = lista.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((s, x) => s + x, 0) : null; };

export function avisosDoTurno(linhas) {
  const avisos = [];
  linhas.forEach((d) => {
    const { inicio: a, fim: b } = d;
    if (a !== null && b !== null && b > a) avisos.push({ ...d, tipo: 'fim_maior', texto: 'Fim maior que o início' });
    else if (a === null && b === null) avisos.push({ ...d, tipo: 'vazio', texto: 'Início e fim vazios' });
    else if (a === null) avisos.push({ ...d, tipo: 'vazio', texto: 'Início vazio' });
    else if (b === null) avisos.push({ ...d, tipo: 'vazio', texto: 'Fim vazio' });
  });
  return avisos;
}

// Consolidado do dia com os valores que estão na tela (mesma regra do servidor).
export function consolidar(turnos, idsDemanda, idsNs) {
  const linhas = idsDemanda.map((id) => {
    let ini = null; let iniDe = null; let pend = null; let pendDe = null; const trat = [];
    TURNOS.forEach((t) => {
      const par = turnos[t]?.demandas?.[id];
      if (!par) return;
      if (ini === null && par.inicio !== null && par.inicio !== undefined) { ini = par.inicio; iniDe = t; }
      if (par.fim !== null && par.fim !== undefined) { pend = par.fim; pendDe = t; }
      trat.push(tratadas(par.inicio ?? null, par.fim ?? null));
    });
    return { id_item: id, inicio: ini, inicio_de: iniDe, tratadas: somaOuVazio(trat), pendente: pend, pendente_de: pendDe };
  });
  const ns = idsNs.map((id) => {
    let valor = null; let de = null;
    TURNOS.forEach((t) => { const v = turnos[t]?.ns?.[id]; if (v !== null && v !== undefined) { valor = v; de = t; } });
    return { id_item: id, valor, de };
  });
  return {
    demandas: linhas,
    totais: { inicio: somaOuVazio(linhas.map((l) => l.inicio)), tratadas: somaOuVazio(linhas.map((l) => l.tratadas)), pendente: somaOuVazio(linhas.map((l) => l.pendente)) },
    ns,
  };
}

// ── Formatação ──
export const nf = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR'));
export const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
export const pctCampo = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const pad = (n) => String(n).padStart(2, '0');
export const paraIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const doIso = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(a, m - 1, d); };
export const somarDias = (iso, n) => { const d = doIso(iso); d.setDate(d.getDate() + n); return paraIso(d); };
export const somarMes = (anoMes, n) => { const [a, m] = anoMes.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const diaCurto = (iso) => `${SEMANA[doIso(iso).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const diaHist = (iso) => `${SEMANA[doIso(iso).getDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const diaLongo = (iso) => `${SEMANA[doIso(iso).getDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const rotuloMes = (anoMes) => `${MESES[Number(anoMes.slice(5, 7)) - 1]} ${anoMes.slice(0, 4)}`;
export const hhmm = (isoDataHora) => (isoDataHora ? String(isoDataHora).slice(11, 16) : '');
export const dataHoraBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : '');
