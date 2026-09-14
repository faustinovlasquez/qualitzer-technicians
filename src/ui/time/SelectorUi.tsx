import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrivateModal } from "../../security/DeviceSecurityContext";
import { Button, SectionTitle, type IconName } from "../components";
import { palette, radius, typography } from "../theme";

export interface SelectorPresentation {
  label: string;
  hint?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

export function SelectorTrigger({ label, value, icon, hint, error, containerStyle, disabled, onPress }: SelectorPresentation & {
  value: string; icon: IconName; disabled: boolean; onPress(): void;
}) {
  return <View style={[timeStyles.field, containerStyle]}>
    <Text style={timeStyles.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || "Sin seleccionar"}`}
      accessibilityHint={error ?? hint ?? "Abre el selector, sin escribir"} accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} style={[timeStyles.trigger, disabled && timeStyles.disabled, Boolean(error) && timeStyles.invalid]}>
      <Text style={timeStyles.value}>{value || "Seleccionar"}</Text>
      <Ionicons name={icon} size={22} color={palette.primary} accessible={false} />
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={timeStyles.error}>{error}</Text> : hint ? <Text style={timeStyles.hint}>{hint}</Text> : null}
  </View>;
}

export function SelectionModal({ title, children, onCancel, onConfirm, canConfirm = true }: {
  title: string; children: ReactNode; onCancel(): void; onConfirm(): void; canConfirm?: boolean;
}) {
  return <PrivateModal visible transparent animationType="fade" onRequestClose={onCancel}>
    <SafeAreaView style={timeStyles.overlay}>
      <View style={timeStyles.panel} accessibilityViewIsModal>
        <SectionTitle title={title} />
        <ScrollView contentContainerStyle={timeStyles.content}>{children}</ScrollView>
        <Button title="Confirmar selección" disabled={!canConfirm} onPress={onConfirm} />
        <Button title="Cancelar" variant="secondary" onPress={onCancel} />
      </View>
    </SafeAreaView>
  </PrivateModal>;
}

export function SelectionChip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }} aria-checked={selected}
    onPress={onPress} style={[timeStyles.chip, selected && timeStyles.selected]}>
    <Text style={[timeStyles.label, selected && timeStyles.selectedText]}>{label}</Text>
  </Pressable>;
}

export const timeStyles = StyleSheet.create({
  field: { gap: 8, minWidth: 0 }, label: { ...typography.label, color: palette.text },
  trigger: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, borderRadius: radius.md, padding: 12 },
  value: { ...typography.body, flex: 1, minWidth: 0, color: palette.text },
  hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.caption, color: palette.danger },
  invalid: { borderColor: palette.danger }, disabled: { opacity: 0.55 },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(18,44,58,0.55)" },
  panel: { width: "100%", maxWidth: 480, maxHeight: "100%", minHeight: 0, backgroundColor: palette.surface, padding: 16, borderRadius: radius.lg, gap: 12 },
  content: { gap: 12, paddingVertical: 8 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minWidth: 48, minHeight: 48, padding: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  selected: { backgroundColor: palette.primarySoft, borderColor: palette.primary }, selectedText: { color: palette.primary },
  stepper: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 12 },
  number: { ...typography.heading, minWidth: 64, textAlign: "center", color: palette.text, flexShrink: 1 },
});