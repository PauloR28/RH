// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Relatórios do WFM, aba Painel: teste de tela SEM login (mesmo esquema de wfm-pausas.spec.js — a tela real é montada numa
 * rota fictícia e a API é simulada com `page.route`). Confere os 6 indicadores, as duas fileiras sem rolagem da página e o
 * quadro flutuante "Como é calculado".
 */

const kpi = (chave, rotulo, valor, unidade = '') => ({ chave, rotulo, valor, anterior: null, variacao: null, unidade, melhor: 'neutra', dica: rotulo });
const PAINEL = {
  kpis: [kpi('horas_trabalhadas', 'Horas trabalhadas', 1234.5, 'h'), kpi('horas_escaladas', 'Horas escaladas', 1500, 'h'), kpi('absenteismo', 'Absenteísmo', 6.2, '%'),
    kpi('faltas', 'Faltas', 41), kpi('cobertura', 'Presenças apuradas', 92.1, '%'), kpi('trocas', 'Trocas aprovadas', 7)],
  totais: { dias_escalados: 900, trocas: 7, absenteismo: 6.2 }, anterior: { ini: '2026-08-31', fim: '2026-09-30' },
  graficos: {
    serie_diaria: Array.from({ length: 31 }, (_, i) => ({ data: `2026-10-${String(i + 1).padStart(2, '0')}`, rotulo: `${String(i + 1).padStart(2, '0')}/10`, escalados: 40, presentes: 36, faltas: 2, atestados: 1, sem: 1, horas: 100 })),
    presenca: [{ rotulo: 'Presente', valor: 700 }, { rotulo: 'Falta', valor: 41 }, { rotulo: 'Falta justificada', valor: 12 }, { rotulo: 'Atestado', valor: 20 }, { rotulo: 'Sem lançamento', valor: 127 }],
    top_operadores: Array.from({ length: 10 }, (_, i) => ({ operador: `Operador ${i + 1}`, trabalhadas: 160 - i * 10, escaladas: 171, faltas: i })),
    absenteismo_semana: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((rotulo, i) => ({ rotulo, valor: 4 + i, faltas: 3, apurados: 50 })),
    trocas_estado: [{ rotulo: 'Aprovada', valor: 7 }], horas_turno: [{ rotulo: 'MANHA', valor: 640 }],
    equipes: [{ rotulo: 'Equipe Azul', escalados: 400, faltas: 20, horas: 600, absenteismo: 5 }],
  },
};
const CALCULO = ['Horas trabalhadas = presenças + horas extras.', 'Somente dias com escala entram na conta.'];

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>harness</title>
<link href="/estilos/estilos.css" rel="stylesheet"><script src="/fonte/tema-inicial.js"></script></head>
<body style="margin:0"><div id="raiz" class="cx-pagina cx-pagina--modulo cx-escala-aberta" style="height:100vh;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;gap:10px"></div>
<script type="module">
const { html, createRoot } = await import('/fonte/infraestrutura-react.js');
const { TelaRelatorios } = await import('/fonte/modulos/operacao/wfm/relatorios.js');
createRoot(document.getElementById('raiz')).render(html\`<\${TelaRelatorios} contexto=\${{ operacoes: [{ chave: 'OP', nome: 'Operação teste', escala_ativa: true }] }} operacao="OP" aoTrocarEscala=\${() => {}} showToast=\${() => {}} />\`);
</script></body></html>`;

test.describe('Relatórios · Painel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/__wfm-relatorios', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGINA }));
    await page.route('**/wfm/relatorios?**', (r) => r.fulfill({ json: { tipo: 'painel', colunas: [], linhas: [], resumo: [], painel: PAINEL, calculo: CALCULO, gerado_em: new Date().toISOString(), operadores: [{ id_usuario: 1, nome: 'Ana Lima' }] } }));
    await page.goto('/__wfm-relatorios');
    await expect(page.getByText('Escalados × presentes por dia')).toBeVisible({ timeout: 30_000 });
  });

  test('mostra os 6 indicadores e as abas de nível 2', async ({ page }) => {
    for (const rotulo of ['Horas trabalhadas', 'Horas escaladas', 'Absenteísmo', 'Faltas', 'Presenças apuradas', 'Trocas aprovadas']) {
      await expect(page.locator('.wfm-p-kpis .wfm-rel-kpi', { hasText: rotulo })).toBeVisible();
    }
    await expect(page.locator('.wfm-p-kpis .wfm-rel-kpi').first()).toContainText('sem base de comparação');
    const abas = page.getByRole('tablist', { name: 'Relatórios' }).getByRole('tab');
    await expect(abas).toHaveText(['Painel', 'Resumo', 'Escalas', 'Presenças', 'Trocas', 'Aprovações']);
    await expect(abas.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('cabe em 1440×900 sem rolar a página, com as duas fileiras de gráficos', async ({ page }) => {
    const sobra = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(sobra).toBeLessThanOrEqual(0);
    const f1 = await page.locator('.wfm-p-fileira--1').boundingBox();
    expect(Math.round(f1?.height || 0)).toBe(196);
    await expect(page.locator('.wfm-p-fileira--1 > .wfm-g-cartao')).toHaveCount(3);
    await expect(page.locator('.wfm-p-fileira--2 > *')).toHaveCount(3);
    await expect(page.getByText('Comparação entre equipes')).toBeVisible();
  });

  test('"Como é calculado" abre num quadro flutuante de 430 px e fecha com Esc', async ({ page }) => {
    await expect(page.locator('.wfm-rel-calculo')).toHaveCount(0);
    await page.getByRole('button', { name: 'Como é calculado' }).click();
    const quadro = page.getByRole('dialog', { name: 'Como é calculado' });
    await expect(quadro).toBeVisible();
    await expect(quadro).toContainText('Somente dias com escala entram na conta.');
    expect(Math.round((await quadro.boundingBox())?.width || 0)).toBe(430);
    await page.keyboard.press('Escape');
    await expect(quadro).toHaveCount(0);
  });
});
