// Estado dos módulos em tempo de execução: carrega GET /core/acesso uma vez por sessão e guarda o módulo atual.
// Falha ao carregar = `carregado: false` e o menu se comporta como antes da modularização (nada some por engano).

import { useEffect, useState } from '../infraestrutura-react.js?v=20261125-deploy';
import { lerSessaoAutenticacao } from '../services/api/core.js?v=20261125-deploy';
import { lerAcessoCore } from '../services/api/modulos.js?v=20261125-deploy';
import { definirAreasInativas } from '../shared/areas.js?v=20261125-deploy';
import { MODULO_CORE, definirFuncoesModulos, escolherModuloAtual, operacaoBaseDoModulo } from './registro.js?v=20261125-deploy';

const CHAVE_MODULO_ATUAL = 'conecta_modulo_atual';

const ESTADO_VAZIO = {
  carregado: false,
  carregando: false,
  erro: false,
  token: '',
  modulos: [],
  visiveis: [],
  moduloAtual: '',
  moduloPadrao: '',
  permissoes: [],
};

let estado = { ...ESTADO_VAZIO };
const ouvintes = new Set();

function publicar(parcial) {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((ouvinte) => ouvinte(estado));
}

// A escolha de módulo vale só para o login atual (guardada com o token, na aba): um novo login, do mesmo usuário ou de
// outro no mesmo navegador, começa no módulo padrão. Antes ficava no localStorage sem dono e passava de um usuário a outro.
function lerModuloSalvo(token) {
  try {
    window.localStorage.removeItem(CHAVE_MODULO_ATUAL); // valor antigo, sem dono
    const salvo = JSON.parse(window.sessionStorage.getItem(CHAVE_MODULO_ATUAL) || 'null');
    return salvo && salvo.token === token ? String(salvo.chave || '') : '';
  } catch {
    return '';
  }
}

function salvarModulo(chave) {
  try {
    window.sessionStorage.setItem(CHAVE_MODULO_ATUAL, JSON.stringify({ token: estado.token, chave }));
  } catch {
    /* sem armazenamento, vale o padrão */
  }
}

export function obterEstadoModulos() {
  // Estado de outro login (token diferente do atual) não vale: mesma regra de useModulos.
  return estado.token === lerSessaoAutenticacao().token ? estado : ESTADO_VAZIO;
}

export function assinarModulos(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function limparEstadoModulos() {
  definirFuncoesModulos(null);
  estado = { ...ESTADO_VAZIO };
  ouvintes.forEach((ouvinte) => ouvinte(estado));
}

export async function carregarAcessoModulos() {
  const { token } = lerSessaoAutenticacao();
  if (!token) {
    if (estado.token || estado.carregado) limparEstadoModulos();
    return;
  }
  if (estado.token === token && (estado.carregado || estado.carregando)) return;
  if (estado.token !== token) definirFuncoesModulos(null); // funções do menu do usuário anterior não valem mais
  publicar({ ...ESTADO_VAZIO, carregando: true, token });
  try {
    const acesso = await lerAcessoCore();
    if (lerSessaoAutenticacao().token !== token) return; // trocou de usuário no meio do caminho
    definirAreasInativas(acesso.areas_inativas);
    definirFuncoesModulos(acesso.funcoes);
    const visiveis = (acesso.modulos || []).filter((m) => m.visivel).map((m) => m.chave);
    const moduloAtual = escolherModuloAtual(visiveis, lerModuloSalvo(token), acesso.modulo_padrao);
    publicar({
      carregado: true,
      carregando: false,
      erro: false,
      modulos: acesso.modulos || [],
      visiveis,
      moduloPadrao: acesso.modulo_padrao || MODULO_CORE,
      moduloAtual,
      permissoes: acesso.permissoes || [],
    });
    // Guarda já o módulo de entrada: a camada de API manda ele ao servidor (X-Conecta-Modulo) desde o primeiro pedido.
    salvarModulo(moduloAtual);
  } catch {
    // Backend antigo (sem /core/acesso) ou indisponível: comportamento de antes.
    publicar({ ...ESTADO_VAZIO, erro: true, token });
  }
}

export function selecionarModulo(chave) {
  if (estado.token !== lerSessaoAutenticacao().token || !estado.visiveis.includes(chave)) return;
  salvarModulo(chave);
  publicar({ moduloAtual: chave });
}

/** Filtro de operação do WFM no módulo atual ('TI' em Tecnologia, '' nos demais). Lido pela camada de API do WFM. */
export function operacaoBaseAtiva() {
  const atual = obterEstadoModulos();
  return operacaoBaseDoModulo(atual.moduloAtual, atual.carregado);
}

/** Hook: devolve o estado dos módulos e dispara o carregamento quando há sessão.
 * O estado pertence a um token: depois de sair e entrar com outro usuário na mesma aba (sem recarregar), o estado do
 * usuário anterior (módulos, permissões efetivas) nunca é devolvido — volta vazio até o acesso do novo usuário chegar. */
export function useModulos() {
  const [valor, setValor] = useState(estado);
  useEffect(() => {
    const cancelar = assinarModulos(setValor);
    setValor(estado);
    return cancelar;
  }, []);
  // A cada render: troca de token (login/logout sem recarregar a página) recarrega ou limpa. Sem troca, não faz nada.
  useEffect(() => {
    carregarAcessoModulos();
  });
  const { token } = lerSessaoAutenticacao();
  if (valor.token !== token) return ESTADO_VAZIO;
  return valor;
}
