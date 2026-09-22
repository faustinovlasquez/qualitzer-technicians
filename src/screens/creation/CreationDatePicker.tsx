import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { calendarDateSchema } from "../../domain/creation";
import { Button, IconButton } from "../../ui/components";
import { MAX_EXECUTION_DATES } from "../../domain/workExecution";
import { palette, radius, typography } from "../../ui/theme";
import { CreationModal } from "./CreationModal";

type DatePickerProps = { value: string; onClose: () => void; showInputHint?: boolean } & (
  { multiple?: false; onChange: (date: string) => void }
  | { multiple: true; selectedDates: string[]; onChange: (dates: string[]) => void }
);

export function CreationDatePicker(props: DatePickerProps) {
  const { value, onClose } = props;
  const [selectedDates, setSelectedDates] = useState(() => props.multiple ? [...props.selectedDates] : []);
  const [month, setMonth] = useState(() => calendarDateSchema.safeParse(value).success ? value.slice(0, 7) : "2000-01");
  const first = new Date(`${month}-01T00:00:00Z`);
  const leading = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const title = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const changeMonth = (offset: number): void => {
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
    if (next >= "2000-01" && next <= "2100-12") setMonth(next);
  };
  return <CreationModal title={props.multiple ? "Días trabajados" : "Elegir fecha"} onClose={onClose}>
    <View style={styles.header}>
      <IconButton name="chevron-back" label="Mes anterior" disabled={month === "2000-01"} onPress={() => changeMonth(-1)} />
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.heading}>{title}</Text>
      <IconButton name="chevron-forward" label="Mes siguiente" disabled={month === "2100-12"} onPress={() => changeMonth(1)} />
    </View>
    <View style={styles.grid}>
      {["L", "M", "X", "J", "V", "S", "D"].map((day) => <View key={day} style={styles.cell}><Text style={styles.weekday}>{day}</Text></View>)}
      {Array.from({ length: leading + count }, (_, index) => {
        const day = index - leading + 1;
        if (day < 1) return <View key={`empty-${index}`} style={styles.cell} />;
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const selected = props.multiple ? selectedDates.includes(date) : date === value;
        const disabled = props.multiple && !selected && selectedDates.length >= MAX_EXECUTION_DATES;
        return <Pressable key={date} accessibilityRole={props.multiple ? "checkbox" : "button"} accessibilityLabel={new Intl.DateTimeFormat("es", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}
          accessibilityState={{ selected, checked: props.multiple ? selected : undefined, disabled }} aria-checked={props.multiple ? selected : undefined} disabled={disabled} onPress={() => {
            if (props.multiple) setSelectedDates(current => current.includes(date) ? current.filter(item => item !== date) : [...current, date].sort());
            else { props.onChange(date); onClose(); }
          }} style={[styles.cell, selected && styles.selected, disabled && styles.disabled]}>
          <Text style={[styles.day, selected && styles.selectedText]}>{day}</Text>
        </Pressable>;
      })}
    </View>
    {props.multiple ? <>
      <Text accessibilityLiveRegion="polite" style={styles.hint}>{selectedDates.length} de {MAX_EXECUTION_DATES} días seleccionados</Text>
      <Button title="Usar fechas seleccionadas" icon="checkmark-outline" disabled={selectedDates.length === 0} onPress={() => { props.onChange(selectedDates); onClose(); }} />
      <Button title="Cancelar" variant="secondary" onPress={onClose} />
    </> : props.showInputHint !== false ? <Text style={styles.hint}>También puedes escribir la fecha directamente en formato YYYY-MM-DD.</Text> : null}
  </CreationModal>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { ...typography.label, color: palette.text, flexShrink: 1, textAlign: "center", textTransform: "capitalize" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.2857%", minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  day: { ...typography.body, fontSize: 14, lineHeight: 20, color: palette.text },
  weekday: { ...typography.caption, color: palette.textSecondary },
  selected: { backgroundColor: palette.primary },
  selectedText: { color: palette.white, fontWeight: "700" },
  hint: { ...typography.caption, color: palette.textSecondary },
  disabled: { opacity: 0.45 },
});