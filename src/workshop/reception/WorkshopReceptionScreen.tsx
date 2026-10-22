import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { SignatureField } from "../../screens/orders/lifecycle/SignatureField";
import { hasSignature, requireSignaturePng, type SignaturePadHandle, type SignatureStrokes } from "../../screens/orders/lifecycle/signatureGeometry";
import { evaluateInspection, inspectionRequirementLabel, type WorkshopEntryDetail } from "../../domain/workshopEntry";
import type { WorkshopReceptionResult, WorkshopSavedSignature, WorkshopWorker } from "../../domain/workshopReception";
import type { useWorkshopBoard } from "../useWorkshopBoard";
import { LocalPicker } from "../intake/IntakePickers";
import { Notice } from "../entry/EntrySections";

type ReceptionApi = ReturnType<typeof useWorkshopBoard>["reception"];
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

function Field({ label, value, onChange, error, keyboardType, maxLength, placeholder, multiline }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; keyboardType?: "email-address" | "phone-pad"; maxLength: number; placeholder?: string; multiline?: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType={keyboardType} autoCapitalize={keyboardType ? "none" : "sentences"} maxLength={maxLength} placeholder={placeholder}
      placeholderTextColor={palette.textMuted} multiline={multiline} textAlignVertical={multiline ? "top" : "center"}
      style={[styles.input, multiline && styles.inputMultiline, Boolean(error) && styles.invalid]} accessibilityLabel={label} />
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </View>;
}

/** Paso 3 del ingreso: quién recibe el equipo, su firma (guardada en su perfil o en pantalla) y la observación. */
export function WorkshopReceptionScreen({ api, load, entryId, onClose, onDone, onOpenInspection }: {
  api: ReceptionApi; load: (entryId: number) => Promise<WorkshopEntryDetail>; entryId: number;
  onClose: () => void; onDone: () => void; onOpenInspection: () => void;
}) {
  const [detail, setDetail] = useState<WorkshopEntryDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [worker, setWorker] = useState<WorkshopWorker | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [observation, setObservation] = useState("");
  const [saved, setSaved] = useState<WorkshopSavedSignature[] | null>(null);
  const [mode, setMode] = useState<{ kind: "saved"; id: number } | { kind: "draw" }>({ kind: "draw" });
  const [strokes, setStrokes] = useState<SignatureStrokes>([]);
  const [drawing, setDrawing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<WorkshopReceptionResult | null>(null);
  const pad = useRef<SignaturePadHandle>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { if (!saving) close.current(); return true; });
    return () => subscription.remove();
  }, [saving]);

  async function loadDetail() {
    setLoadError("");
    try { setDetail(await load(entryId)); }
    catch (failure) { setLoadError(failureText(failure, "No se pudo cargar el ingreso.")); }
  }
  useEffect(() => { void loadDetail(); }, [entryId]);

  // Al elegir quién recibe: sus datos y, si tiene, su firma guardada (igual que la web, se usa la predeterminada).
  // Solo vale la respuesta del último trabajador elegido (si cambian rápido, no se cruza la firma de otro).
  const chosenWorker = useRef<number | null>(null);
  function chooseWorker(next: WorkshopWorker) {
    setPicker(false); setIssues({}); setMessage("");
    chosenWorker.current = next.id;
    setWorker(next); setName(next.name.slice(0, 255)); setEmail((next.email ?? "").slice(0, 100)); setPhone((next.phone ?? "").slice(0, 50));
    setSaved(null); setMode({ kind: "draw" });
    if (next.userId === null) { setSaved([]); return; }
    api.savedSignatures(next.userId).then(({ items }) => {
      if (chosenWorker.current !== next.id) return;
      setSaved(items);
      const preferred = items.find((item) => item.isDefault && item.image) ?? items.find((item) => item.image);
      if (preferred) setMode({ kind: "saved", id: preferred.id });
    }, () => { if (chosenWorker.current === next.id) setSaved([]); });
  }

  const check = detail ? evaluateInspection(detail.inspections.entryRequirement, detail.inspections.entry, detail.inspections.photoSlots) : null;
  const inspectionBlocked = Boolean(detail && (!detail.inspections.available || !check?.met));

  async function sign() {
    if (saving || !detail) return;
    const found: Record<string, string> = {};
    if (!worker) found.worker = "Elige quién recibe el equipo.";
    if (!name.trim()) found.name = "Escribe el nombre de quien recibe.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Revisa el correo.";
    if (mode.kind === "draw" && !hasSignature(strokes)) found.signature = "Falta la firma.";
    if (Object.keys(found).length > 0 || !worker) { setIssues(found); setMessage("Revisa los datos marcados."); return; }
    setSaving(true); setMessage("");
    try {
      const signature = mode.kind === "saved" ? { source: "USER_SIGNATURE" as const, userSignatureId: mode.id }
        : { source: "MANUAL" as const, image: requireSignaturePng(await pad.current!.capture()) };
      const input = { workerId: worker.id, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, signature, observation: observation.trim() || null };
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: Crypto.randomUUID() };
      const done = await api.sign(entryId, { ...input, requestId: attempt.current.requestId });
      attempt.current = null;
      if (done.observationSaved && done.statusUpdated) onDone(); else setResult(done);
    } catch (failure) {
      setMessage(failureText(failure, "No se pudo guardar la firma. Revisa tu conexión e inténtalo de nuevo."));
    } finally { setSaving(false); }
  }

  const chosenSaved = mode.kind === "saved" ? saved?.find((item) => item.id === mode.id) ?? null : null;

  return <View style={styles.screen}>
    <View style={styles.bar}>
      <IconButton name="arrow-back" label="Salir de la recepción" disabled={saving} onPress={onClose} />
      <View style={styles.barText}>
        <Text style={styles.barTitle}>Recepción y firma</Text>
        <Text style={styles.barStep}>Paso 3 de 3 · {detail ? `${detail.code} · ${detail.equipmentLabel}` : "Cargando…"}</Text>
      </View>
    </View>
    <View style={styles.progress}>{[0, 1, 2].map((index) => <View key={index} style={[styles.progressStep, styles.progressOn]} />)}</View>

    {result ? <View style={styles.content}>
      <Notice tone="success" icon="checkmark-done-circle-outline" message="La recepción quedó firmada." />
      {!result.observationSaved ? <Notice tone="warning" icon="chatbox-ellipses-outline" message="La observación no se guardó: tu perfil no tiene permiso para editar inspecciones. Pide que la agreguen en la web." /> : null}
      {!result.statusUpdated ? <Notice tone="warning" icon="flag-outline" message="No se pudo cambiar el estado a «En proceso». Cámbialo desde la web." /> : null}
      <Button title="Ver ficha del ingreso" icon="arrow-forward" onPress={onDone} />
    </View> : !detail ? <View style={styles.loading}>
      {loadError ? <><Notice tone="danger" icon="cloud-offline-outline" message={loadError} /><Button title="Reintentar" icon="refresh" variant="secondary" onPress={() => void loadDetail()} /></>
        : <><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando el ingreso…</Text></>}
    </View> : <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!drawing}>
        {detail.reception.signed ? <Notice tone="info" icon="information-circle-outline" message={`Este ingreso ya fue firmado por ${detail.reception.receiverName ?? "otra persona"}. Si firmas de nuevo, se reemplaza.`} /> : null}
        {inspectionBlocked ? <View style={styles.block}>
          <Notice tone="warning" icon="clipboard-outline" message={`Antes de firmar completa la inspección de ingreso (${inspectionRequirementLabel(detail.inspections.entryRequirement).toLowerCase()}): ${check?.missing.join(" · ") || "no se pudo verificar"}.`} />
          <Button title="Ir a la inspección" icon="clipboard-outline" variant="secondary" onPress={onOpenInspection} />
        </View> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Quién recibe el equipo</Text>
          <SelectorTrigger label="Trabajador que recibe *" value={worker?.name ?? ""} icon="person-outline" disabled={saving} error={issues.worker} onPress={() => setPicker(true)} />
          {worker ? <>
            <Field label="Nombre *" value={name} onChange={(value) => { setName(value); setIssues({}); }} error={issues.name} maxLength={255} />
            <Field label="Correo" value={email} onChange={(value) => { setEmail(value); setIssues({}); }} error={issues.email} keyboardType="email-address" maxLength={100} placeholder="Opcional" />
            <Field label="Teléfono" value={phone} onChange={setPhone} keyboardType="phone-pad" maxLength={50} placeholder="Opcional" />
          </> : null}
        </View>

        {worker ? <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Firma de recepción *</Text>
          {saved === null ? <View style={styles.row}><ActivityIndicator size="small" color={palette.primary} /><Text style={styles.hint}>Buscando firmas guardadas…</Text></View> : null}
          {saved && saved.length > 0 ? <View style={styles.options}>
            {saved.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: mode.kind === "saved" && mode.id === item.id, disabled: !item.image }}
              disabled={!item.image} onPress={() => { setMode({ kind: "saved", id: item.id }); setIssues({}); }}
              style={[styles.savedOption, mode.kind === "saved" && mode.id === item.id && styles.savedOptionOn, !item.image && styles.disabled]}>
              <Ionicons name={mode.kind === "saved" && mode.id === item.id ? "radio-button-on" : "radio-button-off"} size={20} color={palette.primary} accessible={false} />
              <View style={styles.grow}>
                <Text style={styles.savedName}>Firma guardada · {item.name}{item.isDefault ? " (predeterminada)" : ""}</Text>
                {item.image ? <Image source={{ uri: item.image }} style={styles.savedImage} resizeMode="contain" accessibilityLabel={`Firma de ${item.name}`} /> : <Text style={styles.hint}>Sin imagen</Text>}
              </View>
            </Pressable>)}
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: mode.kind === "draw" }} onPress={() => setMode({ kind: "draw" })}
              style={[styles.savedOption, mode.kind === "draw" && styles.savedOptionOn]}>
              <Ionicons name={mode.kind === "draw" ? "radio-button-on" : "radio-button-off"} size={20} color={palette.primary} accessible={false} />
              <Text style={styles.savedName}>Firmar en pantalla</Text>
            </Pressable>
          </View> : null}
          {saved && saved.length === 0 && worker.userId === null ? <Text style={styles.hint}>Este trabajador no tiene usuario: firma en pantalla.</Text> : null}
          {mode.kind === "draw" ? <SignatureField label="Firma" name={name} strokes={strokes} signatureRef={pad} disabled={saving} error={issues.signature}
            onChange={(next) => { setStrokes(next); setIssues({}); }} onDrawingChange={setDrawing} /> : null}
          {chosenSaved ? <Text style={styles.hint}>Se usará la firma guardada de {chosenSaved.name}.</Text> : null}
        </View> : null}

        <View style={styles.section}>
          <Field label="Observaciones de recepción" value={observation} onChange={setObservation} maxLength={500} multiline placeholder="Opcional · máximo 500 caracteres" />
          <Text style={styles.counter}>{observation.length}/500</Text>
        </View>

        {message ? <Notice tone="danger" icon="alert-circle-outline" message={message} /> : null}
        <Button title="Terminar ingreso" icon="checkmark-done-circle-outline" loading={saving} disabled={saving || inspectionBlocked} onPress={() => void sign()} />
        <Text style={styles.footnote}>Al terminar, el ingreso queda «En proceso» y deja de aparecer como pendiente de firma.</Text>
      </ScrollView>
    </KeyboardAvoidingView>}

    {picker ? <LocalPicker<WorkshopWorker> title="Trabajador que recibe" placeholder="Buscar trabajador" emptyText="No hay trabajadores en esta sucursal."
      load={async () => (await api.workers()).items} label={(item) => item.name} detail={(item) => [item.email, item.phone].filter(Boolean).join(" · ") || null}
      selectedId={worker?.id ?? null} onClose={() => setPicker(false)} onPick={chooseWorker} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: palette.surface },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 16, fontWeight: "800", color: palette.heading },
  barStep: { ...typography.caption, color: palette.textSecondary },
  progress: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  progressStep: { flex: 1, height: 4, borderRadius: 2, backgroundColor: palette.track },
  progressOn: { backgroundColor: palette.primary },
  loading: { alignItems: "center", gap: 10, padding: 32 },
  content: { width: "100%", maxWidth: theme.contentWidth, alignSelf: "center", padding: 16, gap: 14, paddingBottom: 40 },
  block: { gap: 10 },
  section: { gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: palette.heading },
  field: { gap: 6 },
  label: { ...typography.label, color: palette.text },
  input: { minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.text },
  inputMultiline: { minHeight: 90, paddingTop: 12 },
  invalid: { borderColor: palette.danger },
  error: { ...typography.caption, color: palette.danger },
  hint: { ...typography.caption, color: palette.textSecondary },
  counter: { ...typography.caption, color: palette.textMuted, textAlign: "right" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  options: { gap: 8 },
  savedOption: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  savedOptionOn: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  savedName: { fontSize: 14, fontWeight: "700", color: palette.text },
  savedImage: { width: "100%", height: 70, marginTop: 6, backgroundColor: palette.white, borderRadius: 8 },
  grow: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.5 },
  footnote: { ...typography.caption, color: palette.textSecondary, textAlign: "center" }
});
