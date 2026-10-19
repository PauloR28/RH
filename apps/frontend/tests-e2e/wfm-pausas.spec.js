// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Aba Pausas da escala (WFM): teste de tela SEM login. A página real (`pausas.js`) é montada numa rota fictícia
 * (`/__wfm-pausas`) servida pelo próprio teste, e a API do WFM é simulada com `page.route` — só os assets
 * estáticos vêm do servidor do Conecta (basta o backend estar de pé; não precisa de banco nem de sessão).
 */

const PADRAO = [{ ordem: 1, tipo: 'DESCANSO', duracao_min: 10 }, { ordem: 2, tipo: 'REFEICAO', duracao_min: 20 }, { ordem: 3, tipo: 'DESCANSO', duracao_min: 10 }];
const turnoM = { codigo: 'MANHA', entrada: '08:00', saida: '14:20', weekdays: [0, 1, 2, 3, 4], dias_rotulo: 'Seg a Sex' };
const operador = (id, nome) => ({ id_operador: id, nome, turno: turnoM, pausas: [], id_equipe: 1, equipe: 'Equipe Azul', cargo: 'Operador', supervisores: [{ id_usuario: 7, nome: 'Marina Souza' }], erros: [] });
const DIA = {
  data: '2026-10-15', capacidade: 2, pausas_padrao: PADRAO, excedentes: [], ocupacao: [],
  operadores: [operador(100, 'Ana Lima'), operador(101, 'Bruno Costa'), operador(102, 'Carla Dias')],
  sem_escala: [
    { id_operador: 200, nome: 'Iara Gomes', id_equipe: 1, equipe: 'Equipe Azul', supervisores: [], motivo: 'Hoje: sem turno (qui)' },
    { id_operador: 201, nome: 'João Pires', id_equipe: 1, equipe: 'Equipe Azul', supervisores: [], motivo: 'Sem turno cadastrado' },
  ],
};

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>harness</title>
<link href="/estilos/estilos.css" rel="stylesheet"><script src="/fonte/tema-inicial.js"></script></head>
<body><div id="raiz" style="display:flex;flex-direction:column;height:100vh;padding:16px;box-sizing:border-box"></div>
<script type="module">
const { html, createRoot } = await import('/fonte/infraestrutura-react.js');
const { TelaEscalaPausas } = await import('/fonte/modulos/operacao/wfm/pausas.js');
createRoot(document.getElementById('raiz')).render(html\`<\${TelaEscalaPausas} controlador=\${{ possuiPermissao: () => true }} operacao="OP" anoMes="2026-10"
  showToast=\${() => {}} aoDia=\${() => {}} aoMes=\${() => {}} aoVoltarLista=\${() => {}} aoMudarMes=\${() => {}} aoTrocarEscala=\${() => {}} opcoesEscala=\${[['OP', 'Operação teste']]} />\`);
</script></body></html>`;

test.describe('Aba Pausas da escala', () => {
  /** @type {any[]} */
  let aplicar;
  test.beforeEach(async ({ page }) => {
    aplicar = [];
    await page.route('**/__wfm-pausas', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGINA }));
    await page.route('**/wfm/pausas/aplicar', async (r) => { aplicar.push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ json: { success: true, pausas_gravadas: 3, dias_programados: 20, ignoradas: 0, mantidas: 0, capacidade: 2, dias_com_excesso: 0 } }); });
    await page.route('**/wfm/pausas?**', (r) => r.fulfill({ json: DIA }));
    await page.route('**/wfm/escala?**', (r) => r.fulfill({ json: { nome_escala: 'Operação teste', operadores: [], status: { versao_publicada: 1 } } }));
    await page.goto('/__wfm-pausas');
    await expect(page.getByRole('region', { name: 'Pausas do dia' })).toBeVisible({ timeout: 30_000 });
  });

  test('quem está sem escala aparece desativado, sem pausa e fora da seleção', async ({ page }) => {
    const linha = page.locator('tr.is-sem-escala', { hasText: 'Iara Gomes' });
    await expect(linha.getByRole('checkbox')).toBeDisabled();
    await expect(linha).toContainText('SEM ESCALA');
    await expect(linha).toContainText('Hoje: sem turno (qui)');
    await expect(linha).toContainText('Sem escala · sem pausa');
    await expect(page.locator('tr.is-sem-escala', { hasText: 'João Pires' })).toContainText('Sem turno cadastrado');
    await expect(linha.locator('input[type="time"]')).toHaveCount(0);
  });

  test('o select Quando só mostra os dias da semana em Personalizar', async ({ page }) => {
    const quando = page.getByLabel('Quando aplicar');
    await expect(quando).toHaveValue('escala');
    await expect(page.getByRole('group', { name: 'Dias da semana atingidos' })).toHaveCount(0);
    await quando.selectOption('personalizar');
    const dias = page.getByRole('group', { name: 'Dias da semana atingidos' });
    await expect(dias.getByRole('checkbox')).toHaveCount(7);
    await quando.selectOption('semana');
    await expect(dias).toHaveCount(0);
  });

  test('Aplicar ignora quem não tem escala', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Escolha quem recebe os horários' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Selecionar todos os colaboradores' }).check();
    const horarios = page.locator('.pa-linha-hora input');
    await horarios.nth(0).fill('09:00'); await horarios.nth(1).fill('10:30'); await horarios.nth(2).fill('12:00');
    const botao = page.getByRole('button', { name: 'Aplicar a 3 colaborador(es)' });
    await expect(botao).toBeEnabled();
    await botao.click();
    await expect.poll(() => aplicar.length).toBe(1);
    expect(aplicar[0].ids.sort()).toEqual([100, 101, 102]);
    expect(aplicar[0].ids).not.toContain(200);
    expect(aplicar[0].ids).not.toContain(201);
    expect(aplicar[0].dias_semana).toBeNull();
  });
});
