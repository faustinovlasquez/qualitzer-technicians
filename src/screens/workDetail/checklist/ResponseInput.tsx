import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { checklistStepOptions, normalizeChecklistAnswer } from "../../../domain/checklistProgress";
import { plainText } from "../../../domain/format";
import type { ChecklistStep, StepAnswer } from "../../../domain/models";
import { BodyText, Button, Field } from "../../../ui/components";
import { palette } from "../../../ui/theme";
import { ChoiceButton, Notice } from "../DetailUi";
import { styles } from "../detailStyles";
import { checklistAnswerLabel } from "./checklistPresentation";
import { checklistStyles } from "./styles";

/** Respuesta de Sí, No o No aplica: se reconoce a primera vista y es fácil de tocar con guantes. */
function AnswerTile({ label, icon, color, soft, selected, disabled, onPress }: { label: string; icon: ComponentProps<typeof Ionicons>["name"]; color: string; soft: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} aria-disabled={disabled}
    style={({ pressed }) => [checklistStyles.answerTile, selected && { borderColor: color, backgroundColor: soft }, (pressed || disabled) && checklistStyles.pressed]}>
    <Ionicons name={icon} size={28} color={selected ? color : palette.textMuted} accessible={false} />
    <Text numberOfLines={1} style={[checklistStyles.answerText, selected && { color }]}>{label}</Text>
  </Pressable>;
}

export function ResponseInput({ step, answer, disabled, onChange }: { step: ChecklistStep; answer: StepAnswer; disabled: boolean; onChange: (answer: StepAnswer) => void }) {
  const value = answer.responseValue;
  const change = (next: StepAnswer["responseValue"]) => onChange(normalizeChecklistAnswer(step, { ...answer, responseValue: next }));
  const options = checklistStepOptions(step);
  switch (step.type) {
    case "validation": return (
      <View style={styles.tight}>
        <View style={checklistStyles.answerRow} accessibilityRole="radiogroup" accessibilityLabel={`Validación: ${plainText(step.title)}`}>
          <AnswerTile label="Sí" icon={value === true ? "checkmark-circle" : "checkmark-circle-outline"} color={palette.success} soft={palette.successSoft} selected={value === true} disabled={disabled} onPress={() => change(true)} />
          <AnswerTile label="No" icon={value === false ? "close-circle" : "close-circle-outline"} color={palette.danger} soft={palette.dangerSoft} selected={value === false} disabled={disabled} onPress={() => change(false)} />
          <AnswerTile label="No aplica" icon={value === "not_applicable" ? "remove-circle" : "remove-circle-outline"} color={palette.textSecondary} soft={palette.track} selected={value === "not_applicable"} disabled={disabled} onPress={() => change("not_applicable")} />
        </View>
        {step.isRequired === false && value !== null ? <Button title="Dejar sin respuesta" variant="ghost" disabled={disabled} onPress={() => change(null)} /> : null}
      </View>
    );
    case "text":
    case "number": return <Field label={step.type === "number" ? "Respuesta numérica" : "Texto (opcional)"} value={typeof value === "string" ? value : ""} onChangeText={change} editable={!disabled} multiline={step.type === "text"} style={step.type === "text" ? styles.multiline : undefined} maxLength={10000} keyboardType={step.type === "number" ? "numbers-and-punctuation" : "default"} hint={step.type === "number" ? "Usa punto para decimales. Se admiten números negativos." : "Este paso informativo no cuenta en el progreso obligatorio."} />;
    case "select":
    case "approval":
    case "multiselect": return (
      <View style={styles.tight}>
        {value !== null && (Array.isArray(value) ? value.length > 0 : value !== "") ? <BodyText>Selección actual: {checklistAnswerLabel(step, answer)}</BodyText> : null}
        {Array.isArray(value) ? value.filter((item) => !options.some((option) => option.value === item.value)).map((item) => <View key={item.value} style={styles.tight}>
          <Notice message={`La opción «${plainText(item.label)}» ya no está disponible. Se conserva hasta que decidas quitarla.`} tone="warning" />
          {!disabled ? <Button title={`Quitar opción no disponible: ${plainText(item.label)}`} variant="ghost" onPress={() => change(value.filter((selected) => selected.value !== item.value))} /> : null}
        </View>) : null}
        {options.length === 0 ? <Notice message="No se recibieron opciones para este paso. No se inventará una respuesta; solicita revisar su configuración." tone="warning" /> : <View style={styles.tight} accessibilityRole={step.type === "multiselect" ? undefined : "radiogroup"} accessibilityLabel={`Opciones: ${plainText(step.title)}`}>
          {options.map((option) => {
            const selected = Array.isArray(value) ? value.some((item) => item.value === option.value) : value === option.value;
            return <ChoiceButton key={option.value} label={plainText(option.label)} selected={selected} disabled={disabled} multiple={step.type === "multiselect"} onPress={() => {
              if (step.type !== "multiselect") { change(option.value); return; }
              const values = Array.isArray(value) ? value : [];
              change(selected ? values.filter((item) => item.value !== option.value) : [...values, option]);
            }} />;
          })}
        </View>}
        {step.isRequired === false && value !== null ? <Button title="Dejar sin respuesta" variant="ghost" disabled={disabled} onPress={() => change(null)} /> : null}
      </View>
    );
    default: return <Notice message="Tipo de paso no compatible con esta versión. Revisa la respuesta en Qualitzer." tone="warning" />;
  }
}