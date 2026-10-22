import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { palette, radius } from "../../ui/theme";
import { APPROVAL_CHOICES, decodeInspectionAnswer, encodeInspectionAnswer, isValidInspectionResponse, type InspectionChoice, type InspectionStep } from "../../domain/workshopInspection";

function Chip({ label, selected, tone, onPress, disabled, multiple }: { label: string; selected: boolean; tone?: string; onPress: () => void; disabled: boolean; multiple?: boolean }) {
  const color = tone ?? palette.primary;
  return <Pressable accessibilityRole={multiple ? "checkbox" : "radio"} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled} onPress={onPress}
    style={[styles.chip, selected && { borderColor: color, backgroundColor: color }, disabled && styles.disabled]}>
    {multiple ? <Ionicons name={selected ? "checkbox" : "square-outline"} size={16} color={selected ? palette.white : palette.textMuted} accessible={false} /> : null}
    <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
  </Pressable>;
}

/** Control según el tipo de pregunta. Devuelve la respuesta ya en el formato que guarda la web. */
export function StepAnswerControl({ step, responseValue, disabled, onChange }: {
  step: InspectionStep; responseValue: string | null; disabled: boolean; onChange: (responseValue: string | null, immediate: boolean) => void;
}) {
  const answer = decodeInspectionAnswer(step, responseValue);
  const [draft, setDraft] = useState(answer.type === "text" || answer.type === "number" ? answer.value : "");
  useEffect(() => { if (answer.type === "text" || answer.type === "number") setDraft(answer.value); }, [responseValue]);

  if (answer.type === "validation") {
    const pick = (value: "true" | "false" | "not_applicable") => onChange(encodeInspectionAnswer({ type: "validation", value: answer.value === value ? null : value }), true);
    return <View style={styles.row}>
      <Chip label="Sí" selected={answer.value === "true"} tone={palette.success} disabled={disabled} onPress={() => pick("true")} />
      <Chip label="No" selected={answer.value === "false"} tone={palette.danger} disabled={disabled} onPress={() => pick("false")} />
      <Chip label="No aplica" selected={answer.value === "not_applicable"} tone={palette.textSecondary} disabled={disabled} onPress={() => pick("not_applicable")} />
    </View>;
  }
  if (answer.type === "select" || answer.type === "approval") {
    const choices = answer.type === "approval" ? APPROVAL_CHOICES : step.options;
    const tone = (value: string) => answer.type !== "approval" ? undefined : value === "approved" ? palette.success : value === "rejected" ? palette.danger : palette.textSecondary;
    return <View style={styles.row}>
      {choices.map((choice) => <Chip key={choice.value} label={choice.label} selected={answer.value === choice.value} tone={tone(choice.value)} disabled={disabled}
        onPress={() => onChange(encodeInspectionAnswer({ type: answer.type, value: answer.value === choice.value ? null : choice.value }), true)} />)}
      {choices.length === 0 ? <Text style={styles.empty}>La pregunta no tiene opciones configuradas.</Text> : null}
    </View>;
  }
  if (answer.type === "multiselect") {
    const toggle = (choice: InspectionChoice) => {
      const has = answer.value.some((item) => item.value === choice.value);
      onChange(encodeInspectionAnswer({ type: "multiselect", value: has ? answer.value.filter((item) => item.value !== choice.value) : [...answer.value, choice] }), true);
    };
    return <View style={styles.row}>
      {step.options.map((choice) => <Chip key={choice.value} multiple label={choice.label} selected={answer.value.some((item) => item.value === choice.value)} disabled={disabled} onPress={() => toggle(choice)} />)}
    </View>;
  }
  const numeric = answer.type === "number";
  const invalid = numeric && draft !== "" && !isValidInspectionResponse(step, draft);
  return <View style={styles.field}><TextInput value={draft} editable={!disabled} placeholder={numeric ? "Ingresa un número" : "Escribe la respuesta"} placeholderTextColor={palette.textMuted}
    keyboardType={numeric ? "decimal-pad" : "default"} multiline={!numeric} maxLength={numeric ? 30 : 2000} accessibilityLabel={step.title}
    onChangeText={(text) => { const value = numeric ? text.replace(/[^\d.,-]/g, "") : text; setDraft(value); onChange(encodeInspectionAnswer({ type: answer.type, value }), false); }}
    style={[styles.input, !numeric && styles.inputMultiline, invalid && styles.inputInvalid]} textAlignVertical={numeric ? "center" : "top"} />
    {invalid ? <Text style={styles.invalid} accessibilityRole="alert">Escribe un número válido, por ejemplo 1250 o 12,5. No se guarda hasta corregirlo.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  disabled: { opacity: 0.5 },
  empty: { fontSize: 12, color: palette.textSecondary },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  inputMultiline: { minHeight: 80, paddingTop: 10 },
  inputInvalid: { borderColor: palette.danger },
  field: { gap: 4 },
  invalid: { fontSize: 12, color: palette.danger }
});
