import type { TextStyle, ViewStyle } from "react-native";

export const palette = {
  background: "#F5F7FA",
  surface: "#FFFFFF",
  navy: "#122C3A",
  navyLight: "#214B5B",
  primary: "#007E80",
  teal: "#0D9488",
  primarySoft: "#E6F4F2",
  text: "#122C3A",
  textSecondary: "#526673",
  textMuted: "#627582",
  border: "#E2E9EE",
  track: "#EDF2F5",
  amber: "#A15C07",
  amberSoft: "#FFF3D9",
  success: "#16724F",
  successSoft: "#E7F5EC",
  danger: "#B33438",
  dangerSoft: "#FDECEE",
  info: "#315D9B",
  infoSoft: "#EAF0FA",
  white: "#FFFFFF",
  onDark: "#D1E3E7",
  darkBorder: "rgba(255, 255, 255, 0.16)",
  darkSurface: "rgba(255, 255, 255, 0.09)",
} as const;

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