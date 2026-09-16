/** Mesma família e escala do Conecta web (DESIGN.md §1.4): Plus Jakarta Sans. */
export const fontFamily = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
} as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.bold },
  heading: { fontSize: 23, lineHeight: 29, fontFamily: fontFamily.bold },
  subheading: { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.regular },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.medium },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.medium },
  label: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.semibold },
} as const;
