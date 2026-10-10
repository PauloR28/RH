import { html, useEffect, useRef, useState } from '../../../infraestrutura-react.js';
import { IconeSvg } from '../../../ui/icone.js';
import { textoLegivel } from './compartilhar.js?v=20261007-admin-escala';

// Peças compartilhadas da administração de escala (Escala do dia, Escala mensal e gaveta "Ajustar dia").
// Só apresentação e estado local de interface; regras, API e permissões continuam nas telas. Estilos: bloco `.ea-*` em estilos/wfm.css.

export const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const aMin = (hm) => { const [h, m] = String(hm || '00:00').split(':').map(Number); return h * 60 + m; };
export const deMin = (min) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
// Duração em minutos entre dois HH:mm, atravessando a meia-noite quando preciso.
export const duracaoMin = (ini, fim) => (ini && fim ? (((aMin(fim) - aMin(ini)) % 1440) + 1440) % 1440 : 0);
export const paraIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const doIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
export const brData = (iso) => iso.split('-').reverse().join('/');
export const SEMANA_LONGA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

// Quadradinho de 10px na cor do turno (DSR: borda tracejada).
export function Quadrado({ cor, dsr = false }) {
  return html`<span class=${`ea-sq ${dsr ? 'is-dsr' : ''}`} style=${!dsr && cor ? { '--ea-cor': cor } : undefined} aria-hidden="true"></span>`;
}

// Faixa horária de um turno ("08:00–14:20"), vazia se o turno não tem horário.
export const faixaTurno = (t) => (t?.entrada ? `${t.entrada}–${t.saida}` : '');

// Controle segmentado "Escala do dia | Escala mensal": só navegação entre as telas (escala e mês seguem nas props da página).
export function SeletorVisao({ visao, aoDia, aoMes }) {
  return html`<div class="ea-visao" role="group" aria-label="Visão da escala">
    <button type="button" class=${visao === 'dia' ? 'is-ativo' : ''} aria-pressed=${visao === 'dia'} disabled=${!aoDia && visao !== 'dia'} onClick=${visao === 'dia' ? undefined : aoDia}>Escala do dia</button>
    <button type="button" class=${visao === 'mes' ? 'is-ativo' : ''} aria-pressed=${visao === 'mes'} disabled=${!aoMes && visao !== 'mes'} onClick=${visao === 'mes' ? undefined : aoMes}>Escala mensal</button>
  </div>`;
}

export function TituloEscala({ nome, escalados, emDsr, versao, aoVoltarLista, menu }) {
  return html`<div class="ea-titulo">
    <div class="ea-titulo-txt">
      <h3>${nome}</h3>
      <p class="ea-badges"><span class="mon-badge mon-badge--ok">${escalados} escalado(s)</span><span class="mon-badge mon-badge--nula">${emDsr} em DSR/folga</span>${versao ? html`<span class="mon-badge mon-badge--pendente">Publicada v${versao}</span>` : null}</p>
    </div>
    <div class="ea-titulo-acoes">
      ${aoVoltarLista ? html`<button type="button" class="btn btn-outline-secondary" onClick=${aoVoltarLista}><${Icone} nome="arrow_back" />Escalas</button>` : null}
      ${menu}
    </div>
  </div>`;
}

let seq = 0;
const novoId = (p) => { seq += 1; return `${p}-${seq}`; };

// Linha de filtros compactos (36px / 13px): busca + selects + contagem anunciada.
// `selects`: [{ rotulo, valor, aoMudar, padrao: 'Equipe: todas', opcoes: [[valor, rotulo]] }]
export function FiltrosCompactos({ rotuloBusca, busca, aoBuscar, selects, contagem }) {
  const [id] = useState(() => novoId('ea-f'));
  return html`<div class="ea-filtros">
    <div class="ea-busca">
      <label class="visually-hidden" for=${`${id}-b`}>${rotuloBusca}</label>
      <span class="ea-busca-icone" aria-hidden="true"><${Icone} nome="search" /></span>
      <input id=${`${id}-b`} type="search" class="ea-campo" placeholder=${rotuloBusca} value=${busca} onInput=${(e) => aoBuscar(e.target.value)} />
    </div>
    ${selects.map((s, i) => html`<div key=${s.rotulo}>
      <label class="visually-hidden" for=${`${id}-s${i}`}>${s.rotulo}</label>
      <select id=${`${id}-s${i}`} class=${`ea-campo ea-select ea-select--${s.largura || 'm'}`} value=${s.valor} onChange=${(e) => s.aoMudar(e.target.value)}>
        <option value="">${s.padrao}</option>${s.opcoes.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}
      </select></div>`)}
    <span class="ea-contagem" aria-live="polite">${contagem}</span>
  </div>`;
}

// Checkbox do cabeçalho: marca todos do filtro; indeterminado quando a seleção é parcial.
export function CheckTodos({ rotulo, total, marcados, aoAlternar }) {
  const ref = useRef(null);
  const todos = total > 0 && marcados === total;
  useEffect(() => { if (ref.current) ref.current.indeterminate = marcados > 0 && marcados < total; }, [marcados, total]);
  return html`<input ref=${ref} type="checkbox" class="ea-check" aria-label=${rotulo} checked=${todos} disabled=${!total} onChange=${aoAlternar} />`;
}

// Barra de ações em massa: só existe com ao menos um selecionado.
export function BarraSelecao({ n, aoLimpar, children }) {
  if (!n) return null;
  return html`<div class="ea-massa" role="region" aria-label="Ações em massa">
    <strong class="ea-massa-n" aria-live="polite">${n} ${n === 1 ? 'selecionado' : 'selecionados'}</strong>
    ${children}
    <button type="button" class="ea-massa-limpar" onClick=${aoLimpar}>Limpar seleção</button>
  </div>`;
}

// Legenda dos turnos que aparecem na tela (amostra com o código + nome + horário) e o DSR no fim.
export function LegendaTurnos({ turnos }) {
  return html`<div class="ea-legenda">
    <span class="ea-rotulo">LEGENDA</span>
    ${turnos.map((t) => html`<span key=${t.id_turno} class="ea-legenda-item"><span class="ea-amostra" style=${{ '--ea-cor': t.cor, '--ea-fg': textoLegivel(t.cor) }}>${t.codigo}</span>${t.nome}${t.entrada ? html` <span class="ea-muted ea-num">${faixaTurno(t)}</span>` : null}</span>`)}
    <span class="ea-legenda-item"><span class="ea-amostra ea-amostra--dsr">DSR</span>Descanso semanal</span>
  </div>`;
}

// Escolha do turno direto na linha: botão de 36px que abre uma lista (popover) com os turnos e o DSR.
export function SeletorTurnoLinha({ turno, turnos, rotuloAria, desabilitado, aoEscolher }) {
  const [aberto, setAberto] = useState(null); // { x, y, topo } quando aberto
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAberto(null); };
    const esc = (e) => { if (e.key === 'Escape') { setAberto(null); raiz.current?.querySelector('.ea-turno-btn')?.focus(); } };
    const fechar = () => setAberto(null);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', fechar, true); window.removeEventListener('resize', fechar); };
  }, [aberto]);
  useEffect(() => { if (aberto) raiz.current?.querySelector('.ea-turno-item.is-ativo, .ea-turno-item')?.focus(); }, [aberto]);

  const abrir = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const altura = 40 + (turnos.length + 1) * 36;
    const cabeAbaixo = r.bottom + 4 + Math.min(altura, 320) < window.innerHeight;
    setAberto({ x: Math.max(8, Math.min(r.left, window.innerWidth - 232)), y: cabeAbaixo ? r.bottom + 4 : Math.max(8, r.top - 4 - Math.min(altura, 320)) });
  };
  const escolher = (valor) => { setAberto(null); aoEscolher(valor); raiz.current?.querySelector('.ea-turno-btn')?.focus(); };
  const dsr = !turno;
  return html`<span class="ea-turno" ref=${raiz}>
    <button type="button" class=${`ea-turno-btn ${dsr ? 'is-dsr' : ''}`} aria-label=${rotuloAria} aria-haspopup="menu" aria-expanded=${!!aberto} disabled=${desabilitado} title=${turno ? turno.nome : 'DSR'} onClick=${aberto ? () => setAberto(null) : abrir}>
      <${Quadrado} cor=${turno?.cor} dsr=${dsr} /><span class="ea-turno-nome">${turno ? turno.nome : 'DSR'}</span><${Icone} nome="expand_more" />
    </button>
    ${aberto ? html`<div class="ea-turno-menu" role="menu" style=${{ left: `${aberto.x}px`, top: `${aberto.y}px` }}>
      ${turnos.map((t) => html`<button type="button" role="menuitemradio" aria-checked=${t.id_turno === turno?.id_turno} key=${t.id_turno} class=${`ea-turno-item ${t.id_turno === turno?.id_turno ? 'is-ativo' : ''}`} onClick=${() => escolher(String(t.id_turno))}>
        <${Quadrado} cor=${t.cor} /><span class="ea-turno-nome">${t.nome}</span><span class="ea-muted ea-num">${faixaTurno(t)}</span></button>`)}
      <button type="button" role="menuitemradio" aria-checked=${dsr} class=${`ea-turno-item ${dsr ? 'is-ativo' : ''}`} onClick=${() => escolher('')}><${Quadrado} dsr=${true} /><span class="ea-turno-nome">DSR</span><span class="ea-muted">sem turno</span></button>
    </div>` : null}
  </span>`;
}

export { Icone };
