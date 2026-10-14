// Áreas do Conecta INATIVAS por decisão da empresa (sem apagar código nem dados): Suporte TI, Central de Treinamentos,
// Processos seletivos, Conecta Provas e CX de Currículos (e-mail de recrutamento + banco de talentos). A fonte da verdade
// é o backend (RH_AREAS_INATIVAS, devolvido em GET /core/acesso -> `areas_inativas`); o padrão abaixo vale até esse retorno
// chegar e quando o backend é antigo, para o menu nunca "piscar" com telas que não devem existir. Reativar é só ajustar a
// variável no backend e reiniciar. Área inativa = nenhuma tela, atalho, notificação ou requisição dela.

export const AREA_SUPORTE_TI = 'suporte_ti';
export const AREA_TREINAMENTOS = 'treinamentos';
export const AREA_PROCESSOS = 'processos';
export const AREA_PROVAS = 'provas';
export const AREA_CURRICULOS = 'curriculos';

let inativas = new Set([AREA_SUPORTE_TI, AREA_TREINAMENTOS, AREA_PROCESSOS, AREA_PROVAS, AREA_CURRICULOS]);

export function definirAreasInativas(lista) {
  if (Array.isArray(lista)) inativas = new Set(lista);
}

export const areaAtiva = (area) => !inativas.has(area);

const TELAS_PROCESSOS = new Set([
  'screen-processes', 'screen-processes-open', 'screen-processes-closed', 'screen-process-decisions', 'screen-process-create',
  'screen-process-details', 'screen-candidates', 'screen-candidate-details', 'screen-candidate-pipeline', 'screen-interviews',
  'screen-analysis-candidates', 'screen-dashboard-funil', 'screen-public-candidacy',
]);
const TELAS_PROVAS = new Set([
  'screen-generated-exams', 'screen-history', 'screen-provas-configuracao', 'screen-process-analytical-results', 'screen-conecta-provas',
  'screen-settings-disc', 'screen-settings-fit-cultural', 'screen-settings-raciocinio-logico', 'screen-disc-teste',
  'screen-fit-cultural-teste', 'screen-raciocinio-teste',
]);
const TELAS_CURRICULOS = new Set(['screen-email-inbox', 'screen-talent-bank']);

// Tela -> área dona. `screen-training*` e `screen-chamados*` são prefixos (inclui criar/gerenciar/novo/detalhe).
export function areaDaTela(tela) {
  const t = String(tela || '');
  if (t.startsWith('screen-chamados')) return AREA_SUPORTE_TI;
  if (t.startsWith('screen-training')) return AREA_TREINAMENTOS;
  if (TELAS_PROCESSOS.has(t)) return AREA_PROCESSOS;
  if (TELAS_PROVAS.has(t)) return AREA_PROVAS;
  if (TELAS_CURRICULOS.has(t)) return AREA_CURRICULOS;
  return '';
}

export const telaEmAreaInativa = (tela) => {
  const area = areaDaTela(tela);
  return Boolean(area) && !areaAtiva(area);
};

// Permissões exclusivas de cada área (espelha `_PREFIXOS_POR_AREA` em rh_api/services/acesso.py). `candidatos.` é compartilhada
// por Processos e CX de Currículos (banco de talentos): só deixa de valer com as DUAS inativas.
const PREFIXOS_POR_AREA = {
  [AREA_SUPORTE_TI]: ['chamados.'],
  [AREA_PROCESSOS]: ['sessao.processos.', 'vagas.', 'processos.', 'entrevistas.'],
  [AREA_PROVAS]: ['sessao.provas.', 'provas.', 'fit_cultural.'],
  [AREA_CURRICULOS]: ['sessao.curriculos.'],
};

export function permissaoEmAreaInativa(permissao) {
  const p = String(permissao || '');
  if (!p) return false;
  for (const [area, prefixos] of Object.entries(PREFIXOS_POR_AREA)) {
    if (!areaAtiva(area) && prefixos.some((prefixo) => p.startsWith(prefixo))) return true;
  }
  return p.startsWith('candidatos.') && !areaAtiva(AREA_PROCESSOS) && !areaAtiva(AREA_CURRICULOS);
}
