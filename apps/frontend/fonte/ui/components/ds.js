import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../icone.js';

// Peças do design system do rebranding (Fase 15) em React. Só desenham com as classes
// `c-` de conecta-ds.css / conecta-telas.css; nenhuma regra de negócio mora aqui.

export function Ic({ nome, className = '' }) {
  return html`<span class=${`c-ic ${className}`.trim()} aria-hidden="true">${IconeSvg(nome)}</span>`;
}

// Selo de status: a cor nunca vem sozinha, sempre com texto (DEC-046/047).
export function Selo({ tom = 'neutro', icone = '', children, title }) {
  return html`<span class=${`c-selo c-selo--${tom}`} title=${title || null}>${icone ? html`<${Ic} nome=${icone} />` : null}${children}</span>`;
}

// Cabeçalho de página compacto: título + 1 linha curta à esquerda, ações à direita.
export function CabPagina({ titulo, descricao = '', acoes = null, caminho = null }) {
  return html`<div class="c-pagina-cab">
    <div class="c-titulo">
      ${caminho ? html`<div class="c-caminho">${caminho}</div>` : null}
      <h1>${titulo}</h1>
      ${descricao ? html`<p>${descricao}</p>` : null}
    </div>
    ${acoes ? html`<div class="c-grupo">${acoes}</div>` : null}
  </div>`;
}

export function Estado({ titulo, texto = '', rotuloAcao, aoAcao, icone = '' }) {
  return html`<div class="c-estado" role="status">
    ${icone ? html`<${Ic} nome=${icone} className="c-ic--20" />` : null}
    <p class="c-estado-titulo">${titulo}</p>
    ${texto ? html`<p>${texto}</p>` : null}
    ${rotuloAcao && aoAcao ? html`<button type="button" class="c-botao c-botao--secundario c-botao--compacto" onClick=${aoAcao}>${rotuloAcao}</button>` : null}
  </div>`;
}

export function Esqueleto({ linhas = 5 }) {
  return html`<div class="c-esqueleto-lista" aria-busy="true" aria-label="Carregando">
    ${Array.from({ length: linhas }, (_, i) => html`<span key=${i} class="c-esqueleto"></span>`)}
  </div>`;
}

export function Faixa({ tom = 'informacao', icone = 'info', children, acao = null }) {
  return html`<div class=${`c-faixa c-faixa--${tom}`} role="status">
    <${Ic} nome=${icone} />
    <div class="c-faixa-txt"><p>${children}</p>${acao}</div>
  </div>`;
}

// Fecha ao clicar fora e no Esc; devolve o foco ao botão que abriu.
function useFechaFora(aberto, fechar, raiz, botao) {
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (ev) => { if (raiz.current && !raiz.current.contains(ev.target)) fechar(); };
    const esc = (ev) => { if (ev.key === 'Escape') { fechar(); botao.current?.focus(); } };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
}

// Menu "⋯" de ações da linha. `acoes`: [{ label, icon, disabled, onClick, perigo }].
export function MenuAcoes({ rotulo = 'Mais ações', acoes = [], icone = 'dots-three', texto = '', classeBotao = 'c-botao c-botao--texto c-botao--icone c-botao--compacto' }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  const botao = useRef(null);
  useFechaFora(aberto, () => setAberto(false), raiz, botao);
  const visiveis = acoes.filter(Boolean);
  if (!visiveis.length) return null;
  return html`<div class="c-abre-menu" ref=${raiz}>
    <button type="button" class=${classeBotao} ref=${botao} aria-label=${texto ? null : rotulo} title=${rotulo} aria-haspopup="menu" aria-expanded=${aberto ? 'true' : 'false'} onClick=${() => setAberto((v) => !v)}>
      <${Ic} nome=${icone} />${texto || null}
    </button>
    ${aberto ? html`<div class="c-menu c-menu--solto" role="menu">
      ${visiveis.map((a) => html`<button key=${a.label} type="button" role="menuitem" class=${`c-menu-item ${a.perigo ? 'c-menu-item--perigo' : ''}`.trim()} disabled=${a.disabled || null} aria-disabled=${a.disabled ? 'true' : null}
        onClick=${() => { if (a.disabled) return; setAberto(false); a.onClick?.(); }}>${a.icon ? html`<${Ic} nome=${a.icon} />` : null}${a.label}</button>`)}
    </div>` : null}
  </div>`;
}

// Navegar mês/semana: ‹ rótulo ›, colados (amostra da Fase 12).
export function Navegar({ rotulo, aoAnterior, aoProximo, rotuloAnterior = 'Anterior', rotuloProximo = 'Próximo', grupo = 'Período' }) {
  return html`<div class="c-navegar" role="group" aria-label=${grupo}>
    <button type="button" class="c-botao c-botao--secundario c-botao--icone c-botao--compacto" aria-label=${rotuloAnterior} title=${rotuloAnterior} onClick=${aoAnterior}><${Ic} nome="caret-left" /></button>
    <span class="c-botao c-botao--secundario c-botao--compacto c-navegar-rotulo" aria-live="polite">${rotulo}</span>
    <button type="button" class="c-botao c-botao--secundario c-botao--icone c-botao--compacto" aria-label=${rotuloProximo} title=${rotuloProximo} onClick=${aoProximo}><${Ic} nome="caret-right" /></button>
  </div>`;
}

// Segmento: 2 a 4 opções coladas. `opcoes`: [[valor, rótulo, contagem?]].
export function Segmento({ opcoes, valor, aoMudar, rotulo, mini = false }) {
  return html`<div class=${`c-segmento ${mini ? 'c-segmento--mini' : ''}`.trim()} role="group" aria-label=${rotulo}>
    ${opcoes.map(([v, r, n]) => html`<button key=${v} type="button" class="c-botao" aria-pressed=${valor === v ? 'true' : 'false'} onClick=${() => aoMudar(v)}>${r}${n !== undefined && n !== null ? html` <span class="c-conta">${n}</span>` : null}</button>`)}
  </div>`;
}

export function Campo({ rotulo, ajuda = '', erro = '', children, cheio = false, opcional = false }) {
  return html`<label class=${`c-campo ${erro ? 'c-campo--erro' : ''} ${cheio ? 'c-cheio' : ''}`.trim()}>
    <span class="c-rotulo">${rotulo}${opcional ? html` <span class="c-opcional">(opcional)</span>` : null}</span>
    ${children}
    ${erro ? html`<span class="c-erro"><${Ic} nome="warning" />${erro}</span>` : ajuda ? html`<span class="c-ajuda">${ajuda}</span>` : null}
  </label>`;
}

// Janela (modal): Esc e clique fora fecham, foco vai para dentro ao abrir e volta ao sair.
export function Janela({ titulo, tamanho = '', onClose, children, rodape = null, rotulo }) {
  const caixa = useRef(null);
  useEffect(() => {
    const anterior = document.activeElement;
    const primeiro = caixa.current?.querySelector('[autofocus], input, select, textarea, button:not(.c-janela-fechar)');
    (primeiro || caixa.current)?.focus?.();
    const esc = (ev) => { if (ev.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); anterior?.focus?.(); };
  }, []);
  return html`<div class="c-fundo-janela c-ds" onMouseDown=${(ev) => { if (ev.target === ev.currentTarget) onClose?.(); }}>
    <div class=${`c-janela ${tamanho ? `c-janela--${tamanho}` : ''}`.trim()} role="dialog" aria-modal="true" aria-label=${rotulo || titulo} tabIndex="-1" ref=${caixa}>
      <div class="c-janela-cab">
        <h2>${titulo}</h2>
        <button type="button" class="c-botao c-botao--texto c-botao--icone c-janela-fechar" aria-label="Fechar" title="Fechar" onClick=${onClose}><${Ic} nome="x" /></button>
      </div>
      ${children}
      ${rodape ? html`<div class="c-janela-rodape">${rodape}</div>` : null}
    </div>
  </div>`;
}

// Janela de formulário: o erro aparece dentro da janela; Cancelar antes do principal.
export function JanelaForm({ titulo, onClose, onSubmit, erro = '', salvando = false, salvarRotulo = 'Salvar', tamanho = '', children }) {
  return html`<${Janela} titulo=${titulo} tamanho=${tamanho} onClose=${onClose}>
    <form class="c-janela-form" noValidate onSubmit=${onSubmit}>
      <div class="c-janela-corpo">
        ${children}
        ${erro ? html`<div class="c-faixa c-faixa--perigo" role="alert"><${Ic} nome="warning" /><div class="c-faixa-txt"><p>${erro}</p></div></div>` : null}
      </div>
      <div class="c-janela-rodape">
        <button type="button" class="c-botao c-botao--secundario" onClick=${onClose}>Cancelar</button>
        <button type="submit" class="c-botao c-botao--principal" aria-busy=${salvando ? 'true' : null} disabled=${salvando || null}>${salvando ? 'Salvando…' : salvarRotulo}</button>
      </div>
    </form>
  <//>`;
}
