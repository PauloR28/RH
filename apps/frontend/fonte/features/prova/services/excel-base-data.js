let cachePromise = null;

export async function obterDadosBaseExcel() {
  if (!cachePromise) {
    cachePromise = Promise.all([
      import('../../../dados-excel/dados.js?v=20261126-painel-relatorios'),
      import('../../../dados-excel/mailing.js?v=20261126-painel-relatorios'),
    ]).then(([dadosModule, mailingModule]) => ({
      Dados: dadosModule.DADOS_EXCEL_BASE,
      Mailing: mailingModule.MAILING_EXCEL_BASE,
    }));
  }

  return cachePromise;
}
