import { lerContextoWfm, lerRelatorioWfm, listarHistoricoWfm } from '../../services/api/wfm.js?v=20261020-dias';
import { lerContextoMonitoria, lerRelatorio as lerRelatorioMonitoria, listarLogsMonitoria } from '../../services/api/monitoria.js';
import { lerAnalisesCandidatos, lerRelatorioCandidatos, lerRelatorioProcessos } from '../../services/api/analytics.js';
import { lerHistoricoPaginado } from '../../services/api/history.js';
import { listarLogsAuditoria } from '../../services/api/settings.js';
export { TELA_ANTIGA_PARA_RELATORIO } from '../../shared/relatorios-hub.js';

// Relatórios e Históricos — registro de relatórios. Cada item descreve: onde aparece (área), qual permissão o liga ao perfil
// (`relhub.*`, conferida também no servidor), quais filtros unificados valem e como carregar os dados como PLANILHA
// ({ colunas: [{ chave, rotulo, tipo }], linhas: [{ [chave]: valor }] }). Telas com gráficos (painéis/dashboards) ficam como
// "tela" e continuam existindo no lugar de origem.

export const AREAS = [
  { id: 'wfm', rotulo: 'Turnos e Plantões', icone: 'calendar_month' },
  { id: 'monitoria', rotulo: 'Monitoria', icone: 'fact_check' },
  { id: 'rh', rotulo: 'RH', icone: 'badge' },
  { id: 'sistema', rotulo: 'Sistema', icone: 'shield' },
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const PERIODOS = {
  mes: { rotulo: 'Mês atual', calc: () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(new Date(h.getFullYear(), h.getMonth() + 1, 0))]; } },
  anterior: { rotulo: 'Mês anterior', calc: () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]; } },
  trinta: { rotulo: 'Últimos 30 dias', calc: () => { const h = new Date(); const i = new Date(h); i.setDate(i.getDate() - 29); return [iso(i), iso(h)]; } },
  ano: { rotulo: 'Ano atual', calc: () => { const h = new Date(); return [`${h.getFullYear()}-01-01`, `${h.getFullYear()}-12-31`]; } },
};

const LIMITE_LINHAS = 5000;
const col = (chave, rotulo, tipo = 'texto') => ({ chave, rotulo, tipo });
const dataBr = (valor) => {
  const t = String(valor || '');
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : t;
};
const dentroDoPeriodo = (valor, ini, fim) => {
  const dia = String(valor || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return true;
  return (!ini || dia >= ini) && (!fim || dia <= fim);
};

// Relatórios da Monitoria devolvem { colunas: [texto], linhas: [[valor]] }: vira o mesmo formato das demais planilhas.
function deMatriz(r) {
  const colunas = (r?.colunas || []).map((rotulo, i) => col(`c${i}`, String(rotulo)));
  const linhas = (r?.linhas || []).map((l) => Object.fromEntries(colunas.map((c, i) => [c.chave, l[i] ?? ''])));
  colunas.forEach((c) => { if (linhas.length && linhas.every((l) => l[c.chave] === '' || (l[c.chave] !== null && l[c.chave] !== true && l[c.chave] !== false && !Number.isNaN(Number(String(l[c.chave]).replace(',', '.'))) && String(l[c.chave]).trim() !== ''))) c.tipo = 'numero'; });
  return { colunas, linhas };
}

// Lê todas as páginas (com teto) de uma listagem paginada.
async function lerTudo(proxima) {
  const linhas = [];
  let pagina = 1;
  for (;;) {
    const { itens, total } = await proxima(pagina);
    linhas.push(...itens);
    if (!itens.length || linhas.length >= (total ?? Infinity) || linhas.length >= LIMITE_LINHAS) break;
    pagina += 1;
  }
  return { linhas: linhas.slice(0, LIMITE_LINHAS), truncado: linhas.length >= LIMITE_LINHAS };
}

// ------------------------------------------------------------------ contextos (opções do filtro de operação)
export async function carregarOperacoes(area) {
  if (area === 'wfm') {
    const ctx = await lerContextoWfm();
    return (ctx?.operacoes || []).map((o) => [o.chave, `${o.nome}${o.escala_ativa === false ? ' (inativa)' : ''}`]);
  }
  if (area === 'monitoria') {
    const ctx = await lerContextoMonitoria();
    return (ctx?.operacoes || []).map((o) => [o.chave, o.nome]);
  }
  return [];
}

const SO_WFM_RELATORIO = (tipo, rotulo, descricao, totais = false) => ({
  id: `wfm.${tipo}`, area: 'wfm', rotulo, descricao, permissao: `relhub.wfm.${tipo}`,
  filtros: ['periodo', 'operacao', 'operador', 'busca'], totais,
  // Sem escala escolhida = todas as escalas a que a pessoa tem acesso (uma troca ou presença nunca "some" por estar noutra escala).
  async carregar(f) {
    const consulta = (operacao) => lerRelatorioWfm({ operacao, data_ini: f.ini, data_fim: f.fim, id_operador: f.operador || undefined, tipo });
    if (f.operacao) {
      const r = await consulta(f.operacao);
      return { colunas: r.colunas || [], linhas: r.linhas || [], resumo: r.resumo || [], operadores: (r.operadores || []).map((o) => [String(o.id_usuario), o.nome]) };
    }
    // Relatório é histórico: inclui também as escalas inativas (uma troca antiga não pode sumir por a escala ter sido desativada).
    const escalas = (await lerContextoWfm())?.operacoes || [];
    const respostas = (await Promise.all(escalas.map((o) => consulta(o.chave).then((r) => ({ ...r, escala: o.nome }), () => null)))).filter(Boolean);
    if (!respostas.length) throw new Error('Não foi possível carregar os relatórios das escalas.');
    const colunas = [col('_escala', 'Escala'), ...(respostas[0].colunas || [])];
    const linhas = respostas.flatMap((r) => (r.linhas || []).map((l) => ({ _escala: r.escala, ...l })));
    const operadores = [...new Map(respostas.flatMap((r) => (r.operadores || []).map((o) => [String(o.id_usuario), o.nome]))).entries()];
    return { colunas, linhas, operadores };
  },
});

export const RELATORIOS = [
  // ---- Turnos e Plantões
  { id: 'wfm.painel', area: 'wfm', rotulo: 'Painel', descricao: 'Indicadores, comparações e gráficos do período (também na aba Painel do WFM).', permissao: 'relhub.wfm.painel', filtros: ['periodo', 'operacao'], operacaoObrigatoria: true, tela: 'painel-wfm' },
  SO_WFM_RELATORIO('resumo', 'Resumo por operador', 'Horas, presença e faltas por operador.', true),
  SO_WFM_RELATORIO('escalas', 'Escalas', 'Versões publicadas e quem aprovou.'),
  SO_WFM_RELATORIO('presencas', 'Presenças', 'Presença e falta dia a dia (histórico de presenças).', true),
  SO_WFM_RELATORIO('trocas', 'Trocas de plantão', 'Pedidos, aprovações e reprovações (histórico de trocas).'),
  SO_WFM_RELATORIO('aprovacoes', 'Aprovações de escala', 'Envio, aprovação, declínio e publicação.'),
  {
    id: 'wfm.historico', area: 'wfm', rotulo: 'Histórico', descricao: 'Quem fez o quê, quando, e o valor antes e depois (auditoria de Turnos e Plantões).',
    permissao: 'relhub.wfm.historico', filtros: ['periodo', 'operacao', 'operador', 'supervisor', 'busca'],
    async carregar(f) {
      // Histórico do WFM pagina por cursor (não por número de página).
      const linhas = [];
      let cursor = '';
      let truncado = false;
      for (;;) {
        const r = await listarHistoricoWfm({ texto: f.busca || '', operacao: f.operacao || '', data_ini: f.ini, data_fim: f.fim, limite: 200, ...(cursor ? { cursor } : {}) });
        linhas.push(...(r.itens || []));
        cursor = r.proximo_cursor || '';
        if (!r.tem_mais || !cursor) break;
        if (linhas.length >= LIMITE_LINHAS) { truncado = true; break; }
      }
      return {
        colunas: [col('data', 'Data'), col('hora_inicio', 'Hora início'), col('hora_fim', 'Hora final'), col('operador', 'Operador'), col('perfil', 'Perfil'), col('supervisor', 'Supervisor'), col('acao_nome', 'Ação'), col('entidade', 'Entidade'), col('entidade_id', 'ID'), col('antes_texto', 'Antes'), col('depois_texto', 'Depois'), col('justificativa', 'Justificativa'), col('registrado_em', 'Registrado em')],
        linhas, aviso: truncado ? `Mostrando os primeiros ${LIMITE_LINHAS} registros; reduza o período para ver o restante.` : '',
      };
    },
  },
  // ---- Monitoria
  ...[
    ['historico', 'monitorias', 'Histórico de monitorias', 'Monitorias realizadas (também em Monitoria > Histórico).'],
    ['qualidade', 'qualidade', 'Qualidade', 'Indicadores de qualidade por operação, equipe e operador.'],
    ['planos', 'planos', 'Planos de ação', 'Planos de ação abertos a partir das monitorias.'],
  ].map(([sufixo, tipo, rotulo, descricao]) => ({
    id: `monitoria.${sufixo}`, area: 'monitoria', rotulo, descricao, permissao: `relhub.monitoria.${sufixo}`,
    filtros: ['periodo', 'operacao', 'equipe', 'supervisor', 'operador', 'busca'],
    async carregar(f) { return deMatriz(await lerRelatorioMonitoria(tipo, { operacao: f.operacao || '', data_inicio: f.ini, data_fim: f.fim })); },
  })),
  { id: 'monitoria.dashboard', area: 'monitoria', rotulo: 'Dashboard', descricao: 'Indicadores e gráficos da Monitoria (também em Monitoria > Dashboard).', permissao: 'relhub.monitoria.dashboard', filtros: [], tela: 'dashboard-monitoria' },
  {
    id: 'monitoria.logs', area: 'monitoria', rotulo: 'Logs da Monitoria', descricao: 'Trilha de auditoria da Monitoria (escopo das suas operações).',
    permissao: 'relhub.monitoria.logs', filtros: ['periodo', 'operacao', 'busca'],
    async carregar(f) {
      const { linhas, truncado } = await lerTudo(async (pagina) => {
        const r = await listarLogsMonitoria({ operacao: f.operacao || '', usuario: f.busca || '', data_inicio: f.ini, data_fim: f.fim, pagina, por_pagina: 500 });
        return { itens: r.itens || [], total: r.total };
      });
      return {
        colunas: [col('em', 'Data/hora'), col('usuario', 'Usuário'), col('perfil', 'Perfil'), col('operacao', 'Operação'), col('acao', 'Ação'), col('entidade', 'Entidade'), col('entidade_id', 'ID'), col('resultado', 'Resultado'), col('detalhes', 'Detalhes'), col('estado_anterior', 'Antes'), col('estado_posterior', 'Depois'), col('ip', 'IP')],
        linhas: linhas.map((l) => ({ ...l, em: dataBr(l.em) })), aviso: truncado ? `Mostrando os primeiros ${LIMITE_LINHAS} registros; reduza o período para ver o restante.` : '',
      };
    },
  },
  // ---- RH (Relatórios Gerais reconstruídos como planilhas)
  ...(() => {
    const filtrosRh = ['periodo', 'operacao', 'status', 'busca'];
    // O filtro de operação do RH vem do processo: candidatos e ranking herdam a operação pelo ID do processo.
    const operacaoDosProcessos = async (f) => {
      const procs = await lerRelatorioProcessos({ dataInicial: f.ini, dataFinal: f.fim });
      return Array.isArray(procs) ? procs : [];
    };
    return [
      {
        id: 'rh.processos', area: 'rh', origem: 'screen-analysis-candidates', rotulo: 'Processos seletivos', descricao: 'Processos abertos no período, vagas, aprovados e eliminados.', permissao: 'relhub.rh.processos', filtros: filtrosRh,
        async carregar(f) {
          const { COLUNAS_RELATORIO_PROCESSOS, montarLinhaProcessoRelatorio } = await import('../gestao/index.js?v=20261026-ajustes');
          const procs = await operacaoDosProcessos(f);
          const operacoes = [...new Set(procs.map((p) => p.operacao).filter(Boolean))].sort().map((o) => [o, o]);
          const linhas = procs.filter((p) => !f.operacao || p.operacao === f.operacao).map((p) => ({ ...montarLinhaProcessoRelatorio(p), operacao_relatorio: p.operacao || '' }));
          return { colunas: [...COLUNAS_RELATORIO_PROCESSOS.map((c) => col(c.key, c.label)), col('operacao_relatorio', 'Operação')], linhas, operacoes };
        },
      },
      {
        id: 'rh.candidatos', area: 'rh', origem: 'screen-analysis-candidates', rotulo: 'Candidatos', descricao: 'Candidatos por processo, notas, aprovação e eliminação.', permissao: 'relhub.rh.candidatos', filtros: filtrosRh,
        async carregar(f) {
          const { COLUNAS_RELATORIO_CANDIDATOS } = await import('../gestao/index.js?v=20261026-ajustes');
          const [procs, cands] = await Promise.all([operacaoDosProcessos(f), lerRelatorioCandidatos({ dataInicial: f.ini, dataFinal: f.fim })]);
          const opPorProcesso = new Map(procs.flatMap((p) => [[p.id_processo, p.operacao], [p.nome_relatorio_processo, p.operacao]].filter(([k]) => k)));
          const operacoes = [...new Set(procs.map((p) => p.operacao).filter(Boolean))].sort().map((o) => [o, o]);
          const linhas = (Array.isArray(cands) ? cands : []).map((c) => ({ ...c, operacao_relatorio: opPorProcesso.get(c.id_processo) || opPorProcesso.get(c.id_processo_ref) || '' })).filter((c) => !f.operacao || c.operacao_relatorio === f.operacao);
          return { colunas: [...COLUNAS_RELATORIO_CANDIDATOS.map((c) => col(c.key, c.label)), col('operacao_relatorio', 'Operação')], linhas, operacoes };
        },
      },
      {
        id: 'rh.ranking', area: 'rh', origem: 'screen-analysis-candidates', rotulo: 'Ranking analítico', descricao: 'Nota final, afinidade e recomendação por candidato.', permissao: 'relhub.rh.ranking', filtros: filtrosRh,
        async carregar(f) {
          const { COLUNAS_RANKING_ANALITICO, montarLinhaRankingRelatorio } = await import('../gestao/index.js?v=20261026-ajustes');
          const [procs, analises] = await Promise.all([operacaoDosProcessos(f), lerAnalisesCandidatos()]);
          const opPorProcesso = new Map(procs.flatMap((p) => [[p.id_processo, p.operacao], [p.nome_relatorio_processo, p.operacao]].filter(([k]) => k)));
          const operacoes = [...new Set(procs.map((p) => p.operacao).filter(Boolean))].sort().map((o) => [o, o]);
          const linhas = (Array.isArray(analises) ? analises : []).map((l) => ({ ...montarLinhaRankingRelatorio(l), operacao_relatorio: opPorProcesso.get(l.id_processo) || '' })).filter((l) => !f.operacao || l.operacao_relatorio === f.operacao);
          return { colunas: [...COLUNAS_RANKING_ANALITICO.map((c) => col(c.key, c.label)), col('operacao_relatorio', 'Operação')], linhas, operacoes };
        },
      },
      { id: 'rh.funil', area: 'rh', origem: 'screen-dashboard-funil', rotulo: 'Dashboard de funil', descricao: 'Funil de recrutamento por etapa (também em Gestão > Dashboard de Funil).', permissao: 'relhub.rh.funil', filtros: [], tela: 'atalho', destino: 'screen-dashboard-funil' },
      {
        id: 'rh.exames', area: 'rh', origem: 'screen-history', rotulo: 'Histórico de exames', descricao: 'Provas aplicadas, pontuação e status (também em Processos > Histórico de exames).', permissao: 'relhub.rh.exames', filtros: ['periodo', 'busca'],
        async carregar(f) {
          const { linhas, truncado } = await lerTudo(async (pagina) => {
            const r = await lerHistoricoPaginado({ pagina, tamanho: 100, nome: f.busca || '' });
            return { itens: r.items || [], total: r.total_items ?? r.total };
          });
          return {
            colunas: [col('id_teste', 'ID'), col('id_processo', 'Processo'), col('nome_candidato', 'Candidato'), col('vaga', 'Vaga'), col('nivel', 'Nível'), col('trilha', 'Trilha'), col('data_exibicao', 'Data'), col('pontuacao_final', 'Pontuação', 'numero'), col('status', 'Status'), col('tempo_minutos', 'Tempo (min)', 'numero')],
            linhas: linhas.filter((l) => dentroDoPeriodo(l.data_iso, f.ini, f.fim)), aviso: truncado ? `Mostrando os primeiros ${LIMITE_LINHAS} registros.` : '',
          };
        },
      },
    ];
  })(),
  // ---- Sistema
  {
    id: 'sistema.logs', area: 'sistema', rotulo: 'Logs de auditoria', descricao: 'Trilha de auditoria do sistema (também em Configurações > Logs).', permissao: 'relhub.sistema.logs', filtros: ['periodo', 'busca'],
    async carregar(f) {
      const r = await listarLogsAuditoria({ limit: 500, usuario: f.busca || '' });
      const linhas = (Array.isArray(r) ? r : r?.itens || []).filter((l) => dentroDoPeriodo(l.data_hora, f.ini, f.fim)).map((l) => ({ ...l, data_hora: dataBr(l.data_hora), sucesso: l.sucesso === false || l.sucesso === 0 ? 'Não' : 'Sim' }));
      return {
        colunas: [col('data_hora', 'Data/hora'), col('nome_usuario', 'Usuário'), col('email_usuario', 'E-mail'), col('perfil_nome', 'Perfil'), col('modulo', 'Módulo'), col('acao', 'Ação'), col('entidade', 'Entidade'), col('entidade_id', 'ID'), col('justificativa', 'Justificativa'), col('origem', 'Origem'), col('sucesso', 'Sucesso')],
        linhas, aviso: 'Mostrando os 500 registros mais recentes.',
      };
    },
  },
];

// Permissão de base de cada relatório (a que a rota de origem exige no servidor): a página só mostra o relatório se o perfil
// tem a chave `relhub.*` E a de base, para nunca listar algo que a origem recusaria.
export const PERMISSAO_BASE = {
  'wfm.painel': 'wfm.relatorios', 'wfm.resumo': 'wfm.relatorios', 'wfm.escalas': 'wfm.relatorios', 'wfm.presencas': 'wfm.relatorios',
  'wfm.trocas': 'wfm.relatorios', 'wfm.aprovacoes': 'wfm.relatorios', 'wfm.historico': 'wfm.auditoria',
  'monitoria.historico': 'monitoria.relatorios', 'monitoria.qualidade': 'monitoria.relatorios', 'monitoria.planos': 'monitoria.relatorios',
  'monitoria.dashboard': 'monitoria.dashboard', 'monitoria.logs': 'monitoria.logs',
  'rh.processos': 'relatorios.visualizar', 'rh.candidatos': 'relatorios.visualizar', 'rh.ranking': 'relatorios.visualizar',
  'rh.funil': 'relatorios.visualizar', 'rh.exames': 'candidatos.consultar_historico', 'sistema.logs': 'logs.visualizar',
};
