import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStorage from "@/services/secureStorage";
import { TOKEN_STORAGE_KEY, onUnauthorized } from "@/services/api";
import { getMe, login as loginRequest, logout as logoutRequest, LoginError } from "@/services/authService";
import type { User } from "@/types/User";

interface AuthContextValue {
  user: User | null;
  /** Exposto só para montar headers de mídia autenticada (vídeo/imagem de módulo) — nunca logar/exibir. */
  token: string | null;
  isLoading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function restoreSession() {
      const storedToken = await SecureStorage.getItemAsync(TOKEN_STORAGE_KEY);
      if (!storedToken) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await getMe();
        setUser(me);
        setToken(storedToken);
      } catch {
        // Token expirado/inválido — limpa e volta para o login.
        await SecureStorage.deleteItemAsync(TOKEN_STORAGE_KEY);
        setUser(null);
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    }
    restoreSession();
  }, []);

  useEffect(() => {
    // Único ponto de tratamento de sessão expirada (401), qualquer chamada.
    onUnauthorized(() => {
      SecureStorage.deleteItemAsync(TOKEN_STORAGE_KEY);
      setUser(null);
      setToken(null);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      async signIn(email: string) {
        const response = await loginRequest(email);
        // Token só é salvo depois da resposta 200 confirmada (promt.txt §6.1).
        await SecureStorage.setItemAsync(TOKEN_STORAGE_KEY, response.access_token);
        const { access_token: accessToken, token_type: _tokenType, ...profile } = response;
        setUser(profile);
        setToken(accessToken);
      },
      async signOut() {
        await logoutRequest();
        await SecureStorage.deleteItemAsync(TOKEN_STORAGE_KEY);
        setUser(null);
        setToken(null);
      },
    }),
    [user, token, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth precisa estar dentro de um AuthProvider.");
  }
  return ctx;
}

export { LoginError };
