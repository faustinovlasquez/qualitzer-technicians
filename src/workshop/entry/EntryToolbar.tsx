import type { ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { IconName } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { WorkshopEntryDetail } from "../../domain/workshopEntry";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { intakeSummary } from "./EntrySections";

/** Fila compacta de la ficha: avance del ingreso y botones de ícono que abren su ventana. */
export function EntryToolbar({ children }: { children: ReactNode }) {
  return <View style={styles.bar}>{children}</View>;
}

/** Avance del ingreso en porcentaje; al tocarlo se ven los pasos y sus acciones. */
export function IntakeButton({ detail, onPress }: { detail: WorkshopEntryDetail; onPress: () => void }) {
  const { pending, percent } = intakeSummary(detail);
  const done = pending === 0;
  const color = done ? palette.success : palette.orange;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Avance del ingreso: ${percent}%${done ? ", completo" : `, faltan ${pending} pasos`}`} onPress={onPress}
    style={({ pressed }) => [styles.intake, { borderColor: color, backgroundColor: done ? palette.successSoft : palette.orangeSoft }, pressed && styles.pressed]}>
    <View style={styles.intakeHead}>
      <Ionicons name={done ? "checkmark-circle" : "git-commit-outline"} size={16} color={color} accessible={false} />
      <Text style={[styles.intakeLabel, { color }]} numberOfLines={1}>{done ? "Ingreso" : "Continuar"}</Text>
      <Text style={[styles.intakePercent, { color }]}>{percent}%</Text>
    </View>
    <View style={styles.track}><View style={[styles.fill, { width: `${percent}%`, backgroundColor: color }]} /></View>
  </Pressable>;
}

/** Botón de ícono con un nombre corto debajo; `dot` marca un estado (por ejemplo, correo sin enviar). */
export function ToolbarIcon({ icon, label, accessibilityLabel, onPress, color = palette.primary, soft = palette.primarySoft, dot }: {
  icon: IconName; label: string; accessibilityLabel?: string; onPress: () => void; color?: string; soft?: string; dot?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={4}
    style={({ pressed }) => [styles.tool, pressed && styles.pressed]}>
    <View style={[styles.toolIcon, { backgroundColor: soft }]}>
      <Ionicons name={icon} size={18} color={color} accessible={false} />
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
    </View>
    <Text style={styles.toolLabel} numberOfLines={1}>{label}</Text>
  </Pressable>;
}

/** Ventana centrada para las opciones de un botón de la barra. Tocar afuera la cierra. */
export function ToolDialog({ title, subtitle, icon, onClose, children }: { title: string; subtitle?: string; icon: IconName; onClose: () => void; children: ReactNode }) {
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" />
      <View style={styles.dialog}>
        <View style={styles.dialogHead}>
          <View style={styles.dialogIcon}><Ionicons name={icon} size={18} color={palette.primary} accessible={false} /></View>
          <View style={styles.grow}>
            <Text style={styles.dialogTitle} accessibilityRole="header">{title}</Text>
            {subtitle ? <Text style={styles.dialogSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10} onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Ionicons name="close" size={18} color={palette.textSecondary} accessible={false} />
          </Pressable>
        </View>
        <ScrollView style={styles.dialogBody} contentContainerStyle={styles.dialogContent}>{children}</ScrollView>
      </View>
    </View>
  </Modal>;
}

/** Opción de una ventana de la barra: ícono, nombre y el valor actual. */
export function ToolOption({ icon, label, caption, onPress, strong = false }: { icon: IconName; label: string; caption?: string; onPress: () => void; strong?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={caption ? `${label}: ${caption}` : label} onPress={onPress}
    style={({ pressed }) => [styles.option, strong && styles.optionStrong, pressed && styles.pressed]}>
    <View style={[styles.optionIcon, strong && styles.optionIconStrong]}><Ionicons name={icon} size={18} color={palette.primary} accessible={false} /></View>
    <View style={styles.grow}>
      <Text style={[styles.optionLabel, strong && styles.optionLabelStrong]} numberOfLines={1}>{label}</Text>
      {caption ? <Text style={[styles.optionCaption, strong && styles.optionCaptionStrong]} numberOfLines={1}>{caption}</Text> : null}
    </View>
    <Ionicons name="chevron-forward" size={16} color={strong ? palette.white : palette.textMuted} accessible={false} />
  </Pressable>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "stretch", gap: 6, padding: 6, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pressed: { opacity: 0.7 },
  grow: { flex: 1, minWidth: 0 },
  intake: { flex: 1, minWidth: 92, justifyContent: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1 },
  intakeHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  intakeLabel: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "800" },
  intakePercent: { fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
  track: { height: 5, borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(15,23,42,0.08)" },
  fill: { height: 5, borderRadius: 3 },
  tool: { width: 52, alignItems: "center", gap: 3, paddingVertical: 2 },
  toolIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  toolLabel: { fontSize: 10, lineHeight: 13, fontWeight: "700", color: palette.textSecondary },
  dot: { position: "absolute", top: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: palette.surface },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(15,23,42,0.55)" },
  dialog: { width: "100%", maxWidth: 440, maxHeight: "85%", borderRadius: radius.lg, backgroundColor: palette.surface, overflow: "hidden" },
  dialogHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border },
  dialogIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  dialogTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  dialogSubtitle: { ...typography.caption, color: palette.textSecondary },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  dialogBody: { flexGrow: 0 },
  dialogContent: { padding: 14, gap: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  optionStrong: { borderColor: palette.primary, backgroundColor: palette.primary },
  optionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  optionIconStrong: { backgroundColor: palette.white },
  optionLabel: { fontSize: 14, fontWeight: "800", color: palette.heading },
  optionLabelStrong: { color: palette.white },
  optionCaption: { ...typography.caption, color: palette.textSecondary },
  optionCaptionStrong: { color: palette.onDark }
});
