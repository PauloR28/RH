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
        description="Feed de avisos, comunicados, fotos, vídeos e publicações do RH — com publicação simultânea no Conecta e nas intranets (SharePoint) das operações."
      />

      <${SectionCard} title="Mural — em desenvolvimento" className="rh-section-card--flat">
        <div class="d-flex align-items-start gap-3">
          <span class="material-symbols-outlined" aria-hidden="true">${IconeSvg('upcoming')}</span>
          <p class="rh-section-card-description mb-0">
            Esta página está desativada e entrará no Conecta em breve. A ideia: o RH publica aqui uma
            vez e a postagem aparece tanto no Conecta quanto nas intranets das operações, com contagem
            de visualizações e curtidas.
          </p>
        </div>
      </${SectionCard}>

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
