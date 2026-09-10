import { html } from '../../infraestrutura-react.js';
import { EmptyState, PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';

export function TelaMural({ controlador }) {
  return html`
    <${PainelRh}
      screenId="screen-mural"
      navAtiva="screen-mural"
      subtituloMarca="Mural"
      placeholderBusca="Mural"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Gestão"
        title="Mural"
        
      />

      

      <${SectionCard} title="Publicações" className="rh-section-card--flat">
        <button type="button" class="btn btn-primary rh-modern-primary-btn mb-4" disabled title="Em breve">
          <span class="material-symbols-outlined">${IconeSvg('add')}</span>
          Nova publicação
        </button>

        <${EmptyState}
          title="Nenhuma publicação ainda"
          text="Quando o Mural for ativado, avisos, comunicados, fotos e vídeos publicados pelo RH aparecerão aqui como um feed."
        />
      </${SectionCard}>
    </${PainelRh}>
  `;
}
