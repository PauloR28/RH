// Estado dos módulos em tempo de execução: carrega GET /core/acesso uma vez por sessão e guarda o módulo atual.
// Falha ao carregar = `carregado: false` e o menu se comporta como antes da modularização (nada some por engano).

import { useEffect, useState } from '../infraestrutura-react.js';
import { lerSessaoAutenticacao } from '../services/api/core.js';
import { lerAcessoCore } from '../services/api/modulos.js';
import { MODULO_CORE, escolherModuloAtual, operacaoBaseDoModulo } from './registro.js?v=20261004-chamados2';

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

function lerModuloSalvo() {
  try {
    return window.localStorage.getItem(CHAVE_MODULO_ATUAL) || '';
  } catch {
    return '';
  }
}

function salvarModulo(chave) {
  try {
    window.localStorage.setItem(CHAVE_MODULO_ATUAL, chave);
  } catch {
    /* preferência por usuário: sem armazenamento, vale o padrão */
  }
}

export function obterEstadoModulos() {
  return estado;
}

export function assinarModulos(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function limparEstadoModulos() {
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
  publicar({ ...ESTADO_VAZIO, carregando: true, token });
  try {
    const acesso = await lerAcessoCore();
    if (lerSessaoAutenticacao().token !== token) return; // trocou de usuário no meio do caminho
    const visiveis = (acesso.modulos || []).filter((m) => m.visivel).map((m) => m.chave);
    publicar({
      carregado: true,
      carregando: false,
      erro: false,
      modulos: acesso.modulos || [],
      visiveis,
      moduloPadrao: acesso.modulo_padrao || MODULO_CORE,
      moduloAtual: escolherModuloAtual(visiveis, lerModuloSalvo(), acesso.modulo_padrao),
      permissoes: acesso.permissoes || [],
    });
  } catch {
    // Backend antigo (sem /core/acesso) ou indisponível: comportamento de antes.
    publicar({ ...ESTADO_VAZIO, erro: true, token });
  }
}

export function selecionarModulo(chave) {
  if (!estado.visiveis.includes(chave)) return;
  salvarModulo(chave);
  publicar({ moduloAtual: chave });
}

/** Filtro de operação do WFM no módulo atual ('TI' em Tecnologia, '' nos demais). Lido pela camada de API do WFM. */
export function operacaoBaseAtiva() {
  return operacaoBaseDoModulo(estado.moduloAtual, estado.carregado);
}

/** Hook: devolve o estado dos módulos e dispara o carregamento quando há sessão. */
export function useModulos() {
  const [valor, setValor] = useState(estado);
  useEffect(() => {
    const cancelar = assinarModulos(setValor);
    setValor(estado);
    carregarAcessoModulos();
    return cancelar;
  }, []);
  return valor;
}
