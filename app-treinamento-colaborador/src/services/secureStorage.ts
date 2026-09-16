import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * O app é Android-only (promt.txt §8, "fora de escopo: versão iOS" — web
 * nem é mencionado). `expo-secure-store` não tem suporte completo a web
 * nesta versão; este fallback existe só para permitir rodar `expo start
 * --web` durante o desenvolvimento (visualizar telas rapidamente sem
 * dispositivo físico) — no Android real, sempre usa SecureStore (nunca
 * AsyncStorage, token é dado sensível).
 */
const isWeb = Platform.OS === "web";

export async function getItemAsync(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // ignora em ambientes sem localStorage (ex: SSR)
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignora
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
