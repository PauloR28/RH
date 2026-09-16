import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { z } from "zod";
import { useTheme } from "@/theme/useTheme";
import { useAuth } from "@/context/AuthContext";
import { LoginError } from "@/services/authService";

// Correções.txt (rodada 16/set/2026): "esqueça a senha! Só será necessário
// o e-mail do aluno" — sem campo de senha, independente do que está
// configurado para aquele usuário no Conecta. O backend (POST /auth/app/
// login-email) é quem decide se o e-mail está liberado para o app.
const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe seu e-mail.").email("Informe um e-mail válido."),
});

export default function LoginScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && !isSubmitting;

  async function handleSubmit() {
    setErrorMessage(null);
    const parsed = loginSchema.safeParse({ email });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Verifique o e-mail informado.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(parsed.data.email);
    } catch (error) {
      if (error instanceof LoginError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Não foi possível entrar. Tente novamente.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.primaryStrong }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { padding: spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={[typography.display, styles.logo]}>conecta</Text>
        <Text style={[typography.body, styles.subtitle]}>Central de Treinamento</Text>

        <View style={{ height: spacing.xxl }} />

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="E-mail"
          placeholderTextColor="rgba(255,255,255,0.6)"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onSubmitEditing={handleSubmit}
          style={[
            styles.input,
            typography.body,
            { borderRadius: radius.standard, borderColor: "rgba(255,255,255,0.4)" },
          ]}
        />

        {errorMessage ? (
          <Text style={[typography.caption, styles.error, { marginTop: spacing.md }]}>{errorMessage}</Text>
        ) : null}

        <View style={{ height: spacing.xl }} />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[
            styles.submitButton,
            { borderRadius: radius.standard, backgroundColor: canSubmit ? "#ffffff" : "rgba(255,255,255,0.3)" },
          ]}
        >
          <Text style={[typography.bodyMedium, { color: colors.primaryStrong }]}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
  },
  logo: {
    color: "#ffffff",
    textAlign: "center",
  },
  subtitle: {
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },
  input: {
    borderWidth: 1.5,
    minHeight: 48,
    paddingHorizontal: 16,
    color: "#ffffff",
  },
  error: {
    color: "#ffb4bd",
  },
  submitButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
