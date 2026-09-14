import { useState } from "react";
import { Text, View } from "react-native";
import { SelectionChip, SelectionModal, timeStyles } from "./SelectorUi";
import { formatClock, parseClock } from "./timeValues";
import type { SelectionSession } from "./useSelectionSession";

export interface TimePickerPanelProps {
  label: string;
  value: string;
  session: SelectionSession;
  onConfirm(value: string): void;
  onError(message: string): void;
}

export function TimePickerPanel({ label, value, session, onConfirm }: TimePickerPanelProps) {
  const [parts, setParts] = useState(() => parseClock(value) ?? { hours: 12, minutes: 0 });
  function choose(field: "hours" | "minutes", number: number): void {
    if (session.isCurrent()) setParts((current) => ({ ...current, [field]: number }));
  }
  return <SelectionModal title={label} onCancel={session.cancel} onConfirm={() => {
    const result = formatClock(parts.hours, parts.minutes);
    if (session.isCurrent() && result) onConfirm(result);
  }}>
    <Text accessibilityLiveRegion="polite" style={timeStyles.number}>{formatClock(parts.hours, parts.minutes)}</Text>
    {!parseClock(value) ? <Text style={timeStyles.hint}>El valor anterior no es una hora válida. Solo se reemplaza al confirmar.</Text> : null}
    <Text style={timeStyles.label}>Hora · 00–23</Text>
    <View style={timeStyles.grid}>{Array.from({ length: 24 }, (_, number) => <SelectionChip key={number} label={`${String(number).padStart(2, "0")} h`}
      selected={parts.hours === number} onPress={() => choose("hours", number)} />)}</View>
    <Text style={timeStyles.label}>Minuto · 00–59</Text>
    <View style={timeStyles.grid}>{Array.from({ length: 60 }, (_, number) => <SelectionChip key={number} label={`${String(number).padStart(2, "0")} min`}
      selected={parts.minutes === number} onPress={() => choose("minutes", number)} />)}</View>
  </SelectionModal>;
}