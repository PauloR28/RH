import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/useTheme";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Alvo de toque mínimo 44x44 (promt.txt §5, padrão de acessibilidade mobile). */
export function Button({ label, onPress, variant = "primary", disabled, loading, style }: ButtonProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const isPrimary = variant === "primary";
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: 48,
          paddingHorizontal: spacing.xl,
          borderRadius: radius.standard,
          backgroundColor: isPrimary ? colors.primary : "transparent",
          borderWidth: isPrimary ? 0 : 1.5,
          borderColor: colors.primary,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            typography.bodyMedium,
            { color: isPrimary ? colors.onPrimary : colors.primary },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
});
