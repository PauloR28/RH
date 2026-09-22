import axios from "axios";
import { api } from "./api";
import type { LoginResponse, User } from "@/types/User";

export class LoginError extends Error {
  /** true = erro de rede (sem internet/servidor fora do ar); false = credencial inválida ou outro erro do servidor. */
  isNetworkError: boolean;

  constructor(message: string, isNetworkError: boolean) {
    super(message);
    this.isNetworkError = isNetworkError;
  }
}

/**
 * Correções.txt (rodada 16/set/2026): "esqueça a senha! Só será necessário
 * o e-mail do aluno" — payload exato de POST /auth/app/login-email
 * (AppEmailLoginRequest), ver apps/backend/rh_api/schemas/auth.py e
 * routers/auth.py (login_app_email). Restrito no backend aos perfis
 * operador/funcionario — quem não é elegível recebe 403.
 */
export async function login(email: string): Promise<LoginResponse> {
  try {
    const response = await api.post<LoginResponse>("/auth/app/login-email", { email });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (!error.response) {
        // DEBUG TEMPORÁRIO: detalhe real do erro de rede para diagnóstico.
        throw new LoginError(
          `[DEBUG] url=${error.config?.baseURL ?? "?"}${error.config?.url ?? "?"} code=${error.code ?? "?"} msg=${error.message}`,
          true,
        );
      }
      const message = (error.response.data as { message?: string } | undefined)?.message;
      throw new LoginError(message || "Não foi possível entrar com este e-mail.", false);
    }
    throw new LoginError("Não foi possível entrar. Tente novamente.", false);
  }
}

/** Usada para restaurar a sessão ao reabrir o app: valida o token salvo e
 * devolve o usuário atual (GET /auth/me — ver routers/auth.py:528-542). */
export async function getMe(): Promise<User> {
  const response = await api.get<User>("/auth/me");
  return response.data;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch {
    // Mesmo se a chamada falhar (ex: token já expirado), o app limpa a
    // sessão local de qualquer forma — ver AuthContext.
  }
}
