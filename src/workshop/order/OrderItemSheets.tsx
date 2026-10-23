import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { WorkshopOrderItemInput, WorkshopProductOption, WorkshopTransportOption } from "../../domain/workshopOrders";
import { OptionRow, PickerSheet, SearchBox } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";

export const CHARGE_LABELS: Record<string, string> = { km: "Por kilómetro", hr: "Por hora", day: "Por día", month: "Por mes", year: "Por año" };
export const CHARGE_UNITS: Record<string, string> = { km: "km", hr: "horas", day: "días", month: "meses", year: "años" };
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const parseQuantity = (value: string) => Number(value.replace(",", "."));

/** Cantidad con botones − y + (los productos solo aceptan enteros, como la web). */
function QuantityField({ value, onChange, integer = false, unit }: { value: string; onChange: (value: string) => void; integer?: boolean; unit?: string | null }) {
  const step = (delta: number) => {
    const current = parseQuantity(value);
    const next = Math.max(integer ? 1 : 0, (Number.isFinite(current) ? current : 0) + delta);
    onChange(String(integer ? Math.round(next) : Math.round(next * 100) / 100));
  };
  return <View style={styles.quantity}>
    <Pressable accessibilityRole="button" accessibilityLabel="Restar uno" onPress={() => step(-1)} style={styles.stepper}><Ionicons name="remove" size={20} color={palette.primary} /></Pressable>
    <TextInput value={value} onChangeText={(text) => onChange(text.replace(integer ? /[^0-9]/g : /[^0-9.,]/g, ""))} keyboardType={integer ? "number-pad" : "decimal-pad"}
      style={styles.quantityInput} accessibilityLabel="Cantidad" textAlign="center" />
    <Pressable accessibilityRole="button" accessibilityLabel="Sumar uno" onPress={() => step(1)} style={styles.stepper}><Ionicons name="add" size={20} color={palette.primary} /></Pressable>
    {unit ? <Text style={styles.unit}>{unit}</Text> : null}
  </View>;
}

function validQuantity(value: string, integer: boolean): number | null {
  const quantity = parseQuantity(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return null;
  if (integer && !Number.isInteger(quantity)) return null;
  return quantity;
}

/** Un intento por ítem nuevo: si falla la conexión y se reintenta, no se agrega dos veces. */
function useAttempt() {
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  return (fingerprint: string) => {
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
    return attempt.current.requestId;
  };
}

/** Buscar un producto del catálogo y elegir la cantidad. Sin precios: la pasarela usa los del catálogo, como la web. */
export function AddProductSheet({ load, onAdd, onClose }: {
  load: (search: string, page: number) => Promise<{ items: WorkshopProductOption[]; hasMore: boolean }>;
  onAdd: (input: Omit<WorkshopOrderItemInput, "companyBranchId">) => Promise<void>; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WorkshopProductOption[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<WorkshopProductOption | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loader = useRef(load);
  loader.current = load;
  const request = useRef(0);
  const attempt = useAttempt();

  function fetch(term: string, nextPage: number) {
    const current = ++request.current;
    setLoading(true); setError("");
    loader.current(term, nextPage).then((result) => {
      if (current !== request.current) return;
      setItems((previous) => nextPage === 0 ? result.items : [...previous, ...result.items]);
      setHasMore(result.hasMore); setPage(nextPage);
    }, (failure: unknown) => { if (current === request.current) setError(failureText(failure, "No se pudo cargar el catálogo.")); })
      .finally(() => { if (current === request.current) setLoading(false); });
  }
  useEffect(() => { const timer = setTimeout(() => fetch(search, 0), 300); return () => clearTimeout(timer); }, [search]);

  async function add() {
    if (!chosen || saving) return;
    const amount = validQuantity(quantity, true);
    if (amount === null) { setError("Indica una cantidad entera mayor que cero."); return; }
    const item = { kind: "product" as const, productId: chosen.id, quantity: amount };
    setSaving(true); setError("");
    try { await onAdd({ requestId: attempt(JSON.stringify(item)), item }); }
    catch (failure) { setError(failureText(failure, "No se pudo agregar el producto. Revisa tu conexión.")); }
    finally { setSaving(false); }
  }

  if (chosen) return <PickerSheet title="Agregar producto" onClose={saving ? () => undefined : () => setChosen(null)}
    footer={<View style={styles.footer}>
      <Button title="Agregar a la OT" icon="add" loading={saving} disabled={saving} onPress={() => void add()} />
      <Button title="Elegir otro producto" variant="secondary" disabled={saving} onPress={() => setChosen(null)} />
    </View>}>
    <View style={styles.chosen}>
      {chosen.code ? <Text style={styles.code}>{chosen.code}</Text> : null}
      <Text style={styles.title}>{chosen.name}</Text>
      {chosen.description ? <Text style={styles.hint}>{chosen.description}</Text> : null}
      {chosen.stock !== null ? <Text style={[styles.stock, chosen.stock <= 0 && { color: palette.danger }]}>Stock disponible: {chosen.stock}</Text> : null}
    </View>
    <Text style={styles.label}>Cantidad</Text>
    <QuantityField value={quantity} onChange={(value) => { setQuantity(value); setError(""); }} integer unit={chosen.unit?.toLowerCase()} />
    {chosen.stock !== null && validQuantity(quantity, true) !== null && validQuantity(quantity, true)! > chosen.stock
      ? <Notice tone="warning" icon="alert-circle-outline" message="La cantidad supera el stock disponible. Se puede agregar igual; bodega lo gestionará." /> : null}
    <View style={styles.info}><Ionicons name="pricetag-outline" size={16} color={palette.info} accessible={false} /><Text style={styles.infoText}>El precio lo toma del catálogo; comercial lo revisa.</Text></View>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;

  // Scroll infinito: al acercarse al final se pide la página siguiente del catálogo.
  return <PickerSheet title="Agregar producto" onClose={onClose} onEndReached={() => { if (hasMore && !loading && !error) fetch(search, page + 1); }}
    search={<SearchBox value={search} onChange={setSearch} placeholder="Buscar producto por código o nombre" />}>
    {items.map((product) => <OptionRow key={product.id} title={`${product.code ? `${product.code} · ` : ""}${product.name}`}
      subtitle={[product.description, product.stock !== null ? `Stock: ${product.stock}${product.unit ? ` ${product.unit.toLowerCase()}` : ""}` : null].filter(Boolean).join(" · ") || null}
      selected={false} onPress={() => { setChosen(product); setQuantity("1"); setError(""); }} />)}
    {loading ? <ActivityIndicator color={palette.primary} /> : null}
    {!loading && items.length === 0 && !error ? <Text style={styles.hint}>No hay productos con esa búsqueda.</Text> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {error ? <Button title="Reintentar" variant="secondary" icon="refresh" onPress={() => fetch(search, items.length > 0 ? page + 1 : 0)} /> : null}
  </PickerSheet>;
}

/** Transporte del catálogo: vehículo, forma de cobro, cantidad y detalle (como el asistente de la web, sin montos). */
export function AddTransportSheet({ load, onAdd, onClose }: {
  load: () => Promise<{ items: WorkshopTransportOption[] }>; onAdd: (input: Omit<WorkshopOrderItemInput, "companyBranchId">) => Promise<void>; onClose: () => void;
}) {
  const [options, setOptions] = useState<WorkshopTransportOption[] | null>(null);
  const [vehicle, setVehicle] = useState<WorkshopTransportOption | null>(null);
  const [chargeType, setChargeType] = useState<WorkshopTransportOption["chargeTypes"][number] | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const attempt = useAttempt();
  useEffect(() => { load().then((result) => setOptions(result.items), (failure: unknown) => { setOptions([]); setError(failureText(failure, "No se pudo cargar el catálogo de transporte.")); }); }, []);

  async function add() {
    if (!vehicle || !chargeType || saving) return;
    const amount = validQuantity(quantity, false);
    if (amount === null) { setError("Indica una cantidad mayor que cero."); return; }
    const item = { kind: "transport" as const, transportId: vehicle.id, chargeType, quantity: amount, detail: detail.trim() || null };
    setSaving(true); setError("");
    try { await onAdd({ requestId: attempt(JSON.stringify(item)), item }); }
    catch (failure) { setError(failureText(failure, "No se pudo agregar el transporte. Revisa tu conexión.")); }
    finally { setSaving(false); }
  }

  return <PickerSheet title="Agregar transporte" onClose={saving ? () => undefined : onClose}
    footer={vehicle ? <Button title="Agregar a la OT" icon="add" loading={saving} disabled={saving || !chargeType} onPress={() => void add()} /> : undefined}>
    <Text style={styles.label}>Vehículo</Text>
    {!options ? <ActivityIndicator color={palette.primary} /> : null}
    {options?.length === 0 && !error ? <Text style={styles.hint}>La sucursal no tiene transportes configurados.</Text> : null}
    {options?.map((option) => <OptionRow key={option.id} title={option.name} selected={vehicle?.id === option.id}
      onPress={() => { setVehicle(option); setChargeType(option.chargeTypes.length === 1 ? option.chargeTypes[0]! : null); setError(""); }} />)}
    {vehicle ? <>
      <Text style={styles.label}>¿Cómo se cobra?</Text>
      <View style={styles.chips}>{vehicle.chargeTypes.map((type) => <Pressable key={type} accessibilityRole="radio" accessibilityState={{ checked: chargeType === type }} onPress={() => setChargeType(type)}
        style={[styles.chip, chargeType === type && styles.chipOn]}><Text style={[styles.chipText, chargeType === type && styles.chipTextOn]}>{CHARGE_LABELS[type]}</Text></Pressable>)}</View>
      <Text style={styles.label}>Cantidad</Text>
      <QuantityField value={quantity} onChange={(value) => { setQuantity(value); setError(""); }} unit={chargeType ? CHARGE_UNITS[chargeType] : null} />
      <Text style={styles.label}>Detalle (opcional)</Text>
      <TextInput value={detail} onChangeText={setDetail} maxLength={1000} multiline placeholder="Ej.: retiro y entrega en faena" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Detalle del transporte" />
    </> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Otro ítem libre: nombre, descripción y cantidad. Comercial lo valoriza. */
export function AddOtherSheet({ onAdd, onClose }: { onAdd: (input: Omit<WorkshopOrderItemInput, "companyBranchId">) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const attempt = useAttempt();
  async function add() {
    if (saving) return;
    if (!name.trim()) { setError("Escribe el nombre del ítem."); return; }
    const amount = validQuantity(quantity, false);
    if (amount === null) { setError("Indica una cantidad mayor que cero."); return; }
    const item = { kind: "other" as const, name: name.trim(), description: description.trim() || null, quantity: amount };
    setSaving(true); setError("");
    try { await onAdd({ requestId: attempt(JSON.stringify(item)), item }); }
    catch (failure) { setError(failureText(failure, "No se pudo agregar el ítem. Revisa tu conexión.")); }
    finally { setSaving(false); }
  }
  return <PickerSheet title="Agregar otro ítem" onClose={saving ? () => undefined : onClose}
    footer={<Button title="Agregar a la OT" icon="add" loading={saving} disabled={saving} onPress={() => void add()} />}>
    <Text style={styles.label}>Nombre *</Text>
    <TextInput value={name} onChangeText={(value) => { setName(value); setError(""); }} maxLength={255} placeholder="Ej.: Limpieza industrial" placeholderTextColor={palette.textMuted} style={styles.input} accessibilityLabel="Nombre del ítem" />
    <Text style={styles.label}>Descripción</Text>
    <TextInput value={description} onChangeText={setDescription} maxLength={1000} multiline placeholderTextColor={palette.textMuted} style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Descripción del ítem" />
    <Text style={styles.label}>Cantidad</Text>
    <QuantityField value={quantity} onChange={(value) => { setQuantity(value); setError(""); }} />
    <View style={styles.info}><Ionicons name="pricetag-outline" size={16} color={palette.info} accessible={false} /><Text style={styles.infoText}>Se agrega sin valor; comercial lo completa.</Text></View>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Cambiar la cantidad (y el detalle) de un ítem, o quitarlo de la OT. */
export function EditItemSheet({ title, quantity: initial, integer, unit, note, noteLabel, onSave, onRemove, onClose }: {
  title: string; quantity: number; integer: boolean; unit?: string | null; note?: string | null; noteLabel?: string;
  onSave: (quantity: number, note?: string | null) => Promise<void>; onRemove: () => Promise<void>; onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(String(initial));
  const [text, setText] = useState(note ?? "");
  const [saving, setSaving] = useState<"save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");
  async function run(kind: "save" | "remove") {
    if (saving) return;
    const amount = validQuantity(quantity, integer);
    if (kind === "save" && amount === null) { setError(integer ? "Indica una cantidad entera mayor que cero." : "Indica una cantidad mayor que cero."); return; }
    setSaving(kind); setError("");
    try { if (kind === "save") await onSave(amount!, noteLabel ? text.trim() || null : undefined); else await onRemove(); }
    catch (failure) { setError(failureText(failure, "No se pudo guardar. Revisa tu conexión.")); }
    finally { setSaving(null); }
  }
  return <PickerSheet title={title} onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      {confirmRemove ? <Button title="Sí, quitar de la OT" variant="danger" icon="trash-outline" loading={saving === "remove"} disabled={saving !== null} onPress={() => void run("remove")} />
        : <Button title="Guardar cambios" icon="checkmark" loading={saving === "save"} disabled={saving !== null} onPress={() => void run("save")} />}
      {confirmRemove ? <Button title="Cancelar" variant="secondary" disabled={saving !== null} onPress={() => setConfirmRemove(false)} />
        : <Button title="Quitar de la OT" variant="secondary" icon="trash-outline" disabled={saving !== null} onPress={() => setConfirmRemove(true)} />}
    </View>}>
    {confirmRemove ? <Notice tone="danger" icon="warning-outline" message="El ítem se quitará de la OT. Si comercial ya lo valorizó, también se descuenta de los totales." /> : <>
      <Text style={styles.label}>Cantidad</Text>
      <QuantityField value={quantity} onChange={(value) => { setQuantity(value); setError(""); }} integer={integer} unit={unit} />
      {noteLabel ? <>
        <Text style={styles.label}>{noteLabel}</Text>
        <TextInput value={text} onChangeText={setText} maxLength={1000} multiline placeholderTextColor={palette.textMuted} style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel={noteLabel} />
      </> : null}
    </>}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Confirmar quitar un trabajo de la OT: vuelve a quedar suelto en el ingreso. */
export function RemoveWorkSheet({ title, onRemove, onClose }: { title: string; onRemove: () => Promise<void>; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <PickerSheet title="Quitar trabajo de la OT" onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      <Button title="Quitar de la OT" variant="danger" icon="remove-circle-outline" loading={saving} disabled={saving} onPress={() => {
        setSaving(true); setError("");
        onRemove().catch((failure: unknown) => setError(failureText(failure, "No se pudo quitar el trabajo."))).finally(() => setSaving(false));
      }} />
      <Button title="Cancelar" variant="secondary" disabled={saving} onPress={onClose} />
    </View>}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.hint}>El trabajo no se elimina: vuelve a quedar suelto en el ingreso y se puede unir a otra OT.</Text>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

const styles = StyleSheet.create({
  footer: { gap: 8 },
  label: { ...typography.label, color: palette.text },
  hint: { ...typography.caption, color: palette.textSecondary },
  error: { ...typography.caption, color: palette.danger },
  code: { fontSize: 12, fontWeight: "800", color: palette.primary },
  title: { fontSize: 16, fontWeight: "800", color: palette.heading },
  stock: { fontSize: 12, fontWeight: "700", color: palette.success },
  chosen: { gap: 3, padding: 12, borderRadius: radius.md, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border },
  info: { flexDirection: "row", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: palette.infoSoft },
  infoText: { flex: 1, ...typography.caption, color: palette.text },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  searchInput: { flex: 1, fontSize: 15, color: palette.text, paddingVertical: 0 },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  multiline: { minHeight: 70, paddingTop: 10 },
  quantity: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepper: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.primaryBorder, backgroundColor: palette.primarySoft },
  quantityInput: { width: 90, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 17, fontWeight: "800", color: palette.heading },
  unit: { ...typography.caption, color: palette.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white }
});
