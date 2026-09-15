import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { assignmentWorkOrderCode } from "../domain/assignmentCodes";
import { assignmentWorkQueryRange } from "../domain/assignmentSchedule";
import { plainText } from "../domain/format";
import type { AssignmentGroup, AssignmentWork, Attachment, DateRange, LocalPhoto, StatusInput, Tenant, WorkOpenOptions } from "../domain/models";
import type { OfflineController, OfflineSnapshot } from "../domain/offline";
import { Badge, Card, EmptyState, IconButton, SectionTitle, type IconName } from "../ui/components";
import { SessionContextBar } from "../ui/SessionContextBar";
import { palette, radius, theme, typography } from "../ui/theme";
import { AssignmentOrderSummary } from "./orders/AssignmentOrderCard";
import { AssignmentWorkCard } from "./orders/AssignmentWorkCard";
import { OrderMaterialsTab } from "./orders/OrderMaterialsTab";
import { Notice } from "./workDetail/DetailUi";
import { DeliverySuccess } from "./workDetail/DeliverySuccess";
import { errorMessage } from "./workDetail/detailRules";
import { FileWorkspace } from "./workDetail/FileWorkspace";
import { OrderLifecyclePanel } from "./orders/OrderLifecyclePanel";
import { OfflineOrderLifecyclePanel } from "./offline/OfflineOrderLifecyclePanel";
import { offlineAttachment, operationsForWork, type PendingDocument } from "./offline/offlineUi";
import type { MaintenanceDeliveryContext, MaintenanceDeliveryInput } from "../domain/orderLifecycle";

export interface OrderDetailScreenProps {
  group: AssignmentGroup;
  tenant: Tenant;
  branchName: string;
  connectionStatus?: ReactNode;
  mode: "live" | "demo";
  busy: boolean;
  initialTab?: "works" | "files";
  onBack: () => void;
  onOpenWork: (group: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions) => void;
  onWorkStatus: (group: AssignmentGroup, work: AssignmentWork, input: StatusInput) => Promise<void>;
  onRefresh: () => Promise<void>;
  onLoadFiles: () => Promise<Attachment[]>;
  onUploadFiles: (files: LocalPhoto[]) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
  technicianName: string;
  onLoadDelivery: () => Promise<MaintenanceDeliveryContext>;
  onStart: () => Promise<void>;
  onDeliver: (input: MaintenanceDeliveryInput) => Promise<void>;
  storageKey: string;
  offline?: OfflineSnapshot | null;
  range?: DateRange;
  assignmentsRange?: DateRange;
  companyBranchId?: number;
  readLocalFile?: OfflineController["readLocalFile"];
  staleReadOnly?: boolean;
}

type OrderTab = "works" | "materials" | "files";
type OrderAction = "refresh" | "timer" | "status" | "upload" | "delete" | "start" | "deliver";
const tabs: { id: OrderTab; label: string; icon: IconName }[] = [
  { id: "works", label: "Trabajos", icon: "construct-outline" },
  { id: "materials", label: "Repuestos", icon: "cube-outline" },
  { id: "files", label: "Archivos", icon: "folder-open-outline" },
];

export function OrderDetailScreen(props: OrderDetailScreenProps) {
  const identity = JSON.stringify([props.storageKey, props.mode, props.tenant.id, props.tenant.portalOrigin, props.tenant.environment, props.branchName, props.group.type, props.group.id]);
  return <OrderDetailContent key={identity} {...props} />;
}

function OrderDetailContent(props: OrderDetailScreenProps) {
  const { group, tenant, branchName, mode, busy, initialTab = "works", onBack, onOpenWork, onWorkStatus, onRefresh } = props;
  const [tab, setTab] = useState<OrderTab>(initialTab);
  const history = useRef<OrderTab[]>(initialTab === "works" ? [] : ["works"]);
  const childBack = useRef<((home?: boolean) => boolean) | null>(null);
  const [deliverySucceeded, setDeliverySucceeded] = useState(false);
  const [filesVisited, setFilesVisited] = useState(initialTab === "files");
  const [action, setAction] = useState<OrderAction | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const actionRef = useRef<OrderAction | null>(null);
  const busyRef = useRef(busy);
  const mounted = useRef(true);
  const leaving = useRef(false);
  const scroll = useRef<ScrollView>(null);
  busyRef.current = busy;
  const locked = busy || action !== null;
  const online = props.offline === undefined || (props.offline !== null && props.offline.online && !props.offline.authBlocked);
  const localGroup = group.id.startsWith("local-");
  const assignmentsRange = props.assignmentsRange ?? props.range;
  const executionAvailable = online && !localGroup && !props.staleReadOnly;
  const timerAvailable = (online || (props.offline !== undefined && props.offline !== null && !props.offline.authBlocked)) && !localGroup && !props.staleReadOnly;
  const scopedOperations = props.range && props.companyBranchId !== undefined ? operationsForWork(props.offline, { groupId: group.id, ...props.range, companyBranchId: props.companyBranchId }) : [];
  const documents = scopedOperations.filter((operation): operation is PendingDocument => operation.kind === "document" && operation.stepId === undefined);
  const pendingDocuments = documents.filter((operation) => operation.status !== "applied");
  const latest = useRef(props);
  latest.current = props;
  const workOrderCode = assignmentWorkOrderCode(group);
  const direct = group.type === "direct_assignment";
  const filesScope = JSON.stringify(["order-files", props.storageKey, mode, tenant.id, tenant.portalOrigin, tenant.environment, branchName, group.type, group.id]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setTab(initialTab);
    history.current = initialTab === "works" ? [] : ["works"];
    if (initialTab === "files") setFilesVisited(true);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [initialTab]);

  async function runOperation(name: OrderAction, operation: () => Promise<void>): Promise<void> {
    if (actionRef.current !== null || busyRef.current || leaving.current) throw new Error("Hay una operación en curso. Espera a que termine antes de continuar.");
    if (name === "timer" && !timerAvailable) throw new Error("Espera a recuperar una ficha verificada y la cola local antes de cambiar el cronómetro.");
    if ((name === "status" || name === "start" || name === "deliver" || name === "delete") && !executionAvailable) throw new Error("Esta acción requiere conexión y una ficha confirmada y actualizada. No se encola offline.");
    actionRef.current = name;
    setAction(name);
    setOperationError(null);
    try { await operation(); if (name === "deliver" && mounted.current) setDeliverySucceeded(true); }
    finally {
      actionRef.current = null;
      if (mounted.current) setAction(null);
    }
  }

  function refresh(): void {
    if (actionRef.current !== null || busyRef.current || leaving.current) return;
    void runOperation("refresh", onRefresh).catch((error: unknown) => {
      if (mounted.current) setOperationError(`No se pudo actualizar la orden. ${errorMessage(error)}`);
    });
  }

  function goBack(): void {
    if (actionRef.current !== null || busyRef.current || leaving.current) return;
    if (childBack.current?.()) return;
    const previous = history.current.pop();
    if (previous) { setTab(previous); scroll.current?.scrollTo({ y: 0, animated: false }); return; }
    if (tab !== "works") { setTab("works"); return; }
    leaveDetails();
  }
  function leaveDetails(): void {
    if (actionRef.current !== null || busyRef.current || leaving.current || childBack.current?.(true)) return;
    leaving.current = true;
    try { onBack(); }
    catch (error) {
      leaving.current = false;
      setOperationError(errorMessage(error));
    }
  }
  const back = useRef(goBack);
  back.current = goBack;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back.current(); return true; });
    return () => subscription.remove();
  }, []);

  function selectTab(next: OrderTab): void {
    if (actionRef.current !== null || busyRef.current || leaving.current || childBack.current?.(true) || next === tab) return;
    history.current.push(tab);
    setTab(next);
    if (next === "files") setFilesVisited(true);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  function openWork(selectedGroup: AssignmentGroup, work: AssignmentWork, options?: WorkOpenOptions): void {
    if (actionRef.current !== null || busyRef.current || leaving.current) return;
    if (options?.action && (!mounted.current || latest.current.offline === null || latest.current.offline?.authBlocked || latest.current.offline?.connection?.foreground === false)) return;
    onOpenWork(selectedGroup, work, options);
  }

  const lifecycleProps = {
    group, tenant, technicianName: props.technicianName, storageKey: props.storageKey, mode, busy: locked,
    onLoad: props.onLoadDelivery,
    onStart: () => runOperation("start", props.onStart),
    onDeliver: (input: MaintenanceDeliveryInput) => runOperation("deliver", () => props.onDeliver(input)),
  };

  return <SafeAreaView style={styles.safe}>
    {deliverySucceeded ? <DeliverySuccess title="Mantenimiento entregado" name={plainText(group.title)} demo={mode === "demo"} onClose={() => setDeliverySucceeded(false)} onBack={goBack} /> : null}
    <SessionContextBar tenant={tenant} branchName={branchName}>{props.connectionStatus}</SessionContextBar>
    <View style={styles.header}>
      <IconButton name="arrow-back-outline" label="Volver al paso anterior" disabled={locked} onPress={goBack} />
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle}>{direct ? "Detalle de asignación" : group.type === "internal_maintenance" ? "Mantenimiento" : "Detalle de OT"}</Text>
        <View style={styles.codes}>
          {localGroup ? <Badge label="Pendiente de sincronizar" tone="warning" /> : null}
          {localGroup && group.code.trim() ? <Badge label={plainText(group.code)} /> : null}
          {workOrderCode ? <Badge label={workOrderCode} tone="teal" /> : null}
          <Text numberOfLines={1} style={styles.headerSubtitle}>{plainText(group.title)}</Text>
        </View>
      </View>
      <IconButton name="home-outline" label="Ir al inicio de la orden" disabled={locked} onPress={() => { if (actionRef.current !== null || busyRef.current || childBack.current?.(true)) return; history.current = []; setTab("works"); scroll.current?.scrollTo({ y: 0, animated: false }); }} />
      <IconButton name="list-outline" label="Volver a mis asignaciones" disabled={locked} onPress={leaveDetails} />
      <IconButton name="refresh-outline" label="Actualizar orden y trabajos" disabled={locked} onPress={refresh} />
    </View>
    <View style={styles.tabsContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Secciones de la orden">
        {tabs.filter(item => item.id !== "materials" || group.products.length > 0).map((item) => <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityLabel={`${item.label}${item.id === "works" ? `, ${group.works.length}` : item.id === "materials" ? `, ${group.products.length}` : ""}`}
          accessibilityState={{ selected: tab === item.id, disabled: locked }}
          disabled={locked}
          onPress={() => selectTab(item.id)}
          style={({ pressed }) => [styles.tab, tab === item.id && styles.tabSelected, pressed && styles.pressed]}
        >
          <Ionicons name={item.icon} size={18} color={tab === item.id ? palette.white : palette.textSecondary} accessible={false} />
          <Text style={[styles.tabText, tab === item.id && styles.tabTextSelected]}>{item.label}{item.id === "works" ? ` (${group.works.length})` : item.id === "materials" ? ` (${group.products.length})` : ""}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <ScrollView
      ref={scroll}
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={action === "refresh"} onRefresh={refresh} enabled={!locked} tintColor={palette.primary} colors={[palette.primary]} />}
    >
      {mode === "demo" ? <Notice message="Modo demostración · los cambios son locales y no modifican datos reales." /> : null}
      {operationError ? <Notice message={operationError} tone="error" onDismiss={() => setOperationError(null)} /> : null}
      {!online ? <Notice message={props.offline === null ? "Recuperando la cola local. Espera antes de guardar cambios." : props.offline?.authBlocked ? "La sesión requiere verificación. Los cambios locales se conservan; no se pueden guardar nuevas operaciones." : "Sin conexión verificada. Puedes guardar archivos, comentarios y cambios del cronómetro en la cola local. Eliminar y entregar requieren conexión; el cronómetro no avanza en esta vista."} tone="warning" /> : null}
      {props.staleReadOnly ? <Notice message="La ficha actual aún no está verificada. Actualiza los datos y permisos antes de ejecutar. Los borradores se conservan; esto no indica que la OT esté cerrada." tone="warning" /> : null}
      {tab === "works" ? <View style={styles.stack}>
        <Card><AssignmentOrderSummary group={group} /></Card>
        {props.offline === undefined && !localGroup && !props.staleReadOnly ? <OrderLifecyclePanel {...lifecycleProps} /> : <OfflineOrderLifecyclePanel {...lifecycleProps} offline={props.offline ?? null} staleReadOnly={props.staleReadOnly} />}
        <SectionTitle title={`Trabajos asignados (${group.works.length})`} subtitle="Todos los trabajos recibidos para esta orden, incluidas las asignaciones heredadas del equipo. Los filtros de la jornada no recortan esta lista." />
        {group.works.length === 0 ? <Card><EmptyState title="Sin trabajos asignados" message="No se recibieron trabajos para esta orden. Actualiza la información para consultar cambios." icon="construct-outline" /></Card> : group.works.map((work) => <AssignmentWorkCard
          key={JSON.stringify([group.type, group.id, work.workType, work.id])}
          group={group}
          work={work}
          queryDate={assignmentsRange ? assignmentWorkQueryRange(work, assignmentsRange).startDate : undefined}
          companyBranchId={props.companyBranchId}
          busy={locked}
          online={online}
          offline={props.offline}
          staleReadOnly={props.staleReadOnly}
          onOpenWork={openWork}
          onWorkStatus={(selectedGroup, selectedWork, input) => runOperation(input.status === "in_progress" || input.status === "paused" ? "timer" : "status", () => onWorkStatus(selectedGroup, selectedWork, input))}
        />)}
      </View> : null}
      {tab === "materials" ? <OrderMaterialsTab group={group} onShowWorks={() => selectTab("works")} /> : null}
      {filesVisited ? <View style={[styles.stack, tab !== "files" && styles.hidden]}>
        <SectionTitle title={direct ? "Archivos de la asignación" : "Archivos de la OT"} subtitle="Documentos compartidos de la orden. Los archivos de cada trabajo se consultan desde su propia ficha." />
        <FileWorkspace
          backHandler={tab === "files" ? childBack : undefined}
          scopeKey={filesScope}
          resourceKey={JSON.stringify([group.id, props.range?.startDate, props.range?.endDate, props.companyBranchId])}
          mode={mode}
          readOnly={false}
          busy={locked}
          offline={props.offline}
          pending={pendingDocuments}
          readLocalFile={props.readLocalFile}
          title={direct ? "Archivos compartidos" : "Archivos de la OT"}
          onLoad={async () => {
            const current = latest.current;
            const attachments = await current.onLoadFiles();
            const operations = current.range && current.companyBranchId !== undefined ? operationsForWork(current.offline, { groupId: current.group.id, ...current.range, companyBranchId: current.companyBranchId }) : [];
            return attachments.filter((file) => {
              const operationId = offlineAttachment(file)?.offline.operationId;
              return !operationId || operations.some((operation) => operation.id === operationId && operation.kind === "document" && operation.stepId === undefined);
            });
          }}
          onUpload={(files: LocalPhoto[]) => runOperation("upload", () => props.onUploadFiles(files))}
          onDelete={(fileId: string) => runOperation("delete", () => props.onDeleteFile(fileId))}
        />
      </View> : null}
      <Text style={styles.footerNote}>Los estados, cantidades y asignaciones corresponden a la información recibida de Qualitzer.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: palette.surface },
  headerCopy: { flex: 1, gap: 5 },
  headerTitle: { ...typography.label, color: palette.navy, fontWeight: "700" },
  headerSubtitle: { ...typography.caption, color: palette.textSecondary, flexShrink: 1 },
  codes: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  tabsContainer: { backgroundColor: palette.surface, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
  tabs: { flexGrow: 1, gap: 6, paddingHorizontal: 16 },
  tab: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 12, borderRadius: radius.sm, backgroundColor: palette.track },
  tabSelected: { backgroundColor: palette.navy },
  tabText: { ...typography.label, fontSize: 13, fontWeight: "700", color: palette.textSecondary },
  tabTextSelected: { color: palette.white },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 20, paddingBottom: 32, gap: 20 },
  stack: { gap: 16 },
  hidden: { display: "none" },
  pressed: { opacity: 0.72 },
  footerNote: { ...typography.caption, color: palette.textMuted, textAlign: "center", paddingTop: 8 },
});