import { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { CatalogResource, CreationOptions, CreationOptionsQuery } from "../../domain/creation";
import { hasDowntime, hasFailureAnalysis, LEVEL_LABELS, type MaintenanceDetailsDraft, type MaintenanceLevel } from "../../domain/maintenanceInfo";
import { Button, Field } from "../../ui/components";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { TimeField } from "../../ui/time/TimeField";
import { palette, radius, typography } from "../../ui/theme";
import { CreationCatalogSelector, type CreationCatalogCache } from "./CreationCatalogSelector";
import { CreationDatePicker } from "./CreationDatePicker";
import { CreationSelectField } from "./CreationSelectField";

export interface CatalogAccess {
  companyBranchId: number;
  userId: number;
  workerId: number | null;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
}

export const LEVELS: MaintenanceLevel[] = ["very_high", "high", "medium", "low", "very_low"];
export const LEVEL_TONES: Record<MaintenanceLevel, string> = { very_high: palette.dangerSolid, high: palette.danger, medium: palette.orange, low: palette.success, very_low: palette.info };
type Option = { id: number; label: string } | null;
type CatalogField = "system" | "failureCause" | "detectionMethod" | "causedDamageType" | "asset";

export function Chips<T extends string>({ items, value, labels, tones, onChange, disabled, emptyLabel }: {
  items: T[]; value: T | null; labels: Record<T, string>; tones?: Record<T, string>; onChange: (value: T | null) => void; disabled: boolean; emptyLabel?: string;
}) {
  return <View style={styles.chips} accessibilityRole="radiogroup">
    {emptyLabel ? <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === null, disabled }} disabled={disabled} onPress={() => onChange(null)}
      style={[styles.chip, value === null && styles.chipOn]}><Text style={[styles.chipText, value === null && styles.chipTextOn]}>{emptyLabel}</Text></Pressable> : null}
    {items.map((item) => {
      const selected = value === item;
      const tone = tones?.[item];
      return <Pressable key={item} accessibilityRole="radio" accessibilityLabel={labels[item]} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={() => onChange(item)}
        style={[styles.chip, selected && (tone ? { backgroundColor: tone, borderColor: tone } : styles.chipOn)]}>
        {tone ? <View style={[styles.dot, { backgroundColor: selected ? palette.white : tone }]} /> : null}
        <Text style={[styles.chipText, selected && (tone ? styles.chipTextWhite : styles.chipTextOn)]}>{labels[item]}</Text>
      </Pressable>;
    })}
  </View>;
}

function Picker({ label, value, onPress, onClear, disabled }: { label: string; value: Option; onPress: () => void; onClear: () => void; disabled: boolean }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {/* La "X" va al lado y no dentro del botón: en la web un botón no puede contener otro. */}
    <View style={[styles.picker, styles.pickerRow, value && styles.pickerChosen]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value?.label ?? "sin elegir"}`} disabled={disabled} onPress={onPress} style={styles.pickerMain}>
        <Text style={[styles.pickerText, !value && styles.placeholder]} numberOfLines={2}>{value?.label ?? "Elegir"}</Text>
        {value ? null : <Ionicons name="chevron-forward" size={18} color={palette.textMuted} accessible={false} />}
      </Pressable>
      {value ? <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${label.toLowerCase()}`} hitSlop={10} disabled={disabled} onPress={onClear} style={styles.pickerClear}>
        <Ionicons name="close" size={18} color={palette.textSecondary} accessible={false} />
      </Pressable> : null}
    </View>
  </View>;
}

function DateTimeInput({ label, date, time, onChange, disabled, scopeKey, hint }: {
  label: string; date: string; time: string; onChange: (date: string, time: string) => void; disabled: boolean; scopeKey: string; hint?: string;
}) {
  const [calendar, setCalendar] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.dateRow}>
      <View style={styles.dateBox}><SelectorTrigger label="Fecha" icon="calendar-outline" value={date ? date.split("-").reverse().join("-") : ""} disabled={disabled} onPress={() => setCalendar(true)} /></View>
      <View style={styles.dateBox}><TimeField label="Hora" value={time} scopeKey={scopeKey} disabled={disabled} onChange={(value) => onChange(date, value)} /></View>
    </View>
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    {calendar ? <CreationDatePicker value={date} onChange={(value) => onChange(value, time)} onClose={() => setCalendar(false)} /> : null}
  </View>;
}

function CheckRow({ label, hint, checked, disabled, onPress }: { label: string; hint?: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} aria-checked={checked} disabled={disabled} onPress={onPress}
    style={[styles.checkRow, checked && styles.checkRowOn]}>
    <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? palette.primary : palette.textMuted} accessible={false} />
    <View style={styles.checkText}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  </Pressable>;
}

/**
 * Campos de "Información general" del mantenimiento según el tipo, como la web: instrucciones; en detención y correctivo,
 * fecha de reporte, solicitado por y análisis de la falla; en detención, "detenido desde" y otros activos afectados.
 * Se usa al crear el mantenimiento y al editar su información.
 */
export function MaintenanceDetailsFields({ type, value, onChange, disabled, catalogs, scopeKey, equipmentId, creating = false }: {
  type: string; value: MaintenanceDetailsDraft; onChange: (patch: Partial<MaintenanceDetailsDraft>) => void; disabled: boolean;
  catalogs: CatalogAccess | null; scopeKey: string; equipmentId?: number | null;
  /** Al crear, fecha y "detenido desde" vacíos usan la hora de creación. */
  creating?: boolean;
}) {
  const [catalog, setCatalog] = useState<{ resource: CatalogResource; field: CatalogField } | null>(null);
  const cache = useRef<CreationCatalogCache>(new Map());
  const showFailure = hasFailureAnalysis(type);
  const showDowntime = hasDowntime(type);
  const hasFailureData = value.system !== null || value.failureCause !== null || value.detectionMethod !== null || value.failureSeverity !== null || value.causedDamageType !== null;
  // Al crear, el análisis de la falla queda plegado: se abre solo si el técnico quiere agregarlo (o si el borrador ya trae datos).
  const [failureOpen, setFailureOpen] = useState(!creating || hasFailureData);
  // Al crear, las fechas también quedan plegadas: sin marcar, se usa la hora de creación (lo habitual).
  const hasDateData = value.reportedDate !== "" || value.reportedTime !== "" || value.downtimeDate !== "" || value.downtimeTime !== "";
  const [datesOpen, setDatesOpen] = useState(!creating || hasDateData);
  function toggleDates(): void {
    if (datesOpen) onChange({ reportedDate: "", reportedTime: "", downtimeDate: "", downtimeTime: "" });
    setDatesOpen(!datesOpen);
  }
  function toggleFailure(): void {
    if (failureOpen) onChange({ system: null, failureCause: null, detectionMethod: null, failureSeverity: null, causedDamageType: null });
    setFailureOpen(!failureOpen);
  }
  return <View style={styles.stack}>
    {/* Al crear no se piden instrucciones: se agregan después en la pestaña Información. */}
    {creating ? null : <Field label="Instrucciones para el personal (opcional)" value={value.instructions} maxLength={5000} multiline editable={!disabled}
      placeholder="Indicaciones para realizar el mantenimiento" onChangeText={(text) => onChange({ instructions: text })} />}
    {showFailure ? <Field label="Solicitado por (opcional)" value={value.requestedBy} maxLength={255} editable={!disabled} placeholder="Nombre de quien solicita"
      onChangeText={(text) => onChange({ requestedBy: text })} /> : null}
    {showFailure ? <>
      {creating ? <CheckRow label="Indicar otra fecha y hora (opcional)"
        hint={showDowntime ? "Fecha de reporte y desde cuándo está detenido. Si no lo marcas, se usa la hora de creación." : "Fecha de reporte. Si no lo marcas, se usa la hora de creación."}
        checked={datesOpen} disabled={disabled} onPress={toggleDates} /> : null}
      {datesOpen ? <View style={creating ? styles.nested : styles.stack}>
        <DateTimeInput label={creating ? "Fecha de reporte (opcional)" : "Fecha de reporte *"} date={value.reportedDate} time={value.reportedTime} disabled={disabled} scopeKey={`${scopeKey}:reported`}
          hint={creating ? "Si la dejas vacía, se usa la hora de creación." : undefined} onChange={(date, time) => onChange({ reportedDate: date, reportedTime: time })} />
        {showDowntime ? <DateTimeInput label={creating ? "Detenido desde (opcional)" : "Detenido desde *"} date={value.downtimeDate} time={value.downtimeTime} disabled={disabled} scopeKey={`${scopeKey}:downtime`}
          hint={creating ? "Si lo dejas vacío, se usa la fecha de reporte." : undefined} onChange={(date, time) => onChange({ downtimeDate: date, downtimeTime: time })} /> : null}
      </View> : null}
    </> : null}
    {showFailure ? <>
      {creating ? <CheckRow label="Agregar análisis de la falla (opcional)" hint="Sistema, causa, método de detección, severidad y tipo de daño."
        checked={failureOpen} disabled={disabled} onPress={toggleFailure} /> : <Text style={styles.sectionTitle}>Análisis de la falla (opcional)</Text>}
      {failureOpen ? <View style={creating ? styles.nested : undefined}>
      {catalogs ? <>
        <Picker label="Sistema (opcional)" value={value.system} disabled={disabled} onPress={() => setCatalog({ resource: "systems", field: "system" })} onClear={() => onChange({ system: null })} />
        <Picker label="Causa de falla (opcional)" value={value.failureCause} disabled={disabled} onPress={() => setCatalog({ resource: "failureCauses", field: "failureCause" })} onClear={() => onChange({ failureCause: null })} />
        <Picker label="Método de detección (opcional)" value={value.detectionMethod} disabled={disabled} onPress={() => setCatalog({ resource: "detectionMethods", field: "detectionMethod" })} onClear={() => onChange({ detectionMethod: null })} />
      </> : <Text style={styles.hint}>Los catálogos no están disponibles en este momento.</Text>}
      <CreationSelectField label="Severidad de la falla (opcional)" value={value.failureSeverity ?? "none"} disabled={disabled}
        options={[{ value: "none" as const, label: "Sin definir" }, ...LEVELS.map((level) => ({ value: level, label: LEVEL_LABELS[level], tone: LEVEL_TONES[level] }))]}
        onChange={(level) => onChange({ failureSeverity: level === "none" ? null : level })} />
      {catalogs ? <Picker label="Tipo de daño causado (opcional)" value={value.causedDamageType} disabled={disabled} onPress={() => setCatalog({ resource: "causedDamageTypes", field: "causedDamageType" })} onClear={() => onChange({ causedDamageType: null })} /> : null}
      </View> : null}
    </> : null}
    {showDowntime ? <>
      {creating ? null : <Text style={styles.sectionTitle}>Otros activos afectados</Text>}
      <View style={styles.switchRow}>
        <Text style={styles.label}>¿Afecta a otros activos? (opcional)</Text>
        <Switch value={value.affectsOtherAssets} disabled={disabled} onValueChange={(on) => onChange({ affectsOtherAssets: on })}
          trackColor={{ true: palette.primary, false: palette.border }} accessibilityLabel="¿Afecta a otros activos?" />
      </View>
      {value.affectsOtherAssets ? <>
        <Field label="Tiempo de interrupción en minutos (opcional)" value={value.interruptionMinutes} keyboardType="number-pad" maxLength={7} editable={!disabled}
          onChangeText={(text) => onChange({ interruptionMinutes: text.replace(/[^0-9]/g, "") })} />
        <Text style={styles.label}>Equipos e implementos afectados (opcional)</Text>
        {value.affectedAssets.length === 0 ? <Text style={styles.hint}>Busca por número interno, identificación, tipo o código del implemento.</Text> : null}
        {value.affectedAssets.map((asset) => <View key={asset.id} style={styles.assetRow}>
          <Text style={styles.pickerText} numberOfLines={2}>{asset.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${asset.label}`} hitSlop={10} disabled={disabled}
            onPress={() => onChange({ affectedAssets: value.affectedAssets.filter((item) => item.id !== asset.id) })}>
            <Ionicons name="close" size={18} color={palette.textSecondary} accessible={false} />
          </Pressable>
        </View>)}
        {catalogs ? <Button title="Agregar equipo o implemento" icon="add-circle-outline" variant="secondary" disabled={disabled || value.affectedAssets.length >= 50}
          onPress={() => setCatalog({ resource: "equipment", field: "asset" })} /> : null}
      </> : null}
    </> : null}

    {catalog && catalogs && !disabled ? <CreationCatalogSelector resource={catalog.resource} companyBranchId={catalogs.companyBranchId} userId={catalogs.userId} workerId={catalogs.workerId}
      cache={cache.current} onLoadOptions={catalogs.onLoadOptions} onClose={() => setCatalog(null)} title={catalog.field === "asset" ? "Equipo o implemento afectado" : undefined}
      excludeIds={catalog.field === "asset" ? [...(equipmentId ? [equipmentId] : []), ...value.affectedAssets.map((asset) => asset.id)] : []}
      selected={catalog.field === "asset" ? null : value[catalog.field]}
      onSelect={(item) => {
        const option = { id: item.id, label: item.label };
        if (catalog.field === "asset") onChange({ affectedAssets: [...value.affectedAssets, option] });
        else onChange({ [catalog.field]: option });
      }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  sectionTitle: { ...typography.label, color: palette.heading, fontWeight: "800", marginTop: 4 },
  hint: { ...typography.caption, color: palette.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  chipText: { ...typography.label, color: palette.text },
  chipTextOn: { color: palette.primary, fontWeight: "700" },
  chipTextWhite: { color: palette.white, fontWeight: "800" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  picker: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  pickerChosen: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  pickerRow: { paddingHorizontal: 0 },
  pickerMain: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  pickerClear: { paddingHorizontal: 12, minHeight: 48, justifyContent: "center" },
  pickerText: { flex: 1, fontSize: 15, fontWeight: "600", color: palette.heading },
  placeholder: { color: palette.textMuted, fontWeight: "500" },
  dateRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", flexWrap: "wrap" },
  dateBox: { flex: 1, minWidth: 140 },
  nested: { gap: 12, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: palette.primaryBorder },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  checkRowOn: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  checkText: { flex: 1, gap: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  assetRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
});
