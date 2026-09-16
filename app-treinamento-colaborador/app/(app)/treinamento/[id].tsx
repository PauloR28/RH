import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/theme/useTheme";
import { useMyTrainings } from "@/services/queries";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import type { Module } from "@/types/Module";

export default function TrainingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, typography, radius } = useTheme();
  const { data: trainings, isLoading } = useMyTrainings();
  const [showConcluidas, setShowConcluidas] = useState(false);
  const [showPendentes, setShowPendentes] = useState(true);

  const training = useMemo(() => trainings?.find((item) => String(item.id_onboarding) === id), [trainings, id]);

  const concluidos = training?.modulos.filter((m) => m.concluido) ?? [];
  const pendentes = training ? [...training.modulos].filter((m) => !m.concluido).sort((a, b) => a.ordem - b.ordem) : [];
  const proximoModulo = pendentes[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={training?.titulo ?? "Treinamento"} showBack />

      {isLoading && !training ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !training ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
          <Text style={[typography.body, { color: colors.textSoft, textAlign: "center" }]}>
            Não encontramos esse treinamento. Volte e tente novamente.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}>
          <Card emphasis="prominent">
            <Text style={[typography.subheading, { color: colors.text }]}>Seu progresso!</Text>
            <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>
              Acompanhe o andamento do seu treinamento.
            </Text>
          </Card>

          <View style={{ height: spacing.lg }} />

          <CollapsibleSection
            title={`Etapas concluídas (${concluidos.length})`}
            expanded={showConcluidas}
            onToggle={() => setShowConcluidas((prev) => !prev)}
          >
            {concluidos.map((modulo) => (
              <ModuleRow key={modulo.id_onboarding_item} modulo={modulo} trainingId={training.id_onboarding} />
            ))}
          </CollapsibleSection>

          <View style={{ height: spacing.lg }} />

          <CollapsibleSection
            title={`Etapas pendentes (${pendentes.length})`}
            expanded={showPendentes}
            onToggle={() => setShowPendentes((prev) => !prev)}
          >
            {pendentes.map((modulo) => (
              <ModuleRow key={modulo.id_onboarding_item} modulo={modulo} trainingId={training.id_onboarding} />
            ))}
          </CollapsibleSection>

          <View style={{ height: spacing.xl }} />

          {proximoModulo ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/(app)/modulo/[id]", params: { id: String(proximoModulo.id_onboarding_item), trainingId: String(training.id_onboarding) } })
              }
              style={{ backgroundColor: colors.primary, borderRadius: radius.standard, minHeight: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={[typography.bodyMedium, { color: colors.onPrimary }]}>Prosseguir treinamento</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={onToggle} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 }}>
        <Text style={[typography.subheading, { color: colors.text }]}>{title}</Text>
        <Text style={{ color: colors.primary, fontSize: 18 }}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>
      {expanded ? <View style={{ marginTop: spacing.md, gap: spacing.sm }}>{children}</View> : null}
    </Card>
  );
}

function ModuleRow({ modulo, trainingId }: { modulo: Module; trainingId: number }) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/(app)/modulo/[id]", params: { id: String(modulo.id_onboarding_item), trainingId: String(trainingId) } })}
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.standard,
        padding: spacing.md,
        gap: spacing.md,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: modulo.concluido ? colors.successSoft : colors.surfaceStrong,
        }}
      >
        <Text style={{ color: modulo.concluido ? colors.success : colors.textMuted }}>{modulo.concluido ? "✓" : "○"}</Text>
      </View>
      <Text style={[typography.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
        {modulo.titulo}
      </Text>
      <Text style={{ color: colors.textMuted }}>›</Text>
    </Pressable>
  );
}
