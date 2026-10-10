import { html, useContext, useEffect, useRef } from '../../infraestrutura-react.js';
import { AcoesPaginaContext } from './layout.js?v=20261005-redesign16';
import { IconeSvg } from '../icone.js';

// Primitivas de layout (Etapa 2 do redesign Tecnologia/WFM). Prefixo `lp-`, estilos em estilos/layout-primitivas.css.
// Escala de espaçamento 4/8/12/16/24/32, controles de 36px, bordas de 1px, sem sombra. As telas montam tudo com estas peças.

const cx = (...partes) => partes.filter(Boolean).join(' ');
const Icone = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

export function PageShell({ children, className = '' }) {
  return html`<div class=${cx('lp-shell', className)}>${children}</div>`;
}

// Título à esquerda, ações à direita (uma linha; abaixo de md as ações descem). A ação principal publicada por PainelRh
// (`acaoPrimaria`) entra junto, como no PageIntro. A pesquisa NÃO mora aqui: fica na Toolbar, colada ao conteúdo.
export function PageHeader({ titulo, subtitulo, acoes = null }) {
  const ctx = useContext(AcoesPaginaContext);
  const primaria = ctx?.acaoPrimaria;
  const botoes = [
    primaria ? html`<button type="button" key="primaria" class="btn btn-primary" disabled=${primaria.disabled} onClick=${primaria.onClick}>
      ${primaria.icon ? html`<${Icone} nome=${primaria.icon} />` : null}${primaria.label}</button>` : null,
    ctx?.acoesTopo || null,
    acoes,
  ].filter(Boolean);
  return html`
    <header class="lp-header" data-tour-id="page-intro">
      <div class="lp-header-texto">
        <h2 class="lp-titulo">${titulo}</h2>
        ${subtitulo ? html`<p class="lp-subtitulo">${subtitulo}</p>` : null}
      </div>
      ${botoes.length ? html`<div class="lp-header-acoes">${botoes}</div>` : null}
    </header>`;
}

export function Section({ titulo, descricao, acoes = null, children, solta = false, className = '' }) {
  return html`
    <section class=${cx('lp-section', solta && 'lp-section--solta', className)}>
      ${titulo || acoes ? html`
        <div class="lp-section-cab">
          <div class="lp-section-texto">${titulo ? html`<h3>${titulo}</h3>` : null}${descricao ? html`<p>${descricao}</p>` : null}</div>
          ${acoes ? html`<div class="lp-section-acoes">${acoes}</div>` : null}
        </div>` : null}
      <div class="lp-section-corpo">${children}</div>
    </section>`;
}

// Barra de ferramentas: pesquisa + filtros + contadores na mesma linha, colada à tabela (no máximo 16px acima).
export function Toolbar({ busca = '', aoBuscar, placeholder = 'Buscar', filtros = null, fim = null }) {
  return html`
    <div class="lp-toolbar" role="search">
      ${aoBuscar ? html`
        <label class="lp-busca" data-tour-id="topbar-search">
          <${Icone} nome="search" />
          <input type="search" value=${busca} placeholder=${placeholder} aria-label=${placeholder} onInput=${(e) => aoBuscar(e.target.value)} />
        </label>` : null}
      ${filtros}
      ${fim ? html`<div class="lp-toolbar-fim">${fim}</div>` : null}
    </div>`;
}

export function Campo({ rotulo, ajuda, cheio = false, children }) {
  return html`
    <label class=${cx('lp-campo', cheio && 'lp-campo--cheio')}>
      <span class="lp-campo-rotulo">${rotulo}</span>
      ${children}
      ${ajuda ? html`<small class="lp-campo-ajuda">${ajuda}</small>` : null}
    </label>`;
}

// 1 coluna < lg, 2 em lg, 3 a partir de xl (colunas=3); minmax(0,1fr) impede que o texto empurre o grid.
export function FormGrid({ children, colunas = 3 }) {
  return html`<div class=${cx('lp-formgrid', `lp-formgrid--${colunas}`)}>${children}</div>`;
}

// Subnav (220px) + conteúdo a partir de lg; abaixo disso, um select no topo.
export function SettingsLayout({ itens, ativo, aoMudar, children }) {
  return html`
    <div class="lp-settings">
      <nav class="lp-subnav" aria-label="Seções">
        <select class="lp-subnav-select" value=${ativo} aria-label="Seção" onChange=${(e) => aoMudar(e.target.value)}>
          ${itens.map((i) => html`<option key=${i.chave} value=${i.chave}>${i.rotulo}</option>`)}
        </select>
        <ul>
          ${itens.map((i) => html`
            <li key=${i.chave}>
              <button type="button" class=${cx('lp-subnav-item', i.chave === ativo && 'is-on')} aria-current=${i.chave === ativo ? 'page' : null} onClick=${() => aoMudar(i.chave)}>
                ${i.icone ? html`<${Icone} nome=${i.icone} />` : null}<span class="lp-trunca" title=${i.rotulo}>${i.rotulo}</span>
              </button>
            </li>`)}
        </ul>
      </nav>
      <div class="lp-settings-conteudo">${children}</div>
    </div>`;
}

// Lista + detalhe lado a lado a partir de xl (1280); abaixo, o detalhe vira Sheet sobre a lista (Esc fecha).
export function SplitView({ lista, detalhe, aberto, aoFechar, tituloDetalhe = 'Detalhe' }) {
  const painel = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const esc = (e) => { if (e.key === 'Escape') aoFechar?.(); };
    document.addEventListener('keydown', esc);
    painel.current?.focus();
    return () => document.removeEventListener('keydown', esc);
  }, [aberto, aoFechar]);
  return html`
    <div class=${cx('lp-split', aberto && 'tem-detalhe')}>
      <div class="lp-split-lista">${lista}</div>
      ${aberto ? html`
        <div class="lp-split-fundo" onClick=${aoFechar}></div>
        <aside class="lp-split-detalhe" role="dialog" aria-label=${tituloDetalhe} tabIndex="-1" ref=${painel}>
          <header class="lp-split-cab">
            <strong class="lp-trunca">${tituloDetalhe}</strong>
            <button type="button" class="btn btn-outline-secondary lp-icone" aria-label="Fechar detalhe" onClick=${aoFechar}><${Icone} nome="close" /></button>
          </header>
          <div class="lp-split-corpo">${detalhe}</div>
        </aside>` : null}
    </div>`;
}

// Estados dentro do mesmo layout: skeleton no formato da tabela, vazio (frase + ação) e erro (com tentar de novo).
function EstadoTabela({ carregando, erro, vazio, aoTentar, colunas }) {
  if (carregando) {
    return html`<tbody aria-busy="true">${[0, 1, 2, 3, 4].map((i) => html`
      <tr key=${i} class="lp-skel">${colunas.map((c) => html`<td key=${c.chave}><span class="lp-skel-barra"></span></td>`)}</tr>`)}</tbody>`;
  }
  const corpo = erro
    ? html`<p>${erro}</p>${aoTentar ? html`<button type="button" class="btn btn-outline-secondary" onClick=${aoTentar}>Tentar de novo</button>` : null}`
    : html`<p>${vazio?.texto || 'Nada por aqui.'}</p>${vazio?.acao ? html`<button type="button" class="btn btn-primary" onClick=${vazio.acao.onClick}>${vazio.acao.rotulo}</button>` : null}`;
  return html`<tbody><tr><td colspan=${colunas.length} class=${cx('lp-estado', erro && 'is-erro')}>${corpo}</td></tr></tbody>`;
}

// colunas: [{ chave, rotulo, render(linha), prioridade: 1|2|3, alinhar: 'direita', largura, fixa }].
// prioridade 1 sempre visível; 2 some abaixo de xl (1280); 3 some abaixo de 2xl (1536). Rolagem horizontal só dentro do container.
export function DataTable({ colunas, linhas, chaveLinha = (l) => l.id, aoClicarLinha, carregando = false, erro = '', vazio, aoTentar, rodape = null }) {
  const classeCol = (c) => cx(c.prioridade === 2 && 'lp-p2', c.prioridade === 3 && 'lp-p3', c.alinhar === 'direita' && 'lp-dir', c.fixa && 'lp-fixa');
  const semLinhas = carregando || erro || !linhas?.length;
  return html`
    <div class="lp-tabela-card">
      <div class="lp-tabela-wrap">
        <table class="lp-tabela">
          <thead><tr>${colunas.map((c) => html`<th key=${c.chave} class=${classeCol(c)} style=${c.largura ? { width: c.largura } : null}>${c.rotulo}</th>`)}</tr></thead>
          ${semLinhas
            ? html`<${EstadoTabela} carregando=${carregando} erro=${erro} vazio=${vazio} aoTentar=${aoTentar} colunas=${colunas} />`
            : html`<tbody>${linhas.map((l) => html`
                <tr key=${chaveLinha(l)} class=${aoClicarLinha ? 'lp-clicavel' : ''} tabIndex=${aoClicarLinha ? 0 : null}
                  onClick=${aoClicarLinha ? () => aoClicarLinha(l) : null}
                  onKeyDown=${aoClicarLinha ? (e) => { if (e.key === 'Enter') aoClicarLinha(l); } : null}>
                  ${colunas.map((c) => html`<td key=${c.chave} class=${classeCol(c)}><div class="lp-trunca">${c.render ? c.render(l) : l[c.chave] ?? '—'}</div></td>`)}
                </tr>`)}</tbody>`}
        </table>
      </div>
      ${rodape ? html`<div class="lp-tabela-rodape">${rodape}</div>` : null}
    </div>`;
}
