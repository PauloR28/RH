import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/theme/useTheme";
import { useAuth } from "@/context/AuthContext";
import { avatarUrl } from "@/services/media";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

function getInitials(nome: string, sobrenome: string): string {
  const first = nome.trim().charAt(0);
  const last = sobrenome.trim().charAt(0);
  return `${first}${last}`.toUpperCase() || "?";
}

export default function ProfileScreen() {
  const { colors, spacing, typography, radius } = useTheme();
  const { user, signOut } = useAuth();
  const [imageFailed, setImageFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const illustratedUrl = user?.avatar_ilustrado ? avatarUrl(user.avatar_ilustrado) : null;
  const showIllustrated = illustratedUrl && !imageFailed;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Perfil" showBack />
      <View style={{ padding: spacing.lg, alignItems: "center" }}>
        <View style={{ height: spacing.xl }} />

        {showIllustrated ? (
          <Image
            source={{ uri: illustratedUrl }}
            style={[styles.avatar, { borderRadius: radius.pill }]}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.avatar, styles.initialsAvatar, { borderRadius: radius.pill, backgroundColor: colors.primarySoft }]}>
            <Text style={[typography.display, { color: colors.primary }]}>{getInitials(user?.nome ?? "", user?.sobrenome ?? "")}</Text>
          </View>
        )}

        <View style={{ height: spacing.lg }} />
        <Text style={[typography.heading, { color: colors.text, textAlign: "center" }]}>
          {user?.nome} {user?.sobrenome}
        </Text>
        {user?.cargo ? <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.xs }]}>{user.cargo}</Text> : null}

        <View style={{ height: spacing.xl, width: "100%" }} />

        <Card style={{ width: "100%" }}>
          <InfoRow label="E-mail" value={user?.email ?? ""} />
        </Card>

        <View style={{ height: spacing.xl }} />

        <Button
          label={signingOut ? "Saindo..." : "Sair"}
          variant="secondary"
          loading={signingOut}
          onPress={async () => {
            setSigningOut(true);
            await signOut();
          }}
          style={{ width: "100%" }}
        />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View>
      <Text style={[typography.label, { color: colors.textMuted }]}>{label.toUpperCase()}</Text>
      <Text style={[typography.body, { color: colors.text, marginTop: spacing.xs }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 112,
    height: 112,
  },
  initialsAvatar: {
    alignItems: "center",
    justifyContent: "center",
  },
});
