import type { ComponentProps, ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_CREATION_CHECKLISTS, type CreationKind, type CreationOptions } from "../../domain/creation";
import { Field } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { CreationForm, CreationFormErrors, FormCatalogResource } from "./creationForm";
import { CreationSelectField } from "./CreationSelectField";

export const creationLabels: { [Kind in CreationKind]: string } = { work: "Nuevo trabajo", maintenance: "Nuevo mantenimiento", non_productive: "Tiempo no productivo" };
export const priorityLabels = { very_high: "Muy alta", high: "Alta", medium: "Media", low: "Baja", very_low: "Muy baja" };
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
  /** Crear trabajo: la especialidad se elige al planificar, no en los datos. */
  hideSpecialty?: boolean;
  showWorkSystem?: boolean;
  equipmentLookup: ReactNode;
  /** Mantenimiento: información general y análisis de falla según el tipo (como la web). */
  maintenanceDetails?: ReactNode;
  onChange: <Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]) => void;
  onSelectCatalog: (resource: FormCatalogResource) => void;
  /** Editar trabajo de mantenimiento: tipo de trabajo, acción, motivo y tiempo asignado (como la web). */
  showClassification?: boolean;
  /** Agregar trabajo a un mantenimiento: misma clasificación, sin tiempo asignado (va en el horario). */
  creatingClassification?: boolean;
  /** El tiempo asignado se escribe aquí solo si el horario no lo define. */
  assignedMinutesEditable?: boolean;
}

type IconName = ComponentProps<typeof Ionicons>["name"];
const PRIORITY_TONES = { very_high: palette.dangerSolid, high: palette.danger, medium: palette.orange, low: palette.success, very_low: palette.info };

/** Fila para elegir de un catálogo: ícono, lo elegido (o qué falta elegir) y un botón para quitarlo. */
export function CatalogPicker({ label, icon, value, placeholder, disabled, locked = false, onPress, onClear }: {
  label: string; icon: IconName; value: string | null; placeholder: string; disabled: boolean; locked?: boolean; onPress: () => void; onClear?: () => void;
}) {
  return <View style={styles.pickerField}>
    <Text style={styles.label}>{label}</Text>
    {/* La "X" va al lado y no dentro del botón: en la web un botón no puede contener otro. */}
    <View style={[styles.picker, styles.pickerRow, value !== null && styles.pickerChosen, (disabled || locked) && styles.disabled]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? "sin elegir"}`} accessibilityState={{ disabled: disabled || locked }} disabled={disabled || locked} onPress={onPress}
        style={({ pressed }) => [styles.pickerMain, pressed && styles.pressed]}>
        <View style={[styles.pickerIcon, value !== null && styles.pickerIconChosen]}>
          <Ionicons name={icon} size={18} color={value !== null ? palette.white : palette.primary} accessible={false} />
        </View>
        <Text style={[styles.pickerValue, value === null && styles.pickerPlaceholder]} numberOfLines={2}>{value ?? placeholder}</Text>
        {value !== null && onClear && !locked ? null : <Ionicons name={locked ? "lock-closed-outline" : "chevron-forward"} size={18} color={palette.textMuted} accessible={false} />}
      </Pressable>
      {value !== null && onClear && !locked ? <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${label.toLowerCase()}`} hitSlop={10} disabled={disabled} onPress={onClear} style={styles.pickerClear}>
        <Ionicons name="close" size={16} color={palette.textSecondary} accessible={false} />
      </Pressable> : null}
    </View>
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

/** Color e ícono de cada tipo, como en la web. */
const MAINTENANCE_TYPE_STYLES: { [Type in CreationForm["maintenanceType"]]: { icon: IconName; tone: string; soft: string } } = {
  detencion: { icon: "alert-circle-outline", tone: palette.danger, soft: palette.dangerSoft },
  correctivo: { icon: "construct-outline", tone: palette.orange, soft: palette.orangeSoft },
  preventivo: { icon: "shield-checkmark-outline", tone: palette.success, soft: palette.successSoft },
  rutinario: { icon: "calendar-outline", tone: palette.info, soft: palette.infoSoft },
  checklist: { icon: "clipboard-outline", tone: palette.teal, soft: palette.primarySoft },
};
const MOTIVE_PLACEHOLDERS: { [Type in CreationForm["maintenanceType"]]: string } = {
  correctivo: "Describe la falla a corregir", detencion: "Describe la falla o el motivo de detención",
  preventivo: "Describe el mantenimiento preventivo a ejecutar", rutinario: "Describe el mantenimiento rutinario a ejecutar",
  checklist: "Describe para qué se aplican las listas",
};
const MAINTENANCE_TYPE_HINTS: { [Type in CreationForm["maintenanceType"]]?: string } = {
  preventivo: "Después de crearlo podrás agregar los ítems de la pauta del equipo desde el trabajo.",
  checklist: "Las listas elegidas quedan en el trabajo para responderlas.",
};
const CHECKLIST_CATEGORIES = [["", "Sin tipo"], ["routine", "Rutinaria"], ["dispatch", "Despacho"], ["return", "Devolución"]] as const;

/** Mantenimiento checklist: tipo de lista (opcional) y las listas que se agregan al trabajo. */
function ChecklistFields({ form, errors, disabled, onChange, onSelectCatalog }: Pick<Props, "form" | "errors" | "disabled" | "onChange" | "onSelectCatalog">) {
  const full = form.checklists.length >= MAX_CREATION_CHECKLISTS;
  return <View style={styles.checklists}>
    <Text style={styles.label}>Tipo de lista de chequeo (opcional)</Text>
    <View style={styles.choices} accessibilityRole="radiogroup">
      {CHECKLIST_CATEGORIES.map(([value, label]) => <CreationChoice key={value} label={label} selected={form.checklistCategory === value} disabled={disabled}
        onPress={() => onChange("checklistCategory", value)} />)}
    </View>
    <Text style={styles.label}>Listas de chequeo *</Text>
    {form.checklists.map((checklist) => <View key={checklist.id} style={styles.checklistRow}>
      <Ionicons name="checkbox-outline" size={18} color={palette.primary} accessible={false} />
      <Text style={styles.checklistLabel} numberOfLines={2}>{checklist.label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${checklist.label}`} hitSlop={10} disabled={disabled}
        onPress={() => onChange("checklists", form.checklists.filter((item) => item.id !== checklist.id))} style={styles.pickerClear}>
        <Ionicons name="close" size={16} color={palette.textSecondary} accessible={false} />
      </Pressable>
    </View>)}
    <Pressable accessibilityRole="button" accessibilityLabel="Agregar lista de chequeo" accessibilityState={{ disabled: disabled || full }} disabled={disabled || full}
      onPress={() => onSelectCatalog("checklists")} style={({ pressed }) => [styles.addChecklist, (disabled || full) && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name="add-circle-outline" size={20} color={palette.primary} accessible={false} />
      <Text style={styles.addChecklistText}>{full ? `Máximo ${MAX_CREATION_CHECKLISTS} listas` : "Agregar lista de chequeo"}</Text>
    </Pressable>
    {errors.checklists ? <Text accessibilityRole="alert" style={styles.error}>{errors.checklists}</Text> : null}
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

/** Clasificación del trabajo de mantenimiento: los mismos catálogos que la web y el tiempo asignado. */
function ClassificationFields({ form, errors, disabled, assignedMinutesEditable, creating, onChange, onSelectCatalog }: Pick<Props, "form" | "errors" | "disabled" | "assignedMinutesEditable" | "onChange" | "onSelectCatalog"> & { creating: boolean }) {
  return <>
    <CatalogPicker label="Tipo de trabajo (opcional)" icon="pricetag-outline" value={form.workType?.label ?? null} placeholder="Elegir tipo de trabajo" disabled={disabled}
      onPress={() => onSelectCatalog("workTypes")} onClear={() => onChange("workType", null)} />
    <CatalogPicker label="Acción (opcional)" icon="build-outline" value={form.action?.label ?? null} placeholder="Elegir acción" disabled={disabled}
      onPress={() => onSelectCatalog("actions")} onClear={() => onChange("action", null)} />
    <CatalogPicker label="Motivo de intervención (opcional)" icon="help-circle-outline" value={form.interventionReason?.label ?? null} placeholder="Elegir motivo" disabled={disabled}
      onPress={() => onSelectCatalog("interventionReasons")} onClear={() => onChange("interventionReason", null)} />
    {/* Al crear, el tiempo asignado se indica en el paso del horario. */}
    {creating ? null : assignedMinutesEditable ? <Field label="Tiempo asignado en minutos (opcional)" value={form.assignedMinutes === null ? "" : String(form.assignedMinutes)} editable={!disabled} keyboardType="number-pad" maxLength={6}
      error={errors.assignedMinutes} placeholder="Ej.: 90" onChangeText={(value) => { const digits = value.replace(/[^0-9]/g, ""); onChange("assignedMinutes", digits === "" ? null : Math.min(Number(digits), 100000)); }} />
      : <Text style={styles.hint}>El tiempo asignado sale del horario del trabajo (paso 2).</Text>}
  </>;
}

export function CreationFields({ kind, form, errors, options, disabled, editing = false, specialtyLocked = false, hideSpecialty = false, showWorkSystem = false, showClassification = false, creatingClassification = false, assignedMinutesEditable = false, equipmentLookup, maintenanceDetails, onChange, onSelectCatalog }: Props) {
  const priority = <CreationSelectField compact={kind === "maintenance"} label={kind === "work" ? "Prioridad *" : "Prioridad"} value={form.priority} disabled={disabled}
    options={(kind === "maintenance" ? options.maintenancePriorities ?? options.priorities : options.priorities).map((level) => ({ value: level, label: priorityLabels[level], tone: PRIORITY_TONES[level] }))}
    onChange={(value) => onChange("priority", value)} />;
  return <View style={styles.fields}>
    {kind === "maintenance" ? <>
      {/* Tipo y prioridad en la misma fila: la prioridad es secundaria y ocupa poco. */}
      <View style={styles.typeRow}>
        <View style={styles.typeCell}><CreationSelectField label="Tipo de mantenimiento *" value={form.maintenanceType} disabled={disabled}
          options={options.maintenanceTypes.map((type) => ({ value: type.value, label: maintenanceLabels[type.value], ...MAINTENANCE_TYPE_STYLES[type.value], disabled: !type.enabled, hint: type.enabled ? undefined : "No disponible desde la app" }))}
          onChange={(value) => onChange("maintenanceType", value)} /></View>
        <View style={styles.priorityCell}>{priority}</View>
      </View>
      {MAINTENANCE_TYPE_HINTS[form.maintenanceType] ? <Text style={styles.hint}>{MAINTENANCE_TYPE_HINTS[form.maintenanceType]}</Text> : null}
      {form.maintenanceType === "checklist" ? <ChecklistFields form={form} errors={errors} disabled={disabled} onChange={onChange} onSelectCatalog={onSelectCatalog} /> : null}
    </> : null}
    {kind !== "non_productive" ? <>
      <Field label={kind === "maintenance" ? "Título (opcional)" : "Título *"} value={form.title} editable={!disabled} maxLength={255} error={errors.title} onChangeText={(value) => onChange("title", value)} placeholder="¿Qué necesitas realizar?" />
      {kind === "work" ? <Field label="Resumen del trabajo (opcional)" value={form.summary} editable={!disabled} maxLength={5000} multiline error={errors.summary}
        onChangeText={(value) => onChange("summary", value)} placeholder="Describe el alcance del trabajo" /> :
        <Field label="Motivo (opcional)" value={form.motive} editable={!disabled} maxLength={5000} multiline error={errors.motive}
          onChangeText={(value) => onChange("motive", value)} placeholder={MOTIVE_PLACEHOLDERS[form.maintenanceType]} />}
      {equipmentLookup}
      {kind === "maintenance" ? null : priority}
      {hideSpecialty ? null : <CatalogPicker label="Especialidad (opcional)" icon="hammer-outline" value={form.specialty?.label ?? null} placeholder="Elegir especialidad" disabled={disabled} locked={specialtyLocked}
        onPress={() => onSelectCatalog("specialties")} onClear={() => onChange("specialty", null)} />}
      {showWorkSystem ? <WorkSystemFields form={form} disabled={disabled} onChange={onChange} onSelectCatalog={onSelectCatalog} /> : null}
      {kind === "maintenance" && maintenanceDetails ? <>
        {maintenanceDetails}
        {errors.maintenanceDetails ? <Text accessibilityRole="alert" style={styles.error}>{errors.maintenanceDetails}</Text> : null}
      </> : null}
      {showClassification ? <ClassificationFields form={form} errors={errors} disabled={disabled} assignedMinutesEditable={assignedMinutesEditable} creating={creatingClassification} onChange={onChange} onSelectCatalog={onSelectCatalog} /> : null}
      {/* El tipo de daño (operacional o desgaste) se indica al entregar el mantenimiento, no al crearlo. */}
      {kind !== "maintenance" && !editing ? <Text style={styles.hint}>Se crea un trabajo propio independiente; no una OT comercial.</Text> : null}
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
  typeRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  typeCell: { flex: 1, minWidth: 0 },
  priorityCell: { width: 128 },
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
  pickerRow: { paddingHorizontal: 0, paddingVertical: 0, paddingRight: 12 },
  pickerMain: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  pickerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  pickerIconChosen: { backgroundColor: palette.primary },
  pickerValue: { flex: 1, fontSize: 15, fontWeight: "700", color: palette.heading },
  pickerPlaceholder: { fontWeight: "500", color: palette.textMuted },
  pickerClear: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  checklists: { gap: 10 },
  checklistRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  checklistLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: palette.heading },
  addChecklist: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.primary },
  addChecklistText: { ...typography.label, color: palette.primary },
  linked: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  linkedIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  linkedText: { flex: 1, minWidth: 0, gap: 3 },
  linkedTitle: { ...typography.overline, color: palette.primary },
  linkedLabel: { fontSize: 16, fontWeight: "800", color: palette.heading },
  linkedHint: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  linkedHintText: { flex: 1, ...typography.caption, color: palette.textSecondary },
});