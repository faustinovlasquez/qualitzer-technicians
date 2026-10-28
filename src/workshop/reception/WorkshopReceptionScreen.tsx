import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, IconButton } from "../../ui/components";
import { palette, radius, theme, typography } from "../../ui/theme";
import { SelectorTrigger } from "../../ui/time/SelectorUi";
import { SignatureField } from "../../screens/orders/lifecycle/SignatureField";
import { hasSignature, requireSignaturePng, type SignaturePadHandle, type SignatureStrokes } from "../../screens/orders/lifecycle/signatureGeometry";
import { evaluateInspection, inspectionRequirementLabel, type WorkshopEntryDetail } from "../../domain/workshopEntry";
import type { WorkshopReceptionResult, WorkshopSavedSignature, WorkshopWorker } from "../../domain/workshopReception";
import type { UserSignatureAccess, UserSignatureInput } from "../../domain/userSignatures";
import { SignatureEditor } from "../../screens/signatures/SignatureEditor";
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
  // saved: firma guardada elegida · pick: tiene varias y falta elegir · draw: firma a mano en pantalla.
  const [mode, setMode] = useState<{ kind: "saved"; id: number } | { kind: "pick" } | { kind: "draw" }>({ kind: "draw" });
  const [strokes, setStrokes] = useState<SignatureStrokes>([]);
  const [drawing, setDrawing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [signaturePicker, setSignaturePicker] = useState(false);
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

  // Con una firma guardada elegida, nombre/correo/teléfono salen de ella (como en la web).
  function pickSavedSignature(item: WorkshopSavedSignature, fallbackName: string) {
    setMode({ kind: "saved", id: item.id });
    setName((item.name || fallbackName).slice(0, 255)); setEmail((item.email ?? "").slice(0, 100)); setPhone((item.phone ?? "").slice(0, 50));
    setIssues({});
  }
  function applySavedList(items: WorkshopSavedSignature[], who: WorkshopWorker) {
    setSaved(items);
    const usable = items.filter((item) => item.image);
    // Se elige sola la predeterminada de la sucursal o, si tiene una sola, esa.
    const preferred = usable.find((item) => item.isDefault) ?? (usable.length === 1 ? usable[0] : undefined);
    if (preferred) pickSavedSignature(preferred, who.name); else setMode({ kind: "pick" });
  }

  // Al elegir quién recibe: sus datos y, si tiene, su firma guardada.
  // Solo vale la respuesta del último técnico elegido (si cambian rápido, no se cruza la firma de otro).
  const chosenWorker = useRef<number | null>(null);
  function chooseWorker(next: WorkshopWorker) {
    setPicker(false); setIssues({}); setMessage("");
    chosenWorker.current = next.id;
    setWorker(next); setName(next.name.slice(0, 255)); setEmail((next.email ?? "").slice(0, 100)); setPhone((next.phone ?? "").slice(0, 50));
    setSaved(null); setMode({ kind: "pick" }); setStrokes([]);
    if (next.userId === null) { setSaved([]); setMode({ kind: "draw" }); return; }
    api.savedSignatures(next.userId).then(({ items }) => {
      if (chosenWorker.current !== next.id) return;
      applySavedList(items, next);
    }, () => { if (chosenWorker.current === next.id) { setSaved([]); setMode({ kind: "draw" }); } });
  }

  // Se propone al usuario en sesión como técnico que recibe; se puede cambiar.
  useEffect(() => {
    if (api.currentUserId <= 0) return;
    let active = true;
    api.workers().then(({ items }) => {
      const me = items.find((item) => item.id === api.currentUserId || item.userId === api.currentUserId);
      if (active && me && chosenWorker.current === null) chooseWorker(me);
    }, () => undefined);
    return () => { active = false; };
  }, [entryId]);

  // «Agregar firma»: el mismo formulario de «Mis firmas»; queda en el perfil del técnico y se usa al tiro.
  const [adding, setAdding] = useState(false);
  const [addingBusy, setAddingBusy] = useState(false);
  async function saveNewSignature(input: UserSignatureInput, scope: "all" | "some") {
    if (!worker) return;
    if (typeof input.signatureImage !== "string") throw new Error("Dibuja la firma o carga una imagen.");
    setAddingBusy(true);
    try {
      const result = await api.saveSignature(worker.id, { signatureName: input.signatureName, signatureEmail: input.signatureEmail, signaturePhone: input.signaturePhone,
        signatureImage: input.signatureImage, branchScope: scope === "all" ? "all" : "current" });
      if (chosenWorker.current === worker.id) applySavedList(result.items, worker);
      setAdding(false);
    } finally { setAddingBusy(false); }
  }
  const isMe = worker !== null && (worker.id === api.currentUserId || worker.userId === api.currentUserId);
  const addAccess: UserSignatureAccess | null = worker ? {
    scopeKey: `reception:${entryId}:${worker.id}`, userId: worker.id, branchId: api.branchId, name: worker.name, email: worker.email ?? "",
    branches: [{ id: api.branchId, name: "Esta sucursal" }], available: true,
    actions: { load: async () => { throw new Error("NOT_USED"); }, save: async () => { throw new Error("NOT_USED"); }, remove: async () => { throw new Error("NOT_USED"); } }
  } : null;

  const check = detail ? evaluateInspection(detail.inspections.entryRequirement, detail.inspections.entry, detail.inspections.photoSlots) : null;
  const inspectionBlocked = Boolean(detail && (!detail.inspections.available || !check?.met));

  async function sign() {
    if (saving || !detail) return;
    const found: Record<string, string> = {};
    if (!worker) found.worker = "Elige el técnico que recibe el equipo.";
    if (!name.trim()) found.name = "Escribe el nombre de quien recibe.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = "Revisa el correo.";
    if (mode.kind === "draw" && !hasSignature(strokes)) found.signature = "Falta la firma.";
    if (mode.kind === "pick") found.signature = saved && saved.some((item) => item.image) ? "Elige la firma a usar." : "Agrega la firma del técnico.";
    if (Object.keys(found).length > 0 || !worker) { setIssues(found); setMessage("Revisa los datos marcados."); return; }
    setSaving(true); setMessage("");
    try {
      if (mode.kind === "pick") return;
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
          <SelectorTrigger label="Técnico que recibe *" value={worker ? `${worker.name}${isMe ? " (Tú)" : ""}` : ""} icon="person-outline" disabled={saving} error={issues.worker} onPress={() => setPicker(true)} />
          {worker ? <View style={styles.person}>
            {worker.avatar ? <Image source={{ uri: worker.avatar }} style={styles.avatar} accessibilityLabel={`Foto de ${worker.name}`} />
              : <View style={[styles.avatar, { backgroundColor: worker.avatarColor ?? palette.primary }]}><Text style={styles.avatarText}>{initials(worker.name)}</Text></View>}
            <View style={styles.grow}>
              <Text style={styles.savedName} numberOfLines={1}>{worker.name}{isMe ? " · Tú" : ""}</Text>
              {worker.email ? <Text style={styles.hint} numberOfLines={1}>{worker.email}</Text> : null}
            </View>
          </View> : null}
        </View>

        {worker ? <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Firma de recepción *</Text>
          {saved === null ? <View style={styles.row}><ActivityIndicator size="small" color={palette.primary} /><Text style={styles.hint}>Buscando su firma…</Text></View> : null}

          {saved !== null && mode.kind !== "draw" && saved.some((item) => item.image) ? <>
            {/* Como en la web: Firma (con «+» para agregar otra) → Datos de la firma → Firma de quien recibe. */}
            <View style={styles.pickRow}>
              <View style={styles.grow}>
                <SelectorTrigger label="Firma *" value={chosenSaved ? `${chosenSaved.name}${chosenSaved.isDefault ? " · predeterminada" : ""}` : ""} icon="ribbon-outline"
                  disabled={saving} error={issues.signature} onPress={() => setSignaturePicker(true)} />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Agregar otra firma" disabled={saving} onPress={() => setAdding(true)} style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}>
                <Ionicons name="add" size={22} color={palette.primary} />
              </Pressable>
            </View>
            {mode.kind === "pick" ? <Text style={styles.warn}>Tiene varias firmas: elige cuál usar.</Text> : null}
            {chosenSaved ? <View style={styles.data}>
              <Text style={styles.dataTitle}>Datos de la firma</Text>
              {[["Nombre", chosenSaved.name || worker.name], ["Correo", chosenSaved.email], ["Teléfono", chosenSaved.phone]].map(([label, value]) =>
                <View key={label} style={styles.dataRow}><Text style={styles.hint}>{label}</Text><Text style={value ? styles.dataValue : styles.dataMissing}>{value || "No registrado"}</Text></View>)}
              <Text style={styles.hint}>{chosenSaved.email && chosenSaved.phone ? "Estos datos vienen de la firma elegida." : "A esta firma le faltan datos: complétalos en Perfil › Firmas."}</Text>
            </View> : null}
            {chosenSaved?.image ? <View style={styles.preview}>
              <Text style={styles.dataTitle}>Firma de quien recibe</Text>
              <View style={styles.previewBadge}><Ionicons name="checkmark-circle" size={14} color={palette.primary} /><Text style={styles.previewBadgeText}>{isMe ? "Se usará tu firma configurada" : "Se usará su firma configurada"}</Text></View>
              <Image source={{ uri: chosenSaved.image }} style={styles.previewImage} resizeMode="contain" accessibilityLabel={`Firma de ${chosenSaved.name}`} />
              <View style={styles.previewFooter}>
                <Text style={styles.previewName}>{(chosenSaved.name || worker.name).toUpperCase()}</Text>
                {chosenSaved.phone ? <Text style={styles.previewLine}>{chosenSaved.phone}</Text> : null}
                {chosenSaved.email ? <Text style={styles.previewLine}>{chosenSaved.email}</Text> : null}
              </View>
            </View> : null}
            <Pressable accessibilityRole="button" onPress={() => { setMode({ kind: "draw" }); setStrokes([]); setIssues({}); }} style={styles.link}>
              <Ionicons name="create-outline" size={16} color={palette.primary} /><Text style={styles.linkText}>Firmar a mano en su lugar</Text>
            </Pressable>
          </> : null}

          {saved !== null && !saved.some((item) => item.image) && mode.kind !== "draw" ? <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="create" size={24} color={palette.orange} /></View>
            <Text style={styles.emptyTitle}>{isMe ? "No tienes una firma configurada" : `${worker.name} no tiene una firma configurada`}</Text>
            <Text style={styles.emptyText}>Agrégala ahora: queda guardada en {isMe ? "tu" : "su"} perfil y la próxima vez se aplicará sola.</Text>
            <Button title="Agregar firma" icon="add-circle-outline" variant="warning" disabled={saving} onPress={() => setAdding(true)} />
            {issues.signature ? <Text style={styles.error} accessibilityRole="alert">{issues.signature}</Text> : null}
          </View> : null}

          {mode.kind === "draw" ? <>
            <Field label="Nombre *" value={name} onChange={(value) => { setName(value); setIssues({}); }} error={issues.name} maxLength={255} />
            <Field label="Correo" value={email} onChange={(value) => { setEmail(value); setIssues({}); }} error={issues.email} keyboardType="email-address" maxLength={100} placeholder="Opcional" />
            <Field label="Teléfono" value={phone} onChange={setPhone} keyboardType="phone-pad" maxLength={50} placeholder="Opcional" />
            <SignatureField label="Firma" name={name} strokes={strokes} signatureRef={pad} disabled={saving} error={issues.signature}
              onChange={(next) => { setStrokes(next); setIssues({}); }} onDrawingChange={setDrawing} />
            {saved && saved.length > 0 ? <Pressable accessibilityRole="button" onPress={() => { if (worker) applySavedList(saved, worker); }} style={styles.link}>
              <Ionicons name="ribbon-outline" size={16} color={palette.primary} /><Text style={styles.linkText}>Usar la firma configurada</Text>
            </Pressable> : null}
          </> : null}
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

    {picker ? <LocalPicker<WorkshopWorker> title="Técnico que recibe" placeholder="Buscar por nombre o correo" emptyText="No hay usuarios en esta sucursal."
      load={async () => (await api.workers()).items} label={(item) => item.id === api.currentUserId ? `${item.name} · Tú` : item.name} detail={(item) => [item.email, item.phone].filter(Boolean).join(" · ") || null}
      selectedId={worker?.id ?? null} onClose={() => setPicker(false)} onPick={chooseWorker} /> : null}

    {signaturePicker && saved && worker ? <LocalPicker<WorkshopSavedSignature> title="Firma" placeholder="Buscar firma" emptyText="No tiene firmas con imagen."
      load={async () => saved.filter((item) => item.image)} label={(item) => `${item.name}${item.isDefault ? " · predeterminada" : ""}`} detail={(item) => [item.email, item.phone].filter(Boolean).join(" · ") || null}
      selectedId={chosenSaved?.id ?? null} onClose={() => setSignaturePicker(false)} onPick={(item) => { setSignaturePicker(false); pickSavedSignature(item, worker.name); }}
      action={{ label: "Agregar otra firma", onPress: () => { setSignaturePicker(false); setAdding(true); } }} /> : null}

    {adding && addAccess ? <Modal visible animationType="slide" onRequestClose={() => { if (!addingBusy) setAdding(false); }}>
      <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
        <SignatureEditor access={addAccess} existing={null} signatures={[]} busy={addingBusy} title={isMe ? "Agregar mi firma" : `Agregar firma de ${worker?.name ?? "el técnico"}`}
          onSave={saveNewSignature} onCancel={() => { if (!addingBusy) setAdding(false); }} />
      </SafeAreaView>
    </Modal> : null}
  </View>;
}

const initials = (value: string) => value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

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
  footnote: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  person: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: palette.background },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: palette.white, fontSize: 14, fontWeight: "800" },
  warn: { ...typography.caption, color: palette.orange, fontWeight: "700" },
  data: { gap: 6, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  dataTitle: { fontSize: 12, fontWeight: "800", color: palette.textSecondary, textTransform: "uppercase" },
  dataRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  dataValue: { fontSize: 14, fontWeight: "700", color: palette.text, flexShrink: 1, textAlign: "right" },
  dataMissing: { fontSize: 13, fontStyle: "italic", color: palette.textMuted },
  link: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6 },
  linkText: { fontSize: 14, fontWeight: "700", color: palette.primary },
  empty: { alignItems: "center", gap: 10, padding: 16, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.orange, backgroundColor: palette.orangeSoft },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: palette.text, textAlign: "center" },
  emptyText: { ...typography.caption, color: palette.textSecondary, textAlign: "center" },
  pickRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  addButton: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, alignItems: "center", justifyContent: "center" },
  addButtonPressed: { backgroundColor: palette.primarySoft },
  preview: { gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.primary, backgroundColor: palette.background },
  previewBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: palette.primarySoft },
  previewBadgeText: { fontSize: 12, fontWeight: "700", color: palette.primary },
  previewImage: { width: "100%", height: 130, backgroundColor: palette.white, borderRadius: 8 },
  previewFooter: { alignItems: "center", gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.border },
  previewName: { fontSize: 14, fontWeight: "800", color: palette.text },
  previewLine: { fontSize: 12, fontWeight: "600", color: palette.textSecondary }
});
