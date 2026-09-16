import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTheme } from "@/theme/useTheme";
import { useAuth } from "@/context/AuthContext";
import { useCompleteTrainingItem, useMyTrainings } from "@/services/queries";
import { moduleVideoUrl, resolveMediaUrl } from "@/services/media";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";

const SCROLL_END_THRESHOLD_PX = 24;

export default function ModuleScreen() {
  const { id, trainingId } = useLocalSearchParams<{ id: string; trainingId: string }>();
  const { colors, spacing, typography } = useTheme();
  const { token } = useAuth();
  const { data: trainings, isLoading } = useMyTrainings();
  const completeMutation = useCompleteTrainingItem();
  const [reachedEnd, setReachedEnd] = useState(false);

  const training = trainings?.find((item) => String(item.id_onboarding) === trainingId);
  const modulos = useMemo(() => (training ? [...training.modulos].sort((a, b) => a.ordem - b.ordem) : []), [training]);
  const index = modulos.findIndex((item) => String(item.id_onboarding_item) === id);
  const modulo = index >= 0 ? modulos[index] : undefined;
  const anterior = index > 0 ? modulos[index - 1] : undefined;
  const proximo = index >= 0 && index < modulos.length - 1 ? modulos[index + 1] : undefined;

  const temVideo = Boolean(modulo?.trilha_item_id && (modulo?.video_path || modulo?.conteudo_url));
  const videoSource = useMemo(() => {
    if (!modulo || !temVideo || !token) return null;
    const uri = modulo.video_path ? moduleVideoUrl(modulo.trilha_item_id) : modulo.conteudo_url!;
    return { uri, headers: modulo.video_path ? { Authorization: `Bearer ${token}` } : undefined };
  }, [modulo, temVideo, token]);
  const player = useVideoPlayer(videoSource, (instance) => {
    instance.loop = false;
  });

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (reachedEnd) return;
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceToBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceToBottom <= SCROLL_END_THRESHOLD_PX) {
      setReachedEnd(true);
    }
  }

  function goToModule(targetId: number) {
    router.setParams({ id: String(targetId) });
    setReachedEnd(false);
  }

  async function handleComplete() {
    if (!modulo) return;
    try {
      await completeMutation.mutateAsync(modulo.id_onboarding_item);
    } catch {
      // Erro tratado abaixo via completeMutation.isError.
    }
  }

  const podeConcluir = reachedEnd || (modulo?.concluido ?? false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={training?.titulo ?? "Módulo"} showBack />

      {isLoading && !modulo ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !modulo ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
          <Text style={[typography.body, { color: colors.textSoft, textAlign: "center" }]}>Módulo não encontrado.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.huge }}
            onScroll={handleScroll}
            scrollEventThrottle={200}
          >
            <Text style={[typography.heading, { color: colors.text }]}>{modulo.titulo}</Text>
            {modulo.descricao ? (
              <Text style={[typography.body, { color: colors.textSoft, marginTop: spacing.sm }]}>{modulo.descricao}</Text>
            ) : null}

            {temVideo && videoSource ? (
              <View style={{ marginTop: spacing.xl }}>
                <Text style={[typography.subheading, { color: colors.text, marginBottom: spacing.sm }]}>Vídeo Explicativo</Text>
                <VideoView player={player} style={styles.video} contentFit="contain" />
              </View>
            ) : null}

            {modulo.texto_principal ? (
              <Card style={{ marginTop: spacing.xl }}>
                <Text style={[typography.body, { color: colors.text }]}>{modulo.texto_principal}</Text>
              </Card>
            ) : null}

            {modulo.secoes.length > 0 ? (
              <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
                <Text style={[typography.subheading, { color: colors.text }]}>Material de Leitura</Text>
                {modulo.secoes.map((secao, secaoIndex) => (
                  <View key={secaoIndex}>
                    {secao.subtitulo ? (
                      <Text style={[typography.bodyMedium, { color: colors.text, marginBottom: spacing.xs }]}>{secao.subtitulo}</Text>
                    ) : null}
                    {secao.texto ? <Text style={[typography.body, { color: colors.textSoft }]}>{secao.texto}</Text> : null}
                    {secao.imagens.map((imagem, imagemIndex) => (
                      <Image
                        key={imagemIndex}
                        source={{ uri: resolveMediaUrl(imagem), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                        style={styles.sectionImage}
                        resizeMode="cover"
                      />
                    ))}
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ height: spacing.xl }} />

            {!podeConcluir ? (
              <Text style={[typography.caption, { color: colors.textMuted, textAlign: "center" }]}>
                Role até o fim do conteúdo para liberar a conclusão deste módulo.
              </Text>
            ) : null}

            {completeMutation.isError ? (
              <Text style={[typography.caption, { color: colors.danger, textAlign: "center", marginTop: spacing.sm }]}>
                Não foi possível salvar. Verifique sua conexão e tente novamente.
              </Text>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, padding: spacing.lg, gap: spacing.md }]}>
            <View style={styles.footerRow}>
              <FooterButton label="‹ Anterior" onPress={() => anterior && goToModule(anterior.id_onboarding_item)} disabled={!anterior} />
              <FooterButton label="Próximo ›" onPress={() => proximo && goToModule(proximo.id_onboarding_item)} disabled={!proximo} />
            </View>
            <PrimaryFooterButton
              label={modulo.concluido ? "Módulo concluído" : completeMutation.isPending ? "Salvando..." : "Marcar como concluído"}
              onPress={handleComplete}
              disabled={!podeConcluir || modulo.concluido || completeMutation.isPending}
            />
          </View>
        </>
      )}
    </View>
  );
}

function FooterButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const { colors, typography } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={styles.footerButton} hitSlop={8}>
      <Text style={[typography.bodyMedium, { color: disabled ? colors.textMuted : colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryFooterButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const { colors, radius, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.primaryFooterButton,
        { backgroundColor: disabled ? colors.surfaceStrong : colors.primary, borderRadius: radius.standard },
      ]}
    >
      <Text style={[typography.bodyMedium, { color: disabled ? colors.textMuted : colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    backgroundColor: "#000",
  },
  sectionImage: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    marginTop: 8,
  },
  footer: {
    borderTopWidth: 1,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryFooterButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
