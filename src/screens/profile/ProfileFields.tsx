import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BIRTHDATE_MIN_YEAR } from "../../domain/ownProfile";
import { SelectionChip, SelectionModal, SelectorTrigger, timeStyles } from "../../ui/time/SelectorUi";
import { palette, radius, typography } from "../../ui/theme";
import type { IconName } from "../../ui/components";

type Option = { value: string; label: string };

/** Opciones cortas (genero, grupo sanguineo): chips en linea, un toque selecciona y otro deselecciona. */
export function ChoiceChips({ label, options, value, disabled, onChange }: { label: string; options: ReadonlyArray<Option>; value: string | null; disabled: boolean; onChange(value: string | null): void }) {
  return <View style={styles.group}>
    <Text style={timeStyles.label}>{label}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
      {options.map(option => {
        const selected = option.value === value;
        return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: selected, disabled }} aria-checked={selected}
          disabled={disabled} onPress={() => onChange(selected ? null : option.value)} style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}>
          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

/** Opciones largas (nacionalidad, estado civil): selector que abre un modal. */
export function OptionField({ label, icon, options, value, disabled, onChange }: { label: string; icon: IconName; options: ReadonlyArray<Option>; value: string | null; disabled: boolean; onChange(value: string | null): void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);
  const current = options.find(option => option.value === value)?.label ?? "";
  return <>
    <SelectorTrigger label={label} value={current} icon={icon} disabled={disabled} hint="Opcional" onPress={() => { setDraft(value); setOpen(true); }} />
    {open ? <SelectionModal title={label} onCancel={() => setOpen(false)} onConfirm={() => { onChange(draft); setOpen(false); }}>
      <View style={timeStyles.grid}>
        <SelectionChip label="Sin especificar" selected={draft === null} onPress={() => setDraft(null)} />
        {options.map(option => <SelectionChip key={option.value} label={option.label} selected={draft === option.value} onPress={() => setDraft(option.value)} />)}
      </View>
    </SelectionModal> : null}
  </>;
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function formatBirthdate(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return `${day} de ${MONTHS[month - 1]?.toLowerCase() ?? ""} de ${year}`;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Fecha de nacimiento por dia/mes/año: mas rapido que paginar un calendario decenas de años. */
export function BirthdateField({ value, disabled, onChange }: { value: string | null; disabled: boolean; onChange(value: string | null): void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ year: number | null; month: number | null; day: number | null }>({ year: null, month: null, day: null });
  const now = new Date();
  const thisYear = now.getFullYear();
  // Colaboradores en edad laboral: la lista parte 14 años atras para no obligar a recorrer años imposibles.
  const newest = thisYear - 14;
  const years = Array.from({ length: newest - BIRTHDATE_MIN_YEAR + 1 }, (_, index) => newest - index);
  const maxDay = draft.year && draft.month ? daysIn(draft.year, draft.month) : 31;
  const candidate = draft.year && draft.month && draft.day ? `${draft.year}-${String(draft.month).padStart(2, "0")}-${String(draft.day).padStart(2, "0")}` : null;
  const future = candidate !== null && new Date(`${candidate}T00:00:00Z`).getTime() > Date.now();
  const openPicker = (): void => {
    const [year, month, day] = value ? value.split("-").map(Number) : [null, null, null];
    setDraft({ year, month, day });
    setOpen(true);
  };
  return <>
    <SelectorTrigger label="Fecha de nacimiento" value={formatBirthdate(value)} icon="calendar-outline" disabled={disabled} hint="Opcional" onPress={openPicker} />
    {open ? <SelectionModal title="Fecha de nacimiento" canConfirm={!future && (candidate !== null || draft.year === null && draft.month === null && draft.day === null)}
      onCancel={() => setOpen(false)} onConfirm={() => { onChange(candidate); setOpen(false); }}>
      <Text accessibilityLiveRegion="polite" style={styles.preview}>{candidate ? formatBirthdate(candidate) : "Selecciona día, mes y año"}</Text>
      {future ? <Text accessibilityRole="alert" style={timeStyles.error}>La fecha no puede ser futura.</Text> : null}
      <Text style={timeStyles.label}>Día</Text>
      <View style={timeStyles.grid}>{Array.from({ length: 31 }, (_, index) => index + 1).map(day => day <= maxDay
        ? <SelectionChip key={day} label={String(day)} selected={draft.day === day} onPress={() => setDraft(current => ({ ...current, day }))} />
        : null)}</View>
      <Text style={timeStyles.label}>Mes</Text>
      <View style={timeStyles.grid}>{MONTHS.map((name, index) => <SelectionChip key={name} label={name.slice(0, 3)} selected={draft.month === index + 1}
        onPress={() => setDraft(current => ({ ...current, month: index + 1, day: current.day && current.year && current.day > daysIn(current.year, index + 1) ? null : current.day }))} />)}</View>
      <Text style={timeStyles.label}>Año</Text>
      <View style={timeStyles.grid}>{years.map(year => <SelectionChip key={year} label={String(year)} selected={draft.year === year}
        onPress={() => setDraft(current => ({ ...current, year, day: current.day && current.month && current.day > daysIn(year, current.month) ? null : current.day }))} />)}</View>
      {value ? <Pressable accessibilityRole="button" onPress={() => setDraft({ year: null, month: null, day: null })} style={styles.clear}><Text style={styles.clearText}>Quitar fecha</Text></Pressable> : null}
    </SelectionModal> : null}
  </>;
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, justifyContent: "center" },
  chipSelected: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText: { ...typography.label, color: palette.text },
  chipTextSelected: { color: palette.white },
  disabled: { opacity: 0.55 },
  preview: { ...typography.heading, color: palette.heading, textAlign: "center" },
  clear: { alignSelf: "center", padding: 12 }, clearText: { ...typography.label, color: palette.danger },
});
