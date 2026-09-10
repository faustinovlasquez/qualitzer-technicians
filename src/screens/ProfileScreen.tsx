import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Health, Session } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import { Badge, BodyText, Brand, Button, Card, SectionTitle } from "../ui/components";
import { palette } from "../ui/theme";

export function ProfileScreen({ session, gatewayUrl, busy, error, health, offline, offlineVerifiedAt, onOffline, onBranch, onLogout, onCheck }: {
  session: Session; gatewayUrl: string; busy: boolean; error: string | null; health: Health | null;
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
    <Card style={styles.stack}>
      <SectionTitle title="Empresa actual" />
      <Brand tenant={session.tenant} />
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
      <BodyText>Guardar una creación, respuesta, comentario o archivo puede dejarlo en la cola local hasta recibir confirmación del servidor. La sincronización continúa con conexión y la app abierta; al cerrarla debes volver a abrirla para continuar.</BodyText>
      <BodyText>El reporte, los cambios de estado y la entrega requieren conexión. Una foto remota solo está disponible offline si sus bytes están descargados, no por aparecer en el listado.</BodyText>
      <BodyText>Última verificación online del perfil: {offlineVerifiedAt ? new Date(offlineVerifiedAt).toLocaleString("es-CL") : "No disponible"}. No es una garantía de autorización actual sin conexión.</BodyText>
      <BodyText>La cola y la caché no se borran al cerrar sesión. El acceso local se deshabilita hasta un nuevo acceso verificado. Los borradores no están cifrados por la app: protege tu dispositivo con bloqueo de pantalla.</BodyText>
      {onOffline ? <Button title="Revisar cobertura y pendientes" variant="secondary" icon="cloud-offline-outline" onPress={onOffline} disabled={busy} /> : null}
    </Card>
    {confirmLogout ? <Card style={styles.stack}>
      <SectionTitle title="¿Cerrar sesión / cambiar empresa?" subtitle={`Si hay operaciones sin confirmar en el dispositivo, el cierre se bloqueará sin borrar nada. Si no hay pendientes, se eliminarán la sesión y los borradores aún no guardados en la cola de ${session.tenant.name}. La cola y la caché se conservan aisladas.`} />
      <Button title="Comprobar pendientes y cerrar sesión" variant="danger" onPress={onLogout} loading={busy} />
      <Button title="Seguir trabajando" variant="secondary" disabled={busy} onPress={() => setConfirmLogout(false)} />
    </Card> : <Button title="Cerrar sesión / cambiar empresa" icon="log-out-outline" variant="secondary" onPress={() => setConfirmLogout(true)} disabled={busy} />}
    <BodyText style={{ textAlign: "center" }}>Qualitzer Field · Primera versión técnica · 1.0.0</BodyText>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 880, alignSelf: "center", padding: 22, gap: 20, paddingBottom: 32 }, stack: { gap: 14 }, title: { fontSize: 24, color: palette.navy, fontWeight: "800" },
  avatar: { width: 64, height: 64, borderRadius: 22, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" }, initials: { fontSize: 24, fontWeight: "700", color: palette.primary }, error: { color: palette.danger, lineHeight: 22 },
});