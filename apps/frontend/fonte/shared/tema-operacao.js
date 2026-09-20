// Tema por operação (vertente Monitoria): a cor primária e a logo da operação
// valem SOMENTE no ambiente dela. Só os tokens --brand* mudam; tags de status,
// fundo branco e cores de alerta permanecem os do Conecta. Sem operação com cor
// (ou usuário sem operação), nada é alterado — o azul padrão continua valendo.

const EVENTO = 'conecta-tema-operacao';
const PROPRIEDADES = ['--brand', '--brand-ink', '--brand-soft'];
let estado = { operacao: '', logoUrl: '', tokens: null };

function modoEscuro() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function aplicarTokens() {
  const raiz = document.documentElement;
  const { tokens } = estado;
  if (!tokens) {
    PROPRIEDADES.forEach((p) => raiz.style.removeProperty(p));
    return;
  }
  if (modoEscuro()) {
    raiz.style.setProperty('--brand', tokens['brand-dark-mode']);
    raiz.style.setProperty('--brand-ink', tokens['brand-dark-mode']);
    raiz.style.removeProperty('--brand-soft');
  } else {
    raiz.style.setProperty('--brand', tokens.brand);
    raiz.style.setProperty('--brand-ink', tokens['brand-ink']);
    raiz.style.setProperty('--brand-soft', tokens['brand-soft']);
  }
}

if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  new MutationObserver(aplicarTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export function definirTemaOperacao(operacao) {
  estado = {
    operacao: operacao?.chave || '',
    logoUrl: operacao?.logo_url || '',
    tokens: operacao?.tokens || null,
  };
  aplicarTokens();
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { ...estado } }));
}

export function limparTemaOperacao() {
  definirTemaOperacao(null);
}

export function obterLogoOperacao() {
  return estado.logoUrl;
}

export function assinarTemaOperacao(callback) {
  const ouvinte = (evento) => callback(evento.detail);
  window.addEventListener(EVENTO, ouvinte);
  return () => window.removeEventListener(EVENTO, ouvinte);
}
