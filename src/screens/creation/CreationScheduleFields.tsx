import { useState, type ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../ui/components";
import { TimeField } from "../../ui/time/TimeField";
import { palette, radius, typography } from "../../ui/theme";
import { CreationDatePicker } from "./CreationDatePicker";
import { durationText, type CreationForm, type CreationFormErrors } from "./creationForm";

const DURATIONS = [30, 60, 120, 240, 480];
const STEP = 15;
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const toMinutes = (time: string): number | null => /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
const toClock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}
function longDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Sin fecha";
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return `${DAYS[value.getUTCDay()]} ${day} de ${MONTHS[month - 1]}`;
}

function Chip({ label, selected, disabled, onPress, icon }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; icon?: ComponentProps<typeof Ionicons>["name"] }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.chip, selected && styles.chipOn, disabled && styles.disabled, pressed && styles.pressed]}>
    {icon ? <Ionicons name={icon} size={15} color={selected ? palette.white : palette.primary} accessible={false} /> : null}
    <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
  </Pressable>;
}

/**
 * Cuándo y cuánto: el día y el tiempo asignado (lo más común). Las horas de inicio y fin son opcionales y se agregan solo si se conocen;
 * con inicio y tiempo asignado, el fin se calcula solo. Mantenimientos y tiempo no productivo siguen pidiendo inicio y fin.
 */
export function CreationScheduleFields({ form, errors, disabled, optionalTimes, scopeKey, today, onChange }: {
  form: CreationForm; errors: CreationFormErrors; disabled: boolean; optionalTimes: boolean; scopeKey: string; today?: string;
  onChange: <Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]) => void;
}) {
  const [calendar, setCalendar] = useState(false);
  const [withTimes, setWithTimes] = useState(!optionalTimes || Boolean(form.startTime || form.endTime));
  const start = toMinutes(form.startTime);
  const end = toMinutes(form.endTime);
  const ranged = start !== null && end !== null && end > start ? end - start : null;
  const assigned = ranged ?? (form.plannedMinutes || null);
  const base = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null;
  const tomorrow = base ? shiftDate(base, 1) : null;

  function setAssigned(minutes: number | null): void {
    const value = minutes === null ? null : Math.min(Math.max(minutes, STEP), 1439);
    onChange("plannedMinutes", value);
    // Con hora de inicio, el fin acompaña al tiempo asignado (sin pasar de medianoche).
    if (value !== null && start !== null && start + value <= 1439) onChange("endTime", toClock(start + value));
  }
  function setStart(value: string): void {
    onChange("startTime", value);
    const next = toMinutes(value);
    if (next !== null && assigned !== null && next + assigned <= 1439) onChange("endTime", toClock(next + assigned));
  }
  function removeTimes(): void {
    if (ranged !== null) onChange("plannedMinutes", ranged);
    onChange("startTime", ""); onChange("endTime", "");
    setWithTimes(false);
  }

  return <View style={styles.fields}>
    <View style={styles.block}>
      <View style={styles.blockHead}><Ionicons name="calendar-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.blockTitle} accessibilityRole="header">¿Qué día?</Text></View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {base ? <Chip label="Hoy" selected={form.date === base} disabled={disabled} onPress={() => onChange("date", base)} /> : null}
        {tomorrow ? <Chip label="Mañana" selected={form.date === tomorrow} disabled={disabled} onPress={() => onChange("date", tomorrow)} /> : null}
        <Chip label={base && form.date !== base && form.date !== tomorrow && form.date ? longDate(form.date) : "Otra fecha"} icon="calendar-outline"
          selected={Boolean(form.date) && form.date !== base && form.date !== tomorrow} disabled={disabled} onPress={() => setCalendar(true)} />
      </View>
      <Text style={styles.dateText}>{longDate(form.date)}</Text>
      {errors.date ? <Text style={styles.error} accessibilityRole="alert">{errors.date}</Text> : null}
    </View>

    {optionalTimes ? <View style={styles.block}>
      <View style={styles.blockHead}><Ionicons name="hourglass-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.blockTitle} accessibilityRole="header">¿Cuánto tiempo tomará?</Text></View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {DURATIONS.map((minutes) => <Chip key={minutes} label={durationText(minutes)} selected={assigned === minutes} disabled={disabled} onPress={() => setAssigned(minutes)} />)}
      </View>
      <View style={styles.stepper}>
        <Pressable accessibilityRole="button" accessibilityLabel="Restar 15 minutos" disabled={disabled || assigned === null || assigned <= STEP} onPress={() => setAssigned((assigned ?? STEP) - STEP)}
          style={({ pressed }) => [styles.stepButton, (disabled || assigned === null || assigned <= STEP) && styles.disabled, pressed && styles.pressed]}>
          <Ionicons name="remove" size={20} color={palette.primary} accessible={false} />
        </Pressable>
        <View style={styles.stepValue}>
          <Text style={styles.stepValueText} accessibilityLiveRegion="polite">{assigned === null ? "Sin tiempo asignado" : durationText(assigned)}</Text>
          <Text style={styles.hint}>{ranged !== null ? "Según el horario elegido" : "Tiempo asignado"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Sumar 15 minutos" disabled={disabled || (assigned ?? 0) + STEP > 1439} onPress={() => setAssigned((assigned ?? 0) + STEP)}
          style={({ pressed }) => [styles.stepButton, (disabled || (assigned ?? 0) + STEP > 1439) && styles.disabled, pressed && styles.pressed]}>
          <Ionicons name="add" size={20} color={palette.primary} accessible={false} />
        </Pressable>
      </View>
      {assigned !== null && ranged === null ? <Button title="Quitar tiempo asignado" variant="ghost" disabled={disabled} onPress={() => setAssigned(null)} /> : null}
    </View> : null}

    {withTimes ? <View style={styles.block}>
      <View style={styles.blockHead}>
        <Ionicons name="time-outline" size={18} color={palette.primary} accessible={false} />
        <Text style={styles.blockTitle} accessibilityRole="header">{optionalTimes ? "Horario (opcional)" : "Horario"}</Text>
        {optionalTimes ? <Pressable accessibilityRole="button" accessibilityLabel="Quitar horario" disabled={disabled} hitSlop={8} onPress={removeTimes} style={styles.removeLink}>
          <Ionicons name="close" size={14} color={palette.textSecondary} accessible={false} /><Text style={styles.removeText}>Quitar</Text>
        </Pressable> : null}
      </View>
      <View style={styles.timeRow}>
        <View style={styles.grow}>
          <TimeField label={optionalTimes ? "Inicio" : "Hora de inicio *"} value={form.startTime} disabled={disabled} error={errors.startTime} onChange={setStart} scopeKey={scopeKey} />
        </View>
        <View style={styles.grow}>
          <TimeField label={optionalTimes ? "Fin" : "Hora de fin *"} value={form.endTime} disabled={disabled} error={errors.endTime} onChange={(value) => onChange("endTime", value)} scopeKey={scopeKey} />
        </View>
      </View>
      {optionalTimes ? <Text style={styles.hint}>Si eliges el inicio, el fin se calcula con el tiempo asignado. Puedes cambiarlo.</Text> : null}
    </View> : <Pressable accessibilityRole="button" disabled={disabled} onPress={() => setWithTimes(true)} style={({ pressed }) => [styles.addTimes, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name="add-circle-outline" size={20} color={palette.primary} accessible={false} />
      <View style={styles.grow}>
        <Text style={styles.addTimesTitle}>Agregar hora de inicio y fin</Text>
        <Text style={styles.hint}>Solo si ya sabes a qué hora se hará.</Text>
      </View>
    </Pressable>}
    {calendar && !disabled ? <CreationDatePicker value={form.date} onChange={value => onChange("date", value)} onClose={() => setCalendar(false)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  fields: { gap: 18 },
  block: { gap: 10 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  blockTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: palette.heading },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.primary, backgroundColor: palette.primary },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  dateText: { ...typography.caption, color: palette.textSecondary, textTransform: "capitalize" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: radius.md, backgroundColor: palette.primarySoft },
  stepButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  stepValue: { flex: 1, alignItems: "center" },
  stepValueText: { fontSize: 18, fontWeight: "800", color: palette.heading },
  timeRow: { flexDirection: "row", gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  removeLink: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.track },
  removeText: { fontSize: 12, fontWeight: "700", color: palette.textSecondary },
  addTimes: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.primaryBorder },
  addTimesTitle: { fontSize: 14, fontWeight: "800", color: palette.primary },
  hint: { ...typography.caption, color: palette.textSecondary },
  error: { ...typography.caption, color: palette.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 }
});
