import { html, React, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../icone.js';

const useId = React.useId;
// Componentes compartilhados do redesenho do Console (Operações, Histórico, Escala, Ambiente).
// Prefixo `cx-`, estilos em estilos/console.css. Sem cor fixa: tudo vem dos tokens do tema.

const cx = (...partes) => partes.filter(Boolean).join(' ');
export const IconeCx = ({ nome }) => html`<span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(nome)}</span>`;

// Casca da página: flex de altura cheia dentro da área abaixo do cabeçalho (a página não rola em >= 1024px).
export function PaginaConsole({ children, espaco14 = false, className = '' }) {
  return html`<div class=${cx('cx-pagina', espaco14 && 'cx-pagina--14', className)}>${children}</div>`;
}

// Sobretítulo opcional, título (h1), subtítulo, ações e busca à direita.
export function CabecalhoConsole({ sobretitulo, titulo, subtitulo, acoes = null, busca = null }) {
  return html`
    <header class="cx-cab" data-tour-id="page-intro">
      <div class="cx-cab-texto">
        ${sobretitulo ? html`<p class="cx-sobre">${sobretitulo}</p>` : null}
        <h1 class="cx-h1">${titulo}</h1>
        ${subtitulo ? html`<p class="cx-sub">${subtitulo}</p>` : null}
      </div>
      ${acoes ? html`<div class="cx-cab-acoes">${acoes}</div>` : null}
    </header>`;
}

export function CardResumo({ icone, rotulo, valor, complemento = null, tom = '', texto = false, acao = null }) {
  return html`
    <div class="cx-resumo">
      <span class=${cx('cx-resumo-icone', tom && `cx-resumo-icone--${tom}`)}><${IconeCx} nome=${icone} /></span>
      <div class="cx-resumo-texto">
        <div class="cx-resumo-rotulo cx-trunca">${rotulo}</div>
        <div class=${cx('cx-resumo-valor cx-trunca', texto && 'cx-resumo-valor--txt')} title=${typeof valor === 'string' ? valor : undefined}>${valor}${complemento ? html`<small>${complemento}</small>` : null}</div>
      </div>
      ${acao}
    </div>`;
}

export const ROTULO_PILULA = { ativo: 'Ativo', inativo: 'Inativo', rascunho: 'Rascunho', publicada: 'Publicada', presente: 'Presente', falta: 'Falta', troca: 'Troca' };
export function PilulaStatus({ variante = 'inativo', children }) {
  return html`<span class=${cx('cx-pilula', `cx-pilula--${variante}`)}>${children || ROTULO_PILULA[variante] || variante}</span>`;
}

// Abas com role=tablist/tab e navegação por setas. `itens`: [{ id, rotulo, icone, numero, erro }].
// O painel correspondente deve usar `idPainel(prefixo, id)` em role="tabpanel" e aria-labelledby={idAba(...)}.
export const idAba = (prefixo, id) => `${prefixo}-aba-${id}`;
export const idPainel = (prefixo, id) => `${prefixo}-painel-${id}`;
export function AbasConsole({ itens, ativa, aoMudar, variante = 'pilula', prefixo = 'cx', rotulo = 'Abas' }) {
  const refs = useRef({});
  const aoTeclar = (ev, indice) => {
    const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    const alvo = ev.key === 'Home' ? 0 : ev.key === 'End' ? itens.length - 1 : passo ? (indice + passo + itens.length) % itens.length : -1;
    if (alvo < 0) return;
    ev.preventDefault();
    aoMudar(itens[alvo].id);
    refs.current[itens[alvo].id]?.focus();
  };
  return html`
    <div class=${cx('cx-abas', `cx-abas--${variante}`)} role="tablist" aria-label=${rotulo}>
      ${itens.map((item, i) => html`
        <button key=${item.id} type="button" role="tab" id=${idAba(prefixo, item.id)} class="cx-aba"
          ref=${(el) => { refs.current[item.id] = el; }}
          aria-selected=${ativa === item.id} aria-controls=${idPainel(prefixo, item.id)} tabIndex=${ativa === item.id ? 0 : -1}
          onClick=${() => aoMudar(item.id)} onKeyDown=${(ev) => aoTeclar(ev, i)}>
          ${item.numero ? html`<span class="cx-aba-num" aria-hidden="true">${item.numero}</span>` : null}
          ${item.icone ? html`<${IconeCx} nome=${item.icone} />` : null}
          <span>${item.rotulo}</span>
          ${item.erro ? html`<span class="cx-aba-erro" role="img" aria-label="Há campos com erro"></span>` : null}
        </button>`)}
    </div>`;
}

// Grade de 6 colunas. Use <CampoConsole colunas=${3}>.
export function GradeForm({ children }) {
  return html`<div class="cx-form-grade">${children}</div>`;
}
export function CampoConsole({ rotulo, colunas = 6, dica, erro, children, idControle }) {
  const gerado = useId();
  const id = idControle || `cx-campo-${gerado}`;
  return html`
    <div class="cx-campo" style=${{ '--cx-cols': colunas }}>
      <label class="cx-campo-rotulo" for=${id}>${rotulo}</label>
      ${typeof children === 'function' ? children({ id, 'aria-invalid': erro ? 'true' : undefined, 'aria-describedby': erro ? `${id}-erro` : undefined }) : children}
      ${dica && !erro ? html`<span class="cx-campo-dica">${dica}</span>` : null}
      ${erro ? html`<span class="cx-campo-erro" id=${`${id}-erro`} role="alert">${erro}</span>` : null}
    </div>`;
}

// Card de dados: cabeçalho, corpo com rolagem interna e rodapé fixo.
export function CardDados({ sobretitulo, titulo, legenda, acoes = null, rodape = null, formulario = false, children, className = '', rotulo = '' }) {
  return html`
    <section class=${cx('cx-card', className)} aria-label=${!titulo && rotulo ? rotulo : undefined}>
      ${!titulo && rotulo ? html`<h2 class="cx-sr">${rotulo}</h2>` : null}
      ${titulo ? html`
        <div class=${cx('cx-card-cab', formulario && 'cx-card-cab--form')}>
          <div class="cx-card-titulo">
            ${sobretitulo ? html`<p class="cx-sobre">${sobretitulo}</p>` : null}
            <h2 class="cx-h2">${titulo}</h2>
            ${legenda ? html`<p class="cx-legenda">${legenda}</p>` : null}
          </div>
          ${acoes}
        </div>` : null}
      <div class="cx-card-corpo">${children}</div>
      ${rodape ? html`<div class=${cx('cx-card-rodape', formulario && 'cx-card-rodape--form')}>${rodape}</div>` : null}
    </section>`;
}

export function BotaoTracejado({ children, onClick, icone = 'add' }) {
  return html`<button type="button" class="cx-tracejado" onClick=${onClick}><${IconeCx} nome=${icone} />${children}</button>`;
}

export function AvisoConsole({ icone = 'info', suave = false, children }) {
  return html`<div class=${cx('cx-aviso', suave && 'cx-aviso--suave')}><${IconeCx} nome=${icone} /><span>${children}</span></div>`;
}

export function EsqueletoLinhas({ linhas = 8, altura = 50 }) {
  return html`<div aria-busy="true" aria-label="Carregando">${Array.from({ length: linhas }, (_, i) => html`<div key=${i} class="cx-esqueleto" style=${{ height: `${altura}px` }}></div>`)}</div>`;
}

export function EstadoConsole({ mensagem, rotuloAcao, aoAcao }) {
  return html`<div class="cx-estado" role="status"><span>${mensagem}</span>${rotuloAcao ? html`<button type="button" class="cx-btn cx-btn--sm" onClick=${aoAcao}>${rotuloAcao}</button>` : null}</div>`;
}

// Menu Exportar: escopo (filtro | selecionados) e formato. Esc fecha; setas navegam pelos formatos.
const FORMATOS = [
  { id: 'xlsx', etiqueta: 'XLSX', titulo: 'Excel (.xlsx)', legenda: 'Planilha com todas as colunas' },
  { id: 'csv', etiqueta: 'CSV', titulo: 'CSV', legenda: 'Para abrir em outros sistemas' },
  { id: 'pdf', etiqueta: 'PDF', titulo: 'PDF', legenda: 'Para imprimir ou anexar' },
];
export function MenuExportar({ totalFiltro, totalSelecionados, aoExportar, carregando = false }) {
  const [aberto, setAberto] = useState(false);
  const [escopo, setEscopo] = useState('filtro');
  const raiz = useRef(null);
  const gatilho = useRef(null);
  const nome = useId();
  useEffect(() => {
    if (!totalSelecionados && escopo === 'selecionados') setEscopo('filtro');
  }, [totalSelecionados, escopo]);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (ev) => { if (raiz.current && !raiz.current.contains(ev.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const aoTeclar = (ev) => {
    if (ev.key === 'Escape') { setAberto(false); gatilho.current?.focus(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const itens = [...raiz.current.querySelectorAll('.cx-menu-item')];
    const atual = itens.indexOf(document.activeElement);
    if (atual < 0 && document.activeElement?.type === 'radio') return;
    ev.preventDefault();
    itens[(atual + (ev.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length]?.focus();
  };
  const escolher = (formato) => { setAberto(false); aoExportar({ formato, escopo }); };
  return html`
    <div class="cx-menu-wrap" ref=${raiz} onKeyDown=${aoTeclar}>
      <button type="button" ref=${gatilho} class="cx-btn cx-btn--primario" aria-haspopup="menu" aria-expanded=${aberto} disabled=${carregando} onClick=${() => setAberto(!aberto)}>
        ${carregando ? html`<span class="cx-spinner" aria-hidden="true"></span>` : html`<${IconeCx} nome="download" />`}Exportar<${IconeCx} nome="expand_more" />
      </button>
      ${aberto ? html`
        <div class="cx-menu" role="menu" aria-label="Exportar">
          <p class="cx-menu-grupo">O que exportar</p>
          <label class="cx-menu-radio"><input type="radio" name=${nome} checked=${escopo === 'filtro'} onChange=${() => setEscopo('filtro')} />Tudo que o filtro mostra (${totalFiltro})</label>
          <label class=${cx('cx-menu-radio', !totalSelecionados && 'cx-menu-radio--off')} title=${totalSelecionados ? undefined : 'Marque linhas na tabela para exportar só o que precisa'}>
            <input type="radio" name=${nome} disabled=${!totalSelecionados} checked=${escopo === 'selecionados'} onChange=${() => setEscopo('selecionados')} />Somente os selecionados (${totalSelecionados})
          </label>
          <div class="cx-menu-sep"></div>
          <p class="cx-menu-grupo">Baixar como</p>
          ${FORMATOS.map((f) => html`
            <button key=${f.id} type="button" role="menuitem" class="cx-menu-item" onClick=${() => escolher(f.id)}>
              <span class="cx-menu-fmt">${f.etiqueta}</span><span><strong>${f.titulo}</strong><small>${f.legenda}</small></span>
            </button>`)}
        </div>` : null}
    </div>`;
}

// Interruptor (role="switch"), equivalente ao Switch do shadcn.
export function InterruptorCx({ ativo, aoMudar, rotulo, desabilitado = false }) {
  return html`<button type="button" role="switch" class="cx-switch" aria-checked=${ativo} aria-label=${rotulo} title=${rotulo} disabled=${desabilitado} onClick=${() => aoMudar(!ativo)}><span class="cx-switch-bolinha"></span></button>`;
}

// Seletor de período: botão com o intervalo e um popover com duas datas e atalhos. Esc fecha; aplica na hora.
const doisDig = (n) => String(n).padStart(2, '0');
const isoData = (d) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`;
const dm = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
const dmy = (iso) => iso.split('-').reverse().join('/');
export function SeletorPeriodoCx({ ini, fim, aoMudar }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (ev) => { if (raiz.current && !raiz.current.contains(ev.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const rotulo = ini && fim ? (ini.slice(0, 4) === fim.slice(0, 4) ? `${dm(ini)} – ${dmy(fim)}` : `${dmy(ini)} – ${dmy(fim)}`) : ini ? `a partir de ${dmy(ini)}` : fim ? `até ${dmy(fim)}` : 'Todo o período';
  const mudarIni = (v) => { if (v) aoMudar(v, fim && fim < v ? v : fim); };
  const mudarFim = (v) => { if (v) aoMudar(ini && ini > v ? v : ini, v); };
  const mesDe = (deslocamento) => {
    const hoje = new Date();
    return [isoData(new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento, 1)), isoData(new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento + 1, 0))];
  };
  return html`
    <div class="cx-menu-wrap" ref=${raiz} onKeyDown=${(ev) => { if (ev.key === 'Escape') setAberto(false); }}>
      <button type="button" class="cx-select cx-periodo-btn" aria-haspopup="dialog" aria-expanded=${aberto} aria-label=${`Período: ${rotulo}`} onClick=${() => setAberto(!aberto)}>
        <${IconeCx} nome="calendar_month" /><span>${rotulo}</span>
      </button>
      ${aberto ? html`
        <div class="cx-menu cx-menu--periodo" role="dialog" aria-label="Período">
          <label class="cx-campo-rotulo" for="cx-periodo-ini">De</label>
          <input id="cx-periodo-ini" type="date" class="cx-select" value=${ini || ''} onChange=${(e) => mudarIni(e.target.value)} />
          <label class="cx-campo-rotulo" for="cx-periodo-fim">Até</label>
          <input id="cx-periodo-fim" type="date" class="cx-select" value=${fim || ''} onChange=${(e) => mudarFim(e.target.value)} />
          <div class="cx-menu-sep"></div>
          <div class="cx-periodo-atalhos">
            <button type="button" class="cx-btn cx-btn--sm" onClick=${() => { aoMudar(...mesDe(0)); setAberto(false); }}>Este mês</button>
            <button type="button" class="cx-btn cx-btn--sm" onClick=${() => { aoMudar(...mesDe(-1)); setAberto(false); }}>Mês anterior</button>
          </div>
        </div>` : null}
    </div>`;
}

// ---- Administração do Conecta: cartão de resumo que é link inteiro e linhas de atalho agrupadas ----
// Links reais (<a href>): clique normal usa o controlador (mesmas regras de acesso de hoje); abrir em nova aba também funciona.
function abrirTela(ev, aoAbrir) {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  aoAbrir();
}

export function CardResumoLink({ icone, tom = 'azul', rotulo, valor, nota, notaTom = '', acao, href, aoAbrir, carregando = false, falhou = false }) {
  const nomeAcessivel = `${rotulo}: ${falhou ? 'não foi possível carregar' : carregando ? 'carregando' : valor}. ${acao}`;
  return html`
    <a class=${cx('cx-resumo-link', `cx-resumo-link--${tom}`)} href=${href} aria-label=${nomeAcessivel} onClick=${(ev) => abrirTela(ev, aoAbrir)}>
      <span class="cx-resumo-link-icone" aria-hidden="true"><${IconeCx} nome=${icone} /></span>
      <span class="cx-resumo-link-texto">
        <span class="cx-resumo-link-rotulo">${rotulo}</span>
        ${carregando ? html`<span class="cx-esqueleto-bloco" aria-hidden="true"></span>` : html`
          <span class="cx-resumo-link-valor">${falhou ? '—' : valor}</span>
          <span class=${cx('cx-resumo-link-nota', notaTom && `cx-resumo-link-nota--${notaTom}`)}>${falhou ? 'não foi possível carregar' : nota}</span>`}
      </span>
      <span class="cx-resumo-link-acao" aria-hidden="true">${acao}<${IconeCx} nome="arrow_forward" /></span>
    </a>`;
}

export function AtalhoLinha({ icone, nome, descricao, href, aoAbrir }) {
  return html`
    <li class="cx-atalho-item">
      <a class="cx-atalho" href=${href} onClick=${(ev) => abrirTela(ev, aoAbrir)}>
        <span class="cx-atalho-icone" aria-hidden="true"><${IconeCx} nome=${icone} /></span>
        <span class="cx-atalho-texto"><strong>${nome}</strong><small>${descricao}</small></span>
        <span class="cx-atalho-seta" aria-hidden="true"><${IconeCx} nome="chevron_right" /></span>
      </a>
    </li>`;
}

export function GrupoAtalhos({ rotulo, children }) {
  const id = useId();
  return html`
    <section class="cx-card cx-grupo" aria-labelledby=${id}>
      <h2 class="cx-grupo-rotulo" id=${id}>${rotulo}</h2>
      <ul class="cx-atalhos">${children}</ul>
    </section>`;
}
