import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, BackHandler, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, IconButton, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import { isWorkshopEntryOverdue, workshopStatusLabel, type WorkshopArea, type WorkshopEntry } from "../domain/workshopBoard";
import { workshopDeliveryConditions, type WorkshopEntryDetail } from "../domain/workshopEntry";
import type { InspectionKind } from "../domain/workshopInspection";
import { useWorkshopEntry } from "./useWorkshopEntry";
import { DeliveredBanner, DeliveryConditions, IntakeProgress, Notice, WorkAndOrders } from "./entry/EntrySections";
import { LinkWorksSheet } from "./works/LinkWorksSheet";
import { AddWorksSheet, ConfirmOrderSheet, CreateOrderSheet } from "./orders/OrderSheets";
import type { WorkshopOrder } from "../domain/workshopEntry";
import { EstimatedDateSheet, ManageBar, MoveAreaSheet, StatusSheet } from "./manage/ManageSheets";
import type { useWorkshopBoard } from "./useWorkshopBoard";

const longDate = (iso: string) => new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

function Fact({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone?: string }) {
  return <View style={styles.fact}>
    <Ionicons name={icon} size={16} color={palette.textSecondary} accessible={false} />
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={[styles.factValue, tone ? { color: tone } : null]} numberOfLines={3}>{value}</Text>
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
export function WorkshopEntryScreen({ entry, area, onBack, load, onEditIntake, onOpenInspection, onSign, onAddWork, onAddMaintenance, onOpenWork, works, orders, onDeliver, manage, workshopId, initialNotice }: {
  entry: WorkshopEntry; area: WorkshopArea; onBack: () => void; load: (entryId: number) => Promise<WorkshopEntryDetail>; initialNotice?: string;
  onEditIntake: (areaId: number | null, areaTitle: string | null, pending: boolean) => void; onOpenInspection: (kind: InspectionKind) => void; onSign: () => void;
  onAddWork?: (code: string, equipmentLabel: string) => void; onAddMaintenance?: (code: string, equipmentLabel: string) => void; onOpenWork: (workId: number) => Promise<string | null>; works: ReturnType<typeof useWorkshopBoard>["works"];
  orders: ReturnType<typeof useWorkshopBoard>["orders"]; onDeliver: () => void; manage: ReturnType<typeof useWorkshopBoard>["manage"]; workshopId: number | null;
}) {
  const [orderSheet, setOrderSheet] = useState<{ kind: "create" } | { kind: "send" | "delete" | "add"; order: WorkshopOrder } | null>(null);
  const [orderNotice, setOrderNotice] = useState("");
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
  const overdue = header.estimatedDeliveryAt !== null && !header.delivered && isWorkshopEntryOverdue({ ...entry, estimatedDeliveryAt: header.estimatedDeliveryAt });

  return <View style={styles.screen} pointerEvents={openingWork !== null ? "none" : "auto"}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Volver al taller" onPress={onBack} />
      <View style={styles.barText}>
        <Text style={styles.barCode}>{entry.code}</Text>
        <Text style={styles.barArea} numberOfLines={1}>{header.areaTitle}</Text>
      </View>
      {loading && detail ? <ActivityIndicator size="small" color={palette.primary} accessibilityLabel="Actualizando" /> : null}
    </View>
    <ScrollView contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={palette.primary} colors={[palette.primary]} />}>
      <View style={styles.hero}>
        <View style={styles.photo}>
          {header.imageUrl ? <Image source={{ uri: header.imageUrl }} style={styles.photoImage} resizeMode="cover" accessibilityLabel="Foto del equipo" />
            : <Ionicons name="image-outline" size={34} color={palette.textMuted} accessible={false} />}
        </View>
        <View style={styles.heroBody}>
          {header.delivered ? <View style={[styles.status, { backgroundColor: palette.success }]}><Text style={styles.statusText}>Entregado</Text></View>
            : header.pendingReception ? <View style={[styles.status, { backgroundColor: palette.orangeSoft }]}><Text style={[styles.statusText, { color: palette.orange }]}>Pendiente por terminar</Text></View>
            : <View style={[styles.status, { backgroundColor: header.statusColor ?? palette.textSecondary }]}><Text style={styles.statusText}>{workshopStatusLabel(header.statusKey)}</Text></View>}
          {header.subStatusName && !header.delivered ? <Text style={styles.subStatus}>{header.subStatusName}</Text> : null}
          <Text accessibilityRole="header" style={styles.equipment}>{header.equipmentLabel}</Text>
          {header.title ? <Text style={styles.title} numberOfLines={3}>{header.title}</Text> : null}
        </View>
      </View>

      {detail?.delivery ? <DeliveredBanner delivery={detail.delivery} /> : null}
      {error ? <View style={styles.errorBox}>
        <Notice tone="danger" icon="cloud-offline-outline" message={error} />
        <Button title="Reintentar" icon="refresh" variant="secondary" loading={loading} onPress={() => void refresh()} />
      </View> : null}
      {!detail && loading ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.loadingText}>Cargando la ficha…</Text></View> : null}

      {detail ? <>
        {!detail.delivery ? <View style={styles.actions}>
          {!detail.reception.signed ? <Button title="Continuar ingreso" icon="arrow-forward-circle-outline" onPress={() => onEditIntake(detail.areaId, detail.areaTitle, true)} />
            : <Button title="Editar datos del ingreso" icon="create-outline" variant="secondary" onPress={() => onEditIntake(detail.areaId, detail.areaTitle, false)} />}
          <Button title={detail.inspections.entry ? `Inspección de ingreso · ${detail.inspections.entry.percentage}%` : "Inspección de ingreso"} icon="clipboard-outline"
            variant="secondary" onPress={() => onOpenInspection("entry")} />
          {!detail.reception.signed ? <Button title="Firmar recepción" icon="create-outline" variant="secondary" onPress={onSign} /> : null}
        </View> : null}
        {!detail.delivery ? <ManageBar onStatus={() => openManage("status")} onMove={() => openManage("move")} onDate={() => openManage("date")} /> : null}
        {manageNotice ? <Notice tone="success" icon="checkmark-circle-outline" message={manageNotice} /> : null}
        <IntakeProgress detail={detail} />
        {!detail.delivery ? <DeliveryConditions conditions={workshopDeliveryConditions(detail)} /> : null}
        {!detail.delivery && detail.reception.signed ? <Button title={workshopDeliveryConditions(detail).every((condition) => condition.met) ? "Entregar equipo" : "Entregar equipo (ver qué falta)"}
          icon="exit-outline" variant={workshopDeliveryConditions(detail).every((condition) => condition.met) ? "primary" : "secondary"} onPress={onDeliver} /> : null}
        {linkNotice ? <Notice tone="success" icon="link-outline" message={linkNotice} /> : null}
        {workError ? <Notice tone="warning" icon="information-circle-outline" message={workError} /> : null}
        {orderNotice ? <Notice tone="success" icon="document-text-outline" message={orderNotice} /> : null}
        <WorkAndOrders detail={detail} onAddWork={detail.delivery || !onAddWork ? undefined : () => onAddWork(detail.code, detail.equipmentLabel)}
          onAddMaintenance={detail.delivery || !detail.isInternalEntry || !onAddMaintenance ? undefined : () => onAddMaintenance(detail.code, detail.equipmentLabel)}
          onLinkWorks={detail.delivery ? undefined : () => { setLinkNotice(""); setLinking(true); }}
          onOpenWork={(workId) => void openWork(workId)} openingWorkId={openingWork}
          orderActions={detail.delivery || detail.isInternalEntry ? undefined : {
            onCreate: () => { setOrderNotice(""); setOrderSheet({ kind: "create" }); },
            onSend: (order) => { setOrderNotice(""); setOrderSheet({ kind: "send", order }); },
            onAddWorks: (order) => { setOrderNotice(""); setOrderSheet({ kind: "add", order }); },
            onDelete: (order) => { setOrderNotice(""); setOrderSheet({ kind: "delete", order }); }
          }} />
      </> : null}

      <View style={styles.card}>
        <Fact icon="person-outline" label="Cliente" value={header.isInternalEntry ? "Equipo propio" : header.customerName ?? "Sin cliente"} />
        {header.equipmentCode ? <Fact icon="barcode-outline" label="Identificación" value={header.equipmentCode} /> : null}
        <Fact icon="business-outline" label="Nave" value={header.areaTitle} />
        {detail?.entryAt ? <Fact icon="enter-outline" label="Ingresó" value={longDate(detail.entryAt)} /> : null}
        <Fact icon="calendar-outline" label="Entrega estimada" value={header.estimatedDeliveryAt ? `${longDate(header.estimatedDeliveryAt)}${overdue ? " · atrasado" : ""}` : "Sin fecha"}
          tone={overdue ? palette.danger : undefined} />
        {detail?.notes ? <Fact icon="chatbox-ellipses-outline" label="Observaciones" value={detail.notes} /> : null}
      </View>
    </ScrollView>
    {orderSheet?.kind === "create" && detail ? <CreateOrderSheet attempt={orderAttempt} looseWorks={detail.works.items.filter((work) => work.loose)} preselected={[]}
      loadRules={() => orders.rules(entry.id)} onClose={() => setOrderSheet(null)}
      onCreate={async (input) => {
        const result = await orders.create(entry.id, input);
        setOrderSheet(null);
        setOrderNotice(result.sent ? "OT creada y enviada a comercial." : input.sendToCommercial ? "OT creada. No se pudo enviar a comercial: envíala desde la lista." : "OT creada sin enviar a comercial.");
        await refresh();
        return result;
      }} /> : null}
    {orderSheet?.kind === "add" && detail ? <AddWorksSheet order={orderSheet.order} looseWorks={detail.works.items.filter((work) => work.loose)} onClose={() => setOrderSheet(null)}
      onAdd={async (workIds) => {
        const result = await orders.addWorks(entry.id, orderSheet.order.id, workIds);
        setOrderSheet(null);
        setOrderNotice(`Se agregaron ${result.linked} trabajo(s) a la OT.`);
        await refresh();
      }} /> : null}
    {(orderSheet?.kind === "send" || orderSheet?.kind === "delete") && detail ? <ConfirmOrderSheet order={orderSheet.order} action={orderSheet.kind}
      worksCount={detail.works.items.filter((work) => work.orderId === orderSheet.order.id).length} onClose={() => setOrderSheet(null)}
      onConfirm={async () => {
        if (orderSheet.kind === "send") { await orders.send(entry.id, orderSheet.order.id); setOrderNotice("OT enviada a comercial: quedó pendiente de cotizar."); }
        else { const result = await orders.remove(entry.id, orderSheet.order.id); setOrderNotice(`OT eliminada${result.deletedWorks > 0 ? ` junto con ${result.deletedWorks} trabajo(s)` : ""}.`); }
        setOrderSheet(null);
        await refresh();
      }} /> : null}
    {manageSheet === "status" ? <StatusSheet load={manage.statuses} onClose={() => setManageSheet(null)}
      onSave={async (statusId, subStatusId) => { await manage.status(entry.id, statusId, subStatusId); await managed("Estado actualizado."); }} /> : null}
    {manageSheet === "move" ? <MoveAreaSheet currentAreaId={detail?.areaId ?? area.id} onClose={() => setManageSheet(null)}
      load={() => workshopId === null ? Promise.reject(new Error("Elige un taller en el tablero.")) : manage.areas(workshopId)}
      onMove={async (areaId, note) => { await manage.move(entry.id, areaId, note); await managed("Equipo movido de nave."); }} /> : null}
    {manageSheet === "date" ? <EstimatedDateSheet current={header.estimatedDeliveryAt} scopeKey={String(entry.id)} onClose={() => setManageSheet(null)}
      onSave={async (iso, reason) => { await manage.estimatedDelivery(entry.id, iso, reason); await managed("Fecha de entrega actualizada."); }} /> : null}
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
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barCode: { fontSize: 15, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  barArea: { ...typography.caption, color: palette.textSecondary },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 28 },
  hero: { flexDirection: "row", gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, ...theme.shadow },
  photo: { width: 84, height: 84, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  photoImage: { width: 84, height: 84 },
  heroBody: { flex: 1, minWidth: 0, gap: 5, alignItems: "flex-start" },
  status: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 12, fontWeight: "800", color: palette.white },
  subStatus: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  equipment: { fontSize: 16, lineHeight: 21, fontWeight: "800", color: palette.heading },
  title: { ...typography.caption, color: palette.text },
  errorBox: { gap: 10 },
  actions: { gap: 8 },
  loading: { alignItems: "center", gap: 8, paddingVertical: 24 },
  loadingText: { ...typography.caption, color: palette.textSecondary },
  card: { padding: 14, gap: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  factLabel: { width: 118, ...typography.caption, color: palette.textSecondary },
  factValue: { flex: 1, fontSize: 14, fontWeight: "700", color: palette.text }
});
