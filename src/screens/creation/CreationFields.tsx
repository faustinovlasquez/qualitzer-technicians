import type { ComponentProps, ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CreationCatalogResource, CreationKind, CreationOptions } from "../../domain/creation";
import { Field } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { CreationForm, CreationFormErrors } from "./creationForm";

export const creationLabels: { [Kind in CreationKind]: string } = { work: "Nuevo trabajo", maintenance: "Nuevo mantenimiento", non_productive: "Tiempo no productivo" };
export const priorityLabels = { low: "Baja", medium: "Media", high: "Alta" };
const maintenanceLabels = { correctivo: "Correctivo", detencion: "Detención", preventivo: "Preventivo", rutinario: "Rutinario", checklist: "Checklist" };

export function CreationChoice({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.choice, selected && styles.selected, disabled && styles.disabled]}><Text style={[styles.choiceText, selected && styles.selectedText]}>{label}</Text></Pressable>;
}

interface Props {
  kind: CreationKind;
  form: CreationForm;
  errors: CreationFormErrors;
  options: CreationOptions;
  disabled: boolean;
  editing?: boolean;
  specialtyLocked?: boolean;
  showWorkSystem?: boolean;
  equipmentLookup: ReactNode;
  onChange: <Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]) => void;
  onSelectCatalog: (resource: CreationCatalogResource) => void;
}

type IconName = ComponentProps<typeof Ionicons>["name"];
const PRIORITY_TONES = { low: palette.success, medium: palette.orange, high: palette.danger };

/** Fila para elegir de un catálogo: ícono, lo elegido (o qué falta elegir) y un botón para quitarlo. */
export function CatalogPicker({ label, icon, value, placeholder, disabled, locked = false, onPress, onClear }: {
  label: string; icon: IconName; value: string | null; placeholder: string; disabled: boolean; locked?: boolean; onPress: () => void; onClear?: () => void;
}) {
  return <View style={styles.pickerField}>
    <Text style={styles.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? "sin elegir"}`} accessibilityState={{ disabled: disabled || locked }} disabled={disabled || locked} onPress={onPress}
      style={({ pressed }) => [styles.picker, value !== null && styles.pickerChosen, (disabled || locked) && styles.disabled, pressed && styles.pressed]}>
      <View style={[styles.pickerIcon, value !== null && styles.pickerIconChosen]}>
        <Ionicons name={icon} size={18} color={value !== null ? palette.white : palette.primary} accessible={false} />
      </View>
      <Text style={[styles.pickerValue, value === null && styles.pickerPlaceholder]} numberOfLines={2}>{value ?? placeholder}</Text>
      {value !== null && onClear && !locked ? <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${label.toLowerCase()}`} hitSlop={10} disabled={disabled} onPress={onClear} style={styles.pickerClear}>
        <Ionicons name="close" size={16} color={palette.textSecondary} accessible={false} />
      </Pressable> : <Ionicons name={locked ? "lock-closed-outline" : "chevron-forward"} size={18} color={palette.textMuted} accessible={false} />}
    </Pressable>
  </View>;
}

/** Equipo que viene del padre (ingreso o mantenimiento): se muestra fijo, no se elige. */
export function LinkedEquipmentCard({ title, label, detail, hint }: { title: string; label: string; detail?: string | null; hint: string }) {
  return <View style={styles.linked}>
    <View style={styles.linkedIcon}><Ionicons name="construct" size={20} color={palette.white} accessible={false} /></View>
    <View style={styles.linkedText}>
      <Text style={styles.linkedTitle}>{title}</Text>
      <Text style={styles.linkedLabel} numberOfLines={2}>{label}</Text>
      {detail ? <Text style={styles.hint}>{detail}</Text> : null}
      <View style={styles.linkedHint}><Ionicons name="link-outline" size={13} color={palette.primary} accessible={false} /><Text style={styles.linkedHintText}>{hint}</Text></View>
    </View>
  </View>;
}

function WorkSystemFields({ form, disabled, onChange, onSelectCatalog }: Pick<Props, "form" | "disabled" | "onChange" | "onSelectCatalog">) {
  return <>
    <CatalogPicker label="Sistema (opcional)" icon="git-network-outline" value={form.system?.label ?? null} placeholder="Elegir sistema" disabled={disabled}
      onPress={() => onSelectCatalog("systems")} onClear={() => { onChange("system", null); onChange("component", null); }} />
    <CatalogPicker label="Subsistema (opcional)" icon="layers-outline" value={form.component?.label ?? null} placeholder={form.system ? "Elegir subsistema" : "Elige primero un sistema"}
      disabled={disabled || !form.system} onPress={() => onSelectCatalog("components")} onClear={() => onChange("component", null)} />
  </>;
}

export function CreationFields({ kind, form, errors, options, disabled, editing = false, specialtyLocked = false, showWorkSystem = false, equipmentLookup, onChange, onSelectCatalog }: Props) {
  return <View style={styles.fields}>
    {kind === "maintenance" ? <>
      <Text style={styles.label}>Tipo de mantenimiento *</Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {options.maintenanceTypes.map((type) => <CreationChoice key={type.value} label={maintenanceLabels[type.value]} selected={type.value === form.maintenanceType}
          disabled={disabled || !type.enabled || (type.value !== "correctivo" && type.value !== "detencion")}
          onPress={() => { if (type.value === "correctivo" || type.value === "detencion") onChange("maintenanceType", type.value); }} />)}
      </View>
      <Text style={styles.hint}>Preventivo, rutinario y checklist requieren el asistente web para aplicar pautas, rutinas o listas. No se pueden crear desde este formulario.</Text>
    </> : null}
    {kind !== "non_productive" ? <>
      <Field label="Título *" value={form.title} editable={!disabled} maxLength={255} error={errors.title} onChangeText={(value) => onChange("title", value)} placeholder="¿Qué necesitas realizar?" />
      {kind === "work" ? <Field label="Resumen del trabajo (opcional)" value={form.summary} editable={!disabled} maxLength={5000} multiline error={errors.summary}
        onChangeText={(value) => onChange("summary", value)} placeholder="Describe el alcance del trabajo" /> :
        <Field label="Motivo del mantenimiento *" value={form.motive} editable={!disabled} maxLength={5000} multiline error={errors.motive}
          onChangeText={(value) => onChange("motive", value)} placeholder="Describe la falla o el motivo de detención" />}
      {equipmentLookup}
      <Text style={styles.label}>Prioridad{kind === "work" ? " *" : ""}</Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {options.priorities.map((priority) => <Pressable key={priority} accessibilityRole="radio" accessibilityLabel={priorityLabels[priority]} accessibilityState={{ checked: form.priority === priority, disabled }}
          disabled={disabled} onPress={() => onChange("priority", priority)}
          style={[styles.priority, form.priority === priority && { borderColor: PRIORITY_TONES[priority], backgroundColor: PRIORITY_TONES[priority] }, disabled && styles.disabled]}>
          <View style={[styles.priorityDot, { backgroundColor: form.priority === priority ? palette.white : PRIORITY_TONES[priority] }]} />
          <Text style={[styles.choiceText, form.priority === priority && styles.priorityTextOn]}>{priorityLabels[priority]}</Text>
        </Pressable>)}
      </View>
      <CatalogPicker label="Especialidad (opcional)" icon="hammer-outline" value={form.specialty?.label ?? null} placeholder="Elegir especialidad" disabled={disabled} locked={specialtyLocked}
        onPress={() => onSelectCatalog("specialties")} onClear={() => onChange("specialty", null)} />
      {showWorkSystem ? <WorkSystemFields form={form} disabled={disabled} onChange={onChange} onSelectCatalog={onSelectCatalog} /> : null}
      {kind === "maintenance" ? <>
        <Text style={styles.label}>Tipo de daño (opcional)</Text>
        <View style={styles.choices} accessibilityRole="radiogroup">
          <CreationChoice label="Sin especificar" selected={!form.damageType} disabled={disabled} onPress={() => onChange("damageType", "")} />
          <CreationChoice label="Operacional" selected={form.damageType === "operacional"} disabled={disabled} onPress={() => onChange("damageType", "operacional")} />
          <CreationChoice label="Desgaste" selected={form.damageType === "desgaste"} disabled={disabled} onPress={() => onChange("damageType", "desgaste")} />
        </View>
      </> : !editing ? <Text style={styles.hint}>Se crea un trabajo propio independiente; no una OT comercial.</Text> : null}
    </> : <>
      <Text style={styles.label}>Motivo *</Text>
      <View style={styles.reasons} accessibilityRole="radiogroup">
        {options.nonProductiveReasons.map((reason) => <CreationChoice key={reason.value} label={reason.label} selected={form.reason === reason.value} disabled={disabled} onPress={() => onChange("reason", reason.value)} />)}
      </View>
      <Field label={form.reason === "other" ? "Explica el motivo *" : "Detalle del motivo (opcional)"} value={form.reasonText} editable={!disabled} maxLength={500} multiline
        error={errors.reasonText} onChangeText={(value) => onChange("reasonText", value)} />
      <Field label="Comentario inicial (opcional)" value={form.initialComment} editable={!disabled} maxLength={5000} multiline error={errors.initialComment}
        onChangeText={(value) => onChange("initialComment", value)} hint="Se guardará como comentario técnico del trabajo." />
    </>}
    <Text style={styles.hint}>* Campos obligatorios. No incluyas contraseñas, credenciales ni datos sensibles.</Text>
  </View>;
}

const styles = StyleSheet.create({
  fields: { gap: 14 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, reasons: { gap: 8 },
  choice: { minHeight: 48, justifyContent: "center", paddingHorizontal: 15, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  selected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, selectedText: { color: palette.primary, fontWeight: "700" },
  disabled: { opacity: 0.55 }, choiceText: { ...typography.label, color: palette.text }, label: { ...typography.label, color: palette.text },
  hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.caption, color: palette.danger },
  pressed: { opacity: 0.8 },
  priority: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  priorityDot: { width: 9, height: 9, borderRadius: 5 },
  priorityTextOn: { color: palette.white, fontWeight: "800" },
  pickerField: { gap: 6 },
  picker: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  pickerChosen: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  pickerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  pickerIconChosen: { backgroundColor: palette.primary },
  pickerValue: { flex: 1, fontSize: 15, fontWeight: "700", color: palette.heading },
  pickerPlaceholder: { fontWeight: "500", color: palette.textMuted },
  pickerClear: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  linked: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  linkedIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  linkedText: { flex: 1, minWidth: 0, gap: 3 },
  linkedTitle: { ...typography.overline, color: palette.primary },
  linkedLabel: { fontSize: 16, fontWeight: "800", color: palette.heading },
  linkedHint: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  linkedHintText: { flex: 1, ...typography.caption, color: palette.textSecondary },
});