// Mantém a navegação em hash simples para funcionar sem etapa de build.
export const ROTAS_POR_TELA = {
  'screen-login': 'login',
  'screen-menu': 'inicio',
  'screen-email-inbox': 'caixa-email',
  'screen-history': 'processos/historico-exames',
  'screen-processes': 'processos',
  'screen-processes-closed': 'processos/encerrados',
  'screen-process-decisions': 'processos/decisoes-pendentes',
  'screen-candidates': 'candidatos',
  'screen-candidate-pipeline': 'pipeline-candidatos',
  'screen-process-create': 'novo-processo',
  'screen-process-details': 'detalhes-processo',
  'screen-candidate-details': 'candidatos/detalhes',
  'screen-interviews': 'processos/entrevistas-agendadas',
  'screen-talent-bank': 'banco-talentos',
  'screen-onedrive-files': 'onedrive',
  'screen-settings-users': 'configuracoes/usuario',
  'screen-settings-profiles': 'configuracoes/perfis-permissoes',
  'screen-settings-operations': 'configuracoes/operacoes',
  'screen-settings-logs': 'configuracoes/logs',
  'screen-settings-notifications': 'configuracoes/notificacoes',
  'screen-settings-environment': 'configuracoes/ambiente',
  'screen-settings-onboarding': 'configuracoes/onboarding',
  'screen-settings-document-templates': 'configuracoes/templates-documentos',
  'screen-settings-administracao': 'configuracoes/administracao',
  'screen-settings-sharepoint-ambiente': 'configuracoes/administracao/parametros/sharepoint/novo-ambiente',
  'screen-provas-configuracao': 'processos/provas-configuracao',
  'screen-settings': 'configuracoes/usuario',
  'screen-calendario': 'calendario',
  'screen-mural': 'gestao/mural',
  'screen-generated-exams': 'processos/provas-resultados',
  'screen-process-analytical-results': 'processos/resultados-analiticos',
  'screen-training': 'processos/treinamentos',
  'screen-training-trilhas': 'processos/treinamentos/trilhas',
  'screen-training-assignments': 'processos/treinamentos/atribuicoes',
  'screen-training-create': 'processos/treinamentos/criar',
  'screen-config': 'configuracao',
  'screen-candidate': 'candidato',
  'screen-exam': 'prova',
  'screen-thanks': 'conclusao',
  'screen-result': 'resultado',
  'screen-analysis-candidates': 'analise-candidatos',
  'screen-dashboard-funil': 'processos/dashboard-funil',
  'screen-public-candidacy': 'candidatar',
  'screen-conecta-provas': 'conecta-provas',
  'screen-forbidden': 'acesso-negado',
  'screen-settings-disc': 'configuracoes/teste-disc',
  'screen-settings-fit-cultural': 'configuracoes/fit-cultural',
  'screen-settings-raciocinio-logico': 'configuracoes/raciocinio-logico',
  'screen-disc-teste': 'disc-teste',
  'screen-fit-cultural-teste': 'fit-cultural-teste',
  'screen-raciocinio-teste': 'raciocinio-teste',
};

export const TELAS_POR_ROTA = Object.entries(ROTAS_POR_TELA).reduce(
  (mapa, [tela, rota]) => {
    mapa[rota] = tela;
    return mapa;
  },
  {},
);

TELAS_POR_ROTA['processos/visao-geral'] = 'screen-processes';
TELAS_POR_ROTA['processos/abertos'] = 'screen-processes';
TELAS_POR_ROTA.historico = 'screen-history';
TELAS_POR_ROTA['historico-exames'] = 'screen-history';
TELAS_POR_ROTA['provas-resultados'] = 'screen-generated-exams';
TELAS_POR_ROTA.entrevistas = 'screen-interviews';
TELAS_POR_ROTA.configuracoes = 'screen-settings-users';
TELAS_POR_ROTA['configuracoes/usuario'] = 'screen-settings-users';
TELAS_POR_ROTA['configuracoes/usuarios'] = 'screen-settings-users';
TELAS_POR_ROTA['configuracoes/regras-reutilizaveis'] = 'screen-settings-users';

export function obterRotaPorTela(tela) {
  if (tela === 'screen-processes-open') return ROTAS_POR_TELA['screen-processes'];
  return ROTAS_POR_TELA[tela] || ROTAS_POR_TELA['screen-login'];
}

function normalizarRota(valor) {
  return String(valor || '')
    .replace(/^#\/?/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

export function obterRotaAtual() {
  const pathname =
    typeof window !== 'undefined' ? String(window.location.pathname || '') : '';
  const hashLegado =
    typeof window !== 'undefined' ? normalizarRota(window.location.hash) : '';
  if (hashLegado) return hashLegado;

  const caminhoNormalizado = pathname.replace(/\/+$/, '') || '/';
  if (
    caminhoNormalizado === '/conecta-provas' ||
    caminhoNormalizado.startsWith('/conecta-provas/')
  ) {
    return 'conecta-provas';
  }

  const partes = caminhoNormalizado.split('/').filter(Boolean);
  const indiceIndex = partes.findIndex((parte) => parte.toLowerCase() === 'index.html');
  if (indiceIndex >= 0) {
    return normalizarRota(partes.slice(indiceIndex + 1).join('/'));
  }

  return normalizarRota(partes.join('/'));
}

export function obterTelaPorRota(rotaAtual = obterRotaAtual()) {
  const rota = normalizarRota(rotaAtual);
  if (!rota) return 'screen-login';
  if (rota === 'conecta-provas' || rota.startsWith('conecta-provas/')) {
    return 'screen-conecta-provas';
  }
  if (rota.startsWith('candidatar/')) return 'screen-public-candidacy';
  if (rota.startsWith('disc-teste/')) return 'screen-disc-teste';
  if (rota.startsWith('fit-cultural-teste/')) return 'screen-fit-cultural-teste';
  if (rota.startsWith('raciocinio-teste/')) return 'screen-raciocinio-teste';
  if (/^processos\/.+\/resultados-analiticos$/.test(rota)) {
    return 'screen-process-analytical-results';
  }
  return TELAS_POR_ROTA[rota] || 'screen-login';
}

export function obterProcessoResultadosAnaliticosPorRota(rotaAtual = obterRotaAtual()) {
  const rota = normalizarRota(rotaAtual);
  const match = rota.match(/^processos\/(.+)\/resultados-analiticos$/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function montarCaminhoResultadosAnaliticos(processId) {
  return `/processos/${encodeURIComponent(String(processId || '').trim())}/resultados-analiticos`;
}

export function obterTelaPorHash(hashAtual) {
  return obterTelaPorRota(hashAtual || obterRotaAtual());
}

export function montarCaminhoDaTela(tela) {
  const rota = obterRotaPorTela(tela);
  return `/${rota}`.replace(/\/+/g, '/');
}

export function montarHashDaTela(tela) {
  return montarCaminhoDaTela(tela);
}

export function obterSlugCandidaturaPorHash(hashAtual) {
  const rota = normalizarRota(hashAtual || obterRotaAtual());

  if (!rota.startsWith('candidatar/')) return '';
  return decodeURIComponent(rota.slice('candidatar/'.length));
}

export function montarHashCandidatura(slug) {
  return `/candidatar/${encodeURIComponent(String(slug || '').trim())}`;
}

// Testes complementares (DISC, Fit Cultural, Raciocínio Lógico): link público
// enviado ao candidato carrega o identificador da aplicação (ou, no caso do
// Fit Cultural, o id_registro do vínculo candidato/processo) direto no path,
// no mesmo espírito das rotas públicas já existentes acima (sem autenticação
// de RH — o backend valida o identificador em si).
function extrairParametroRota(hashAtual, prefixo) {
  const rota = normalizarRota(hashAtual || obterRotaAtual());
  if (!rota.startsWith(prefixo)) return '';
  return decodeURIComponent(rota.slice(prefixo.length));
}

export function obterIdAplicacaoDiscPorHash(hashAtual) {
  return extrairParametroRota(hashAtual, 'disc-teste/');
}

export function montarHashDiscTeste(idAplicacao) {
  return `/disc-teste/${encodeURIComponent(String(idAplicacao || '').trim())}`;
}

export function obterCandidatoProcessoIdFitCulturalPorHash(hashAtual) {
  return extrairParametroRota(hashAtual, 'fit-cultural-teste/');
}

export function montarHashFitCulturalTeste(candidatoProcessoId) {
  return `/fit-cultural-teste/${encodeURIComponent(String(candidatoProcessoId || '').trim())}`;
}

export function obterIdAplicacaoRaciocinioPorHash(hashAtual) {
  return extrairParametroRota(hashAtual, 'raciocinio-teste/');
}

export function montarHashRaciocinioTeste(idAplicacao) {
  return `/raciocinio-teste/${encodeURIComponent(String(idAplicacao || '').trim())}`;
}
