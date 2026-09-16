import { useEffect, useRef } from "react";
import { Animated, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/theme/useTheme";
import { useAuth } from "@/context/AuthContext";

const PANEL_WIDTH = 300;
/** Fora de escopo desta rodada (sem confirmação de URL real do RH) — link
 * placeholder explícito, igual ao widget "Saiba +" do wireframe. */
const INTRANET_URL = "https://www.intranet.com.br";

interface SideMenuProps {
  visible: boolean;
  onClose: () => void;
}

export function SideMenu({ visible, onClose }: SideMenuProps) {
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const translateX = useRef(new Animated.Value(-PANEL_WIDTH)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -PANEL_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, translateX]);

  function goTo(path: "/calendario" | "/termo-responsabilidade" | "/perfil") {
    onClose();
    router.push(path);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Fechar menu" onPress={onClose} />
        <Animated.View
          style={[
            styles.panel,
            {
              width: PANEL_WIDTH,
              backgroundColor: colors.primaryStrong,
              paddingTop: insets.top + spacing.xl,
              paddingBottom: insets.bottom + spacing.lg,
              transform: [{ translateX }],
            },
          ]}
        >
          <View style={{ paddingHorizontal: spacing.xl }}>
            <Text style={[typography.heading, { color: "#ffffff" }]}>conecta</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Ver perfil" onPress={() => goTo("/perfil")} style={{ marginTop: spacing.lg, minHeight: 44, justifyContent: "center" }}>
              <Text style={[typography.bodyMedium, { color: "#ffffff" }]}>{user?.nome ?? ""}</Text>
              <Text style={[typography.caption, { color: "rgba(255,255,255,0.75)" }]}>{user?.cargo ?? ""}</Text>
            </Pressable>
          </View>

          <View style={[styles.divider, { marginVertical: spacing.xl, marginHorizontal: spacing.xl }]} />

          <View style={{ gap: spacing.lg, paddingHorizontal: spacing.xl }}>
            <MenuItem label="Intranet" onPress={() => Linking.openURL(INTRANET_URL)} />
            <MenuItem label="Termo de Responsabilidade" onPress={() => goTo("/termo-responsabilidade")} />
            <MenuItem label="Calendário" onPress={() => goTo("/calendario")} />
          </View>

          <View style={{ flex: 1 }} />

          <View style={[styles.divider, { marginHorizontal: spacing.xl, marginBottom: spacing.lg }]} />
          <View style={{ paddingHorizontal: spacing.xl }}>
            <MenuItem
              label="Sair da Conta"
              onPress={async () => {
                onClose();
                await signOut();
              }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function MenuItem({ label, onPress }: { label: string; onPress: () => void }) {
  const { typography } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.menuItem} hitSlop={8}>
      <Text style={[typography.bodyMedium, { color: "#ffffff" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(9, 17, 31, 0.45)",
  },
  panel: {
    height: "100%",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  menuItem: {
    minHeight: 44,
    justifyContent: "center",
  },
});
