// "Abrir a tela X já filtrada por esta pessoa" (Painel do dia → Escala do mês, Presença, Trocas, Equipes).
// Guardado em window (não no módulo) para sobreviver a módulos carregados com ?v= diferentes. Vale uma vez, por 30 s.

const CHAVE = '__conectaFocoPessoa';

export function pedirFocoPessoa(destino, nome) {
  try { window[CHAVE] = { destino, nome: String(nome || ''), em: Date.now() }; } catch { /* sem window (teste) */ }
}

export function tomarFocoPessoa(destino) {
  try {
    const foco = window[CHAVE];
    if (!foco || foco.destino !== destino || Date.now() - foco.em > 30000) return '';
    window[CHAVE] = null;
    return foco.nome;
  } catch { return ''; }
}
