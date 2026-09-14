import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useTechnicianApp } from "./src/application/useTechnicianApp";
import { LoginScreen } from "./src/screens/LoginScreen";
import { TenantSelectionScreen } from "./src/screens/TenantSelectionScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { WorkDetailScreen } from "./src/screens/WorkDetailScreen";
import { OrderDetailScreen } from "./src/screens/OrderDetailScreen";
import { Notice } from "./src/screens/workDetail/DetailUi";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ForcedPasswordScreen } from "./src/screens/ForcedPasswordScreen";
import { SessionSetupScreen } from "./src/screens/SessionSetupScreen";
import { BodyText, Brand, Button, Card, EmptyState, IconButton, SectionTitle, type IconName } from "./src/ui/components";
import { palette } from "./src/ui/theme";
import { SessionContextBar } from "./src/ui/SessionContextBar";
import { DevelopmentQrPanel } from "./src/ui/DevelopmentQrPanel";
import { CreationQuickMenu, CreationScreen } from "./src/screens/creation";
import { NotificationCenterScreen } from "./src/notifications";
import { NotificationSettingsScreen } from "./src/screens/notifications/NotificationSettingsScreen";
import { OfflineStatusBar } from "./src/screens/offline/OfflineStatusBar";
import { OfflineCenterScreen } from "./src/screens/offline/OfflineCenterScreen";
import { weekRange } from "./src/domain/format";
import { dailyRange } from "./src/domain/assignmentSchedule";
import { useCompanyBranding } from "./src/branding/useCompanyBranding";
import { companyBrandingContext } from "./src/branding/companyBrandingContext";
import { gatewayConfiguration } from "./src/infrastructure/gatewayConfig";
import { DeviceSecurityProvider } from "./src/security/DeviceSecurityProvider";
import { PrivateModal as Modal, useDeviceSecurity } from "./src/security/DeviceSecurityContext";

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={styles.center}><EmptyState title="No se pudo mostrar esta pantalla" message="Los cambios enviados siguen guardados en Qualitzer. Vuelve a abrir la app para recuperar los borradores locales." /><Button title="Volver a intentar" onPress={() => this.setState({ failed: false })} /></View>;
  }
}
function Application({ app, allowAutomaticPin }: { app: ReturnType<typeof useTechnicianApp>; allowAutomaticPin: boolean }) {
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(false);
  const security = useDeviceSecurity();
  const brandingContext = companyBrandingContext(app);
  const companyBranding = useCompanyBranding(brandingContext.input, app.busy || security.blocked, allowAutomaticPin && brandingContext.automaticPinEligible && !security.blocked);
  useEffect(() => { setLogoutConfirm(false); }, [app.session?.token]);
  useEffect(() => { setNotificationSettings(false); }, [app.session?.token, app.session?.branchId]);
  useEffect(() => { if (app.tab !== "profile") setNotificationSettings(false); }, [app.tab]);
  useEffect(() => {
    if (!app.session || app.tab !== "notifications" || app.selected || app.selectedOrder || app.selectedCreationKind) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!app.busy) app.setTab("today");
      return true;
    });
    return () => subscription.remove();
  }, [app.session, app.tab, app.selected, app.selectedOrder, app.selectedCreationKind, app.busy, app.setTab]);

  function cancelLogout(): void {
    if (!app.busy) setLogoutConfirm(false);
  }

  function confirmLogout(): void {
    if (app.busy || !app.session) return;
    setLogoutConfirm(false);
    void app.logout();
  }

  function refreshAssignments(): void {
    if (app.busy || app.loading) return;
    void app.refresh().catch(() => undefined);
  }

  if (app.restoring) return <View style={styles.center}><Brand /><ActivityIndicator size="large" color={palette.primary} /><Text>Preparando tu espacio de trabajo…</Text></View>;
  if (app.finalizingSession && app.selectedTenant) return <SafeAreaView style={styles.app}><SessionSetupScreen tenant={app.selectedTenant} busy={app.busy} error={app.error} onRetry={() => void app.retrySessionSetup()} onCancel={() => void app.logout()} /></SafeAreaView>;
  if (app.forcePassword && app.selectedTenant) return <SafeAreaView style={styles.app}><ForcedPasswordScreen tenant={app.selectedTenant} busy={app.busy} error={app.error} onSave={(a, b) => void app.changePassword(a, b)} onCancel={() => void app.logout()} /></SafeAreaView>;
  if (!app.session) return <View style={styles.app}>
    <View style={[styles.body, app.challenge && styles.hidden]} accessibilityElementsHidden={app.challenge !== null} importantForAccessibility={app.challenge ? "no-hide-descendants" : "auto"}>
      <LoginScreen onLogin={app.login} onDemo={() => void app.demo()} gatewayUrl={app.gatewayUrl} suggestedGatewayUrl={app.suggestedGatewayUrl} onGatewayChange={app.setGatewayUrl} error={app.error} busy={app.busy || app.challenge !== null} />
    </View>
    {app.challenge ? <TenantSelectionScreen challenge={app.challenge} busy={app.busy} error={app.error} onSelect={(tenant) => void app.selectTenant(tenant)} onCancel={app.cancelLoginChallenge} /> : null}
  </View>;
  const branchName = app.session.user.accessBranchs.find((branch) => branch.id === app.session?.branchId)?.name ?? "Sin sucursal activa";
  if (notificationSettings && app.tab === "profile") return <SafeAreaView style={styles.app} edges={["top", "left", "right"]}>
    <NotificationSettingsScreen notifications={app.notifications} onBack={() => { if (security.isUnlocked()) setNotificationSettings(false); }} />
  </SafeAreaView>;
  const unreadNotifications = app.notifications.state?.unreadCount ?? 0;
  const connectionStatus = app.offlineController ? <View pointerEvents={app.busy ? "none" : "auto"} accessibilityElementsHidden={app.busy} importantForAccessibility={app.busy ? "no-hide-descendants" : "auto"}>
    <OfflineStatusBar key={`${app.storageKey}:${app.session.user.workerId}`} snapshot={app.offline} onOpen={app.openOffline} onSync={app.syncOffline} embedded />
  </View> : app.offlineSetupError ? <Button title="Almacenamiento offline no disponible · revisar" variant="secondary" disabled={app.busy} onPress={app.openOffline} /> : null;
  if (app.selectedCreationKind) {
    if (!app.session.branchId || !app.session.user.workerId) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Creación no disponible" message="Necesitas un trabajador y una sucursal habilitada en tu sesión." /><Button title="Volver" disabled={app.busy} onPress={app.closeCreate} /></SafeAreaView>;
    return <CreationScreen
      kind={app.selectedCreationKind}
      user={app.session.user}
      tenant={app.session.tenant}
      connectionStatus={connectionStatus}
      companyBranchId={app.session.branchId}
      initialDate={app.tab === "agenda" ? app.agendaFocusDate ?? app.range.startDate : app.range.startDate}
      data={app.data}
      mode={app.session.mode}
      busy={app.busy}
      storageKey={app.storageKey}
      onBack={app.closeCreate}
      onLoadOptions={app.creationOptions}
      onSubmit={app.createRecord}
      onCreated={app.onCreated}
      onQueued={app.onOfflineQueuedCreate}
    />;
  }
  if (app.selected) {
    if (!app.canonicalDetailGroup || !app.canonicalDetailWork || !app.data) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Asignación no disponible" message="Puede haber cambiado de responsable, estado o período. Vuelve al listado y actualiza las asignaciones." /><Button title={app.selectedOrder ? "Volver a la orden" : "Volver a mi jornada"} disabled={app.busy} onPress={app.closeWork} /></SafeAreaView>;
    return <WorkDetailScreen
      tenant={app.session.tenant}
      branchName={branchName}
      connectionStatus={connectionStatus}
      group={app.canonicalDetailGroup}
      work={app.canonicalDetailWork}
      draftIdentity={app.detailDraftIdentity}
      generatedAt={app.detailGeneratedAt}
      mode={app.session.mode}
      range={app.detailRange}
      busy={app.busy}
      error={app.error}
      initialTab={app.selected.initialTab}
      initialAction={app.selected.initialAction}
      allowEditExecutionTime={app.data.technician.allowEditExecutionTime}
      onBack={app.closeWork}
      onRefresh={app.refresh}
      onStatus={app.changeStatus}
      onSaveStep={app.saveAnswer}
      onLoadChecklistOptions={app.loadChecklistOptions}
      onAttachChecklist={app.attachChecklist}
      onLoadFiles={app.loadFiles}
      onLoadStepFiles={app.loadStepFiles}
      onUpload={app.upload}
      onUploadDocuments={app.uploadDocuments}
      onDeleteFile={app.deleteFile}
      onLoadComments={app.loadComments}
      onAddComment={app.addComment}
      onReport={app.report}
      storageKey={app.storageKey}
      offline={app.offlineController ? app.offline : undefined}
      companyBranchId={app.session.branchId ?? undefined}
      readLocalFile={app.offlineController?.readLocalFile}
    />;
  }
  if (app.selectedOrder) {
    if (!app.orderGroup) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Orden no disponible" message="Puede haber cambiado de responsable o período. Vuelve a tu jornada y actualiza las asignaciones." /><Button title="Volver a mi jornada" disabled={app.busy} onPress={app.closeOrder} /></SafeAreaView>;
    return <View style={styles.app}>
      <OrderDetailScreen
        group={app.orderGroup}
        tenant={app.session.tenant}
        branchName={branchName}
        connectionStatus={connectionStatus}
        mode={app.session.mode}
        busy={app.busy}
        initialTab={app.selectedOrder.initialTab}
        onBack={app.closeOrder}
        onOpenWork={app.openWork}
        onWorkStatus={app.onWorkStatus}
        onRefresh={app.refresh}
        onLoadFiles={app.loadGroupFiles}
        onUploadFiles={app.uploadGroupFiles}
        onDeleteFile={app.deleteGroupFile}
        technicianName={app.data?.technician.name ?? `${app.session.user.name} ${app.session.user.lastnames}`}
        onLoadDelivery={app.loadOrderDelivery}
        onStart={app.startOrder}
        onDeliver={app.deliverOrder}
        storageKey={app.storageKey}
        offline={app.offlineController ? app.offline : undefined}
        readLocalFile={app.offlineController?.readLocalFile}
        companyBranchId={app.session.branchId ?? undefined}
        range={dailyRange(app.selectedOrder.queryDate)}
        assignmentsRange={app.range}
      />
      {app.error ? <View style={styles.orderError}><Notice message={app.error} tone="warning" /></View> : null}
    </View>;
  }
  const navigation: { id: "today" | "agenda" | "notifications" | "profile"; label: string; icon: IconName }[] = [{ id: "today", label: "Mi jornada", icon: "grid-outline" }, { id: "agenda", label: "Agenda", icon: "calendar-outline" }, { id: "notifications", label: "Avisos", icon: "notifications-outline" }, { id: "profile", label: "Mi perfil", icon: "person-circle-outline" }];
  const canCreate = Boolean(app.session.branchId && app.session.user.workerId && app.session.user.accessBranchs.some((branch) => branch.id === app.session?.branchId && branch.isEnabled !== false && branch.isDeleted !== true));
  return <SafeAreaView style={styles.app} edges={["top", "left", "right", "bottom"]}>
    <View style={styles.top}>
      <Brand tenant={app.session.tenant} showTag={false} singleLine />
      <View style={styles.headerActions}>
        {app.tab === "today" || app.tab === "agenda" ? <IconButton name="refresh-outline" label="Actualizar asignaciones" disabled={app.busy || app.loading} onPress={refreshAssignments} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Ver mi perfil y sucursal" accessibilityState={{ disabled: app.busy }} disabled={app.busy} onPress={() => app.setTab("profile")} style={styles.avatar}><Text style={styles.avatarText}>{app.session.user.name[0]}</Text></Pressable>
        <IconButton name="log-out-outline" label="Cerrar sesión" disabled={app.busy} onPress={() => setLogoutConfirm(true)} />
      </View>
    </View>
    <SessionContextBar tenant={app.session.tenant} branchName={branchName} showBrand={false}>{connectionStatus}</SessionContextBar>
    {app.session.mode === "demo" && <View style={styles.demo}><Ionicons name="flask-outline" size={14} color={palette.amber} /><Text style={styles.demoText}>DEMOSTRACIÓN · No modifica datos reales</Text></View>}
    <View style={styles.body}>
      {app.tab === "notifications" ? <>
        {app.error ? <View style={styles.orderError}><Notice message={app.error} tone="warning" /></View> : null}
        <View style={styles.body} pointerEvents={app.busy ? "none" : "auto"} accessibilityElementsHidden={app.busy} importantForAccessibility={app.busy ? "no-hide-descendants" : "auto"}>
          <NotificationCenterScreen notifications={app.notifications} onBack={() => app.setTab("today")} />
        </View>
      </> : app.tab === "profile" ? <ProfileScreen session={app.session} onNotificationSettings={() => { if (security.isUnlocked() && !app.busy) setNotificationSettings(true); }} deviceSecurity={security} companyBranding={companyBranding} gatewayUrl={app.gatewayUrl} busy={app.busy} error={app.error} health={app.health} offline={app.offline} offlineVerifiedAt={app.offlineVerifiedAt} onOffline={app.openOffline} onBranch={(id) => void app.branch(id)} onLogout={() => void app.logout()} onCheck={() => void app.checkConnection()} /> : app.session.branchId === null ? <EmptyState title="Sin sucursal asignada" message="Tu usuario no tiene acceso a una sucursal habilitada. Solicita que lo configuren en Qualitzer." /> : <DashboardScreen data={app.data} user={app.session.user} range={app.range} focusDate={app.agendaFocusDate} onFocusDate={app.focusAgendaDay} loading={app.loading} busy={app.busy} error={app.error} offline={app.offlineController ? app.offline : undefined} companyBranchId={app.session.branchId} onRefresh={() => void app.refresh().catch(() => undefined)} onRangeChange={app.changeRange} onOpenGroup={app.openGroup} onOpenWork={app.openWork} onWorkStatus={app.onWorkStatus} serverRemindersReady={Boolean(app.notifications.state?.registered && app.notifications.state.preferences.timers && app.notifications.state.status?.enabled && !app.notifications.state.status.reconciliationStale)} view={app.tab} />}
      {canCreate && (app.tab === "today" || app.tab === "agenda") ? <CreationQuickMenu onCreate={app.openCreate} disabled={app.busy || logoutConfirm} /> : null}
    </View>
    <View style={styles.nav}>{navigation.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.id === "notifications" && unreadNotifications > 0 ? `${item.label}, ${unreadNotifications} sin leer` : item.label} accessibilityState={{ selected: app.tab === item.id, disabled: app.busy }} disabled={app.busy} onPress={() => app.setTab(item.id)} style={styles.navItem}>
      <View style={[styles.navIcon, app.tab === item.id && styles.navActive]}><Ionicons name={item.icon} size={22} color={app.tab === item.id ? palette.primary : palette.textSecondary} />
        {item.id === "notifications" && unreadNotifications > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unreadNotifications > 99 ? "99+" : unreadNotifications}</Text></View> : null}
      </View>
      <Text style={[styles.navText, app.tab === item.id && { color: palette.primary, fontWeight: "800" }]}>{item.label}</Text>
    </Pressable>)}</View>
    <Modal visible={logoutConfirm} transparent animationType="fade" onRequestClose={cancelLogout}>
      <View style={styles.modalOverlay}>
        <Card style={styles.modalCard}>
          <View accessibilityViewIsModal style={styles.modalContent}>
            <SectionTitle title="¿Cerrar sesión?" subtitle={app.session.tenant.name} />
            <BodyText>Si hay operaciones pendientes en el dispositivo, el cierre se bloqueará sin borrar nada. La cola y la caché offline no se eliminan al cerrar sesión.</BodyText>
            <BodyText>Solo si no hay pendientes, se eliminarán la sesión guardada y los borradores que todavía no guardaste en la cola. Lo confirmado en Qualitzer se conservará.</BodyText>
            <BodyText>Para elegir otra empresa tendrás que ingresar de nuevo. Cancelar mantiene tu empresa y sesión actuales.</BodyText>
            <Button title="Comprobar pendientes y cerrar sesión" icon="log-out-outline" variant="danger" loading={app.busy} onPress={confirmLogout} />
            <Button title="Seguir trabajando" variant="secondary" disabled={app.busy} onPress={cancelLogout} />
          </View>
        </Card>
      </View>
    </Modal>
  </SafeAreaView>;
}
function ApplicationRoot() {
  const security = useDeviceSecurity();
  const app = useTechnicianApp({ allowed: !security.blocked, isAllowed: security.isUnlocked });
  const [securityConsidered, setSecurityConsidered] = useState<string | null>(null);
  const previousBlocked = useRef(security.blocked);
  useEffect(() => {
    if (app.session?.mode === "live" && app.liveVerified && !app.busy && !app.loading && !app.restoring && !app.finalizingSession && !app.forcePassword
      && !app.selected && !app.selectedOrder && !app.selectedCreationKind && !app.selectedOffline && !security.blocked) {
      security.controller.offer();
      setSecurityConsidered(app.session.token);
    }
  }, [app.session, app.liveVerified, app.busy, app.loading, app.restoring, app.finalizingSession, app.forcePassword, app.selected, app.selectedOrder, app.selectedCreationKind, app.selectedOffline, security.blocked, security.controller]);
  useEffect(() => {
    const wasBlocked = previousBlocked.current;
    previousBlocked.current = security.blocked;
    if (wasBlocked && !security.blocked) void app.notifications.client?.refresh();
  }, [security.blocked, app.notifications.client]);
  const { width } = useWindowDimensions();
  const showDevelopmentTools = __DEV__ && !gatewayConfiguration.locked;
  const reserveQrSpace = showDevelopmentTools && Platform.OS === "web" && width >= 1100;
  const branchName = app.session?.user.accessBranchs.find((branch) => branch.id === app.session?.branchId)?.name;
  return <View style={[styles.app, reserveQrSpace && { paddingRight: 184 }]}>
    <View style={styles.body}><Application app={app} allowAutomaticPin={securityConsidered === app.session?.token} /></View>
    <Modal visible={Boolean(app.session && app.selectedOffline)} animationType="slide" onRequestClose={app.closeOffline}>
      <View style={styles.app}>
        {app.offlineController && app.session?.branchId ? <>
          <SafeAreaView edges={["top", "left", "right"]} style={styles.offlineContext}>
            <Text style={styles.offlineContextText}>{app.session.tenant.name} · {branchName}</Text>
            <Text style={styles.offlineContextText}>Perfil verificado: {app.offlineVerifiedAt ? new Date(app.offlineVerifiedAt).toLocaleString("es-CL") : "No disponible"}. Preparar guarda datos y metadatos; no descarga fotos remotas.</Text>
            {app.error ? <Notice message={app.error} tone="warning" /> : null}
          </SafeAreaView>
          <View style={styles.body}><OfflineCenterScreen key={`${app.storageKey}:${app.session.user.workerId}`} controller={app.offlineController} snapshot={app.offline} range={weekRange(app.range.startDate)} branchId={app.session.branchId} branchName={branchName} onBack={app.closeOffline} onPrepare={app.prepareOfflineWeek} /></View>
        </> : <SafeAreaView style={styles.center}>
          <EmptyState title="Sin copia offline disponible" message={app.offlineSetupError ?? "Se requiere un trabajador y una sucursal verificados para habilitar el almacenamiento local."} />
          <Button title="Volver" onPress={app.closeOffline} />
        </SafeAreaView>}
      </View>
    </Modal>
    {showDevelopmentTools && <DevelopmentQrPanel gatewayUrl={app.gatewayUrl} />}
  </View>;
}
export default function App() { return <SafeAreaProvider><StatusBar style="dark" /><DeviceSecurityProvider><AppErrorBoundary><ApplicationRoot /></AppErrorBoundary></DeviceSecurityProvider></SafeAreaProvider>; }
const styles = StyleSheet.create({
  app: { flex: 1, minHeight: 0, backgroundColor: palette.background }, body: { flex: 1, minHeight: 0, position: "relative" }, hidden: { display: "none" }, center: { flex: 1, backgroundColor: palette.background, padding: 24, justifyContent: "center", alignItems: "center", gap: 24 },
  orderError: { paddingHorizontal: 16, paddingBottom: 16 },
  offlineContext: { paddingHorizontal: 16, paddingTop: 12, gap: 6 }, offlineContextText: { color: palette.textSecondary, fontSize: 12, lineHeight: 17 },
  top: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: "white" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  modalOverlay: { flex: 1, padding: 24, backgroundColor: "rgba(18,44,58,0.60)", justifyContent: "center" }, modalCard: { width: "100%", maxWidth: 520, alignSelf: "center" }, modalContent: { gap: 18 },
  avatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" }, avatarText: { color: "white", fontWeight: "800", fontSize: 18 },
  demo: { backgroundColor: palette.amberSoft, padding: 8, justifyContent: "center", flexDirection: "row", gap: 6 }, demoText: { color: palette.amber, fontSize: 11, fontWeight: "700" },
  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: palette.border, paddingVertical: 9, backgroundColor: "white", justifyContent: "center" },
  navItem: { flex: 1, maxWidth: 220, minHeight: 58, alignItems: "center", gap: 4 }, navIcon: { paddingHorizontal: 22, paddingVertical: 6, borderRadius: 16 }, navActive: { backgroundColor: palette.primarySoft }, navText: { fontSize: 11, color: palette.textSecondary, fontWeight: "600" },
  unreadBadge: { position: "absolute", top: -3, right: 5, minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "white" },
  unreadText: { color: "white", fontSize: 10, fontWeight: "800" },
});
