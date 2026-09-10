import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { notificationPreferencesSchema, type NotificationInboxItem, type NotificationPreferences } from "../../domain/notifications";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../notifications/notificationSafety";
import type { MobileNotificationsModel } from "../../notifications/useMobileNotifications";
import { Badge, BodyText, Button, Card, EmptyState, Field, SectionTitle } from "../../ui/components";
import { palette, typography } from "../../ui/theme";
import { NotificationStatusCard } from "./NotificationStatusCard";

const deliveryLabels: { [K in NotificationInboxItem["state"]]: string } = {
  pending: "Pendiente en el servidor", sending: "Envío en proceso", accepted: "Aceptado por Expo (ticket)",
  receiving: "Consultando recibo", receipt_ok: "Recibo OK hacia FCM/APNs", receipt_unknown: "Recibo sin confirmar",
  cancelled: "Cancelado", expired: "Vencido", dead: "Fallo definitivo",
};
const kindLabels: { [K in NotificationInboxItem["kind"]]: string } = {
  WORK_TECHNICIAN_ASSIGNED: "Nueva asignación técnica", RUNNING_TIMER_REMINDER: "Cronómetro pendiente", MOBILE_PUSH_TEST: "Prueba de notificaciones",
};

export function NotificationCenterScreen({ notifications, onBack }: { notifications: MobileNotificationsModel; onBack?: () => void }) {
  return <NotificationCenterContent key={notifications.storageKey} notifications={notifications} onBack={onBack} />;
}

function NotificationCenterContent({ notifications, onBack }: { notifications: MobileNotificationsModel; onBack?: () => void }) {
  const { client, state } = notifications;
  const [preferences, setPreferences] = useState<NotificationPreferences>(state?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES);
  const dirty = useRef(false);
  useEffect(() => { dirty.current = false; setPreferences(client?.getSnapshot().preferences ?? DEFAULT_NOTIFICATION_PREFERENCES); }, [client]);
  useEffect(() => { if (state?.preferences && !dirty.current) setPreferences(state.preferences); }, [state?.preferences]);
  useEffect(() => { if (client && state?.ready && state.status?.enabled) void client.loadInbox(); }, [client, state?.ready, state?.status?.enabled]);
  const update = (change: Partial<NotificationPreferences>) => { dirty.current = true; setPreferences((previous) => ({ ...previous, ...change })); };
  const valid = notificationPreferencesSchema.safeParse(preferences).success;
  const editable = Boolean(state?.registered && !state.busy);
  async function save() {
    if (client && await client.savePreferences(preferences) && client.isCurrent()) {
      dirty.current = false;
      setPreferences(client.getSnapshot().preferences);
    }
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {onBack ? <Button title="Volver" variant="ghost" icon="arrow-back" onPress={onBack} /> : null}
      <SectionTitle title="Centro de notificaciones" subtitle="Asignaciones, cronómetros y estado real de los avisos" />
      <NotificationStatusCard notifications={notifications} />
      {client && state && client.options.adapter.platform !== "unsupported" ? <Card style={styles.card}>
        <SectionTitle title="Preferencias" subtitle="Se aplican a este dispositivo, cuenta y sucursal después de guardar." />
        <View style={styles.toggle}><Text style={styles.label}>Nuevas asignaciones</Text><Switch accessibilityLabel="Avisar nuevas asignaciones" disabled={!editable} value={preferences.assignments} onValueChange={(assignments) => update({ assignments })} /></View>
        <View style={styles.toggle}><Text style={styles.label}>Recordar cronómetros activos</Text><Switch accessibilityLabel="Recordar cronómetros activos" disabled={!editable} value={preferences.timers} onValueChange={(timers) => update({ timers })} /></View>
        <Text style={styles.label}>Primer recordatorio después de</Text>
        <View style={styles.options}>{([30, 60, 120] as const).map((minutes) => <Button key={minutes} title={`${minutes} min`} variant={preferences.remindAfterMinutes === minutes ? "primary" : "secondary"} disabled={!editable} onPress={() => update({ remindAfterMinutes: minutes })} />)}</View>
        <Text style={styles.label}>Repetir como máximo cada</Text>
        <View style={styles.options}>{([120, 240] as const).map((minutes) => <Button key={minutes} title={`${minutes / 60} horas`} variant={Math.max(120, preferences.repeatEveryMinutes) === minutes ? "primary" : "secondary"} disabled={!editable} onPress={() => update({ repeatEveryMinutes: minutes })} />)}</View>
        <Field label="Horario silencioso: inicio" hint="HH:mm, zona horaria de la sucursal" value={preferences.quietHoursStart} onChangeText={(quietHoursStart) => update({ quietHoursStart })} editable={editable} maxLength={5} autoCapitalize="none" placeholder="22:00" />
        <Field label="Horario silencioso: fin" hint="HH:mm. Inicio y fin iguales permiten avisos a cualquier hora." value={preferences.quietHoursEnd} onChangeText={(quietHoursEnd) => update({ quietHoursEnd })} editable={editable} maxLength={5} autoCapitalize="none" placeholder="07:00" />
        {!valid ? <Text accessibilityRole="alert" style={styles.warning}>Revisa las horas: formato HH:mm entre 00:00 y 23:59.</Text> : null}
        <BodyText>Valores iniciales: 30 minutos, repetición cada 2 horas y silencio de 22:00 a 07:00. Los recordatorios se agrupan por cuenta; no se pausa ni modifica ningún trabajo.</BodyText>
        <Button title="Guardar preferencias" disabled={!editable || !valid} onPress={() => { void save(); }} icon="save-outline" />
        <Button title="Enviar prueba a este dispositivo" variant="secondary" disabled={!editable} onPress={() => { void client.sendTest(); }} />
        <Text style={styles.caption}>La prueba usa solo el registro propio almacenado en el servidor. Máximo 5 por hora; puede vencer durante el horario silencioso.</Text>
      </Card> : null}
      <Card style={styles.card}>
        <SectionTitle title="Bandeja de la cuenta" subtitle="Páginas de 25 eventos. Pendiente, aceptado y recibo OK no significan entrega ni lectura en el teléfono." />
        <Button title="Actualizar bandeja" variant="secondary" disabled={!client || state?.busy || !state?.status?.enabled} onPress={() => { void client?.loadInbox(); }} />
        {!state?.inbox.length ? <EmptyState title="Sin eventos cargados" message={state?.status?.enabled ? "Actualiza para consultar el historial autorizado de esta cuenta y sucursal." : "La bandeja estará disponible cuando el servidor habilite el servicio."} icon="notifications-outline" /> : state.inbox.map((item) => <View key={item.id} style={styles.event}>
          <Text style={styles.label}>{kindLabels[item.kind]}</Text>
          <View style={styles.options}><Badge label={deliveryLabels[item.state]} /><Badge label={item.readAt ? "Leído" : "Sin leer"} tone={item.readAt ? "neutral" : "info"} /></View>
          <Text style={styles.caption}>{new Date(item.createdAt).toLocaleString()}{item.data.date ? ` · Fecha del trabajo: ${item.data.date}` : ""}</Text>
          {item.lastFailure ? <Text selectable style={styles.warning}>{item.lastFailure}</Text> : null}
          <View style={styles.options}>
            <Button title={item.kind === "MOBILE_PUSH_TEST" ? "Ver prueba" : "Abrir trabajo"} variant="secondary" disabled={state.busy} onPress={() => { void client?.openInboxItem(item.id); }} />
            {!item.readAt ? <Button title="Marcar leído" variant="ghost" disabled={state.busy} onPress={() => { void client?.markRead(item.id); }} /> : null}
          </View>
        </View>)}
        {state?.hasMore ? <Button title="Cargar 25 más" variant="secondary" disabled={state.busy} onPress={() => { void client?.loadInbox(true); }} /> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background }, content: { padding: 20, gap: 16, width: "100%", maxWidth: 880, alignSelf: "center", paddingBottom: 40 },
  card: { gap: 12 }, toggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  options: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, label: { ...typography.label, color: palette.navy, flexShrink: 1 },
  caption: { ...typography.caption, color: palette.textSecondary }, warning: { ...typography.label, color: palette.danger },
  event: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 16, gap: 10 },
});