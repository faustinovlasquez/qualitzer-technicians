import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import {
  SEVERITY_LABELS,
  type InspectionDamage, type InspectionDamageInput, type InspectionResponsibility, type InspectionSeverity, type InspectionSlot
} from "../../domain/workshopInspection";

export interface DamagePhoto { uri: string; source: "camera" | "library" }

const SEVERITY_TONE: Record<InspectionSeverity, { color: string; soft: string }> = {
  LOW: { color: palette.success, soft: palette.successSoft }, MEDIUM: { color: palette.orange, soft: palette.orangeSoft }, HIGH: { color: palette.danger, soft: palette.dangerSoft }
};
const RESPONSIBILITY_OPTIONS: Array<{ value: Exclude<InspectionResponsibility, "PENDING">; label: string; hint: string }> = [
  { value: "CLIENT", label: "Operacional", hint: "Golpe o mal uso en operación" },
  { value: "WEAR", label: "Por desgaste", hint: "Deterioro natural por uso" }
];

/** Agregar o editar un daño, como en la web: gravedad, responsabilidad, descripción y foto, en un diálogo. */
export function DamageEditor({ damage, slots, saving, error, onSave, onClose, onPickPhoto, initialLocation }: {
  damage: InspectionDamage | null; slots: InspectionSlot[]; saving: boolean; error: string;
  onSave: (input: Omit<InspectionDamageInput, "companyBranchId">, photo: DamagePhoto | null) => void; onClose: () => void;
  /** Toma o elige la foto del daño (sin subirla todavía); devuelve null si se cancela. */
  onPickPhoto?: (source: DamagePhoto["source"]) => Promise<string | null>;
  /** Daño nuevo desde una foto: el ángulo ya elegido. */
  initialLocation?: string | null;
}) {
  const [description, setDescription] = useState(damage?.description ?? "");
  const [severity, setSeverity] = useState<InspectionSeverity>(damage?.severity ?? "MEDIUM");
  const [responsibility, setResponsibility] = useState<InspectionResponsibility>(damage?.responsibility ?? "PENDING");
  const known = slots.some((slot) => slot.key === damage?.location);
  const [slotKey, setSlotKey] = useState<string | null>(damage ? (!damage.isAdditional && known ? damage.location : null) : initialLocation ?? null);
  const [place, setPlace] = useState(damage?.isAdditional || !known ? damage?.location ?? "" : "");
  const [photo, setPhoto] = useState<DamagePhoto | null>(null);
  const [missing, setMissing] = useState(false);
  const fixedLocation = !damage && Boolean(initialLocation);
  const locationName = slots.find((slot) => slot.key === slotKey)?.name ?? (place.trim() || null);
  const title = locationName ? `Daño en ${locationName}` : damage ? "Editar daño" : "Reportar daño";

  function save() {
    if (saving) return;
    if (!description.trim()) { setMissing(true); return; }
    onSave({ id: damage?.id ?? null, description: description.trim(), severity, responsibility,
      location: slotKey ?? (place.trim() || null), isAdditional: slotKey === null }, photo);
  }
  async function pick(source: DamagePhoto["source"]) {
    if (!onPickPhoto || saving) return;
    const uri = await onPickPhoto(source);
    if (uri) setPhoto({ uri, source });
  }

  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) onClose(); }}>
    <View style={styles.overlay}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.dialog}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          <IconButton name="close" label="Cerrar" disabled={saving} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="warning-outline" size={18} color={palette.orange} accessible={false} />
              <Text style={styles.cardTitle}>Completa el formulario para reportar daño</Text>
            </View>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Gravedad">
              {(Object.keys(SEVERITY_LABELS) as InspectionSeverity[]).map((value) => {
                const selected = severity === value;
                const tone = SEVERITY_TONE[value];
                return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} onPress={() => setSeverity(value)}
                  style={[styles.pill, selected && { borderColor: tone.color, backgroundColor: tone.soft }]}>
                  <Text style={[styles.pillText, selected && { color: tone.color }]}>{SEVERITY_LABELS[value].toUpperCase()}</Text>
                </Pressable>;
              })}
            </View>
            <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Responsabilidad">
              {RESPONSIBILITY_OPTIONS.map((option) => {
                const selected = responsibility === option.value;
                return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected}
                  onPress={() => setResponsibility(selected ? "PENDING" : option.value)} style={[styles.option, selected && styles.optionOn]}>
                  <Text style={[styles.optionTitle, selected && styles.optionTitleOn]}>{option.label.toUpperCase()}</Text>
                  <Text style={styles.optionHint}>{option.hint}</Text>
                </Pressable>;
              })}
            </View>
            {!fixedLocation ? <View style={styles.locations}>
              <Text style={styles.label}>¿Dónde está?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationRow}>
                {slots.map((slot) => <Pressable key={slot.key} accessibilityRole="radio" accessibilityState={{ checked: slotKey === slot.key }}
                  onPress={() => setSlotKey(slotKey === slot.key ? null : slot.key)} style={[styles.location, slotKey === slot.key && styles.locationOn]}>
                  <Text style={[styles.locationText, slotKey === slot.key && styles.locationTextOn]}>{slot.name}</Text>
                </Pressable>)}
                <Pressable accessibilityRole="radio" accessibilityState={{ checked: slotKey === null }} onPress={() => setSlotKey(null)}
                  style={[styles.location, slotKey === null && styles.locationOn]}>
                  <Text style={[styles.locationText, slotKey === null && styles.locationTextOn]}>Otro lugar</Text>
                </Pressable>
              </ScrollView>
              {slotKey === null ? <TextInput value={place} onChangeText={setPlace} maxLength={300} placeholder="Ej.: rueda trasera izquierda" placeholderTextColor={palette.textMuted}
                style={[styles.input, styles.single]} accessibilityLabel="Lugar del daño" /> : null}
            </View> : null}
            <TextInput value={description} onChangeText={(text) => { setDescription(text); setMissing(false); }} multiline maxLength={2000}
              placeholder="Describe el daño (golpe, rayón, fuga, pieza faltante…)" placeholderTextColor={palette.textMuted} textAlignVertical="top"
              style={[styles.input, missing && styles.invalid]} accessibilityLabel="Descripción del daño" />
            {missing ? <Text style={styles.error}>Describe el daño.</Text> : null}
            {onPickPhoto ? <View style={styles.photoRow}>
              {photo ? <View style={styles.preview}>
                <Image source={{ uri: photo.uri }} style={styles.previewImage} accessibilityLabel="Foto del daño" />
                <Pressable accessibilityRole="button" accessibilityLabel="Quitar foto" hitSlop={6} onPress={() => setPhoto(null)} style={styles.previewRemove}>
                  <Ionicons name="close" size={13} color={palette.white} />
                </Pressable>
              </View> : null}
              <Pressable accessibilityRole="button" onPress={() => void pick("camera")} style={styles.photoButton}>
                <Ionicons name="camera-outline" size={16} color={palette.text} accessible={false} />
                <Text style={styles.photoButtonText}>Foto del daño</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void pick("library")} style={[styles.photoButton, styles.galleryButton]}>
                <Ionicons name="images-outline" size={16} color={palette.amber} accessible={false} />
                <Text style={[styles.photoButtonText, styles.galleryText]}>Galería</Text>
              </Pressable>
            </View> : !damage ? <Text style={styles.hint}>Después de guardarlo podrás agregarle fotos.</Text> : null}
          </View>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button title="Cancelar" variant="secondary" disabled={saving} onPress={onClose} style={styles.footerButton} />
          <Button title={damage ? "Guardar cambios" : "Guardar daño"} loading={saving} disabled={saving} onPress={save} style={styles.footerButton} />
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(15,23,42,0.55)" },
  dialog: { width: "100%", maxWidth: 520, maxHeight: "92%", borderRadius: radius.lg, backgroundColor: palette.surface, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: palette.heading },
  body: { padding: 14, gap: 10 },
  card: { gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.heading },
  row: { flexDirection: "row", gap: 8 },
  pill: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pillText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, color: palette.textSecondary },
  option: { flex: 1, gap: 2, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  optionOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  optionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.3, color: palette.textSecondary },
  optionTitleOn: { color: palette.primary },
  optionHint: { fontSize: 11, color: palette.textMuted },
  locations: { gap: 6 },
  label: { ...typography.caption, fontWeight: "800", color: palette.textSecondary },
  locationRow: { gap: 6 },
  location: { minHeight: 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  locationOn: { borderColor: palette.primary, backgroundColor: palette.primary },
  locationText: { fontSize: 12, fontWeight: "700", color: palette.text },
  locationTextOn: { color: palette.white },
  input: { minHeight: 96, paddingHorizontal: 12, paddingTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, fontSize: 14, color: palette.text },
  single: { minHeight: 42, paddingTop: 0 },
  invalid: { borderColor: palette.danger },
  photoRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  photoButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  photoButtonText: { fontSize: 12, fontWeight: "800", color: palette.text },
  galleryButton: { borderColor: palette.amber, backgroundColor: palette.amberSoft },
  galleryText: { color: palette.amber },
  preview: { width: 44, height: 44, borderRadius: 8, overflow: "hidden", backgroundColor: palette.track },
  previewImage: { width: 44, height: 44 },
  previewRemove: { position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" },
  footer: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: palette.border },
  footerButton: { flex: 1 },
  error: { ...typography.caption, color: palette.danger },
  hint: { ...typography.caption, color: palette.textSecondary }
});
