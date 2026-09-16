import type { Module } from "./Module";

/** Status de exibição calculado pelo backend (nunca persistido) — ver
 * apps/backend/rh_api/repositories/onboarding.py, get_my_trainings. */
export type TrainingDisplayStatus = "nao_iniciado" | "em_andamento" | "concluido";

/**
 * Resposta de GET /onboarding/meus-treinamentos e
 * GET /onboarding/meus-treinamentos/presenciais — campos reais de
 * onboarding_candidatos + trilhas_onboarding, com auto-escopo pelo e-mail
 * do usuário logado (nunca aceita id_registro vindo do app).
 */
export interface Training {
  id_onboarding: number;
  id_registro: number;
  trilha_id: number;
  titulo: string;
  categoria: string | null;
  modalidade: string | null;
  status: string;
  status_exibicao: TrainingDisplayStatus;
  percentual_concluido: number;
  total_itens: number;
  itens_concluidos: number;
  data_prevista: string | null;
  local: string | null;
  ministrante: string | null;
  modulos: Module[];
}
