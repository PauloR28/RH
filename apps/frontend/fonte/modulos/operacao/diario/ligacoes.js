import { html, useEffect, useState } from '../../../infraestrutura-react.js';
import { intercorrenciasNoHorario, lerResumoHojeDiario } from '../../../services/api/diario.js';
import { Ic, Selo } from '../../../ui/components/ds.js?v=20261106-wfm';

// Ligações do Diário de bordo com o resto do Conecta (amostra quadro 6). Só leitura; cada uma some quando a pessoa não tem
// permissão ou quando a operação não tem diário. Nunca bloqueiam a tela de origem: erro de leitura = a faixa não aparece.

const CHAVE_DIA = 'conecta.diario.irParaDia';
// Abre o diário num dia/operação (uso único, 60 s).
export const pedirDiaDiario = (operacao, data) => { try { window.sessionStorage.setItem(CHAVE_DIA, JSON.stringify({ operacao, data, em: Date.now() })); } catch { /* ignora */ } };
export const tomarDiaPedido = () => {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CHAVE_DIA) || 'null');
    window.sessionStorage.removeItem(CHAVE_DIA);
    return v && Date.now() - v.em < 60000 ? v : null;
  } catch { return null; }
};

const ESTADO = {
  concluido: ['check-circle', 'c-db-st--ok'], rascunho: ['pencil-simple', 'c-db-st--rasc'], reaberto: ['arrow-counter-clockwise', 'c-db-st--rasc'], vazio: ['circle-dashed', 'c-db-st--vazio'],
};
const ROT_ESTADO = { concluido: 'concluído', rascunho: 'rascunho', reaberto: 'reaberto', vazio: 'não começou' };

export function useResumoDiarioHoje(controlador) {
  const pode = controlador?.possuiPermissao?.('diario.visualizar');
  const [itens, setItens] = useState(null);
  useEffect(() => {
    if (!pode) return undefined;
    let vivo = true;
    lerResumoHojeDiario().then((r) => { if (vivo) setItens(r.itens || []); }).catch(() => { if (vivo) setItens([]); });
    return () => { vivo = false; };
  }, [pode]);
  return pode ? itens : [];
}

// Painel do dia: 1 faixa com os 3 turnos de hoje, intercorrências abertas e "Abrir diário".
export function FaixaDiarioPainel({ controlador, operacao }) {
  const itens = useResumoDiarioHoje(controlador);
  const base = String(operacao || '').split('::')[0];
  const r = (itens || []).find((x) => x.operacao === base);
  if (!r) return null;
  const abrir = () => { pedirDiaDiario(r.operacao, r.data); controlador.irParaTelaProtegida('screen-diario'); };
  return html`<div class="c-db-tira" role="group" aria-label="Diário de bordo de hoje">
    <b><${Ic} nome="notebook" />Diário de bordo</b>
    ${r.turnos.map((t) => html`<span key=${t.turno} class="c-db-tira-it"><span class=${`c-db-st ${ESTADO[t.estado]?.[1] || ''}`} role="img" aria-label=${ROT_ESTADO[t.estado]}><${Ic} nome=${ESTADO[t.estado]?.[0] || 'circle-dashed'} /></span>${t.rotulo}
      <small>${t.estado === 'concluido' && t.concluido_em ? t.concluido_em.slice(11, 16) : ROT_ESTADO[t.estado]}</small></span>`)}
    ${r.intercorrencias_abertas ? html`<span class="c-db-tira-it"><${Selo} tom="perigo" icone="warning-octagon">${r.intercorrencias_abertas} ${r.intercorrencias_abertas === 1 ? 'intercorrência aberta' : 'intercorrências abertas'}<//></span>` : null}
    <button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${abrir}><${Ic} nome="arrow-right" />Abrir diário</button>
  </div>`;
}

// Início do Supervisor › Precisa de você: o turno do diário da hora atual (ou um anterior) ainda sem concluir.
export function pendenciasDiario(itens, controlador) {
  if (!controlador?.possuiPermissao?.('diario.preencher')) return [];
  const ordem = ['abertura', 'intermediario', 'fechamento'];
  return (itens || []).flatMap((r) => {
    const ate = ordem.indexOf(r.turno_atual);
    const faltam = r.turnos.filter((t) => ordem.indexOf(t.turno) <= ate && t.estado !== 'concluido');
    if (!faltam.length || r.status_dia === 'encerrado') return [];
    const ultimo = faltam[faltam.length - 1];
    return [{
      chave: `diario-${r.operacao}`, operacao: r.operacao, data: r.data, qtd: faltam.length,
      titulo: `${ultimo.rotulo} do diário para concluir${(itens || []).length > 1 ? ` · ${r.nome}` : ''}`,
      prazo: ultimo.turno === 'fechamento' ? `Turno acaba ${r.prazo_fechamento}` : 'Turno em andamento',
    }];
  });
}

// Monitoria (Nova monitoria e contestação): aviso quando a ligação caiu numa intercorrência registrada no diário.
// `momento`: 'AAAA-MM-DD' (a Monitoria guarda só o dia do contato) ou 'AAAA-MM-DDTHH:MM'.
export function AvisoIntercorrencia({ controlador, operacao, momento }) {
  const [itens, setItens] = useState([]);
  useEffect(() => {
    setItens([]);
    if (!operacao || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(momento || '').slice(0, 16))) return undefined;
    let vivo = true;
    const t = setTimeout(() => intercorrenciasNoHorario(operacao, String(momento).slice(0, 16)).then((r) => { if (vivo) setItens(r.itens || []); }).catch(() => {}), 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [operacao, momento]);
  if (!itens.length) return null;
  const podeAbrir = controlador?.possuiPermissao?.('diario.visualizar') || controlador?.possuiPermissao?.('diario.intercorrencias');
  const soDia = String(momento).length === 10;
  const data = String(momento).slice(0, 10);
  const faixa = (i) => `${i.inicio.slice(0, 10) !== data ? `${i.inicio.slice(8, 10)}/${i.inicio.slice(5, 7)} ` : ''}${i.inicio.slice(11, 16)}${i.fim ? `–${i.fim.slice(11, 16)}` : ' (em aberto)'}`;
  const lista = itens.map((i) => `${faixa(i)} · ${i.ferramenta}: ${String(i.descricao || '').trim().replace(/[.;\s]+$/, '')}`).join('; ');
  return html`<div class="c-faixa c-faixa--informacao" role="status"><${Ic} nome="info" />
    <div class="c-faixa-txt"><p><b>Havia ${itens.length > 1 ? `${itens.length} intercorrências` : 'uma intercorrência'} ${soDia ? 'no dia do contato' : 'nesse horário'}.</b> ${lista}. ${soDia ? 'Confira se a ligação foi nesse horário ' : 'Considere isso '}antes de tirar pontos de encerramento ou espera.</p>
      ${podeAbrir ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${() => { pedirDiaDiario(operacao, data); controlador.irParaTelaProtegida('screen-diario'); }}>Ver no diário</button>` : null}</div></div>`;
}
