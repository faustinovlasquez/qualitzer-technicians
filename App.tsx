import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useMemo, Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Image, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useTechnicianApp } from "./src/application/useTechnicianApp";
import { LoginScreen } from "./src/screens/LoginScreen";
import { SignatureSetupPrompt } from "./src/screens/signatures/SignatureSetupPrompt";
import { TenantSelectionScreen } from "./src/screens/TenantSelectionScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { WorkDetailScreen } from "./src/screens/WorkDetailScreen";
import { OrderDetailScreen } from "./src/screens/OrderDetailScreen";
import { Notice } from "./src/screens/workDetail/DetailUi";
import { ActiveTimersBanner } from "./src/screens/notifications/ActiveTimersBanner";
import { snapshotActiveTimers } from "./src/notifications/runningTimers";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ForcedPasswordScreen } from "./src/screens/ForcedPasswordScreen";
import { SessionSetupScreen } from "./src/screens/SessionSetupScreen";
import { BodyText, Brand, Button, Card, CompanyMark, EmptyState, IconButton, SectionTitle, type IconName } from "./src/ui/components";
import { activeColorScheme, palette } from "./src/ui/theme";
import { FadeIn } from "./src/ui/motion";
import { SessionContextBar } from "./src/ui/SessionContextBar";
import { BranchSwitcher } from "./src/ui/BranchSwitcher";
import { DevelopmentQrPanel } from "./src/ui/DevelopmentQrPanel";
import { CreationQuickMenu, CreationScreen } from "./src/screens/creation";
import { AppPermissionsProvider, useBranchAppPermissions } from "./src/application/appPermissions";
import { WorkTeamProvider } from "./src/screens/workTeam/WorkTeamSheet";
import { assignmentOrderId, OrderFullDetail } from "./src/screens/orders/OrderFullDetail";
import { isAppPermissionAllowed } from "./src/domain/mobileAppConfig";
import { NotificationCenterScreen } from "./src/notifications";
import { useNotificationPermissionPrompt } from "./src/notifications/useNotificationPermissionPrompt";
import { NotificationSettingsScreen } from "./src/screens/notifications/NotificationSettingsScreen";
import { OfflineStatusBar } from "./src/screens/offline/OfflineStatusBar";
import { OfflineCenterScreen } from "./src/screens/offline/OfflineCenterScreen";
import { weekRange } from "./src/domain/format";
import { dailyRange } from "./src/domain/assignmentSchedule";
import { scheduleClock } from "./src/domain/weeklySchedule";
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
import { useWorkshopBoard } from "./src/workshop/useWorkshopBoard";
import { QuickOrderCreator } from "./src/workshop/orders/QuickOrderCreator";
import { fileDrivePort } from "./src/domain/fileDrive";
import { threadPort } from "./src/domain/threads";
import { deletionPort } from "./src/domain/deletion";
import { clockOffsetMs } from "./src/offline/serverClock";
import { WorkshopScreen } from "./src/workshop/WorkshopScreen";
import { createDemoWorkshopPort } from "./src/workshop/demoWorkshop";
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
  // Con la ficha de un ingreso abierta, el botón atrás lo maneja la pestaña Taller y vuelve al tablero.
  const [workshopDetail, setWorkshopDetail] = useState(false);
  // Lo abierto en Taller (ficha del ingreso) se conserva mientras se abre la ficha normal de un trabajo y se vuelve.
  const workshopMemory = useRef<{ key: string; view: unknown } | null>(null);
  // Nueva OT desde el menú Crear; al ir a la OT creada se reabre el Taller directo en ella.
  const [quickOrder, setQuickOrder] = useState(false);
  const [workshopOpening, setWorkshopOpening] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [workshopQuery, setWorkshopQuery] = useState("");
  // Búsqueda dentro del ingreso u OT abierta en el Taller; se limpia al cambiar de pantalla.
  const [workshopView, setWorkshopView] = useState<string | null>(null);
  const [detailQuery, setDetailQuery] = useState("");
  useEffect(() => { setDetailQuery(""); }, [workshopView]);
  const [timerBannerCompact, setTimerBannerCompact] = useState(false);
  // Al tocar el buscador se agranda y el botón de recargar se oculta.
  const [searchFocused, setSearchFocused] = useState(false);
  const security = useDeviceSecurity();
  const locationConsentPending = Boolean(locationTracking.available && locationTracking.state && !locationTracking.state.actionConsentPrompted);
  useNotificationPermissionPrompt(app.notifications, !app.restoring && !app.busy && !security.blocked && !locationConsentPending, security.isUnlocked);
  const demoMode = app.session?.mode === "demo";
  const demoReceiptPort = useMemo(() => demoMode ? createDemoMaterialReceiptPort(app.session?.user.id ?? 0) : null, [demoMode, app.session?.token, app.session?.user.id]);
  const materialReceipts = useMaterialReceipts(demoReceiptPort ?? app.receiptPort, app.session?.user.id ?? 0, app.session?.branchId ?? 0,
    app.storageKey, app.session?.token ?? "", (demoMode || app.session?.mode === "live" && app.liveVerified) && !security.blocked && !app.busy, security.isUnlocked);
  const pendingMaterials = pendingMaterialCount(materialReceipts.data);
  // Taller (naves e ingresos): se carga solo con la pestaña abierta.
  const demoWorkshopPort = useMemo(() => demoMode ? createDemoWorkshopPort() : null, [demoMode, app.session?.token]);
  // Con la cámara o la galería abiertas la pantalla queda protegida, pero el taller sigue disponible: si no, el chat y
  // los archivos se cerraban por detrás y se perdía lo elegido.
  const workshop = useWorkshopBoard(demoWorkshopPort ?? app.receiptPort, app.session?.user.id ?? 0, app.session?.branchId ?? 0, app.storageKey, app.session?.token ?? "",
    app.tab === "workshop" && (demoMode || app.session?.mode === "live" && app.liveVerified) && (!security.blocked || security.nativePickerActive === true));
  // Permisos de la app configurados por la sucursal en la web (todo permitido mientras cargan o sin conexión).
  const appPermissions = useBranchAppPermissions(demoMode || !(app.session?.mode === "live" && app.liveVerified) ? null : app.receiptPort, app.session?.branchId ?? 0, app.session?.token ?? "", app.tab);
  const workshopAllowed = isAppPermissionAllowed(appPermissions, "workshop");
  useEffect(() => { if (!workshopAllowed && app.tab === "workshop") app.setTab("today"); }, [workshopAllowed, app.tab]);
  // Equipo del trabajo: con sesión real verificada, conexión y el permiso «Asignar técnicos» de la sucursal.
  const workTeamActions = app.session?.mode === "live" && app.liveVerified && isAppPermissionAllowed(appPermissions, "workTeam")
    && (!app.offline || (app.offline.online && !app.offline.authBlocked)) ? app.workTeam : null;
  const brandingContext = companyBrandingContext(app);
  const companyBranding = useCompanyBranding(brandingContext.input, app.busy || security.blocked, allowAutomaticPin && brandingContext.automaticPinEligible && !security.blocked);
  useEffect(() => { setNotificationSettings(false); }, [app.session?.token, app.session?.branchId]);
  useEffect(() => { if (app.tab !== "profile") { setNotificationSettings(false); setProfileDetail(false); } }, [app.tab]);
  // La app abre los avisos desde "Mi perfil" salvo que haya una sección abierta con posibles cambios sin guardar.
  useEffect(() => { app.setProfileEditing?.(app.tab === "profile" && (profileDetail || notificationSettings)); }, [app.tab, profileDetail, notificationSettings]);
  useEffect(() => {
    if (!app.session || app.tab === "today" || app.selected || app.selectedOrder || app.selectedCreationKind || app.selectedOffline || notificationSettings || app.tab === "profile" && profileDetail || app.tab === "workshop" && workshopDetail) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Mientras se confirma una recepción no se sale de Materiales.
      if (!app.busy && !(app.tab === "materials" && materialReceipts.busy)) app.backTab();
      return true;
    });
    return () => subscription.remove();
  }, [app.session, app.tab, app.selected, app.selectedOrder, app.selectedCreationKind, app.selectedOffline, app.busy, app.backTab, notificationSettings, profileDetail, workshopDetail, materialReceipts.busy]);

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
  const workshopSearch = app.tab === "workshop" && !workshopDetail;
  const detailSearch = app.tab === "workshop" && workshopDetail && (workshopView === "entry" || workshopView === "order") ? workshopView : null;
  const searchable = (app.tab === "today" || app.tab === "agenda" || workshopSearch || detailSearch !== null) && app.session.branchId !== null;
  const headerQuery = workshopSearch ? workshopQuery : detailSearch ? detailQuery : searchQuery;
  const setHeaderQuery = workshopSearch ? setWorkshopQuery : detailSearch ? setDetailQuery : setSearchQuery;
  const searchCopy = detailSearch === "entry" ? { label: "Buscar en el ingreso", hint: "Busca trabajos y OTs del ingreso.", placeholder: "Buscar en el ingreso" }
    : detailSearch === "order" ? { label: "Buscar en la OT", hint: "Busca en datos, trabajos, productos, transporte y otros de la OT.", placeholder: "Buscar en la OT" }
    : workshopSearch ? { label: "Buscar en el taller", hint: "Busca por ingreso, equipo, cliente o nave.", placeholder: "Buscar ingreso" }
    : { label: "Buscar tareas", hint: "Busca por tarea, código, equipo, ubicación o cliente.", placeholder: "Buscar OT" };
  const connection = app.offlineController ? connectionPresentation(app.offline) : null;
  const dotColor = app.offlineSetupError ? palette.amber : !connection ? palette.success
    : connection.tone === "success" ? palette.success : connection.tone === "error" ? palette.danger : connection.tone === "warning" ? palette.amber : palette.info;
  const dotLabel = app.offlineSetupError ? "Almacenamiento offline no disponible" : connection ? connection.title : "Conectado";
  // La barra de conexión se muestra sola cuando no hay red, falla la sincronización o quedan pendientes; tocarla abre el centro offline.
  const connectionStatusKey = app.offline ? (app.offline.authBlocked ? "auth_required" : snapshotConnection(app.offline).status) : null;
  const connectionAlert = Boolean(app.offlineSetupError) || Boolean(app.offline && (app.offline.pending > 0 || app.offline.conflicts > 0
    || ["offline", "unreachable", "auth_required", "service_error"].includes(connectionStatusKey ?? "")));
  /** Mi historial de ubicación (desde el menú de una OT o trabajo). */
  const locationHistoryModal = locationHistoryKey === locationViewKey ? <CreationModal title={locationSettingsOpen ? "Configurar ubicación" : "Mi historial de ubicación"} onClose={() => { setLocationHistoryKey(null); setLocationSettingsOpen(false); }}>
      {locationSettingsOpen ? <>
        <Button title="Volver al historial" icon="arrow-back-outline" variant="secondary" disabled={locationTracking.busy} onPress={() => setLocationSettingsOpen(false)} />
        <LocationSettingsPanel tracking={locationTracking} disabled={app.busy} />
      </> : <LocationHistoryPanel key={locationViewKey} tracking={locationTracking} initialDate={new Intl.DateTimeFormat("en-CA", { timeZone: locationTracking.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}
        onConfigure={() => setLocationSettingsOpen(true)} resource={app.selected ? { groupId: app.selected.groupId, workId: Number(app.selected.workId) } : app.selectedOrder ? { groupId: app.selectedOrder.id } : undefined} />}
    </CreationModal> : null;
  const connectionStatus = <>{app.offlineController ? <View pointerEvents={app.busy ? "none" : "auto"} accessibilityElementsHidden={app.busy} importantForAccessibility={app.busy ? "no-hide-descendants" : "auto"}>
    <OfflineStatusBar key={`${app.storageKey}:${app.session.user.workerId}`} snapshot={app.offline} onOpen={app.openOffline} onSync={syncAndRefresh} embedded />
  </View> : app.offlineSetupError ? <Button title="Almacenamiento offline no disponible · revisar" variant="secondary" disabled={app.busy} onPress={app.openOffline} /> : null}
    {locationHistoryModal}
  </>;
  if (app.selectedCreationKind) {
    if (!app.session.branchId || !app.session.user.workerId) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Creación no disponible" message="Necesitas un trabajador y una sucursal habilitada en tu sesión." /><Button title="Volver" disabled={app.busy} onPress={app.closeCreate} /></SafeAreaView>;
    return <FadeIn key="creation" style={styles.app}><CreationScreen
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
    /></FadeIn>;
  }
  // «Entregar» desde la tarjeta abre solo la ventana de entrega sobre la lista, sin ir al detalle.
  const deliveryFromCard = app.selected?.initialAction === "deliver" && !app.selectedOrder && Boolean(app.canonicalDetailGroup && app.canonicalDetailWork && app.data);
  const workDetail = (deliveryOnly: boolean) => app.session && app.selected && app.canonicalDetailGroup && app.canonicalDetailWork && app.data ? <WorkDetailScreen
      deliveryOnly={deliveryOnly}
      drivePort={app.session.mode === "live" ? fileDrivePort(app.receiptPort) : null}
      threadPort={app.session.mode === "live" ? threadPort(app.receiptPort) : null}
      deletionPort={app.session.mode === "live" && app.liveVerified ? deletionPort(app.receiptPort) : null}
      onDeleted={() => { app.closeWork(); void app.refresh().catch(() => undefined); }}
      onDiscardOperation={app.offlineController?.discard ? (id: string) => app.offlineController!.discard!(id) : undefined}
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
      showWorkTimer={app.data.technician.showWorkTimer !== false}
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
    /> : null;
  if (app.selected && !deliveryFromCard) {
    if (!app.canonicalDetailGroup || !app.canonicalDetailWork || !app.data) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Asignación no disponible" message="Puede haber cambiado de responsable, estado o período. Vuelve al listado y actualiza las asignaciones." /><Button title={app.selectedOrder ? "Volver a la orden" : "Volver a mi jornada"} disabled={app.busy} onPress={app.closeWork} /></SafeAreaView>;
    return <WorkTeamProvider value={workTeamActions}><FadeIn key={`work:${app.canonicalDetailGroup.id}:${app.canonicalDetailWork.id}`} style={styles.app}>{workDetail(false)}
      {app.noticeError ? <View style={styles.orderError}><Notice message={app.noticeError} tone="warning" onDismiss={app.dismissNoticeError} /></View> : null}
    </FadeIn></WorkTeamProvider>;
  }
  if (app.selectedOrder) {
    if (!app.orderGroup) return <SafeAreaView style={styles.center}>{connectionStatus}<EmptyState title="Orden no disponible" message="Puede haber cambiado de responsable o período. Vuelve a tu jornada y actualiza las asignaciones." /><Button title="Volver a mi jornada" disabled={app.busy} onPress={app.closeOrder} /></SafeAreaView>;
    // OT con conexión: el mismo detalle completo del Taller (datos, secciones y archivos). Sin conexión o en demostración, la vista de siempre.
    const fullOrderId = assignmentOrderId(app.orderGroup);
    const fullOrderOnline = !app.offline || (app.offline.online && !app.offline.authBlocked);
    if (fullOrderId !== null && app.session.mode === "live" && app.liveVerified && workshopAllowed && fullOrderOnline && app.session.branchId && app.selectedOrder.deliveryIntent === undefined) {
      return <WorkTeamProvider value={workTeamActions}><FadeIn key={`order-full:${app.orderGroup.id}`} style={styles.app}>
        <OrderFullDetail group={app.orderGroup} orderId={fullOrderId} port={app.receiptPort ?? {}} branchId={app.session.branchId} mode={app.session.mode} storageKey={app.storageKey}
          permissions={appPermissions} tenant={app.session.tenant} branchName={branchName} connectionStatus={connectionStatus} range={app.range} generatedAt={app.data?.generatedAt}
          workerId={app.session.user.workerId} offline={app.offlineController ? app.offline : undefined} busy={app.busy} initialTab={app.selectedOrder.initialTab}
          onBack={() => { app.closeOrder(); void app.refresh().catch(() => undefined); }} onOpenWork={app.openWork} onWorkStatus={app.onWorkStatus}
          deletionPort={deletionPort(app.receiptPort)} onDeleted={() => { app.closeOrder(); void app.refresh().catch(() => undefined); }}
          onLocationHistory={() => setLocationHistoryKey(locationViewKey)} />
        {app.noticeError ? <View style={styles.orderError}><Notice message={app.noticeError} tone="warning" onDismiss={app.dismissNoticeError} /></View> : null}
      </FadeIn></WorkTeamProvider>;
    }
    return <WorkTeamProvider value={workTeamActions}><FadeIn key={`order:${app.orderGroup.id}`} style={styles.app}>
      <OrderDetailScreen
        drivePort={app.session.mode === "live" ? fileDrivePort(app.receiptPort) : null}
        deletionPort={app.session.mode === "live" && app.liveVerified ? deletionPort(app.receiptPort) : null}
        onDeleted={() => { app.closeOrder(); void app.refresh().catch(() => undefined); }}
        creation={app.session.mode === "live" ? { ...app.orderCreation, user: app.session.user } : undefined}
        group={app.orderGroup}
        tenant={app.session.tenant}
        branchName={branchName}
        connectionStatus={connectionStatus}
        mode={app.session.mode}
        busy={app.busy}
        initialTab={app.selectedOrder.initialTab === "comments" ? "works" : app.selectedOrder.initialTab}
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
      {app.noticeError ? <View style={styles.orderError}><Notice message={app.noticeError} tone="warning" onDismiss={app.dismissNoticeError} /></View> : null}
    </FadeIn></WorkTeamProvider>;
  }
  const navigation: { id: "today" | "agenda" | "materials" | "workshop"; label: string; icon: IconName }[] = [{ id: "today", label: "Mi jornada", icon: "grid-outline" }, { id: "agenda", label: "Agenda", icon: "calendar-outline" }, { id: "materials", label: "Materiales", icon: "cube-outline" }, { id: "workshop", label: "Taller", icon: "construct-outline" }];
  const visibleNavigation = navigation.filter((item) => item.id !== "workshop" || workshopAllowed);
  const creatable = ([["work", "createWorks"], ["maintenance", "createMaintenances"], ["non_productive", "createNonProductive"]] as const)
    .filter(([, key]) => appPermissions[key]).map(([kind]) => kind);
  const navBusy = app.busy || materialReceipts.busy;
  const canCreateOrder = app.session.mode === "live" && workshopAllowed && appPermissions.ordersCreate;
  const navTab = (item: (typeof navigation)[number]) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.id === "materials" && pendingMaterials > 0 ? `${item.label}, ${pendingMaterials} por confirmar` : item.label} accessibilityState={{ selected: app.tab === item.id, disabled: navBusy }} disabled={navBusy} onPress={() => app.setTab(item.id)} style={styles.navItem}>
    <View style={[styles.navIcon, app.tab === item.id && styles.navActive]}><Ionicons name={app.tab === item.id && item.id === "materials" ? "cube" : app.tab === item.id && item.id === "workshop" ? "construct" : item.icon} size={20} color={app.tab === item.id ? palette.primary : palette.textSecondary} />
      {item.id === "materials" && pendingMaterials > 0 ? <View style={styles.navBadge}><Text style={styles.unreadText}>{pendingMaterials > 99 ? "99+" : pendingMaterials}</Text></View> : null}
    </View>
    <Text style={[styles.navText, app.tab === item.id && { color: palette.primary, fontWeight: "800" }]}>{item.label}</Text>
  </Pressable>;
  const canCreate = Boolean(app.session.branchId && app.session.user.workerId && app.session.user.accessBranchs.some((branch) => branch.id === app.session?.branchId && branch.isEnabled !== false && branch.isDeleted !== true));
  return <AppPermissionsProvider value={appPermissions}><WorkTeamProvider value={workTeamActions}><SafeAreaView style={styles.app} edges={["top", "left", "right", "bottom"]}>
    <View style={styles.top}>
      {app.tab !== "today" && !(app.tab === "workshop" && workshopDetail) ? <IconButton name="arrow-back-outline" label="Volver a la vista anterior" disabled={app.busy} onPress={app.backTab} /> : null}
      <BranchSwitcher session={app.session} busy={app.busy} error={app.error} onSelect={(id) => void app.branch(id)}
        blockedReason={!app.offline ? null : !app.offline.online || app.offline.authBlocked ? "Necesitas conexión para cambiar de sucursal."
          : app.offline.pending > 0 ? "Hay cambios sin sincronizar en esta sucursal. Sincronízalos antes de cambiar; no se borrará nada." : null} />
      {searchable ? <View style={styles.headerSearch}>
        <Ionicons name="search-outline" size={18} color={palette.textMuted} />
        <TextInput accessibilityLabel={searchCopy.label} accessibilityHint={searchCopy.hint} placeholder={searchCopy.placeholder} placeholderTextColor={palette.textMuted}
          value={headerQuery} onChangeText={setHeaderQuery} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} autoCapitalize="none" autoCorrect={false} returnKeyType="search" selectionColor={palette.primary} style={styles.headerSearchInput} />
        {headerQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={8} onPress={() => setHeaderQuery("")}><Ionicons name="close-circle" size={18} color={palette.textMuted} /></Pressable> : null}
      </View> : <View style={styles.brandSlot} />}
      <View style={styles.headerActions}>
        {searchable && !workshopSearch && !detailSearch && !searchFocused && !searchQuery ? <Pressable testID="header-refresh" accessibilityRole="button" accessibilityLabel="Recargar mi jornada" accessibilityState={{ disabled: app.busy || app.loading, busy: app.loading }} disabled={app.busy || app.loading} hitSlop={4} onPress={() => void app.refresh().catch(() => undefined)} style={[styles.headerToggle, app.loading && styles.headerToggleBusy]}>
          <Ionicons name="sync-outline" size={22} color={palette.textSecondary} />
        </Pressable> : null}
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
    {connectionAlert ? <SessionContextBar tenant={app.session.tenant} branchName={branchName} showBrand={false}>{connectionStatus}</SessionContextBar> : locationHistoryModal}
    {app.session.mode === "demo" && <View style={styles.demo}><Ionicons name="flask-outline" size={14} color={palette.amber} /><Text style={styles.demoText}>DEMOSTRACIÓN · No modifica datos reales</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Salir de la demostración" hitSlop={8} disabled={app.busy} onPress={() => void app.logout()} style={styles.demoExit}>
        <Ionicons name="log-out-outline" size={14} color={palette.amber} /><Text style={styles.demoExitText}>Salir</Text>
      </Pressable>
    </View>}
    <FadeIn key={app.tab === "agenda" ? "today" : app.tab} style={styles.body}>
      {app.noticeError ? <View style={styles.orderError}><Notice message={app.noticeError} tone="warning" onDismiss={app.dismissNoticeError} /></View> : null}
      {app.tab === "notifications" ? <>
        {app.error ? <View style={styles.orderError}><Notice message={app.error} tone="warning" /></View> : null}
        <View style={styles.body} pointerEvents={app.busy ? "none" : "auto"} accessibilityElementsHidden={app.busy} importantForAccessibility={app.busy ? "no-hide-descendants" : "auto"}>
          <NotificationCenterScreen notifications={app.notifications} onBack={app.backTab} />
        </View>
      </> : app.tab === "materials" ? <MaterialReceiptsScreen receipt={materialReceipts} focus={app.materialReceiptFocus} /> : app.tab === "workshop" ? <WorkshopScreen key={`${app.storageKey}:${app.session.branchId ?? 0}:${workshopOpening}`} memoryKey={`${app.storageKey}:${app.session.branchId ?? 0}`} memory={workshopMemory}
            workshop={workshop} onSectionChange={setWorkshopDetail} onOpenWork={app.openWorkshopWork} query={workshopQuery} mode={app.session.mode} detailQuery={detailQuery} onViewChange={setWorkshopView}
            onLocationHistory={() => setLocationHistoryKey(locationViewKey)}
            assignments={{ data: app.data, range: app.range, openWork: app.openWork, refresh: () => { void app.refresh().catch(() => undefined); }, onWorkStatus: app.onWorkStatus, busy: app.busy, workerId: app.session.user.workerId,
              companyBranchId: app.session.branchId, offline: app.offlineController ? app.offline : undefined, loadWide: app.workshopAssignments, wideStatus: app.workshopWorkStatus }}
            creation={app.session.branchId && app.session.user.workerId ? { ...app.workshopCreation, user: app.session.user, tenant: app.session.tenant, companyBranchId: app.session.branchId,
              initialDate: scheduleClock(app.session.user.system.timezone)?.day ?? app.range.startDate, mode: app.session.mode, storageKey: app.storageKey, offline: app.offlineController ? app.offline : undefined, busy: app.busy } : undefined} /> : app.tab === "profile" ? <>{app.noticeError ? <View style={styles.orderError}><Notice message={app.noticeError} tone="warning" onDismiss={app.dismissNoticeError} /></View> : null}<ProfileScreen session={app.session} profileAccess={app.profileAccess} locationTracking={locationTracking} signatureAccess={app.signatureAccess} onNotificationSettings={() => { if (security.isUnlocked() && !app.busy) setNotificationSettings(true); }} deviceSecurity={security} companyBranding={companyBranding} gatewayUrl={app.gatewayUrl} busy={app.busy} error={app.error} health={app.health} offline={app.offline} offlineVerifiedAt={app.offlineVerifiedAt} onOffline={app.openOffline} onBranch={(id) => void app.branch(id)} onLogout={() => void app.logout()} onCheck={() => void app.checkConnection()} onSectionChange={setProfileDetail} onEnableNotifications={app.notifications.client ? () => app.notifications.client!.retryEnable() : undefined} /></> : app.session.branchId === null ? <EmptyState title="Sin sucursal asignada" message="Tu usuario no tiene acceso a una sucursal habilitada. Solicita que lo configuren en Qualitzer." /> : <>
        <ActiveTimersBanner timers={app.activeTimers ?? []} disabled={app.busy} compact={timerBannerCompact} onOpen={(timer) => app.openActiveTimer(timer)}
          onPause={(timer) => app.pauseActiveTimer(timer)} onPauseLocal={(timer) => app.pauseLoadedWork(timer.groupId, timer.workId)}
          localTimers={snapshotActiveTimers(app.data, new Set((app.activeTimers ?? []).map((timer) => String(timer.workId))), Date.now())}
          onOpenLocal={(timer) => {
            const group = app.data?.groups.find((item) => item.id === timer.groupId);
            const work = group?.works.find((item) => item.id === timer.workId);
            if (group && work) app.openWork(group, work);
          }} />
        <DashboardScreen query={searchQuery} onQueryChange={setSearchQuery} pendingDates={app.agendaPendingDates} data={app.data} user={app.session.user} range={app.range} focusDate={app.agendaFocusDate} onFocusDate={app.focusAgendaDay} loading={app.loading} busy={app.busy} error={app.error} offline={app.offlineController ? app.offline : undefined} companyBranchId={app.session.branchId} onRefresh={() => void app.refresh().catch(() => undefined)} onRangeChange={app.changeRange} onOpenGroup={app.openGroup} onOpenWork={app.openWork} onWorkStatus={app.onWorkStatus} view={app.tab} onScrolledChange={setTimerBannerCompact}
          drivePort={app.session.mode === "live" && app.liveVerified ? fileDrivePort(app.receiptPort) : null} threadPort={app.session.mode === "live" && app.liveVerified ? threadPort(app.receiptPort) : null} />
      </>}
    </FadeIn>
    {/* Dentro del Taller (ingreso, OT, inspección…) se oculta el menú inferior: se vuelve con la flecha de cada pantalla. */}
    {app.tab === "workshop" && workshopDetail ? null : <View style={styles.nav}>
      <View style={styles.navSide}>{visibleNavigation.slice(0, 2).map(navTab)}</View>
      {canCreate && (creatable.length > 0 || canCreateOrder) ? <View style={styles.navCreate}><CreationQuickMenu inline onCreate={app.openCreate} disabled={navBusy} allowed={creatable}
        onCreateOrder={canCreateOrder ? () => setQuickOrder(true) : undefined} /></View> : null}
      <View style={styles.navSide}>{visibleNavigation.slice(2).map(navTab)}</View>
    </View>}
    {quickOrder ? <QuickOrderCreator workshop={workshop} onClose={() => setQuickOrder(false)} onOpenOrder={(picked, orderId) => {
      workshopMemory.current = { key: `${app.storageKey}:${app.session?.branchId ?? 0}`, view: { kind: "order", ref: picked, orderId, entryCode: picked.entry.code } };
      setQuickOrder(false); setWorkshopOpening((value) => value + 1); app.setTab("workshop");
    }} /> : null}
    {deliveryFromCard ? workDetail(true) : null}
  </SafeAreaView></WorkTeamProvider></AppPermissionsProvider>;
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
    {app.notificationOpening ? <View style={styles.openingOverlay} pointerEvents="auto" accessibilityViewIsModal accessibilityLiveRegion="polite">
      <FadeIn style={styles.openingCard}>
        <ActivityIndicator size="large" color={palette.primary} />
        <Text style={styles.openingTitle}>Abriendo aviso…</Text>
        <Text style={styles.openingText}>Cargando la información para llevarte a su destino.</Text>
      </FadeIn>
    </View> : null}
    {app.creationNotice && app.session && !app.busy ? <CreationSuccess {...app.creationNotice} demo={app.session.mode === "demo"} onContinue={app.dismissCreationNotice} /> : null}
    {app.session ? <SignatureSetupPrompt access={app.signatureAccess} firstName={app.session.user.name.trim().split(/\s+/)[0] ?? ""}
      enabled={app.session.mode === "live" && Boolean(app.liveVerified) && !app.busy && !app.loading && !app.restoring && !app.finalizingSession && !app.forcePassword
        && !app.selected && !app.selectedOrder && !app.selectedCreationKind && !app.selectedOffline && !app.notificationOpening && !security.blocked} /> : null}
    <Modal visible={Boolean(app.session && app.selectedOffline)} animationType="slide" onRequestClose={app.closeOffline}>
      <View style={styles.app}>
        {app.offlineController && app.session?.branchId ? <>
          <SafeAreaView edges={["top", "left", "right"]} style={styles.offlineContext}>
            <Text style={styles.offlineContextText}>{app.session.tenant.name} · {branchName}</Text>
            <Text style={styles.offlineContextText}>Perfil verificado: {app.offlineVerifiedAt ? new Date(app.offlineVerifiedAt).toLocaleString("es-CL") : "No disponible"}. Preparar guarda datos y metadatos; no descarga fotos remotas.</Text>
            {app.error ? <Notice message={app.error} tone="warning" /> : null}
          </SafeAreaView>
          <View style={styles.body}><OfflineCenterScreen key={`${app.storageKey}:${app.session.user.workerId}`} controller={app.offlineController} snapshot={app.offline} range={weekRange(app.range.startDate)} branchId={app.session.branchId} branchName={branchName} onBack={app.closeOffline} onPrepare={app.prepareOfflineWeek} clockOffsetMs={clockOffsetMs()} /></View>
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
  openingOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, elevation: 50, backgroundColor: "rgba(15, 31, 46, 0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  openingCard: { minWidth: 240, maxWidth: 320, alignItems: "center", gap: 10, paddingVertical: 24, paddingHorizontal: 22, borderRadius: 20, backgroundColor: palette.surface },
  openingTitle: { fontSize: 17, fontWeight: "800", color: palette.heading, textAlign: "center" },
  openingText: { fontSize: 14, color: palette.textSecondary, textAlign: "center" },
  app: { flex: 1, minHeight: 0, backgroundColor: palette.background }, body: { flex: 1, minHeight: 0, position: "relative" }, hidden: { display: "none" }, center: { flex: 1, backgroundColor: palette.background, padding: 24, justifyContent: "center", alignItems: "center", gap: 24 },
  orderError: { paddingHorizontal: 16, paddingBottom: 16 },
  offlineContext: { paddingHorizontal: 16, paddingTop: 12, gap: 6 }, offlineContextText: { color: palette.textSecondary, fontSize: 12, lineHeight: 17 },
  top: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  brandSlot: { flex: 1, minWidth: 0 },
  headerSearch: { flex: 1, minWidth: 0, height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  headerToggleBusy: { opacity: 0.45 },
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
