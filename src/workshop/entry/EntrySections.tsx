import { useEffect, useState, type ReactNode } from "react";
import { matchesSearch } from "../../domain/textSearch";
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

/** Vista de los trabajos: compacta (fila pequeña) o extendida (tarjeta de Mi jornada para iniciar, entregar…). */
export function WorkLayoutToggle({ value, onChange }: { value: "compact" | "extended"; onChange: (value: "compact" | "extended") => void }) {
  const options = [{ id: "compact" as const, label: "Compacta", icon: "list-outline" as const }, { id: "extended" as const, label: "Extendida", icon: "albums-outline" as const }];
  return <View style={styles.layoutToggle} accessibilityRole="radiogroup" accessibilityLabel="Vista de los trabajos">
    {options.map((option) => {
      const on = value === option.id;
      return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`Vista ${option.label.toLowerCase()}`}
        onPress={() => onChange(option.id)} style={[styles.layoutOption, on && styles.layoutOptionOn]}>
        <Ionicons name={option.icon} size={14} color={on ? palette.white : palette.textSecondary} accessible={false} />
        <Text style={[styles.layoutText, on && styles.layoutTextOn]}>{option.label}</Text>
      </Pressable>;
    })}
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
/** Paso en una sola línea, para la versión minimizada del avance. */
function MiniStep({ label, state }: { label: string; state: StepState }) {
  const color = state === "done" ? palette.success : state === "pending" ? palette.orange : palette.textMuted;
  return <View style={[styles.miniStep, { backgroundColor: state === "done" ? palette.successSoft : state === "pending" ? palette.orangeSoft : palette.track }]}
    accessible accessibilityLabel={`${label}: ${state === "done" ? "listo" : state === "pending" ? "pendiente" : "no exigido"}`}>
    <Ionicons name={state === "done" ? "checkmark" : state === "pending" ? "ellipsis-horizontal" : "remove"} size={12} color={color} accessible={false} />
    <Text style={[styles.miniStepText, { color }]} numberOfLines={1}>{label}</Text>
  </View>;
}
function Step({ label, caption, state }: { label: string; caption: string; state: StepState }) {
  const color = state === "done" ? palette.success : state === "pending" ? palette.orange : palette.textMuted;
  return <View style={styles.step} accessible accessibilityLabel={`${label}: ${caption}`}>
    <View style={styles.stepHead}>
      <View style={[styles.stepIcon, { backgroundColor: state === "done" ? palette.successSoft : state === "pending" ? palette.orangeSoft : palette.track }]}>
        <Ionicons name={state === "done" ? "checkmark" : state === "pending" ? "ellipsis-horizontal" : "remove"} size={12} color={color} accessible={false} />
      </View>
      <Text style={styles.stepLabel}>{label}</Text>
    </View>
    <Text style={[styles.stepCaption, { color }]} numberOfLines={1}>{caption}</Text>
  </View>;
}

export type IntakeAction = { icon: IconName; label: string; onPress: () => void; strong?: boolean };

/** Avance del ingreso: datos, inspección de ingreso y firma de recepción, con sus acciones. Se puede minimizar. */
export function IntakeProgress({ detail, actions = [] }: { detail: WorkshopEntryDetail; actions?: IntakeAction[] }) {
  const { inspections } = detail;
  const requirement = inspections.entryRequirement;
  const check = evaluateInspection(requirement, inspections.entry, inspections.photoSlots);
  const inspectionState: StepState = !inspections.available ? "pending" : requirement === "none" && !inspections.entry ? "skipped" : check.met ? "done" : "pending";
  const inspectionCaption = !inspections.available ? "Sin verificar"
    : requirement === "none" && !inspections.entry ? "No exigida"
    : inspections.entry ? `${inspections.entry.percentage}% · ${inspectionRequirementLabel(requirement)}` : `Pendiente · ${inspectionRequirementLabel(requirement)}`;
  const pending = (inspectionState === "pending" ? 1 : 0) + (detail.reception.signed ? 0 : 1);
  // Si ya está todo listo parte minimizada para ahorrar espacio.
  const [collapsed, setCollapsed] = useState(pending === 0);
  const toggle = <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? "Expandir avance del ingreso" : "Minimizar avance del ingreso"} accessibilityState={{ expanded: !collapsed }}
    hitSlop={10} onPress={() => setCollapsed((value) => !value)} style={({ pressed }) => [styles.collapseToggle, pressed && styles.pressed]}>
    <Ionicons name={collapsed ? "chevron-down" : "chevron-up"} size={16} color={palette.textSecondary} accessible={false} />
  </Pressable>;
  // Minimizada: todo en una fila (pasos, botones solo con ícono y la flecha).
  if (collapsed) return <View style={[styles.card, styles.collapsedRow]} accessibilityLabel="Avance del ingreso">
    <View style={styles.miniSteps}>
      <MiniStep label="Datos" state="done" />
      <MiniStep label={inspections.entry ? `Inspección ${inspections.entry.percentage}%` : "Inspección"} state={inspectionState} />
      <MiniStep label="Firma" state={detail.reception.signed ? "done" : "pending"} />
    </View>
    {actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={6}
      style={({ pressed }) => [styles.iconAction, action.strong && styles.intakeActionStrong, pressed && styles.pressed]}>
      <Ionicons name={action.icon} size={16} color={action.strong ? palette.white : palette.primary} accessible={false} />
    </Pressable>)}
    {toggle}
  </View>;
  return <SectionCard title="Avance del ingreso" icon="git-commit-outline"
    trailing={<>
      <View style={[styles.pill, { backgroundColor: pending === 0 ? palette.successSoft : palette.orangeSoft }]}>
        <Text style={[styles.pillText, { color: pending === 0 ? palette.success : palette.orange }]}>{pending === 0 ? "Completo" : `Faltan ${pending}`}</Text>
      </View>
      {toggle}
    </>}>
    <View style={styles.steps}>
      <Step label="Datos" caption="Registrados" state="done" />
      <View style={styles.stepLine} />
      <Step label="Inspección" caption={inspectionCaption} state={inspectionState} />
      <View style={styles.stepLine} />
      <Step label="Firma" caption={detail.reception.signed ? detail.reception.receiverName ?? "Firmado" : "Pendiente"} state={detail.reception.signed ? "done" : "pending"} />
    </View>
    {!check.met && inspections.available ? <Text style={styles.missing}>{check.missing.join(" · ")}</Text> : null}
    {actions.length > 0 ? <View style={styles.intakeActions}>
      {actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress}
        style={({ pressed }) => [styles.intakeAction, action.strong && styles.intakeActionStrong, pressed && styles.pressed]}>
        <Ionicons name={action.icon} size={16} color={action.strong ? palette.white : palette.primary} accessible={false} />
        <Text style={[styles.intakeActionText, action.strong && { color: palette.white }]} numberOfLines={1}>{action.label}</Text>
      </Pressable>)}
    </View> : null}
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
      <Ionicons name={condition.met ? "checkmark-circle" : "alert-circle"} size={16} color={condition.met ? palette.success : palette.orange} accessible={false} />
      <View style={styles.conditionText}>
        <Text style={styles.conditionTitle}>{condition.title}</Text>
        {!condition.met ? <Text style={styles.conditionDetail}>{condition.detail}</Text> : null}
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

/** Acciones de OT; las que la sucursal no permite en la app no se pasan. */
export interface OrderActions {
  onCreate?: () => void;
  onSend?: (order: WorkshopOrder) => void;
  onAddWorks?: (order: WorkshopOrder) => void;
  onDelete?: (order: WorkshopOrder) => void;
}

const orderDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)).replace(".", "");

function OrderInfo({ label, value, icon, tone }: { label: string; value: string; icon: IconName; tone?: string }) {
  return <View style={styles.orderInfo}>
    <View style={styles.orderInfoHead}><Ionicons name={icon} size={11} color={palette.textMuted} accessible={false} /><Text style={styles.orderInfoLabel}>{label}</Text></View>
    <Text style={[styles.orderInfoValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
  </View>;
}

/** Tarjeta de OT, cotización o mantenimiento con el mismo orden visual que las OT de Mi jornada. */
function OrderRow({ order, works, actions, hasLoose, onOpenWork, onOpenOrder, onFiles, onComments }: {
  order: WorkshopOrder; works: WorkshopWork[]; actions?: OrderActions; hasLoose: boolean; onOpenWork?: (workId: number) => void;
  onOpenOrder?: (order: WorkshopOrder) => void; onFiles?: (order: WorkshopOrder) => void; onComments?: (order: WorkshopOrder) => void;
}) {
  const editable = Boolean(actions && order.kind === "workOrder" && !order.sentToCommercial && (actions.onSend || actions.onDelete || actions.onAddWorks));
  const detail = onOpenOrder && order.kind !== "maintenance" ? () => onOpenOrder(order) : undefined;
  // Archivos y comentarios (generales) de la OT en una ventana, sin entrar al detalle (el borrador del chat se guarda por OT).
  const files = onFiles && order.kind !== "maintenance" ? () => onFiles(order) : undefined;
  const comments = onComments && order.kind !== "maintenance" ? () => onComments(order) : undefined;
  const tone = !order.sentToCommercial ? { color: palette.orange, soft: palette.orangeSoft } : order.finished ? { color: palette.success, soft: palette.successSoft } : STAGE_TONE[order.stage];
  const kind = order.kind === "maintenance" ? "Mantenimiento" : order.kind === "workOrder" ? "Orden de trabajo" : "Cotización";
  const kindIcon: IconName = order.kind === "maintenance" ? "build-outline" : order.kind === "workOrder" ? "document-text-outline" : "receipt-outline";
  const done = works.filter((work) => work.finished).length;
  const progress = works.length === 0 ? 0 : Math.round(works.reduce((total, work) => total + (work.finished ? 100 : work.progress), 0) / works.length);
  const linkedOt = order.workOrderCode && order.workOrderCode !== order.code ? order.workOrderCode : null;
  return <View style={[styles.order, !order.sentToCommercial && styles.orderDraft]} accessible={!editable && works.length === 0} accessibilityLabel={`${order.code}, ${kind}, ${order.statusLabel}`}>
    <View style={styles.orderTop}>
      <View style={styles.orderCodePill}><Text style={styles.orderCode} numberOfLines={1}>{order.code}</Text></View>
      <View style={styles.grow} />
      <View style={[styles.orderStatus, { backgroundColor: tone.soft, borderColor: tone.color }]}><Text style={[styles.orderStatusText, { color: tone.color }]} numberOfLines={1}>{order.finished ? "Terminada" : order.statusLabel}</Text></View>
    </View>
    <View style={styles.orderKind}>
      <Ionicons name={kindIcon} size={13} color={palette.textSecondary} accessible={false} />
      <Text style={styles.orderKindText} numberOfLines={1}>{kind}{order.typeLabel && order.typeLabel !== kind ? ` · ${order.typeLabel}` : ""}</Text>
    </View>
    <Text style={styles.orderTitle} numberOfLines={2}>{(order.title ?? "Sin título").toUpperCase()}</Text>
    <Text style={styles.rowMeta}>{works.length === 1 ? "1 trabajo" : `${works.length} trabajos`}{order.kind !== "maintenance" ? order.quoted ? " · Con valores" : " · Sin valores" : ""}</Text>
    <View style={styles.orderInfoGrid}>
      {order.createdAt ? <OrderInfo label={order.kind === "maintenance" ? "CREADO" : "CREADA"} value={orderDate(order.createdAt)} icon="calendar-outline" /> : null}
      {order.kind === "workOrder" ? <OrderInfo label="COMERCIAL" value={order.sentAt ? `Enviada ${orderDate(order.sentAt)}` : order.sentToCommercial ? "Enviada" : "Sin enviar"} icon="paper-plane-outline"
        tone={order.sentToCommercial ? undefined : palette.orange} /> : null}
      {linkedOt ? <OrderInfo label="OT ASOCIADA" value={linkedOt} icon="document-text-outline" /> : null}
    </View>
    <View style={styles.orderProgressHead}>
      <Text style={styles.orderProgressLabel}>TRABAJOS</Text>
      <Text style={styles.orderProgressValue}>{done}/{works.length} · {progress}%</Text>
    </View>
    <View style={styles.orderTrack}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: done === works.length && works.length > 0 ? palette.success : palette.primary }]} /></View>
    {works.map((work) => <Pressable key={work.id} accessibilityRole="button" accessibilityLabel={`${work.code}, ${work.title}`} disabled={!onOpenWork} onPress={() => onOpenWork?.(work.id)}
      style={({ pressed }) => [styles.orderWork, pressed && styles.rowPressed]}>
      <Ionicons name={work.finished ? "checkmark-circle" : "ellipse-outline"} size={15} color={work.finished ? palette.success : palette.textMuted} accessible={false} />
      <Text style={styles.orderWorkCode}>{work.code}</Text>
      <Text style={styles.orderWorkTitle} numberOfLines={1}>{work.title}</Text>
      <Text style={styles.orderWorkPct}>{work.finished ? "100%" : `${work.progress}%`}</Text>
      {onOpenWork ? <Ionicons name="chevron-forward" size={14} color={palette.textMuted} accessible={false} /> : null}
    </Pressable>)}
    {/* Barra inferior de acciones, como "Detalle | Archivos" en las OT de Mi jornada. */}
    {editable || detail || files || comments ? <View style={styles.orderBar}>
      {detail ? <Pressable accessibilityRole="button" accessibilityLabel={`Ver detalle de ${order.code}`} onPress={detail}
        style={({ pressed }) => [styles.orderBarItem, styles.orderBarPrimary, pressed && styles.rowPressed]}>
        <Ionicons name="document-text-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.orderBarText}>Detalle</Text>
      </Pressable> : null}
      {files ? <Pressable accessibilityRole="button" accessibilityLabel={`Archivos de ${order.code}`} onPress={files}
        style={({ pressed }) => [styles.orderBarItem, detail ? styles.orderBarDivider : styles.orderBarPrimary, pressed && styles.rowPressed]}>
        <Ionicons name="folder-open-outline" size={18} color={palette.text} accessible={false} /><Text style={[styles.orderBarText, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>Archivos</Text>
      </Pressable> : null}
      {comments ? <Pressable accessibilityRole="button" accessibilityLabel={`Comentarios de ${order.code}`} onPress={comments}
        style={({ pressed }) => [styles.orderBarItem, styles.orderBarDivider, pressed && styles.rowPressed]}>
        <Ionicons name="chatbubbles-outline" size={18} color={palette.text} accessible={false} /><Text style={[styles.orderBarText, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>Comentarios</Text>
      </Pressable> : null}
      {editable && actions?.onSend ? <Pressable accessibilityRole="button" accessibilityLabel={`Enviar ${order.code} a comercial`} onPress={() => actions.onSend?.(order)}
        style={({ pressed }) => [styles.orderBarItem, detail ? styles.orderBarDivider : styles.orderBarPrimary, pressed && styles.rowPressed]}>
        <Ionicons name="paper-plane-outline" size={18} color={detail ? palette.text : palette.primary} accessible={false} /><Text style={[styles.orderBarText, detail ? { color: palette.text } : null]}>Enviar</Text>
      </Pressable> : null}
      {editable && hasLoose && actions?.onAddWorks ? <Pressable accessibilityRole="button" accessibilityLabel={`Agregar trabajos a ${order.code}`} onPress={() => actions.onAddWorks?.(order)}
        style={({ pressed }) => [styles.orderBarItem, styles.orderBarDivider, pressed && styles.rowPressed]}>
        <Ionicons name="add-circle-outline" size={18} color={palette.text} accessible={false} /><Text style={[styles.orderBarText, { color: palette.text }]}>Trabajos</Text>
      </Pressable> : null}
      {editable && actions?.onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={`Eliminar ${order.code}`} onPress={() => actions.onDelete?.(order)}
        style={({ pressed }) => [styles.orderBarItem, styles.orderBarDivider, pressed && styles.rowPressed]}>
        <Ionicons name="trash-outline" size={18} color={palette.danger} accessible={false} /><Text style={[styles.orderBarText, { color: palette.danger }]}>Eliminar</Text>
      </Pressable> : null}
    </View> : null}
  </View>;
}

/** Pestañas Trabajos / Órdenes de trabajo (o Mantenimientos en equipos propios). */
export function WorkAndOrders({ detail, onAddWork, onAddMaintenance, onLinkWorks, onOpenWork, onOpenOrder, onOrderFiles, onOrderComments, openingWorkId = null, orderActions, initialTab, onTabChange, workCard, query = "", workLayout = "extended", onWorkLayout }: {
  /** Archivos y comentarios de una OT en una ventana, desde su tarjeta. */
  onOrderFiles?: (order: WorkshopOrder) => void; onOrderComments?: (order: WorkshopOrder) => void;
  /** Vista de los trabajos (compacta o extendida) y su cambio. */
  workLayout?: "compact" | "extended"; onWorkLayout?: (layout: "compact" | "extended") => void;
  /** Búsqueda del encabezado: filtra trabajos y OTs (una OT aparece si coincide ella o uno de sus trabajos). */
  query?: string;
  /** Pestaña con la que abre (la última usada en este ingreso) y aviso al cambiarla. */
  initialTab?: "works" | "orders"; onTabChange?: (tab: "works" | "orders") => void;
  /** Tarjeta de Mi jornada del trabajo, si está en los días cargados. */
  workCard?: (workId: number) => ReactNode | null;
  /** Abre el detalle de una OT o cotización (no de un mantenimiento). */
  onOpenOrder?: (order: WorkshopOrder) => void;
  detail: WorkshopEntryDetail; onAddWork?: () => void; onLinkWorks?: () => void; onOpenWork?: (workId: number) => void; openingWorkId?: number | null;
  orderActions?: OrderActions;
  /** Equipo propio: crear un mantenimiento del ingreso con el formulario normal de la app. */
  onAddMaintenance?: () => void;
}) {
  const hasLoose = detail.works.items.some((work) => work.loose);
  const [tab, setTabState] = useState<"works" | "orders">(initialTab ?? "works");
  const setTab = (next: "works" | "orders") => { setTabState(next); onTabChange?.(next); };
  const ordersLabel = detail.isInternalEntry ? "Mantenimientos" : "OTs";
  const codeOf = (orderId: number | null) => {
    const found = detail.orders.items.find((order) => order.id === orderId);
    return found ? found.workOrderCode ?? found.code : null;
  };
  const searching = query.trim() !== "";
  const works = searching ? detail.works.items.filter((work) => matchesSearch(query, ...Object.values(work), codeOf(work.orderId))) : detail.works.items;
  const orders = searching ? detail.orders.items.filter((order) => matchesSearch(query, ...Object.values(order)) || works.some((work) => work.orderId === order.id)) : detail.orders.items;
  // Al buscar, si en la pestaña abierta no hay resultados y en la otra sí, se cambia sola.
  useEffect(() => {
    if (!searching) return;
    if (tab === "works" && works.length === 0 && orders.length > 0) setTabState("orders");
    else if (tab === "orders" && orders.length === 0 && works.length > 0) setTabState("works");
  }, [query]);
  const tabs = [
    { id: "works" as const, label: "Trabajos", count: works.length, warn: detail.works.items.some((work) => work.loose) },
    { id: "orders" as const, label: ordersLabel, count: orders.length, warn: false }
  ];
  const section = tab === "works" ? detail.works : detail.orders;
  return <View style={styles.card}>
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((option) => <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: tab === option.id }} onPress={() => setTab(option.id)}
        style={[styles.tab, tab === option.id && styles.tabOn]}>
        <Text style={[styles.tabText, tab === option.id && styles.tabTextOn]} numberOfLines={1}>{option.label}</Text>
        <View style={[styles.tabCount, tab === option.id && styles.tabCountOn, option.warn && styles.tabCountWarn]}>
          <Text style={[styles.tabCountText, tab === option.id && styles.tabCountTextOn, option.warn && styles.tabCountTextWarn]}>{option.count}</Text>
        </View>
      </Pressable>)}
    </View>
    {tab === "works" && orderActions?.onCreate && hasLoose ? <Pressable accessibilityRole="button" onPress={orderActions.onCreate} style={[styles.tabAction, styles.tabActionStrong]}>
      <Ionicons name="document-text-outline" size={18} color={palette.white} accessible={false} /><Text style={styles.tabActionStrongText}>Transformar trabajos sueltos en OT</Text>
    </Pressable> : null}
    {tab === "orders" && orderActions?.onCreate ? <Pressable accessibilityRole="button" onPress={orderActions.onCreate} style={styles.tabAction}>
      <Ionicons name="add-circle-outline" size={18} color={palette.primary} accessible={false} /><Text style={styles.tabActionText}>Crear OT</Text>
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
      : tab === "works" && works.length > 0 && onWorkLayout ? <WorkLayoutToggle value={workLayout} onChange={onWorkLayout} /> : null}
    {!section.available ? null
      : tab === "works" ? (works.length === 0 ? <Text style={styles.empty}>{searching ? `Ningún trabajo coincide con «${query.trim()}».` : "Este ingreso todavía no tiene trabajos."}</Text>
        : works.map((work) => {
          // Vista extendida: la misma tarjeta de Mi jornada (iniciar, entregar, archivos, checklist, comentarios). Compacta: la fila pequeña.
          const card = workLayout === "extended" ? workCard?.(work.id) : null;
          // La tarjeta ya muestra los códigos de la OT; afuera solo se avisa si el trabajo está suelto.
          if (card) return <View key={work.id} style={styles.cardWrap}>
            {work.loose ? <View style={styles.rowTop}>
              <Chip label={detail.isInternalEntry ? "Sin mantenimiento" : "Sin OT"} color={palette.orange} soft={palette.orangeSoft} />
            </View> : null}
            {card}
          </View>;
          return <WorkRow key={work.id} work={work} orderCode={codeOf(work.orderId)} internal={detail.isInternalEntry}
            onOpen={onOpenWork ? () => onOpenWork(work.id) : undefined} opening={openingWorkId === work.id} />;
        }))
      : orders.length === 0 ? <Text style={styles.empty}>{searching ? `Ninguna ${detail.isInternalEntry ? "orden de mantenimiento" : "OT"} coincide con «${query.trim()}».` : detail.isInternalEntry ? "Este ingreso todavía no tiene mantenimientos." : "Este ingreso todavía no tiene órdenes de trabajo ni cotizaciones."}</Text>
        : orders.map((order) => <OrderRow key={order.id} order={order} works={detail.works.items.filter((work) => work.orderId === order.id)}
          actions={orderActions} hasLoose={hasLoose} onOpenWork={onOpenWork} onOpenOrder={onOpenOrder} onFiles={onOrderFiles} onComments={onOrderComments} />)}
  </View>;
}

const styles = StyleSheet.create({
  layoutToggle: { flexDirection: "row", alignSelf: "flex-end", padding: 2, gap: 2, borderRadius: radius.pill, backgroundColor: palette.track },
  layoutOption: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  layoutOptionOn: { backgroundColor: palette.primary },
  layoutText: { fontSize: 12, fontWeight: "700", color: palette.textSecondary },
  layoutTextOn: { color: palette.white },
  card: { padding: 12, gap: 8, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.heading },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1 },
  noticeText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  steps: { flexDirection: "row", alignItems: "flex-start" },
  step: { flex: 1, alignItems: "center", gap: 2 },
  stepHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepIcon: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepLabel: { fontSize: 12, fontWeight: "800", color: palette.text },
  stepCaption: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  stepLine: { width: 10, height: 2, marginTop: 9, backgroundColor: palette.border },
  missing: { ...typography.caption, color: palette.orange, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  miniSteps: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  collapsedRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  iconAction: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  miniStep: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  miniStepText: { fontSize: 11, fontWeight: "800" },
  collapseToggle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  intakeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  intakeAction: { flexGrow: 1, flexBasis: "30%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  intakeActionStrong: { backgroundColor: palette.primary, borderColor: palette.primary },
  intakeActionText: { fontSize: 12, fontWeight: "800", color: palette.primary },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, maxWidth: 200 },
  pillText: { fontSize: 11, fontWeight: "800" },
  condition: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  conditionText: { flex: 1, gap: 1 },
  conditionTitle: { fontSize: 13, fontWeight: "700", color: palette.text },
  conditionDetail: { ...typography.caption, color: palette.textSecondary },
  // Mismas pestañas subrayadas que Trabajos / Mantenimientos / OTs de Mi jornada.
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: palette.border },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: palette.primary },
  tabText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: "600", color: palette.textSecondary },
  tabTextOn: { color: palette.primary, fontWeight: "800" },
  tabCount: { minWidth: 24, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  tabCountOn: { backgroundColor: palette.primary },
  tabCountWarn: { backgroundColor: palette.orangeSoft },
  tabCountText: { fontSize: 12, lineHeight: 14, fontWeight: "700", color: palette.primary, fontVariant: ["tabular-nums"] },
  tabCountTextOn: { color: palette.white },
  tabCountTextWarn: { color: palette.orange },
  empty: { ...typography.caption, color: palette.textSecondary, textAlign: "center", paddingVertical: 14 },
  tabActions: { flexDirection: "row", gap: 8 },
  tabAction: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  tabActionText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  tabActionStrong: { flex: 0, backgroundColor: palette.primary, borderColor: palette.primary },
  tabActionStrongText: { fontSize: 13, fontWeight: "800", color: palette.white },
  disabledAction: { opacity: 0.5 },
  orderBar: { flexDirection: "row", marginHorizontal: -12, marginBottom: -12, marginTop: 4, borderTopWidth: 1, borderTopColor: palette.border, overflow: "hidden", borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  orderBarItem: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 9, paddingHorizontal: 2 },
  orderBarPrimary: { backgroundColor: palette.primarySoft },
  orderBarDivider: { borderLeftWidth: 1, borderLeftColor: palette.border },
  orderBarText: { fontSize: 12, fontWeight: "800", color: palette.primary },
  order: { gap: 7, padding: 12, overflow: "hidden", borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  orderDraft: { borderColor: palette.orange, borderStyle: "dashed" },
  orderTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  orderCodePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: palette.primarySoft, flexShrink: 1 },
  orderCode: { fontSize: 12, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  orderStatus: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, maxWidth: "60%" },
  orderStatusText: { fontSize: 11, fontWeight: "800" },
  orderKind: { flexDirection: "row", alignItems: "center", gap: 5 },
  orderKindText: { fontSize: 12, color: palette.textSecondary, flexShrink: 1 },
  orderTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800", color: palette.heading, letterSpacing: 0.2 },
  orderInfoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  orderInfo: { flexGrow: 1, flexBasis: "45%", minWidth: 0, gap: 2, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: palette.background },
  orderInfoHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  orderInfoLabel: { fontSize: 10, fontWeight: "800", color: palette.textMuted, letterSpacing: 0.5 },
  orderInfoValue: { fontSize: 13, fontWeight: "700", color: palette.heading },
  orderProgressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  orderProgressLabel: { fontSize: 10, fontWeight: "800", color: palette.textMuted, letterSpacing: 0.5 },
  orderProgressValue: { fontSize: 12, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  orderTrack: { height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: palette.track },
  orderWork: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: palette.background },
  orderWorkCode: { fontSize: 11, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  orderWorkTitle: { flex: 1, minWidth: 0, fontSize: 12, color: palette.text },
  orderWorkPct: { fontSize: 11, fontWeight: "800", color: palette.textSecondary, fontVariant: ["tabular-nums"] },
  orderActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.border },
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
  cardWrap: { gap: 6 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: palette.track },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { width: 74, textAlign: "right", fontSize: 11, fontWeight: "800", color: palette.textSecondary }
});
