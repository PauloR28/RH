import { useEffect, useState } from '../infraestrutura-react.js';
import { areaAtiva, AREA_SUPORTE_TI } from './areas.js';
import { listarNotificacoes } from '../services/api/notifications.js?v=20260927-estado-usuario';

// Bolinha vermelha do Suporte TI: quantas notificações NÃO LIDAS da categoria `chamados` o usuário tem.
// Uma única consulta compartilhada por todos os componentes (tile do início e item da navbar), renovada a cada minuto.
const INTERVALO_MS = 60 * 1000;
let contagem = 0;
let timer = null;
const ouvintes = new Set();

async function atualizar() {
  try {
    const lista = await listarNotificacoes(true);
    contagem = (Array.isArray(lista) ? lista : []).filter((n) => n.categoria === 'chamados').length;
  } catch (erro) {
    return; // mantém o último valor; a bolinha nunca derruba a tela
  }
  ouvintes.forEach((definir) => definir(contagem));
}

/** Força uma nova leitura (ex.: depois de abrir um chamado e marcar suas notificações como lidas). */
export const atualizarChamadosNaoLidos = () => atualizar();

export function useChamadosNaoLidos(controlador) {
  const [total, setTotal] = useState(contagem);
  const autenticado = Boolean(controlador?.estado?.autenticado);
  // Suporte TI inativo: sem consulta nem polling (a bolinha só existe com a área ligada).
  const permitido = areaAtiva(AREA_SUPORTE_TI) && Boolean(controlador?.possuiPermissao?.('notificacoes.visualizar'));
  useEffect(() => {
    if (!autenticado || !permitido) return undefined;
    ouvintes.add(setTotal);
    if (!timer) timer = setInterval(atualizar, INTERVALO_MS);
    atualizar();
    return () => {
      ouvintes.delete(setTotal);
      if (!ouvintes.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [autenticado, permitido]);
  return autenticado && permitido ? total : 0;
}
