import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { IconName } from "../../ui/components";
import { palette, radius } from "../../ui/theme";

export type InfoTone = "neutral" | "blue" | "orange";

const tones: { [K in InfoTone]: { background: string; accent: string; value: string } } = {
  neutral: { background: palette.background, accent: palette.textMuted, value: palette.navy },
  blue: { background: palette.infoSoft, accent: palette.info, value: palette.info },
  orange: { background: "#FFF1E6", accent: "#C2410C", value: "#9A3412" },
};

/** Bloque de dato de las tarjetas (cliente, equipo, ubicación, horario, colación), con el formato del panel web. */
export function InfoBlock({ label, value, detail, icon, tone = "neutral", style }: { label: string; value: string; detail?: string | null; icon?: IconName; tone?: InfoTone; style?: StyleProp<ViewStyle> }) {
  const colors = tones[tone];
  return <View style={[styles.info, { backgroundColor: colors.background }, style]} accessible accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ""}`}>
    <View style={styles.labelRow}>
      {icon ? <Ionicons name={icon} size={13} color={colors.accent} accessible={false} /> : null}
      <Text style={[styles.label, { color: colors.accent }]}>{label}</Text>
    </View>
    <Text style={[styles.value, { color: colors.value }]}>{value}</Text>
    {detail ? <Text style={styles.detail}>{detail}</Text> : null}
  </View>;
}

export const infoStyles = StyleSheet.create({
  list: { gap: 6 },
  row: { flexDirection: "row", gap: 6 },
  half: { flex: 1, minWidth: 0 },
});

const styles = StyleSheet.create({
  info: { borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 7, gap: 1 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  value: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 16, color: palette.textSecondary },
});
