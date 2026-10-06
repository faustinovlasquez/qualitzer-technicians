import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, IconButton, type IconName } from "../ui/components";
import { palette, radius, theme, typography } from "../ui/theme";
import type { MaterialDisposition, MaterialReceipt } from "../domain/materialReceipts";
import type { useMaterialReceipts } from "./useMaterialReceipts";
import { dispositionDaysLeft, filterReceipts, productDispositionState, receiptDateTime, receiptMoney, receiptQuantity, receiptRelative, receiptSourceIcon,
  receiptWarehouses, type ProductDispositionState, type ReceiptSourceFilter } from "./receiptTimeline";

type ReceiptModel = ReturnType<typeof useMaterialReceipts>;
type Product = MaterialReceipt["products"][number];
type Tab = "pending" | "confirmed";
const nativeDriver = Platform.OS !== "web";
const VISIBLE_PRODUCTS = 3;
const sourceFilters: Array<{ id: ReceiptSourceFilter; label: string }> = [
  { id: "ALL", label: "Todas" }, { id: "WORK_ORDER", label: "OT" }, { id: "MAINTENANCE", label: "Mantenimiento" }, { id: "OTHER", label: "Otras" },
];
const dispositionLook: { [K in ProductDispositionState]: { label: string; icon: IconName; color: string; soft: string } } = {
  USED: { label: "Utilizado", icon: "checkmark-circle", color: palette.success, soft: palette.successSoft },
  AUTO_USED: { label: "Utilizado (automático)", icon: "time", color: palette.success, soft: palette.successSoft },
  RETURN_REQUESTED: { label: "Devolución solicitada", icon: "return-down-back", color: palette.orange, soft: palette.orangeSoft },
  RETURNED: { label: "Devuelto a bodega", icon: "archive", color: palette.info, soft: palette.infoSoft },
  OPEN: { label: "Sin marcar", icon: "ellipse-outline", color: palette.textMuted, soft: palette.track },
};

/** Aparece con un desplazamiento suave. */
function FadeIn({ index, children }: { index: number; children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 280, delay: Math.min(index, 8) * 40, useNativeDriver: nativeDriver }).start();
  }, [progress, index]);
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>{children}</Animated.View>;
}

function Alert({ tone, icon, title, message, action }: { tone: "danger" | "warning" | "info"; icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const color = tone === "danger" ? palette.danger : tone === "warning" ? palette.amber : palette.info;
  const soft = tone === "danger" ? palette.dangerSoft : tone === "warning" ? palette.amberSoft : palette.infoSoft;
  return <View accessibilityRole={tone === "info" ? undefined : "alert"} style={[styles.alert, { backgroundColor: soft, borderColor: color }]}>
    <Ionicons name={icon} size={20} color={color} accessible={false} />
    <View style={styles.alertText}><Text style={[styles.alertTitle, { color }]}>{title}</Text>{message ? <Text style={styles.alertMessage}>{message}</Text> : null}{action}</View>
  </View>;
}

function Pill({ icon, label, color, soft }: { icon: IconName; label: string; color: string; soft: string }) {
  return <View style={[styles.pill, { backgroundColor: soft }]}><Ionicons name={icon} size={13} color={color} accessible={false} /><Text style={[styles.pillText, { color }]}>{label}</Text></View>;
}

function Detail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <View style={styles.detail}>
    <Ionicons name={icon} size={15} color={palette.textMuted} accessible={false} />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
  </View>;
}

function ProductThumb({ uri }: { uri: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) return <Image source={{ uri }} style={styles.thumb} resizeMode="cover" onError={() => setFailed(true)} accessible={false} />;
  return <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="cube-outline" size={20} color={palette.primary} accessible={false} /></View>;
}

function ProductRow({ product, divider, leading, footer }: { product: Product; divider: boolean; leading?: ReactNode; footer?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const price = receiptMoney(product.unitCost, product.currencyIso);
  const long = (product.description?.length ?? 0) > 90;
  return <View style={[styles.product, divider && styles.productDivider]}>
    <View style={styles.productMain}>
      {leading}
      <ProductThumb uri={product.imageUrl} />
      <View style={styles.productText}>
        {product.code ? <Text style={styles.productCode}>{product.code}</Text> : null}
        <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        {product.description ? <Text style={styles.productDescription} numberOfLines={expanded ? undefined : 2}>{product.description}</Text> : null}
        {long ? <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setExpanded(value => !value)}>
          <Text style={styles.readMore}>{expanded ? "Leer menos" : "Leer más"}</Text>
        </Pressable> : null}
        {price ? <Text style={styles.price}>{`${price} c/u`}</Text> : null}
      </View>
      <View style={styles.quantity}><Text style={styles.quantityText}>{receiptQuantity(product.quantity, product.unit)}</Text></View>
    </View>
    {footer}
  </View>;
}

function Checkbox({ checked, label, disabled, onPress }: { checked: boolean; label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} hitSlop={10} onPress={onPress}
    style={[styles.checkbox, checked && styles.checkboxOn]}>
    {checked ? <Ionicons name="checkmark" size={16} color={palette.white} accessible={false} /> : null}
  </Pressable>;
}

function CardHeader({ item, expanded, pill, onToggle }: { item: MaterialReceipt; expanded: boolean; pill: ReactNode; onToggle: () => void }) {
  const date = item.requestedAt ?? item.deliveredAt;
  const parsed = date ? new Date(date) : null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Entrega ${item.code}`} accessibilityState={{ expanded }} onPress={onToggle} style={styles.cardHeader}>
    <View style={styles.cardTop}>{pill}<Text style={styles.code}>{item.code}</Text><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={palette.textMuted} accessible={false} /></View>
    <View style={styles.when}>
      <Ionicons name="calendar-outline" size={13} color={palette.textMuted} accessible={false} />
      <Text style={styles.whenText}>{receiptDateTime(date)}</Text>
      <Text style={styles.whenDot}>·</Text>
      <Text style={styles.whenText}>{receiptRelative(parsed && !Number.isNaN(parsed.getTime()) ? parsed : null, new Date())}</Text>
    </View>
    <View style={styles.source}>
      <View style={styles.sourceIcon}><Ionicons name={receiptSourceIcon(item.sourceType)} size={18} color={palette.primary} accessible={false} /></View>
      <View style={styles.sourceText}>
        <Text style={styles.sourceCode} numberOfLines={1}>{item.sourceCode || item.sourceLabel || "Entrega de inventario"}</Text>
        {item.equipmentLabel ? <Text style={styles.sourceSub} numberOfLines={2}>{item.equipmentLabel}</Text>
          : item.sourceCode && item.sourceLabel ? <Text style={styles.sourceSub} numberOfLines={2}>{item.sourceLabel}</Text> : null}
      </View>
    </View>
  </Pressable>;
}

function CardDetails({ item }: { item: MaterialReceipt }) {
  return <>
    <View style={styles.details}>
      {item.requestedByName ? <Detail icon="person-circle-outline" label="Entrega" value={item.requestedByName} /> : null}
      {item.warehouseName ? <Detail icon="business-outline" label="Bodega" value={item.warehouseName} /> : null}
      {item.destination ? <Detail icon="location-outline" label="Destino" value={item.destination} /> : null}
      {item.customerName ? <Detail icon="briefcase-outline" label="Cliente" value={item.customerName} /> : null}
      {item.reasonLabel ? <Detail icon="pricetag-outline" label="Motivo" value={item.reasonLabel} /> : null}
    </View>
    {item.notes ? <View style={styles.notes}><Ionicons name="chatbubble-ellipses-outline" size={15} color={palette.textSecondary} accessible={false} />
      <View style={styles.notesBody}><Text style={styles.notesLabel}>Nota</Text><Text style={styles.notesText}>{item.notes}</Text></View></View> : null}
  </>;
}

function ProductsHeader({ count, extra }: { count: number; extra?: ReactNode }) {
  return <View style={styles.productsHeader}>
    <Ionicons name="cube-outline" size={16} color={palette.primary} accessible={false} />
    <Text style={styles.productsTitle}>{count === 1 ? "1 material" : `${count} materiales`}</Text>
    <View style={styles.flex} />
    {extra}
  </View>;
}

function MoreProducts({ hidden, showAll, onPress }: { hidden: number; showAll: boolean; onPress: () => void }) {
  if (hidden <= 0) return null;
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.more}>
    <Text style={styles.moreText}>{showAll ? "Ver menos" : hidden === 1 ? "Ver 1 material más" : `Ver ${hidden} materiales más`}</Text>
    <Ionicons name={showAll ? "chevron-up" : "chevron-down"} size={15} color={palette.primary} accessible={false} />
  </Pressable>;
}

function PendingCard({ item, expanded, disabled, busy, onToggle, onConfirm }: { item: MaterialReceipt; expanded: boolean; disabled: boolean; busy: boolean; onToggle: () => void; onConfirm: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [asking, setAsking] = useState(false);
  const incident = item.receiptStatus === "INCIDENT";
  const total = item.products.length;
  const allSelected = total > 0 && selected.size === total;
  const visible = showAll ? item.products : item.products.slice(0, VISIBLE_PRODUCTS);
  const toggle = (id: number) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // La recepción registra la entrega completa; las casillas son la revisión del técnico y solo se pregunta si faltó marcar algo.
  const confirm = () => { if (allSelected || total === 0) onConfirm(); else setAsking(true); };
  return <View style={[styles.card, incident && styles.cardIncident]}>
    <CardHeader item={item} expanded={expanded} onToggle={onToggle}
      pill={incident ? <Pill icon="alert-circle" label="Con incidencia" color={palette.danger} soft={palette.dangerSoft} />
        : <Pill icon="time" label="Por confirmar" color={palette.amber} soft={palette.amberSoft} />} />
    {expanded ? <FadeIn index={0}><View style={styles.cardBody}>
      <CardDetails item={item} />
      {incident ? <Alert tone="danger" icon="warning-outline" title="Entrega con incidencia" message="Revisa los materiales con bodega antes de confirmar." /> : null}
      <View style={styles.productsBox}>
        <ProductsHeader count={total} extra={total > 0 ? <Pressable accessibilityRole="button" hitSlop={8}
          onPress={() => setSelected(allSelected ? new Set() : new Set(item.products.map(product => product.id)))}>
          <Text style={styles.selectedText}>{`Seleccionados ${selected.size}/${total}`}</Text>
        </Pressable> : null} />
        {visible.map((product, index) => <ProductRow key={product.id} product={product} divider={index > 0}
          leading={<Checkbox checked={selected.has(product.id)} label={`Revisado ${product.name}`} disabled={disabled} onPress={() => toggle(product.id)} />} />)}
        <MoreProducts hidden={total - VISIBLE_PRODUCTS} showAll={showAll} onPress={() => setShowAll(value => !value)} />
      </View>
      {asking ? <FadeIn index={0}><View style={styles.ask}>
        <View style={styles.askHead}><Ionicons name="help-circle-outline" size={22} color={palette.primary} accessible={false} />
          <Text style={styles.askTitle}>{`Marcaste ${selected.size} de ${total} materiales`}</Text></View>
        <Text style={styles.askText}>Al confirmar se registra la recepción de la entrega completa con tu usuario, la hora y tu ubicación. Si falta algo, avisa a bodega antes de confirmar.</Text>
        <View style={styles.askActions}>
          <Button title="Revisar" variant="secondary" disabled={busy} onPress={() => setAsking(false)} style={styles.flex} />
          <Button title="Confirmar entrega" icon="checkmark-done-outline" loading={busy} disabled={disabled} onPress={() => { setAsking(false); onConfirm(); }} style={styles.flex} />
        </View>
      </View></FadeIn>
        : <Button title={`Confirmar todo (${total})`} icon="checkmark-done-outline" accessibilityLabel={`Confirmar recepción de ${item.code}`} loading={busy} disabled={disabled} onPress={confirm} />}
    </View></FadeIn> : <View style={styles.collapsedFoot}>
      <Text style={styles.collapsedText}>{total === 1 ? "1 material por confirmar" : `${total} materiales por confirmar`}</Text>
      <Ionicons name="chevron-forward" size={15} color={palette.textMuted} accessible={false} />
    </View>}
  </View>;
}

function ConfirmedCard({ item, expanded, busy, locked, onToggle, onDispose }: { item: MaterialReceipt; expanded: boolean; busy: boolean; locked: boolean; onToggle: () => void;
  onDispose: (lines: Array<{ lineId: number; disposition: MaterialDisposition }>) => void }) {
  const [showAll, setShowAll] = useState(false);
  const closed = item.dispositionClosed === true;
  const supported = item.dispositionDeadline !== undefined;
  const days = dispositionDaysLeft(item.dispositionDeadline);
  const states = item.products.map(product => productDispositionState(product, closed));
  const open = item.products.filter((_product, index) => states[index] === "OPEN");
  const requested = states.filter(state => state === "RETURN_REQUESTED").length;
  const visible = showAll ? item.products : item.products.slice(0, VISIBLE_PRODUCTS);
  const editable = supported && !closed;
  const pill = requested > 0 ? <Pill icon="return-down-back" label="Devolución solicitada" color={palette.orange} soft={palette.orangeSoft} />
    : <Pill icon="checkmark-circle" label="Confirmada" color={palette.success} soft={palette.successSoft} />;
  return <View style={[styles.card, styles.cardDone]}>
    <CardHeader item={item} expanded={expanded} pill={pill} onToggle={onToggle} />
    {expanded ? <FadeIn index={0}><View style={styles.cardBody}>
      <CardDetails item={item} />
      {item.acknowledgement ? <View style={styles.done}>
        <Ionicons name="shield-checkmark-outline" size={18} color={palette.success} accessible={false} />
        <Text style={styles.doneText}>{`Recibido el ${receiptDateTime(item.acknowledgement.confirmedAt)}${item.acknowledgement.location.status === "AVAILABLE" ? " · ubicación registrada" : " · sin ubicación"}`}</Text>
      </View> : null}
      {supported ? <View style={[styles.deadline, closed ? styles.deadlineClosed : days !== null && days <= 2 ? styles.deadlineSoon : null]}>
        <Ionicons name={closed ? "lock-closed-outline" : "hourglass-outline"} size={15} color={closed ? palette.textSecondary : days !== null && days <= 2 ? palette.danger : palette.amber} accessible={false} />
        <Text style={styles.deadlineText}>{closed ? "Plazo cerrado: lo no devuelto quedó como utilizado."
          : days === null ? "Plazo de 7 días desde la confirmación." : days <= 1 ? "Último día para devolver o marcar como utilizado." : `Quedan ${days} días para devolver o marcar como utilizado.`}</Text>
      </View> : null}
      <View style={styles.productsBox}>
        <ProductsHeader count={item.products.length} extra={editable && open.length > 1 ? <Pressable accessibilityRole="button" hitSlop={8} disabled={locked}
          onPress={() => onDispose(open.map(product => ({ lineId: product.id, disposition: "USED" as const })))}>
          <Text style={[styles.selectedText, locked && styles.dim]}>Todo utilizado</Text>
        </Pressable> : null} />
        {visible.map((product, index) => {
          const state = productDispositionState(product, closed);
          const look = dispositionLook[state];
          const actionable = editable && state !== "RETURNED";
          return <ProductRow key={product.id} product={product} divider={index > 0} footer={actionable ? <View style={styles.dispositions}>
            {(["USED", "RETURN_REQUESTED"] as const).map(value => {
              const active = state === value;
              const color = value === "USED" ? palette.success : palette.orange;
              return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value === "USED" ? "Utilizado" : "Devolver"} ${product.name}`}
                accessibilityState={{ selected: active, disabled: locked || active }} disabled={locked || active}
                onPress={() => onDispose([{ lineId: product.id, disposition: value }])}
                style={({ pressed }) => [styles.dispositionButton, { borderColor: color }, active && { backgroundColor: color }, locked && !active && styles.dim, pressed && styles.pressed]}>
                <Ionicons name={value === "USED" ? (active ? "checkmark-circle" : "checkmark-circle-outline") : (active ? "return-down-back" : "return-down-back-outline")} size={16}
                  color={active ? palette.white : color} accessible={false} />
                <Text style={[styles.dispositionText, { color: active ? palette.white : color }]}>{value === "USED" ? "Utilizado" : "Devolver"}</Text>
              </Pressable>;
            })}
          </View> : supported ? <View style={styles.dispositionState}><Pill icon={look.icon} label={look.label} color={look.color} soft={look.soft} /></View> : null} />;
        })}
        <MoreProducts hidden={item.products.length - VISIBLE_PRODUCTS} showAll={showAll} onPress={() => setShowAll(value => !value)} />
      </View>
      {busy ? <Text style={styles.saving}>Guardando…</Text> : requested > 0 && !closed ? <Text style={styles.saving}>Bodega verá la solicitud de devolución y la registrará al recibir el material.</Text> : null}
    </View></FadeIn> : <View style={styles.collapsedFoot}>
      <Text style={styles.collapsedText}>{supported && !closed && open.length > 0 ? `${open.length} sin marcar · ${days ?? 7} ${days === 1 ? "día" : "días"} de plazo` : `${item.products.length} ${item.products.length === 1 ? "material" : "materiales"}`}</Text>
      <Ionicons name="chevron-forward" size={15} color={palette.textMuted} accessible={false} />
    </View>}
  </View>;
}

export function MaterialReceiptsScreen({ receipt, onBack }: { receipt: ReceiptModel; onBack?: () => void }) {
  const [tab, setTab] = useState<Tab>("pending");
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<ReceiptSourceFilter>("ALL");
  const [warehouse, setWarehouse] = useState<string | null>(null);
  const [warehousePicker, setWarehousePicker] = useState(false);
  const [expanded, setExpanded] = useState<Set<number> | null>(null);
  const open = useMemo(() => (receipt.data?.items ?? []).filter(item => item.receiptStatus !== "CONFIRMED"), [receipt.data]);
  const confirmed = receipt.confirmed;
  const list = tab === "pending" ? open : confirmed;
  const warehouses = useMemo(() => receiptWarehouses([...open, ...confirmed]), [open, confirmed]);
  const visible = useMemo(() => filterReceipts(list, { query, warehouse, source }), [list, query, warehouse, source]);
  const blocked = receipt.busy || Boolean(receipt.pending) || !receipt.ready;
  const incidents = open.filter(item => item.receiptStatus === "INCIDENT").length;
  const filtered = query.trim() !== "" || warehouse !== null || source !== "ALL";
  // Primera entrega abierta por defecto; el resto plegadas para ver de un vistazo qué hay.
  const isExpanded = (id: number, index: number) => expanded ? expanded.has(id) : index === 0;
  const toggle = (id: number, index: number) => setExpanded(previous => {
    const next = new Set(previous ?? (visible[0] ? [visible[0].id] : []));
    if (isExpanded(id, index)) next.delete(id); else next.add(id);
    return next;
  });
  useEffect(() => { setExpanded(null); }, [tab]);
  useEffect(() => { if (warehouse && !warehouses.includes(warehouse)) setWarehouse(null); }, [warehouse, warehouses]);
  async function refresh() { setRefreshing(true); try { await receipt.refresh(); await receipt.refreshHistory(); } finally { setRefreshing(false); } }

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.primary} colors={[palette.primary]} />}>
      <View style={styles.header}>
        {onBack ? <IconButton name="arrow-back-outline" label="Volver" disabled={receipt.busy} onPress={onBack} /> : null}
        <View style={styles.headerText}><Text accessibilityRole="header" style={styles.title}>Materiales</Text><Text style={styles.subtitle}>Entregas de inventario asignadas a ti</Text></View>
        <IconButton name={searching ? "close-outline" : "search-outline"} label={searching ? "Cerrar búsqueda" : "Buscar"} onPress={() => { if (searching) setQuery(""); setSearching(value => !value); }} />
        <View>
          <IconButton name="options-outline" label="Filtros" onPress={() => setFiltering(value => !value)} />
          {source !== "ALL" ? <View style={styles.filterDot} /> : null}
        </View>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel={`Bodega: ${warehouse ?? "Todas las bodegas"}`} onPress={() => setWarehousePicker(true)} style={styles.select}>
        <Ionicons name="business-outline" size={17} color={palette.primary} accessible={false} />
        <Text style={styles.selectText} numberOfLines={1}>{warehouse ?? "Todas las bodegas"}</Text>
        <Ionicons name="chevron-down" size={16} color={palette.textSecondary} accessible={false} />
      </Pressable>
      {searching ? <View style={styles.search}>
        <Ionicons name="search-outline" size={17} color={palette.textMuted} accessible={false} />
        <TextInput value={query} onChangeText={setQuery} autoFocus placeholder="Buscar por OT, equipo, código o material" placeholderTextColor={palette.textMuted}
          style={styles.searchInput} returnKeyType="search" accessibilityLabel="Buscar materiales" />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" hitSlop={8} onPress={() => setQuery("")}><Ionicons name="close-circle" size={18} color={palette.textMuted} /></Pressable> : null}
      </View> : null}
      {filtering ? <View style={styles.chips}>
        {sourceFilters.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: source === option.id }} onPress={() => setSource(option.id)}
          style={[styles.chip, source === option.id && styles.chipOn]}>
          <Text style={[styles.chipText, source === option.id && styles.chipTextOn]}>{option.label}</Text>
        </Pressable>)}
      </View> : null}

      <View style={styles.tabs} accessibilityRole="tablist">
        {([["pending", `Por confirmar (${open.length})`], ["confirmed", `Confirmadas (${confirmed.length})`]] as const).map(([id, label]) =>
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>)}
      </View>

      {tab === "pending" ? <>
        {receipt.error ? <Alert tone="danger" icon="cloud-offline-outline" title="No se completó la acción" message={receipt.error} /> : null}
        {receipt.pending ? <Alert tone="warning" icon="sync-outline" title="Hay una confirmación sin respuesta"
          message="Se guardó en el teléfono. Reintenta para terminarla; no se duplicará."
          action={<Button title="Reintentar confirmación" icon="refresh-outline" variant="secondary" loading={receipt.busy} disabled={!receipt.ready} onPress={() => void receipt.confirm([])} style={styles.alertButton} />} /> : null}
        {incidents > 0 ? <Alert tone="danger" icon="warning-outline" title={incidents === 1 ? "1 entrega con incidencia" : `${incidents} entregas con incidencia`} message="Coordina con bodega antes de confirmar esas entregas." /> : null}
        {receipt.data?.hasMore ? <Alert tone="info" icon="information-circle-outline" title="Hay más entregas pendientes" message="Confirma las visibles para ver las siguientes." /> : null}
      </> : <>
        <Alert tone="info" icon="hourglass-outline" title="Tienes 7 días para devolver o marcar como utilizados."
          message="Luego se marcarán automáticamente como utilizados." />
        {receipt.historyError ? <Alert tone="danger" icon="cloud-offline-outline" title="No se completó la acción" message={receipt.historyError} /> : null}
      </>}

      {!receipt.data && tab === "pending" ? <Text style={styles.loading}>Cargando materiales…</Text> : null}
      {(tab === "pending" ? receipt.data : true) && visible.length === 0 ? <View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name={filtered ? "search-outline" : tab === "pending" ? "checkmark-done-outline" : "file-tray-outline"} size={30} color={palette.primary} accessible={false} /></View>
        <Text style={styles.emptyTitle}>{filtered ? "Sin resultados" : tab === "pending" ? "Todo al día" : "Sin entregas confirmadas"}</Text>
        <Text style={styles.emptyText}>{filtered ? "Prueba con otra búsqueda, bodega u origen."
          : tab === "pending" ? "Cuando bodega te entregue materiales con confirmación, aparecerán aquí y recibirás un aviso."
            : "Aquí verás lo que confirmaste en los últimos 90 días para marcarlo como utilizado o devolverlo."}</Text>
        {filtered ? <Button title="Quitar filtros" variant="ghost" onPress={() => { setQuery(""); setWarehouse(null); setSource("ALL"); }} /> : null}
      </View> : null}

      {visible.map((item, index) => <FadeIn key={`${tab}-${item.id}`} index={index}>
        {tab === "pending"
          ? <PendingCard item={item} expanded={isExpanded(item.id, index)} disabled={blocked} busy={receipt.busy} onToggle={() => toggle(item.id, index)} onConfirm={() => void receipt.confirm([item])} />
          : <ConfirmedCard item={item} expanded={isExpanded(item.id, index)} busy={receipt.disposingId === item.id} locked={receipt.disposingId !== null}
            onToggle={() => toggle(item.id, index)} onDispose={lines => void receipt.dispose(item, lines)} />}
      </FadeIn>)}
      {tab === "pending" && open.length > 0 ? <View style={styles.hint}><Ionicons name="location-outline" size={15} color={palette.textSecondary} accessible={false} />
        <Text style={styles.hintText}>Al confirmar se registra tu ubicación. Si no está disponible, se guarda el motivo.</Text></View> : null}
    </ScrollView>

    <Modal visible={warehousePicker} transparent animationType="fade" onRequestClose={() => setWarehousePicker(false)}>
      <Pressable style={styles.backdrop} accessibilityLabel="Cerrar" onPress={() => setWarehousePicker(false)}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>Bodega</Text>
          {[null, ...warehouses].map(option => <Pressable key={option ?? "all"} accessibilityRole="button" accessibilityState={{ selected: warehouse === option }}
            onPress={() => { setWarehouse(option); setWarehousePicker(false); }} style={[styles.sheetOption, warehouse === option && styles.sheetOptionOn]}>
            <Ionicons name={option ? "business-outline" : "layers-outline"} size={18} color={warehouse === option ? palette.primary : palette.textSecondary} accessible={false} />
            <Text style={[styles.sheetText, warehouse === option && styles.sheetTextOn]} numberOfLines={1}>{option ?? "Todas las bodegas"}</Text>
            {warehouse === option ? <Ionicons name="checkmark" size={18} color={palette.primary} accessible={false} /> : null}
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 12, paddingBottom: 28 },
  flex: { flex: 1 }, dim: { opacity: 0.45 }, pressed: { opacity: 0.75 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 }, headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.heading, color: palette.heading }, subtitle: { ...typography.caption, color: palette.textSecondary },
  filterDot: { position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primary },
  select: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  selectText: { flex: 1, ...typography.label, color: palette.text },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.surface },
  searchInput: { flex: 1, fontSize: 15, color: palette.text, paddingVertical: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, chipText: { fontSize: 13, fontWeight: "700", color: palette.textSecondary }, chipTextOn: { color: palette.primary },
  tabs: { flexDirection: "row", padding: 4, gap: 4, borderRadius: radius.md, backgroundColor: palette.track },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: radius.sm },
  tabOn: { backgroundColor: palette.surface, ...theme.shadow }, tabText: { fontSize: 14, fontWeight: "700", color: palette.textSecondary }, tabTextOn: { color: palette.primary },
  alert: { flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1 }, alertText: { flex: 1, minWidth: 0, gap: 3 },
  alertTitle: { ...typography.label }, alertMessage: { ...typography.caption, color: palette.textSecondary }, alertButton: { marginTop: 6, alignSelf: "flex-start" },
  loading: { ...typography.caption, color: palette.textSecondary, textAlign: "center", paddingVertical: 20 },
  hint: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }, hintText: { flex: 1, ...typography.caption, color: palette.textSecondary },
  empty: { alignItems: "center", gap: 8, paddingVertical: 34, paddingHorizontal: 20, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  emptyTitle: { ...typography.label, fontSize: 16, color: palette.text }, emptyText: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  card: { borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...theme.shadow },
  cardDone: { borderColor: palette.successSoft }, cardIncident: { borderColor: palette.dangerBorder },
  cardHeader: { padding: 14, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill }, pillText: { fontSize: 12, fontWeight: "800" },
  code: { flex: 1, textAlign: "right", fontSize: 12, fontWeight: "800", color: palette.textMuted, fontVariant: ["tabular-nums"] },
  when: { flexDirection: "row", alignItems: "center", gap: 5 }, whenText: { ...typography.caption, color: palette.textMuted }, whenDot: { color: palette.textMuted },
  source: { flexDirection: "row", alignItems: "center", gap: 10 },
  sourceIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  sourceText: { flex: 1, minWidth: 0 }, sourceCode: { fontSize: 16, lineHeight: 21, fontWeight: "800", color: palette.heading }, sourceSub: { ...typography.caption, color: palette.textSecondary },
  cardBody: { gap: 12, paddingHorizontal: 14, paddingBottom: 14 },
  details: { gap: 7, padding: 10, borderRadius: radius.md, backgroundColor: palette.background },
  detail: { flexDirection: "row", alignItems: "flex-start", gap: 7 }, detailLabel: { width: 62, ...typography.caption, color: palette.textMuted, fontWeight: "700" },
  detailValue: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  notes: { flexDirection: "row", gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: palette.amberSoft },
  notesBody: { flex: 1, gap: 2 }, notesLabel: { fontSize: 12, fontWeight: "800", color: palette.amber }, notesText: { ...typography.caption, color: palette.text },
  productsBox: { borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
  productsHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: palette.background, borderBottomWidth: 1, borderColor: palette.border },
  productsTitle: { ...typography.label, color: palette.text }, selectedText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  product: { paddingHorizontal: 10, paddingVertical: 10, gap: 8 }, productDivider: { borderTopWidth: 1, borderColor: palette.border },
  productMain: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: { width: 24, height: 24, marginTop: 12, borderRadius: 7, borderWidth: 2, borderColor: palette.border, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  checkboxOn: { borderColor: palette.primary, backgroundColor: palette.primary },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: palette.track }, thumbEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  productText: { flex: 1, minWidth: 0, gap: 1 },
  productCode: { fontSize: 11, fontWeight: "800", color: palette.textMuted, letterSpacing: 0.3 },
  productName: { fontSize: 14, lineHeight: 19, fontWeight: "700", color: palette.text },
  productDescription: { ...typography.caption, color: palette.textSecondary }, readMore: { fontSize: 12, fontWeight: "800", color: palette.primary, paddingVertical: 2 },
  price: { fontSize: 12, fontWeight: "700", color: palette.textSecondary, marginTop: 2 },
  quantity: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.primarySoft }, quantityText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, borderTopWidth: 1, borderColor: palette.border },
  moreText: { fontSize: 13, fontWeight: "800", color: palette.primary },
  ask: { gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  askHead: { flexDirection: "row", alignItems: "center", gap: 8 }, askTitle: { flex: 1, ...typography.label, color: palette.text },
  askText: { ...typography.caption, color: palette.textSecondary }, askActions: { flexDirection: "row", gap: 10 },
  collapsedFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderColor: palette.border },
  collapsedText: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
  done: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.successSoft }, doneText: { flex: 1, ...typography.caption, color: palette.success, fontWeight: "700" },
  deadline: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.amberSoft },
  deadlineSoon: { backgroundColor: palette.dangerSoft }, deadlineClosed: { backgroundColor: palette.track },
  deadlineText: { flex: 1, ...typography.caption, color: palette.text, fontWeight: "600" },
  dispositions: { flexDirection: "row", gap: 8, paddingLeft: 58 },
  dispositionButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 38, borderRadius: radius.sm, borderWidth: 1.5 },
  dispositionText: { fontSize: 13, fontWeight: "800" },
  dispositionState: { flexDirection: "row", paddingLeft: 58 },
  saving: { ...typography.caption, color: palette.textSecondary },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { gap: 4, padding: 16, paddingBottom: 28, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: palette.surface },
  sheetTitle: { ...typography.label, fontSize: 16, color: palette.heading, marginBottom: 6 },
  sheetOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, minHeight: 48, borderRadius: radius.md },
  sheetOptionOn: { backgroundColor: palette.primarySoft }, sheetText: { flex: 1, fontSize: 15, color: palette.text }, sheetTextOn: { color: palette.primary, fontWeight: "800" },
});
