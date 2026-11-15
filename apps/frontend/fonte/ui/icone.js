import { html, React } from '../infraestrutura-react.js';
import { ICONES } from './icones-svg.js';

// Fase 09 (DEC-050): desenhos do Phosphor, duas tonalidades, em grade 256 × 256,
// preenchidos com currentColor (antes: traço de 2 px em 24 × 24).
// A camada clara de cada ícone já vem com opacity 0.2 no próprio desenho.

// Ícone genérico usado quando um nome não é encontrado no conjunto
// (evita um espaço em branco silencioso na tela).
const FALLBACK = [['path', { d: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z' }]];

const NOMES_AVISADOS = new Set();

function construirFormas(nome) {
  const formas = ICONES[nome] || FALLBACK;
  if (!ICONES[nome] && !NOMES_AVISADOS.has(nome)) {
    NOMES_AVISADOS.add(nome);
    if (typeof console !== 'undefined' && nome) {
      console.warn(`[icone] "${nome}" não está no conjunto de ícones (apps/frontend/fonte/ui/icones-svg.js).`);
    }
  }
  return formas.map(([tag, atributos], indice) => React.createElement(tag, { key: indice, ...atributos }));
}

// Renderiza só o <svg> do ícone. Mesmo uso de antes: troca o conteúdo de um
// <span class="material-symbols-outlined"> sem mudar a tag, as classes ou o CSS.
export function IconeSvg(nome) {
  return html`
    <svg
      viewBox="0 0 256 256"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      ${construirFormas(nome)}
    </svg>
  `;
}

// Componente completo (span + ícone), igual ao anterior.
export function Icone({ name, className = '' }) {
  return html`
    <span class=${`material-symbols-outlined ${className}`.trim()} aria-hidden="true">
      ${IconeSvg(name)}
    </span>
  `;
}
