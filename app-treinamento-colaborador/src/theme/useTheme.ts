import { useColorScheme } from "react-native";
import { palettes, type ThemeColors } from "./colors";
import { radius, spacing } from "./spacing";
import { typography } from "./typography";

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  scheme: "light" | "dark";
}

/** Light/dark obrigatórios (promt.txt §5) — segue o tema do sistema operacional. */
export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return {
    colors: palettes[scheme],
    spacing,
    radius,
    typography,
    scheme,
  };
}
