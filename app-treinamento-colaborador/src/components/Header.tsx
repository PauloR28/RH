import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/theme/useTheme";
import { fontFamily } from "@/theme/typography";

interface HeaderProps {
  title: string;
  /** Mostra seta de voltar (telas internas) em vez do menu hambúrguer (Home). */
  showBack?: boolean;
  onMenuPress?: () => void;
}

/** Header fixo no topo, sem bottom tabs — navegação em navbar como no Conecta web (promt.txt §5). */
export function Header({ title, showBack, onMenuPress }: HeaderProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.primaryStrong, paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.row, { paddingHorizontal: spacing.lg, paddingBottom: spacing.md }]}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            hitSlop={8}
            style={[styles.backButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.iconGlyph}>←</Text>
          </Pressable>
        ) : onMenuPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Abrir menu" onPress={onMenuPress} hitSlop={12} style={styles.iconButton}>
            <View style={styles.menuBar} />
            <View style={styles.menuBar} />
            <View style={styles.menuBar} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
        <Text style={[styles.title, { color: colors.onPrimary }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  menuBar: {
    width: 20,
    height: 2,
    backgroundColor: "#ffffff",
    marginVertical: 2,
    borderRadius: 1,
  },
  title: {
    flex: 1,
    textAlign: "right",
    textTransform: "uppercase",
    fontSize: 19,
    lineHeight: 24,
    fontFamily: fontFamily.bold,
    letterSpacing: 0.3,
    marginLeft: 12,
  },
});
