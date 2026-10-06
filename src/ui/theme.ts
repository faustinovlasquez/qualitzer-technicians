import type { TextStyle, ViewStyle } from "react-native";

const lightPalette = {
  background: "#F5F7FA",
  surface: "#FFFFFF",
  navy: "#122C3A",
  navyLight: "#214B5B",
  /** Títulos y cifras destacadas: azul marino en claro, casi blanco en oscuro. */
  heading: "#122C3A",
  primary: "#007E80",
  teal: "#0D9488",
  primarySoft: "#E6F4F2",
  primaryBorder: "#C4E1DC",
  text: "#122C3A",
  textSecondary: "#526673",
  textMuted: "#627582",
  border: "#E2E9EE",
  track: "#EDF2F5",
  amber: "#A15C07",
  amberSoft: "#FFF3D9",
  orange: "#C4510A",
  orangeSoft: "#FFF1E6",
  violet: "#6D4AB4",
  violetSoft: "#EFEAF9",
  success: "#16724F",
  successSoft: "#E7F5EC",
  danger: "#B33438",
  /** Fondo de botones de peligro con texto blanco. */
  dangerSolid: "#B33438",
  dangerSoft: "#FDECEE",
  dangerBorder: "#F2CBCF",
  info: "#315D9B",
  infoSoft: "#EAF0FA",
  infoBorder: "#C9D7EE",
  /** Texto e íconos sobre colores sólidos (botones, insignias, encabezados oscuros): blanco en ambos temas. */
  white: "#FFFFFF",
  onDark: "#D1E3E7",
  darkBorder: "rgba(255, 255, 255, 0.16)",
  darkSurface: "rgba(255, 255, 255, 0.09)",
};
export type Palette = { [K in keyof typeof lightPalette]: string };
export type ColorScheme = "light" | "dark";

const darkPalette: Palette = {
  background: "#0D171D",
  surface: "#15232B",
  navy: "#0A1A22",
  navyLight: "#1C3B47",
  heading: "#EEF4F7",
  primary: "#1A9C95",
  teal: "#2BB8A8",
  primarySoft: "#14363A",
  primaryBorder: "#235A5C",
  text: "#E4EDF1",
  textSecondary: "#A6B8C2",
  textMuted: "#8B9FAA",
  border: "#25363F",
  track: "#1D2D36",
  amber: "#F0AE4C",
  amberSoft: "#36290F",
  orange: "#F08A4B",
  orangeSoft: "#3A2112",
  violet: "#B39CEB",
  violetSoft: "#2A2140",
  success: "#4CC38A",
  successSoft: "#14322A",
  danger: "#F27D82",
  dangerSolid: "#C2454B",
  dangerSoft: "#3B1D22",
  dangerBorder: "#5C2A31",
  info: "#86AEEA",
  infoSoft: "#1A2840",
  infoBorder: "#2C4166",
  white: "#FFFFFF",
  onDark: "#D1E3E7",
  darkBorder: "rgba(255, 255, 255, 0.16)",
  darkSurface: "rgba(255, 255, 255, 0.09)",
};

/**
 * Paleta activa. Los estilos se calculan al cargar cada módulo, así que el tema se aplica una sola vez al iniciar
 * (src/ui/initColorScheme.ts, importado antes que App) y cambiarlo recarga la app.
 */
export const palette: Palette = { ...lightPalette };
export let activeColorScheme: ColorScheme = "light";
export function applyColorScheme(scheme: ColorScheme): void {
  activeColorScheme = scheme;
  Object.assign(palette, scheme === "dark" ? darkPalette : lightPalette);
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const typography = {
  hero: { fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -1.1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.8 },
  heading: { fontSize: 20, lineHeight: 27, fontWeight: "700", letterSpacing: -0.35 },
  body: { fontSize: 15, lineHeight: 23, fontWeight: "400" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  overline: { fontSize: 11, lineHeight: 16, fontWeight: "800", letterSpacing: 1.6 },
} satisfies { [name: string]: TextStyle };

export const theme = {
  colors: palette,
  spacing,
  radius,
  typography,
  touchTarget: 48,
  contentWidth: 880,
  shadow: { boxShadow: "0px 4px 20px rgba(18, 44, 58, 0.045)" } satisfies ViewStyle,
} as const;