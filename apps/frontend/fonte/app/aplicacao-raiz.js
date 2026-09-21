import { html, lazy, React, Suspense, useEffect, useState } from '../infraestrutura-react.js';
import {
  navegarParaTela,
  usarTelaAtual,
  useControladorAplicacao,
} from './controlador-aplicacao.js';
import { LoadingState, ModalPadrao } from '../ui/componentes-compartilhados.js';
import { BarraLateral, CartaoUsuarioTopo } from '../ui/components/layout.js?v=20260921-ajuda';
import { TemaOperacao, TrocaSenhaObrigatoria } from '../features/monitoria/global.js?v=20260920-monitoria2';
import {
  buscarPoliticaPendente,
  confirmarLeituraPolitica,
} from '../servico-api.js';

function carregarTela(importador, nomeExportado) {
  return lazy(() => importador().then((modulo) => ({ default: modulo[nomeExportado] })));
}

const MENSAGENS_CARREGAMENTO_TELA = [
  'Aguarde: carregando informações.',
  'Organizando os dados da tela...',
  'Quase lá...',
];

function TelaCarregando({
  titulo = 'Carregando tela',
  descricao = 'Aguarde: Carregando informações.',
}) {
  return html`
    <section class="active screen" id="screen-loading">
      <div class="container py-5">
        <${LoadingState}
          titulo=${titulo}
          descricao=${descricao}
          mensagens=${MENSAGENS_CARREGAMENTO_TELA}
        />
      </div>
    </section>
  `;
}

// Mantém o menu lateral e o topo fixos enquanto o conteúdo de uma tela
// autenticada ainda está sendo carregado (evita a sensação de que a
// plataforma inteira "sumiu" durante a navegação entre telas).
function TelaCarregandoComShell({ controlador, navAtiva }) {
  return html`
    <section class="active screen" id="screen-loading">
      <div class="rh-modern-shell">
        <${BarraLateral}
          navAtiva=${navAtiva}
          controlador=${controlador}
        />
        <div class="rh-modern-main">
          <header class="rh-modern-topbar">
            <div class="rh-modern-topbar-left"></div>
            <div class="rh-modern-topbar-actions">
              <${CartaoUsuarioTopo} controlador=${controlador} />
            </div>
          </header>
          <main class="rh-modern-page">
            <${LoadingState}
              titulo="Carregando tela"
              descricao="Aguarde: carregando o conteúdo desta página."
              mensagens=${MENSAGENS_CARREGAMENTO_TELA}
            />
          </main>
        </div>
      </div>
    </section>
  `;
}

// Telas que não usam o layout padrão do RH (PainelRh/menu lateral) — o
// candidato realizando a prova não deve ver o menu do RH aparecendo e
// sumindo durante o carregamento.
const TELAS_SEM_SHELL_FIXO = new Set([
  'screen-public-candidacy',
  'screen-conecta-provas',
  'screen-login',
  'screen-candidate',
  'screen-exam',
  'screen-thanks',
  'screen-result',
]);

const importarGestao = () => import('../features/telas-gestao.js?v=20260920-monitoria');
const importarProcessos = () => import('../features/telas-processos.js?v=20260916-correcoes-round3');
const importarProva = () => import('../features/telas-prova.js?v=20260904-identidade-conecta');

const TelaAnaliseCandidatos = carregarTela(importarGestao, 'TelaAnaliseCandidatos');
const TelaBancoTalentos = carregarTela(importarGestao, 'TelaBancoTalentos');
const TelaCriarProcesso = carregarTela(importarGestao, 'TelaCriarProcesso');
const TelaCaixaEmail = carregarTela(importarGestao, 'TelaCaixaEmail');
const TelaHistorico = carregarTela(importarGestao, 'TelaHistorico');
const TelaInicio = carregarTela(importarGestao, 'TelaInicio');
const TelaLogin = carregarTela(importarGestao, 'TelaLogin');
const TelaDetalhesProcesso = carregarTela(importarProcessos, 'TelaDetalhesProcesso');
const TelaProcessosDecisoesPendentes = carregarTela(importarProcessos, 'TelaProcessosDecisoesPendentes');
const TelaProcessosEncerrados = carregarTela(importarProcessos, 'TelaProcessosEncerrados');
const TelaProcessos = carregarTela(importarProcessos, 'TelaProcessos');
const TelaCandidatos = carregarTela(() => import('../features/candidatos/index.js?v=20260916-correcoes-round4'), 'TelaCandidatos');
const TelaDetalhesCandidato = carregarTela(() => import('../features/candidatos/index.js?v=20260916-correcoes-round4'), 'TelaDetalhesCandidato');
const TelaPipelineCandidatos = carregarTela(() => import('../features/tela-pipeline.js?v=20260904-identidade-conecta'), 'TelaPipelineCandidatos');
const TelaEntrevistas = carregarTela(() => import('../features/tela-entrevistas.js?v=20260916-correcoes-txt'), 'TelaEntrevistas');
const TelaOneDriveArquivos = carregarTela(() => import('../features/onedrive/index.js?v=20260920-drive'), 'TelaOneDriveArquivos');
const TelaCandidaturaPublica = carregarTela(() => import('../features/public-candidacy/index.js'), 'TelaCandidaturaPublica');
const TelaConectaProvas = carregarTela(() => import('../features/conecta-provas/index.js?v=20260904-identidade-conecta'), 'TelaConectaProvas');
const TelaProvasResultados = carregarTela(() => import('../features/provas-geradas/index.js?v=20260904-identidade-conecta'), 'TelaProvasResultados');
const TelaResultadosAnaliticosProcesso = carregarTela(
  () => import('../features/resultados-analiticos/index.js?v=20260904-identidade-conecta'),
  'TelaResultadosAnaliticosProcesso',
);
const TelaConfiguracoesSistema = carregarTela(
  () => import('../features/configuracoes/index.js?v=20260921-monitoria5'),
  'TelaConfiguracoesSistema',
);
const importarMonitoria = () => import('../features/monitoria/index.js?v=20260921-monitoria5');
const TelaMonitoria = carregarTela(importarMonitoria, 'TelaMonitoria');
const TelaCentralMonitoriaConfig = carregarTela(importarMonitoria, 'TelaCentralMonitoriaConfig');
const TelaInicioPorSessoes = carregarTela(importarMonitoria, 'TelaInicioPorSessoes');
const TelaCalendario = carregarTela(() => import('../features/calendario/index.js?v=20260916-correcoes-round4'), 'TelaCalendario');
const TelaMural = carregarTela(() => import('../features/mural/index.js?v=20260916-correcoes-round4'), 'TelaMural');
const TelaOnboarding = carregarTela(() => import('../features/onboarding/index.js?v=20260904-identidade-conecta'), 'TelaOnboarding');
const TelaDashboardFunil = carregarTela(
  () => import('../features/dashboard-funil/index.js?v=20260904-identidade-conecta'),
  'TelaDashboardFunil',
);
const TelaTemplatesDocumentos = carregarTela(
  () => import('../features/documentos-template/index.js?v=20260921-ajuda'),
  'TelaTemplatesDocumentos',
);
const TelaCentralAjuda = carregarTela(() => import('../features/ajuda/guia.js?v=20260921-ajuda'), 'TelaCentralAjuda');
const TelaTreinamentos = carregarTela(
  () => import('../features/treinamentos/index.js?v=20260917-correcoes-txt'),
  'TelaTreinamentos',
);
const TelaCriarTreinamento = carregarTela(
  () => import('../features/treinamentos/wizard.js?v=20260917-correcoes-txt'),
  'TelaCriarTreinamento',
);
const TelaProvasConfiguracao = carregarTela(
  () => import('../features/conecta-provas-configuracao/index.js?v=20260904-identidade-conecta'),
  'TelaProvasConfiguracao',
);
const TelaAdministracao = carregarTela(
  () => import('../features/administracao/index.js?v=20260916-correcoes-txt'),
  'TelaAdministracao',
);
const importarCatalogoDedicado = () => import('../features/catalogo-dedicado/index.js?v=20260916-correcoes-round3');
const TelaLgpd = carregarTela(importarCatalogoDedicado, 'TelaLgpd');
const TelaMotivosEliminacao = carregarTela(importarCatalogoDedicado, 'TelaMotivosEliminacao');
const TelaModelosEmail = carregarTela(importarCatalogoDedicado, 'TelaModelosEmail');
const TelaEtapasProcesso = carregarTela(importarCatalogoDedicado, 'TelaEtapasProcesso');
const TelaNovoAmbienteSharePoint = carregarTela(
  () => import('../features/administracao/novo-ambiente.js?v=20260908-correcoes-ambiente'),
  'TelaNovoAmbienteSharePoint',
);
const importarDisc = () => import('../features/disc/index.js?v=20260916-correcoes-txt');
const importarFitCultural = () => import('../features/fit-cultural/index.js?v=20260916-correcoes-txt');
const importarRaciocinio = () => import('../features/raciocinio-logico/index.js?v=20260916-correcoes-txt');
const TelaDiscAdmin = carregarTela(importarDisc, 'TelaDiscAdmin');
const TelaDiscTestePublico = carregarTela(importarDisc, 'TelaDiscTestePublico');
const TelaFitCulturalAdmin = carregarTela(importarFitCultural, 'TelaFitCulturalAdmin');
const TelaFitCulturalTestePublico = carregarTela(importarFitCultural, 'TelaFitCulturalTestePublico');
const TelaRaciocinioAdmin = carregarTela(importarRaciocinio, 'TelaRaciocinioAdmin');
const TelaRaciocinioTestePublico = carregarTela(importarRaciocinio, 'TelaRaciocinioTestePublico');
const TelaCandidato = carregarTela(importarProva, 'TelaCandidato');
const TelaConfiguracao = carregarTela(importarProva, 'TelaConfiguracao');
const TelaConclusao = carregarTela(importarProva, 'TelaConclusao');
const TelaProva = carregarTela(importarProva, 'TelaProva');
const TelaResultado = carregarTela(importarProva, 'TelaResultado');

function resolverTelaProtegida(telaAtual, controlador) {
  const { estado, blueprint } = controlador;

  if (
    telaAtual === 'screen-public-candidacy' ||
    telaAtual === 'screen-conecta-provas' ||
    telaAtual === 'screen-disc-teste' ||
    telaAtual === 'screen-fit-cultural-teste' ||
    telaAtual === 'screen-raciocinio-teste'
  ) {
    return telaAtual;
  }

  if (telaAtual === 'screen-forbidden') {
    return telaAtual;
  }

  if (!estado.autenticado) {
    return 'screen-login';
  }

  if (telaAtual === 'screen-processes-open') {
    return 'screen-processes';
  }

  // Vertente Monitoria (20/set/2026): Supervisor e Operador deixam de cair direto na
  // Central de Treinamentos. Todos os perfis (exceto Administrador e Gestor) começam
  // no Início por sessões: saudação + uma div por sessão a que têm acesso.

  if (!controlador.podeAcessarTela(telaAtual)) {
    return 'screen-forbidden';
  }

  if (
    estado.provaFinalizada &&
    !estado.acessoRhLiberadoAposProva &&
    telaAtual !== 'screen-thanks'
  ) {
    return 'screen-thanks';
  }

  if (telaAtual === 'screen-login') {
    return 'screen-menu';
  }

  if (telaAtual === 'screen-candidate' && !blueprint) {
    return 'screen-config';
  }

  if (telaAtual === 'screen-exam' && !estado.questoes.length) {
    return estado.candidato.role ? 'screen-candidate' : 'screen-config';
  }

  if (
    (telaAtual === 'screen-thanks' || telaAtual === 'screen-result') &&
    !estado.provaFinalizada
  ) {
    if (estado.questoes.length) {
      return 'screen-exam';
    }
    return 'screen-menu';
  }

  return telaAtual;
}

function ConteudoAplicacao({ controlador, telaAtual, telaResolvida }) {
  const [politicaPendente, setPoliticaPendente] = useState(null);
  const [confirmandoPolitica, setConfirmandoPolitica] = useState(false);
  const [erroPoliticaPendente, setErroPoliticaPendente] = useState('');

  useEffect(() => {
    if (telaResolvida !== telaAtual) {
      navegarParaTela(telaResolvida, {
        replace: telaResolvida === 'screen-login',
      });
    }
  }, [telaAtual, telaResolvida]);

  useEffect(() => {
    let cancelado = false;
    if (
      controlador.estado.autenticado &&
      telaResolvida !== 'screen-login' &&
      telaResolvida !== 'screen-public-candidacy' &&
      telaResolvida !== 'screen-conecta-provas'
    ) {
      buscarPoliticaPendente()
        .then((politica) => {
          if (!cancelado) setPoliticaPendente(politica || null);
        })
        .catch(() => {
          // Falha silenciosa: a política pendente não deve bloquear o uso do
          // sistema caso a checagem falhe (ex.: backend indisponível).
        });
    }
    return () => {
      cancelado = true;
    };
  }, [controlador.estado.autenticado, telaResolvida]);

  const confirmarLeituraDaPoliticaPendente = async () => {
    if (!politicaPendente?.id_politica) return;
    setConfirmandoPolitica(true);
    setErroPoliticaPendente('');
    try {
      await confirmarLeituraPolitica(politicaPendente.id_politica);
      setPoliticaPendente(null);
    } catch (error) {
      setErroPoliticaPendente(
        error?.message || 'Não foi possível registrar a confirmação de leitura.',
      );
    } finally {
      setConfirmandoPolitica(false);
    }
  };

  if (telaResolvida === 'screen-public-candidacy') {
    return html`<${TelaCandidaturaPublica} />`;
  }

  if (telaResolvida === 'screen-conecta-provas') {
    return html`<${TelaConectaProvas} />`;
  }

  if (telaResolvida === 'screen-disc-teste') {
    return html`<${TelaDiscTestePublico} />`;
  }

  if (telaResolvida === 'screen-fit-cultural-teste') {
    return html`<${TelaFitCulturalTestePublico} />`;
  }

  if (telaResolvida === 'screen-raciocinio-teste') {
    return html`<${TelaRaciocinioTestePublico} />`;
  }

  if (controlador.estado.validandoSessao) {
    return html`
      <${TelaCarregando}
        titulo="Validando sessão"
        descricao="Confirmando seu acesso antes de abrir o painel."
      />
    `;
  }

  if (!controlador.estado.autenticado || telaResolvida === 'screen-login') {
    return html`<${TelaLogin} controlador=${controlador} />`;
  }

  if (politicaPendente?.id_politica) {
    return html`
      <${ModalPadrao}
        aberto=${true}
        titulo=${politicaPendente.titulo || 'Política institucional'}
        subtitulo="Leitura obrigatória antes de continuar."
        className="rh-policy-gate-modal"
        ocultarFechar=${true}
        onClose=${() => {}}
      >
        <div class="rh-details-body">
          <div class="rh-policy-gate-body">${politicaPendente.corpo_texto}</div>
          ${erroPoliticaPendente
        ? html`<div class="alert alert-warning">${erroPoliticaPendente}</div>`
        : null}
        </div>
        <footer class="rh-modal-footer">
          <div class="rh-modal-footer-actions">
            <button
              type="button"
              class="btn btn-primary"
              disabled=${confirmandoPolitica}
              onClick=${confirmarLeituraDaPoliticaPendente}
            >
              ${confirmandoPolitica ? 'Confirmando...' : 'Li e confirmo'}
            </button>
          </div>
        </footer>
      </${ModalPadrao}>
    `;
  }

  if (telaResolvida === 'screen-menu') {
    const perfilInicio = controlador.estado.perfilUsuario;
    if (perfilInicio && perfilInicio !== 'administrador' && perfilInicio !== 'gestor') {
      return html`<${TelaInicioPorSessoes} controlador=${controlador} />`;
    }
    return html`<${TelaInicio} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-monitoria') {
    return html`<${TelaCentralMonitoriaConfig} controlador=${controlador} />`;
  }

  if (telaResolvida.startsWith('screen-monitoria')) {
    return html`<${TelaMonitoria} controlador=${controlador} telaAtual=${telaResolvida} />`;
  }

  if (telaResolvida === 'screen-email-inbox') {
    return html`<${TelaCaixaEmail} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-history') {
    return html`<${TelaHistorico} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-process-create') {
    return html`<${TelaCriarProcesso} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-processes') {
    return html`<${TelaProcessos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-processes-closed') {
    return html`<${TelaProcessosEncerrados} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-process-decisions') {
    return html`<${TelaProcessosDecisoesPendentes} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-candidates') {
    return html`<${TelaCandidatos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-candidate-details') {
    return html`<${TelaDetalhesCandidato} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-candidate-pipeline') {
    return html`<${TelaPipelineCandidatos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-process-details') {
    return html`<${TelaDetalhesProcesso} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-interviews') {
    return html`<${TelaEntrevistas} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-talent-bank') {
    return html`<${TelaBancoTalentos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-onedrive-files') {
    return html`<${TelaOneDriveArquivos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-analysis-candidates') {
    return html`<${TelaAnaliseCandidatos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-dashboard-funil') {
    return html`<${TelaDashboardFunil} controlador=${controlador} />`;
  }

  if (
    telaResolvida === 'screen-settings' ||
    telaResolvida === 'screen-settings-users' ||
    telaResolvida === 'screen-settings-profiles' ||
    telaResolvida === 'screen-settings-operations' ||
    telaResolvida === 'screen-settings-notifications' ||
    telaResolvida === 'screen-settings-logs' ||
    telaResolvida === 'screen-settings-monitoria-equipes' ||
    telaResolvida === 'screen-settings-monitoria-logs' ||
    telaResolvida === 'screen-settings-environment'
  ) {
    return html`
      <${TelaConfiguracoesSistema}
        controlador=${controlador}
        telaAtual=${telaResolvida}
      />
    `;
  }

  if (telaResolvida === 'screen-settings-lgpd') {
    return html`<${TelaLgpd} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-motivos-eliminacao') {
    return html`<${TelaMotivosEliminacao} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-modelos-email') {
    return html`<${TelaModelosEmail} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-etapas') {
    return html`<${TelaEtapasProcesso} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-calendario') {
    return html`<${TelaCalendario} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-mural') {
    return html`<${TelaMural} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-onboarding') {
    return html`<${TelaOnboarding} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-help') {
    return html`<${TelaCentralAjuda} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-document-templates') {
    return html`<${TelaTemplatesDocumentos} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-disc') {
    return html`<${TelaDiscAdmin} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-fit-cultural') {
    return html`<${TelaFitCulturalAdmin} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-raciocinio-logico') {
    return html`<${TelaRaciocinioAdmin} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-generated-exams') {
    return html`<${TelaProvasResultados} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-provas-configuracao') {
    return html`<${TelaProvasConfiguracao} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-administracao') {
    return html`<${TelaAdministracao} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-settings-sharepoint-ambiente') {
    return html`<${TelaNovoAmbienteSharePoint} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-process-analytical-results') {
    return html`<${TelaResultadosAnaliticosProcesso} controlador=${controlador} />`;
  }

  if (
    telaResolvida === 'screen-training' ||
    telaResolvida === 'screen-training-trilhas' ||
    telaResolvida === 'screen-training-assignments' ||
    telaResolvida === 'screen-training-mine'
  ) {
    return html`
      <${TelaTreinamentos}
        controlador=${controlador}
        telaAtual=${telaResolvida}
      />
    `;
  }

  if (telaResolvida === 'screen-training-create') {
    return html`<${TelaCriarTreinamento} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-forbidden') {
    return html`
      <section class="active screen" id="screen-forbidden">
        <div class="container py-5">
          <div class="alert alert-warning mb-3">
            ${controlador.estado.avisoAcessoNegado ||
      'Você não possui permissão para acessar esta área ou executar esta ação.'}
          </div>
          <button
            type="button"
            class="btn btn-primary"
            onClick=${() => controlador.irParaMenu()}
          >
            Voltar ao painel
          </button>
        </div>
      </section>
    `;
  }

  if (telaResolvida === 'screen-config') {
    return html`<${TelaConfiguracao} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-candidate') {
    return html`<${TelaCandidato} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-exam') {
    return html`<${TelaProva} controlador=${controlador} />`;
  }

  if (telaResolvida === 'screen-thanks') {
    return html`<${TelaConclusao} controlador=${controlador} />`;
  }

  return html`<${TelaResultado} controlador=${controlador} />`;
}

export function Aplicacao() {
  const controlador = useControladorAplicacao();
  const telaAtual = usarTelaAtual(controlador.estado.autenticado);
  const telaResolvida = resolverTelaProtegida(telaAtual, controlador);

  const usaShellFixo =
    controlador.estado.autenticado &&
    !controlador.estado.validandoSessao &&
    !TELAS_SEM_SHELL_FIXO.has(telaResolvida);

  const fallback = usaShellFixo
    ? html`<${TelaCarregandoComShell} controlador=${controlador} navAtiva=${telaResolvida} />`
    : html`<${TelaCarregando} />`;

  return html`
    <${React.Fragment}>
      <${Suspense} fallback=${fallback}>
        <${ConteudoAplicacao}
          controlador=${controlador}
          telaAtual=${telaAtual}
          telaResolvida=${telaResolvida}
        />
      </${Suspense}>
      <${TemaOperacao} controlador=${controlador} />
      <${TrocaSenhaObrigatoria} controlador=${controlador} />
    </${React.Fragment}>
  `;
}
