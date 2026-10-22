import { useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { IconName } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import {
  evaluateInspection, inspectionRequirementLabel,
  type DeliveryCondition, type WorkshopEntryDetail, type WorkshopOrder, type WorkshopOrderStage, type WorkshopWork
} from "../../domain/workshopEntry";

const shortDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function SectionCard({ title, icon, children, trailing }: { title: string; icon: IconName; children: ReactNode; trailing?: ReactNode }) {
  return <View style={styles.card}>
    <View style={styles.cardHeader}>
      <Ionicons name={icon} size={18} color={palette.primary} accessible={false} />
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      {trailing}
    </View>
    {children}
  </View>;
}

export function Notice({ tone, icon, message }: { tone: "warning" | "danger" | "success" | "info"; icon: IconName; message: string }) {
  const color = tone === "warning" ? palette.orange : tone === "danger" ? palette.danger : tone === "success" ? palette.success : palette.info;
  const soft = tone === "warning" ? palette.orangeSoft : tone === "danger" ? palette.dangerSoft : tone === "success" ? palette.successSoft : palette.infoSoft;
  return <View style={[styles.notice, { borderColor: color, backgroundColor: soft }]} accessibilityRole={tone === "danger" || tone === "warning" ? "alert" : undefined}>
    <Ionicons name={icon} size={20} color={color} accessible={false} />
    <Text style={styles.noticeText}>{message}</Text>
  </View>;
}

type StepState = "done" | "pending" | "skipped";
function Step({ label, caption, state }: { label: string; caption: string; state: StepState }) {
  const color = state === "done" ? palette.success : state === "pending" ? palette.orange : palette.textMuted;
  return <View style={styles.step} accessible accessibilityLabel={`${label}: ${caption}`}>
    <View style={[styles.stepIcon, { backgroundColor: state === "done" ? palette.successSoft : state === "pending" ? palette.orangeSoft : palette.track }]}>
      <Ionicons name={state === "done" ? "checkmark" : state === "pending" ? "ellipsis-horizontal" : "remove"} size={16} color={color} accessible={false} />
    </View>
    <Text style={styles.stepLabel}>{label}</Text>
    <Text style={[styles.stepCaption, { color }]} numberOfLines={2}>{caption}</Text>
  </View>;
}

/** Avance del ingreso: datos, inspección de ingreso y firma de recepción. */
export function IntakeProgress({ detail }: { detail: WorkshopEntryDetail }) {
  const { inspections } = detail;
  const requirement = inspections.entryRequirement;
  const check = evaluateInspection(requirement, inspections.entry, inspections.photoSlots);
  const inspectionState: StepState = !inspections.available ? "pending" : requirement === "none" && !inspections.entry ? "skipped" : check.met ? "done" : "pending";
  const inspectionCaption = !inspections.available ? "Sin verificar"
    : requirement === "none" && !inspections.entry ? "No exigida"
    : inspections.entry ? `${inspections.entry.percentage}% · ${inspectionRequirementLabel(requirement)}` : `Pendiente · ${inspectionRequirementLabel(requirement)}`;
  return <SectionCard title="Avance del ingreso" icon="git-commit-outline">
    <View style={styles.steps}>
      <Step label="Datos" caption="Registrados" state="done" />
      <View style={styles.stepLine} />
      <Step label="Inspección" caption={inspectionCaption} state={inspectionState} />
      <View style={styles.stepLine} />
      <Step label="Firma" caption={detail.reception.signed ? detail.reception.receiverName ?? "Firmado" : "Pendiente"} state={detail.reception.signed ? "done" : "pending"} />
    </View>
    {!check.met && inspections.available ? <Text style={styles.missing}>{check.missing.join(" · ")}</Text> : null}
  </SectionCard>;
}

/** Condiciones para entregar, con el detalle de lo que falta. */
export function DeliveryConditions({ conditions }: { conditions: DeliveryCondition[] }) {
  const pending = conditions.filter((condition) => !condition.met);
  return <SectionCard title="Para entregar el equipo" icon="exit-outline"
    trailing={<View style={[styles.pill, { backgroundColor: pending.length === 0 ? palette.successSoft : palette.orangeSoft }]}>
      <Text style={[styles.pillText, { color: pending.length === 0 ? palette.success : palette.orange }]}>{pending.length === 0 ? "Listo" : `Faltan ${pending.length}`}</Text>
    </View>}>
    {conditions.map((condition) => <View key={condition.id} style={styles.condition} accessible accessibilityLabel={`${condition.title}: ${condition.met ? "cumplido" : "pendiente"}. ${condition.detail}`}>
      <Ionicons name={condition.met ? "checkmark-circle" : "alert-circle"} size={20} color={condition.met ? palette.success : palette.orange} accessible={false} />
      <View style={styles.conditionText}>
        <Text style={styles.conditionTitle}>{condition.title}</Text>
        <Text style={styles.conditionDetail}>{condition.detail}</Text>
      </View>
    </View>)}
  </SectionCard>;
}

export function DeliveredBanner({ delivery }: { delivery: NonNullable<WorkshopEntryDetail["delivery"]> }) {
  return <Notice tone="success" icon="checkmark-done-circle-outline"
    message={`Entregado el ${shortDate(delivery.at)}${delivery.to ? ` a ${delivery.to}` : ""}.${delivery.note ? ` ${delivery.note}` : ""}`} />;
}

const STAGE_TONE: Record<WorkshopOrderStage, { color: string; soft: string }> = {
  approved: { color: palette.success, soft: palette.successSoft },
  rejected: { color: palette.danger, soft: palette.dangerSoft },
  review: { color: palette.info, soft: palette.infoSoft },
  draft: { color: palette.textSecondary, soft: palette.track }
};

function Chip({ label, color, soft }: { label: string; color: string; soft: string }) {
  return <View style={[styles.pill, { backgroundColor: soft }]}><Text style={[styles.pillText, { color }]} numberOfLines={1}>{label}</Text></View>;
}

function WorkRow({ work, orderCode, internal, onOpen, opening }: { work: WorkshopWork; orderCode: string | null; internal: boolean; onOpen?: () => void; opening: boolean }) {
  return <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button" accessibilityLabel={`${work.code}, ${work.title}`}
    accessibilityHint="Abre la ficha del trabajo: iniciar, cronómetro, archivos y checklist" disabled={!onOpen || opening} onPress={onOpen}>
    <View style={styles.rowTop}>
      <Text style={styles.rowCode}>{work.code}</Text>
      {opening ? <ActivityIndicator size="small" color={palette.primary} /> : null}
      {work.loose ? <Chip label={internal ? "Sin mantenimiento" : "Sin OT"} color={palette.orange} soft={palette.orangeSoft} />
        : <Chip label={orderCode ?? work.maintenanceCode ?? "En OT"} color={palette.info} soft={palette.infoSoft} />}
      {work.priority === "high" ? <Chip label="Prioridad alta" color={palette.danger} soft={palette.dangerSoft} /> : null}
    </View>
    <Text style={styles.rowTitle} numberOfLines={2}>{work.title}</Text>
    <View style={styles.progressRow}>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${work.progress}%`, backgroundColor: work.finished ? palette.success : palette.primary }]} /></View>
      <Text style={styles.progressText}>{work.finished ? "Terminado" : `${work.progress}%`}</Text>
    </View>
    <View style={styles.rowFooter}>
      <Text style={[styles.rowMeta, styles.grow]}>{work.statusName && !work.finished ? work.statusName : ""}</Text>
      {onOpen ? <Text style={styles.rowLink}>Abrir trabajo</Text> : null}
      {onOpen ? <Ionicons name="chevron-forward" size={16} color={palette.primary} accessible={false} /> : null}
    </View>
  </Pressable>;
}

export interface OrderActions {
  onCreate: () => void;
  onSend: (order: WorkshopOrder) => void;
  onAddWorks: (order: WorkshopOrder) => void;
  onDelete: (order: WorkshopOrder) => void;
}

function OrderRow({ order, worksCount, actions, hasLoose }: { order: WorkshopOrder; worksCount: number; actions?: OrderActions; hasLoose: boolean }) {
  const editable = actions && order.kind === "workOrder" && !order.sentToCommercial;
  const tone = !order.sentToCommercial ? { color: palette.orange, soft: palette.orangeSoft } : STAGE_TONE[order.stage];
  const kind = order.kind === "maintenance" ? "Mantenimiento" : order.kind === "workOrder" ? "Orden de trabajo" : "Cotización";
  return <View style={styles.row} accessible accessibilityLabel={`${order.code}, ${kind}, ${order.statusLabel}`}>
    <View style={styles.rowTop}>
      <Text style={styles.rowCode}>{order.code}</Text>
      <Chip label={order.statusLabel} color={tone.color} soft={tone.soft} />
    </View>
    {order.title ? <Text style={styles.rowTitle} numberOfLines={2}>{order.title}</Text> : null}
    <Text style={styles.rowMeta}>{kind}{order.workOrderCode && order.workOrderCode !== order.code ? ` · ${order.workOrderCode}` : ""} · {worksCount === 1 ? "1 trabajo" : `${worksCount} trabajos`}</Text>
    {editable ? <View style={styles.orderActions}>
      <Pressable accessibilityRole="button" onPress={() => actions.onSend(order)} style={[styles.orderAction, styles.orderActionPrimary]}>
        <Ionicons name="paper-plane-outline" size={15} color={palette.white} accessible={false} /><Text style={styles.orderActionPrimaryText}>Enviar a comercial</Text>
      </Pressable>
      {hasLoose ? <Pressable accessibilityRole="button" onPress={() => actions.onAddWorks(order)} style={styles.orderAction}>
        <Ionicons name="add" size={15} color={palette.primary} accessible={false} /><Text style={styles.orderActionText}>Agregar trabajos</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Eliminar ${order.code}`} onPress={() => actions.onDelete(order)} style={styles.orderAction}>
        <Ionicons name="trash-outline" size={15} color={palette.danger} accessible={false} /><Text style={[styles.orderActionText, { color: palette.danger }]}>Eliminar</Text>
      </Pressable>
    </View> : null}
  </View>;
}

/** Pestañas Trabajos / Órdenes de trabajo (o Mantenimientos en equipos propios). */
export function WorkAndOrders({ detail, onAddWork, onAddMaintenance, onLinkWorks, onOpenWork, openingWorkId = null, orderActions }: {
  detail: WorkshopEntryDetail; onAddWork?: () => void; onLinkWorks?: () => void; onOpenWork?: (workId: number) => void; openingWorkId?: number | null;
  orderActions?: OrderActions;
  /** Equipo propio: crear un mantenimiento del ingreso con el formulario normal de la app. */
  onAddMaintenance?: () => void;
}) {
  const hasLoose = detail.works.items.some((work) => work.loose);
  const [tab, setTab] = useState<"works" | "orders">("works");
  const ordersLabel = detail.isInternalEntry ? "Mantenimientos" : "Órdenes de trabajo";
  const codeOf = (orderId: number | null) => {
    const found = detail.orders.items.find((order) => order.id === orderId);
    return found ? found.workOrderCode ?? found.code : null;
  };
  const tabs = [
    { id: "works" as const, label: "Trabajos", count: detail.works.items.length, warn: detail.works.items.some((work) => work.loose) },
    { id: "orders" as const, label: ordersLabel, count: detail.orders.items.length, warn: false }
  ];
  const section = tab === "works" ? detail.works : detail.orders;
  return <View style={styles.card}>
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((option) => <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: tab === option.id }} onPress={() => setTab(option.id)}
        style={[styles.tab, tab === option.id && styles.tabOn]}>
        <Text style={[styles.tabText, tab === option.id && styles.tabTextOn]} numberOfLines={1}>{option.label}</Text>
        <View style={[styles.tabCount, option.warn && styles.tabCountWarn]}><Text style={[styles.tabCountText, option.warn && styles.tabCountTextWarn]}>{option.count}</Text></View>
      </Pressable>)}
    </View>
    {tab === "works" && orderActions && hasLoose ? <Pressable accessibilityRole="button" onPress={orderActions.onCreate} style={[styles.tabAction, styles.tabActionStrong]}>
      <Ionicons name="document-text-outline" size={18} color={palette.white} accessible={false} /><Text style={styles.tabActionStrongText}>Transformar trabajos sueltos en OT</Text>
    </Pressable> : null}
    {tab === "orders" && orderActions ? <Pressable accessibilityRole="button" disabled={!hasLoose} onPress={orderActions.onCreate} style={[styles.tabAction, !hasLoose && styles.disabledAction]}>
      <Ionicons name="add-circle-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.tabActionText}>{hasLoose ? "Crear OT" : "Crear OT (agrega trabajos primero)"}</Text>
    </Pressable> : null}
    {tab === "orders" && onAddMaintenance ? <Pressable accessibilityRole="button" onPress={onAddMaintenance} style={[styles.tabAction, styles.tabActionStrong]}>
      <Ionicons name="add-circle-outline" size={18} color={palette.white} accessible={false} /><Text style={styles.tabActionStrongText}>Agregar mantenimiento</Text>
    </Pressable> : null}
    {tab === "works" && (onAddWork || onLinkWorks) ? <View style={styles.tabActions}>
      {onAddWork ? <Pressable accessibilityRole="button" onPress={onAddWork} style={styles.tabAction}>
        <Ionicons name="add-circle-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.tabActionText}>Agregar trabajo</Text>
      </Pressable> : null}
      {onLinkWorks ? <Pressable accessibilityRole="button" onPress={onLinkWorks} style={styles.tabAction}>
        <Ionicons name="link-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.tabActionText}>Unir existentes</Text>
      </Pressable> : null}
    </View> : null}
    {!section.available ? <Notice tone="warning" icon="cloud-offline-outline" message={`No se pudo cargar ${tab === "works" ? "los trabajos" : detail.isInternalEntry ? "los mantenimientos" : "las órdenes"}. Desliza hacia abajo para reintentar.`} />
      : tab === "works" ? (detail.works.items.length === 0 ? <Text style={styles.empty}>Este ingreso todavía no tiene trabajos.</Text>
        : detail.works.items.map((work) => <WorkRow key={work.id} work={work} orderCode={codeOf(work.orderId)} internal={detail.isInternalEntry}
          onOpen={onOpenWork ? () => onOpenWork(work.id) : undefined} opening={openingWorkId === work.id} />))
      : detail.orders.items.length === 0 ? <Text style={styles.empty}>{detail.isInternalEntry ? "Este ingreso todavía no tiene mantenimientos." : "Este ingreso todavía no tiene órdenes de trabajo ni cotizaciones."}</Text>
        : detail.orders.items.map((order) => <OrderRow key={order.id} order={order} worksCount={detail.works.items.filter((work) => work.orderId === order.id).length}
          actions={orderActions} hasLoose={hasLoose} />)}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: palette.heading },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1 },
  noticeText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  steps: { flexDirection: "row", alignItems: "flex-start" },
  step: { flex: 1, alignItems: "center", gap: 4 },
  stepIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  stepLabel: { fontSize: 13, fontWeight: "800", color: palette.text },
  stepCaption: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  stepLine: { width: 18, height: 2, marginTop: 15, backgroundColor: palette.border },
  missing: { ...typography.caption, color: palette.orange, fontWeight: "600" },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, maxWidth: 200 },
  pillText: { fontSize: 11, fontWeight: "800" },
  condition: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  conditionText: { flex: 1, gap: 2 },
  conditionTitle: { fontSize: 14, fontWeight: "800", color: palette.text },
  conditionDetail: { ...typography.caption, color: palette.textSecondary },
  tabs: { flexDirection: "row", gap: 6, padding: 4, borderRadius: radius.md, backgroundColor: palette.background },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 8, borderRadius: radius.sm },
  tabOn: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  tabText: { flexShrink: 1, fontSize: 13, fontWeight: "700", color: palette.textSecondary },
  tabTextOn: { color: palette.primary, fontWeight: "800" },
  tabCount: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  tabCountWarn: { backgroundColor: palette.orangeSoft },
  tabCountText: { fontSize: 11, fontWeight: "800", color: palette.textSecondary },
  tabCountTextWarn: { color: palette.orange },
  empty: { ...typography.caption, color: palette.textSecondary, textAlign: "center", paddingVertical: 14 },
  tabActions: { flexDirection: "row", gap: 8 },
  tabAction: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  tabActionText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  tabActionStrong: { flex: 0, backgroundColor: palette.primary, borderColor: palette.primary },
  tabActionStrongText: { fontSize: 13, fontWeight: "800", color: palette.white },
  disabledAction: { opacity: 0.5 },
  orderActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  orderAction: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  orderActionText: { fontSize: 12, fontWeight: "800", color: palette.primary },
  orderActionPrimary: { backgroundColor: palette.primary, borderColor: palette.primary },
  orderActionPrimaryText: { fontSize: 12, fontWeight: "800", color: palette.white },
  row: { gap: 5, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowCode: { fontSize: 12, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  rowTitle: { fontSize: 14, fontWeight: "700", color: palette.heading },
  rowMeta: { ...typography.caption, color: palette.textSecondary },
  rowPressed: { opacity: 0.85 },
  rowFooter: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowLink: { fontSize: 12, fontWeight: "800", color: palette.primary },
  grow: { flex: 1 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: palette.track },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { width: 74, textAlign: "right", fontSize: 11, fontWeight: "800", color: palette.textSecondary }
});
