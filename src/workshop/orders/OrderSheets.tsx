import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import type { WorkshopOrder, WorkshopWork } from "../../domain/workshopEntry";
import type { WorkshopOrderInput, WorkshopOrderRules } from "../../domain/workshopOrders";
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
  const [rulesError, setRulesError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkshopOrderInput["priority"]>("medium");
  const [chosen, setChosen] = useState<number[]>(preselected.length > 0 ? preselected : looseWorks.map((work) => work.id));
  const [saving, setSaving] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState("");
  const loader = useRef(loadRules);
  loader.current = loadRules;
  const fetchRules = () => { setRulesError(""); setRules(null); loader.current().then(setRules, (failure: unknown) => setRulesError(failureText(failure, "No se pudieron revisar las reglas de la sucursal."))); };
  useEffect(fetchRules, []);

  async function create(sendToCommercial: boolean) {
    if (saving) return;
    if (!title.trim()) { setError("Escribe un título para la OT."); return; }
    if (chosen.length === 0) { setError("Elige al menos un trabajo."); return; }
    if (rules?.descriptionRequired && !description.trim()) { setError("La sucursal exige una descripción para la OT."); return; }
    const input = { title: title.trim(), description: description.trim() || null, priority, workIds: chosen, sendToCommercial };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
    setSaving(sendToCommercial ? "send" : "save"); setError("");
    try { await onCreate({ ...input, requestId: attempt.current.requestId }); attempt.current = null; }
    catch (failure) { setError(failureText(failure, "No se pudo crear la OT. Revisa tu conexión.")); }
    finally { setSaving(null); }
  }

  const blocked = Boolean(rules && rules.blockingFields.length > 0);
  return <PickerSheet title="Nueva orden de trabajo" onClose={saving ? () => undefined : onClose}
    footer={<View style={styles.footer}>
      <Button title="Crear y enviar a comercial" icon="paper-plane-outline" loading={saving === "send"} disabled={saving !== null || !rules || blocked} onPress={() => void create(true)} />
      <Button title="Crear sin enviar" variant="secondary" icon="save-outline" loading={saving === "save"} disabled={saving !== null || !rules || blocked} onPress={() => void create(false)} />
    </View>}>
    {!rules && !rulesError ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Revisando lo que exige la sucursal…</Text></View> : null}
    {rulesError ? <View style={styles.block}><Notice tone="danger" icon="cloud-offline-outline" message={rulesError} /><Button title="Reintentar" variant="secondary" icon="refresh" onPress={fetchRules} /></View> : null}
    {blocked ? <Notice tone="warning" icon="desktop-outline" message={`La sucursal exige completar en la OT: ${rules!.blockingFields.join(", ")}. Créala desde la web.`} /> : null}
    <View style={styles.info}>
      <Ionicons name="pricetag-outline" size={18} color={palette.info} accessible={false} />
      <Text style={styles.infoText}>La OT se crea sin precios: comercial los completa. Cliente, equipo, sucursales y contactos salen del ingreso.</Text>
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Título *</Text>
      <TextInput value={title} onChangeText={(value) => { setTitle(value); setError(""); }} maxLength={100} placeholder="Ej.: Reparación de bomba" placeholderTextColor={palette.textMuted}
        style={styles.input} accessibilityLabel="Título de la OT" />
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Descripción{rules?.descriptionRequired ? " *" : ""}</Text>
      <TextInput value={description} onChangeText={setDescription} maxLength={5000} multiline placeholder="Qué incluye la OT" placeholderTextColor={palette.textMuted}
        style={[styles.input, styles.multiline]} textAlignVertical="top" accessibilityLabel="Descripción de la OT" />
    </View>
    <View style={styles.field}>
      <Text style={styles.label}>Prioridad</Text>
      <View style={styles.chips}>{PRIORITIES.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: priority === option.value }}
        onPress={() => setPriority(option.value)} style={[styles.chip, priority === option.value && { backgroundColor: option.tone, borderColor: option.tone }]}>
        <Text style={[styles.chipText, priority === option.value && styles.chipTextOn]}>{option.label}</Text>
      </Pressable>)}</View>
    </View>
    <Text style={styles.label}>Trabajos que incluye ({chosen.length})</Text>
    {looseWorks.length === 0 ? <Text style={styles.hint}>No hay trabajos sueltos. Agrega trabajos al ingreso primero.</Text> : null}
    {looseWorks.map((work) => <OptionRow key={work.id} multiple title={`${work.code} · ${work.title}`} subtitle={work.statusName} selected={chosen.includes(work.id)}
      onPress={() => setChosen((list) => list.includes(work.id) ? list.filter((value) => value !== work.id) : [...list, work.id])} />)}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </PickerSheet>;
}

/** Agregar trabajos sueltos a una OT que aún no se envía. */
export function AddWorksSheet({ order, looseWorks, onAdd, onClose }: {
  order: WorkshopOrder; looseWorks: WorkshopWork[]; onAdd: (workIds: number[]) => Promise<void>; onClose: () => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function add() {
    setSaving(true); setError("");
    try { await onAdd(chosen); } catch (failure) { setError(failureText(failure, "No se pudieron agregar los trabajos.")); } finally { setSaving(false); }
  }
  return <PickerSheet title={`Agregar trabajos a ${order.workOrderCode ?? order.code}`} onClose={saving ? () => undefined : onClose}
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
  chips: { flexDirection: "row", gap: 8 },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipText: { fontSize: 14, fontWeight: "700", color: palette.text },
  chipTextOn: { color: palette.white },
  error: { ...typography.caption, color: palette.danger },
  confirmTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  body: { fontSize: 14, color: palette.text, lineHeight: 20 }
});
