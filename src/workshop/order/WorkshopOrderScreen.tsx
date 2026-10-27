import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, IconButton, type IconName } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import type { WorkshopOrderDetail, WorkshopOrderGeneralInput, WorkshopOrderItemInput, WorkshopOrderItemSection, WorkshopProductOption, WorkshopTransportOption } from "../../domain/workshopOrders";
import { Notice, WorkLayoutToggle } from "../entry/EntrySections";
import { AddWorksSheet, EditOrderGeneralSheet } from "../orders/OrderSheets";
import { OrderSentSuccess } from "../orders/OrderSentSuccess";
import { useAppPermission } from "../../application/appPermissions";
import { AddOtherSheet, AddProductSheet, AddTransportSheet, EditItemSheet, RemoveWorkSheet } from "./OrderItemSheets";
import type { WorkshopWork } from "../../domain/workshopEntry";
import type { Attachment, LocalPhoto } from "../../domain/models";
import { matchesSearch } from "../../domain/textSearch";
import { OrderHeroCard } from "../../screens/orders/AssignmentOrderCard";
import { FileWorkspace } from "../../screens/workDetail/FileWorkspace";
import { FileDrive } from "../../files/FileDrive";
import { ChatThread } from "../../chat/ChatThread";
import type { ThreadApi } from "../../domain/threads";
import type { DriveApi } from "../../domain/fileDrive";
import { useHeroCollapsed } from "../../ui/heroPreference";
import { PrivateModal as Modal } from "../../security/DeviceSecurityContext";
import { SectionTitle } from "../../ui/components";

export interface OrderItemsApi {
  products: (search: string, page: number) => Promise<{ items: WorkshopProductOption[]; hasMore: boolean }>;
  transports: () => Promise<{ items: WorkshopTransportOption[] }>;
  add: (input: Omit<WorkshopOrderItemInput, "companyBranchId">) => Promise<WorkshopOrderDetail>;
  update: (section: WorkshopOrderItemSection, rowId: number, quantity: number, note?: string | null) => Promise<WorkshopOrderDetail>;
  remove: (section: WorkshopOrderItemSection | "works", rowId: number) => Promise<WorkshopOrderDetail>;
}
type ItemSheet = { kind: "add-product" | "add-transport" | "add-other" }
  | { kind: "edit"; section: WorkshopOrderItemSection; id: number; title: string; quantity: number; unit?: string | null; note?: string | null; noteLabel?: string }
  | { kind: "remove-work"; id: number; title: string };

export type Section = "general" | "works" | "products" | "transports" | "others" | "rentals" | "files" | "comments";

/** Archivos de la OT (los mismos de la web y de Mi jornada). */
export interface OrderFilesApi {
  load: () => Promise<Attachment[]>; upload: (files: LocalPhoto[]) => Promise<void>; remove?: (fileId: string) => Promise<void>;
  mode: "live" | "demo"; scopeKey: string;
  /** Gestor con carpetas (como la web); sin él se usa la lista simple. */
  drive?: DriveApi | null;
}

const TAB_ICONS: Record<Section, IconName> = {
  general: "document-text-outline", works: "construct-outline", products: "cube-outline", transports: "bus-outline",
  others: "pricetags-outline", rentals: "car-sport-outline", files: "folder-open-outline", comments: "chatbubbles-outline"
};

const PRIORITY: Record<string, { label: string; color: string; soft: string }> = {
  high: { label: "Alta", color: palette.danger, soft: palette.dangerSoft },
  medium: { label: "Media", color: palette.orange, soft: palette.orangeSoft },
  low: { label: "Baja", color: palette.success, soft: palette.successSoft }
};
/** Unidades del tipo de cobro del transporte, como el asistente de la web. */
const CHARGE_UNITS: Record<string, string> = { km: "km", hr: "horas", day: "días", month: "meses", year: "años" };

const longDate = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(".", "") : value;
};
const amount = (value: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value);
const minutesLabel = (minutes: number) => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;

function Pill({ label, color, soft }: { label: string; color: string; soft: string }) {
  return <View style={[styles.pill, { backgroundColor: soft, borderColor: color }]}><Text style={[styles.pillText, { color }]} numberOfLines={1}>{label}</Text></View>;
}

function Field({ label, icon, value, children, wide = false }: { label: string; icon: IconName; value?: string | null; children?: ReactNode; wide?: boolean }) {
  return <View style={[styles.field, wide && styles.fieldWide]}>
    <View style={styles.fieldHead}><Ionicons name={icon} size={12} color={palette.textMuted} accessible={false} /><Text style={styles.fieldLabel}>{label}</Text></View>
    {children ?? <Text style={[styles.fieldValue, !value && styles.fieldEmpty]}>{value || "Sin información"}</Text>}
  </View>;
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return <View style={styles.empty}><Ionicons name={icon} size={26} color={palette.textMuted} accessible={false} /><Text style={styles.emptyText}>{text}</Text></View>;
}

function ItemCard({ icon, title, code, subtitle, quantity, meta, onPress }: { icon: IconName; title: string; code?: string | null; subtitle?: string | null; quantity: string; meta?: string | null; onPress?: () => void }) {
  return <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? `Editar ${title}` : undefined} disabled={!onPress} onPress={onPress}
    style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
    <View style={styles.itemIcon}><Ionicons name={icon} size={18} color={palette.primary} accessible={false} /></View>
    <View style={styles.itemBody}>
      {code ? <Text style={styles.itemCode}>{code}</Text> : null}
      <Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
      {subtitle ? <Text style={styles.itemSubtitle} numberOfLines={3}>{subtitle}</Text> : null}
      {meta ? <Text style={styles.itemMeta}>{meta}</Text> : null}
    </View>
    <View style={styles.itemSide}>
      <View style={styles.itemQty}><Text style={styles.itemQtyValue}>{quantity}</Text></View>
      {onPress ? <Ionicons name="create-outline" size={16} color={palette.primary} accessible={false} /> : null}
    </View>
  </Pressable>;
}

/** Detalle de una OT o cotización del ingreso con sus secciones, sin precios (igual que el formulario web de OT). */
export function WorkshopOrderScreen({ entryCode, load, onClose, onOpenWork, openingWorkId = null, notice, onSaveGeneral, onNewWork, looseWorks, onLinkWorks, items, initialSection, onSectionChange, workCard, files, onLocationHistory, workProgress, onSend, query = "", workLayout = "extended", onWorkLayout, comments, onDelete }: {
  /** Eliminar la OT (abre la confirmación, que revisa en el servidor si se puede). */
  onDelete?: () => void;
  /** Comentarios de la OT como chat (los mismos de la web); sin él no hay pestaña. */
  comments?: ThreadApi | null;
  /** Vista de los trabajos: compacta (fila) o extendida (tarjeta de Mi jornada). */
  workLayout?: "compact" | "extended"; onWorkLayout?: (layout: "compact" | "extended") => void;
  /** Búsqueda del encabezado: muestra lo que coincide en todas las secciones de la OT. */
  query?: string;
  files?: OrderFilesApi;
  /** Enviar a comercial una OT que aún no se envía. */
  onSend?: () => Promise<void>;
  onLocationHistory?: () => void;
  /** Avance de los trabajos según Mi jornada (si están ahí). */
  workProgress?: (workIds: number[]) => { completed: number; total: number } | null;
  /** Pestaña con la que abre (la última usada en esta OT) y aviso al cambiarla, para volver a la misma. */
  initialSection?: Section; onSectionChange?: (section: Section) => void;
  /** Tarjeta de Mi jornada del trabajo (iniciar, entregar, archivos…), si existe. */
  workCard?: (workId: number) => ReactNode | null;
  /** Ingreso del Taller; sin él (OT abierta desde Mi jornada) no se muestra. */
  entryCode?: string; load: () => Promise<WorkshopOrderDetail>; onClose: () => void;
  onOpenWork?: (workId: number) => void; openingWorkId?: number | null; notice?: string;
  onSaveGeneral?: (input: Omit<WorkshopOrderGeneralInput, "companyBranchId">) => Promise<WorkshopOrderDetail>;
  /** Crear un trabajo nuevo con el formulario normal de la app; queda dentro de esta OT. */
  onNewWork?: (equipmentLabel: string) => void;
  /** Trabajos sueltos del ingreso y unirlos a esta OT. */
  looseWorks?: () => Promise<WorkshopWork[]>;
  onLinkWorks?: (workIds: number[]) => Promise<number>;
  /** Productos, transporte y otros; quitar trabajos de la OT. */
  items?: OrderItemsApi;
}) {
  const [detail, setDetail] = useState<WorkshopOrderDetail | null>(null);
  const [editing, setEditing] = useState<"general" | null>(null);
  const [linking, setLinking] = useState<WorkshopWork[] | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [sheet, setSheet] = useState<ItemSheet | null>(null);
  // Misma tarjeta oscura y misma preferencia de minimizarla que la OT de Mi jornada.
  const [heroCollapsed, toggleHero] = useHeroCollapsed("order");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentSuccess, setSentSuccess] = useState(false);
  const canSend = useAppPermission("ordersSend");
  async function send() {
    if (!onSend || sending) return;
    setSending(true); setSendError("");
    try {
      await onSend();
      if (!mounted.current) return;
      setSendOpen(false); setSaved("OT enviada a comercial: quedó pendiente de cotizar."); setSentSuccess(true);
      await reload();
    } catch (failure) {
      if (mounted.current) setSendError(failure instanceof Error && failure.message ? failure.message : "No se pudo enviar la OT. Revisa tu conexión.");
    } finally { if (mounted.current) setSending(false); }
  }
  const [filesVisited, setFilesVisited] = useState(initialSection === "files");
  const editable = Boolean(detail?.editable && items);
  // Lo que la sucursal permite gestionar de la OT desde la app (web «Permisos de la app móvil»).
  const can = { general: useAppPermission("ordersGeneral"), works: useAppPermission("ordersWorks"), products: useAppPermission("ordersProducts"),
    transports: useAppPermission("ordersTransports"), others: useAppPermission("ordersOthers") };
  /** Aplica un cambio de ítems: muestra la OT actualizada y un aviso. */
  async function applied(next: Promise<WorkshopOrderDetail>, message: string) {
    const value = await next;
    if (!mounted.current) return;
    setDetail(value); setSheet(null); setSaved(message);
  }
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSectionState] = useState<Section>(initialSection ?? "general");
  const setSection = (next: Section) => { setSectionState(next); if (next === "files") setFilesVisited(true); onSectionChange?.(next); };
  const loadRef = useRef(load);
  loadRef.current = load;
  const mounted = useRef(true);

  async function reload() {
    setError(null);
    try { const next = await loadRef.current(); if (mounted.current) setDetail(next); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error && failure.message ? failure.message : "No se pudo cargar la OT. Revisa tu conexión."); }
  }
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => subscription.remove();
  }, [onClose]);

  const tabs: Array<{ id: Section; label: string; count?: number }> = detail ? [
    { id: "general", label: "Datos" },
    { id: "works", label: "Trabajos", count: detail.works.length },
    // Las secciones que la sucursal no habilitó para la app no se muestran.
    ...(can.products ? [{ id: "products" as const, label: "Productos", count: detail.products.length }] : []),
    ...(can.transports ? [{ id: "transports" as const, label: "Transporte", count: detail.transports.length }] : []),
    ...(can.others ? [{ id: "others" as const, label: "Otros", count: detail.others.length }] : []),
    ...(detail.rentals.length > 0 ? [{ id: "rentals" as const, label: "Arriendos", count: detail.rentals.length }] : []),
    ...(files ? [{ id: "files" as const, label: "Archivos" }] : []),
    ...(comments ? [{ id: "comments" as const, label: "Comentarios" }] : [])
  ] : [];
  // Si la pestaña recordada quedó oculta, se vuelve a «Datos».
  useEffect(() => { if (detail && !tabs.some((tab) => tab.id === section)) setSection("general"); }, [detail, section, can.products, can.transports, can.others]);
  const kind = detail?.kind === "quote" ? "Cotización" : "Orden de trabajo";
  // Búsqueda en toda la OT: cada sección muestra solo lo que coincide y se ocultan las que no tienen resultados.
  const searching = query.trim() !== "" && detail !== null;
  const match = (row: object) => matchesSearch(query, ...Object.values(row).flat());
  const shown = detail && searching ? {
    ...detail,
    works: detail.works.filter(match), products: can.products ? detail.products.filter(match) : [], transports: can.transports ? detail.transports.filter(match) : [],
    others: can.others ? detail.others.filter(match) : [], rentals: detail.rentals.filter(match)
  } : detail;
  const generalMatch = Boolean(detail && searching && matchesSearch(query, ...Object.values(detail.general).flat(), detail.code, detail.workOrderCode, detail.statusLabel));
  const show = (target: "general" | "works" | "products" | "transports" | "others" | "rentals") =>
    !searching ? section === target : target === "general" ? generalMatch : (shown?.[target].length ?? 0) > 0;
  const resultCount = shown && searching ? (generalMatch ? 1 : 0) + shown.works.length + shown.products.length + shown.transports.length + shown.others.length + shown.rentals.length : 0;
  const head = (label: string, count?: number) => searching ? <Text style={styles.resultHead}>{label}{count !== undefined ? ` (${count})` : ""}</Text> : null;
  const statusTone = !detail ? null : !detail.sentToCommercial ? { color: palette.orange, soft: palette.orangeSoft }
    : detail.editable ? { color: palette.info, soft: palette.infoSoft } : { color: palette.success, soft: palette.successSoft };

  return <View style={styles.screen}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Volver al ingreso" onPress={onClose} />
      <View style={styles.barText}>
        <Text style={styles.barTitle} numberOfLines={1}>{detail?.code ?? "Orden de trabajo"}</Text>
        <Text style={styles.barSub} numberOfLines={1}>{kind}{entryCode ? ` · Ingreso ${entryCode}` : ""}</Text>
      </View>
    </View>
    {!detail ? <View style={styles.loading}>
      {error ? <><Notice tone="danger" icon="cloud-offline-outline" message={error} /><Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void reload()} /></>
        : <><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando la OT…</Text></>}
    </View> : <>
      <OrderHeroCard icon={detail.kind === "quote" ? "receipt-outline" : "document-text-outline"} overline={`${kind}${detail.general.businessType ? ` · ${detail.general.businessType}` : ""}`}
        status={{ label: detail.statusLabel, soft: statusTone!.soft, text: statusTone!.color }} title={detail.general.title ?? "Sin título"} collapsed={heroCollapsed} onToggle={toggleHero}
        facts={[
          { label: "Equipo", value: detail.general.equipments.join(" · ") || "Sin equipo" },
          { label: "Cliente", value: detail.general.customerName ?? "Cliente no informado" },
          { label: "Ubicación", value: detail.general.branches[0] ?? "Ubicación no informada", detail: detail.subStatusLabel }
        ]}
        counts={[
          { label: "Trabajos", value: detail.works.length },
          ...(can.products ? [{ label: "Productos", value: detail.products.length }] : []),
          ...(can.transports ? [{ label: "Transporte", value: detail.transports.length }] : []),
          ...(can.others ? [{ label: "Otros", value: detail.others.length }] : [])
        ]}
        progress={workProgress?.(detail.works.map((work) => work.id)) ?? null} />
      {searching ? null : <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Secciones de la OT">
          {tabs.map((tab) => {
            const on = section === tab.id;
            return <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${tab.label}${tab.count !== undefined ? `, ${tab.count}` : ""}`}
              onPress={() => setSection(tab.id)} style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && styles.pressed]}>
              <Ionicons name={TAB_ICONS[tab.id]} size={18} color={on ? palette.primary : palette.textSecondary} accessible={false} />
              <Text numberOfLines={1} style={[styles.tabText, on && styles.tabTextOn]}>{tab.label}{tab.count !== undefined ? ` (${tab.count})` : ""}</Text>
            </Pressable>;
          })}
        </ScrollView>
        <IconButton name="ellipsis-horizontal" label="Opciones de la OT" onPress={() => setMenuOpen(true)} />
      </View>}
      {files && filesVisited ? <View style={[styles.filePanel, (section !== "files" || searching) && styles.hidden]}>
        {files.drive ? <FileDrive embedded api={files.drive} title="Archivos de la OT" subtitle={detail.workOrderCode ?? detail.code} /> : <FileWorkspace compact autoSave scopeKey={`${files.scopeKey}:order-files:${detail.id}`} resourceKey={String(detail.id)} mode={files.mode} readOnly={false}
          title="Archivos de la OT" onLoad={files.load} onUpload={files.upload} onDelete={files.remove} />}
      </View> : null}
      {comments && section === "comments" && !searching ? <View style={styles.filePanel}>
        <ChatThread key={detail.id} embedded api={comments} title="Comentarios de la OT" subtitle={detail.workOrderCode ?? detail.code} draftKey={`order:${detail.id}`} />
      </View> : null}
      {(section === "files" || section === "comments") && !searching ? null : <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reload().finally(() => setRefreshing(false)); }} tintColor={palette.primary} colors={[palette.primary]} />}>
      {notice ? <Notice tone="warning" icon="alert-circle-outline" message={notice} /> : null}
      {!detail.editable && detail.lockedReason ? <Notice tone="info" icon="lock-closed-outline" message={`${detail.lockedReason} Solo se puede ver.`} /> : null}
      {saved ? <Notice tone="success" icon="checkmark-circle-outline" message={saved} /> : null}
      {searching ? <Notice tone="info" icon="search-outline" message={resultCount === 0 ? `Nada en esta OT coincide con «${query.trim()}».` : `Resultados para «${query.trim()}» en toda la OT. Borra la búsqueda para volver a las pestañas.`} /> : null}
      {show("general") ? head("Datos de la OT") : null}
      {show("general") ? <View style={styles.card}>
        {detail.editable && onSaveGeneral && can.general ? <Pressable accessibilityRole="button" accessibilityLabel="Editar datos generales" onPress={() => { setSaved(""); setEditing("general"); }}
          style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
          <Ionicons name="create-outline" size={16} color={palette.primary} accessible={false} /><Text style={styles.editText}>Editar datos generales</Text>
        </Pressable> : null}
        <View style={styles.grid}>
          <Field label="CLIENTE" icon="business-outline" value={detail.general.customerName} />
          <Field label="PRIORIDAD" icon="flag-outline">
            {detail.general.priority ? <Pill {...PRIORITY[detail.general.priority]!} /> : <Text style={[styles.fieldValue, styles.fieldEmpty]}>Sin información</Text>}
          </Field>
          <Field label="FECHA DE SERVICIO" icon="calendar-outline" value={detail.general.serviceDate ? longDate(detail.general.serviceDate) : null} />
          <Field label="CREADA" icon="time-outline" value={detail.general.createdAt ? longDate(detail.general.createdAt) : null} />
          <Field wide label="EQUIPO" icon="construct-outline" value={detail.general.equipments.join(" · ")} />
          <Field wide label="SUCURSALES DEL CLIENTE" icon="location-outline" value={detail.general.branches.join(" · ")} />
          <Field wide label="CONTACTOS" icon="people-outline" value={detail.general.contacts.join(" · ")} />
          {detail.kind === "workOrder" ? <Field wide label="COMERCIAL" icon="paper-plane-outline" value={detail.general.sentAt ? `Enviada el ${longDate(detail.general.sentAt)}` : detail.sentToCommercial ? "Enviada" : "Sin enviar"} /> : null}
          <Field wide label="DESCRIPCIÓN" icon="document-text-outline" value={detail.general.description} />
          <Field wide label="NOTAS INTERNAS" icon="chatbox-ellipses-outline" value={detail.general.internalNotes} />
        </View>
      </View> : null}

      {!searching && section === "works" && detail.editable && can.works && (onNewWork || (looseWorks && onLinkWorks)) ? <View style={styles.actions}>
        {onNewWork ? <Pressable accessibilityRole="button" onPress={() => onNewWork(detail.general.equipments[0] ?? "Equipo del ingreso")} style={({ pressed }) => [styles.action, styles.actionStrong, pressed && styles.pressed]}>
          <Ionicons name="add-circle-outline" size={18} color={palette.white} accessible={false} /><Text style={styles.actionStrongText}>Nuevo trabajo</Text>
        </Pressable> : null}
        {looseWorks && onLinkWorks ? <Pressable accessibilityRole="button" disabled={linkLoading} onPress={() => {
          setLinkLoading(true); setSaved("");
          looseWorks().then((items) => { if (mounted.current) setLinking(items); }, (failure: unknown) => {
            if (mounted.current) setError(failure instanceof Error && failure.message ? failure.message : "No se pudieron cargar los trabajos sueltos.");
          }).finally(() => { if (mounted.current) setLinkLoading(false); });
        }} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          {linkLoading ? <ActivityIndicator size="small" color={palette.primary} /> : <Ionicons name="link-outline" size={18} color={palette.primary} accessible={false} />}
          <Text style={styles.actionText}>Unir trabajos sueltos</Text>
        </Pressable> : null}
      </View> : null}
      {section === "works" && error && detail ? <Notice tone="danger" icon="alert-circle-outline" message={error} /> : null}
      {show("works") ? head("Trabajos", shown!.works.length) : null}
      {!searching && section === "works" && detail.works.length > 0 && onWorkLayout ? <WorkLayoutToggle value={workLayout} onChange={onWorkLayout} /> : null}
      {show("works") ? (shown!.works.length === 0 ?<Empty icon="hammer-outline" text="Esta OT todavía no tiene trabajos." />
        : shown!.works.map((work) => {
          // Si el trabajo está en Mi jornada se usa su misma tarjeta (iniciar, entregar, archivos, checklist, comentarios).
          const card = workLayout === "extended" ? workCard?.(work.id) : null;
          if (card) return <View key={work.id} style={styles.cardWrap}>{card}</View>;
          return <Pressable key={work.id} accessibilityRole="button" accessibilityLabel={`${work.code}, ${work.title}`} disabled={!onOpenWork || openingWorkId !== null}
          onPress={() => onOpenWork?.(work.id)} style={({ pressed }) => [styles.work, pressed && styles.pressed]}>
          <View style={styles.headTop}>
            <Text style={styles.itemCode}>{work.code}</Text>
            {work.priority ? <Pill {...PRIORITY[work.priority]!} /> : null}
            <View style={styles.grow} />
            {editable && can.works ? <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${work.code} de la OT`} hitSlop={8} onPress={() => { setSaved(""); setSheet({ kind: "remove-work", id: work.id, title: `${work.code} · ${work.title}` }); }}
              style={({ pressed }) => [styles.removeWork, pressed && styles.pressed]}><Ionicons name="remove-circle-outline" size={18} color={palette.danger} accessible={false} /></Pressable> : null}
            {openingWorkId === work.id ? <ActivityIndicator size="small" color={palette.primary} /> : onOpenWork ? <Ionicons name="chevron-forward" size={16} color={palette.textMuted} accessible={false} /> : null}
          </View>
          <Text style={styles.itemTitle}>{work.title}</Text>
          {work.summary ? <Text style={styles.itemSubtitle} numberOfLines={3}>{work.summary}</Text> : null}
          <View style={styles.workMeta}>
            {work.specialty ? <View style={styles.metaChip}><Ionicons name="ribbon-outline" size={12} color={palette.textSecondary} accessible={false} /><Text style={styles.metaText}>{work.specialty}</Text></View> : null}
            {work.assignedMinutes ? <View style={styles.metaChip}><Ionicons name="time-outline" size={12} color={palette.textSecondary} accessible={false} /><Text style={styles.metaText}>{minutesLabel(work.assignedMinutes)}</Text></View> : null}
            {work.responsibles.length ? <View style={styles.metaChip}><Ionicons name="person-outline" size={12} color={palette.textSecondary} accessible={false} /><Text style={styles.metaText} numberOfLines={1}>{work.responsibles.join(", ")}</Text></View> : null}
          </View>
        </Pressable>;
        })) : null}

      {!searching && editable && (section === "products" || section === "transports" || section === "others") && can[section] ? <Pressable accessibilityRole="button"
        onPress={() => { setSaved(""); setSheet({ kind: section === "products" ? "add-product" : section === "transports" ? "add-transport" : "add-other" }); }}
        style={({ pressed }) => [styles.action, styles.actionStrong, styles.actionFull, pressed && styles.pressed]}>
        <Ionicons name="add-circle-outline" size={18} color={palette.white} accessible={false} />
        <Text style={styles.actionStrongText}>{section === "products" ? "Agregar producto" : section === "transports" ? "Agregar transporte" : "Agregar otro ítem"}</Text>
      </Pressable> : null}
      {show("products") ? head("Productos", shown!.products.length) : null}
      {show("products") ? (shown!.products.length === 0 ? <Empty icon="cube-outline" text="Esta OT no tiene productos." />
        : shown!.products.map((product) => <ItemCard key={product.id} icon={product.isEquipment ? "car-outline" : "cube-outline"} code={product.code} title={product.name}
          subtitle={product.description} quantity={`${amount(product.quantity)}${product.unit ? ` ${product.unit.toLowerCase()}` : ""}`}
          meta={product.stock !== null ? `Stock disponible: ${amount(product.stock)}` : null}
          onPress={editable && can.products && !product.isEquipment ? () => setSheet({ kind: "edit", section: "products", id: product.id, title: product.name, quantity: product.quantity, unit: product.unit?.toLowerCase() ?? null }) : undefined} />)) : null}

      {show("transports") ? head("Transporte", shown!.transports.length) : null}
      {show("transports") ? (shown!.transports.length === 0 ? <Empty icon="bus-outline" text="Esta OT no tiene transporte." />
        : shown!.transports.map((transport) => <ItemCard key={transport.id} icon="bus-outline" title={transport.name} subtitle={transport.detail}
          quantity={`${amount(transport.quantity)} ${transport.chargeType ? CHARGE_UNITS[transport.chargeType] ?? "unid." : "unid."}`}
          onPress={editable && can.transports ? () => setSheet({ kind: "edit", section: "transports", id: transport.id, title: transport.name, quantity: transport.quantity,
            unit: transport.chargeType ? CHARGE_UNITS[transport.chargeType] ?? null : null, note: transport.detail, noteLabel: "Detalle" }) : undefined} />)) : null}

      {show("others") ? head("Otros", shown!.others.length) : null}
      {show("others") ? (shown!.others.length === 0 ? <Empty icon="ellipsis-horizontal-circle-outline" text="Esta OT no tiene otros ítems." />
        : shown!.others.map((other) => <ItemCard key={other.id} icon="pricetag-outline" title={other.name} subtitle={other.description} quantity={amount(other.quantity)}
          onPress={editable && can.others ? () => setSheet({ kind: "edit", section: "others", id: other.id, title: other.name, quantity: other.quantity, note: other.description, noteLabel: "Descripción" }) : undefined} />)) : null}

      {show("rentals") ? head("Arriendos", shown!.rentals.length) : null}
      {show("rentals") ? shown!.rentals.map((rental) => <ItemCard key={rental.id} icon="car-sport-outline" title={rental.name}
        subtitle={rental.from || rental.to ? `${rental.from ? longDate(rental.from) : "…"} → ${rental.to ? longDate(rental.to) : "…"}` : null} quantity="Arriendo" meta="Solo lectura" />) : null}
    </ScrollView>}
    </>}
    {menuOpen ? <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
      <View style={styles.menuOverlay}><ScrollView style={styles.menu} contentContainerStyle={styles.menuContent} accessibilityViewIsModal>
        <SectionTitle title="Secciones de la OT" />
        {tabs.map((tab) => <Button key={tab.id} title={tab.label} icon={TAB_ICONS[tab.id]} variant={section === tab.id ? "primary" : "secondary"} onPress={() => { setMenuOpen(false); setSection(tab.id); }} />)}
        {onLocationHistory ? <Button title="Mi historial de ubicación" icon="location-outline" variant="secondary" onPress={() => { setMenuOpen(false); onLocationHistory(); }} /> : null}
        {onDelete && detail?.kind === "workOrder" ? <Button title="Eliminar OT" icon="trash-outline" variant="secondary" iconColor={palette.danger} textStyle={{ color: palette.danger }}
          onPress={() => { setMenuOpen(false); onDelete(); }} /> : null}
        <Button title="Cerrar menú" icon="close-outline" variant="ghost" onPress={() => setMenuOpen(false)} />
      </ScrollView></View>
    </Modal> : null}
    {/* OT sin enviar: el envío a comercial queda fijo abajo. */}
    {detail && detail.kind === "workOrder" && !detail.sentToCommercial && onSend && canSend ? <View style={styles.footer}>
      <Button title="Enviar a comercial" icon="paper-plane-outline" variant="warning" onPress={() => { setSendError(""); setSendOpen(true); }} />
    </View> : null}
    {sendOpen && detail ? <Modal visible transparent animationType="fade" onRequestClose={() => { if (!sending) setSendOpen(false); }}>
      <View style={styles.menuOverlay}><View style={[styles.menu, styles.menuContent]} accessibilityViewIsModal>
        <SectionTitle title="¿Enviar la OT a comercial?" subtitle={detail.general.title ?? detail.code} />
        <Text style={styles.hint}>Comercial la revisará y la cotizará. {detail.works.length === 1 ? "Va con 1 trabajo" : `Va con ${detail.works.length} trabajos`}. Después de enviarla ya no se puede eliminar desde la app.</Text>
        {sendError ? <Notice tone="danger" icon="alert-circle-outline" message={sendError} /> : null}
        <Button title="Enviar a comercial" icon="paper-plane-outline" variant="warning" loading={sending} disabled={sending} onPress={() => void send()} />
        <Button title="Cancelar" variant="secondary" disabled={sending} onPress={() => setSendOpen(false)} />
      </View></View>
    </Modal> : null}
    {editing === "general" && detail && onSaveGeneral ? <EditOrderGeneralSheet detail={detail} onClose={() => setEditing(null)} onSave={async (input) => {
      const next = await onSaveGeneral(input);
      if (!mounted.current) return;
      setDetail(next); setEditing(null); setSaved("Datos generales guardados.");
    }} /> : null}
    {sheet?.kind === "add-product" && items ? <AddProductSheet load={items.products} onClose={() => setSheet(null)} onAdd={(input) => applied(items.add(input), "Producto agregado a la OT.")} /> : null}
    {sheet?.kind === "add-transport" && items ? <AddTransportSheet load={items.transports} onClose={() => setSheet(null)} onAdd={(input) => applied(items.add(input), "Transporte agregado a la OT.")} /> : null}
    {sheet?.kind === "add-other" && items ? <AddOtherSheet onClose={() => setSheet(null)} onAdd={(input) => applied(items.add(input), "Ítem agregado a la OT.")} /> : null}
    {sheet?.kind === "edit" && items ? <EditItemSheet title={sheet.title} quantity={sheet.quantity} integer={sheet.section === "products"} unit={sheet.unit} note={sheet.note} noteLabel={sheet.noteLabel}
      onClose={() => setSheet(null)} onSave={(quantity, note) => applied(items.update(sheet.section, sheet.id, quantity, note), "Cambios guardados.")}
      onRemove={() => applied(items.remove(sheet.section, sheet.id), "Ítem quitado de la OT.")} /> : null}
    {sheet?.kind === "remove-work" && items ? <RemoveWorkSheet title={sheet.title} onClose={() => setSheet(null)} onRemove={() => applied(items.remove("works", sheet.id), "El trabajo quedó suelto en el ingreso.")} /> : null}
    {sentSuccess && detail ? <OrderSentSuccess code={detail.workOrderCode ?? detail.code} title={detail.general.title ?? null} worksCount={detail.works.length} created={false}
      onDismiss={() => setSentSuccess(false)}
      primary={{ label: "Ver la OT", icon: "document-text-outline", onPress: () => setSentSuccess(false) }}
      secondary={{ label: "Volver al ingreso", icon: "arrow-back", onPress: () => { setSentSuccess(false); onClose(); } }} /> : null}
    {linking && detail && onLinkWorks ? <AddWorksSheet code={detail.code} looseWorks={linking} onClose={() => setLinking(null)} onAdd={async (workIds) => {
      const linked = await onLinkWorks(workIds);
      if (!mounted.current) return;
      setLinking(null); setSaved(`Se agregaron ${linked} trabajo(s) a la OT.`);
      await reload();
    }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  barSub: { ...typography.caption, color: palette.textSecondary },
  loading: { alignItems: "center", gap: 10, padding: 32 },
  hint: { ...typography.caption, color: palette.textSecondary },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 12, paddingBottom: 40 },
  head: { gap: 7, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, ...theme.shadow },
  headTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  grow: { flex: 1 },
  codePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: palette.primarySoft, flexShrink: 1 },
  code: { fontSize: 13, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  pill: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, maxWidth: 200 },
  pillText: { fontSize: 11, fontWeight: "800" },
  kindRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  kindText: { fontSize: 12, color: palette.textSecondary, flexShrink: 1 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "800", color: palette.heading, letterSpacing: 0.2 },
  tabsContainer: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: palette.border },
  tabsScroll: { flex: 1, minWidth: 0 },
  tabs: { flexGrow: 1, flexDirection: "row" },
  tab: { flexGrow: 1, minHeight: 48, minWidth: 68, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 4, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabOn: { backgroundColor: palette.primarySoft, borderBottomColor: palette.primary, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  tabText: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: palette.textSecondary },
  tabTextOn: { color: palette.primary, fontWeight: "800" },
  scroll: { flex: 1 },
  resultHead: { marginTop: 4, fontSize: 12, fontWeight: "800", letterSpacing: 0.4, color: palette.textSecondary, textTransform: "uppercase" },
  footer: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface },
  filePanel: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  menuOverlay: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(18,44,58,0.65)" },
  menu: { width: "100%", maxWidth: 440, maxHeight: "90%", flexGrow: 0, alignSelf: "center", borderRadius: 8, backgroundColor: palette.surface },
  menuContent: { padding: 20, gap: 12 },
  tabCount: { minWidth: 22, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 10, alignItems: "center", backgroundColor: palette.primarySoft },
  tabCountOn: { backgroundColor: palette.primary },
  tabCountText: { fontSize: 11, lineHeight: 15, fontWeight: "700", color: palette.primary, fontVariant: ["tabular-nums"] },
  tabCountTextOn: { color: palette.white },
  card: { gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  actions: { flexDirection: "row", gap: 8 },
  actionFull: { flex: 0 },
  cardWrap: { gap: 6 },
  removeWork: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  itemSide: { alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  actionStrong: { backgroundColor: palette.primary, borderColor: palette.primary },
  actionText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  actionStrongText: { fontSize: 13, fontWeight: "800", color: palette.white },
  editButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  editText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { flexGrow: 1, flexBasis: "45%", minWidth: 0, gap: 3, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: palette.background },
  fieldWide: { flexBasis: "100%" },
  fieldHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  fieldLabel: { fontSize: 10, fontWeight: "800", color: palette.textMuted, letterSpacing: 0.5 },
  fieldValue: { fontSize: 14, lineHeight: 19, fontWeight: "700", color: palette.heading },
  fieldEmpty: { color: palette.textMuted, fontWeight: "500" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  emptyText: { ...typography.caption, color: palette.textSecondary },
  item: { flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  itemIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  itemBody: { flex: 1, minWidth: 0, gap: 2 },
  itemCode: { fontSize: 11, fontWeight: "800", color: palette.primary, fontVariant: ["tabular-nums"] },
  itemTitle: { fontSize: 14, lineHeight: 19, fontWeight: "800", color: palette.heading },
  itemSubtitle: { fontSize: 12, lineHeight: 17, color: palette.textSecondary },
  itemMeta: { fontSize: 11, fontWeight: "700", color: palette.textMuted, marginTop: 2 },
  itemQty: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  itemQtyValue: { fontSize: 12, fontWeight: "800", color: palette.heading, fontVariant: ["tabular-nums"] },
  work: { gap: 6, padding: 12, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  workMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: palette.background },
  metaText: { fontSize: 11, fontWeight: "700", color: palette.textSecondary, flexShrink: 1 },
  pressed: { opacity: 0.85 }
});
