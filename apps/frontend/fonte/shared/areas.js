// Áreas do Conecta inativas na fase de teste (Suporte TI e Central de Treinamentos). A fonte da verdade é o backend
// (RH_AREAS_INATIVAS, devolvido em GET /core/acesso -> `areas_inativas`); o padrão abaixo vale até esse retorno chegar
// e quando o backend é antigo, para o menu nunca "piscar" com telas que não devem existir. Nada é apagado: reativar é
// só ajustar a variável no backend e reiniciar.

export const AREA_SUPORTE_TI = 'suporte_ti';
export const AREA_TREINAMENTOS = 'treinamentos';

let inativas = new Set([AREA_SUPORTE_TI, AREA_TREINAMENTOS]);

export function definirAreasInativas(lista) {
  if (Array.isArray(lista)) inativas = new Set(lista);
}

export const areaAtiva = (area) => !inativas.has(area);

// Tela -> área dona. `screen-training*` e `screen-chamados*` são prefixos (inclui criar/gerenciar/novo/detalhe).
export function areaDaTela(tela) {
  const t = String(tela || '');
  if (t.startsWith('screen-chamados')) return AREA_SUPORTE_TI;
  if (t.startsWith('screen-training')) return AREA_TREINAMENTOS;
  return '';
}

export const telaEmAreaInativa = (tela) => {
  const area = areaDaTela(tela);
  return Boolean(area) && !areaAtiva(area);
};
