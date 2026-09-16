import axios from "axios";
import * as SecureStorage from "./secureStorage";

/**
 * Só existe ambiente local documentado no backend (ver plano em
 * .claude/plans — sem homologação/produção). EXPO_PUBLIC_API_URL é
 * obrigatório no .env do app (ver .env.example) e precisa ser o IP da
 * máquina que roda o backend na mesma rede Wi-Fi do celular físico —
 * "localhost"/"127.0.0.1" não funcionam a partir do Expo Go num device.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error(
    "EXPO_PUBLIC_API_URL não configurada. Defina no .env do app (ver .env.example) " +
      "com o IP da máquina que roda o backend, ex: http://192.168.25.50:8000",
  );
}

export const TOKEN_STORAGE_KEY = "conecta_app_access_token";

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStorage.getItemAsync(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

/** AuthContext se registra aqui para reagir a uma sessão expirada (401)
 * vinda de qualquer chamada — único ponto de tratamento (promt.txt §2). */
export function onUnauthorized(listener: UnauthorizedListener) {
  unauthorizedListener = listener;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      unauthorizedListener?.();
    }
    return Promise.reject(error);
  },
);
