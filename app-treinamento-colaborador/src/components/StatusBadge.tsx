import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/theme/useTheme";
import type { TrainingDisplayStatus } from "@/types/Training";

const LABELS: Record<TrainingDisplayStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  concluido: "Concluído",
};

export function StatusBadge({ status }: { status: TrainingDisplayStatus }) {
  const { colors, spacing, radius, typography } = useTheme();
  const tone =
    status === "concluido"
      ? { fg: colors.success, bg: colors.successSoft }
      : status === "em_andamento"
        ? { fg: colors.info, bg: colors.infoSoft }
        : { fg: colors.textMuted, bg: colors.surfaceStrong };

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
      ]}
    >
      <Text style={[typography.label, { color: tone.fg }]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
  },
});
