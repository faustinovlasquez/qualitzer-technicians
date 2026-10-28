import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, BackHandler, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Button, IconButton, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import { isWorkshopEntryOverdue, workshopStatusLabel, type WorkshopArea, type WorkshopEntry } from "../domain/workshopBoard";
import { workshopDeliveryConditions, type WorkshopEntryDetail } from "../domain/workshopEntry";
import type { InspectionKind } from "../domain/workshopInspection";
import { useWorkshopEntry } from "./useWorkshopEntry";
import { DeliveredBanner, IntakeProgress, Notice, WorkAndOrders } from "./entry/EntrySections";
import { LinkWorksSheet } from "./works/LinkWorksSheet";
import { AddWorksSheet, ConfirmOrderSheet, CreateOrderSheet } from "./orders/OrderSheets";
import { OrderSentSuccess } from "./orders/OrderSentSuccess";
import type { WorkshopOrder } from "../domain/workshopEntry";
import { EstimatedDateSheet, ManageBar, MoveAreaSheet, StatusSheet } from "./manage/ManageSheets";
import type { useWorkshopBoard } from "./useWorkshopBoard";
import { useAppPermission } from "../application/appPermissions";
import { PrivateModal as Modal } from "../security/DeviceSecurityContext";
import { ResourceSheet } from "../screens/orders/OrderQuickSheet";
import type { DriveApi } from "../domain/fileDrive";
import type { ThreadApi } from "../domain/threads";

const longDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

/** Dato de la tarjeta oscura del ingreso (dos por fila; los anchos ocupan la fila completa). */
function HeroFact({ icon, label, value, tone, wide = false }: { icon: IconName; label: string; value: string; tone?: string; wide?: boolean }) {
  return <View style={[styles.heroFact, wide && styles.heroFactWide]}>
    <Ionicons name={icon} size={14} color={palette.onDark} accessible={false} />
    <View style={styles.heroFactText}>
      <Text style={styles.heroFactLabel}>{label}</Text>
      <Text style={[styles.heroFactValue, tone ? { color: tone } : null]} numberOfLines={2}>{value}</Text>
    </View>
  </View>;
}

/** Lo que se muestra mientras llega la ficha: los datos del tablero. */
function headerOf(entry: WorkshopEntry, area: WorkshopArea, detail: WorkshopEntryDetail | null) {
  return {
    title: detail?.title ?? entry.title, equipmentLabel: detail?.equipmentLabel ?? entry.equipmentLabel, equipmentCode: detail?.equipmentCode ?? entry.equipmentCode,
    imageUrl: detail?.imageUrl ?? entry.imageUrl, statusKey: detail?.statusKey ?? entry.statusKey, statusColor: detail?.statusColor ?? entry.statusColor,
    subStatusName: detail?.subStatusName ?? entry.subStatusName, customerName: detail?.customerName ?? entry.customerName,
    isInternalEntry: detail?.isInternalEntry ?? entry.isInternalEntry, areaTitle: detail?.areaTitle ?? area.title,
    estimatedDeliveryAt: detail ? detail.estimatedDeliveryAt : entry.estimatedDeliveryAt,
    pendingReception: detail ? !detail.reception.signed : entry.isReceptionPending, delivered: detail?.delivery != null
  };
}

/** Ficha del ingreso abierta desde el tablero. Atrás (botón o el del teléfono) vuelve al tablero. */
export function WorkshopEntryScreen({ query, workLayout, onWorkLayout, workCard, rememberedTab, onTabChange, entry, area, onBack, load, onEditIntake, onOpenInspection, onSign, onAddWork, onAddMaintenance, onOpenWork, onOpenOrder, works, orders, onDeliver, manage, workshopId, initialNotice, onOpenFiles, onOpenComments, orderDrive, orderThread }: {
  onOpenOrder?: (orderId: number, entryCode: string) => void;
  /** Archivos y comentarios de una OT del ingreso (null si no están disponibles): se abren en una ventana desde su tarjeta. */
  orderDrive?: (orderId: number) => DriveApi | null; orderThread?: (orderId: number) => ThreadApi | null;
  /** Archivos con carpetas del ingreso (mismo gestor de la web). */
  onOpenFiles?: () => void;
  /** Comentarios del ingreso como chat (los mismos de la web). */
  onOpenComments?: () => void;
  /** Búsqueda del encabezado de la app dentro del ingreso. */
  query?: string;
  /** Vista de los trabajos: compacta o extendida. */
  workLayout?: "compact" | "extended"; onWorkLayout?: (layout: "compact" | "extended") => void;
  /** Última pestaña Trabajos/OTs usada en cada ingreso, para volver a ella. */
  rememberedTab?: (entryId: number) => string | undefined; onTabChange?: (entryId: number, tab: string) => void;
  workCard?: (workId: number) => import("react").ReactNode | null;
  entry: WorkshopEntry; area: WorkshopArea; onBack: () => void; load: (entryId: number) => Promise<WorkshopEntryDetail>; initialNotice?: string;
  onEditIntake: (areaId: number | null, areaTitle: string | null, pending: boolean) => void; onOpenInspection: (kind: InspectionKind) => void; onSign: () => void;
  onAddWork?: (code: string, equipmentLabel: string) => void; onAddMaintenance?: (code: string, equipmentLabel: string) => void; onOpenWork: (workId: number) => Promise<string | null>; works: ReturnType<typeof useWorkshopBoard>["works"];
  orders: ReturnType<typeof useWorkshopBoard>["orders"]; onDeliver: () => void; manage: ReturnType<typeof useWorkshopBoard>["manage"]; workshopId: number | null;
}) {
  // Lo que la sucursal permite hacer desde la app (web «Permisos de la app móvil»).
  const can = {
    entries: useAppPermission("workshopEntries"), inspections: useAppPermission("workshopInspections"), reception: useAppPermission("workshopReception"),
    delivery: useAppPermission("workshopDelivery"), manage: useAppPermission("workshopManage"), works: useAppPermission("workshopWorks"),
    maintenances: useAppPermission("workshopMaintenances"), ordersCreate: useAppPermission("ordersCreate"), ordersSend: useAppPermission("ordersSend"),
    ordersDelete: useAppPermission("ordersDelete"), ordersWorks: useAppPermission("ordersWorks")
  };
  const [heroCollapsed, setHeroCollapsed] = useState(false);
  const [orderSheet, setOrderSheet] = useState<{ kind: "create" } | { kind: "send" | "delete" | "add"; order: WorkshopOrder } | null>(null);
  const [orderNotice, setOrderNotice] = useState("");
  const [orderQuick, setOrderQuick] = useState<{ order: WorkshopOrder; kind: "files" | "comments" } | null>(null);
  const [sentSuccess, setSentSuccess] = useState<{ orderId: number; title: string | null; worksCount: number; created: boolean } | null>(null);
  const orderAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [manageSheet, setManageSheet] = useState<"status" | "move" | "date" | null>(null);
  const [manageNotice, setManageNotice] = useState("");
  const openManage = (sheet: "status" | "move" | "date") => { setManageNotice(""); setManageSheet(sheet); };
  async function managed(notice: string) { setManageSheet(null); setManageNotice(notice); await refresh(); }
  const [linking, setLinking] = useState(false);
  const [linkNotice, setLinkNotice] = useState("");
  const [openingWork, setOpeningWork] = useState<number | null>(null);
  const [workError, setWorkError] = useState(initialNotice ?? "");
  const opening = useRef(false);
  async function openWork(workId: number) {
    if (opening.current) return;
    opening.current = true;
    setOpeningWork(workId); setWorkError("");
    try { const problem = await onOpenWork(workId); if (problem) setWorkError(problem); }
    finally { opening.current = false; setOpeningWork(null); }
  }
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    // Mientras se abre un trabajo no se sale de la ficha: el trabajo se abriría sobre otra pantalla.
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { if (!opening.current) back.current(); return true; });
    return () => subscription.remove();
  }, []);
  const { detail, loading, error, refresh } = useWorkshopEntry(load, entry.id);
  const [refreshing, setRefreshing] = useState(false);
  async function pull() { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }
  const header = headerOf(entry, area, detail);
  const [deliveryBlocked, setDeliveryBlocked] = useState(false);
  const deliveryConditions = detail ? workshopDeliveryConditions(detail) : [];
  const pendingDelivery = deliveryConditions.filter((condition) => !condition.met);
  const overdue = header.estimatedDeliveryAt !== null && !header.delivered && isWorkshopEntryOverdue({ ...entry, estimatedDeliveryAt: header.estimatedDeliveryAt });

  return <View style={styles.screen} pointerEvents={openingWork !== null ? "none" : "auto"}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Volver al taller" onPress={onBack} />
      <View style={styles.barText}>
        <Text style={styles.barCode}>{entry.code}</Text>
        <Text style={styles.barArea} numberOfLines={1}>{header.areaTitle}</Text>
      </View>
      {loading && detail ? <ActivityIndicator size="small" color={palette.primary} accessibilityLabel="Actualizando" /> : null}
      <View style={styles.barEquipment}>
        <Text accessibilityRole="header" style={styles.barEquipmentText} numberOfLines={2}>{header.equipmentLabel}</Text>
        <View style={styles.barPhoto}>
          {header.imageUrl ? <Image source={{ uri: header.imageUrl }} style={styles.barPhotoImage} resizeMode="cover" accessibilityLabel="Foto del equipo" />
            : <Ionicons name="image-outline" size={18} color={palette.textMuted} accessible={false} />}
        </View>
      </View>
    </View>
    <ScrollView contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={palette.primary} colors={[palette.primary]} />}>
      {/* Tarjeta superior oscura (como la del trabajo): estado principal y secundario, equipo y datos clave; se puede minimizar. */}
      <LinearGradient colors={[palette.navy, palette.navyLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroChips}>
            {header.delivered ? <View style={[styles.status, { backgroundColor: palette.success }]}><Text style={styles.statusText}>Entregado</Text></View>
              : header.pendingReception ? <View style={[styles.status, { backgroundColor: palette.orangeSoft }]}><Text style={[styles.statusText, { color: palette.orange }]}>Pendiente por terminar</Text></View>
              : <View style={[styles.status, { backgroundColor: header.statusColor ?? palette.textSecondary }]}><Text style={styles.statusText}>{workshopStatusLabel(header.statusKey)}</Text></View>}
            {header.subStatusName && !header.delivered ? <View style={styles.heroBadge}><Text style={styles.heroBadgeText} numberOfLines={1}>{header.subStatusName}</Text></View> : null}
            {!heroCollapsed && !header.delivered ? <View style={styles.heroChip}><Ionicons name="time-outline" size={12} color={palette.onDark} accessible={false} />
              <Text style={styles.heroChipText}>{entry.daysInArea === 1 ? "1 día en nave" : `${entry.daysInArea} días en nave`}</Text></View> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={heroCollapsed ? "Expandir tarjeta del ingreso" : "Minimizar tarjeta del ingreso"} accessibilityState={{ expanded: !heroCollapsed }}
            hitSlop={10} onPress={() => setHeroCollapsed((value) => !value)} style={({ pressed }) => [styles.heroToggle, pressed && styles.heroPressed]}>
            <Ionicons name={heroCollapsed ? "chevron-down" : "chevron-up"} size={16} color={palette.white} accessible={false} />
          </Pressable>
        </View>
        {header.title ? <Text style={styles.title} numberOfLines={heroCollapsed ? 1 : 2}>{header.title}</Text> : null}
        {/* Minimizada: los datos clave en una línea de etiquetas. */}
        {heroCollapsed ? <View style={styles.heroChips}>
          <View style={styles.heroChip}><Ionicons name="person-outline" size={12} color={palette.onDark} accessible={false} />
            <Text style={styles.heroChipText} numberOfLines={1}>{header.isInternalEntry ? "Equipo propio" : header.customerName ?? "Sin cliente"}</Text></View>
          {header.equipmentCode ? <View style={styles.heroChip}><Ionicons name="barcode-outline" size={12} color={palette.onDark} accessible={false} />
            <Text style={styles.heroChipText} numberOfLines={1}>{header.equipmentCode}</Text></View> : null}
          <View style={styles.heroChip}><Ionicons name="calendar-outline" size={12} color={overdue ? palette.dangerSoft : palette.onDark} accessible={false} />
            <Text style={[styles.heroChipText, overdue ? { color: palette.dangerSoft } : null]} numberOfLines={1}>
              {header.estimatedDeliveryAt ? `Entrega ${longDate(header.estimatedDeliveryAt)}${overdue ? " · atrasado" : ""}` : "Sin fecha de entrega"}</Text></View>
          {!header.delivered ? <View style={styles.heroChip}><Ionicons name="time-outline" size={12} color={palette.onDark} accessible={false} />
            <Text style={styles.heroChipText}>{entry.daysInArea === 1 ? "1 día en nave" : `${entry.daysInArea} días en nave`}</Text></View> : null}
        </View> : <View style={styles.heroGrid}>
          <HeroFact icon="person-outline" label="Cliente" value={header.isInternalEntry ? "Equipo propio" : header.customerName ?? "Sin cliente"} />
          <HeroFact icon="barcode-outline" label="Identificación" value={header.equipmentCode ?? "—"} />
          <HeroFact icon="business-outline" label="Nave" value={header.areaTitle} />
          <HeroFact icon="enter-outline" label="Ingresó" value={detail?.entryAt ? longDate(detail.entryAt) : "—"} />
          <HeroFact icon="calendar-outline" label="Entrega estimada" wide tone={overdue ? palette.dangerSoft : undefined}
            value={header.estimatedDeliveryAt ? `${longDate(header.estimatedDeliveryAt)}${overdue ? " · atrasado" : ""}` : "Sin fecha"} />
          {detail?.notes ? <HeroFact icon="chatbox-ellipses-outline" label="Observaciones" value={detail.notes} wide /> : null}
        </View>}
      </LinearGradient>

      {detail?.delivery ? <DeliveredBanner delivery={detail.delivery} /> : null}
      {error ? <View style={styles.errorBox}>
        <Notice tone="danger" icon="cloud-offline-outline" message={error} />
        <Button title="Reintentar" icon="refresh" variant="secondary" loading={loading} onPress={() => void refresh()} />
      </View> : null}
      {!detail && loading ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.loadingText}>Cargando la ficha…</Text></View> : null}

      {detail ? <>
        {/* Acciones de gestión en una fila compacta; las del ingreso van dentro de su avance. */}
        {!detail.delivery ? <ManageBar
          onStatus={can.manage ? () => openManage("status") : undefined} onMove={can.manage ? () => openManage("move") : undefined} onDate={can.manage ? () => openManage("date") : undefined} /> : null}
        {manageNotice ? <Notice tone="success" icon="checkmark-circle-outline" message={manageNotice} /> : null}
        {onOpenFiles || onOpenComments ? <View style={styles.quickRow}>
          {onOpenFiles ? <Pressable accessibilityRole="button" accessibilityLabel="Archivos del ingreso: fotos y carpetas" onPress={onOpenFiles}
            style={({ pressed }) => [styles.filesCard, pressed && styles.filesCardPressed]}>
            <View style={styles.filesIcon}><Ionicons name="folder-open" size={18} color={palette.amber} accessible={false} /></View>
            <Text style={styles.filesTitle} numberOfLines={1}>Archivos</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} accessible={false} />
          </Pressable> : null}
          {onOpenComments ? <Pressable accessibilityRole="button" accessibilityLabel="Comentarios del ingreso: chat del equipo" onPress={onOpenComments}
            style={({ pressed }) => [styles.filesCard, pressed && styles.filesCardPressed]}>
            <View style={[styles.filesIcon, { backgroundColor: palette.primarySoft }]}><Ionicons name="chatbubbles" size={18} color={palette.primary} accessible={false} /></View>
            <Text style={styles.filesTitle} numberOfLines={1}>Comentarios</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} accessible={false} />
          </Pressable> : null}
        </View> : null}
        <IntakeProgress detail={detail} actions={detail.delivery ? [] : [
          ...(can.entries ? [!detail.reception.signed
            ? { icon: "arrow-forward-circle-outline" as const, label: "Continuar ingreso", onPress: () => onEditIntake(detail.areaId, detail.areaTitle, true), strong: true }
            : { icon: "create-outline" as const, label: "Editar datos", onPress: () => onEditIntake(detail.areaId, detail.areaTitle, false) }] : []),
          ...(can.inspections ? [{ icon: "clipboard-outline" as const, label: detail.inspections.entry ? "Ver inspección" : "Hacer inspección", onPress: () => onOpenInspection("entry") }] : []),
          ...(!detail.reception.signed && can.reception ? [{ icon: "pencil-outline" as const, label: "Firmar", onPress: onSign }] : [])
        ]} />
        {linkNotice ? <Notice tone="success" icon="link-outline" message={linkNotice} /> : null}
        {workError ? <Notice tone="warning" icon="information-circle-outline" message={workError} /> : null}
        {orderNotice ? <Notice tone="success" icon="document-text-outline" message={orderNotice} /> : null}
        <WorkAndOrders query={query} workLayout={workLayout} onWorkLayout={onWorkLayout} detail={detail} workCard={workCard} initialTab={rememberedTab?.(entry.id) as "works" | "orders" | undefined} onTabChange={(tab) => onTabChange?.(entry.id, tab)} onOpenOrder={onOpenOrder ? (order) => onOpenOrder(order.id, detail.code) : undefined}
          onOrderFiles={orderDrive ? (order) => setOrderQuick({ order, kind: "files" }) : undefined} onOrderComments={orderThread ? (order) => setOrderQuick({ order, kind: "comments" }) : undefined} onAddWork={detail.delivery || !onAddWork || !can.works ? undefined : () => onAddWork(detail.code, detail.equipmentLabel)}
          onAddMaintenance={detail.delivery || !detail.isInternalEntry || !onAddMaintenance || !can.maintenances ? undefined : () => onAddMaintenance(detail.code, detail.equipmentLabel)}
          onLinkWorks={detail.delivery || !can.works ? undefined : () => { setLinkNotice(""); setLinking(true); }}
          onOpenWork={(workId) => void openWork(workId)} openingWorkId={openingWork}
          orderActions={detail.delivery || detail.isInternalEntry ? undefined : {
            onCreate: can.ordersCreate ? () => { setOrderNotice(""); setOrderSheet({ kind: "create" }); } : undefined,
            onSend: can.ordersSend ? (order) => { setOrderNotice(""); setOrderSheet({ kind: "send", order }); } : undefined,
            onAddWorks: can.ordersWorks ? (order) => { setOrderNotice(""); setOrderSheet({ kind: "add", order }); } : undefined,
            onDelete: can.ordersDelete ? (order) => { setOrderNotice(""); setOrderSheet({ kind: "delete", order }); } : undefined
          }} />
      </> : null}

    </ScrollView>
    {detail && !detail.delivery && detail.reception.signed && can.delivery ? <View style={styles.footer}>
      <Button title="Entregar equipo" icon="exit-outline" variant="warning"
        onPress={() => { if (pendingDelivery.length === 0) onDeliver(); else setDeliveryBlocked(true); }} />
    </View> : null}
    {deliveryBlocked ? <Modal visible transparent animationType="fade" onRequestClose={() => setDeliveryBlocked(false)}>
      <View style={styles.overlay}>
        <View style={styles.dialog} accessibilityRole="alert">
          <View style={styles.dialogHead}>
            <Ionicons name="alert-circle" size={22} color={palette.orange} accessible={false} />
            <Text style={styles.dialogTitle}>Aún no se puede entregar</Text>
          </View>
          <Text style={styles.dialogText}>{`${deliveryConditions.length - pendingDelivery.length} de ${deliveryConditions.length} condiciones cumplidas`}</Text>
          <View style={styles.flow}>
            {deliveryConditions.map((condition, index) => <View key={condition.id} style={styles.flowStep}
              accessible accessibilityLabel={`${condition.title}: ${condition.met ? "cumplida" : "pendiente"}. ${condition.detail}`}>
              <View style={styles.flowRail}>
                <View style={[styles.flowDot, condition.met ? styles.flowDotMet : styles.flowDotPending]}>
                  <Ionicons name={condition.met ? "checkmark" : "alert"} size={13} color={palette.white} accessible={false} />
                </View>
                {index < deliveryConditions.length - 1 ? <View style={[styles.flowLine, condition.met && styles.flowLineMet]} /> : null}
              </View>
              <View style={[styles.flowBody, !condition.met && styles.flowBodyPending]}>
                <Text style={[styles.dialogItemTitle, condition.met && styles.flowTitleMet]}>{condition.title}</Text>
                <Text style={styles.dialogItemDetail}>{condition.detail}</Text>
              </View>
            </View>)}
          </View>
          <Button title="Entendido" onPress={() => setDeliveryBlocked(false)} />
        </View>
      </View>
    </Modal> : null}
    {orderSheet?.kind === "create" && detail ? <CreateOrderSheet attempt={orderAttempt} looseWorks={detail.works.items.filter((work) => work.loose)} preselected={[]}
      loadRules={() => orders.rules(entry.id)} onClose={() => setOrderSheet(null)}
      onCreate={async (input) => {
        const result = await orders.create(entry.id, input);
        setOrderSheet(null);
        if (result.sent) setSentSuccess({ orderId: result.id, title: input.title, worksCount: input.workIds.length, created: true });
        setOrderNotice(result.sent ? "OT creada y enviada a comercial." : input.sendToCommercial ? "OT creada. No se pudo enviar a comercial: envíala desde la lista." : "OT creada sin enviar a comercial.");
        await refresh();
        return result;
      }} /> : null}
    {orderSheet?.kind === "add" && detail ? <AddWorksSheet code={orderSheet.order.workOrderCode ?? orderSheet.order.code} looseWorks={detail.works.items.filter((work) => work.loose)} onClose={() => setOrderSheet(null)}
      onAdd={async (workIds) => {
        const result = await orders.addWorks(entry.id, orderSheet.order.id, workIds);
        setOrderSheet(null);
        setOrderNotice(`Se agregaron ${result.linked} trabajo(s) a la OT.`);
        await refresh();
      }} /> : null}
    {(orderSheet?.kind === "send" || orderSheet?.kind === "delete") && detail ? <ConfirmOrderSheet order={orderSheet.order} action={orderSheet.kind}
      worksCount={detail.works.items.filter((work) => work.orderId === orderSheet.order.id).length} onClose={() => setOrderSheet(null)}
      onConfirm={async () => {
        if (orderSheet.kind === "send") {
          await orders.send(entry.id, orderSheet.order.id);
          setSentSuccess({ orderId: orderSheet.order.id, title: orderSheet.order.title, worksCount: detail.works.items.filter((work) => work.orderId === orderSheet.order.id).length, created: false });
          setOrderNotice("OT enviada a comercial: quedó pendiente de cotizar.");
        }
        else { const result = await orders.remove(entry.id, orderSheet.order.id); setOrderNotice(`OT eliminada${result.deletedWorks > 0 ? ` junto con ${result.deletedWorks} trabajo(s)` : ""}.`); }
        setOrderSheet(null);
        await refresh();
      }} /> : null}
    {sentSuccess && detail ? (() => {
      const order = detail.orders.items.find((item) => item.id === sentSuccess.orderId);
      return <OrderSentSuccess code={order?.workOrderCode ?? order?.code ?? null} title={sentSuccess.title ?? order?.title ?? null} worksCount={sentSuccess.worksCount} created={sentSuccess.created}
        onDismiss={() => setSentSuccess(null)}
        primary={onOpenOrder ? { label: "Ver la OT", icon: "document-text-outline", onPress: () => { setSentSuccess(null); onOpenOrder(sentSuccess.orderId, detail.code); } }
          : { label: "Listo", icon: "checkmark", onPress: () => setSentSuccess(null) }}
        secondary={onOpenOrder ? { label: "Seguir en el ingreso", icon: "arrow-back", onPress: () => setSentSuccess(null) } : undefined} />;
    })() : null}
    {manageSheet === "status" ? <StatusSheet load={manage.statuses} onClose={() => setManageSheet(null)}
      onSave={async (statusId, subStatusId) => { await manage.status(entry.id, statusId, subStatusId); await managed("Estado actualizado."); }} /> : null}
    {manageSheet === "move" ? <MoveAreaSheet currentAreaId={detail?.areaId ?? area.id} onClose={() => setManageSheet(null)}
      load={() => workshopId === null ? Promise.reject(new Error("Elige un taller en el tablero.")) : manage.areas(workshopId)}
      onMove={async (areaId, note) => { await manage.move(entry.id, areaId, note); await managed("Equipo movido de nave."); }} /> : null}
    {manageSheet === "date" ? <EstimatedDateSheet current={header.estimatedDeliveryAt} scopeKey={String(entry.id)} onClose={() => setManageSheet(null)}
      onSave={async (iso, reason) => { await manage.estimatedDelivery(entry.id, iso, reason); await managed("Fecha de entrega actualizada."); }} /> : null}
    {orderQuick ? (() => {
      const code = orderQuick.order.workOrderCode ?? orderQuick.order.code;
      const drive = orderQuick.kind === "files" ? orderDrive?.(orderQuick.order.id) ?? null : null;
      const thread = orderQuick.kind === "comments" ? orderThread?.(orderQuick.order.id) ?? null : null;
      return drive || thread ? <ResourceSheet sheetKey={`${orderQuick.order.id}:${orderQuick.kind}`} title={orderQuick.kind === "files" ? "Archivos de la OT" : "Comentarios de la OT"}
        subtitle={code} drive={drive} thread={thread} onClose={() => setOrderQuick(null)} /> : null;
    })() : null}
    {linking ? <LinkWorksSheet load={(search) => works.free(entry.id, search)} onClose={() => setLinking(false)}
      onLink={async (workIds) => {
        const result = await works.link(entry.id, workIds);
        setLinking(false);
        setLinkNotice(result.skipped > 0 ? `Se unieron ${result.linked} trabajo(s); ${result.skipped} ya estaban en otro ingreso.` : `Se unieron ${result.linked} trabajo(s) al ingreso.`);
        await refresh();
      }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  quickRow: { flexDirection: "row", gap: 10 },
  // Botones de una línea (icono, nombre y flecha): el nombre nunca se corta en dos renglones.
  filesCard: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingLeft: 10, paddingRight: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, boxShadow: "0px 1px 3px rgba(15,23,42,0.08)" },
  filesCardPressed: { opacity: 0.8, backgroundColor: palette.background },
  filesIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.amberSoft },
  filesTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "800", color: palette.heading },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  barText: { flexShrink: 0, maxWidth: "45%" },
  barEquipment: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  barEquipmentText: { flexShrink: 1, textAlign: "right", fontSize: 12, lineHeight: 16, fontWeight: "800", color: palette.heading },
  barPhoto: { width: 38, height: 38, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  barPhotoImage: { width: 38, height: 38 },
  footer: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(15,23,42,0.55)" },
  dialog: { width: "100%", maxWidth: 420, gap: 10, padding: 16, borderRadius: radius.lg, backgroundColor: palette.surface },
  dialogHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dialogTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: palette.heading },
  dialogText: { ...typography.caption, color: palette.textSecondary },
  dialogItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.orangeSoft },
  flow: { gap: 0 },
  flowStep: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  flowRail: { width: 22, alignItems: "center" },
  flowDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  flowDotMet: { backgroundColor: palette.success },
  flowDotPending: { backgroundColor: palette.orange },
  flowLine: { flex: 1, width: 2, minHeight: 10, backgroundColor: palette.border },
  flowLineMet: { backgroundColor: palette.success },
  flowBody: { flex: 1, minWidth: 0, gap: 2, paddingBottom: 12, paddingTop: 2 },
  flowBodyPending: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, marginBottom: 8, borderRadius: radius.md, backgroundColor: palette.orangeSoft },
  flowTitleMet: { color: palette.success },
  dialogItemText: { flex: 1, minWidth: 0, gap: 2 },
  dialogItemTitle: { fontSize: 13, fontWeight: "800", color: palette.text },
  dialogItemDetail: { ...typography.caption, color: palette.textSecondary },
  barCode: { fontSize: 15, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  barArea: { ...typography.caption, color: palette.textSecondary },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 12, gap: 10, paddingBottom: 24 },
  hero: { gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.lg, overflow: "hidden" },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  heroChips: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  heroBadge: { maxWidth: 180, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  heroBadgeText: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: palette.white },
  heroChip: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.10)" },
  heroChipText: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: "700", color: palette.white },
  heroToggle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  heroPressed: { opacity: 0.7 },
  heroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  heroFact: { flexGrow: 1, flexBasis: "45%", minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.08)" },
  heroFactWide: { flexBasis: "100%" },
  heroFactText: { flex: 1, minWidth: 0 },
  heroFactLabel: { fontSize: 10, lineHeight: 13, fontWeight: "700", color: palette.onDark },
  heroFactValue: { fontSize: 13, lineHeight: 17, fontWeight: "800", color: palette.white },
  status: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 12, fontWeight: "800", color: palette.white },
  subStatus: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  title: { fontSize: 12, lineHeight: 16, color: palette.onDark },
  errorBox: { gap: 10 },
  actions: { gap: 8 },
  loading: { alignItems: "center", gap: 8, paddingVertical: 24 },
  loadingText: { ...typography.caption, color: palette.textSecondary },
  card: { padding: 12, gap: 8, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  factLabel: { width: 118, ...typography.caption, color: palette.textSecondary },
  factValue: { flex: 1, fontSize: 14, fontWeight: "700", color: palette.text }
});
