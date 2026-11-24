// Peças do Painel (14/11/2026) usadas pela tela e pelos blocos das métricas da amostra v6.
// Só desenham com classes c- (conecta-ds.css) e c-pg- (estilos/painel.css).
import { html, useState } from '../../infraestrutura-react.js?v=20261124-equipes';
import { Estado, Ic } from '../../ui/components/ds.js?v=20261124-equipes';

export const POR_PAGINA_SUB = 5;
export const POR_PAGINA_OPS = 10;
export const ROTULO_TROCA = { APROVADA: ['Aprovada', 'sucesso'], AGUARDANDO_B: ['Esperando o colega', 'atencao'], AGUARDANDO_APROVACAO: ['Esperando aprovação', 'atencao'],
  REPROVADA: ['Reprovada', 'perigo'], RECUSADA: ['Recusada', 'perigo'], CANCELADA: ['Cancelada', 'neutro'], EXPIRADA: ['Expirada', 'neutro'], DESFEITA: ['Desfeita', 'neutro'] };
export const TOM_SIGLA = { P: 'sucesso', F: 'perigo', FJ: 'informacao', AT: 'informacao', FL: 'neutro', FE: 'neutro', FB: 'neutro', DO: 'neutro', SE: 'neutro' };
export const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR'));
export const pct = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}%`);
export const nota = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
export const diaSemana = (iso) => {
  if (!iso) return '';
  if (iso === 'Hoje') return 'Hoje';
  const d = new Date(`${iso}T12:00:00`);
  return `${SEMANA[d.getDay()]}, ${ddmm(iso)}`;
};
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');

export function Indicador({ rotulo, valor, sufixo = '', nota: obs = '', tom = '' }) {
  return html`<div class="c-indicador">
    <span class="c-ind-rotulo">${rotulo}</span>
    <span class="c-ind-valor">${valor}${sufixo ? html`<small>${sufixo}</small>` : null}</span>
    <span class=${`c-ind-nota${tom ? ` c-tom-${tom}` : ''}`}>${obs}</span>
  </div>`;
}

export function Cartao({ titulo, acao = null, children }) {
  return html`<article class="c-cartao c-pg-cartao">
    <div class="c-cartao-cab"><h2>${titulo}</h2>${acao}</div>
    ${children}
  </article>`;
}

export function Indisponivel({ texto }) {
  return html`<div class="c-pg-vazio"><${Estado} titulo=${texto} /></div>`;
}

// Tabela curta dentro de uma linha aberta: sem barra de rolagem, texto quebra, 5 por página.
export function MiniTabela({ colunas, linhas, longa = false }) {
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA_SUB));
  const visiveis = linhas.slice((pagina - 1) * POR_PAGINA_SUB, pagina * POR_PAGINA_SUB);
  return html`<div class="c-tabela-caixa c-pg-mini">
    <table class="c-tabela c-tabela--compacta">
      ${longa ? html`<colgroup>${colunas.map((c, i) => html`<col key=${c} style=${{ width: i === colunas.length - 1 ? '50%' : `${50 / (colunas.length - 1)}%` }} />`)}</colgroup>` : null}
      <thead><tr>${colunas.map((c) => html`<th key=${c}>${c}</th>`)}</tr></thead>
      <tbody>${visiveis.map((l, i) => html`<tr key=${i}>${l.map((c, j) => html`<td key=${j} data-papel=${j === 0 ? 'titulo' : 'info'} data-prioridade=${j === 0 ? null : '1'} data-primeira=${j === 1 ? '' : null}>${c}</td>`)}</tr>`)}</tbody>
    </table>
    ${paginas > 1 ? html`<div class="c-tabela-rodape c-pg-rodape">
      <span>${(pagina - 1) * POR_PAGINA_SUB + 1}–${Math.min(linhas.length, pagina * POR_PAGINA_SUB)} de ${linhas.length}</span>
      <span class="c-grupo">
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${pagina === 1 || null} onClick=${() => setPagina(pagina - 1)}>Anterior</button>
        <button type="button" class="c-botao c-botao--secundario c-botao--compacto" disabled=${pagina === paginas || null} onClick=${() => setPagina(pagina + 1)}>Próxima</button>
      </span>
    </div>` : null}
  </div>`;
}

// Linha de lista: abre a sublista ao clicar (quando há detalhe). `fixa` = linha que nunca abre (ex.: Frequência).
export function Linha({ titulo, direita, detalhe = null, fixa = false }) {
  const [aberta, setAberta] = useState(false);
  if (fixa || !detalhe) {
    return html`<li><div class="c-pg-linha">${fixa ? null : html`<span class="c-pg-sem-seta"></span>`}<span class="c-pg-estica">${titulo}</span>${direita}</div></li>`;
  }
  return html`<li>
    <button type="button" class="c-pg-linha" aria-expanded=${aberta ? 'true' : 'false'} onClick=${() => setAberta(!aberta)}>
      <span class="c-pg-seta"><${Ic} nome="caret-right" /></span><span class="c-pg-estica">${titulo}</span>${direita}
    </button>
    ${aberta ? html`<div class="c-pg-detalhe">${detalhe}</div>` : null}
  </li>`;
}

export const Contador = ({ n, tom = 'atencao' }) => html`<span class=${`c-selo c-selo--${n ? tom : 'neutro'}`}>${num(n)}</span>`;
