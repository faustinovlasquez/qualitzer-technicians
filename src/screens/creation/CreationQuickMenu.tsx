import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { CreationKind } from "../../domain/creation";
import { IconButton, type IconName } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";

export interface CreationQuickMenuProps { onCreate: (kind: CreationKind) => void; disabled?: boolean; }
const actions: { kind: CreationKind; label: string; detail: string; icon: IconName }[] = [
  { kind: "work", label: "Nuevo trabajo", detail: "Crea y planifica un trabajo propio", icon: "construct-outline" },
  { kind: "maintenance", label: "Nuevo mantenimiento", detail: "Correctivo o detención de un equipo", icon: "build-outline" },
  { kind: "non_productive", label: "Tiempo no productivo", detail: "Registra una espera, traslado u otro motivo", icon: "time-outline" },
];

export function CreationFloatingButton({ onPress, label, disabled = false, expanded }: {
  onPress: () => void; label: string; disabled?: boolean; expanded?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded, disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.fab, disabled && styles.disabled, pressed && styles.pressed]}>
    <Ionicons name="add" size={30} color={palette.white} accessible={false} />
  </Pressable>;
}

export function CreationQuickMenu({ onCreate, disabled = false }: CreationQuickMenuProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <>
    <View pointerEvents="box-none" style={[styles.dock, __DEV__ ? { left: Math.max(16, insets.left), bottom: 16 } : { right: Math.max(16, insets.right), bottom: 16 }]}>
      <CreationFloatingButton label="Crear trabajo, mantenimiento o tiempo no productivo" expanded={open} disabled={disabled} onPress={() => setOpen(true)} />
    </View>
    <Modal visible={open && !disabled} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Cerrar menú de creación" onPress={() => setOpen(false)} />
        <View style={styles.menu} accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
          <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Crear</Text><IconButton name="close-outline" label="Cerrar menú de creación" onPress={() => setOpen(false)} /></View>
          <ScrollView>
          {actions.map((action) => <Pressable key={action.kind} accessibilityRole="button" accessibilityLabel={action.label} accessibilityHint={action.detail}
            onPress={() => { setOpen(false); onCreate(action.kind); }} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <View style={styles.icon}><Ionicons name={action.icon} size={23} color={palette.primary} accessible={false} /></View>
            <View style={styles.text}><Text style={styles.label}>{action.label}</Text><Text style={styles.detail}>{action.detail}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={palette.textMuted} accessible={false} />
          </Pressable>)}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  dock: { position: "absolute", zIndex: 900 }, fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center", boxShadow: "0px 6px 18px rgba(0,126,128,0.3)" },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.8 }, overlay: { flex: 1, backgroundColor: "rgba(18,44,58,0.5)", justifyContent: "flex-end", alignItems: "center", padding: 16 },
  menu: { width: "100%", maxWidth: 460, maxHeight: "100%", flexShrink: 1, borderRadius: radius.lg, backgroundColor: palette.surface, padding: 12, ...theme.shadow },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 12 }, title: { ...typography.heading, color: palette.text },
  action: { minHeight: 84, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.md },
  icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 4 }, label: { ...typography.label, color: palette.text }, detail: { ...typography.caption, color: palette.textSecondary },
});