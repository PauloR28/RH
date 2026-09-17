import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTheme } from "@/theme/useTheme";
import { useAuth } from "@/context/AuthContext";
import { useCompleteTrainingItem, useMyTrainings } from "@/services/queries";
import { moduleVideoUrl, resolveMediaUrl } from "@/services/media";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import type { SaibaMaisItem } from "@/types/Module";

const SCROLL_END_THRESHOLD_PX = 24;

// texto_principal/secao.texto agora podem vir com marcação HTML (o editor rico
// do Conecta web usa document.execCommand — ver features/treinamentos/wizard.js,
// Correções.txt 17/set/2026). O app não tem renderizador de rich text (fora de
// escopo deste pedido, que era só o visual de Dica/Saiba+), então mostramos o
// texto puro em vez de tags quebradas na tela.
function stripHtml(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .replace(/<(p|div|br)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
                <Text style={[typography.body, { color: colors.text }]}>{stripHtml(modulo.texto_principal)}</Text>
              </Card>
            ) : null}

            {modulo.secoes.length > 0 ? (
              <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
                <Text style={[typography.subheading, { color: colors.text }]}>Material de Leitura</Text>
                {modulo.secoes.map((secao, secaoIndex) => (
                  <View key={secaoIndex}>
                    {secao.subtitulo ? (
                      <Text style={[typography.subheading, { color: colors.primaryStrong, marginBottom: spacing.xs }]}>
                        {secao.subtitulo}
                      </Text>
                    ) : null}
                    {secao.texto ? <Text style={[typography.body, { color: colors.textSoft }]}>{stripHtml(secao.texto)}</Text> : null}
                    {secao.link ? <LinkChip url={secao.link} /> : null}
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

            {(() => {
              // Correções.txt (17/set/2026): a caixa de Dica deve vir no final
              // do texto do módulo (junto com o Saiba+), não intercalada entre
              // as seções — junta a Dica do módulo inteiro com a de cada seção.
              const dicas = [
                modulo.dica_texto,
                ...modulo.secoes.map((secao) => secao.dica),
              ].filter((texto): texto is string => Boolean(texto));
              if (!dicas.length) return null;
              return (
                <View style={{ marginTop: spacing.xl }}>
                  {dicas.map((texto, index) => (
                    <DicaCard key={index} texto={texto} />
                  ))}
                </View>
              );
            })()}

            {modulo.saiba_mais?.length ? <SaibaMaisSection itens={modulo.saiba_mais} /> : null}

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

// Correções.txt (rodada 17/set/2026): visual de Dica e Saiba+ seguindo
// exatamente o wireframe "Visão Curso 1" (docs/Desing/Aplicativo - Wareframe)
// — cartão verde-claro com selo circular (lâmpada) sobrepondo o canto
// superior direito para a Dica, e um cartão com ícone + pílula colorida
// para cada link de Saiba+. Sem nova lib de ícones (app não usava nenhuma
// até agora) — selo com emoji simples, leve e sem dependência nova.
function DicaCard({ texto }: { texto: string }) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <View style={{ marginTop: spacing.lg }}>
      <View
        style={[
          styles.dicaCard,
          { backgroundColor: colors.successSoft, borderRadius: radius.prominent, padding: spacing.lg },
        ]}
      >
        <Text style={[typography.body, { color: colors.text }]}>{texto}</Text>
      </View>
      <View style={[styles.dicaBadge, { backgroundColor: colors.successSoft, borderColor: colors.bg }]}>
        <Text style={{ fontSize: 20 }}>💡</Text>
      </View>
    </View>
  );
}

function LinkChip({ url }: { url: string }) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => Linking.openURL(url)}
      style={[styles.linkChip, { backgroundColor: colors.infoSoft, borderRadius: radius.pill, marginTop: spacing.sm }]}
      hitSlop={8}
    >
      <Text style={[typography.caption, { color: colors.info }]} numberOfLines={1}>
        🔗 {url}
      </Text>
    </Pressable>
  );
}

function SaibaMaisSection({ itens }: { itens: SaibaMaisItem[] }) {
  const { colors, spacing, radius, typography } = useTheme();
  const dicas = itens.filter((item) => item.tipo === "dica" && item.texto);
  const links = itens.filter((item) => item.tipo === "link" && item.url);
  if (!dicas.length && !links.length) return null;

  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={[typography.subheading, { color: colors.primaryStrong }]}>Saiba +</Text>
      {dicas.map((item, index) => (
        <Text key={`dica-${index}`} style={[typography.body, { color: colors.textSoft, marginTop: spacing.sm }]}>
          • {item.texto}
        </Text>
      ))}
      {links.map((item, index) => (
        <Pressable
          key={`link-${index}`}
          accessibilityRole="link"
          onPress={() => Linking.openURL(item.url)}
          style={[
            styles.saibaMaisCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.prominent, marginTop: spacing.md, padding: spacing.md, gap: spacing.md },
          ]}
        >
          <View style={[styles.saibaMaisIcon, { backgroundColor: colors.infoSoft }]}>
            <Text style={{ fontSize: 16 }}>🔗</Text>
          </View>
          <View style={[styles.saibaMaisPill, { backgroundColor: colors.infoSoft, borderRadius: radius.pill, paddingHorizontal: spacing.lg }]}>
            <Text style={[typography.bodyMedium, { color: colors.info }]} numberOfLines={1}>
              {(item.texto || item.url).toUpperCase()}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
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
  dicaCard: {
    position: "relative",
  },
  dicaBadge: {
    position: "absolute",
    top: -14,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  linkChip: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  saibaMaisCard: {
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  saibaMaisIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  saibaMaisPill: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
