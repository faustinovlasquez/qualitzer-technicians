import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components";
import { palette, radius } from "../theme";
import { SelectionModal, timeStyles } from "./SelectorUi";
import { formatClock, parseClock } from "./timeValues";
import type { SelectionSession } from "./useSelectionSession";

export interface TimePickerPanelProps {
  label: string;
  value: string;
  session: SelectionSession;
  onConfirm(value: string): void;
  onError(message: string): void;
}

const ROW = 44;
const two = (value: number) => String(value).padStart(2, "0");
/** Desplazamiento que deja el valor elegido cerca del centro de su columna. */
const offsetOf = (value: number) => ({ y: Math.max(0, value * ROW - ROW * 2), animated: false });

/** Selector de hora fácil: dos columnas (hora y minutos) y la hora elegida en grande. En Android se usa el reloj del teléfono. */
export function TimePickerPanel({ label, value, session, onConfirm }: TimePickerPanelProps) {
  const [parts, setParts] = useState(() => parseClock(value) ?? { hours: 12, minutes: 0 });
  const hoursList = useRef<ScrollView>(null);
  const minutesList = useRef<ScrollView>(null);
  // Al abrir, la hora y los minutos elegidos quedan a la vista.
  useEffect(() => { hoursList.current?.scrollTo(offsetOf(parts.hours)); minutesList.current?.scrollTo(offsetOf(parts.minutes)); }, []);
  function choose(field: "hours" | "minutes", number: number): void {
    if (session.isCurrent()) setParts((current) => ({ ...current, [field]: number }));
  }
  function now(): void {
    if (!session.isCurrent()) return;
    const date = new Date();
    setParts({ hours: date.getHours(), minutes: date.getMinutes() });
    hoursList.current?.scrollTo(offsetOf(date.getHours()));
    minutesList.current?.scrollTo(offsetOf(date.getMinutes()));
  }
  const column = (title: string, field: "hours" | "minutes", count: number, unit: string, list: typeof hoursList) => <View style={styles.column}>
    <Text style={styles.columnTitle}>{title}</Text>
    <ScrollView ref={list} style={styles.list} contentContainerStyle={styles.listContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>
      {Array.from({ length: count }, (_, number) => {
        const on = parts[field] === number;
        return <Pressable key={number} accessibilityRole="radio" accessibilityLabel={`${two(number)} ${unit}`} accessibilityState={{ checked: on }} aria-checked={on}
          onPress={() => choose(field, number)} style={({ pressed }: { pressed: boolean }) => [styles.item, on && styles.itemOn, pressed && !on && styles.itemPressed]}>
          <Text style={[styles.itemText, on && styles.itemTextOn]}>{two(number)}</Text>
        </Pressable>;
      })}
    </ScrollView>
  </View>;
  return <SelectionModal title={label} onCancel={session.cancel} onConfirm={() => {
    const result = formatClock(parts.hours, parts.minutes);
    if (session.isCurrent() && result) onConfirm(result);
  }}>
    <Text accessibilityLiveRegion="polite" style={styles.display}>{formatClock(parts.hours, parts.minutes)}</Text>
    {!parseClock(value) && value ? <Text style={timeStyles.hint}>La hora anterior no era válida; se reemplaza al confirmar.</Text> : null}
    <View style={styles.columns}>
      {column("Hora", "hours", 24, "horas", hoursList)}
      <Text style={styles.separator}>:</Text>
      {column("Minutos", "minutes", 60, "minutos", minutesList)}
    </View>
    <Button title="Ahora" icon="time-outline" variant="ghost" onPress={now} />
  </SelectionModal>;
}

const styles = StyleSheet.create({
  display: { fontSize: 40, lineHeight: 46, fontWeight: "800", textAlign: "center", color: palette.heading, fontVariant: ["tabular-nums"] },
  columns: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  column: { flex: 1, maxWidth: 140, gap: 6 },
  columnTitle: { fontSize: 13, fontWeight: "700", color: palette.textSecondary, textAlign: "center" },
  list: { height: ROW * 5, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  listContent: { paddingVertical: 4 },
  item: { height: ROW, alignItems: "center", justifyContent: "center", marginHorizontal: 4, borderRadius: radius.sm },
  itemOn: { backgroundColor: palette.primary },
  itemPressed: { backgroundColor: palette.primarySoft },
  itemText: { fontSize: 20, fontWeight: "600", color: palette.text, fontVariant: ["tabular-nums"] },
  itemTextOn: { color: palette.white, fontWeight: "800" },
  separator: { fontSize: 28, fontWeight: "800", color: palette.textMuted, marginTop: 22 }
});
