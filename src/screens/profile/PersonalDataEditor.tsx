import { useEffect, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BLOOD_TYPE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, NATIONALITY_OPTIONS,
  ownProfileInputSchema, profileInputFrom, type OwnProfile, type OwnProfileInput,
} from "../../domain/ownProfile";
import { Button, Field, IconButton, SectionTitle } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { Notice } from "../workDetail/DetailUi";
import { BirthdateField, ChoiceChips, OptionField } from "./ProfileFields";

type Draft = OwnProfileInput;
type Errors = Partial<Record<"firstNames" | "lastNames" | "secondLastName" | "preferredName", string>>;

function validate(draft: Draft): Errors {
  const errors: Errors = {};
  const required = (value: string): string | undefined => !value.trim() ? "Este campo es obligatorio." : value.trim().length > 50 ? "Máximo 50 caracteres." : undefined;
  const optional = (value: string | null): string | undefined => (value?.trim().length ?? 0) > 50 ? "Máximo 50 caracteres." : undefined;
  const firstNames = required(draft.firstNames); if (firstNames) errors.firstNames = firstNames;
  const lastNames = required(draft.lastNames); if (lastNames) errors.lastNames = lastNames;
  const second = optional(draft.secondLastName); if (second) errors.secondLastName = second;
  const preferred = optional(draft.preferredName); if (preferred) errors.preferredName = preferred;
  return errors;
}

const clean = (value: string | null): string | null => value?.trim().replace(/\s+/g, " ") || null;

export function PersonalDataEditor({ profile, busy, available, error, onSave, onCancel }: {
  profile: OwnProfile; busy: boolean; available: boolean; error: string | null;
  onSave(input: OwnProfileInput): Promise<boolean>; onCancel(): void;
}) {
  const [draft, setDraft] = useState<Draft>(() => profileInputFrom(profile));
  const [touched, setTouched] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const errors = touched ? validate(draft) : {};
  const disabled = busy || !available;
  const initial = JSON.stringify(profileInputFrom(profile));
  const dirty = JSON.stringify(draft) !== initial;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft(current => ({ ...current, [key]: value }));

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { if (!busy) onCancel(); return true; });
    return () => subscription.remove();
  }, [busy, onCancel]);

  async function save(): Promise<void> {
    setTouched(true); setLocalError(null);
    if (Object.keys(validate(draft)).length > 0) { setLocalError("Revisa los campos marcados."); return; }
    const parsed = ownProfileInputSchema.safeParse({
      ...draft, firstNames: clean(draft.firstNames) ?? "", lastNames: clean(draft.lastNames) ?? "",
      secondLastName: clean(draft.secondLastName), preferredName: clean(draft.preferredName),
    });
    if (!parsed.success) { setLocalError("Hay datos con un formato no válido. Revisa la fecha y las opciones elegidas."); return; }
    if (await onSave(parsed.data)) onCancel();
  }

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={styles.header}>
      <IconButton name="arrow-back-outline" label="Volver a mi perfil" disabled={busy} onPress={onCancel} />
      <View style={styles.grow}><SectionTitle title="Datos personales" subtitle="Mantén tu información al día" /></View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!available ? <Notice message="Conéctate para guardar cambios en tu perfil." tone="warning" /> : null}
      {localError || error ? <Notice message={localError ?? error ?? ""} tone="error" /> : null}

      <View style={styles.section}>
        <Text style={styles.overline}>NOMBRE Y PERFIL</Text>
        <Field label="Nombres *" value={draft.firstNames} onChangeText={value => set("firstNames", value)} error={errors.firstNames} maxLength={50} autoCapitalize="words" autoComplete="name-given" textContentType="givenName" editable={!disabled} />
        <Field label="Apellido paterno *" value={draft.lastNames} onChangeText={value => set("lastNames", value)} error={errors.lastNames} maxLength={50} autoCapitalize="words" autoComplete="name-family" textContentType="familyName" editable={!disabled} />
        <Field label="Apellido materno" value={draft.secondLastName ?? ""} onChangeText={value => set("secondLastName", value)} error={errors.secondLastName} maxLength={50} autoCapitalize="words" placeholder="Opcional" editable={!disabled} />
        <Field label="Nombre social" value={draft.preferredName ?? ""} onChangeText={value => set("preferredName", value)} error={errors.preferredName} maxLength={50} autoCapitalize="words" placeholder="Opcional" hint="Nombre con el que prefieres que te identifiquen." editable={!disabled} />
        <BirthdateField value={draft.birthdate} disabled={disabled} onChange={value => set("birthdate", value)} />
        <ChoiceChips label="Género" options={GENDER_OPTIONS} value={draft.gender} disabled={disabled} onChange={value => set("gender", value as Draft["gender"])} />
      </View>

      <View style={styles.section}>
        <Text style={styles.overline}>DATOS COMPLEMENTARIOS</Text>
        <OptionField label="Nacionalidad" icon="flag-outline" options={NATIONALITY_OPTIONS} value={draft.nationality} disabled={disabled} onChange={value => set("nationality", value as Draft["nationality"])} />
        <OptionField label="Estado civil" icon="people-outline" options={MARITAL_STATUS_OPTIONS} value={draft.maritalStatus} disabled={disabled} onChange={value => set("maritalStatus", value as Draft["maritalStatus"])} />
        <ChoiceChips label="Grupo sanguíneo" options={BLOOD_TYPE_OPTIONS} value={draft.bloodType} disabled={disabled} onChange={value => set("bloodType", value as Draft["bloodType"])} />
      </View>

      <View style={styles.locked}>
        <Ionicons name="lock-closed-outline" size={18} color={palette.textSecondary} accessible={false} />
        <View style={styles.grow}>
          <Text style={styles.lockedTitle}>Identificación: {[profile.identification.type, profile.identification.number].filter(Boolean).join(" ") || "Sin registrar"}</Text>
          <Text style={styles.lockedText}>La identificación, el correo, el cargo y los permisos solo los modifica un administrador.</Text>
        </View>
      </View>
    </ScrollView>
    <View style={styles.footer}>
      <Button title="Guardar cambios" icon="save-outline" disabled={!available || !dirty} loading={busy} onPress={() => void save()} />
      <Button title="Cancelar" variant="ghost" disabled={busy} onPress={onCancel} />
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: palette.background },
  header: { paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  grow: { flex: 1, minWidth: 0 },
  content: { width: "100%", maxWidth: 880, alignSelf: "center", padding: 16, gap: 16, paddingBottom: 32 },
  section: { gap: 16, padding: 18, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  overline: { ...typography.overline, color: palette.textSecondary },
  locked: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: palette.track },
  lockedTitle: { ...typography.label, color: palette.text }, lockedText: { ...typography.caption, color: palette.textSecondary },
  footer: { padding: 16, gap: 8, borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
});
