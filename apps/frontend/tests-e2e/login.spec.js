// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Smoke test da tela de login — o único fluxo que NÃO depende de
 * autenticação, então roda de ponta a ponta em qualquer ambiente
 * (local, CI). Ver tests-e2e/README.md para o restante da suíte.
 */
test.describe('Tela de login', () => {
  test('carrega com título correto e botão de SSO Microsoft visível', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Central 24h');

    // O app é um SPA sem bundler: o primeiro carregamento busca dezenas de
    // módulos ESM individualmente (ver fonte/principal.js), o que pode levar
    // bem mais que os 5s padrão em uma máquina fria. Damos uma margem maior
    // só para esta primeira renderização.
    const telaLogin = page.locator('#screen-login');
    await expect(telaLogin).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible();

    const botaoMicrosoft = page.locator('a.rh-login-microsoft-btn');
    await expect(botaoMicrosoft).toBeVisible();
    await expect(botaoMicrosoft).toHaveAttribute('href', '/auth/microsoft/login');
    await expect(botaoMicrosoft).toContainText('Entrar com a Microsoft');
  });

  test('não expõe formulário de login local antes de uma tentativa Microsoft falhar', async ({
    page,
  }) => {
    await page.goto('/');

    // O fallback de login local só aparece depois que o fluxo Microsoft é
    // tentado e falha (ver TelaLogin em fonte/features/gestao/index.js).
    // No carregamento inicial, não deve haver campos de usuário/senha.
    await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);
    await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);
  });

  test('endpoint do botão da Microsoft responde com um redirecionamento (OAuth)', async ({
    page,
  }) => {
    await page.goto('/');

    // Não navegamos de fato para login.microsoftonline.com (domínio externo,
    // fora do nosso controle, exigiria credenciais reais do Azure AD que não
    // existem neste ambiente de teste). Só confirmamos, via requisição HTTP
    // direta, que o backend responde ao href do botão com um redirect:
    //   - para "login.microsoftonline.com/..." quando as credenciais
    //     MICROSOFT_CLIENT_ID/MICROSOFT_TENANT_ID/MICROSOFT_CLIENT_SECRET
    //     estão configuradas (produção/homologação real); ou
    //   - de volta para "/login?microsoft=complete" com uma mensagem
    //     amigável quando não estão (caso deste ambiente de desenvolvimento/
    //     CI, ver rh_api/routers/auth.py:microsoft_login).
    // Ambos os casos confirmam que a rota existe e responde corretamente.
    const response = await page.request.get('/auth/microsoft/login', {
      maxRedirects: 0,
    });
    expect([302, 303, 307]).toContain(response.status());
    const location = response.headers()['location'] || '';
    expect(
      location.includes('login.microsoftonline.com') || location.includes('/login'),
    ).toBe(true);
  });
});
