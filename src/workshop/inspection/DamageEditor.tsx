import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import {
  RESPONSIBILITY_LABELS, SEVERITY_LABELS,
  type InspectionDamage, type InspectionDamageInput, type InspectionResponsibility, type InspectionSeverity, type InspectionSlot
} from "../../domain/workshopInspection";
import { PickerSheet } from "../intake/IntakePickers";

const SEVERITY_TONE: Record<InspectionSeverity, string> = { LOW: palette.success, MEDIUM: palette.orange, HIGH: palette.danger };

function Choice({ label, selected, tone, onPress }: { label: string; selected: boolean; tone?: string; onPress: () => void }) {
  const color = tone ?? palette.primary;
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} onPress={onPress}
    style={[styles.chip, selected && { borderColor: color, backgroundColor: color }]}>
    <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
  </Pressable>;
}

/** Agregar o editar un daño: qué se ve, qué tan grave, de quién es la responsabilidad y dónde está. Igual que la web. */
export function DamageEditor({ damage, slots, saving, error, onSave, onClose, initialLocation }: {
  damage: InspectionDamage | null; slots: InspectionSlot[]; saving: boolean; error: string;
  onSave: (input: Omit<InspectionDamageInput, "companyBranchId">) => void; onClose: () => void;
  /** Daño nuevo desde una foto: el ángulo ya elegido. */
  initialLocation?: string | null;
}) {
  const [description, setDescription] = useState(damage?.description ?? "");
  const [severity, setSeverity] = useState<InspectionSeverity>(damage?.severity ?? "MEDIUM");
  const [responsibility, setResponsibility] = useState<InspectionResponsibility>(damage?.responsibility ?? "PENDING");
  const known = slots.some((slot) => slot.key === damage?.location);
  const [slotKey, setSlotKey] = useState<string | null>(damage ? (!damage.isAdditional && known ? damage.location : null) : initialLocation ?? null);
  const [place, setPlace] = useState(damage?.isAdditional || !known ? damage?.location ?? "" : "");
  const [missing, setMissing] = useState(false);

  function save() {
    if (!description.trim()) { setMissing(true); return; }
    onSave({ id: damage?.id ?? null, description: description.trim(), severity, responsibility,
      location: slotKey ?? (place.trim() || null), isAdditional: slotKey === null });
  }

  return <PickerSheet title={damage ? "Editar daño" : "Agregar daño"} onClose={onClose}
    footer={<Button title={damage ? "Guardar daño" : "Agregar daño"} icon="checkmark" loading={saving} disabled={saving} onPress={save} />}>
    <View style={styles.field}>
      <Text style={styles.label}>¿Qué daño tiene? *</Text>
      <TextInput value={description} onChangeText={(text) => { setDescription(text); setMissing(false); }} multiline maxLength={2000}
        placeholder="Ej.: abolladura en la tapa lateral" placeholderTextColor={palette.textMuted} textAlignVertical="top"
        style={[styles.input, missing && styles.invalid]} accessibilityLabel="Descripción del daño" />
      {missing ? <Text style={styles.error}>Describe el daño.</Text> : null}
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Gravedad</Text>
      <View style={styles.row}>{(Object.keys(SEVERITY_LABELS) as InspectionSeverity[]).map((value) =>
        <Choice key={value} label={SEVERITY_LABELS[value]} tone={SEVERITY_TONE[value]} selected={severity === value} onPress={() => setSeverity(value)} />)}</View>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Responsabilidad</Text>
      <View style={styles.row}>{(Object.keys(RESPONSIBILITY_LABELS) as InspectionResponsibility[]).map((value) =>
        <Choice key={value} label={RESPONSIBILITY_LABELS[value]} selected={responsibility === value} onPress={() => setResponsibility(value)} />)}</View>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>¿Dónde está?</Text>
      <View style={styles.row}>
        {slots.map((slot) => <Choice key={slot.key} label={slot.name} selected={slotKey === slot.key} onPress={() => setSlotKey(slotKey === slot.key ? null : slot.key)} />)}
        <Choice label="Otro lugar" selected={slotKey === null} onPress={() => setSlotKey(null)} />
      </View>
      {slotKey === null ? <TextInput value={place} onChangeText={setPlace} maxLength={300} placeholder="Ej.: rueda trasera izquierda" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.single]} accessibilityLabel="Lugar del daño" /> : null}
    </View>
    {!damage ? <Text style={styles.hint}>Después de agregarlo podrás sacarle fotos.</Text> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { ...typography.label, color: palette.text },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  input: { minHeight: 88, paddingHorizontal: 12, paddingTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  single: { minHeight: 46, paddingTop: 0 },
  invalid: { borderColor: palette.danger },
  error: { ...typography.caption, color: palette.danger },
  hint: { ...typography.caption, color: palette.textSecondary }
});
