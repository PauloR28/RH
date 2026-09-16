function normalizeCompareText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export const STATUS_CATALOG = [
  { id: 'processo_aberto', label: 'Aberto', categoria: 'processo', cor: 'success', icon: 'play_circle', ordem: 10, aliases: ['aberto', 'em andamento'] },
  { id: 'processo_pausado', label: 'Pausado', categoria: 'processo', cor: 'warning', icon: 'pause_circle', ordem: 20, aliases: ['pausa', 'pausado'] },
  { id: 'processo_cancelado', label: 'Cancelado', categoria: 'processo', cor: 'danger', icon: 'cancel', ordem: 90, aliases: ['cancelado', 'cancelada'] },
  { id: 'processo_encerrado', label: 'Encerrado', categoria: 'processo', cor: 'secondary', icon: 'lock', ordem: 100, aliases: ['encerrado', 'finalizado', 'fechado', 'arquivado', 'inativo'] },
  { id: 'analise', label: 'Em análise', categoria: 'candidato', cor: 'info', icon: 'search', ordem: 10, aliases: ['analise', 'em analise', 'finalizado'] },
  { id: 'qualificado', label: 'Qualificado', categoria: 'candidato', cor: 'primary', icon: 'person_check', ordem: 20, aliases: ['qualificado'] },
  { id: 'agendado', label: 'Agendado', categoria: 'entrevista', cor: 'primary', icon: 'event', ordem: 30, aliases: ['agendado', 'entrevista agendada'] },
  { id: 'aprovado', label: 'Aprovado', categoria: 'candidato', cor: 'success', icon: 'verified', ordem: 80, aliases: ['aprovado'] },
  { id: 'eliminado', label: 'Eliminado', categoria: 'candidato', cor: 'danger', icon: 'person_remove', ordem: 90, aliases: ['eliminado', 'reprovado'] },
  { id: 'banco_talentos', label: 'Banco de Talentos', categoria: 'candidato', cor: 'secondary', icon: 'group', ordem: 95, aliases: ['banco de talentos'] },
  { id: 'autenticacao', label: 'Autenticação', categoria: 'log', cor: 'secondary', icon: 'shield_person', ordem: 10, aliases: ['autenticacao', 'autenticação'] },
];

export function getStatusCatalogItem(value, categoria = '') {
  const normalized = normalizeCompareText(value);
  const safeCategory = normalizeCompareText(categoria);
  return STATUS_CATALOG.find((item) => {
    if (safeCategory && normalizeCompareText(item.categoria) !== safeCategory) return false;
    return item.aliases.some((alias) => normalizeCompareText(alias) === normalized);
  }) || null;
}

export function normalizeStatusLabel(value, categoria = '') {
  return getStatusCatalogItem(value, categoria)?.label || String(value || '').trim();
}
