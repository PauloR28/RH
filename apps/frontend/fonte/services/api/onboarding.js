import { invalidarCacheApi, requisitar, requisitarArquivo } from './core.js';

function montarQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    query.set(chave, valor);
  });
  const texto = query.toString();
  return texto ? `?${texto}` : '';
}

export async function listarTrilhasOnboarding(filtros = {}) {
  return requisitar(`/onboarding/trilhas${montarQuery(filtros)}`, { method: 'GET' });
}

export async function listarAtribuicoesTreinamento(filtros = {}) {
  return requisitar(`/onboarding/assignments${montarQuery(filtros)}`, { method: 'GET' });
}

export async function atualizarAgendaTreinamento(idOnboarding, payload) {
  const resultado = await requisitar(`/onboarding/assignments/${encodeURIComponent(idOnboarding)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('onboarding-progresso');
  return resultado;
}

export async function lerTrilhaOnboarding(idTrilha) {
  return requisitar(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}`, { method: 'GET' });
}

export async function criarTrilhaOnboarding(payload) {
  const resultado = await requisitar('/onboarding/trilhas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function atualizarTrilhaOnboarding(idTrilha, payload) {
  const resultado = await requisitar(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function vincularTrilhaProcesso(idTrilha, idProcesso) {
  const resultado = await requisitar(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}/vincular-processo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_processo: idProcesso }),
  });
  invalidarCacheApi('onboarding-processos-treinamentos');
  return resultado;
}

export async function excluirTrilhaOnboarding(idTrilha) {
  const resultado = await requisitar(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}`, {
    method: 'DELETE',
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function iniciarOnboardingCandidato(payload) {
  const resultado = await requisitar('/onboarding/candidatos/iniciar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('onboarding-progresso');
  return resultado;
}

export async function lerProgressoOnboardingCandidato(idRegistro) {
  return requisitar(`/onboarding/candidatos/${encodeURIComponent(idRegistro)}`, { method: 'GET' });
}

export async function marcarItemOnboarding(idOnboardingItem, concluido) {
  const resultado = await requisitar(`/onboarding/itens/${encodeURIComponent(idOnboardingItem)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concluido: !!concluido }),
  });
  invalidarCacheApi('onboarding-progresso');
  return resultado;
}

export async function excluirAtribuicaoTreinamento(idOnboarding) {
  const resultado = await requisitar(`/onboarding/assignments/${encodeURIComponent(idOnboarding)}`, {
    method: 'DELETE',
  });
  invalidarCacheApi('onboarding-progresso');
  return resultado;
}

export async function salvarPresencaTreinamento(presencas) {
  const resultado = await requisitar('/onboarding/assignments/presenca', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presencas: presencas || [] }),
  });
  invalidarCacheApi('onboarding-progresso');
  return resultado;
}

export async function listarTreinamentosProcesso(filtros = {}) {
  return requisitar(`/onboarding/processos-treinamentos${montarQuery(filtros)}`, { method: 'GET' });
}

export async function listarCandidatosLiberacaoTreinamento(idProcessoTreinamento) {
  return requisitar(
    `/onboarding/processos-treinamentos/${encodeURIComponent(idProcessoTreinamento)}/candidatos`,
    { method: 'GET' },
  );
}

export async function liberarVagasTreinamento(idProcessoTreinamento, candidatos) {
  const resultado = await requisitar(
    `/onboarding/processos-treinamentos/${encodeURIComponent(idProcessoTreinamento)}/liberar`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidatos: candidatos || [] }),
    },
  );
  invalidarCacheApi('onboarding-progresso');
  return resultado;
}

// ---------------------------------------------------------------------------
// Wizard de criação de treinamento (Prompt.txt, rodada 06/set/2026) — ver
// docs/central-treinamentos/01-plano-tecnico.md.
// ---------------------------------------------------------------------------

export async function criarTreinamentoWizard(payload) {
  const resultado = await requisitar('/onboarding/treinamentos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('onboarding-trilhas', 'onboarding-progresso');
  return resultado;
}

export async function buscarCandidatosTreinamento(busca = '') {
  return requisitar(`/onboarding/candidatos-elegiveis${montarQuery({ busca })}`, { method: 'GET' });
}

export async function uploadSlideTreinamento(idTrilha, arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  const resultado = await requisitar(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}/pptx`, {
    method: 'POST',
    body: formData,
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function uploadVideoModulo(idItem, arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  const resultado = await requisitar(`/onboarding/itens/${encodeURIComponent(idItem)}/video`, {
    method: 'POST',
    body: formData,
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function uploadImagemSecaoModulo(idItem, arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  return requisitar(`/onboarding/itens/${encodeURIComponent(idItem)}/secoes-imagens`, {
    method: 'POST',
    body: formData,
  });
}

export async function uploadAnexoTreinamento(idTrilha, arquivo, trilhaItemId = 0) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  formData.append('trilha_item_id', String(trilhaItemId || 0));
  const resultado = await requisitar(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}/anexos`, {
    method: 'POST',
    body: formData,
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function alternarDownloadAnexo(idAnexo, payload) {
  const resultado = await requisitar(`/onboarding/anexos/${encodeURIComponent(idAnexo)}/download`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function excluirAnexoTreinamento(idAnexo) {
  const resultado = await requisitar(`/onboarding/anexos/${encodeURIComponent(idAnexo)}`, { method: 'DELETE' });
  invalidarCacheApi('onboarding-trilhas');
  return resultado;
}

export async function baixarAnexoTreinamento(idAnexo) {
  return requisitarArquivo(`/onboarding/anexos/${encodeURIComponent(idAnexo)}/arquivo`, { method: 'GET' });
}

export async function baixarPdfSlideTreinamento(idTrilha) {
  return requisitarArquivo(`/onboarding/trilhas/${encodeURIComponent(idTrilha)}/pptx-pdf`, { method: 'GET' });
}

export async function obterSchemaModulo() {
  return requisitar('/onboarding/modulos/schema', { method: 'GET' });
}

export async function baixarModeloModulo() {
  return requisitarArquivo('/onboarding/modulos/modelo', { method: 'GET' });
}

export async function validarModuloJson(modulo) {
  return requisitar('/onboarding/modulos/validar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(modulo || {}),
  });
}

export async function relatorioTreinamentosStatus(filtros = {}) {
  return requisitar(`/onboarding/relatorios/status${montarQuery(filtros)}`, { method: 'GET' });
}

export async function relatorioPresencaColaborador() {
  return requisitar('/onboarding/relatorios/presenca', { method: 'GET' });
}

export async function relatorioConclusaoOperacao() {
  return requisitar('/onboarding/relatorios/conclusao-operacao', { method: 'GET' });
}
