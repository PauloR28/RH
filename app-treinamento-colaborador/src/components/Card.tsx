import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/useTheme";

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** "prominent" para o painel de destaque de uma tela (raio maior, mesmo espírito do Conecta web). */
  emphasis?: "standard" | "prominent";
}

export function Card({ children, style, emphasis = "standard" }: CardProps) {
  const { colors, spacing, radius, scheme } = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: emphasis === "prominent" ? radius.prominent : radius.standard,
          padding: spacing.lg,
          shadowOpacity: scheme === "dark" ? 0.3 : 0.06,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
});
