import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/useTheme";

interface ProgressBarProps {
  percent: number;
  /** cor de trilho preenchido — some pra "concluído" (verde) por padrão via tema, senão usa o primário. */
  tone?: "primary" | "success";
}

export function ProgressBar({ percent, tone = "primary" }: ProgressBarProps) {
  const { colors, radius } = useTheme();
  const clamped = Math.max(0, Math.min(100, percent));
  const fillColor = tone === "success" ? colors.success : colors.primary;

  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceStrong, borderRadius: radius.pill }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: fillColor, borderRadius: radius.pill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    width: "100%",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
  },
});
