// Achado S-21: React/ReactDOM/htm vendorizados localmente (ver
// ../vendor/README.md) em vez de carregados de um CDN externo (esm.sh) a
// cada requisição — reduz uma dependência de disponibilidade de terceiros
// no caminho crítico de carregamento da aplicação.
import React, {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from '../vendor/react@18.3.1.mjs';
import { createRoot } from '../vendor/react-dom-client@18.3.1.mjs';
import htm from '../vendor/htm@3.1.1.mjs';

// Centraliza a infraestrutura React para manter imports curtos e consistentes.
const criarElementoReact = Object.assign(
  (tipo, propriedades, ...filhos) =>
    React.createElement(tipo, propriedades, ...filhos),
  {
    Fragment: React.Fragment,
  },
);
const html = htm.bind(criarElementoReact);

export {
  React,
  lazy,
  Suspense,
  createContext,
  createRoot,
  html,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
};
