import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { completeTrainingItem, getMyPresencialTrainings, getMyTrainings } from "./trainingService";

const MY_TRAININGS_KEY = ["meus-treinamentos"] as const;
const MY_PRESENCIAL_TRAININGS_KEY = ["meus-treinamentos", "presenciais"] as const;

export function useMyTrainings() {
  return useQuery({ queryKey: MY_TRAININGS_KEY, queryFn: getMyTrainings });
}

export function useMyPresencialTrainings() {
  return useQuery({ queryKey: MY_PRESENCIAL_TRAININGS_KEY, queryFn: getMyPresencialTrainings });
}

export function useCompleteTrainingItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idOnboardingItem: number) => completeTrainingItem(idOnboardingItem),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_TRAININGS_KEY });
    },
  });
}
