import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { creationOptionsSchema, creationResultSchema, type CreationInput, type CreationKind, type CreationOptions, type CreationOptionsQuery, type CreationResult } from "../../domain/creation";
import { assignmentWorkCode } from "../../domain/assignmentCodes";
import type { Assignments, Tenant, User } from "../../domain/models";
import { isOfflineQueuedError, type OfflineQueuedOutcome } from "../../domain/offline";
import { queuedCreationOutcomeSchema, queuedOutcomeData } from "../offline/offlineUi";
import { scheduleClock } from "../../domain/weeklySchedule";
import { useDeviceSecurity } from "../../security/DeviceSecurityContext";
import { Badge, Button, Card, Field, IconButton } from "../../ui/components";
import { TimeField } from "../../ui/time/TimeField";
import { palette, radius, typography } from "../../ui/theme";
import { CreationCatalogSelector, type CreationCatalogCache } from "./CreationCatalogSelector";
import { CreationDatePicker } from "./CreationDatePicker";
import { CreationEquipmentLookup } from "./CreationEquipmentLookup";
import { CreationFields, creationLabels, priorityLabels } from "./CreationFields";
import { CreationModal } from "./CreationModal";
import { creationDraftKey, openCreationDraftStore } from "./creationDrafts";
import { creationConflictPreview, creationDuration, creationPayload, emptyCreationForm, validateCreationForm, type CreationDraft, type CreationForm, type CreationFormErrors } from "./creationForm";

export { clearCreationDrafts } from "./creationDrafts";
export type { CreationInput, CreationKind, CreationOptions, CreationOptionsQuery, CreationResult } from "../../domain/creation";

export interface CreationScreenProps {
  kind: CreationKind;
  user: User;
  tenant: Tenant;
  connectionStatus?: ReactNode;
  companyBranchId: number;
  initialDate: string;
  data: Assignments | null;
  mode: "live" | "demo";
  busy?: boolean;
  storageKey: string;
  onBack: () => void;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
  onSubmit: (input: CreationInput) => Promise<CreationResult>;
  onCreated?: (result: CreationResult) => void | Promise<void>;
  onQueued?: (outcome: OfflineQueuedOutcome) => void | Promise<void>;
}

export function CreationScreen(props: CreationScreenProps) {
  const scope = creationDraftKey(props.storageKey, props.tenant.id, props.user.id, props.companyBranchId, props.kind, props.mode);
  return <CreationScreenContent key={scope} {...props} draftKey={scope} />;
}

const steps = ["Datos", "Horario", "Revisar"];
const serverMessages = new Map<string, string>([
  ["MOBILE_CREATION_INVALID_LOCAL_TIME", "Esa hora local no existe por el cambio de horario. Elige otra franja."],
  ["MOBILE_CREATION_AMBIGUOUS_LOCAL_TIME", "La franja contiene una hora ambigua por cambio de horario."],
  ["MOBILE_CREATION_DST_TRANSITION_UNSUPPORTED", "No se admite una franja que atraviese un cambio de horario."],
  ["MOBILE_CREATION_REQUEST_CONFLICT", "Este identificador ya se usó con otra solicitud. Revisa tu agenda antes de crear otra."],
  ["MOBILE_CREATION_EQUIPMENT_NOT_FOUND", "El equipo ya no está disponible."],
  ["MOBILE_CREATION_SPECIALTY_NOT_FOUND", "La especialidad ya no está disponible."],
  ["MOBILE_CREATION_TIMEZONE_NOT_CONFIGURED", "La sucursal no tiene una zona horaria válida configurada."],
  ["MOBILE_CREATION_SCHEMA_NOT_READY", "La creación móvil aún no está habilitada en el servidor."],
  ["MOBILE_CREATION_ACTOR_NOT_AUTHORIZED", "Tu sesión no tiene acceso a esta creación."],
]);

function submissionError(error: unknown): string {
  return error instanceof Error ? serverMessages.get(error.message) ?? "No se confirmó la creación. Puede haberse recibido en el servidor." : "No se confirmó la creación. Puede haberse recibido en el servidor.";
}

function CreationScreenContent({ kind, user, tenant, connectionStatus, companyBranchId, initialDate, data, mode, busy = false, onBack, onLoadOptions, onSubmit, onCreated, onQueued, draftKey }: CreationScreenProps & { draftKey: string }) {
  const security = useDeviceSecurity();
  const store = useMemo(() => openCreationDraftStore(draftKey, kind, companyBranchId), [draftKey, kind, companyBranchId]);
  const catalogCache = useMemo<CreationCatalogCache>(() => new Map(), [draftKey]);
  const [draft, setDraft] = useState<CreationDraft>(() => ({ version: 1, kind, phase: "editing", form: emptyCreationForm(initialDate) }));
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [options, setOptions] = useState<CreationOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<CreationFormErrors>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [dialog, setDialog] = useState<"back" | "new" | "invalid" | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [catalog, setCatalog] = useState<"equipment" | "specialties" | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ busy, onBack, onSubmit, onCreated, onQueued, isUnlocked: security.isUnlocked });
  latest.current = { busy, onBack, onSubmit, onCreated, onQueued, isUnlocked: security.isUnlocked };
  const changed = useRef(false);
  const loadOptionsRef = useRef(onLoadOptions);
  loadOptionsRef.current = onLoadOptions;
  const form = draft.form;
  const frozen = draft.phase !== "editing" || !ready || busy || sending;
  const minutes = creationDuration(form);
  const preview = useMemo(() => creationConflictPreview(data, { date: form.date, startTime: form.startTime, endTime: form.endTime }), [data, form.date, form.startTime, form.endTime]);
  const branch = user.accessBranchs.find((item) => item.id === companyBranchId);

  function replaceDraft(next: CreationDraft): void { current.current = next; setDraft(next); }

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void store.read().then((saved) => {
      if (!active) return;
      if (saved) { replaceDraft(saved); changed.current = true; if (saved.phase !== "editing") setStep(2); }
      setReady(true);
    }).catch(() => {
      if (active) setDraftError("No se pudo recuperar un borrador válido. No se enviará nada. Si antes enviaste una solicitud, revisa tu agenda antes de descartarlo.");
    });
    return () => { active = false; mounted.current = false; };
  }, [store]);

  useEffect(() => {
    let active = true;
    setLoadingOptions(true);
    setOptionsError("");
    void loadOptionsRef.current({ companyBranchId }).then((value) => {
      const result = creationOptionsSchema.parse(value);
      if (result.companyBranchId !== companyBranchId || result.userId !== user.id || result.workerId !== user.workerId || !scheduleClock(result.timezone)) throw new Error("CREATION_OPTIONS_CONTEXT_MISMATCH");
      if (!active) return;
      setOptions(result);
      if (result.equipment) catalogCache.set(JSON.stringify(["equipment", "", result.equipment.page]), result.equipment);
      if (result.specialties) catalogCache.set(JSON.stringify(["specialties", "", result.specialties.page]), result.specialties);
    }).catch(() => {
      if (active) { setOptions(null); setOptionsError("No se pudieron cargar las opciones y la zona horaria de esta sucursal. Reintenta antes de crear."); }
    }).finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [companyBranchId, user.id, user.workerId, reload, catalogCache]);

  useEffect(() => {
    if (!ready || draft.phase !== "editing" || !changed.current) return;
    const timer = setTimeout(() => {
      if (current.current !== draft) return;
      void store.write(draft).then(() => { if (mounted.current && current.current === draft) setSaveError(""); }).catch(() => {
        if (mounted.current) setSaveError("No se pudo guardar el borrador en este dispositivo. No cierres la app hasta reintentar.");
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, ready, store]);

  function requestBack(): void {
    if (lock.current || busy) return;
    if (current.current.phase === "confirmed" || current.current.phase === "queued" || (!changed.current && !draftError)) onBack();
    else setDialog("back");
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { requestBack(); return true; });
    return () => subscription.remove();
  }, [busy, draftError, onBack]);

  function change<Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]): void {
    if (lock.current || frozen || current.current.phase !== "editing") return;
    changed.current = true;
    replaceDraft({ ...current.current, form: { ...current.current.form, [field]: value } });
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setError("");
  }

  function checkForm(all: boolean): boolean {
    const next = validateCreationForm(kind, current.current.form);
    if (!all) { delete next.date; delete next.startTime; delete next.endTime; }
    setErrors(next);
    if (Object.keys(next).length) { setError("Revisa los campos indicados antes de continuar."); return false; }
    setError("");
    return true;
  }

  async function submit(): Promise<void> {
    if (!mounted.current || !latest.current.isUnlocked() || lock.current || latest.current.busy || !ready || !options || current.current.phase === "confirmed" || current.current.phase === "queued") return;
    if (current.current.phase === "editing" && !checkForm(true)) return;
    lock.current = true;
    setSending(true);
    setError("");
    try {
      let pending = current.current;
      if (pending.phase === "editing") {
        if ((kind !== "non_productive" && !options.priorities.includes(pending.form.priority)) ||
          (kind === "maintenance" && !options.maintenanceTypes.some((item) => item.value === pending.form.maintenanceType && item.enabled)) ||
          (kind === "non_productive" && !options.nonProductiveReasons.some((item) => item.value === pending.form.reason))) throw new Error("CREATION_OPTION_UNAVAILABLE");
        const input = creationPayload(kind, pending.form, companyBranchId, Crypto.randomUUID());
        pending = { ...pending, phase: "pending", input };
        replaceDraft(pending);
        changed.current = true;
      }
      if (pending.phase !== "pending") return;
      await store.write(pending);
      if (!mounted.current || !latest.current.isUnlocked()) return;
      const result = creationResultSchema.parse(await latest.current.onSubmit(pending.input));
      if (result.kind !== kind || result.companyBranchId !== companyBranchId || result.schedule.date !== pending.input.schedule.date ||
        result.schedule.startTime !== pending.input.schedule.startTime || result.schedule.endTime !== pending.input.schedule.endTime) throw new Error("CREATION_RESULT_MISMATCH");
      const completed: CreationDraft = { ...pending, phase: "confirmed", result };
      current.current = completed;
      if (mounted.current) { setDraft(completed); setErrors({}); setError(""); }
      await persistAndOpen(completed, true);
    } catch (failure) {
      if (isOfflineQueuedError(failure) && current.current.phase === "pending") {
        const outcome = queuedCreationOutcomeSchema.safeParse(queuedOutcomeData(failure));
        if (outcome.success && outcome.data.operationId === current.current.input.clientRequestId && outcome.data.date === current.current.input.schedule.date) {
          const queued: CreationDraft = { ...current.current, phase: "queued", outcome: outcome.data };
          current.current = queued;
          if (mounted.current) { setDraft(queued); setError(""); }
          await persistAndOpen(queued, true);
        } else if (mounted.current) setError("Se recibió un resultado local que no corresponde a esta solicitud. Revisa el centro offline antes de continuar.");
      } else if (mounted.current) setError(current.current.phase === "pending" ? `${submissionError(failure)} Reintenta la misma solicitud o elige explícitamente editar como nueva.` : "No se pudo preparar la solicitud. Comprueba los campos y las opciones; no se envió ninguna creación.");
    } finally {
      lock.current = false;
      if (mounted.current) setSending(false);
    }
  }

  async function leaveWithDraft(): Promise<void> {
    if (lock.current) return;
    if (draftError) { setDialog(null); onBack(); return; }
    lock.current = true;
    setSending(true);
    try { await store.write(current.current); setDialog(null); onBack(); }
    catch { setSaveError("No se pudo guardar el borrador. Permanece aquí y reintenta para no perder la solicitud."); setDialog(null); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }

  async function editAsNew(resetForm: boolean): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    try {
      const next: CreationDraft = { version: 1, kind, phase: "editing", form: resetForm ? emptyCreationForm(initialDate) : current.current.form };
      await store.reset();
      await store.write(next);
      replaceDraft(next);
      setReady(true);
      setDraftError(""); setSaveError(""); setError(""); setErrors({}); setStep(0); setDialog(null);
      changed.current = !resetForm;
    } catch { setSaveError("No se pudo preparar un nuevo borrador. La solicitud anterior no se ha vuelto a enviar."); setDialog(null); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }

  async function persistAndOpen(saved: Extract<CreationDraft, { phase: "confirmed" | "queued" }>, automatic: boolean): Promise<void> {
    try {
      await store.write(saved);
    } catch {
      if (mounted.current) setSaveError(saved.phase === "queued"
        ? "La solicitud está en la cola duradera. No vuelvas a crearla; falta guardar el estado de esta pantalla. Usa Ver trabajo local para reintentar."
        : "La creación está confirmada, pero no se pudo guardar la confirmación local. No vuelvas a crearla; reintenta guardar la confirmación.");
      return;
    }
    if (!mounted.current || current.current !== saved) return;
    setSaveError("");
    if (!latest.current.isUnlocked()) return;
    if (automatic && !(saved.phase === "queued" ? latest.current.onQueued : latest.current.onCreated)) return;
    try {
      if (saved.phase === "queued" && latest.current.onQueued) await latest.current.onQueued(saved.outcome);
      else if (saved.phase === "confirmed" && latest.current.onCreated) await latest.current.onCreated(saved.result);
      else latest.current.onBack();
    } catch {
      if (mounted.current) setSaveError(saved.phase === "queued"
        ? "El trabajo sigue guardado en la cola local. No se pudo abrir la ficha; usa Ver trabajo local para reintentar sin crear otro."
        : "La creación está confirmada. No se pudo abrir la agenda; reintenta sin volver a crear.");
    }
  }

  const confirmedResult = draft.phase === "confirmed" ? draft.result : null;
  async function openSaved(): Promise<void> {
    if (!mounted.current || !latest.current.isUnlocked() || latest.current.busy || lock.current) return;
    const saved = current.current;
    if (saved.phase !== "confirmed" && saved.phase !== "queued") return;
    lock.current = true;
    setSending(true);
    try { await persistAndOpen(saved, false); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }
  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <IconButton name="arrow-back" label="Volver conservando borrador" disabled={busy || sending} onPress={requestBack} />
        <View style={styles.headerText}><Text style={styles.eyebrow}>CREACIÓN MÓVIL</Text><Text accessibilityRole="header" style={styles.title}>{creationLabels[kind]}</Text></View>
      </View>
      {connectionStatus}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.context}>{tenant.name} · {branch?.name ?? `Sucursal ${companyBranchId}`} · {user.name} {user.lastnames}</Text>
        {mode === "demo" ? <Badge label="Demostración · no crea registros reales" tone="warning" /> : null}
        {draft.phase === "queued" ? <Card style={styles.card}>
          <Badge label="Trabajo local · pendiente" tone="warning" />
          <Text accessibilityRole="header" style={styles.title}>Guardado en este dispositivo · Pendiente de sincronizar</Text>
          <Text style={styles.body}>{draft.form.title || creationLabels[kind]}</Text>
          <Text style={styles.body}>{draft.input.schedule.date} · {draft.input.schedule.startTime}–{draft.input.schedule.endTime}</Text>
          <Text style={styles.hint}>No está confirmado por Qualitzer. La cola conserva la misma solicitud; no hace falta volver a crearla. Puedes añadir archivos y comentarios al trabajo local.</Text>
          <Button title="Ver trabajo local" loading={sending} disabled={busy} onPress={() => void openSaved()} />
        </Card> : confirmedResult ? <Card style={styles.card}>
          <Badge label={mode === "demo" ? "Simulación confirmada" : "Creación confirmada"} tone="success" />
          <Text accessibilityRole="header" style={styles.title}>{mode === "demo" ? "La simulación está lista" : "Tu planificación está lista"}</Text>
          <Text selectable style={styles.body}>Referencia: {confirmedResult.groupId}</Text>
          <Text selectable style={styles.body}>{confirmedResult.kind === "maintenance" ? `Trabajo de mantenimiento #${confirmedResult.workId}` : assignmentWorkCode({ id: String(confirmedResult.workId) })}</Text>
          <Text style={styles.body}>{confirmedResult.schedule.date} · {confirmedResult.schedule.startTime}–{confirmedResult.schedule.endTime}</Text>
          <Text style={styles.body}>{confirmedResult.schedule.plannedMinutes} min · {confirmedResult.schedule.timezone}</Text>
          <Text style={styles.hint}>La creación ya se confirmó. Abrir o actualizar la agenda no volverá a enviarla.</Text>
          <Button title="Ver en mi agenda" loading={sending} disabled={busy} onPress={() => void openSaved()} />
          <Button title="Crear otro" variant="secondary" disabled={sending || busy} onPress={() => void editAsNew(true)} />
        </Card> : <>
          <View style={styles.steps} accessibilityLabel={`Paso ${step + 1} de 3: ${steps[step]}`}>
            {steps.map((label, index) => <View key={label} style={[styles.step, index === step && styles.activeStep]}><Text style={[styles.stepText, index === step && styles.activeStepText]}>{index + 1}. {label}</Text></View>)}
          </View>
          {draftError ? <Card style={styles.card}><Text accessibilityRole="alert" style={styles.warning}>{draftError}</Text><Button title="Descartar borrador no recuperable" variant="secondary" onPress={() => setDialog("invalid")} /></Card> : null}
          {!ready && !draftError ? <ActivityIndicator accessibilityLabel="Recuperando borrador" color={palette.primary} /> : null}
          {loadingOptions ? <ActivityIndicator accessibilityLabel="Cargando opciones de creación" color={palette.primary} /> : null}
          {optionsError ? <Card style={styles.card}><Text accessibilityRole="alert" style={styles.warning}>{optionsError}</Text><Button title="Reintentar opciones" variant="secondary" onPress={() => setReload((value) => value + 1)} /></Card> : null}
          {ready && options ? <>
            {draft.phase === "pending" ? <Card style={styles.card}>
              <Text accessibilityRole="alert" style={styles.warning}>Solicitud pendiente de confirmación. Los campos están bloqueados para conservar exactamente el mismo cuerpo y UUID, aunque cierres y vuelvas.</Text>
              <Text style={styles.hint}>Si se perdió la conexión, usa Reintentar misma solicitud. Crear otra puede duplicar una operación ya recibida.</Text>
            </Card> : null}
            {step === 0 ? <Card><CreationFields kind={kind} form={form} errors={errors} options={options} disabled={frozen} onChange={change} onSelectCatalog={setCatalog}
              equipmentLookup={<CreationEquipmentLookup companyBranchId={companyBranchId} userId={user.id} workerId={user.workerId}
                required={kind === "maintenance"} disabled={frozen} selected={form.equipment} error={errors.equipment} cache={catalogCache}
                onLoadOptions={onLoadOptions} onSelect={(item) => change("equipment", item)} onBrowse={() => setCatalog("equipment")} />} /></Card> : null}
            {step === 1 ? <Card style={styles.card}>
              <Text accessibilityRole="header" style={styles.heading}>¿Cuándo lo realizarás?</Text>
              <Field label="Fecha *" value={form.date} maxLength={10} autoCapitalize="none" placeholder="YYYY-MM-DD" editable={!frozen} error={errors.date}
                onChangeText={(value) => change("date", value)} hint="Formato año-mes-día; por ejemplo 2026-09-10." />
              <Button title="Elegir fecha en calendario" icon="calendar-outline" variant="secondary" disabled={frozen} onPress={() => setCalendar(true)} />
              <TimeField label="Hora de inicio *" value={form.startTime} disabled={frozen} error={errors.startTime} onChange={(value) => change("startTime", value)} scopeKey={JSON.stringify([draftKey, form.date])} hint="Formato de 24 horas (HH:mm)." />
              <TimeField label="Hora de fin *" value={form.endTime} disabled={frozen} error={errors.endTime} onChange={(value) => change("endTime", value)} scopeKey={JSON.stringify([draftKey, form.date])} hint="Debe ser posterior al inicio." />
              <Text accessibilityLiveRegion="polite" style={styles.body}>Duración prevista: {minutes === null ? "completa un horario válido" : `${minutes} min (${Math.floor(minutes / 60)} h ${minutes % 60} min)`}</Text>
              <Text style={styles.body}>Zona horaria de la sucursal: {options.timezone}</Text>
              <Text style={styles.hint}>Un solo día, sin pausas automáticas. Para cruzar medianoche o repetir, divide la planificación desde la web. El servidor verifica los cambios de horario.</Text>
            </Card> : null}
            {step === 2 ? <Card style={styles.card}>
              <Text accessibilityRole="header" style={styles.heading}>Revisa antes de crear</Text>
              {kind !== "non_productive" ? <>
                <Text style={styles.reviewTitle}>{form.title.trim()}</Text>
                <Text style={styles.body}>{kind === "work" ? form.summary.trim() : form.motive.trim()}</Text>
                {kind === "maintenance" ? <Text style={styles.body}>Tipo: {form.maintenanceType === "correctivo" ? "Correctivo" : "Detención"}</Text> : null}
                <Text style={styles.body}>Prioridad: {priorityLabels[form.priority]}</Text>
                <Text style={styles.body}>{form.equipment ? `Equipo: ${form.equipment.label} · ID ${form.equipment.id}` : "Sin equipo asociado"}</Text>
                {form.specialty ? <Text style={styles.body}>Especialidad: {form.specialty.label}</Text> : null}
                {kind === "maintenance" && form.damageType ? <Text style={styles.body}>Daño: {form.damageType === "desgaste" ? "Desgaste" : "Operacional"}</Text> : null}
              </> : <>
                <Text style={styles.reviewTitle}>{options.nonProductiveReasons.find((item) => item.value === form.reason)?.label ?? form.reason}</Text>
                {form.reasonText.trim() ? <Text style={styles.body}>{form.reasonText.trim()}</Text> : null}
                {form.initialComment.trim() ? <Text style={styles.body}>Comentario: {form.initialComment.trim()}</Text> : null}
              </>}
              <Text style={styles.body}>{form.date} · {form.startTime}–{form.endTime}</Text>
              <Text style={styles.body}>{minutes ?? "—"} min · {options.timezone}</Text>
              <Text style={styles.hint}>Se asignará a tu trabajador activo en esta sucursal, sin iniciar su ejecución.</Text>
            </Card> : null}
            {step > 0 ? <Card style={styles.card}>
              <Text style={styles.warning}>{preview.message}</Text>
              {preview.overlaps.map((title) => <Text key={title} style={styles.body}>• {title}</Text>)}
              {preview.generatedAt ? <Text style={styles.hint}>Datos cargados: {preview.generatedAt}</Text> : null}
            </Card> : null}
            {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            {step < 2 ? <Button title={step === 0 ? "Continuar a horario" : "Revisar solicitud"} disabled={frozen} onPress={() => { if (checkForm(step === 1)) setStep(step + 1); }} /> : <>
              <Button title={draft.phase === "pending" ? "Reintentar misma solicitud" : mode === "demo" ? "Simular creación" : "Confirmar y crear"} icon="checkmark-outline" loading={sending} disabled={busy || loadingOptions} onPress={() => void submit()} />
              {draft.phase === "pending" ? <Button title="Editar como nueva solicitud" variant="secondary" disabled={busy || sending} onPress={() => setDialog("new")} /> : null}
            </>}
            {step > 0 && draft.phase === "editing" ? <Button title="Paso anterior" variant="ghost" disabled={sending || busy} onPress={() => { setStep(step - 1); setError(""); }} /> : null}
            <Text style={styles.hint}>El borrador se conserva en este dispositivo para esta sesión, empresa, sucursal y tipo de creación.</Text>
          </> : null}
        </>}
        {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
    {calendar && !frozen ? <CreationDatePicker value={form.date} onChange={(value) => change("date", value)} onClose={() => setCalendar(false)} /> : null}
    {catalog && !frozen ? <CreationCatalogSelector resource={catalog} companyBranchId={companyBranchId} userId={user.id} workerId={user.workerId} cache={catalogCache}
      selected={catalog === "equipment" ? form.equipment : form.specialty} onLoadOptions={onLoadOptions} onClose={() => setCatalog(null)}
      onSelect={(item) => change(catalog === "equipment" ? "equipment" : "specialty", item)} /> : null}
    {dialog ? <CreationModal title={dialog === "back" ? "Volver sin perder tu solicitud" : "Crear una nueva solicitud"} onClose={() => { if (!lock.current) setDialog(null); }}>
      <Text style={styles.body}>{dialog === "back" ? "Se conservará el borrador. Si ya intentaste enviarlo, al volver podrás reintentar con el mismo identificador sin duplicarlo." : "La solicitud anterior podría haberse creado aunque no recibieras respuesta. Revisa tu agenda primero. Continuar descarta su identificador y el próximo envío será una solicitud nueva: podría generar un duplicado."}</Text>
      <Button title={dialog === "back" ? "Guardar borrador y volver" : "Entiendo: editar como nueva solicitud"} loading={sending} onPress={() => { if (dialog === "back") void leaveWithDraft(); else void editAsNew(dialog === "invalid"); }} />
      <Button title="Seguir aquí" variant="secondary" disabled={sending} onPress={() => setDialog(null)} />
    </CreationModal> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.border },
  headerText: { flex: 1, gap: 3 }, eyebrow: { ...typography.overline, color: palette.primary }, title: { ...typography.heading, color: palette.text },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 20, paddingBottom: 40, gap: 16 },
  context: { ...typography.caption, color: palette.textSecondary }, card: { gap: 14 },
  steps: { flexDirection: "row", gap: 6 }, step: { flex: 1, minHeight: 44, borderRadius: radius.sm, backgroundColor: palette.track, justifyContent: "center", alignItems: "center", padding: 8 },
  activeStep: { backgroundColor: palette.primarySoft }, stepText: { ...typography.caption, color: palette.textSecondary }, activeStepText: { color: palette.primary, fontWeight: "800" },
  heading: { ...typography.heading, color: palette.text }, body: { ...typography.body, color: palette.text }, reviewTitle: { ...typography.heading, color: palette.text },
  warning: { ...typography.body, color: palette.amber }, hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.body, color: palette.danger },
});