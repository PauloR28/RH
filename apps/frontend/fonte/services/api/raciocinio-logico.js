import { invalidarCacheApi, requisitar } from './core.js?v=20261124-equipes4';

// RH: banco de questões de raciocínio lógico/numérico.
export async function listarPerguntasRaciocinio() {
  return requisitar('/raciocinio-logico/perguntas', { method: 'GET' });
}

export async function criarPerguntaRaciocinio(payload) {
  const resultado = await requisitar('/raciocinio-logico/perguntas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('raciocinio-perguntas');
  return resultado;
}

export async function atualizarPerguntaRaciocinio(idPergunta, payload) {
  const resultado = await requisitar(`/raciocinio-logico/perguntas/${encodeURIComponent(idPergunta)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('raciocinio-perguntas');
  return resultado;
}

export async function excluirPerguntaRaciocinio(idPergunta) {
  const resultado = await requisitar(`/raciocinio-logico/perguntas/${encodeURIComponent(idPergunta)}`, {
    method: 'DELETE',
  });
  invalidarCacheApi('raciocinio-perguntas');
  return resultado;
}

// RH: gerar uma aplicação (seleciona questões aleatórias do banco ativo).
export async function criarAplicacaoRaciocinio(payload) {
  const resultado = await requisitar('/raciocinio-logico/aplicacoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  invalidarCacheApi('raciocinio-aplicacoes');
  return resultado;
}

export async function lerAplicacaoRaciocinio(idAplicacao) {
  return requisitar(`/raciocinio-logico/aplicacoes/${encodeURIComponent(idAplicacao)}`, { method: 'GET' });
}

export async function lerResultadoRaciocinioCandidato(idTeste) {
  return requisitar(`/raciocinio-logico/candidatos/${encodeURIComponent(idTeste)}/resultado`, { method: 'GET' });
}

// Candidato (rota pública): aplicação do teste, com cronômetro opcional
// (tempo_limite_minutos, quando definido pelo RH ao gerar a aplicação).
export async function lerAplicacaoRaciocinioPublica(idAplicacao) {
  return requisitar(`/raciocinio-logico-api/aplicacoes/${encodeURIComponent(idAplicacao)}`, { method: 'GET' });
}

export async function finalizarAplicacaoRaciocinioPublica(idAplicacao, payload) {
  return requisitar(`/raciocinio-logico-api/aplicacoes/${encodeURIComponent(idAplicacao)}/finalizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

// Candidato (rota pública) — modo adaptativo apenas: pede a próxima questão
// (dificuldade adjacente à última resposta dada) uma de cada vez. Não é
// usada quando a aplicação está em modo fixo (comportamento padrão).
export async function avancarRaciocinioAdaptativoPublico(idAplicacao, payload) {
  return requisitar(`/raciocinio-logico-api/aplicacoes/${encodeURIComponent(idAplicacao)}/proxima-adaptativa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}
