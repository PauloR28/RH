// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * WFM: (1) editar o TIPO de um turno já publicado (com confirmação do impacto) e novos tipos Férias/Escalado;
 * (2) troca de folga na "Minha escala". Teste de tela sem login: a tela real é montada numa rota fictícia e a API é
 * simulada com `page.route` (mesmo esquema de wfm-escala-dias.spec.js).
 */

const HOJE = '2026-10-10';
const html = (corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>harness</title>
<link href="/estilos/estilos.css" rel="stylesheet"><script src="/fonte/tema-inicial.js"></script></head>
<body style="margin:0"><div id="raiz" style="min-height:100vh;padding:16px;box-sizing:border-box"></div>
<script type="module">
const { html, createRoot } = await import('/fonte/infraestrutura-react.js');
window.__toasts = [];
${corpo}
</script></body></html>`;

const PAGINA_TURNO = html(`
const { ModalTurno, turnoParaEdicao } = await import('/fonte/modulos/operacao/wfm/cadastros.js');
const turno = { id_turno: 10, codigo: 'M1', nome: 'Manhã', tipo: 'TRABALHO', cor: '#1f5fbf', entrada: '08:00', saida: '14:20', id_contrato: null, id_supervisor: null, pausas: [], weekdays: [0, 1, 2, 3, 4], ativo: true };
window.__salvo = null;
createRoot(document.getElementById('raiz')).render(html\`<\${ModalTurno} operacao="OP" inicial=\${turnoParaEdicao(turno)} contratos=\${[]} supervisores=\${[]} showToast=\${(m) => window.__toasts.push(m)} onClose=\${() => {}} onSalvo=\${() => { window.__salvo = true; }} />\`);`);

const PAGINA_MINHA = html(`
const { TelaMinhaEscala } = await import('/fonte/modulos/operacao/wfm/minha.js');
createRoot(document.getElementById('raiz')).render(html\`<\${TelaMinhaEscala} contexto=\${{ operacoes: [{ chave: 'OP', nome: 'Operação teste', escala_ativa: true }] }} showToast=\${(m) => window.__toasts.push(m)} podeTrocar=\${true} nomeUsuario="Ana Lima" />\`);`);

const dia = (data, codigo, tipo, extra = {}) => ({ id_operador: 1, data, id_turno: 1, codigo, tipo, trabalha: false, entrada: null, saida: null, minutos: 0, pausas: [], ...extra });
const ESCALA = {
  operacao: 'OP', nome_escala: 'Operação teste', troca_antecedencia_dias: 3, status: { versao_publicada: 1, fechada: false },
  turnos: [
    { codigo: 'M', nome: 'Manhã', cor: '#1f5fbf', tipo: 'TRABALHO' }, { codigo: 'FOLGA', nome: 'Folga', cor: '#94a3b8', tipo: 'FOLGA' },
    { codigo: 'FERIAS', nome: 'Férias', cor: '#15803d', tipo: 'FERIAS' }, { codigo: 'ESCALADO', nome: 'Escalado', cor: '#b45309', tipo: 'ESCALADO' },
  ],
  itens: [
    dia('2026-10-19', 'FOLGA', 'FOLGA'), dia('2026-10-20', 'FERIAS', 'FERIAS'), dia('2026-10-21', 'ESCALADO', 'ESCALADO'),
    dia('2026-10-22', 'M', 'TRABALHO', { trabalha: true, entrada: '08:00', saida: '14:00', minutos: 360 }),
  ],
  eventos: [], presencas: [],
};
const COLEGAS = [
  { id_usuario: 2, nome: 'Bia Souza', compativel: true, dias: { '2026-10-19': { codigo: 'M', entrada: '14:00', saida: '20:00' }, '2026-10-22': { codigo: 'M', entrada: '08:00', saida: '14:00' } }, folgas: { '2026-10-23': { codigo: 'FOLGA', tipo: 'FOLGA' } } },
];

test.describe('WFM · editar tipo do turno e tipos Férias/Escalado', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/__wfm-turno', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGINA_TURNO }));
    await page.goto('/__wfm-turno');
    await expect(page.getByRole('dialog', { name: 'Editar turno M1' })).toBeVisible({ timeout: 30_000 });
  });

  test('o tipo de um turno já criado pode ser alterado e há os tipos Férias e Escalado', async ({ page }) => {
    const tipo = page.getByLabel('Tipo').first();
    await expect(tipo).toBeEnabled();
    await expect(tipo.locator('option')).toHaveText(['Trabalho', 'Folga', 'DSR', 'Férias', 'Escalado']);
    await tipo.selectOption('ESCALADO');
    await expect(page.getByLabel('Entrada')).toHaveCount(0);                       // sem horário
    await expect(page.getByLabel('Jornada (opcional)')).toHaveCount(0);            // sem jornada
    await expect(page.getByText('Escalado não exige horário nem jornada')).toBeVisible();
    await tipo.selectOption('FERIAS');
    await expect(page.getByText('Férias não exigem horário nem jornada.')).toBeVisible();
  });

  test('mudar o tipo de um turno em uso pede confirmação do impacto antes de salvar', async ({ page }) => {
    let corpo = null;
    await page.route('**/wfm/turnos/10/impacto-tipo', (r) => r.fulfill({ json: { em_uso: true, operadores: 12, operadores_futuros: 12, dias_futuros: 80, dias_passados: 40, eventos_calendario: 0, trocas_em_andamento: 2, tipo_atual: 'TRABALHO', tipo_novo: 'FERIAS', aviso: 'A mudança vale para todos os dias já lançados com este turno.' } }));
    await page.route('**/wfm/turnos/10', (r) => { corpo = JSON.parse(r.request().postData() || '{}'); r.fulfill({ json: { success: true, id_turno: 10 } }); });
    await page.getByLabel('Tipo').first().selectOption('FERIAS');
    await page.getByRole('button', { name: 'Salvar turno' }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'afeta toda a escala' });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('12 colaborador(es)');
    await expect(aviso).toContainText('2 pedido(s) de troca em andamento serão invalidados');
    expect(corpo).toBeNull();                                                        // ainda não salvou
    await page.getByRole('button', { name: 'Confirmar e salvar turno' }).click();
    await expect.poll(() => corpo && corpo.tipo).toBe('FERIAS');
    expect(corpo.confirmar_mudanca_tipo).toBe(true);
    expect(corpo.entrada).toBe('');                                                  // Férias não leva horário
    // o painel não estoura a tela
    const sobra = await page.evaluate(() => { const el = document.querySelector('.wfm-pt'); return el ? el.scrollWidth - el.clientWidth : 0; });
    expect(sobra).toBeLessThanOrEqual(1);
  });

  test('turno que nunca foi usado muda de tipo sem pedir confirmação', async ({ page }) => {
    let corpo = null;
    await page.route('**/wfm/turnos/10/impacto-tipo', (r) => r.fulfill({ json: { em_uso: false, operadores: 0, dias_futuros: 0, dias_passados: 0, eventos_calendario: 0, trocas_em_andamento: 0, tipo_atual: 'TRABALHO', tipo_novo: 'FOLGA', aviso: '' } }));
    await page.route('**/wfm/turnos/10', (r) => { corpo = JSON.parse(r.request().postData() || '{}'); r.fulfill({ json: { success: true, id_turno: 10 } }); });
    await page.getByLabel('Tipo').first().selectOption('FOLGA');
    await page.getByRole('button', { name: 'Salvar turno' }).click();
    await expect.poll(() => corpo && corpo.tipo).toBe('FOLGA');
  });
});

test.describe('WFM · Minha escala · troca de folga', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(`${HOJE}T10:00:00`));
    await page.route('**/__wfm-minha', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGINA_MINHA }));
    await page.route('**/wfm/escala?**', (r) => r.fulfill({ json: new URL(r.request().url()).searchParams.get('ano_mes') === '2026-10' ? ESCALA : { ...ESCALA, itens: [], status: { versao_publicada: 0, fechada: false } } })); // só outubro tem escala
    await page.route('**/wfm/trocas/colegas?**', (r) => r.fulfill({ json: { itens: COLEGAS } }));
    await page.goto('/__wfm-minha');
    await expect(page.locator('.mc-grade')).toBeVisible({ timeout: 30_000 });
  });

  test('dia de folga futuro é clicável; férias e escalado são só informativos e cabem na célula', async ({ page }) => {
    const folga = page.locator('button.mc-dia', { hasText: '19' }).first();
    await expect(folga).toContainText('FOLGA');
    await expect(page.locator('.mc-dia', { hasText: 'FÉRIAS' })).toBeVisible();
    await expect(page.locator('button.mc-dia', { hasText: 'FÉRIAS' })).toHaveCount(0);
    await expect(page.locator('button.mc-dia', { hasText: 'ESCALADO' })).toHaveCount(0);
    // o rótulo não passa da célula
    for (const rotulo of ['FÉRIAS', 'ESCALADO', 'FOLGA']) {
      const sobra = await page.evaluate((r) => {
        const el = [...document.querySelectorAll('.mc-dsr')].find((e) => e.textContent === r);
        const cel = el && el.closest('.mc-dia');
        return el && cel ? el.getBoundingClientRect().right - cel.getBoundingClientRect().right : -1;
      }, rotulo);
      expect(sobra).toBeLessThanOrEqual(0);
    }
  });

  test('pedir a troca de uma folga: a pessoa assume o turno de um colega que trabalha no dia', async ({ page }) => {
    let corpo = null;
    await page.route('**/wfm/trocas', (r) => { corpo = JSON.parse(r.request().postData() || '{}'); r.fulfill({ json: { success: true, id_troca: 1 } }); });
    await page.locator('button.mc-dia', { hasText: '19' }).first().click();
    await expect(page.getByText('sua folga neste dia')).toBeVisible();
    await page.getByRole('button', { name: 'Pedir troca de folga', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Pedir troca de folga')).toBeVisible();
    await expect(modal.getByText('O dia inteiro')).toHaveCount(0);                  // folga só troca no mesmo dia
    await modal.getByText('Bia Souza').click();
    await expect(modal.getByText('Folga').first()).toBeVisible();
    await expect(modal.locator('.mc-resumo')).toContainText('14:00 – 20:00');
    await modal.getByLabel('Estou ciente').check();
    await modal.getByRole('button', { name: 'Enviar solicitação' }).click();
    await expect.poll(() => corpo && corpo.data_a).toBe('2026-10-19');
    expect(corpo.data_b).toBe('2026-10-19');
    expect(corpo.id_alvo).toBe(2);
  });

  test('quem trabalha também vê colegas de folga no mesmo dia', async ({ page }) => {
    await page.locator('button.mc-dia', { hasText: '22' }).first().click();
    await page.getByRole('button', { name: 'Pedir troca de plantão' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('O dia inteiro')).toBeVisible();
    await expect(modal.getByText('Bia Souza')).toBeVisible();
  });
});
