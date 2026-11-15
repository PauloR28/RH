import { useEffect, useState } from '../../infraestrutura-react.js';

// Contagens das abas da sub-barra (ex.: "Presença 3", "Escalas 2"). A tela que conhece o
// número publica aqui; a moldura só desenha. Chave = id da tela (screen-*). 0 ou vazio = sem selo.
let selos = {};
const ouvintes = new Set();

export function definirSelos(novos) {
  const proximo = { ...selos, ...novos };
  if (Object.keys(proximo).every((k) => proximo[k] === selos[k])) return;
  selos = proximo;
  ouvintes.forEach((fn) => fn(selos));
}

export function useSelosSubbarra() {
  const [atual, setAtual] = useState(selos);
  useEffect(() => {
    ouvintes.add(setAtual);
    setAtual(selos);
    return () => ouvintes.delete(setAtual);
  }, []);
  return atual;
}
