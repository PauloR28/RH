import { ScrollView, Text, View } from "react-native";
import { useTheme } from "@/theme/useTheme";
import { Header } from "@/components/Header";

/**
 * MOCK_DATA — pendência explícita (promt.txt §4/§9): não existe hoje, no
 * backend, um "termo de responsabilidade" do colaborador (o único "termo"
 * existente é sobre RH liberar download de anexo, caso diferente — ver
 * TERMO_LGPD_ANEXO_TREINAMENTO_TEXTO em schemas/onboarding.py). Este texto é
 * um placeholder até o RH enviar o conteúdo oficial; tela é só leitura,
 * sem captura de assinatura/aceite.
 */
const TERMO_MOCK_TEXTO = `[MOCK_DATA — aguardando texto oficial do RH]

Este é um texto placeholder do Termo de Responsabilidade. Substitua por conteúdo real assim que aprovado.`;

export default function ResponsibilityTermScreen() {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Termo de Responsabilidade" showBack />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={[typography.caption, { color: colors.warning, marginBottom: spacing.md }]}>
          Conteúdo provisório — aguardando texto oficial do RH.
        </Text>
        <Text style={[typography.body, { color: colors.text }]}>{TERMO_MOCK_TEXTO}</Text>
      </ScrollView>
    </View>
  );
}
