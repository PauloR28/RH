import { html, useRef } from '../../infraestrutura-react.js';
import { IconeSvg } from '../../ui/icone.js';

// Peças da tela Nova monitoria: respostas SIM/NÃO/NCG/N/A, escala dos pilares, trilho de etapas
// e barra de progresso. Cores só por tokens do tema (classes em monitoria.css).

// Move o foco/seleção entre opções de um radiogroup com as setas.
function useSetas(total, aoMover) {
  const refs = useRef([]);
  const aoTeclar = (ev, i) => {
    const passo = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!passo) return;
    ev.preventDefault();
    const alvo = (i + passo + total) % total;
    refs.current[alvo]?.focus();
    aoMover(alvo);
  };
  return { refs, aoTeclar };
}

const RESP_CLASSE = { SIM: 'sim', NAO: 'nao', NCG: 'ncg', NA: 'na' };

// Clicar de novo na opção marcada desmarca (valor vira null).
export function AnswerSegmented({ opcoes, valor, rotulo, aoMudar }) {
  const { refs, aoTeclar } = useSetas(opcoes.length, (i) => aoMudar(opcoes[i].valor));
  const focavel = Math.max(0, opcoes.findIndex((o) => o.valor === valor));
  return html`
    <div class="mon-nm-resp" role="radiogroup" aria-label=${rotulo}>
      ${opcoes.map((o, i) => html`
        <button key=${o.valor} type="button" role="radio" aria-checked=${valor === o.valor} tabIndex=${i === focavel ? 0 : -1}
          ref=${(el) => { refs.current[i] = el; }}
          class=${`mon-nm-resp-op mon-nm-resp-op--${RESP_CLASSE[o.valor]} ${valor === o.valor ? 'is-on' : ''}`}
          onClick=${() => aoMudar(valor === o.valor ? null : o.valor)} onKeyDown=${(ev) => aoTeclar(ev, i)}>${o.rotulo}</button>`)}
    </div>`;
}

// Escala de notas dos pilares (min..max vindos do formulário).
export function RatingScale({ min, max, valor, rotulo, aoMudar }) {
  const notas = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
  const { refs, aoTeclar } = useSetas(notas.length, (i) => aoMudar(notas[i]));
  const focavel = Math.max(0, notas.indexOf(valor));
  return html`
    <div class="mon-nm-escala" role="radiogroup" aria-label=${rotulo}>
      ${notas.map((n, i) => html`
        <button key=${n} type="button" role="radio" aria-checked=${valor === n} tabIndex=${i === focavel ? 0 : -1}
          ref=${(el) => { refs.current[i] = el; }} class=${`mon-nm-nota ${valor === n ? 'is-on' : ''}`}
          onClick=${() => aoMudar(n)} onKeyDown=${(ev) => aoTeclar(ev, i)}>${n}</button>`)}
    </div>`;
}

export function ProgressBar({ valor, total, rotulo }) {
  const pct = total ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return html`<div class="mon-nm-barra" role="progressbar" aria-label=${rotulo} aria-valuemin="0" aria-valuemax=${total} aria-valuenow=${valor}><span style=${{ width: `${pct}%` }}></span></div>`;
}

// Trilho de etapas: número (ou check verde quando completa), nome e contador à direita.
export function StepRail({ etapas, ativa, aoEscolher }) {
  return html`
    <ol class="mon-nm-trilho">
      ${etapas.map((e, i) => html`
        <li key=${e.id}>
          <button type="button" class=${`mon-nm-etapa ${ativa === e.id ? 'is-ativa' : ''}`} aria-current=${ativa === e.id ? 'step' : undefined} onClick=${() => aoEscolher(e.id)}>
            <span class=${`mon-nm-etapa-num ${e.completa ? 'is-ok' : ''}`}>${e.completa ? html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('check')}</span>` : i + 1}</span>
            <span class="mon-nm-etapa-nome" title=${e.rotulo}>${e.rotulo}</span>
            <span class=${`mon-nm-etapa-cont ${e.aviso ? 'is-aviso' : ''}`}>${e.contador}</span>
          </button>
        </li>`)}
    </ol>`;
}

// Resposta em somente leitura (Detalhe da monitoria): pílula SIM / NÃO / NCG / N/A.
const ROTULO_RESPOSTA = { SIM: 'SIM', NAO: 'NÃO', NCG: 'NCG', NA: 'N/A' };
export function AnswerBadge({ valor }) {
  const texto = ROTULO_RESPOSTA[valor] || valor || '—';
  return html`<span class=${`mon-dt-resp mon-dt-resp--${RESP_CLASSE[valor] || 'na'}`}>${texto}</span>`;
}
