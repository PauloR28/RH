import { api } from "./api";
import type { Training } from "@/types/Training";

/** Auto-escopo pelo token no backend (nunca manda id_registro) — ver rota
 * GET /onboarding/meus-treinamentos em apps/backend/rh_api/routers/onboarding.py. */
export async function getMyTrainings(): Promise<Training[]> {
  const response = await api.get<Training[]>("/onboarding/meus-treinamentos");
  return response.data;
}

export async function getMyPresencialTrainings(): Promise<Training[]> {
  const response = await api.get<Training[]>("/onboarding/meus-treinamentos/presenciais");
  return response.data;
}

/**
 * Marca o módulo como concluído — o backend confirma que o item pertence ao
 * usuário logado (403 caso contrário) antes de gravar. A resposta é o
 * progresso bruto de onboarding (get_onboarding_progress), formato diferente
 * de Training; o app sempre re-busca getMyTrainings() depois, então só
 * confirmamos que a chamada teve sucesso.
 */
export async function completeTrainingItem(idOnboardingItem: number): Promise<void> {
  await api.post(`/onboarding/meus-treinamentos/itens/${idOnboardingItem}/concluir`);
}
