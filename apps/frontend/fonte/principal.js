import { React, createRoot, html } from './infraestrutura-react.js';
import { inicializarTema } from './shared/tema.js';

inicializarTema();

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Falha ao renderizar a aplicação.', error);
  }

  render() {
    if (this.state.error) {
      const mensagem = this.state.error?.message || String(this.state.error || 'Erro desconhecido');
      const stack = this.state.error?.stack || '';
      return html`
        <section class="active screen" id="screen-bootstrap-error">
          <div class="container py-5">
            <div class="alert alert-danger mb-3">
              Não foi possível renderizar a interface principal.
            </div>
            <pre class="alert alert-light border text-danger small mb-0" style=${{ whiteSpace: 'pre-wrap' }}>
${mensagem}${stack ? `\n\n${stack}` : ''}
            </pre>
          </div>
        </section>
      `;
    }

    return this.props.children;
  }
}

function renderizarFalhaInicializacao(root, mensagem) {
  root.render(html`
    <section class="active screen" id="screen-bootstrap-error">
      <div class="container py-5">
        <div class="alert alert-danger mb-0">
          ${mensagem}
        </div>
      </div>
    </section>
  `);
}

const container = document.getElementById('app');
if (!container) {
  throw new Error('Elemento #app não encontrado para montar a aplicação.');
}

const root = createRoot(container);

async function iniciarAplicacao() {
  try {
    const { Aplicacao } = await import('./aplicacao.js?v=20261002-wfm28');

    root.render(html`
      <${ErrorBoundary}>
        <${Aplicacao} />
      </${ErrorBoundary}>
    `);
  } catch (error) {
    console.error('[APP INIT] Falha ao inicializar aplicação:', error);
    renderizarFalhaInicializacao(
      root,
      `Não foi possível inicializar a aplicação: ${error?.message || error}`,
    );
  }
}

iniciarAplicacao();
