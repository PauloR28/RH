/**
 * Campos exatos do POST /auth/login (LoginResponse), confirmados lendo
 * apps/backend/rh_api/schemas/auth.py:37-50 — não é um contrato hipotético.
 */
export interface User {
  usuario: string;
  nome: string;
  sobrenome: string;
  cargo: string;
  email: string;
  perfil: string;
  perfil_nome: string;
  nivel: string;
  permissoes: string[];
  avatar_ilustrado: string;
  provedor_autenticacao: string;
}

export interface LoginResponse extends User {
  access_token: string;
  token_type: string;
}
