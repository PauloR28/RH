// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Escala mensal do WFM: atribuir um turno respeita os dias da semana dele (teste de tela sem login, mesmo esquema de
 * wfm-pausas.spec.js: a tela real é montada numa rota fictícia e a API é simulada com `page.route`).
 */

const DIAS = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']; // seg a dom
const turno = (id, codigo, weekdays, dias_rotulo) => ({ id_turno: id, codigo, nome: codigo, tipo: 'TRABALHO', cor: '#1f5fbf', entrada: '08:00', saida: '14:20', ativo: true, pausas: [], minutos: 380, weekdays, dias_rotulo });
const ESCALA = {
  operacao: 'OP', ano_mes: '2026-10', dias: DIAS, fonte: 'rascunho', nome_escala: 'Operação teste', pode_editar: true,
  status: { fechada: false, versao_publicada: 0 },
  aprovacao: { exige: false, estado: 'RASCUNHO' },
  operadores: [{ id_usuario: 1, nome: 'Ana Lima', id_equipe: 1, equipe: 'Equipe Azul', cargo: 'Operador', supervisores: [] }],
  itens: DIAS.map((data) => ({ id_operador: 1, data, id_turno: 10, versao_linha: 1, manual: false, entrada_ajuste: null, saida_ajuste: null })),
  turnos: [turno(10, 'MANHA', [0, 1, 2, 3, 4, 5, 6], 'Todos os dias'), turno(11, 'SAB', [5], 'Sáb')],
  eventos: [], personalizacoes: [], contratos: [],
};

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>harness</title>
<link href="/estilos/estilos.css" rel="stylesheet"><script src="/fonte/tema-inicial.js"></script></head>
<body style="margin:0"><div id="raiz" style="height:100vh;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;gap:10px"></div>
<script type="module">
const { html, createRoot } = await import('/fonte/infraestrutura-react.js');
const { TelaEscala } = await import('/fonte/modulos/operacao/wfm/escala.js');
window.__toasts = [];
createRoot(document.getElementById('raiz')).render(html\`<\${TelaEscala} controlador=\${{ possuiPermissao: () => true }} contexto=\${{ operacoes: [{ chave: 'OP', nome: 'Operação teste' }] }} operacao="OP" anoMes="2026-10"
  showToast=\${(m) => window.__toasts.push(m)} aoMudarMes=\${() => {}} aoTrocarEscala=\${() => {}} aoVoltarLista=\${() => {}} aoVoltarDia=\${() => {}} aoPausas=\${() => {}} />\`);
</script></body></html>`;

test.describe('Escala mensal · dias do turno', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/__wfm-escala', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGINA }));
    await page.route('**/wfm/escala?**', (r) => r.fulfill({ json: ESCALA }));
    await page.route('**/wfm/escala/validar?**', (r) => r.fulfill({ json: { violacoes: [], resumo: {} } }));
    await page.route('**/wfm/escala/versoes?**', (r) => r.fulfill({ json: { itens: [] } }));
    await page.goto('/__wfm-escala');
    await expect(page.getByRole('grid', { name: 'Escala do mês' })).toBeVisible({ timeout: 30_000 });
  });

  test('"Aplicar turno" só troca os dias da semana em que o turno vale', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Selecionar Ana Lima' }).check();
    await page.getByLabel('Turno a atribuir').selectOption({ label: 'SAB 08:00–14:20' });
    await page.getByRole('button', { name: 'Aplicar turno' }).click();
    // SAB vale só no sábado: apenas 1 dos 7 dias muda; os outros 6 ficam como estavam.
    await expect(page.getByText('1 alteração(ões) não salva(s)')).toBeVisible();
    const toast = await page.evaluate(() => window.__toasts.slice(-1)[0]);
    expect(toast).toContain('6 dia(s) fora dos dias do turno (Sáb) ficaram como estavam');
  });

  test('o padrão semanal já marca os dias do turno escolhido', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Selecionar Ana Lima' }).check();
    await page.getByRole('button', { name: 'Aplicar padrão semanal' }).click();
    const painel = page.locator('#mo-painel-padrao');
    await painel.getByRole('combobox').first().selectOption({ label: 'SAB 08:00–14:20' });
    await expect(painel.locator('.wfm-dias-btn')).toHaveText('Sáb');   // dias do turno SAB vêm marcados
  });
});
