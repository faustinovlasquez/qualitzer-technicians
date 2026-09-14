import { Ionicons } from "@expo/vector-icons";
import { useContext, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NotificationInboxItem } from "../../domain/notifications";
import type { MobileNotificationsModel } from "../../notifications/useMobileNotifications";
import { DeviceSecurityContext, PrivateModal } from "../../security/DeviceSecurityContext";
import { BodyText, Button, Card, EmptyState, IconButton, SectionTitle } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { notificationCounts, notificationDeliveryLabels, notificationErrorMessage, notificationKinds, notificationNoticeMessage, notificationSupportCode, notificationTimestamp, notificationWorkDate, notificationWorkReference } from "./notificationPresentation";

const notificationKindColors: { [K in NotificationInboxItem["kind"]]: { iconColor: string; backgroundColor: string } } = {
  WORK_TECHNICIAN_ASSIGNED: { iconColor: palette.primary, backgroundColor: palette.primarySoft },
  RUNNING_TIMER_REMINDER: { iconColor: palette.amber, backgroundColor: palette.amberSoft },
  MOBILE_PUSH_TEST: { iconColor: palette.info, backgroundColor: palette.infoSoft },
};

export function NotificationCenterScreen({ notifications, onBack }: { notifications: MobileNotificationsModel; onBack?: () => void }) {
  return <NotificationCenterContent key={notifications.storageKey} notifications={notifications} onBack={onBack} />;
}

function NotificationCenterContent({ notifications, onBack }: { notifications: MobileNotificationsModel; onBack?: () => void }) {
  const { client, state } = notifications;
  const security = useContext(DeviceSecurityContext);
  const insets = useSafeAreaInsets();
  const currentClient = useRef(client);
  currentClient.current = client;
  const mounted = useRef(true);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotificationInboxItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [support, setSupport] = useState(false);
  const [localError, setLocalError] = useState(false);
  const requestPending = useRef(false);
  const actionPending = useRef(false);
  const unreadOnly = state?.unreadOnly ?? false;
  const busy = !client || !state || Boolean(state.inboxBusy || loading || deletingId);
  const canAct = () => Boolean(client?.isCurrent() && (security?.isUnlocked() ?? true));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setDeleteTarget(null); setDetailsId(null); setDeletingId(null); setLocalError(false); }, [client]);
  useEffect(() => {
    if (client && state?.page === 0 && !state.inboxBusy && state.status?.enabled && client.isCurrent() && (security?.isUnlocked() ?? true)) {
      void client.loadInbox(false, client.getSnapshot().unreadOnly);
    }
  }, [client, state?.ready, state?.status?.enabled]);

  async function load(more = false, filter = unreadOnly) {
    if (!client || !canAct() || busy || requestPending.current) return;
    requestPending.current = true;
    setLoading(true);
    setLocalError(false);
    try {
      const success = await client.loadInbox(more, filter);
      if (mounted.current && currentClient.current === client && client.isCurrent()) setLocalError(!success);
    } catch {
      if (mounted.current && currentClient.current === client && client.isCurrent()) setLocalError(true);
    } finally {
      requestPending.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  async function remove() {
    if (!client || !deleteTarget || !canAct() || busy || actionPending.current || client.getSnapshot().canDelete !== true) return;
    actionPending.current = true;
    setDeletingId(deleteTarget.id);
    setLocalError(false);
    try {
      const removed = await client.deleteNotification(deleteTarget.id);
      if (!mounted.current || currentClient.current !== client || !client.isCurrent()) return;
      if (removed) setDeleteTarget(null);
      else setLocalError(true);
    } catch {
      if (mounted.current && currentClient.current === client && client.isCurrent()) setLocalError(true);
    } finally {
      actionPending.current = false;
      if (mounted.current && currentClient.current === client) setDeletingId(null);
    }
  }

  const error = state?.inboxError;
  const hasError = Boolean(error || localError);
  const firstLoading = Boolean(client && !state?.inbox.length && (state?.inboxBusy || loading));
  const unavailable = !client || !state || state.status?.enabled !== true;
  const cancelDelete = () => { if (!deletingId) { setDeleteTarget(null); setLocalError(false); } };

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
      keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading}
        onRefresh={() => { void load(); }} colors={[palette.primary]} tintColor={palette.primary} progressBackgroundColor={palette.surface} />}>
      <View style={styles.headingRow}>
        {onBack ? <IconButton name="arrow-back" label="Volver" onPress={() => { if (security?.isUnlocked() ?? true) onBack(); }} /> : null}
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>Avisos</Text>
          <Text style={styles.caption}>{notificationCounts(state?.unreadCount, state?.total)}</Text></View>
        <IconButton name="refresh-outline" label="Actualizar notificaciones" disabled={busy} onPress={() => { void load(); }} />
      </View>
      <View style={styles.filters} accessibilityRole="tablist">
        {[{ label: "Todas", value: false }, { label: "No leídas", value: true }].map((filter) => <Pressable key={filter.label}
          accessibilityRole="tab" accessibilityState={{ selected: unreadOnly === filter.value, disabled: busy }} aria-selected={unreadOnly === filter.value} disabled={busy}
          onPress={() => { if (unreadOnly !== filter.value) void load(false, filter.value); }}
          style={[styles.filter, unreadOnly === filter.value && styles.filterSelected, busy && styles.disabled]}>
          <Text style={[styles.filterText, unreadOnly === filter.value && styles.filterTextSelected]}>{filter.label}</Text>
        </Pressable>)}
      </View>
      {state?.inboxBusy ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Actualizando avisos…</Text> : null}
      {unreadOnly && state?.filterLocal ? <Text style={styles.caption}>Filtro sobre avisos cargados. Carga más para buscar otros avisos sin leer; el total global no está disponible.</Text> : null}
      {hasError ? <Card style={styles.feedback}>
        <Text accessibilityRole="alert" style={styles.message}>{notificationErrorMessage(error)}</Text>
        <Button title={support ? "Ocultar información de soporte" : "Información de soporte"} variant="ghost" onPress={() => setSupport(!support)} />
        {support ? <Text selectable style={styles.caption}>{notificationSupportCode(error) ?? "No hay un código adicional disponible."}</Text> : null}
      </Card> : null}
      {state?.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notificationNoticeMessage(state.notice)}</Text> : null}
      {firstLoading ? <View accessibilityLabel="Cargando notificaciones" accessibilityState={{ busy: true }} style={styles.stack}>
        {[0, 1, 2].map((index) => <View key={index} style={styles.skeletonCard}><View style={styles.skeletonIcon} /><View style={styles.heading}>
          <View style={styles.skeletonTitle} /><View style={styles.skeletonLine} /><View style={styles.skeletonShort} />
        </View></View>)}
      </View> : !state?.inbox.length ? <Card>
        <EmptyState icon={unavailable || hasError ? "cloud-offline-outline" : "notifications-outline"}
          title={unavailable ? "Bandeja no disponible" : hasError ? "No pudimos actualizar la bandeja" : state.page > 0 ? unreadOnly ? state.filterLocal ? "No hay avisos sin leer entre los cargados" : "No tienes avisos sin leer" : "Tu bandeja está al día" : "Consulta tus notificaciones"}
          message={!client ? "La bandeja requiere una sesión conectada, un trabajador y una sucursal. No hay datos para mostrar en este momento."
            : unavailable ? "El servicio no está disponible en este momento. Vuelve a actualizar cuando tengas conexión."
              : hasError ? "Vuelve a intentarlo con conexión. Esto no significa que no tengas notificaciones."
                : state.page > 0 ? unreadOnly ? state.filterLocal ? "Este filtro no confirma que toda la bandeja esté leída." : "Los nuevos avisos sin leer aparecerán aquí." : "Las nuevas asignaciones y recordatorios aparecerán aquí."
                  : "Actualiza para consultar los avisos de tu cuenta y sucursal."} />
        {client ? <Button title="Actualizar bandeja" variant="secondary" disabled={busy} onPress={() => { void load(); }} /> : null}
      </Card> : <View style={styles.stack}>
        {state.inbox.map((item) => {
          const kind = notificationKinds[item.kind];
          const kindColors = notificationKindColors[item.kind];
          const reference = notificationWorkReference(item);
          const date = notificationWorkDate(item.data.date);
          const expanded = detailsId === item.id;
          return <View key={item.id} style={[styles.event, !item.readAt && styles.eventUnread]}>
            <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }}
              accessibilityLabel={`${kind.title}. ${item.readAt ? "Leída" : "Sin leer"}. ${reference ?? "Prueba"}. ${notificationTimestamp(item.createdAt)}`}
              accessibilityHint={item.kind === "MOBILE_PUSH_TEST" ? "Abre la notificación de prueba" : "Abre el recurso si tu cuenta conserva acceso"}
              onPress={() => { if (canAct()) void client?.openInboxItem(item.id); }} style={({ pressed }) => [styles.eventMain, pressed && styles.pressed, busy && styles.disabled]}>
              <View style={[styles.eventIcon, { backgroundColor: kindColors.backgroundColor }]}><Ionicons name={kind.icon} size={24} color={kindColors.iconColor} accessible={false} /></View>
              <View style={styles.eventBody}>
                <View style={styles.eventTitleRow}><Text style={styles.eventTitle}>{kind.title}</Text>{!item.readAt ? <View style={styles.unreadDot} /> : null}</View>
                <Text style={styles.description}>{kind.description}</Text>
                {reference ? <Text style={styles.reference}>{reference}</Text> : null}
                {date ? <Text style={styles.caption}>Fecha del trabajo: {date}</Text> : null}
                <Text style={styles.timestamp}>{notificationTimestamp(item.createdAt)}</Text>
              </View>
            </Pressable>
            <View style={styles.eventActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Detalles de ${kind.title}`} accessibilityState={{ expanded }} aria-expanded={expanded}
                onPress={() => { if (security?.isUnlocked() ?? true) setDetailsId(expanded ? null : item.id); }} style={styles.detailsButton}>
                <Text style={styles.caption}>Detalles</Text><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={15} color={palette.textSecondary} accessible={false} />
              </Pressable>
              <View style={styles.rowActions}>
                {!item.readAt ? <IconButton name="checkmark-done-outline" label={`Marcar como leída: ${kind.title}`} disabled={busy}
                  onPress={() => { if (canAct()) void client?.markRead(item.id); }} /> : null}
                {state.canDelete === true ? <IconButton name="trash-outline" label={`Eliminar: ${kind.title}`} disabled={busy}
                  onPress={() => { if (canAct()) { setLocalError(false); setDeleteTarget(item); } }} /> : null}
              </View>
            </View>
            {expanded ? <View style={styles.details}>
              <Text style={styles.message}>{notificationDeliveryLabels[item.state]}</Text>
              <Text style={styles.caption}>Este estado no confirma que el teléfono haya mostrado el aviso ni que lo hayas leído.</Text>
              <Text selectable style={styles.caption}>Identificador: {item.id}</Text>
              <Text style={styles.caption}>Estado: {item.state} · {item.readAt ? "Leída en la app" : "Sin leer en la app"}</Text>
              {item.lastFailure ? <><Text style={styles.message}>{notificationErrorMessage(item.lastFailure)}</Text><Text selectable style={styles.caption}>Soporte: {notificationSupportCode(item.lastFailure) ?? "Sin código"}</Text></> : null}
            </View> : null}
          </View>;
        })}
      </View>}
      {state?.hasMore ? <Button title="Cargar más notificaciones" variant="secondary" loading={loading} disabled={busy} onPress={() => { void load(true); }} /> : null}
      {state && state.page > 0 && state.canDelete !== true ? <Text style={styles.caption}>Para eliminar notificaciones, el servicio necesita una actualización.</Text> : null}
    </ScrollView>
    <PrivateModal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={cancelDelete}>
      <View style={[styles.modalBackdrop, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <Card style={styles.modalCard}>
            <SectionTitle title="¿Eliminar esta notificación?" subtitle={deleteTarget ? notificationKinds[deleteTarget.kind].title : undefined} />
            <BodyText>Se quitará de tu bandeja cuando el servidor lo confirme. El trabajo y su información no se modificarán.</BodyText>
            {hasError ? <Text accessibilityRole="alert" style={styles.message}>{notificationErrorMessage(error)}</Text> : null}
            <Button title="Eliminar notificación" variant="danger" icon="trash-outline" loading={deletingId !== null} disabled={busy || state?.canDelete !== true} onPress={() => { void remove(); }} />
            <Button title="Cancelar" variant="secondary" disabled={deletingId !== null} onPress={cancelDelete} />
          </Card>
        </ScrollView>
      </View>
    </PrivateModal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background }, content: { padding: 16, gap: 18, width: "100%", maxWidth: 880, alignSelf: "center" },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 4 }, heading: { flex: 1, minWidth: 0, gap: 8 }, title: { ...typography.title, fontSize: 26, color: palette.navy },
  caption: { ...typography.caption, color: palette.textSecondary }, message: { ...typography.label, color: palette.navy }, notice: { ...typography.label, color: palette.primary, paddingHorizontal: 8 },
  filters: { flexDirection: "row", padding: 4, gap: 4, borderRadius: radius.md, backgroundColor: palette.track },
  filter: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radius.sm, padding: 10 },
  disabled: { opacity: 0.5 },
  filterSelected: { backgroundColor: palette.surface }, filterText: { ...typography.label, color: palette.textSecondary }, filterTextSelected: { color: palette.primary, fontWeight: "800" },
  stack: { gap: 12 }, feedback: { gap: 4 }, event: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
  eventUnread: { backgroundColor: "#F0F9F7", borderColor: "#CBE5E0" }, eventMain: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, minHeight: 80 },
  eventIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  eventBody: { flex: 1, minWidth: 0, gap: 6 }, eventTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, eventTitle: { fontSize: 16, lineHeight: 23, fontWeight: "700", color: palette.navy, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primary }, description: { ...typography.body, fontSize: 14, color: palette.textSecondary },
  reference: { ...typography.label, color: palette.navy }, timestamp: { ...typography.caption, color: palette.primary }, pressed: { opacity: 0.72 },
  eventActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: palette.border },
  rowActions: { flexDirection: "row", gap: 4 }, detailsButton: { minHeight: 48, minWidth: 80, flexDirection: "row", alignItems: "center", gap: 6, padding: 4 }, details: { padding: 16, gap: 8, backgroundColor: palette.surface },
  skeletonCard: { padding: 20, borderRadius: radius.lg, backgroundColor: palette.surface, flexDirection: "row", gap: 16 }, skeletonIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: palette.track },
  skeletonTitle: { height: 16, width: "65%", borderRadius: 6, backgroundColor: palette.track }, skeletonLine: { height: 12, width: "90%", borderRadius: 6, backgroundColor: palette.track }, skeletonShort: { height: 12, width: "45%", borderRadius: 6, backgroundColor: palette.track },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(18,44,58,0.55)", paddingHorizontal: 20 }, modalScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center" }, modalCard: { width: "100%", maxWidth: 480, gap: 16 },
});