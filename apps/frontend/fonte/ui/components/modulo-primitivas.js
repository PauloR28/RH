import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../icone.js';

// Cabeçalho e abas do módulo Turnos e Plantões. Estilos: bloco `.mo-*` em estilos/console.css (só tokens do tema).

const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

// Abas do módulo: seletor segmentado. `itens`: [{ id, rotulo, icone, selo }]. `selo` (número > 0) aparece como contador de atenção e entra no nome acessível.
export function ModuleTabs({ itens, ativa, aoMudar, rotulo = 'Seções de Turnos e Plantões' }) {
  const refs = useRef({});
  const aoTeclar = (ev, i) => {
    const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    const alvo = ev.key === 'Home' ? 0 : ev.key === 'End' ? itens.length - 1 : passo ? (i + passo + itens.length) % itens.length : -1;
    if (alvo < 0) return;
    ev.preventDefault();
    refs.current[itens[alvo].id]?.focus();
  };
  return html`<div class="mo-abas" role="tablist" aria-label=${rotulo}>
    ${itens.map((item, i) => html`<button key=${item.id} type="button" role="tab" class="mo-aba" aria-selected=${ativa === item.id} tabIndex=${ativa === item.id ? 0 : -1}
      aria-label=${item.selo > 0 ? `${item.rotulo}, ${item.selo} ${item.selo === 1 ? 'pendência' : 'pendências'}` : undefined}
      ref=${(el) => { refs.current[item.id] = el; }} onClick=${() => aoMudar(item.id)} onKeyDown=${(ev) => aoTeclar(ev, i)}>
      ${item.icone ? html`<${Icone} nome=${item.icone} />` : null}<span>${item.rotulo}</span>
      ${item.selo > 0 ? html`<span class="mo-selo" aria-hidden="true">${item.selo}</span>` : null}
    </button>`)}
  </div>`;
}

// Uma linha: título e subtítulo à esquerda, abas à direita. O subtítulo aparece completo, sem reticências.
export function ModuleHeader({ titulo, subtitulo, abas = null }) {
  return html`<header class="mo-cab" data-tour-id="page-intro">
    <div class="mo-cab-texto">
      <h1 class="mo-titulo">${titulo}</h1>
      ${subtitulo ? html`<p class="mo-sub">${subtitulo}</p>` : null}
    </div>
    ${abas ? html`<div class="mo-cab-abas">${abas}</div>` : null}
  </header>`;
}

// Campo de contexto (46 px): legenda de 11 px em cima e valor embaixo. Com `opcoes` vira um seletor; sem, só mostra o valor.
// `opcoes`: [[valor, rotulo]].
export function ContextField({ rotulo, valor, opcoes = null, aoMudar, id }) {
  const atual = opcoes ? (opcoes.find(([v]) => String(v) === String(valor)) || [])[1] : valor;
  return html`<div class=${`mo-campo ${opcoes && opcoes.length > 1 ? 'is-seletor' : ''}`}>
    <span class="mo-campo-leg" id=${id ? `${id}-leg` : undefined}>${rotulo}</span>
    <span class="mo-campo-valor" title=${atual}><span class="mo-trunca">${atual}</span>${opcoes && opcoes.length > 1 ? html`<${Icone} nome="expand_more" />` : null}</span>
    ${opcoes && opcoes.length > 1 ? html`<select class="mo-campo-sel" aria-label=${rotulo} value=${valor} onChange=${(e) => aoMudar?.(e.target.value)}>${opcoes.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select>` : null}
  </div>`;
}

// Navegador de período (46 px): seta, legenda + valor ao centro, seta.
export function Stepper({ rotulo, valor, aoAnterior, aoProximo, rotuloAnterior, rotuloProximo, desabilitadoAnterior = false, desabilitadoProximo = false }) {
  return html`<div class="mo-stepper" role="group" aria-label=${rotulo}>
    <button type="button" class="mo-stepper-seta" aria-label=${rotuloAnterior} title=${rotuloAnterior} disabled=${desabilitadoAnterior} onClick=${aoAnterior}><${Icone} nome="chevron_left" /></button>
    <span class="mo-stepper-centro"><span class="mo-campo-leg">${rotulo}</span><span class="mo-campo-valor" aria-live="polite"><span class="mo-trunca">${valor}</span></span></span>
    <button type="button" class="mo-stepper-seta" aria-label=${rotuloProximo} title=${rotuloProximo} disabled=${desabilitadoProximo} onClick=${aoProximo}><${Icone} nome="chevron_right" /></button>
  </div>`;
}

// Chip de turno: a cor vem do cadastro (--ea-cor / --ea-fg); o código sempre aparece, então nunca depende só da cor.
export function ChipTurno({ codigo, cor, fg, nome, tamanho = 'sm' }) {
  return html`<span class=${`mo-chip mo-chip--${tamanho}`} style=${cor ? { '--ea-cor': cor, '--ea-fg': fg } : undefined} title=${nome}>${codigo}</span>`;
}

// Painel flutuante: abre sobre o conteúdo, tem botão de fechar, fecha com Esc e devolve o foco a quem estava focado antes.
export function PainelFlutuante({ titulo, aoFechar, largura = 900, posicao = 'baixo', children, id }) {
  const caixa = useRef(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    const anterior = document.activeElement;
    caixa.current?.querySelector('[data-foco-inicial]')?.focus();
    const aoTeclar = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar.current(); } };
    document.addEventListener('keydown', aoTeclar);
    return () => { document.removeEventListener('keydown', aoTeclar); anterior?.focus?.(); };
  }, []);
  return html`<section class=${`mo-painel mo-painel--${posicao}`} id=${id} role="dialog" aria-label=${titulo} style=${{ '--mo-painel-w': `${largura}px` }} ref=${caixa}>
    <header class="mo-painel-cab"><h2>${titulo}</h2>
      <button type="button" class="mo-painel-x" data-foco-inicial aria-label="Fechar" title="Fechar" onClick=${aoFechar}><${Icone} nome="close" /></button></header>
    <div class="mo-painel-corpo">${children}</div>
  </section>`;
}

// Cartão dos Cadastros: cabeçalho com seta (recolher/abrir), título, contador e ações à direita. Recolhido, fica só o cabeçalho
// e o irmão ao lado ocupa a altura. O estado de recolhido não é lembrado. `recolhivel={false}` tira a seta (card único).
export function CardRecolhivel({ titulo, contador = null, descricao = null, acoes = null, aberta = true, recolhivel = true, className = '', children }) {
  const [aberto, setAberto] = useState(aberta);
  const visivel = aberto || !recolhivel;
  return html`<section class=${`mo-cartao ${visivel ? '' : 'is-recolhido'} ${className}`} aria-label=${titulo}>
    <header class="mo-cartao-cab">
      ${recolhivel ? html`<button type="button" class="mo-cartao-seta" aria-expanded=${aberto} aria-label=${`${aberto ? 'Recolher' : 'Abrir'} ${titulo}`} title=${`${aberto ? 'Recolher' : 'Abrir'} ${titulo}`} onClick=${() => setAberto(!aberto)}>
        <span class=${`material-symbols-outlined mo-seta ${aberto ? 'is-aberta' : ''}`} aria-hidden="true">${IconeSvg('expand_more')}</span></button>` : null}
      <h2 class="mo-cartao-titulo">${titulo}</h2>
      ${contador !== null ? html`<span class="mo-cartao-n" aria-label=${`${contador} no total`}>${contador}</span>` : null}
      ${visivel && acoes ? html`<div class="mo-cartao-acoes">${acoes}</div>` : null}
    </header>
    ${visivel ? html`<div class="mo-cartao-corpo">${descricao ? html`<p class="mo-cad-desc">${descricao}</p>` : null}${children}</div>` : null}
  </section>`;
}
