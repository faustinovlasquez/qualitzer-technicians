import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Health, Session } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import { Badge, BodyText, Brand, Button, Card, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";
import type { CompanyBrandingUi } from "../branding/contracts";
import type { DeviceSecurityUi } from "../security/DeviceSecurityContext";
import { DeviceSecurityCard } from "../security/DeviceSecurityCard";

export function ProfileScreen({ session, companyBranding, deviceSecurity, onNotificationSettings, gatewayUrl, busy, error, health, offline, offlineVerifiedAt, onOffline, onBranch, onLogout, onCheck }: {
  session: Session; gatewayUrl: string; busy: boolean; error: string | null; health: Health | null;
  companyBranding: CompanyBrandingUi;
  deviceSecurity?: DeviceSecurityUi;
  onNotificationSettings?: () => void;
  offline?: OfflineSnapshot | null; offlineVerifiedAt?: number | null; onOffline?: () => void;
  onBranch: (id: number) => void; onLogout: () => void; onCheck: () => void;
}) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const currentBranch = session.user.accessBranchs.find((branch) => branch.id === session.branchId);
  return <ScrollView contentContainerStyle={styles.content}>
    <SectionTitle title="Mi perfil" subtitle="Tu espacio de trabajo en terreno" />
    <Card style={styles.stack}>
      <View style={styles.avatar}><Text style={styles.initials}>{session.user.name[0]}{session.user.lastnames[0]}</Text></View>
      <Text style={styles.title}>{session.user.name} {session.user.lastnames}</Text>
      <BodyText>{session.user.email}</BodyText><Badge label={session.user.role.name} tone="teal" />
      {session.mode === "demo" && <Badge label="Demostración · sin datos reales" tone="warning" />}
    </Card>
    {onNotificationSettings ? <Card style={styles.stack}>
      <SectionTitle title="Notificaciones" subtitle="Decide qué avisos recibir y cuándo" />
      <BodyText>Configura permisos, nuevas asignaciones, recordatorios y horario silencioso. Tus avisos se consultan en la pestaña Avisos.</BodyText>
      <Button title="Configurar notificaciones" icon="notifications-outline" variant="secondary" disabled={busy} onPress={onNotificationSettings} />
    </Card> : null}
    {deviceSecurity && session.mode === "live" ? <DeviceSecurityCard security={deviceSecurity} disabled={busy} /> : null}
    <Card style={styles.stack}>
      <SectionTitle title="Empresa actual" />
      <Brand tenant={session.tenant} />
      <BodyText>{session.tenant.portalOrigin}</BodyText>
      <Badge label={session.tenant.environment === "development" ? "Entorno local" : "Producción"} tone={session.tenant.environment === "development" ? "warning" : "teal"} />
      <BodyText>Sucursal actual: {currentBranch?.name ?? "Sin sucursal seleccionada"}</BodyText>
    </Card>
    <Card style={styles.stack}>
      <SectionTitle title="Empresa en tu teléfono" />
      <BodyText>La aplicación instalada sigue siendo Qualitzer técnicos. Puedes añadir un acceso de {session.tenant.name} a la pantalla de inicio; esto no renombra el icono principal del menú de aplicaciones.</BodyText>
      <BodyText>{companyBranding.logoMessage}</BodyText>
      <Button title="Añadir empresa a pantalla de inicio" icon="add-circle-outline" variant="secondary" loading={companyBranding.busy} disabled={busy || !companyBranding.canPin} onPress={companyBranding.onPin} />
      <Text accessibilityLiveRegion="polite" style={styles.brandingMessage}>{companyBranding.message}</Text>
      <BodyText>Al cerrar sesión o cambiar de empresa se deshabilitan los accesos anteriores. Android puede conservarlos atenuados; puedes quitarlos manualmente. Recientes puede mostrar el nombre y logo de la empresa mientras la sesión esté activa.</BodyText>
    </Card>
    <Card style={styles.stack}>
      <SectionTitle title="Sucursal activa" subtitle="Solo se muestran las sucursales habilitadas para tu cuenta." />
      {session.user.accessBranchs.filter((branch) => branch.isEnabled !== false && branch.isDeleted !== true).map((branch) => <Button key={branch.id} title={branch.name} icon={branch.id === session.branchId ? "checkmark-circle" : "business-outline"} variant={branch.id === session.branchId ? "primary" : "secondary"} disabled={busy || Boolean(offline && (!offline.online || offline.authBlocked || offline.pending > 0))} onPress={() => onBranch(branch.id)} />)}
      <BodyText>Cambiar de sucursal requiere conexión y ausencia de operaciones pendientes. Las copias de cada sucursal se mantienen separadas.</BodyText>
    </Card>
    <Card style={styles.stack}>
      <SectionTitle title="Conexión con Qualitzer" /><BodyText>{gatewayUrl}</BodyText>
      <BodyText>Conexión mediante API. No se almacena ninguna contraseña de base de datos en la app.</BodyText>
      <Button title="Comprobar conexión" variant="secondary" icon="pulse-outline" onPress={onCheck} loading={busy} />
      {health && <Badge label={health.backendReachable ? "Pasarela y backend disponibles" : "Pasarela disponible · backend sin respuesta"} tone={health.backendReachable ? "success" : "warning"} />}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </Card>
    <Card style={styles.stack}>
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
    </Card>
    {confirmLogout ? <Card style={styles.stack}>
      <SectionTitle title="¿Cerrar sesión / cambiar empresa?" subtitle={`Si hay operaciones sin confirmar en el dispositivo, el cierre se bloqueará sin borrar nada. Si no hay pendientes, se eliminarán la sesión y los borradores aún no guardados en la cola de ${session.tenant.name}. La cola y la caché se conservan aisladas.`} />
      <Button title="Comprobar pendientes y cerrar sesión" variant="danger" onPress={onLogout} loading={busy} />
      <Button title="Seguir trabajando" variant="secondary" disabled={busy} onPress={() => setConfirmLogout(false)} />
    </Card> : <Button title="Cerrar sesión / cambiar empresa" icon="log-out-outline" variant="secondary" onPress={() => setConfirmLogout(true)} disabled={busy} />}
    <BodyText style={{ textAlign: "center" }}>Qualitzer técnicos · Versión 1.0.14</BodyText>
  </ScrollView>;
}
const styles = StyleSheet.create({
  brandingMessage: { color: palette.textSecondary, lineHeight: 22 },
  content: { width: "100%", maxWidth: 880, alignSelf: "center", padding: 22, gap: 20, paddingBottom: 32 }, stack: { gap: 14 }, title: { fontSize: 24, color: palette.navy, fontWeight: "800" },
  avatar: { width: 64, height: 64, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" }, initials: { fontSize: 24, fontWeight: "700", color: palette.primary }, error: { color: palette.danger, lineHeight: 22 },
});