import { ROTULOS_ETAPAS } from '../rotulos-etapas.js';
import { canonicalizeCandidateStatus } from './process-flow.js';

// Aceita nota em escala 0-10 ou 0-100 (a origem do dado varia por fluxo de
// prova) — normaliza para 0-10 só para decidir a cor da faixa, o valor
// exibido continua o original, sem conversão. Compartilhado entre
// Candidatos e Banco de Talentos (redesign 10/set/2026).
export function obterClasseFaixaNota(valor) {
  const numero = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(numero)) return 'is-neutral';
  const notaEmDez = numero > 10 ? numero / 10 : numero;
  if (notaEmDez >= 7) return 'is-high';
  if (notaEmDez >= 5) return 'is-mid';
  return 'is-low';
}

export function formatarTempoRestante(segundosTotais) {
  const total = Math.max(0, Number(segundosTotais || 0));
  const minutos = String(Math.floor(total / 60)).padStart(2, '0');
  const segundos = String(total % 60).padStart(2, '0');
  return `${minutos}:${segundos}`;
}

export function formatarNotaVisual(valor, casas = 1) {
  const numero = Number(valor || 0);
  if (!Number.isFinite(numero)) {
    return (0).toLocaleString('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
  }

  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function obterClasseEtapaResultado(percentual) {
  const percent = Number(percentual || 0);
  if (percent >= 0.7) return 'good';
  if (percent >= 0.4) return 'warn';
  return 'bad';
}

function normalizarComparacaoVisual(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function obterClasseStatusProcesso(status) {
  const valor = canonicalizeCandidateStatus(status);
  if (valor === 'Aprovado') return 'is-approved';
  if (valor === 'Qualificado') return 'is-highlight';
  if (valor === 'Pendente' || valor === 'Não respondeu') return 'is-analysis';
  if (valor === 'Agendado' || valor === 'Confirmado' || valor === 'Reagendado') return 'is-scheduled';
  if (valor.startsWith('Eliminado') || valor === 'Reprovado' || valor === 'Desistente' || valor === 'Cancelado') return 'is-eliminated';
  if (valor === 'Banco de Talentos') return 'is-talent';
  if (normalizarComparacaoVisual(valor) === 'nao qualificado') return 'is-not-qualified';
  return 'is-analysis';
}

export function obterClasseStatusEntrevista(status) {
  const valor = canonicalizeCandidateStatus(status);
  if (valor === 'Aprovado') return 'is-approved';
  if (valor === 'Banco de Talentos') return 'is-talent';
  if (valor === 'Compareceu') return 'is-approved';
  if (valor === 'Pendente' || valor === 'Não respondeu') return 'is-analysis';
  if (valor === 'Faltou' || valor === 'Eliminado' || valor === 'Desistente' || valor === 'Cancelado') return 'is-eliminated';
  if (valor === 'Agendado' || valor === 'Confirmado' || valor === 'Reagendado') return 'is-scheduled';
  if (valor === 'Qualificado') return 'is-highlight';
  if (normalizarComparacaoVisual(valor) === 'nao qualificado') return 'is-not-qualified';
  return 'is-analysis';
}

export function formatarDataHora(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor || '-');
  return data.toLocaleString('pt-BR');
}

export function formatarDataNascimento(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  const partes = texto.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!partes) return texto;
  const [, ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

export function montarDescricaoFluxo(blueprint) {
  if (!blueprint?.stages?.length) {
    return 'Selecione a vaga para visualizar a trilha.';
  }

  return blueprint.stages
    .map(
      (etapa) => `${ROTULOS_ETAPAS[etapa.key] || 'Etapa'} (${etapa.weight}%)`,
    )
    .join(' -> ');
}

export function obterClasseAderencia(recomendacao) {
  const texto = String(recomendacao || '')
    .trim()
    .toLowerCase();

  if (texto === 'forte aderencia' || texto === 'forte aderência') {
    return 'rh-aderencia-tag is-strong';
  }

  if (texto === 'boa aderencia' || texto === 'boa aderência') {
    return 'rh-aderencia-tag is-medium';
  }

  return 'rh-aderencia-tag is-low';
}

export function montarResumoAnaliticoCv(item) {
  const score = Number(item?.score_final || 0);
  const classificacao = String(item?.classificacao || '').trim() || '-';

  let payloadProblemas = {};
  try {
    payloadProblemas = JSON.parse(item?.problemas || '{}');
  } catch (error) {
    payloadProblemas = {};
  }

  const problemas = Array.isArray(payloadProblemas)
    ? payloadProblemas
    : Array.isArray(payloadProblemas.problemas)
      ? payloadProblemas.problemas
      : [];

  const pontosFortes = Array.isArray(payloadProblemas?.pontos_fortes)
    ? payloadProblemas.pontos_fortes
    : [];

  const educationStrength = payloadProblemas?.education_strength || '';
  const experienceStrength = payloadProblemas?.experience_strength || '';

  let palavras = [];
  try {
    const lidas = JSON.parse(item?.palavras_chave || '[]');
    palavras = Array.isArray(lidas) ? lidas : [];
  } catch (error) {
    palavras = [];
  }

  const partes = [
    `O candidato foi classificado como "${classificacao}" com score ${score}.`,
    palavras.length
      ? `O sistema encontrou aderencia por palavras-chave como ${palavras.join(', ')}.`
      : 'O sistema encontrou pouca aderencia por palavras-chave relevantes.',
  ];

  if (pontosFortes.length) {
    partes.push(`Pontos fortes identificados: ${pontosFortes.join(' ')}`);
  }

  if (problemas.length) {
    partes.push(`Pontos de atenção: ${problemas.join(' ')}`);
  } else {
    partes.push('Não foram identificados problemas críticos na leitura automática do currículo.');
  }

  if (educationStrength) {
    partes.push(`Análise de formação: ${educationStrength}.`);
  }

  if (experienceStrength) {
    partes.push(`Análise de experiência profissional: ${experienceStrength}.`);
  }

  if (score >= 7) {
    partes.push('Por isso, o currículo foi considerado com forte aderência ao processo.');
  } else if (score >= 4.5) {
    partes.push('Por isso, o currículo foi considerado razoavelmente aderente ao processo.');
  } else {
    partes.push('Por isso, o currículo foi considerado pouco aderente ao processo.');
  }

  return partes.join('\n\n');
}
