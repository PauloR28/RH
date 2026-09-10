import { IconeSvg } from '../icone.js';
import { html, useEffect, useState } from '../../infraestrutura-react.js';

// Extraído de features/processos/index.js (Correções.txt item 3) para ser
// reaproveitado também em telas fora de Processos, como Provas e Resultados.
export function MenuAcoesProcesso({
  acoes = [],
  label = '',
  icon = 'more_horiz',
  ariaLabel = 'Mais ações',
  className = '',
  triggerClassName = '',
}) {
  const itensBase = acoes.filter(Boolean);
  const itens = itensBase.filter(
    (item, indice) =>
      !item.separator ||
      (
        itensBase.slice(0, indice).some((anterior) => !anterior.separator) &&
        itensBase.slice(indice + 1).some((proximo) => !proximo.separator)
      ),
  );
  const [aberto, setAberto] = useState(false);
  const [menuId] = useState(() => `process-actions-${Math.random().toString(36).slice(2)}`);
  const [posicao, setPosicao] = useState(null);

  useEffect(() => {
    const fecharOutrosMenus = (event) => {
      if (event.detail !== menuId) setAberto(false);
    };
    window.addEventListener('process-actions-open', fecharOutrosMenus);
    return () => window.removeEventListener('process-actions-open', fecharOutrosMenus);
  }, [menuId]);

  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = () => setAberto(false);
    const fecharComEsc = (event) => {
      if (event.key === 'Escape') fechar();
    };
    document.addEventListener('click', fechar);
    document.addEventListener('keydown', fecharComEsc);
    window.addEventListener('resize', fechar);
    window.addEventListener('scroll', fechar, true);
    return () => {
      document.removeEventListener('click', fechar);
      document.removeEventListener('keydown', fecharComEsc);
      window.removeEventListener('resize', fechar);
      window.removeEventListener('scroll', fechar, true);
    };
  }, [aberto]);

  if (!itens.length) return null;

  const alternarMenu = (event) => {
    event.stopPropagation();
    if (!aberto) {
      window.dispatchEvent(new CustomEvent('process-actions-open', { detail: menuId }));
      const rect = event.currentTarget.getBoundingClientRect();
      const largura = label ? 232 : 196;
      const altura = Math.min(286, 14 + itens.length * 38);
      const topoAbaixo = rect.bottom + 6;
      const topo =
        topoAbaixo + altura > window.innerHeight - 8
          ? Math.max(8, rect.top - altura - 6)
          : topoAbaixo;
      setPosicao({
        top: `${topo}px`,
        left: `${Math.max(8, Math.min(window.innerWidth - largura - 8, rect.right - largura))}px`,
        width: `${largura}px`,
      });
    }
    setAberto(!aberto);
  };

  const executarAcao = (event, acao) => {
    event.stopPropagation();
    if (acao.disabled) return;
    setAberto(false);
    acao.onClick?.();
  };

  return html`
    <div class=${`process-row-action-menu ${className}`.trim()}>
      <button
        type="button"
        class=${triggerClassName || 'process-row-action-trigger'}
        title=${ariaLabel}
        aria-label=${ariaLabel}
        aria-haspopup="menu"
        aria-expanded=${aberto}
        onClick=${alternarMenu}
      >
        ${label ? html`<span>${label}</span>` : null}
        <span class="material-symbols-outlined">${IconeSvg(icon)}</span>
      </button>
      ${aberto
      ? html`
            <div
              class="process-row-actions-dropdown"
              role="menu"
              style=${posicao || {}}
              onClick=${(event) => event.stopPropagation()}
            >
              ${itens.map(
        (acao, indice) => acao.separator
          ? html`<div key=${acao.key || `separator-${indice}`} class="process-row-actions-separator" role="separator"></div>`
          : html`
                  <button
                    key=${acao.label}
                    type="button"
                    role="menuitem"
                    class=${`process-row-actions-item ${acao.danger ? 'is-danger' : ''}`.trim()}
                    disabled=${acao.disabled}
                    title=${acao.title || acao.label}
                    onClick=${(event) => executarAcao(event, acao)}
                  >
                    ${acao.icon
              ? html`<span class="material-symbols-outlined">${IconeSvg(acao.icon)}</span>`
              : null}
                    <span>${acao.label}</span>
                  </button>
                `,
      )}
            </div>
          `
      : null}
    </div>
  `;
}
