import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraPermissionError } from "../../domain/cameraErrors";
import type { Session } from "../../domain/models";
import {
  BLOOD_TYPE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, NATIONALITY_OPTIONS,
  optionLabel, profileAge, profileDisplayName, profileInitials, type OwnProfileAccess,
} from "../../domain/ownProfile";
import { avatarJpeg } from "../../infrastructure/avatarImage";
import { PrivateModal, useTrustedNativePicker } from "../../security/DeviceSecurityContext";
import { Badge, Button, Card, type IconName } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { Notice } from "../workDetail/DetailUi";
import { pickAvatar, type AvatarSource } from "./pickAvatar";
import { ProfileAvatar } from "./ProfileAvatar";
import { formatBirthdate } from "./ProfileFields";
import type { OwnProfileState } from "./useOwnProfile";

export function ProfileHeaderCard({ session, branchName, access, state, disabled, onEdit }: {
  session: Session; branchName: string | null; access: OwnProfileAccess | undefined; state: OwnProfileState; disabled: boolean; onEdit(): void;
}) {
  const [sheet, setSheet] = useState(false);
  const [settingsHint, setSettingsHint] = useState(false);
  const picker = useTrustedNativePicker();
  const { profile } = state;
  const firstNames = profile?.firstNames ?? session.user.name;
  const lastNames = profile?.lastNames ?? session.user.lastnames;
  const displayName = profile ? profileDisplayName(profile) : `${session.user.name} ${session.user.lastnames}`.trim();
  const legalName = profile ? [profile.firstNames, profile.lastNames, profile.secondLastName].filter(Boolean).join(" ") : null;
  const avatar = profile ? profile.avatarUrl ?? profile.avatarThumbnailUrl : session.user.avatarThumbnail ?? null;
  const canEdit = Boolean(access?.available && profile) && !disabled;
  const avatarBusy = state.busy === "avatar";

  async function choose(source: AvatarSource): Promise<void> {
    setSheet(false); setSettingsHint(false); state.clearMessages();
    try {
      const uri = await pickAvatar(source, picker, () => true);
      if (!uri) return;
      state.setAvatarBusy(true);
      let image: string;
      try { image = await avatarJpeg(uri); }
      finally { state.setAvatarBusy(false); }
      await state.saveAvatar(image);
    } catch (failure) {
      if (failure instanceof CameraPermissionError && !failure.canAskAgain) setSettingsHint(true);
      state.fail(failure instanceof Error ? failure.message : "No se pudo preparar la foto.");
    }
  }

  return <Card style={styles.card}>
    <View style={styles.cover} />
    <View style={styles.identity}>
      <ProfileAvatar uri={avatar} initials={profileInitials(firstNames, lastNames)} color={profile?.avatarColor} size={112} busy={avatarBusy}
        editable={Boolean(access)} disabled={!canEdit} onPress={() => setSheet(true)} />
      <Text style={styles.name} accessibilityRole="header">{displayName}</Text>
      {profile?.preferredName && legalName ? <Text style={styles.legal}>{legalName}</Text> : null}
      <View style={styles.badges}>
        <Badge label={session.user.role.name} tone="teal" />
        {session.mode === "demo" ? <Badge label="Demostración · sin datos reales" tone="warning" /> : null}
      </View>
      <View style={styles.meta}>
        <MetaLine icon="mail-outline" text={profile?.email ?? session.user.email} />
        <MetaLine icon="business-outline" text={[session.tenant.name, branchName].filter(Boolean).join(" · ")} />
      </View>
    </View>

    {state.busy === "load" && !profile ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Cargando tu perfil…</Text> : null}
    {state.notice ? <Notice message={state.notice} tone="success" onDismiss={state.clearMessages} /> : null}
    {state.error ? <Notice message={state.error} tone="error" onDismiss={state.clearMessages} /> : null}
    {settingsHint && Platform.OS !== "web" ? <Button title="Abrir ajustes de la app" icon="settings-outline" variant="secondary" onPress={() => void Linking.openSettings()} /> : null}
    {access && !access.available ? <Notice message="Sin conexión: los datos del perfil se muestran cuando vuelvas a estar en línea." tone="warning" /> : null}

    {profile ? <View style={styles.details}>
      <View style={styles.detailsHeader}>
        <Text style={styles.overline}>DATOS PERSONALES</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Editar datos personales" disabled={!canEdit} onPress={onEdit} style={({ pressed }) => [styles.editLink, !canEdit && styles.disabled, pressed && styles.pressed]}>
          <Ionicons name="create-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.editText}>Editar</Text>
        </Pressable>
      </View>
      <Row label="Identificación" value={[profile.identification.type, profile.identification.number].filter(Boolean).join(" ")} />
      <Row label="Nombre social" value={profile.preferredName} />
      <Row label="Fecha de nacimiento" value={profile.birthdate ? `${formatBirthdate(profile.birthdate)}${profileAge(profile.birthdate) !== null ? ` · ${profileAge(profile.birthdate)} años` : ""}` : null} />
      <Row label="Género" value={optionLabel(GENDER_OPTIONS, profile.gender)} />
      <Row label="Nacionalidad" value={optionLabel(NATIONALITY_OPTIONS, profile.nationality)} />
      <Row label="Estado civil" value={optionLabel(MARITAL_STATUS_OPTIONS, profile.maritalStatus)} />
      <Row label="Grupo sanguíneo" value={optionLabel(BLOOD_TYPE_OPTIONS, profile.bloodType)} last />
    </View> : null}
    {profile ? <Button title="Editar datos personales" icon="create-outline" variant="secondary" disabled={!canEdit} onPress={onEdit} />
      : access?.available && state.busy === null ? <Button title="Reintentar" icon="refresh-outline" variant="secondary" onPress={() => void state.reload()} /> : null}

    {sheet ? <PrivateModal visible transparent animationType="fade" onRequestClose={() => setSheet(false)}>
      <SafeAreaView style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Cerrar opciones de foto" onPress={() => setSheet(false)} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.sheetTitle}>Foto de perfil</Text>
          <Text style={styles.caption}>Se recorta en cuadrado y se guarda sin datos de ubicación.</Text>
          {Platform.OS !== "web" ? <Button title="Tomar foto" icon="camera-outline" onPress={() => void choose("camera")} /> : null}
          <Button title="Elegir de la galería" icon="images-outline" variant={Platform.OS === "web" ? "primary" : "secondary"} onPress={() => void choose("library")} />
          {avatar ? <Button title="Quitar foto" icon="trash-outline" variant="ghost" textStyle={{ color: palette.danger }} onPress={() => { setSheet(false); void state.removeAvatar(); }} /> : null}
          <Button title="Cancelar" variant="ghost" onPress={() => setSheet(false)} />
        </View>
      </SafeAreaView>
    </PrivateModal> : null}
  </Card>;
}

function MetaLine({ icon, text }: { icon: IconName; text: string }) {
  if (!text) return null;
  return <View style={styles.metaLine}><Ionicons name={icon} size={16} color={palette.textSecondary} accessible={false} /><Text style={styles.metaText} numberOfLines={1}>{text}</Text></View>;
}

function Row({ label, value, last = false }: { label: string; value: string | null | undefined; last?: boolean }) {
  return <View style={[styles.row, !last && styles.rowDivider]} accessible accessibilityLabel={`${label}: ${value || "Sin especificar"}`}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, !value && styles.rowEmpty]}>{value || "Sin especificar"}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 16, paddingTop: 0, overflow: "hidden" },
  cover: { height: 72, marginHorizontal: -20, backgroundColor: palette.primarySoft },
  identity: { alignItems: "center", gap: 8, marginTop: -60 },
  name: { ...typography.title, fontSize: 24, lineHeight: 30, color: palette.navy, textAlign: "center", marginTop: 4 },
  legal: { ...typography.label, color: palette.textSecondary, textAlign: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  meta: { gap: 4, alignItems: "center", maxWidth: "100%" },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  metaText: { ...typography.body, fontSize: 14, color: palette.textSecondary, flexShrink: 1 },
  caption: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  details: { borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, paddingTop: 10 },
  detailsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 4 },
  overline: { ...typography.overline, color: palette.textSecondary },
  editLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 8 },
  editText: { ...typography.label, color: palette.primary },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderColor: palette.border },
  rowLabel: { ...typography.body, fontSize: 14, color: palette.textSecondary, flexShrink: 0 },
  rowValue: { ...typography.label, color: palette.text, flexShrink: 1, textAlign: "right" },
  rowEmpty: { color: palette.textMuted, fontWeight: "400" },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.7 },
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: "rgba(18,44,58,0.55)" },
  sheet: { width: "100%", maxWidth: 520, backgroundColor: palette.surface, padding: 20, gap: 10, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  sheetTitle: { ...typography.heading, color: palette.text },
});
