import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useTheme } from "@/theme/useTheme";
import { useMyPresencialTrainings } from "@/services/queries";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import type { Training } from "@/types/Training";

function formatDataHora(iso: string | null): string {
  if (!iso) return "Data a confirmar";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Lista os treinamentos presenciais do colaborador (dia/horário/local/instrutor)
 * — reaproveita onboarding_candidatos.data_prevista/local/ministrante, que já
 * existiam para o RH agendar; só faltava expor via auto-escopo (ver plano). */
export default function CalendarScreen() {
  const { colors, spacing, typography } = useTheme();
  const { data: trainings, isLoading, isError } = useMyPresencialTrainings();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Calendário" showBack />

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={trainings ?? []}
          keyExtractor={(item) => String(item.id_onboarding)}
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.lg }} />}
          renderItem={({ item }) => <PresencialCard training={item} />}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
              <Text style={[typography.subheading, { color: colors.text, textAlign: "center" }]}>
                {isError ? "Não foi possível carregar seus treinamentos presenciais." : "Nenhum treinamento presencial agendado."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function PresencialCard({ training }: { training: Training }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Card>
      <Text style={[typography.subheading, { color: colors.text }]}>{training.titulo}</Text>
      <View style={{ height: spacing.sm }} />
      <InfoLine label="Data e horário" value={formatDataHora(training.data_prevista)} />
      {training.local ? <InfoLine label="Local" value={training.local} /> : null}
      {training.ministrante ? <InfoLine label="Instrutor" value={training.ministrante} /> : null}
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ marginTop: spacing.xs }}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.body, { color: colors.text }]}>{value}</Text>
    </View>
  );
}
