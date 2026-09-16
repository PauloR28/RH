import { html } from '../../infraestrutura-react.js';
import { PageIntro, PainelRh, SectionCard } from '../../ui/componentes-compartilhados.js';
import { IconeSvg } from '../../ui/icone.js';

const DIRETRIZES = [
  {
    tela: 'screen-settings-onboarding',
    icone: 'checklist',
    titulo: 'Trilhas de Onboarding',
    descricao: 'Módulos, conteúdos e ordem da trilha aplicada aos novos candidatos aprovados.',
    permissao: 'onboarding.editar',
  },
  {
    tela: 'screen-settings-disc',
    icone: 'bar_chart',
    titulo: 'Teste DISC',
    descricao: 'Perguntas, perfis e critérios de avaliação do teste comportamental DISC.',
    permissao: 'provas.questoes_criar',
  },
  {
    tela: 'screen-settings-fit-cultural',
    icone: 'diversity_3',
    titulo: 'Fit Cultural',
    descricao: 'Afirmações e pesos usados para medir aderência cultural do candidato.',
    permissao: 'fit_cultural.editar',
  },
  {
    tela: 'screen-settings-raciocinio-logico',
    icone: 'psychology',
    titulo: 'Raciocínio Lógico',
    descricao: 'Banco de questões e parâmetros do teste de raciocínio lógico.',
    permissao: 'provas.questoes_criar',
  },
];

export function TelaProvasConfiguracao({ controlador }) {
  const diretrizesVisiveis = DIRETRIZES.filter(
    (item) => !item.permissao || controlador?.possuiPermissao?.(item.permissao),
  );

  return html`
    <${PainelRh}
      screenId="screen-provas-configuracao"
      navAtiva="screen-provas-configuracao"
      subtituloMarca="Configuração do Conecta Provas"
      placeholderBusca="Configuração de provas"
      controlador=${controlador}
    >
      <${PageIntro}
        kicker="Conecta Provas"
        title="Banco de Provas"
        description="Gestão total do banco de questões — DISC, Fit Cultural, Raciocínio Lógico e as diretrizes usadas nas provas do Conecta."
      />

      <${SectionCard} title="Diretrizes da prova" className="rh-section-card--flat">
        <div class="rh-admin-module-list">
          ${diretrizesVisiveis.length
      ? diretrizesVisiveis.map(
        (item) => html`
                <button
                  key=${item.tela}
                  type="button"
                  class="rh-admin-module-row"
                  onClick=${() => controlador.irParaTelaProtegida(item.tela)}
                >
                  <span class="material-symbols-outlined rh-admin-module-icon" aria-hidden="true">${IconeSvg(item.icone)}</span>
                  <span class="rh-admin-module-copy">
                    <strong>${item.titulo}</strong>
                    <small>${item.descricao}</small>
                  </span>
                  <span class="material-symbols-outlined rh-admin-module-arrow" aria-hidden="true">${IconeSvg('chevron_right')}</span>
                </button>
              `,
      )
      : html`<p class="text-muted mb-0">Você não possui permissão para configurar nenhuma diretriz de prova.</p>`}
        </div>
      </${SectionCard}>
    </${PainelRh}>
  `;
}
