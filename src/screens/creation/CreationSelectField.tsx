import { useState, type ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { palette, radius, typography } from "../../ui/theme";
import { CreationModal } from "./CreationModal";

type IconName = ComponentProps<typeof Ionicons>["name"];
/** Opción de la lista: color (punto o ícono) y, si se indica, ícono con fondo suave como en la web. */
export interface SelectOption<T extends string> { value: T; label: string; tone?: string; icon?: IconName; soft?: string; disabled?: boolean; hint?: string }

function Mark<T extends string>({ option }: { option: SelectOption<T> }) {
  if (option.icon) return <View style={[styles.iconBox, { backgroundColor: option.soft ?? palette.surface }]}>
    <Ionicons name={option.icon} size={18} color={option.tone ?? palette.primary} accessible={false} />
  </View>;
  return option.tone ? <View style={[styles.dot, { backgroundColor: option.tone }]} /> : null;
}

/** Lista desplegable: muestra lo elegido y, al tocarla, abre las opciones; elegir una la cierra. */
export function CreationSelectField<T extends string>({ label, value, options, disabled, onChange, compact = false }: {
  label: string; value: T; options: SelectOption<T>[]; disabled: boolean; onChange: (value: T) => void;
  /** Versión angosta para datos secundarios (por ejemplo, la prioridad junto al tipo). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? "Sin seleccionar"}`} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => setOpen(true)} style={({ pressed }) => [styles.trigger, compact && styles.triggerCompact, disabled && styles.disabled, pressed && styles.pressed]}>
      {current ? <Mark option={current} /> : null}
      <Text style={[styles.value, compact && styles.valueCompact, current?.icon && current.tone ? { color: current.tone, fontWeight: "700" } : null]} numberOfLines={1}>{current?.label ?? "Seleccionar"}</Text>
      <Ionicons name="chevron-down" size={compact ? 16 : 20} color={palette.textMuted} accessible={false} />
    </Pressable>
    {open && !disabled ? <CreationModal title={label.replace(/\s*\*$/, "")} onClose={() => setOpen(false)}>
      <View style={styles.list} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: selected, disabled: option.disabled }}
            disabled={option.disabled} onPress={() => { onChange(option.value); setOpen(false); }}
            style={({ pressed }) => [styles.option, selected && styles.optionOn, option.disabled && styles.disabled, pressed && styles.pressed]}>
            <Mark option={option} />
            <View style={styles.text}>
              <Text style={[styles.label, selected && styles.labelOn]}>{option.label}</Text>
              {option.hint ? <Text style={styles.hint}>{option.hint}</Text> : null}
            </View>
            {selected ? <Ionicons name="checkmark" size={20} color={palette.primary} accessible={false} /> : null}
          </Pressable>;
        })}
      </View>
    </CreationModal> : null}
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: 8, minWidth: 0 },
  fieldLabel: { ...typography.label, color: palette.text },
  trigger: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  value: { ...typography.body, flex: 1, minWidth: 0, color: palette.text },
  triggerCompact: { gap: 6, paddingHorizontal: 10 },
  valueCompact: { fontSize: 14 },
  list: { gap: 8 },
  option: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  optionOn: { borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  iconBox: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  label: { ...typography.body, color: palette.text, fontWeight: "600" },
  labelOn: { color: palette.primary },
  hint: { ...typography.caption, color: palette.textSecondary },
});
