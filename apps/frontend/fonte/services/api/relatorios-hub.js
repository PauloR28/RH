import { requisitarArquivo } from './core.js';

// Relatórios e Históricos: exportação unificada (XLSX, CSV, PDF). Os dados vêm das rotas de origem de cada relatório.
export const exportarRelatorioHub = (corpo) =>
  requisitarArquivo('/relatorios-hub/exportar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {}),
  });
