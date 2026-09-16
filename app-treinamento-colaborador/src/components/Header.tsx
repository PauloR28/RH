import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/theme/useTheme";

interface HeaderProps {
  title: string;
  /** Mostra seta de voltar (telas internas) em vez do menu hambúrguer (Home). */
  showBack?: boolean;
  onMenuPress?: () => void;
}

/** Header fixo no topo, sem bottom tabs — navegação em navbar como no Conecta web (promt.txt §5). */
export function Header({ title, showBack, onMenuPress }: HeaderProps) {
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.primary, paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.row, { paddingHorizontal: spacing.lg, paddingBottom: spacing.md }]}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.iconButton}
          >
            <Text style={styles.iconGlyph}>‹</Text>
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
        <Text style={[typography.subheading, styles.title, { color: colors.onPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.iconButton} />
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
    justifyContent: "space-between",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: {
    color: "#ffffff",
    fontSize: 30,
    lineHeight: 30,
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
    textAlign: "center",
  },
});
