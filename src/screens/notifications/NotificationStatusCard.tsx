import { StyleSheet, Text, View } from "react-native";
import type { MobileNotificationsModel } from "../../notifications/useMobileNotifications";
import { Badge, BodyText, Button, Card } from "../../ui/components";
import { palette, typography } from "../../ui/theme";

const permissionLabels = {
  unknown: "Comprobando permiso", undetermined: "Permiso no solicitado", granted: "Permiso concedido",
  provisional: "Permiso provisional (avisos silenciosos)", ephemeral: "Permiso temporal de iOS",
  denied: "Permiso denegado", blocked: "Bloqueado en ajustes del sistema", unsupported: "Sin push nativo",
};

export function NotificationStatusCard({ notifications }: { notifications: MobileNotificationsModel }) {
  const { client, state } = notifications;
  if (!state || !client) return <Card><BodyText>Las notificaciones requieren una sesión real, un trabajador y una sucursal seleccionada.</BodyText></Card>;
  const adapter = client.options.adapter;
  const supported = adapter.platform !== "unsupported";
  const projectMissing = supported && !adapter.projectId;
  const projectMismatch = supported && Boolean(state.status?.projectId && adapter.projectId && state.status.projectId !== adapter.projectId);
  const canEnable = state.ready && supported && Boolean(state.status?.enabled) && !projectMissing && !projectMismatch && state.permission !== "blocked";
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title}>Notificaciones del teléfono</Text>
        <Badge label={state.registered ? "Registro activo" : "Sin registro activo"} tone={state.registered ? "success" : "neutral"} />
      </View>
      <BodyText>{permissionLabels[state.permission]}</BodyText>
      {!supported ? <BodyText>{adapter.unsupportedReason === "MOBILE_PUSH_EXPO_GO_UNSUPPORTED"
        ? "Expo Go no admite este cliente push. Usa una compilación de desarrollo o distribución con las credenciales nativas configuradas."
        : "En web puedes consultar la bandeja del servidor; no se registran notificaciones push nativas."}</BodyText> : null}
      {projectMissing ? <BodyText>Falta un projectId EAS válido y coherente en esta compilación.</BodyText> : null}
      {projectMismatch ? <BodyText>El proyecto EAS de la app no coincide con el autorizado por el servidor. No se enviará ningún token.</BodyText> : null}
      <BodyText>{state.status ? state.status.enabled ? "Servicio del servidor habilitado." : "Servicio del servidor deshabilitado o con requisitos pendientes." : "Estado del servidor todavía no disponible."}</BodyText>
      {state.status?.reasons.map((reason) => <Text key={reason} selectable style={styles.detail}>{reason}</Text>)}
      {state.status?.reconciliationStale ? <Text accessibilityRole="alert" style={styles.warning}>La reconciliación del servidor está atrasada. Los avisos pueden no generarse.</Text> : null}
      {state.status?.lastReconciledAt ? <Text style={styles.detail}>Última reconciliación: {new Date(state.status.lastReconciledAt).toLocaleString()}</Text> : null}
      {state.status?.lastFailure ? <Text selectable style={styles.warning}>Último fallo del servidor: {state.status.lastFailure}</Text> : null}
      {state.status?.device?.disabledReason ? <Text selectable style={styles.warning}>Registro desactivado: {state.status.device.disabledReason}</Text> : null}
      {Boolean(state.status?.deadLetters) ? <Text style={styles.warning}>Eventos con fallo definitivo: {state.status?.deadLetters}</Text> : null}
      <Text style={styles.detail}>Con la app cerrada, los avisos dependen del cron del servidor, Expo y el sistema operativo. No se garantiza su entrega ni una hora exacta. No hay sondeo en segundo plano en el teléfono.</Text>
      {state.error ? <Text accessibilityRole="alert" selectable style={styles.warning}>{state.error}</Text> : null}
      {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{state.notice}</Text> : null}
      <View style={styles.actions}>
        {supported && !state.registered ? <Button title="Activar notificaciones" disabled={!canEnable || state.busy} onPress={() => { void client.retryEnable(); }} icon="notifications-outline" /> : null}
        {supported && (state.registered || state.optedIn) ? <Button title="Desactivar registro" variant="secondary" disabled={state.busy} onPress={() => { void client.disable(); }} /> : null}
        {supported && (state.permission === "blocked" || state.permission === "denied" || state.permission === "provisional") ? <Button title="Abrir ajustes del sistema" variant="secondary" disabled={state.busy} onPress={() => { void client.openSettings(); }} /> : null}
        <Button title="Actualizar estado" variant="ghost" loading={state.busy} onPress={() => { void client.refresh(); }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { ...typography.heading, color: palette.navy, flexGrow: 1 },
  actions: { gap: 8 }, detail: { ...typography.caption, color: palette.textSecondary },
  warning: { ...typography.label, color: palette.danger }, success: { ...typography.label, color: palette.success },
});