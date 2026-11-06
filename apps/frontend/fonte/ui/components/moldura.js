import { html, useEffect, useRef, useState } from '../../infraestrutura-react.js';
import { IconeSvg } from '../icone.js';
import { montarCaminhoDaTela } from '../../rotas.js';

// Moldura do redesign (Fase 15, DEC-063): topo escuro de 56 px com o logo e as
// seções, engrenagem de Configurações à direita, e sub-barra clara de 40 px com
// as telas da seção atual. Traço ouro no item atual. Faixas de tela (DEC-075/076):
// Compacto (< 1180 px) leva para "Mais" as seções que não cabem; Celular (< 600 px)
// troca as seções pelo botão "Menu" com gaveta.
//
// Este componente só DESENHA. Quem decide quais seções/abas aparecem (permissões,
// sessões, módulos, áreas inativas) continua sendo BarraLateral, em layout.js.

function Ic({ nome }) {
  return html`<span class="c-ic" aria-hidden="true">${IconeSvg(nome)}</span>`;
}

function hrefDaTela(tela) {
  try {
    return montarCaminhoDaTela(tela) || '#';
  } catch {
    return '#';
  }
}

// Clique normal navega pelo controlador (respeita a checagem de acesso da tela);
// Ctrl/Cmd/Shift/botão do meio deixam o navegador abrir o link numa aba nova.
function aoClicarLink(evento, acao) {
  if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
  evento.preventDefault();
  acao();
}

export function MolduraConecta({
  secoes = [],
  configuracoes = null,
  secaoAtual = null,
  logoUrl = '',
  irPara,
  irParaInicio,
  sair,
  seletorModulo = null,
  busca = null,
  usuario = null,
}) {
  const [qtdMais, setQtdMais] = useState(0);
  const [largura, setLargura] = useState(0);
  const [maisAberto, setMaisAberto] = useState(false);
  const [logoComErro, setLogoComErro] = useState(false);
  const topoRef = useRef(null);
  const navRef = useRef(null);
  const maisRef = useRef(null);
  const gavetaRef = useRef(null);
  const menuBotaoRef = useRef(null);
  const subbarraRef = useRef(null);

  // Seções que podem ir para o "Mais": nunca a atual (DEC-076), sempre do fim para o começo.
  const moviveis = secoes.filter((secao) => !secao.ativo);
  const qtd = Math.min(qtdMais, moviveis.length);
  const noMais = new Set(moviveis.slice(moviveis.length - qtd).map((secao) => secao.chave));
  const visiveis = secoes.filter((secao) => !noMais.has(secao.chave));
  const doMais = secoes.filter((secao) => noMais.has(secao.chave));
  const chavesSecoes = secoes.map((secao) => `${secao.chave}:${secao.ativo ? 1 : 0}`).join('|');

  useEffect(() => {
    setLogoComErro(false);
  }, [logoUrl]);

  // Largura do topo mudou (janela, zoom) ou as seções mudaram: recomeça a medida.
  useEffect(() => {
    const topo = topoRef.current;
    if (!topo || typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver((entradas) => {
      const nova = Math.round(entradas[0]?.contentRect?.width || 0);
      setLargura((atual) => (atual === nova ? atual : nova));
    });
    observador.observe(topo);
    return () => observador.disconnect();
  }, []);
  useEffect(() => {
    setQtdMais(0);
  }, [largura, chavesSecoes]);
  // Enquanto o nav transborda, manda mais uma seção para o "Mais".
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || getComputedStyle(nav).display === 'none') return;
    if (nav.scrollWidth > nav.clientWidth + 1 && qtdMais < moviveis.length) {
      setQtdMais((atual) => atual + 1);
    }
  });

  useEffect(() => {
    setMaisAberto(false);
  }, [secaoAtual?.chave, secaoAtual?.telaAtual]);
  useEffect(() => {
    if (!maisAberto) return undefined;
    const fecharFora = (evento) => {
      if (maisRef.current && !maisRef.current.contains(evento.target)) setMaisAberto(false);
    };
    const fecharEsc = (evento) => {
      if (evento.key === 'Escape') {
        setMaisAberto(false);
        maisRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharEsc);
    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharEsc);
    };
  }, [maisAberto]);

  // Sub-abas: a aba atual sempre à vista quando a faixa rola; marca as bordas com conteúdo escondido.
  useEffect(() => {
    const sb = subbarraRef.current;
    if (!sb) return undefined;
    const atual = sb.querySelector('[aria-current="page"].c-aba');
    if (atual && sb.scrollWidth > sb.clientWidth) sb.scrollLeft = atual.offsetLeft - 16;
    const marca = () => {
      sb.toggleAttribute('data-mais-dir', sb.scrollLeft + sb.clientWidth < sb.scrollWidth - 1);
      sb.toggleAttribute('data-mais-esq', sb.scrollLeft > 1);
    };
    sb.addEventListener('scroll', marca, { passive: true });
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(marca);
    observador?.observe(sb);
    marca();
    return () => {
      sb.removeEventListener('scroll', marca);
      observador?.disconnect();
    };
  }, [secaoAtual?.chave, secaoAtual?.telaAtual]);

  const abrirGaveta = () => {
    const gaveta = gavetaRef.current;
    if (gaveta && !gaveta.open && typeof gaveta.showModal === 'function') {
      gaveta.showModal();
      menuBotaoRef.current?.setAttribute('aria-expanded', 'true');
    }
  };
  const fecharGaveta = () => {
    if (gavetaRef.current?.open) gavetaRef.current.close();
  };
  useEffect(() => {
    const gaveta = gavetaRef.current;
    if (!gaveta) return undefined;
    const aoFechar = () => {
      menuBotaoRef.current?.setAttribute('aria-expanded', 'false');
      menuBotaoRef.current?.focus();
    };
    const cliqueFora = (evento) => {
      if (evento.target === gaveta) gaveta.close();
    };
    gaveta.addEventListener('close', aoFechar);
    gaveta.addEventListener('click', cliqueFora);
    return () => {
      gaveta.removeEventListener('close', aoFechar);
      gaveta.removeEventListener('click', cliqueFora);
    };
  }, []);
  // Mudou de tela: fecha a gaveta.
  useEffect(() => {
    fecharGaveta();
  }, [secaoAtual?.chave, secaoAtual?.telaAtual]);

  const linkSecao = (secao, extra = {}) => html`
    <a
      key=${secao.chave}
      href=${hrefDaTela(secao.tela)}
      class=${extra.className || null}
      role=${extra.role || null}
      aria-current=${secao.ativo ? 'page' : null}
      onClick=${(evento) => aoClicarLink(evento, () => {
        setMaisAberto(false);
        irPara(secao.tela);
      })}
    >${extra.comIcone ? html`<${Ic} nome=${secao.icone || 'squares-four'} />` : null}${secao.label}</a>
  `;

  const logo = logoComErro
    ? html`<strong class="c-moldura-logo-texto">Conecta</strong>`
    : html`<img src=${logoUrl || '/estilos/marca/conecta_branco.svg'} alt="Conecta" onError=${() => setLogoComErro(true)} />`;

  return html`
    <header class="c-topo c-moldura-topo" data-tour-id="layout-sidebar" ref=${topoRef}>
      <button
        type="button"
        class="c-topo-menu"
        aria-haspopup="dialog"
        aria-expanded="false"
        ref=${menuBotaoRef}
        onClick=${abrirGaveta}
      >
        <${Ic} nome="list" /><span>Menu</span>
      </button>
      <a
        class="c-topo-logo"
        href=${hrefDaTela('screen-menu')}
        aria-label="Conecta · Início"
        onClick=${(evento) => aoClicarLink(evento, irParaInicio)}
      >${logo}</a>

      <nav class="c-topo-nav" aria-label="Seções" ref=${navRef}>
        ${visiveis.map((secao) => linkSecao(secao))}
        <div class="c-topo-mais" data-tem=${doMais.length ? '' : null} ref=${maisRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded=${maisAberto ? 'true' : 'false'}
            onClick=${() => setMaisAberto((aberto) => !aberto)}
          >
            Mais<${Ic} nome="caret-down" />
          </button>
          <div class="c-menu" role="menu" hidden=${!maisAberto}>
            ${doMais.map((secao) => linkSecao(secao, { className: 'c-menu-item', role: 'menuitem' }))}
          </div>
        </div>
      </nav>

      <div class="c-topo-dir">
        ${seletorModulo}
        ${busca ? html`<div class="c-topo-busca-app" data-tour-id="topbar-search">${busca}</div>` : null}
        ${configuracoes
          ? html`
              <a
                class="c-topo-icone c-topo-config"
                href=${hrefDaTela(configuracoes.tela)}
                aria-label="Configurações"
                title="Configurações"
                aria-current=${configuracoes.ativo ? 'page' : null}
                onClick=${(evento) => aoClicarLink(evento, () => irPara(configuracoes.tela))}
              ><${Ic} nome="gear-six" /></a>
            `
          : null}
        ${usuario}
      </div>
    </header>

    ${secaoAtual
      ? html`
          <nav class="c-subbarra c-moldura-subbarra" aria-label=${`Telas de ${secaoAtual.label}`} ref=${subbarraRef}>
            <a
              class="c-subbarra-secao"
              href=${hrefDaTela(secaoAtual.tela)}
              onClick=${(evento) => aoClicarLink(evento, () => irPara(secaoAtual.tela))}
            >${secaoAtual.label}</a>
            ${(secaoAtual.abas || []).length > 1
              ? html`
                  <div class="c-abas">
                    ${secaoAtual.abas.map(
                      (aba) => html`
                        <a
                          key=${aba.tela}
                          class=${`c-aba ${aba.desativado ? 'c-aba--off' : ''}`.trim()}
                          href=${hrefDaTela(aba.tela)}
                          aria-current=${aba.ativo ? 'page' : null}
                          title=${aba.desativado ? `${aba.label} (em construção)` : null}
                          onClick=${(evento) => aoClicarLink(evento, () => irPara(aba.tela))}
                        >${aba.label}</a>
                      `,
                    )}
                  </div>
                `
              : null}
          </nav>
        `
      : null}

    <dialog class="c-gaveta-menu" aria-label="Menu" ref=${gavetaRef}>
      <div class="c-gaveta-cab">
        <span class="c-topo-logo">${logo}</span>
        <button type="button" class="c-topo-icone" aria-label="Fechar menu" title="Fechar" onClick=${fecharGaveta}>
          <${Ic} nome="x" />
        </button>
      </div>
      <nav aria-label="Seções">
        <ul class="c-gaveta-lista">
          ${secoes.map((secao) => html`<li key=${secao.chave}>${linkSecao(secao, { comIcone: true })}</li>`)}
        </ul>
      </nav>
      <ul class="c-gaveta-lista c-gaveta-rodape">
        ${configuracoes
          ? html`<li>${linkSecao({ ...configuracoes, chave: 'configuracoes', label: 'Configurações', icone: 'gear-six' }, { comIcone: true })}</li>`
          : null}
        <li>
          <a href="#" onClick=${(evento) => { evento.preventDefault(); fecharGaveta(); sair(); }}>
            <${Ic} nome="door-open" />Sair
          </a>
        </li>
      </ul>
    </dialog>
  `;
}
