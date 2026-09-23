import { useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { Button, Field } from "../../ui/components";
import { TimeField } from "../../ui/time/TimeField";
import { palette, typography } from "../../ui/theme";
import { CreationDatePicker } from "./CreationDatePicker";
import type { CreationForm, CreationFormErrors } from "./creationForm";

export function CreationScheduleFields({ form, errors, disabled, optionalTimes, scopeKey, onChange }: {
  form: CreationForm; errors: CreationFormErrors; disabled: boolean; optionalTimes: boolean; scopeKey: string;
  onChange: <Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]) => void;
}) {
  const [calendar, setCalendar] = useState(false);
  return <View style={styles.fields}>
    <Text accessibilityRole="header" style={styles.title}>Horario</Text>
    <Field label="Fecha *" value={form.date} maxLength={10} autoCapitalize="none" placeholder="YYYY-MM-DD" editable={!disabled} error={errors.date} onChangeText={value => onChange("date", value)} />
    <Button title="Elegir fecha en calendario" icon="calendar-outline" variant="secondary" disabled={disabled} onPress={() => setCalendar(true)} />
    <TimeField label={optionalTimes ? "Hora de inicio (opcional)" : "Hora de inicio *"} value={form.startTime} disabled={disabled} error={errors.startTime} onChange={value => onChange("startTime", value)} scopeKey={scopeKey} />
    {optionalTimes && form.startTime ? <Button title="Quitar hora de inicio" icon="close-outline" variant="ghost" disabled={disabled} onPress={() => onChange("startTime", "")} /> : null}
    <TimeField label={optionalTimes ? "Hora de fin (opcional)" : "Hora de fin *"} value={form.endTime} disabled={disabled} error={errors.endTime} onChange={value => onChange("endTime", value)} scopeKey={scopeKey} />
    {optionalTimes && form.endTime ? <Button title="Quitar hora de fin" icon="close-outline" variant="ghost" disabled={disabled} onPress={() => onChange("endTime", "")} /> : null}
    {calendar && !disabled ? <CreationDatePicker value={form.date} onChange={value => onChange("date", value)} onClose={() => setCalendar(false)} /> : null}
  </View>;
}
const styles = StyleSheet.create({ fields: { gap: 14 }, title: { ...typography.heading, color: palette.text } });