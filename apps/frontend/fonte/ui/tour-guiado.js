import {
  html,
  useEffect,
  useMemo,
  useState,
} from '../infraestrutura-react.js';
import { IconeSvg } from './icone.js';
import { requisitar } from '../services/api/core.js';

const CARD_WIDTH = 320;
const CARD_HEIGHT_ESTIMATE = 220;
const VIEWPORT_PADDING = 16;

// Guia de ajuda: chave GLOBAL definida pelo Administrador (backend /sistema/orientacoes). Vale para todos os perfis;
// não existe mais preferência individual. Padrão ligado até a resposta do servidor (ou se ela falhar).
let orientacoesGlobais = true;
let orientacoesCarregadas = false;
const ouvintesOrientacoes = new Set();

const notificarOrientacoes = () => ouvintesOrientacoes.forEach((fn) => fn());

export function orientacoesAtivas() {
  return orientacoesGlobais;
}

export async function carregarOrientacoesGlobais(forcar = false) {
  if (orientacoesCarregadas && !forcar) return orientacoesGlobais;
  try {
    const resposta = await requisitar('/sistema/orientacoes', { method: 'GET' });
    orientacoesGlobais = resposta?.ativo !== false;
    orientacoesCarregadas = true;
    notificarOrientacoes();
  } catch (error) {
    // Sem resposta (ex.: sessão ainda não aberta): mantém o padrão ligado e tenta de novo na próxima montagem.
  }
  return orientacoesGlobais;
}

export async function definirOrientacoesAtivas(ativo) {
  const resposta = await requisitar('/sistema/orientacoes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ativo: Boolean(ativo) }),
  });
  orientacoesGlobais = resposta?.ativo !== false;
  orientacoesCarregadas = true;
  notificarOrientacoes();
  return orientacoesGlobais;
}

// Faz o componente reagir quando o valor global chega do servidor ou o Administrador o altera.
export function useOrientacoesGlobais() {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const ouvinte = () => setVersao((v) => v + 1);
    ouvintesOrientacoes.add(ouvinte);
    carregarOrientacoesGlobais();
    return () => ouvintesOrientacoes.delete(ouvinte);
  }, []);
  return orientacoesGlobais;
}

function montarChaveTour(screenId, userId) {
  const safeScreenId = String(screenId || '').trim() || 'screen';
  const safeUserId = String(userId || '').trim() || 'anonimo';
  return `rh_tour_visto:${safeScreenId}:${safeUserId}`;
}

function clamp(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo);
}

function calcularPosicao(step) {
  const larguraJanela = window.innerWidth || 1280;
  const alturaJanela = window.innerHeight || 720;
  const larguraCard = clamp(
    Math.min(CARD_WIDTH, larguraJanela - VIEWPORT_PADDING * 2),
    260,
    CARD_WIDTH,
  );
  const posicaoCentral = {
    card: {
      width: larguraCard,
      top: VIEWPORT_PADDING,
      left: clamp(
        (larguraJanela - larguraCard) / 2,
        VIEWPORT_PADDING,
        larguraJanela - larguraCard - VIEWPORT_PADDING,
      ),
    },
    target: null,
  };

  if (!step?.target) return posicaoCentral;

  const elemento = document.querySelector(step.target);
  if (!elemento) return posicaoCentral;

  const rect = elemento.getBoundingClientRect();
  if (!rect.width && !rect.height) return posicaoCentral;

  let top = rect.bottom + 14;
  if (top + CARD_HEIGHT_ESTIMATE > alturaJanela - VIEWPORT_PADDING) {
    top = Math.max(VIEWPORT_PADDING, rect.top - CARD_HEIGHT_ESTIMATE - 14);
  }

  const left = clamp(
    rect.left,
    VIEWPORT_PADDING,
    larguraJanela - larguraCard - VIEWPORT_PADDING,
  );

  return {
    card: {
      width: larguraCard,
      top,
      left,
    },
    target: {
      top: Math.max(VIEWPORT_PADDING / 2, rect.top - 6),
      left: Math.max(VIEWPORT_PADDING / 2, rect.left - 6),
      width: rect.width + 12,
      height: rect.height + 12,
    },
  };
}

export function BotaoAjudaTour({
  onClick,
  label = 'Ver orientações',
  compact = false,
}) {
  return html`
    <button
      type="button"
      class=${`btn btn-outline-secondary rh-tour-help-btn ${compact ? 'is-compact' : ''}`.trim()}
      onClick=${onClick}
    >
      <span class="material-symbols-outlined">${IconeSvg('help')}</span>
      <span>${label}</span>
    </button>
  `;
}

export function TourGuiado({
  screenId,
  userId = '',
  steps = [],
  reopenSignal = 0,
}) {
  const passos = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const [aberto, setAberto] = useState(false);
  const [indiceAtual, setIndiceAtual] = useState(0);
  const [layout, setLayout] = useState(null);
  const chavePersistencia = useMemo(
    () => montarChaveTour(screenId, userId),
    [screenId, userId],
  );
  const passoAtual = passos[indiceAtual] || null;

  useEffect(() => {
    if (!passos.length || !orientacoesAtivas()) return;

    try {
      if (window.localStorage.getItem(chavePersistencia) === '1') {
        return;
      }

      window.localStorage.setItem(chavePersistencia, '1');
      setIndiceAtual(0);
      setAberto(true);
    } catch (error) {
      setIndiceAtual(0);
      setAberto(true);
    }
  }, [chavePersistencia, passos.length]);

  useEffect(() => {
    if (!passos.length || !reopenSignal || !orientacoesAtivas()) return;
    setIndiceAtual(0);
    setAberto(true);
  }, [passos.length, reopenSignal]);

  useEffect(() => {
    if (!aberto || !passoAtual) return;

    const atualizar = () => setLayout(calcularPosicao(passoAtual));
    atualizar();

    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, true);
    return () => {
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar, true);
    };
  }, [aberto, passoAtual]);

  useEffect(() => {
    if (!aberto) return;

    const aoPressionarTecla = (event) => {
      if (event.key === 'Escape') {
        setAberto(false);
      }
    };

    window.addEventListener('keydown', aoPressionarTecla);
    return () => window.removeEventListener('keydown', aoPressionarTecla);
  }, [aberto]);

  if (!aberto || !passoAtual) return null;

  const ultimoPasso = indiceAtual >= passos.length - 1;
  const cardStyle = {
    top: `${layout?.card?.top || VIEWPORT_PADDING}px`,
    left: `${layout?.card?.left || VIEWPORT_PADDING}px`,
    width: `${layout?.card?.width || CARD_WIDTH}px`,
  };
  const destaqueStyle = layout?.target
    ? {
        top: `${layout.target.top}px`,
        left: `${layout.target.left}px`,
        width: `${layout.target.width}px`,
        height: `${layout.target.height}px`,
      }
    : null;

  return html`
    <div class="rh-tour-layer" aria-live="polite">
      ${destaqueStyle
        ? html`<div class="rh-tour-highlight" style=${destaqueStyle}></div>`
        : null}

      <div class="rh-tour-card" role="dialog" aria-modal="false" style=${cardStyle}>
        <div class="rh-tour-kicker">
          Guia rapido
          <span>${`${indiceAtual + 1}/${passos.length}`}</span>
        </div>
        <h3 class="rh-tour-title">${passoAtual.title}</h3>
        <p class="rh-tour-text">${passoAtual.text}</p>

        <div class="rh-tour-actions">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            onClick=${() => setAberto(false)}
          >
            Fechar
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onClick=${() => {
              if (ultimoPasso) {
                setAberto(false);
                return;
              }

              setIndiceAtual(indiceAtual + 1);
            }}
          >
            ${ultimoPasso ? 'Concluir' : 'Seguinte'}
          </button>
        </div>
      </div>
    </div>
  `;
}
