import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import type { Health, Session } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import { Badge, BodyText, Brand, Button, Card, IconButton, SectionTitle, type IconName } from "../ui/components";
import { palette, radius } from "../ui/theme";
import type { CompanyBrandingUi } from "../branding/contracts";
import type { DeviceSecurityUi } from "../security/DeviceSecurityContext";
import { DeviceSecurityCard } from "../security/DeviceSecurityCard";
import type { UserSignatureAccess } from "../domain/userSignatures";
import { UserSignaturesPanel } from "./signatures/UserSignaturesPanel";
import { LocationSettingsPanel } from "../location/LocationSettingsPanel";
import type { LocationTrackingUi } from "../location/useLocationTracking";
import type { OwnProfileAccess } from "../domain/ownProfile";
import { useOwnProfile } from "./profile/useOwnProfile";
import { ProfileHeaderCard } from "./profile/ProfileHeaderCard";
import { PersonalDataEditor } from "./profile/PersonalDataEditor";
import { connectionPresentation } from "../offline/connectionPresentation";
import { openPrivacyPolicy } from "../infrastructure/privacyPolicy";
import { changeColorPreference, readColorPreference, type ColorPreference } from "../ui/colorScheme";

type Section = "profile" | "appearance" | "security" | "location" | "company" | "connection" | "privacy" | "logout";
const sectionTitles: { [K in Section]: string } = {
  profile: "Mi perfil", appearance: "Apariencia", security: "Seguridad", location: "Ubicación", company: "Empresa y sucursal",
  connection: "Conexión con Qualitzer", privacy: "Privacidad y datos", logout: "Cerrar sesión",
};

/** Ajustes al estilo de Android: un menú agrupado y cada opción abre su propia vista de detalle. */
export function ProfileScreen({ session, profileAccess, companyBranding, deviceSecurity, onNotificationSettings, signatureAccess, locationTracking, gatewayUrl, busy, error, health, offline, offlineVerifiedAt, onOffline, onBranch, onLogout, onCheck, onSectionChange }: {
  session: Session; gatewayUrl: string; busy: boolean; error: string | null; health: Health | null;
  profileAccess?: OwnProfileAccess;
  companyBranding: CompanyBrandingUi;
  deviceSecurity?: DeviceSecurityUi;
  onNotificationSettings?: () => void;
  signatureAccess?: UserSignatureAccess;
  locationTracking?: LocationTrackingUi;
  offline?: OfflineSnapshot | null; offlineVerifiedAt?: number | null; onOffline?: () => void;
  onBranch: (id: number) => void; onLogout: () => void; onCheck: () => void;
  /** Avisa a la App cuando hay una vista de detalle abierta, para que el botón atrás vuelva al menú. */
  onSectionChange?: (open: boolean) => void;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const [signaturesOpen, setSignaturesOpen] = useState(false);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const ownProfile = useOwnProfile(profileAccess);
  const currentBranch = session.user.accessBranchs.find((branch) => branch.id === session.branchId);
  const live = session.mode === "live";
  const detailOpen = section !== null || signaturesOpen || editingPersonal;
  useEffect(() => { onSectionChange?.(detailOpen); }, [detailOpen]);
  useEffect(() => () => { onSectionChange?.(false); }, []);
  useEffect(() => {
    if (!detailOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      if (editingPersonal) setEditingPersonal(false); else if (signaturesOpen) setSignaturesOpen(false); else setSection(null);
      return true;
    });
    return () => subscription.remove();
  }, [detailOpen, editingPersonal, signaturesOpen, busy]);

  if (signaturesOpen && signatureAccess) return <UserSignaturesPanel access={signatureAccess} onBack={() => setSignaturesOpen(false)} />;
  if (editingPersonal && ownProfile.profile && profileAccess) return <PersonalDataEditor profile={ownProfile.profile} busy={ownProfile.busy === "save"} available={profileAccess.available}
    error={ownProfile.error} onSave={ownProfile.save} onCancel={() => setEditingPersonal(false)} />;

  if (section) return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.detailHeader}>
      <IconButton name="arrow-back-outline" label="Volver a ajustes" onPress={() => setSection(null)} />
      <Text accessibilityRole="header" style={styles.detailTitle}>{sectionTitles[section]}</Text>
    </View>
    {section === "profile" ? <ProfileHeaderCard session={session} branchName={currentBranch?.name ?? null} access={profileAccess} state={ownProfile} disabled={busy}
      onEdit={() => { ownProfile.clearMessages(); setEditingPersonal(true); }} /> : null}
    {section === "appearance" ? <AppearanceCard busy={busy} /> : null}
    {section === "security" && deviceSecurity ? <DeviceSecurityCard security={deviceSecurity} disabled={busy} /> : null}
    {section === "location" && locationTracking ? <LocationSettingsPanel key={`${session.tenant.id}:${session.user.id}:${session.user.workerId}:${session.branchId}`} tracking={locationTracking} disabled={busy} /> : null}
    {section === "company" ? <>
      <Card style={styles.stack}>
        <SectionTitle title="Empresa actual" />
        <Brand tenant={session.tenant} genericLogo={false} />
        <BodyText>{session.tenant.portalOrigin}</BodyText>
        <Badge label={session.tenant.environment === "development" ? "Entorno local" : "Producción"} tone={session.tenant.environment === "development" ? "warning" : "teal"} />
        <BodyText>Sucursal actual: {currentBranch?.name ?? "Sin sucursal seleccionada"}</BodyText>
      </Card>
      <Card style={styles.stack}>
        <SectionTitle title="Sucursal activa" subtitle="Solo se muestran las sucursales habilitadas para tu cuenta." />
        {session.user.accessBranchs.filter((branch) => branch.isEnabled !== false && branch.isDeleted !== true).map((branch) => <Button key={branch.id} title={branch.name} icon={branch.id === session.branchId ? "checkmark-circle" : "business-outline"} variant={branch.id === session.branchId ? "primary" : "secondary"} disabled={busy || Boolean(offline && (!offline.online || offline.authBlocked || offline.pending > 0))} onPress={() => onBranch(branch.id)} />)}
        <BodyText>Cambiar de sucursal requiere conexión y ausencia de operaciones pendientes. Las copias de cada sucursal se mantienen separadas.</BodyText>
      </Card>
      <Card style={styles.stack}>
        <SectionTitle title="Empresa en tu teléfono" />
        <BodyText>La aplicación instalada sigue siendo Qualitzer técnicos. Puedes añadir un acceso de {session.tenant.name} a la pantalla de inicio; esto no renombra el icono principal del menú de aplicaciones.</BodyText>
        <BodyText>{companyBranding.logoMessage}</BodyText>
        <Button title="Añadir empresa a pantalla de inicio" icon="add-circle-outline" variant="secondary" loading={companyBranding.busy} disabled={busy || !companyBranding.canPin} onPress={companyBranding.onPin} />
        <Text accessibilityLiveRegion="polite" style={styles.brandingMessage}>{companyBranding.message}</Text>
        <BodyText>Al cerrar sesión o cambiar de empresa se deshabilitan los accesos anteriores. Android puede conservarlos atenuados; puedes quitarlos manualmente. Recientes puede mostrar el nombre y logo de la empresa mientras la sesión esté activa.</BodyText>
      </Card>
    </> : null}
    {section === "connection" ? <Card style={styles.stack}>
      <SectionTitle title="Conexión con Qualitzer" /><BodyText>{gatewayUrl}</BodyText>
      <BodyText>Conexión mediante API. No se almacena ninguna contraseña de base de datos en la app.</BodyText>
      <Button title="Comprobar conexión" variant="secondary" icon="pulse-outline" onPress={onCheck} loading={busy} />
      {health && <Badge label={health.backendReachable ? "Pasarela y backend disponibles" : "Pasarela disponible · backend sin respuesta"} tone={health.backendReachable ? "success" : "warning"} />}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </Card> : null}
    {section === "privacy" ? <Card style={styles.stack}>
      <SectionTitle title="Tus datos, bajo control" />
      <BodyText>{Platform.OS === "web" ? "La sesión se recuerda en este navegador, incluso al recargar o volver a abrir la app." : "La sesión se recuerda al volver a abrir la app y se protege con el almacén seguro del dispositivo."}</BodyText>
      <BodyText>Al cerrar sesión se elimina la sesión guardada. Si el servidor la revoca o solicita un nuevo acceso por seguridad, volverás al inicio de sesión.</BodyText>
      <BodyText>Esta sesión da acceso únicamente a la empresa actual. Para cambiar de empresa, cierra sesión e ingresa de nuevo; si tienes acceso a varias empresas, podrás elegir después de verificar tus credenciales.</BodyText>
      <BodyText>Las creaciones, respuestas, comentarios, archivos, acciones del cronómetro y asociaciones de checklist se guardan primero en la cola local. Pendiente no significa confirmado ni suma avance. La sincronización continúa con conexión, sesión válida y la app abierta, en primer plano y desbloqueada; no funciona como servicio con la app cerrada.</BodyText>
      <BodyText>Iniciar, pausar o reanudar requiere un trabajo canónico ejecutable y una copia del día consultado, sin revocación conocida. Asociar un checklist requiere además una opción del catálogo guardada para ese trabajo. El servidor revalida permisos al aplicar.</BodyText>
      <BodyText>El cronómetro usa la hora del servidor al aplicar cada acción, no la hora del toque. No reconstruye tiempo sin conexión; una acción pendiente o aún sin lectura actualizada no hace avanzar el reloj mostrado.</BodyText>
      <BodyText>El reporte, el borrado de archivos, la finalización y la entrega siguen requiriendo conexión y confirmación remota. El inicio de una OT también requiere conexión. Una foto remota solo está disponible offline si sus bytes están descargados, no por aparecer en el listado.</BodyText>
      <BodyText>Última verificación online del perfil: {offlineVerifiedAt ? new Date(offlineVerifiedAt).toLocaleString("es-CL") : "No disponible"}. No es una garantía de autorización actual sin conexión.</BodyText>
      <BodyText>La cola y la caché no se borran al cerrar sesión. El acceso local se deshabilita hasta un nuevo acceso verificado. Los borradores no están cifrados por la app: protege tu dispositivo con bloqueo de pantalla.</BodyText>
      {onOffline ? <Button title="Revisar cobertura y pendientes" variant="secondary" icon="cloud-offline-outline" onPress={onOffline} disabled={busy} /> : null}
      <Button title="Política de privacidad" variant="secondary" icon="shield-checkmark-outline" onPress={() => { void openPrivacyPolicy().catch(() => undefined); }} />
    </Card> : null}
    {section === "logout" ? <Card style={styles.stack}>
      <SectionTitle title="¿Cerrar sesión / cambiar empresa?" subtitle={`Si hay operaciones sin confirmar en el dispositivo, el cierre se bloqueará sin borrar nada. Si no hay pendientes, se eliminarán la sesión y los borradores aún no guardados en la cola de ${session.tenant.name}. La cola y la caché se conservan aisladas.`} />
      <Button title="Comprobar pendientes y cerrar sesión" variant="danger" onPress={onLogout} loading={busy} />
      <Button title="Seguir trabajando" variant="secondary" disabled={busy} onPress={() => setSection(null)} />
    </Card> : null}
  </ScrollView>;

  const presentation = connectionPresentation(offline ?? null);
  const pending = offline?.pending ?? 0;
  const conflicts = offline?.conflicts ?? 0;
  const user = session.user;
  const name = [user.name, user.lastnames].filter(Boolean).join(" ").trim() || user.email;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("") || "?";
  const appearance = appearanceOptions.find(option => option.value === readColorPreference())?.label ?? "Según el teléfono";
  const version = Constants.expoConfig?.version;
  return <ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Ajustes</Text>

    <Pressable accessibilityRole="button" accessibilityLabel={`Mi perfil: ${name}`} onPress={() => setSection("profile")}
      style={({ pressed }) => [styles.group, styles.account, pressed && styles.pressed]}>
      <View style={styles.accountText}>
        <Text style={styles.accountName} numberOfLines={2}>{name}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>{user.email}</Text>
        {user.role?.name ? <Text style={styles.rowSubtitle} numberOfLines={1}>{user.role.name}</Text> : null}
        <Text style={styles.accountLink}>Ver y editar mi perfil</Text>
      </View>
      <View style={styles.avatar}>{avatarFailed || !/^https?:\/\//.test(user.avatarThumbnail ?? "") ? <Text style={styles.avatarText}>{initials}</Text>
        : <Image source={{ uri: user.avatarThumbnail }} style={styles.avatarImage} onError={() => setAvatarFailed(true)} accessible={false} />}</View>
    </Pressable>

    <Group>
      {onOffline ? <MenuRow icon="cloud-offline" color={conflicts > 0 ? palette.danger : pending > 0 ? palette.amber : palette.info} title="Centro offline"
        subtitle={`${presentation.title} · ${pending === 1 ? "1 pendiente" : `${pending} pendientes`}${conflicts > 0 ? ` · ${conflicts} por revisar` : ""}`}
        disabled={busy} onPress={onOffline} /> : null}
      {onNotificationSettings ? <MenuRow icon="notifications" color={palette.orange} title="Notificaciones" subtitle="Permisos · Avisos · Horario silencioso" disabled={busy} onPress={onNotificationSettings} /> : null}
      <MenuRow icon="color-palette" color={palette.violet} title="Apariencia" subtitle={`Modo ${appearance.toLowerCase()}`} onPress={() => setSection("appearance")} />
    </Group>

    {signatureAccess || (live && (deviceSecurity || locationTracking)) ? <Group>
      {signatureAccess ? <MenuRow icon="create" color={palette.primary} title="Firmas" subtitle="Tus firmas para entregas y documentos" disabled={busy} onPress={() => setSignaturesOpen(true)} /> : null}
      {deviceSecurity && live ? <MenuRow icon="lock-closed" color={palette.success} title="Seguridad" subtitle="Bloqueo y protección de la app" onPress={() => setSection("security")} /> : null}
      {locationTracking && live ? <MenuRow icon="location" color={palette.info} title="Ubicación" subtitle="Seguimiento durante la jornada" onPress={() => setSection("location")} /> : null}
    </Group> : null}

    <Group>
      <MenuRow icon="business" color={palette.primary} title="Empresa y sucursal" subtitle={`${session.tenant.name} · ${currentBranch?.name ?? "Sin sucursal"}`} onPress={() => setSection("company")} />
      <MenuRow icon="pulse" color={palette.success} title="Conexión con Qualitzer" subtitle="Estado de la pasarela y del servidor" onPress={() => setSection("connection")} />
    </Group>

    <Group>
      <MenuRow icon="shield-checkmark" color={palette.info} title="Privacidad y datos" subtitle="Sesión · Datos sin conexión · Borradores" onPress={() => setSection("privacy")} />
      <MenuRow icon="document-text" color={palette.textSecondary} title="Política de privacidad" subtitle="Se abre en el navegador" trailing="open-outline"
        onPress={() => { void openPrivacyPolicy().catch(() => undefined); }} />
    </Group>

    <Group>
      <MenuRow icon="log-out" color={palette.danger} title="Cerrar sesión / cambiar empresa" subtitle={session.tenant.name} danger disabled={busy} onPress={() => setSection("logout")} />
    </Group>

    <Text style={styles.version}>{`Qualitzer técnicos${version ? ` · Versión ${version}` : ""}`}</Text>
  </ScrollView>;
}

function Group({ children }: { children: ReactNode }) {
  const rows = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return <View style={styles.group}>
    {rows.map((row, index) => <View key={index}>{index > 0 ? <View style={styles.divider} /> : null}{row}</View>)}
  </View>;
}

function MenuRow({ icon, color, title, subtitle, onPress, disabled, danger, trailing = "chevron-forward" }: {
  icon: IconName; color: string; title: string; subtitle?: string; onPress: () => void; disabled?: boolean; danger?: boolean; trailing?: IconName;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} accessibilityState={{ disabled: Boolean(disabled) }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}>
    <View style={[styles.rowIcon, { backgroundColor: color }]}><Ionicons name={icon} size={20} color={palette.white} accessible={false} /></View>
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, danger && styles.rowDanger]} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
    </View>
    <Ionicons name={trailing} size={18} color={palette.textMuted} accessible={false} />
  </Pressable>;
}

const appearanceOptions: Array<{ value: ColorPreference; label: string; icon: "sunny-outline" | "moon-outline" | "phone-portrait-outline" }> = [
  { value: "light", label: "Claro", icon: "sunny-outline" },
  { value: "dark", label: "Oscuro", icon: "moon-outline" },
  { value: "system", label: "Según el teléfono", icon: "phone-portrait-outline" },
];

/** Apariencia de la app: al elegir otra opción se guarda y la app se recarga para aplicar los colores. */
function AppearanceCard({ busy }: { busy: boolean }) {
  const [current] = useState(readColorPreference);
  const [saving, setSaving] = useState<ColorPreference | null>(null);
  const [failed, setFailed] = useState(false);
  async function choose(value: ColorPreference): Promise<void> {
    if (value === current || saving) return;
    setSaving(value); setFailed(false);
    try { await changeColorPreference(value); }
    catch { setFailed(true); setSaving(null); }
  }
  return <Card style={styles.stack}>
    <SectionTitle title="Apariencia" subtitle="Modo claro u oscuro de la app" />
    <View style={styles.appearance}>
      {appearanceOptions.map(option => <Button key={option.value} title={option.label} icon={option.icon} variant={option.value === current ? "primary" : "secondary"}
        accessibilityLabel={`Apariencia: ${option.label}${option.value === current ? ", seleccionada" : ""}`} loading={saving === option.value}
        disabled={busy || Boolean(saving)} onPress={() => { void choose(option.value); }} style={styles.appearanceOption} />)}
    </View>
    <BodyText>Al cambiarla, la app se recarga en un instante. No se pierde tu sesión ni tus cambios pendientes.</BodyText>
    {failed ? <Text accessibilityRole="alert" style={styles.error}>No se pudo aplicar la apariencia. Cierra y vuelve a abrir la app.</Text> : null}
  </Card>;
}

const styles = StyleSheet.create({
  appearance: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  appearanceOption: { flexGrow: 1, flexBasis: 140 },
  brandingMessage: { color: palette.textSecondary, lineHeight: 22 },
  content: { width: "100%", maxWidth: 880, alignSelf: "center", padding: 16, gap: 16, paddingBottom: 32 }, stack: { gap: 14 },
  error: { color: palette.danger, lineHeight: 22 },
  title: { fontSize: 30, lineHeight: 38, fontWeight: "800", color: palette.heading, paddingHorizontal: 6, paddingTop: 8, paddingBottom: 4 },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  detailTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: "800", color: palette.heading },
  group: { borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
  account: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  accountText: { flex: 1, minWidth: 0, gap: 2 },
  accountName: { fontSize: 20, lineHeight: 26, fontWeight: "800", color: palette.heading },
  accountLink: { fontSize: 13, fontWeight: "700", color: palette.primary, marginTop: 4 },
  avatar: { width: 64, height: 64, borderRadius: 32, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 24, fontWeight: "800", color: palette.white },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, minHeight: 64 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: "700", color: palette.text },
  rowDanger: { color: palette.danger },
  rowSubtitle: { fontSize: 13, lineHeight: 18, color: palette.textSecondary },
  divider: { height: 1, marginLeft: 68, backgroundColor: palette.border },
  disabled: { opacity: 0.5 }, pressed: { backgroundColor: palette.track },
  version: { fontSize: 12, color: palette.textMuted, textAlign: "center", marginTop: 4 },
});
