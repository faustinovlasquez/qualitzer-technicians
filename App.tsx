import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useMemo, Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Image, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useTechnicianApp } from "./src/application/useTechnicianApp";
import { LoginScreen } from "./src/screens/LoginScreen";
import { TenantSelectionScreen } from "./src/screens/TenantSelectionScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { WorkDetailScreen } from "./src/screens/WorkDetailScreen";
import { OrderDetailScreen } from "./src/screens/OrderDetailScreen";
import { Notice } from "./src/screens/workDetail/DetailUi";
import { ActiveTimersBanner } from "./src/screens/notifications/ActiveTimersBanner";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ForcedPasswordScreen } from "./src/screens/ForcedPasswordScreen";
import { SessionSetupScreen } from "./src/screens/SessionSetupScreen";
import { BodyText, Brand, Button, Card, CompanyMark, EmptyState, IconButton, SectionTitle, type IconName } from "./src/ui/components";
import { activeColorScheme, palette } from "./src/ui/theme";
import { SessionContextBar } from "./src/ui/SessionContextBar";
import { BranchSwitcher } from "./src/ui/BranchSwitcher";
import { DevelopmentQrPanel } from "./src/ui/DevelopmentQrPanel";
import { CreationQuickMenu, CreationScreen } from "./src/screens/creation";
import { NotificationCenterScreen } from "./src/notifications";
import { useNotificationPermissionPrompt } from "./src/notifications/useNotificationPermissionPrompt";
import { NotificationSettingsScreen } from "./src/screens/notifications/NotificationSettingsScreen";
import { OfflineStatusBar } from "./src/screens/offline/OfflineStatusBar";
import { OfflineCenterScreen } from "./src/screens/offline/OfflineCenterScreen";
import { weekRange } from "./src/domain/format";
import { dailyRange } from "./src/domain/assignmentSchedule";
import { useCompanyBranding } from "./src/branding/useCompanyBranding";
import { companyBrandingContext } from "./src/branding/companyBrandingContext";
import { gatewayConfiguration } from "./src/infrastructure/gatewayConfig";
import { connectionPresentation, snapshotConnection } from "./src/offline/connectionPresentation";
import { DeviceSecurityProvider } from "./src/security/DeviceSecurityProvider";
import { PrivateModal as Modal, useDeviceSecurity } from "./src/security/DeviceSecurityContext";
import { useLocationTracking } from "./src/location/useLocationTracking";
import { CreationSuccess } from "./src/screens/creation/CreationSuccess";
import { CreationModal } from "./src/screens/creation/CreationModal";
import { LocationHistoryPanel } from "./src/location/LocationHistoryPanel";
import { LocationSettingsPanel } from "./src/location/LocationSettingsPanel";
import { useMaterialReceipts } from "./src/receipts/useMaterialReceipts";
import { MaterialReceiptsScreen } from "./src/receipts/MaterialReceiptsScreen";
import { pendingMaterialCount } from "./src/receipts/receiptTimeline";
import { createDemoMaterialReceiptPort } from "./src/receipts/demoReceipts";
import { flushAppErrors, installAppErrorReporting, recordAppError, setAppErrorScreen } from "./src/diagnostics/errorReporter";
import { recordNonFatal, setCrashContext, setCrashScreen } from "./src/diagnostics/nativeCrashReporter";

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { void recordAppError(error, "render"); recordNonFatal(error, "render"); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={styles.center}><EmptyState title="No se pudo mostrar esta pantalla" message="Los cambios enviados siguen guardados en Qualitzer. Vuelve a abrir la app para recuperar los borradores locales." /><Button title="Volver a intentar" onPress={() => this.setState({ failed: false })} /></View>;
  }
}
function Application({ app, allowAutomaticPin }: { app: ReturnType<typeof useTechnicianApp>; allowAutomaticPin: boolean }) {
  const locationTracking = useLocationTracking(app.session, app.gatewayUrl, app.offline, app.offlineVerifiedAt, app.locationPort, !app.restoring && !app.busy);
  useEffect(() => app.bindLocationActions(locationTracking.capture), [app.bindLocationActions, locationTracking.capture]);
  // Reporte de errores: se capturan siempre y se envían al log de Qualitzer con sesión real verificada.
  useEffect(() => { installAppErrorReporting(); }, []);
  useEffect(() => { const screen = app.selected ? "work-detail" : app.selectedOrder ? "order-detail" : app.tab; setAppErrorScreen(screen); setCrashScreen(screen); }, [app.tab, app.selected, app.selectedOrder]);
  useEffect(() => { setCrashContext({ userId: app.session?.user.id ?? null, tenant: app.session ? app.session.tenant.portalOrigin.replace(/^https?:\/\//, "") : null, branchId: app.session?.branchId ?? null }); }, [app.session?.user.id, app.session?.tenant.portalOrigin, app.session?.branchId]);
  const diagnosticsReady = app.session?.mode === "live" && app.liveVerified;
  useEffect(() => { if (diagnosticsReady) void flushAppErrors(app.diagnosticsPort); }, [diagnosticsReady, app.session?.token, app.diagnosticsPort]);
  const [locationHistoryKey, setLocationHistoryKey] = useState<string | null>(null);
  const [locationSettingsOpen, setLocationSettingsOpen] = useState(false);
  const locationViewKey = JSON.stringify([app.session?.token, app.storageKey, app.session?.branchId, app.selected?.groupId, app.selected?.workId, app.selectedOrder?.id]);
  useEffect(() => { setLocationHistoryKey(null); setLocationSettingsOpen(false); }, [locationViewKey]);
  const [notificationSettings, setNotificationSettings] = useState(false);
  // Con un detalle de Ajustes abierto, el botón atrás lo maneja ProfileScreen y vuelve al menú.
  const [profileDetail, setProfileDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const security = useDeviceSecurity();
  const locationConsentPending = Boolean(locationTracking.available && locationTracking.state && !locationTracking.state.actionConsentPrompted);
  useNotificationPermissionPrompt(app.notifications, !app.restoring && !app.busy && !security.blocked && !locationConsentPending, security.isUnlocked);
  const demoMode = app.session?.mode === "demo";
  const demoReceiptPort = useMemo(() => demoMode ? createDemoMaterialReceiptPort(app.session?.user.id ?? 0) : null, [demoMode, app.session?.token, app.session?.user.id]);
  const materialReceipts = useMaterialReceipts(demoReceiptPort ?? app.receiptPort, app.session?.user.id ?? 0, app.session?.branchId ?? 0,
    app.storageKey, app.session?.token ?? "", (demoMode || app.session?.mode === "live" && app.liveVerified) && !security.blocked && !app.busy, security.isUnlocked);
  const pendingMaterials = pendingMaterialCount(materialReceipts.data);
  const brandingContext = companyBrandingContext(app);
  const companyBranding = useCompanyBranding(brandingContext.input, app.busy || security.blocked, allowAutomaticPin && brandingContext.automaticPinEligible && !security.blocked);
  useEffect(() => { setNotificationSettings(false); }, [app.session?.token, app.session?.branchId]);
  useEffect(() => { if (app.tab !== "profile") { setNotificationSettings(false); setProfileDetail(false); } }, [app.tab]);
  useEffect(() => {
    if (!app.session || app.tab === "today" || app.selected || app.selectedOrder || app.selectedCreationKind || app.selectedOffline || notificationSettings || app.tab === "profile" && profileDetail) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Mientras se confirma una recepción no se sale de Materiales.
      if (!app.busy && !(app.tab === "materials" && materialReceipts.busy)) app.backTab();
      return true;
    });
    return () => subscription.remove();
  }, [app.session, app.tab, app.selected, app.selectedOrder, app.selectedCreationKind, app.selectedOffline, app.busy, app.backTab, notificationSettings, profileDetail, materialReceipts.busy]);

  // El botón de la barra de conexión reemplaza al recargar de la cabecera: sincroniza la cola y actualiza las asignaciones.
  async function syncAndRefresh(): Promise<void> {
    await app.syncOffline();
    if (app.tab === "today" || app.tab === "agenda") await app.refresh().catch(() => undefined);
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
  const searchable = (app.tab === "today" || app.tab === "agenda") && app.session.branchId !== null;
  const connection = app.offlineController ? connectionPresentation(app.offline) : null;
  const dotColor = app.offlineSetupError ? palette.amber : !connection ? palette.success
    : connection.tone === "success" ? palette.success : connection.tone === "error" ? palette.danger : connection.tone === "warning" ? palette.amber : palette.info;
  const dotLabel = app.offlineSetupError ? "Almacenamiento offline no disponible" : connection ? connection.title : "Conectado";
  // La barra de conexión se muestra sola cuando no hay red, falla la sincronización o quedan pendientes; tocarla abre el centro offline.
  const connectionStatusKey = app.offline ? (app.offline.authBlocked ? "auth_required" : snapshotConnection(app.offline).status) : null;
  const connectionAlert = Boolean(app.offlineSetupError) || Boolean(app.offline && (app.offline.pending > 0 || app.offline.conflicts > 0
    || ["offline", "unreachable", "auth_required", "service_error"].includes(connectionStatusKey ?? "")));
  const connectionStatus = <>{app.offlineController ? <View pointerEvents={app.busy ? "none" : "auto"} accessibilityElementsHidden={app.busy} importantForAccessibility={app.busy ? "no-hide-descendants" : "auto"}>
    <OfflineStatusBar key={`${app.storageKey}:${app.session.user.workerId}`} snapshot={app.offline} onOpen={app.openOffline} onSync={syncAndRefresh} embedded />
  </View> : app.offlineSetupError ? <Button title="Almacenamiento offline no disponible · revisar" variant="secondary" disabled={app.busy} onPress={app.openOffline} /> : null}
    {locationHistoryKey === locationViewKey ? <CreationModal title={locationSettingsOpen ? "Configurar ubicación" : "Mi historial de ubicación"} onClose={() => { setLocationHistoryKey(null); setLocationSettingsOpen(false); }}>
      {locationSettingsOpen ? <>
        <Button title="Volver al historial" icon="arrow-back-outline" variant="secondary" disabled={locationTracking.busy} onPress={() => setLocationSettingsOpen(false)} />
        <LocationSettingsPanel tracking={locationTracking} disabled={app.busy} />
      </> : <LocationHistoryPanel key={locationViewKey} tracking={locationTracking} initialDate={new Intl.DateTimeFormat("en-CA", { timeZone: locationTracking.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}
        onConfigure={() => setLocationSettingsOpen(true)} resource={app.selected ? { groupId: app.selected.groupId, workId: Number(app.selected.workId) } : app.selectedOrder ? { groupId: app.selectedOrder.id } : undefined} />}
    </CreationModal> : null}
  </>;
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
      offline={app.offlineController ? app.offline : undefined}
      onCreated={app.onCreated}
      onQueued={app.onOfflineQueuedCreate}
    />;
  }
  if (app.selected) {
    if (!app.canonicalDetailGroup || !app.canonicalDetailWork || !app.data) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Asignación no disponible" message="Puede haber cambiado de responsable, estado o período. Vuelve al listado y actualiza las asignaciones." /><Button title={app.selectedOrder ? "Volver a la orden" : "Volver a mi jornada"} disabled={app.busy} onPress={app.closeWork} /></SafeAreaView>;
    return <WorkDetailScreen
      timezone={app.session.user.system.timezone}
      equipmentLocation={app.equipmentLocation}
      workEditor={app.session.mode === "live" ? { ...app.workEditor, user: app.session.user } : undefined}
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
      onHome={app.closeDetails}
      onLocationHistory={() => setLocationHistoryKey(locationViewKey)}
      onRefresh={app.refresh}
      onStatus={app.changeStatus}
      onReopen={app.reopenWork}
      activityActions={{ load: app.loadActivities, create: app.createActivity, update: app.updateActivity, complete: app.completeActivity, remove: app.deleteActivity, files: app.loadActivityFiles, deleteFile: app.deleteActivityFile, upload: app.uploadActivityFiles }}
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
        creation={app.session.mode === "live" ? { ...app.orderCreation, user: app.session.user } : undefined}
        group={app.orderGroup}
        tenant={app.session.tenant}
        branchName={branchName}
        connectionStatus={connectionStatus}
        mode={app.session.mode}
        busy={app.busy}
        initialTab={app.selectedOrder.initialTab}
        deliveryIntent={app.selectedOrder.deliveryIntent}
        onDeliveryIntentConsumed={app.consumeOrderDeliveryIntent}
        onBack={app.closeOrder}
        onHome={app.homeFromDetails}
        onLocationHistory={() => setLocationHistoryKey(locationViewKey)}
        onOpenWork={app.openWork}
        onWorkStatus={app.onWorkStatus}
        onRefresh={app.refresh}
        onLoadFiles={app.loadGroupFiles}
        onUploadFiles={app.uploadGroupFiles}
        onDeleteFile={app.deleteGroupFile}
        technicianName={app.data?.technician.name ?? `${app.session.user.name} ${app.session.user.lastnames}`}
        signatureAccess={app.signatureAccess}
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
  const navigation: { id: "today" | "agenda" | "materials"; label: string; icon: IconName }[] = [{ id: "today", label: "Mi jornada", icon: "grid-outline" }, { id: "agenda", label: "Agenda", icon: "calendar-outline" }, { id: "materials", label: "Materiales", icon: "cube-outline" }];
  const navBusy = app.busy || materialReceipts.busy;
  const navTab = (item: (typeof navigation)[number]) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.id === "materials" && pendingMaterials > 0 ? `${item.label}, ${pendingMaterials} por confirmar` : item.label} accessibilityState={{ selected: app.tab === item.id, disabled: navBusy }} disabled={navBusy} onPress={() => app.setTab(item.id)} style={styles.navItem}>
    <View style={[styles.navIcon, app.tab === item.id && styles.navActive]}><Ionicons name={app.tab === item.id && item.id === "materials" ? "cube" : item.icon} size={20} color={app.tab === item.id ? palette.primary : palette.textSecondary} />
      {item.id === "materials" && pendingMaterials > 0 ? <View style={styles.navBadge}><Text style={styles.unreadText}>{pendingMaterials > 99 ? "99+" : pendingMaterials}</Text></View> : null}
    </View>
    <Text style={[styles.navText, app.tab === item.id && { color: palette.primary, fontWeight: "800" }]}>{item.label}</Text>
  </Pressable>;
  const canCreate = Boolean(app.session.branchId && app.session.user.workerId && app.session.user.accessBranchs.some((branch) => branch.id === app.session?.branchId && branch.isEnabled !== false && branch.isDeleted !== true));
  return <SafeAreaView style={styles.app} edges={["top", "left", "right", "bottom"]}>
    <View style={styles.top}>
      {app.tab !== "today" ? <IconButton name="arrow-back-outline" label="Volver a la vista anterior" disabled={app.busy} onPress={app.backTab} /> : null}
      <BranchSwitcher session={app.session} busy={app.busy} error={app.error} onSelect={(id) => void app.branch(id)}
        blockedReason={!app.offline ? null : !app.offline.online || app.offline.authBlocked ? "Necesitas conexión para cambiar de sucursal."
          : app.offline.pending > 0 ? "Hay cambios sin sincronizar en esta sucursal. Sincronízalos antes de cambiar; no se borrará nada." : null} />
      {searchable ? <View style={styles.headerSearch}>
        <Ionicons name="search-outline" size={18} color={palette.textMuted} />
        <TextInput accessibilityLabel="Buscar tareas" accessibilityHint="Busca por tarea, código, equipo, ubicación o cliente." placeholder="Buscar OT" placeholderTextColor={palette.textMuted}
          value={searchQuery} onChangeText={setSearchQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" selectionColor={palette.primary} style={styles.headerSearchInput} />
        {searchQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={8} onPress={() => setSearchQuery("")}><Ionicons name="close-circle" size={18} color={palette.textMuted} /></Pressable> : null}
      </View> : <View style={styles.brandSlot} />}
      <View style={styles.headerActions}>
        <Pressable testID="header-notifications" accessibilityRole="button" accessibilityLabel={unreadNotifications > 0 ? `Avisos, ${unreadNotifications} sin leer` : "Avisos"} accessibilityState={{ selected: app.tab === "notifications", disabled: app.busy }} disabled={app.busy} hitSlop={4} onPress={() => app.setTab("notifications")} style={[styles.headerToggle, app.tab === "notifications" && styles.headerToggleActive]}>
          <Ionicons name={app.tab === "notifications" ? "notifications" : "notifications-outline"} size={23} color={app.tab === "notifications" ? palette.primary : palette.textSecondary} />
          {unreadNotifications > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unreadNotifications > 99 ? "99+" : unreadNotifications}</Text></View> : null}
        </Pressable>
        <Pressable testID="header-profile" accessibilityRole="button" accessibilityLabel={`Mi perfil. Conexión: ${dotLabel}`} accessibilityState={{ selected: app.tab === "profile", disabled: app.busy }} disabled={app.busy} hitSlop={4} onPress={() => app.setTab("profile")} style={[styles.headerAvatar, app.tab === "profile" && styles.headerAvatarActive]}>
          {app.profileBadge?.avatar ? <Image key={app.profileBadge.avatar} source={{ uri: app.profileBadge.avatar }} style={styles.headerAvatarImage} resizeMode="cover" accessible={false} />
            : <Text style={styles.headerAvatarInitials}>{app.profileBadge?.initials ?? ""}</Text>}
          <View testID="connection-dot" style={[styles.connectionDot, { backgroundColor: dotColor }]} />
        </Pressable>
      </View>
    </View>
    {connectionAlert ? <SessionContextBar tenant={app.session.tenant} branchName={branchName} showBrand={false}>{connectionStatus}</SessionContextBar> : null}
    {app.session.mode === "demo" && <View style={styles.demo}><Ionicons name="flask-outline" size={14} color={palette.amber} /><Text style={styles.demoText}>DEMOSTRACIÓN · No modifica datos reales</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Salir de la demostración" hitSlop={8} disabled={app.busy} onPress={() => void app.logout()} style={styles.demoExit}>
        <Ionicons name="log-out-outline" size={14} color={palette.amber} /><Text style={styles.demoExitText}>Salir</Text>
      </Pressable>
    </View>}
    <View style={styles.body}>
      {app.noticeError ? <View style={styles.orderError}><Notice message={app.noticeError} tone="warning" onDismiss={app.dismissNoticeError} /></View> : null}
      {app.tab === "notifications" ? <>
        {app.error ? <View style={styles.orderError}><Notice message={app.error} tone="warning" /></View> : null}
        <View style={styles.body} pointerEvents={app.busy ? "none" : "auto"} accessibilityElementsHidden={app.busy} importantForAccessibility={app.busy ? "no-hide-descendants" : "auto"}>
          <NotificationCenterScreen notifications={app.notifications} onBack={app.backTab} />
        </View>
      </> : app.tab === "materials" ? <MaterialReceiptsScreen receipt={materialReceipts} /> : app.tab === "profile" ? <ProfileScreen session={app.session} profileAccess={app.profileAccess} locationTracking={locationTracking} signatureAccess={app.signatureAccess} onNotificationSettings={() => { if (security.isUnlocked() && !app.busy) setNotificationSettings(true); }} deviceSecurity={security} companyBranding={companyBranding} gatewayUrl={app.gatewayUrl} busy={app.busy} error={app.error} health={app.health} offline={app.offline} offlineVerifiedAt={app.offlineVerifiedAt} onOffline={app.openOffline} onBranch={(id) => void app.branch(id)} onLogout={() => void app.logout()} onCheck={() => void app.checkConnection()} onSectionChange={setProfileDetail} onEnableNotifications={app.notifications.client ? () => app.notifications.client!.retryEnable() : undefined} /> : app.session.branchId === null ? <EmptyState title="Sin sucursal asignada" message="Tu usuario no tiene acceso a una sucursal habilitada. Solicita que lo configuren en Qualitzer." /> : <>
        <ActiveTimersBanner timers={app.activeTimers ?? []} disabled={app.busy} onOpen={(timer) => void app.openActiveTimer(timer)} />
        <DashboardScreen hiddenTimerWorkIds={(app.activeTimers ?? []).map((timer) => String(timer.workId))} query={searchQuery} onQueryChange={setSearchQuery} pendingDates={app.agendaPendingDates} data={app.data} user={app.session.user} range={app.range} focusDate={app.agendaFocusDate} onFocusDate={app.focusAgendaDay} loading={app.loading} busy={app.busy} error={app.error} offline={app.offlineController ? app.offline : undefined} companyBranchId={app.session.branchId} onRefresh={() => void app.refresh().catch(() => undefined)} onRangeChange={app.changeRange} onOpenGroup={app.openGroup} onOpenWork={app.openWork} onWorkStatus={app.onWorkStatus} serverRemindersReady={Boolean(app.notifications.state?.registered && app.notifications.state.preferences.timers && app.notifications.state.status?.enabled && !app.notifications.state.status.reconciliationStale)} view={app.tab} />
      </>}
    </View>
    <View style={styles.nav}>
      <View style={styles.navSide}>{navigation.slice(0, 2).map(navTab)}</View>
      {canCreate ? <View style={styles.navCreate}><CreationQuickMenu inline onCreate={app.openCreate} disabled={navBusy} /></View> : null}
      <View style={styles.navSide}>{navigation.slice(2).map(navTab)}</View>
    </View>
  </SafeAreaView>;
}
function ApplicationRoot() {
  const security = useDeviceSecurity();
  const app = useTechnicianApp({ allowed: !security.blocked, isAllowed: security.isUnlocked });
  useEffect(() => () => security.controller.invalidateTrustedNativeInteraction(), [security.controller, app.storageKey, app.session?.token, app.session?.user.workerId]);
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
    {app.creationNotice && app.session && !app.busy ? <CreationSuccess {...app.creationNotice} demo={app.session.mode === "demo"} onContinue={app.dismissCreationNotice} /> : null}
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
export default function App() { return <SafeAreaProvider><StatusBar style={activeColorScheme === "dark" ? "light" : "dark"} /><DeviceSecurityProvider><AppErrorBoundary><ApplicationRoot /></AppErrorBoundary></DeviceSecurityProvider></SafeAreaProvider>; }
const styles = StyleSheet.create({
  app: { flex: 1, minHeight: 0, backgroundColor: palette.background }, body: { flex: 1, minHeight: 0, position: "relative" }, hidden: { display: "none" }, center: { flex: 1, backgroundColor: palette.background, padding: 24, justifyContent: "center", alignItems: "center", gap: 24 },
  orderError: { paddingHorizontal: 16, paddingBottom: 16 },
  offlineContext: { paddingHorizontal: 16, paddingTop: 12, gap: 6 }, offlineContextText: { color: palette.textSecondary, fontSize: 12, lineHeight: 17 },
  top: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  brandSlot: { flex: 1, minWidth: 0 },
  headerSearch: { flex: 1, minWidth: 0, height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  headerSearchInput: { flex: 1, minWidth: 0, height: 38, paddingVertical: 0, fontSize: 14, color: palette.text },
  headerToggle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerToggleActive: { backgroundColor: palette.track },
  connectionDot: { position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: palette.surface },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  headerAvatarActive: { borderWidth: 2, borderColor: palette.primary },
  headerAvatarImage: { width: "100%", height: "100%", borderRadius: 20 },
  headerAvatarInitials: { color: palette.primary, fontSize: 14, fontWeight: "800" },
  modalOverlay: { flex: 1, padding: 24, backgroundColor: "rgba(18,44,58,0.60)", justifyContent: "center" }, modalCard: { width: "100%", maxWidth: 520, alignSelf: "center" }, modalContent: { gap: 18 },
  demo: { backgroundColor: palette.amberSoft, padding: 8, justifyContent: "center", flexDirection: "row", gap: 6 }, demoText: { color: palette.amber, fontSize: 11, fontWeight: "700" },
  demoExit: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: palette.amber },
  demoExitText: { color: palette.amber, fontSize: 11, fontWeight: "800" },
  nav: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: palette.border, paddingVertical: 4, backgroundColor: palette.surface, justifyContent: "center" },
  navCreate: { width: 72, alignItems: "center", justifyContent: "center" },
  navSide: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  navBadge: { position: "absolute", top: -6, right: 4, minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, backgroundColor: palette.amber, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.surface },
  navItem: { flex: 1, maxWidth: 220, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 1 }, navIcon: { paddingHorizontal: 18, paddingVertical: 3, borderRadius: 14 }, navActive: { backgroundColor: palette.primarySoft }, navText: { fontSize: 11, color: palette.textSecondary, fontWeight: "600" },
  unreadBadge: { position: "absolute", top: 0, right: -2, minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.surface },
  unreadText: { color: palette.white, fontSize: 10, fontWeight: "800" },
});
