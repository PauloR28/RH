/**
 * Paleta migrada 1:1 de apps/frontend/estilos/tokens.css (light + dark do
 * Conecta web) — não são valores inventados para o app, são os mesmos hex
 * já aprovados pelo RH (ver DESIGN.md, seção 1.1: azul amostrado por pixel
 * do logo real, #086fca/#014a8a).
 */
export type ColorScheme = "light" | "dark";

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceSoft: string;
  surfaceStrong: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  textMuted: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  /** Roxo do bloco "Saiba +" / links de intranet (wireframe "Aplicativo - Wareframe"). */
  violet: string;
  violetSoft: string;
}

const light: ThemeColors = {
  bg: "#f4f7fb",
  surface: "#ffffff",
  surfaceSoft: "#f6f8fc",
  surfaceStrong: "#e9eef7",
  border: "#dbe4f0",
  borderStrong: "#c7d3e3",
  text: "#101d33",
  textSoft: "#4d5f79",
  textMuted: "#7a8aa3",
  primary: "#086fca",
  primaryStrong: "#014a8a",
  primarySoft: "#eaf3fb",
  onPrimary: "#ffffff",
  success: "#13795b",
  successSoft: "#e7f7f1",
  danger: "#c23b4d",
  dangerSoft: "#fdecef",
  warning: "#b97810",
  warningSoft: "#fff4de",
  info: "#0c6d9d",
  infoSoft: "#eaf7fd",
  accent: "#e2921a",
  accentStrong: "#a8650a",
  accentSoft: "#fdf1de",
  violet: "#8b3fc9",
  violetSoft: "#f3e6fb",
};

const dark: ThemeColors = {
  bg: "#0f1520",
  surface: "#171f2e",
  surfaceSoft: "#1c2536",
  surfaceStrong: "#232e42",
  border: "#2c3a52",
  borderStrong: "#3a4a67",
  text: "#e8edf6",
  textSoft: "#b6c2d6",
  textMuted: "#8a97b0",
  primary: "#3d8bdb",
  primaryStrong: "#7fb8ff",
  primarySoft: "#16273f",
  onPrimary: "#ffffff",
  success: "#3fc793",
  successSoft: "#123227",
  danger: "#ea6a7c",
  dangerSoft: "#3a1b22",
  warning: "#f0ac4f",
  warningSoft: "#3a2b12",
  info: "#4fb8e6",
  infoSoft: "#12303d",
  accent: "#f0ac4f",
  accentStrong: "#f5c785",
  accentSoft: "#3a2b12",
  violet: "#b585e6",
  violetSoft: "#2c1f3d",
};

export const palettes: Record<ColorScheme, ThemeColors> = { light, dark };
