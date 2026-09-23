import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CreationKind, CreationOptions } from "../../domain/creation";
import { Button, Field } from "../../ui/components";
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
  equipmentLookup: ReactNode;
  onChange: <Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]) => void;
  onSelectCatalog: (resource: "equipment" | "specialties") => void;
}

export function CreationFields({ kind, form, errors, options, disabled, editing = false, specialtyLocked = false, equipmentLookup, onChange, onSelectCatalog }: Props) {
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
        {options.priorities.map((priority) => <CreationChoice key={priority} label={priorityLabels[priority]} selected={form.priority === priority} disabled={disabled} onPress={() => onChange("priority", priority)} />)}
      </View>
      <Text style={styles.label}>Especialidad (opcional)</Text>
      <Button title={form.specialty?.label ?? "Seleccionar especialidad"} variant="secondary" icon="construct-outline" disabled={disabled || specialtyLocked} onPress={() => onSelectCatalog("specialties")} />
      {form.specialty && !specialtyLocked ? <Button title="Quitar especialidad" variant="ghost" disabled={disabled} onPress={() => onChange("specialty", null)} /> : null}
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
});