import { html, useEffect, useRef, useState } from '../infraestrutura-react.js';
import { useChamadosNaoLidos } from '../shared/chamados-nao-lidos.js?v=20261006-areas-inativas';
import { IconeSvg } from '../ui/icone.js';
import { selecionarModulo } from './estado.js?v=20261006-areas-inativas';
import { MODULO_TECNOLOGIA, NOMES_MODULOS, montarMenuTecnologia, telaInicialDoModulo } from './registro.js?v=20261004-chamados2';

// Peças de interface dos módulos usadas pela navbar (ui/components/layout.js): seletor de módulo e menu da Tecnologia.

const DESCRICAO_MODULO = {
  rh: 'Currículos, Processos, Provas, Treinamentos',
  operacao: 'Monitoria, Turnos e Plantões',
  tecnologia: 'Administração do Conecta',
};

/** Seletor de módulo: só renderiza com 2 ou mais módulos visíveis; o nome do módulo fica ao lado do logo. */
export function SeletorModulo({ controlador, modulos }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (evento) => {
      if (raiz.current && !raiz.current.contains(evento.target)) setAberto(false);
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  if (!modulos?.carregado || (modulos.visiveis || []).length < 2) return null;

  const escolher = (chave) => {
    setAberto(false);
    if (chave === modulos.moduloAtual) return;
    selecionarModulo(chave);
    controlador.irParaTelaProtegida(telaInicialDoModulo(chave, controlador.podeAcessarTela));
  };

  return html`
    <div class="mod-seletor" ref=${raiz}>
      <button type="button" class="mod-seletor-btn" aria-haspopup="menu" aria-expanded=${aberto}
        title="Trocar de módulo" onClick=${() => setAberto((v) => !v)}>
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('grid_view')}</span>
        <span>${NOMES_MODULOS[modulos.moduloAtual] || 'Módulo'}</span>
        <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('expand_more')}</span>
      </button>
      ${aberto ? html`
        <div class="mod-seletor-menu" role="menu" aria-label="Módulos">
          <div class="mod-seletor-titulo">Seus módulos</div>
          ${modulos.visiveis.map((chave) => html`
            <button type="button" role="menuitem" key=${chave} class=${`mod-seletor-op ${chave === modulos.moduloAtual ? 'is-atual' : ''}`.trim()}
              aria-current=${chave === modulos.moduloAtual ? 'true' : null} onClick=${() => escolher(chave)}>
              <span><strong>${NOMES_MODULOS[chave] || chave}</strong><small>${DESCRICAO_MODULO[chave] || ''}</small></span>
            </button>`)}
        </div>` : null}
    </div>`;
}

/** Itens do menu superior do módulo Tecnologia (Início · Acessos ▾ · Sistema ▾ · Auditoria ▾ · Escalas e Plantões). */
export function NavTecnologia({ controlador, navAtiva, grupoAberto, alternarGrupo, fecharGrupo }) {
  const menu = montarMenuTecnologia(controlador.podeAcessarTela, controlador.possuiPermissao);
  const naoLidosChamados = useChamadosNaoLidos(controlador);
  const ativa = (tela) => navAtiva === tela || (tela.startsWith('screen-chamados') && navAtiva.startsWith('screen-chamados')) || (tela.startsWith('screen-wfm') && navAtiva.startsWith('screen-wfm') && navAtiva !== 'screen-wfm-auditoria');
  return html`${menu.map((entrada) => {
    if (entrada.tipo === 'item' || entrada.tipo === 'wfm' || entrada.tipo === 'suporte') {
      const marcado = ativa(entrada.tela) || (entrada.tipo === 'item' && ['screen-tecnologia'].includes(navAtiva));
      return html`
        <button type="button" key=${entrada.id} class=${`rh-modern-nav-btn ${marcado ? 'is-active' : ''}`.trim()} title=${entrada.label}
          aria-current=${marcado ? 'page' : null} onClick=${() => controlador.irParaTelaProtegida(entrada.tela)}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(entrada.icone)}</span>
          <span class="rh-modern-nav-label">${entrada.label}</span>
          ${entrada.tipo === 'suporte' && naoLidosChamados > 0 ? html`<span class="tec-dot" role="status" aria-label=${`${naoLidosChamados} notificação(ões) de chamados`}></span>` : null}
        </button>`;
    }
    const grupoAtivo = entrada.itens.some((i) => i.tela === navAtiva);
    return html`
      <div key=${entrada.id} class=${`rh-modern-nav-group ${grupoAberto === `tec-${entrada.id}` ? 'is-open' : ''} ${grupoAtivo ? 'has-active' : ''}`.trim()}>
        <button type="button" class=${`rh-modern-nav-btn rh-modern-nav-parent-btn ${grupoAtivo ? 'is-active' : ''}`.trim()} title=${entrada.label}
          aria-expanded=${grupoAberto === `tec-${entrada.id}`} aria-haspopup="true" onClick=${() => alternarGrupo(`tec-${entrada.id}`)}>
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(entrada.icone)}</span>
          <span class="rh-modern-nav-label">${entrada.label}</span>
          <span class="material-symbols-outlined rh-modern-nav-chevron" aria-hidden="true">${IconeSvg('expand_more')}</span>
        </button>
        ${grupoAberto === `tec-${entrada.id}` ? html`
          <div class="rh-modern-subnav" role="menu" aria-label=${`Submenu de ${entrada.label}`}>
            ${entrada.itens.map((subitem) => html`
              <button type="button" key=${subitem.tela} role="menuitem" class=${`rh-modern-subnav-btn ${subitem.tela === navAtiva ? 'is-active' : ''}`.trim()}
                aria-current=${subitem.tela === navAtiva ? 'page' : null} onClick=${() => { fecharGrupo(); controlador.irParaTelaProtegida(subitem.tela); }}>
                <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg(subitem.icone)}</span>
                <span>${subitem.label}</span>
              </button>`)}
          </div>` : null}
      </div>`;
  })}`;
}

export const ehModuloTecnologia = (modulos) => Boolean(modulos?.carregado) && modulos.moduloAtual === MODULO_TECNOLOGIA;
