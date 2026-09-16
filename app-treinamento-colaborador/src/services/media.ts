const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

/** As URLs de imagem de seção já vêm relativas (`/onboarding/secoes-imagens/...`)
 * ou como link externo completo digitado pelo RH — nunca inventar formato. */
export function resolveMediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** GET /onboarding/itens/{id}/video — ver routers/onboarding.py. */
export function moduleVideoUrl(trilhaItemId: number): string {
  return `${API_URL}/onboarding/itens/${trilhaItemId}/video`;
}

/** Mesma convenção do web (apps/frontend/fonte/shared/avatares.js): asset
 * estático público, sem autenticação — /estilos é servido pelo backend. */
export function avatarUrl(avatarIlustrado: string): string | null {
  if (!avatarIlustrado) return null;
  return `${API_URL}/estilos/avatares/${avatarIlustrado}.png`;
}
