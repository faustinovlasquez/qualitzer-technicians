import { useContext, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { MobileNotificationsModel } from "../../notifications/useMobileNotifications";
import { DeviceSecurityContext } from "../../security/DeviceSecurityContext";
import { Badge, BodyText, Button, Card } from "../../ui/components";
import { palette, typography } from "../../ui/theme";
import { notificationErrorMessage, notificationSupportCode, notificationTimestamp } from "./notificationPresentation";

const permissionLabels = {
  unknown: "Comprobando permiso", undetermined: "Permiso no solicitado", granted: "Permiso concedido",
  provisional: "Permiso provisional (avisos silenciosos)", ephemeral: "Permiso temporal de iOS",
  denied: "Permiso denegado", blocked: "Bloqueado en ajustes del sistema", unsupported: "Sin push nativo",
};

export function NotificationStatusCard({ notifications }: { notifications: MobileNotificationsModel }) {
  const { client, state } = notifications;
  const security = useContext(DeviceSecurityContext);
  const [advanced, setAdvanced] = useState(false);
  if (!state || !client) return <Card style={styles.card}><Text accessibilityRole="header" style={styles.title}>Avisos en este teléfono</Text><BodyText>Conecta tu sesión y selecciona una sucursal para consultar el estado de los avisos.</BodyText></Card>;
  const adapter = client.options.adapter;
  const supported = adapter.platform !== "unsupported";
  const projectMissing = supported && !adapter.projectId;
  const projectMismatch = supported && Boolean(state.status?.projectId && adapter.projectId && state.status.projectId !== adapter.projectId);
  const allowed = state.permission === "granted" || state.permission === "provisional" || state.permission === "ephemeral";
  const active = state.registered && allowed;
  const canAct = () => client.isCurrent() && (security?.isUnlocked() ?? true);
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title}>Avisos en este teléfono</Text>
        <Badge label={!state.ready ? "Comprobando" : active ? "Activados" : "Sin activar"} tone={active ? "teal" : "neutral"} />
      </View>
      <BodyText>{!supported ? adapter.unsupportedReason === "MOBILE_PUSH_EXPO_GO_UNSUPPORTED" ? "Usa la app instalada de Qualitzer para recibir avisos en este teléfono." : "En el navegador puedes consultar tu bandeja. Los avisos del teléfono se configuran desde la app instalada."
        : !state.ready ? "Estamos consultando el permiso y el registro de este teléfono."
          : active ? state.permission === "provisional" ? "Tu teléfono está registrado. El sistema permite avisos silenciosos." : "Tu teléfono está registrado y tiene permiso para recibir avisos."
            : !allowed ? "Permite las notificaciones en este teléfono y activa los avisos para recibir tus asignaciones y recordatorios."
              : "El permiso está concedido. Falta activar el registro de este teléfono."}</BodyText>
      <Text style={styles.detail}>El sistema operativo y la conexión pueden retrasar los avisos. El registro no garantiza que cada aviso se muestre.</Text>
      <Text style={styles.detail}>En Android, revisa sonido, vibración y ventanas emergentes en los ajustes de la app. Los canales ya existentes conservan tus elecciones del sistema; no se fuerzan al actualizar.</Text>
      <View style={styles.actions}>
        {Platform.OS !== "web" ? <Button title="Ajustes de notificaciones del teléfono" variant="secondary" icon="open-outline" onPress={() => { if (canAct()) void client.openSettings(); }} /> : null}
        <Button title={advanced ? "Ocultar opciones avanzadas" : "Opciones avanzadas"} variant="ghost" icon={advanced ? "chevron-up" : "chevron-down"} onPress={() => setAdvanced(!advanced)} />
      </View>
      {advanced ? <View style={styles.advanced}>
        <Text style={styles.detail}>{permissionLabels[state.permission]}</Text>
        <Text style={styles.detail}>Registro: {state.registered ? "activo" : "inactivo"} · Solicitud de activación: {state.optedIn ? "sí" : "no"}</Text>
        <Text style={styles.detail}>Servicio: {state.status ? state.status.enabled ? "habilitado" : "no disponible" : "sin consultar"}</Text>
        {projectMissing || projectMismatch ? <Text style={styles.detail}>{notificationErrorMessage(projectMissing ? "MOBILE_PUSH_PROJECT_MISSING" : "MOBILE_PUSH_PROJECT_MISMATCH")}</Text> : null}
        {state.status?.reconciliationStale ? <Text style={styles.detail}>El servicio tiene retrasos al preparar los avisos.</Text> : null}
        <Text style={styles.detail}>Última revisión del servicio: {state.status?.lastReconciledAt ? notificationTimestamp(state.status.lastReconciledAt) : "no disponible"}</Text>
        {state.status?.reasons.map((reason) => <Text key={reason} selectable style={styles.detail}>Soporte: {notificationSupportCode(reason) ?? "Sin código"}</Text>)}
        {[state.status?.lastFailure, state.status?.device?.disabledReason, state.error].filter((code): code is string => Boolean(code)).map((code, index) => <View key={`${code}-${index}`} style={styles.failure}>
          <Text style={styles.detail}>{notificationErrorMessage(code)}</Text><Text selectable style={styles.detail}>Soporte: {notificationSupportCode(code) ?? "Sin código"}</Text>
        </View>)}
        {Boolean(state.status?.deadLetters) ? <Text style={styles.detail}>Avisos que no se pudieron enviar: {state.status?.deadLetters}</Text> : null}
        <Button title="Actualizar estado" variant="secondary" loading={state.busy} onPress={() => { if (canAct()) void client.refresh(); }} />
      </View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { ...typography.heading, color: palette.navy, flexGrow: 1 },
  actions: { gap: 4 }, detail: { ...typography.caption, color: palette.textSecondary },
  advanced: { gap: 10, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 16 }, failure: { gap: 4 },
});