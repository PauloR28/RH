import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/theme/useTheme";
import { useMyTrainings } from "@/services/queries";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { SideMenu } from "@/components/SideMenu";
import type { Training } from "@/types/Training";

export default function HomeScreen() {
  const { colors, spacing, typography } = useTheme();
  const { data: trainings, isLoading, isRefetching, refetch, isError } = useMyTrainings();
  const [menuVisible, setMenuVisible] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Meus Treinamentos" onMenuPress={() => setMenuVisible(true)} />
      <SideMenu visible={menuVisible} onClose={() => setMenuVisible(false)} />

      <FlatList
        data={trainings ?? []}
        keyExtractor={(item) => String(item.id_onboarding)}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.lg }} />}
        renderItem={({ item }) => <TrainingCard training={item} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Text style={[typography.subheading, { color: colors.text, textAlign: "center" }]}>
                {isError ? "Não foi possível carregar seus treinamentos." : "Você ainda não tem treinamentos atribuídos."}
              </Text>
              <Text style={[typography.body, { color: colors.textSoft, textAlign: "center", marginTop: spacing.sm }]}>
                {isError ? "Puxe para baixo para tentar novamente." : "Assim que um treinamento for atribuído a você, ele aparece aqui."}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function TrainingCard({ training }: { training: Training }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/(app)/treinamento/[id]", params: { id: String(training.id_onboarding) } })}
    >
      <Card>
        <View style={styles.cardHeaderRow}>
          <Text style={[typography.subheading, { color: colors.text, flex: 1 }]} numberOfLines={2}>
            {training.titulo}
          </Text>
          <StatusBadge status={training.status_exibicao} />
        </View>
        <View style={{ height: spacing.md }} />
        <ProgressBar percent={training.percentual_concluido} tone={training.status_exibicao === "concluido" ? "success" : "primary"} />
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>
          {training.itens_concluidos} de {training.total_itens} módulos · {training.percentual_concluido}%
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
});
