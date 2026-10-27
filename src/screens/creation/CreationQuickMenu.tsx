import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { CreationKind } from "../../domain/creation";
import { IconButton, type IconName } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";

// inline: el botón vive dentro de la barra de navegación inferior en vez de flotar sobre el contenido.
export interface CreationQuickMenuProps { onCreate: (kind: CreationKind) => void; disabled?: boolean; inline?: boolean;
  /** Lo que la sucursal permite crear desde la app (todo, si no se indica). */
  allowed?: CreationKind[];
  /** Nueva OT de un equipo en taller (mismo formulario del Taller); sin esto no se ofrece. */
  onCreateOrder?: () => void; }
type MenuAction = { id: CreationKind | "order"; label: string; detail: string; icon: IconName; tone: string; soft: string };
const actions: MenuAction[] = [
  { id: "work", label: "Nuevo trabajo", detail: "Crea y planifica un trabajo propio", icon: "construct", tone: palette.primary, soft: palette.primarySoft },
  { id: "order", label: "Nueva OT", detail: "Orden de trabajo de un equipo en taller", icon: "document-text", tone: palette.info, soft: palette.infoSoft },
  { id: "maintenance", label: "Nuevo mantenimiento", detail: "Correctivo o detención de un equipo", icon: "build", tone: palette.orange, soft: palette.orangeSoft },
  { id: "non_productive", label: "Tiempo no productivo", detail: "Registra una espera, traslado u otro motivo", icon: "time", tone: palette.violet, soft: palette.violetSoft },
];

export function CreationFloatingButton({ onPress, label, disabled = false, expanded, inline = false }: {
  onPress: () => void; label: string; disabled?: boolean; expanded?: boolean; inline?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded, disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.fab, inline && styles.fabInline, disabled && styles.disabled, pressed && styles.pressed]}>
    <Ionicons name="add" size={inline ? 28 : 30} color={palette.white} accessible={false} />
  </Pressable>;
}

export function CreationQuickMenu({ onCreate, disabled = false, inline = false, allowed, onCreateOrder }: CreationQuickMenuProps) {
  const visible = actions.filter((action) => action.id === "order" ? Boolean(onCreateOrder) : !allowed || allowed.includes(action.id));
  const choose = (action: MenuAction) => { setOpen(false); if (action.id === "order") onCreateOrder?.(); else onCreate(action.id); };
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <>
    {inline ? <CreationFloatingButton inline label="Crear trabajo, mantenimiento o tiempo no productivo" expanded={open} disabled={disabled} onPress={() => setOpen(true)} />
    : <View pointerEvents="box-none" style={[styles.dock, __DEV__ ? { left: Math.max(16, insets.left), bottom: 16 } : { right: Math.max(16, insets.right), bottom: 16 }]}>
      <CreationFloatingButton label="Crear trabajo, mantenimiento o tiempo no productivo" expanded={open} disabled={disabled} onPress={() => setOpen(true)} />
    </View>}
    <Modal visible={open && !disabled} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Cerrar menú de creación" onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
          <View style={styles.header}>
            <View style={styles.headerIcon}><Ionicons name="add" size={24} color={palette.white} accessible={false} /></View>
            <View style={styles.headerText}>
              <Text accessibilityRole="header" style={styles.title}>¿Qué quieres crear?</Text>
              <Text style={styles.subtitle}>Elige una opción para empezar.</Text>
            </View>
            <IconButton name="close-outline" label="Cerrar menú de creación" onPress={() => setOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={styles.list}>
          {visible.map((action) => <Pressable key={action.id} accessibilityRole="button" accessibilityLabel={action.label} accessibilityHint={action.detail}
            onPress={() => choose(action)} style={({ pressed }) => [styles.action, pressed && { borderColor: action.tone, backgroundColor: action.soft }]}>
            <View style={[styles.icon, { backgroundColor: action.soft }]}><Ionicons name={action.icon} size={22} color={action.tone} accessible={false} /></View>
            <View style={styles.text}><Text style={styles.label}>{action.label}</Text><Text style={styles.detail}>{action.detail}</Text></View>
            <View style={styles.chevron}><Ionicons name="chevron-forward" size={16} color={palette.textSecondary} accessible={false} /></View>
          </Pressable>)}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  dock: { position: "absolute", zIndex: 900 }, fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center", boxShadow: "0px 6px 18px rgba(0,126,128,0.3)" },
  fabInline: { width: 48, height: 48, borderRadius: 24, boxShadow: "0px 3px 10px rgba(0,126,128,0.28)" },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.8 }, overlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", alignItems: "center", padding: 18 },
  menu: { width: "100%", maxWidth: 440, maxHeight: "100%", flexShrink: 1, gap: 14, borderRadius: radius.xl, backgroundColor: palette.surface, padding: 18, ...theme.shadow },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  headerText: { flex: 1, minWidth: 0, gap: 2 }, title: { fontSize: 19, lineHeight: 25, fontWeight: "800", color: palette.heading },
  subtitle: { ...typography.caption, color: palette.textSecondary },
  list: { gap: 10 },
  action: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  icon: { width: 46, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 3 }, label: { fontSize: 15, fontWeight: "800", color: palette.heading }, detail: { ...typography.caption, color: palette.textSecondary },
  chevron: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
});