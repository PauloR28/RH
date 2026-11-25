// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Indicadores de Turnos e Plantões (25/11/2026): a operação CRF / Flamengo tinha a escala principal DESATIVADA e uma
 * escala nova ativa. A tela recebia a escala principal (primeira da lista), escondia o seletor (só 1 escala ativa) e
 * consultava a desativada: tudo zerado, "Não há dias de trabalho de escala publicada". Agora usa a primeira escala ativa.
 * Teste de tela SEM login (mesmo esquema de wfm-relatorios.spec.js).
 */

const CONTEXTO = {
  operacoes: [
    { chave: 'CRF', nome: 'CRF / Flamengo', escala_ativa: false },
    { chave: 'CRF::ESCALA-NOVA', nome: 'CRF / Flamengo · ESCALA 28/11/2026', tipo_escala: true },
  ],
};

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>harness</title>
<link href="/estilos/estilos.css" rel="stylesheet"><script src="/fonte/tema-inicial.js"></script></head>
<body style="margin:0"><div id="raiz"></div>
<script type="module">
const { html, createRoot } = await import('/fonte/infraestrutura-react.js');
const { TelaRelatorios } = await import('/fonte/modulos/operacao/wfm/relatorios.js');
createRoot(document.getElementById('raiz')).render(html\`<\${TelaRelatorios} contexto=\${${JSON.stringify(CONTEXTO)}} operacao="CRF" aoTrocarEscala=\${() => {}} showToast=\${() => {}} somentePainel=\${true} />\`);
</script></body></html>`;

test('Indicadores consultam a escala ATIVA quando a recebida está desativada', async ({ page }) => {
  const pedidas = [];
  await page.route('**/__wfm-indicadores', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGINA }));
  await page.route('**/wfm/relatorios?**', (r) => {
    pedidas.push(new URL(r.request().url()).searchParams.get('operacao'));
    r.fulfill({ status: 500, json: { detail: 'só o pedido interessa' } });
  });
  await page.goto('/__wfm-indicadores');
  await expect.poll(() => pedidas.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(new Set(pedidas)).toEqual(new Set(['CRF::ESCALA-NOVA']));
});
