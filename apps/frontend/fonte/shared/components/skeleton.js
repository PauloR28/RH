import { html } from '../../infraestrutura-react.js?v=20261126-painel-graficos';

const LARGURAS_PADRAO = [80, 55, 70, 45, 90, 60, 40, 75, 50, 65];

export function SkeletonTableRows({ colunas, linhas = 5 }) {
  const totalColunas = Math.max(1, colunas);

  return Array.from({ length: linhas }).map(
    (_, indiceLinha) => html`
      <tr class="c24-skeleton-row" key=${`skeleton-${indiceLinha}`}>
        ${Array.from({ length: totalColunas }).map((__, indiceColuna) => {
          const largura = LARGURAS_PADRAO[(indiceLinha + indiceColuna) % LARGURAS_PADRAO.length];
          return html`
            <td key=${indiceColuna}>
              <div class="c24-skeleton-bar" style=${{ width: `${largura}%` }}></div>
            </td>
          `;
        })}
      </tr>
    `,
  );
}
