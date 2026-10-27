import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { WorkshopOrder, WorkshopWork } from "../../domain/workshopEntry";
import type { WorkshopOrderDetail, WorkshopOrderGeneralInput, WorkshopOrderInput, WorkshopOrderRules } from "../../domain/workshopOrders";
import { CreationDatePicker } from "../../screens/creation/CreationDatePicker";
import { OptionRow, PickerSheet } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";

const PRIORITIES: Array<{ value: WorkshopOrderInput["priority"]; label: string; tone: string }> = [
  { value: "low", label: "Baja", tone: palette.success }, { value: "medium", label: "Media", tone: palette.orange }, { value: "high", label: "Alta", tone: palette.danger }
];
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

/** Nueva OT del ingreso con los trabajos sueltos elegidos. Sin precios: comercial los pone después. */
export function CreateOrderSheet({ looseWorks, preselected, loadRules, onCreate, onClose, attempt }: {
  looseWorks: WorkshopWork[]; preselected: number[]; loadRules: () => Promise<WorkshopOrderRules>;
  onCreate: (input: Omit<WorkshopOrderInput, "companyBranchId">) => Promise<{ sent: boolean }>; onClose: () => void;
  /** Intento guardado fuera de la ventana: si se cierra y se vuelve a abrir tras un error, se reusa y no se duplica la OT. */
  attempt: MutableRefObject<{ fingerprint: string; requestId: string } | null>;
}) {
  const [rules, setRules] = useState<WorkshopOrderRules | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkshopOrderInput["priority"]>("medium");
  const [chosen, setChosen] = useState<number[]>(preselected.length > 0 ? preselected : looseWorks.map((work) => work.id));
  // Campos que la sucursal exige y que se completan aquí (centro de costo, notas internas).
  const [costCenter, setCostCenter] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState("");
  const loader = useRef(loadRules);
  loader.current = loadRules;
  // Las reglas solo agregan campos opcionales (centro de costo, notas internas); si fallan, la OT se crea igual.
  useEffect(() => { loader.current().then(setRules, () => undefined); }, []);

  async function create(sendToCommercial: boolean) {
    if (saving) return;
    // Solo el título es obligatorio: lo que exige la web para la OT lo completa comercial después.
    if (!title.trim()) { setError("Escribe un título para la OT."); return; }
    const extra = { ...(costCenter.trim() ? { costCenterRelation: costCenter.trim() } : {}), ...(notes.trim() ? { internalNotes: notes.trim() } : {}) };
    const input = { title: title.trim(), description: description.trim() || null, priority, workIds: chosen, sendToCommercial, ...(Object.keys(extra).length > 0 ? { extra } : {}) };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
    setSaving(sendToCommercial ? "send" : "save"); setError("");
    try { await onCreate({ ...input, requestId: attempt.current.requestId }); attempt.current = null; }
    catch (failure) { setError(failureText(failure, "No se pudo crear la OT. Revisa tu conexión.")); }
    finally { setSaving(null); }
  }

  return <PickerSheet title="Nueva orden de trabajo" onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      <Button title="Crear sin enviar" icon="save-outline" loading={saving === "save"} disabled={saving !== null} onPress={() => void create(false)} />
      <Button title="Crear y enviar a comercial" variant="warning" icon="paper-plane-outline" loading={saving === "send"} disabled={saving !== null} onPress={() => void create(true)} />
    </View>}>
    <View style={styles.info}>
      <Ionicons name="pricetag-outline" size={18} color={palette.info} accessible={false} />
      <Text style={styles.infoText}>La OT se crea sin precios: comercial los completa. Cliente, equipo, sucursales y contactos salen del ingreso.</Text>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Título (descripción breve de la OT) *</Text>
      <TextInput value={title} onChangeText={(value) => { setTitle(value); setError(""); }} maxLength={100} placeholder="Ej.: Reparación de bomba" placeholderTextColor={palette.textMuted}
        style={styles.input} accessibilityLabel="Título de la OT" />
      <Text style={styles.counter}>{title.length}/100</Text>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Descripción</Text>
      <TextInput value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="Qué incluye la OT" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Descripción de la OT" />
      <Text style={styles.counter}>{description.length}/5000</Text>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Prioridad</Text>
      <View style={styles.chips}>{PRIORITIES.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: priority === option.value }}
        onPress={() => setPriority(option.value)} style={[styles.chip, priority === option.value && { backgroundColor: option.tone, borderColor: option.tone }]}>
        <Text style={[styles.chipText, priority === option.value && styles.chipTextOn]}>{option.label}</Text>
      </Pressable>)}</View>
    </View>
    {(rules?.fields ?? []).map((field) => <View key={field.key} style={styles.field}>
        <Text style={styles.label}>{field.label}</Text>
        <TextInput value={field.key === "costCenterRelation" ? costCenter : notes} onChangeText={field.key === "costCenterRelation" ? setCostCenter : setNotes}
          maxLength={field.key === "costCenterRelation" ? 255 : 5000} multiline={field.key === "internalNotes"} placeholderTextColor={palette.textMuted}
          style={[styles.input, field.key === "internalNotes" && styles.multiline]} textAlignVertical={field.key === "internalNotes" ? "top" : "center"} accessibilityLabel={field.label} />
      </View>)}
    {/* Solo si hay trabajos sueltos para elegir; sin ellos la OT se crea vacía y se le agregan después. */}
    {looseWorks.length > 0 ? <Text style={styles.label}>Trabajos que incluye ({chosen.length})</Text> : null}
    {looseWorks.map((work) => <OptionRow key={work.id} multiple title={`${work.code} · ${work.title}`} subtitle={work.statusName} selected={chosen.includes(work.id)}
      onPress={() => setChosen((list) => list.includes(work.id) ? list.filter((value) => value !== work.id) : [...list, work.id])} />)}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Editar los datos generales de la OT: título, descripción, notas internas, prioridad y fecha de servicio. */
export function EditOrderGeneralSheet({ detail, onSave, onClose }: {
  detail: WorkshopOrderDetail; onSave: (input: Omit<WorkshopOrderGeneralInput, "companyBranchId">) => Promise<void>; onClose: () => void;
}) {
  const [title, setTitle] = useState(detail.general.title ?? "");
  const [description, setDescription] = useState(detail.general.description ?? "");
  const [internalNotes, setInternalNotes] = useState(detail.general.internalNotes ?? "");
  const [priority, setPriority] = useState<WorkshopOrderInput["priority"]>(detail.general.priority ?? "medium");
  const [serviceDate, setServiceDate] = useState(detail.general.serviceDate);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (saving) return;
    if (!title.trim()) { setError("Escribe un título para la OT."); return; }
    setSaving(true); setError("");
    try { await onSave({ title: title.trim(), description: description.trim() || null, internalNotes: internalNotes.trim() || null, priority, serviceDate }); }
    catch (failure) { setError(failureText(failure, "No se pudieron guardar los cambios. Revisa tu conexión.")); }
    finally { setSaving(false); }
  }
  return <PickerSheet title="Editar datos generales" onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      <Button title="Guardar cambios" icon="checkmark" loading={saving} disabled={saving} onPress={() => void save()} />
      <Button title="Cancelar" variant="secondary" disabled={saving} onPress={onClose} />
    </View>}>
    <View style={styles.field}>
      <Text style={styles.label}>Título *</Text>
      <TextInput value={title} onChangeText={(value) => { setTitle(value); setError(""); }} maxLength={100} placeholderTextColor={palette.textMuted} style={styles.input} accessibilityLabel="Título de la OT" />
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Prioridad</Text>
      <View style={styles.chips}>{PRIORITIES.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: priority === option.value }}
        onPress={() => setPriority(option.value)} style={[styles.chip, priority === option.value && { backgroundColor: option.tone, borderColor: option.tone }]}>
        <Text style={[styles.chipText, priority === option.value && styles.chipTextOn]}>{option.label}</Text>
      </Pressable>)}</View>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Fecha de servicio</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Elegir fecha de servicio" onPress={() => setPicker(true)} style={[styles.input, styles.dateInput]}>
        <Ionicons name="calendar-outline" size={18} color={palette.primary} accessible={false} />
        <Text style={[styles.dateText, !serviceDate && { color: palette.textMuted }]}>{serviceDate ? serviceDate.split("-").reverse().join("-") : "Sin fecha"}</Text>
      </Pressable>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Descripción</Text>
      <TextInput value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="Qué incluye la OT" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Descripción de la OT" />
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Notas internas</Text>
      <TextInput value={internalNotes} onChangeText={setInternalNotes} maxLength={5000} multiline placeholder="Solo para el equipo, no para el cliente" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Notas internas de la OT" />
    </View>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {picker ? <CreationDatePicker value={serviceDate ?? new Date().toISOString().slice(0, 10)} showInputHint={false} onClose={() => setPicker(false)} onChange={(value) => setServiceDate(value)} /> : null}
  </PickerSheet>;
}

/** Agregar trabajos sueltos a una OT que aún no se envía. */
export function AddWorksSheet({ code, looseWorks, onAdd, onClose }: {
  code: string; looseWorks: WorkshopWork[]; onAdd: (workIds: number[]) => Promise<void>; onClose: () => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function add() {
    setSaving(true); setError("");
    try { await onAdd(chosen); } catch (failure) { setError(failureText(failure, "No se pudieron agregar los trabajos.")); } finally { setSaving(false); }
  }
  return <PickerSheet title={`Agregar trabajos a ${code}`} onClose={saving ? () => undefined : onClose}
    footer={<Button title={chosen.length === 0 ? "Elige trabajos" : `Agregar ${chosen.length} trabajo(s)`} icon="add" loading={saving} disabled={saving || chosen.length === 0} onPress={() => void add()} />}>
    {looseWorks.length === 0 ? <Text style={styles.hint}>No hay trabajos sueltos en este ingreso.</Text> : null}
    {looseWorks.map((work) => <OptionRow key={work.id} multiple title={`${work.code} · ${work.title}`} subtitle={work.statusName} selected={chosen.includes(work.id)}
      onPress={() => setChosen((list) => list.includes(work.id) ? list.filter((value) => value !== work.id) : [...list, work.id])} />)}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Confirmación antes de enviar o eliminar una OT: explica qué va a pasar. */
export function ConfirmOrderSheet({ order, action, worksCount, onConfirm, onClose }: {
  order: WorkshopOrder; action: "send" | "delete"; worksCount: number; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setSaving(true); setError("");
    try { await onConfirm(); } catch (failure) { setError(failureText(failure, action === "send" ? "No se pudo enviar a comercial." : "No se pudo eliminar la OT.")); } finally { setSaving(false); }
  }
  const name = order.title ?? order.workOrderCode ?? order.code;
  return <PickerSheet title={action === "send" ? "Enviar a comercial" : "Eliminar OT"} onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      <Button title={action === "send" ? "Enviar a comercial" : "Eliminar OT"} variant={action === "send" ? "primary" : "danger"} icon={action === "send" ? "paper-plane-outline" : "trash-outline"}
        loading={saving} disabled={saving} onPress={() => void confirm()} />
      <Button title="Cancelar" variant="secondary" disabled={saving} onPress={onClose} />
    </View>}>
    <Text style={styles.confirmTitle}>{name}</Text>
    {action === "send" ? <>
      <Text style={styles.body}>• La OT recibe número de cotización y aparece como pendiente en comercial.</Text>
      <Text style={styles.body}>• Comercial completa los precios y gestiona la aprobación con el cliente.</Text>
      <Text style={styles.body}>• Después de enviarla ya no se puede eliminar desde la app.</Text>
    </> : <>
      <Notice tone="danger" icon="warning-outline" message={worksCount > 0 ? `También se eliminarán sus ${worksCount} trabajo(s). Así funciona el servidor al eliminar una OT no enviada.` : "La OT se eliminará."} />
      <Text style={styles.body}>Esta acción no se puede deshacer. Si solo quieres sacar los trabajos de la OT, pídelo desde la web.</Text>
    </>}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

const styles = StyleSheet.create({
  footer: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  block: { gap: 8 },
  hint: { ...typography.caption, color: palette.textSecondary },
  info: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: palette.infoSoft },
  infoText: { flex: 1, ...typography.caption, color: palette.text },
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  multiline: { minHeight: 80, paddingTop: 10 },
  counter: { alignSelf: "flex-end", fontSize: 11, color: palette.textMuted, fontVariant: ["tabular-nums"] },
  dateInput: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateText: { fontSize: 15, color: palette.text },
  chips: { flexDirection: "row", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  error: { ...typography.caption, color: palette.danger },
  confirmTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  body: { fontSize: 14, color: palette.text, lineHeight: 20 }
});
