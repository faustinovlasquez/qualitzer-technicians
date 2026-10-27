import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { creationOptionsSchema, creationResultSchema, type CreationCatalogResource, type CreationInput, type CreationKind, type CreationOptions, type CreationOptionsQuery, type CreationResult } from "../../domain/creation";
import { assignmentWorkCode } from "../../domain/assignmentCodes";
import type { Assignments, Tenant, User } from "../../domain/models";
import { isOfflineQueuedError, type OfflineQueuedOutcome, type OfflineSnapshot } from "../../domain/offline";
import { queuedCreationOutcomeSchema, queuedOutcomeData } from "../offline/offlineUi";
import { scheduleClock } from "../../domain/weeklySchedule";
import { useDeviceSecurity } from "../../security/DeviceSecurityContext";
import { Badge, Button, Card, Field, IconButton } from "../../ui/components";
import { palette, radius, typography } from "../../ui/theme";
import { CreationCatalogSelector, type CreationCatalogCache } from "./CreationCatalogSelector";
import { CreationScheduleFields } from "./CreationScheduleFields";
import { WorkEditScreen, type WorkEditScreenProps } from "./WorkEditScreen";
import { CreationEquipmentLookup } from "./CreationEquipmentLookup";
import { CreationFields, LinkedEquipmentCard, creationLabels, priorityLabels } from "./CreationFields";
import { CreationModal } from "./CreationModal";
import { CreationDone, CreationReview, CreationStepper } from "./CreationUi";
import { creationDraftKey, openCreationDraftStore } from "./creationDrafts";
import { applyCatalogSelection, catalogFormField, creationAssignedMinutes, creationConflictPreview, creationDuration, durationText, creationPayload, emptyCreationForm, queuedCreationState, validateCreationForm, type CatalogItem, type CreationDraft, type CreationForm, type CreationFormErrors } from "./creationForm";

export { clearCreationDrafts } from "./creationDrafts";
export type { CreationInput, CreationKind, CreationOptions, CreationOptionsQuery, CreationResult } from "../../domain/creation";

export interface CreationScreenProps {
  parentMaintenance?: { id: number; code: string; equipment: import("../../domain/models").Equipment | null };
  /** Trabajo de un ingreso a taller: el equipo y el cliente los pone el servidor desde el ingreso. */
  parentEntry?: { id: number; code: string; equipmentLabel: string };
  kind: CreationKind;
  user: User;
  tenant: Tenant;
  connectionStatus?: ReactNode;
  companyBranchId: number;
  initialDate: string;
  data: Assignments | null;
  offline?: OfflineSnapshot | null;
  mode: "live" | "demo";
  busy?: boolean;
  storageKey: string;
  onBack: () => void;
  onLoadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>;
  onSubmit: (input: CreationInput) => Promise<CreationResult>;
  onCreated?: (result: CreationResult) => void | Promise<void>;
  onQueued?: (outcome: OfflineQueuedOutcome) => void | Promise<void>;
  /** Al confirmar, en vez de abrir el trabajo se muestra la ventana de éxito: ver los trabajos, crear otro o abrir el creado. */
  successFlow?: { viewLabel: string; onConfirmed?: (result: CreationResult) => void; onView: (result: CreationResult) => void; subtitle?: string; hideOpen?: boolean };
}

export function CreationScreen(props: CreationScreenProps | WorkEditScreenProps) {
  if ("editing" in props) return <WorkEditScreen key={`${props.storageKey}:${props.editing.groupId}:${props.editing.workId}`} {...props} />;
  const scope = creationDraftKey(props.storageKey, props.tenant.id, props.user.id, props.companyBranchId, props.kind, props.mode) + (props.parentMaintenance ? `:maintenance:${props.parentMaintenance.id}` : "")
    + (props.parentEntry ? `:entry:${props.parentEntry.id}` : "");
  return <CreationScreenContent key={scope} {...props} draftKey={scope} />;
}

const steps = [{ label: "Datos", icon: "document-text-outline" as const }, { label: "Horario", icon: "time-outline" as const }, { label: "Revisar", icon: "checkmark-done-outline" as const }];
const stepTitles = ["Datos del trabajo", "Fecha y horario", "Revisar y crear"];
const serverMessages = new Map<string, string>([
  ["MOBILE_CREATION_INVALID_LOCAL_TIME", "Esa hora local no existe por el cambio de horario. Elige otra franja."],
  ["MOBILE_CREATION_AMBIGUOUS_LOCAL_TIME", "La franja contiene una hora ambigua por cambio de horario."],
  ["MOBILE_CREATION_DST_TRANSITION_UNSUPPORTED", "No se admite una franja que atraviese un cambio de horario."],
  ["MOBILE_CREATION_REQUEST_CONFLICT", "Este identificador ya se usó para otra creación. Revisa tu agenda antes de crear otro registro."],
  ["MOBILE_CREATION_EQUIPMENT_NOT_FOUND", "El equipo ya no está disponible."],
  ["MOBILE_CREATION_SPECIALTY_NOT_FOUND", "La especialidad ya no está disponible."],
  ["MOBILE_CREATION_SYSTEM_NOT_FOUND", "El sistema ya no está disponible. Selecciona otro."],
  ["MOBILE_CREATION_COMPONENT_NOT_FOUND", "El subsistema ya no está disponible o no pertenece al sistema elegido."],
  ["MOBILE_CREATION_TIMEZONE_NOT_CONFIGURED", "La sucursal no tiene una zona horaria válida configurada."],
  ["MOBILE_CREATION_SCHEMA_NOT_READY", "La creación móvil aún no está habilitada en el servidor."],
  ["MOBILE_CREATION_ACTOR_NOT_AUTHORIZED", "Tu sesión no tiene acceso a esta creación."],
  ["MOBILE_CREATION_ENTRY_NOT_FOUND", "El ingreso ya no existe o no es de tu sucursal."],
  ["MOBILE_CREATION_ENTRY_DELIVERED", "Este equipo ya fue entregado: no se le pueden agregar trabajos."],
]);

function submissionError(error: unknown): string {
  return error instanceof Error ? serverMessages.get(error.message) ?? "No se confirmó la creación. Puede haberse recibido en el servidor." : "No se confirmó la creación. Puede haberse recibido en el servidor.";
}

function CreationScreenContent({ kind, user, tenant, connectionStatus, companyBranchId, initialDate, data, offline, mode, busy = false, onBack, onLoadOptions, onSubmit, onCreated, onQueued, successFlow, draftKey, parentMaintenance, parentEntry }: CreationScreenProps & { draftKey: string }) {
  const security = useDeviceSecurity();
  const store = useMemo(() => openCreationDraftStore(draftKey, kind, companyBranchId), [draftKey, kind, companyBranchId]);
  const catalogCache = useMemo<CreationCatalogCache>(() => new Map(), [draftKey]);
  const initialForm = () => ({ ...emptyCreationForm(initialDate), ...(parentMaintenance ? { maintenanceId: parentMaintenance.id } : {}),
    ...(parentEntry ? { operationAreaEntryId: parentEntry.id } : {}) });
  const [draft, setDraft] = useState<CreationDraft>(() => ({ version: 1, kind, phase: "editing", form: initialForm() }));
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
  const [catalog, setCatalog] = useState<CreationCatalogResource | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ busy, offline, onBack, onSubmit, onCreated, onQueued, successFlow, isUnlocked: security.isUnlocked });
  latest.current = { busy, offline, onBack, onSubmit, onCreated, onQueued, successFlow, isUnlocked: security.isUnlocked };
  const changed = useRef(false);
  const loadOptionsRef = useRef(onLoadOptions);
  loadOptionsRef.current = onLoadOptions;
  const form = draft.form;
  const frozen = draft.phase !== "editing" || !ready || busy || sending;
  const minutes = kind === "work" ? creationAssignedMinutes(form) : creationDuration(form);
  const preview = useMemo(() => creationConflictPreview(data, { date: form.date, startTime: form.startTime, endTime: form.endTime }), [data, form.date, form.startTime, form.endTime]);
  const branch = user.accessBranchs.find((item) => item.id === companyBranchId);
  const queuedState = draft.phase === "queued" ? queuedCreationState(draft, offline) : null;

  function replaceDraft(next: CreationDraft): void { current.current = next; setDraft(next); }

  useEffect(() => {
    if (!ready || busy || sending || lock.current || current.current !== draft || draft.phase !== "queued" || !latest.current.isUnlocked()) return;
    const next = queuedCreationState(draft, offline).confirmed;
    if (!next) return;
    replaceDraft(next);
    void store.write(next).then(() => {
      if (mounted.current && current.current === next) setSaveError("");
    }).catch(() => {
      if (mounted.current && current.current === next) setSaveError("La creación está confirmada. No se pudo actualizar esta pantalla en el dispositivo; no repitas el envío.");
    });
  }, [draft, offline, ready, busy, sending, store]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void store.read().then((saved) => {
      if (!active) return;
      if (saved && (saved.form.maintenanceId !== parentMaintenance?.id || saved.form.operationAreaEntryId !== parentEntry?.id)) throw new Error("CREATION_PARENT_MISMATCH");
      if (saved) { replaceDraft(saved); changed.current = true; if (saved.phase !== "editing") setStep(2); }
      setReady(true);
    }).catch(() => {
      if (active) setDraftError("No se pudo recuperar el borrador. Si ya intentaste crear este registro, revisa tu agenda antes de descartarlo.");
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
    if (current.current.phase === "editing" && step > 0) { setStep(step - 1); setError(""); return; }
    requestExit();
  }
  function requestExit(): void {
    if (lock.current || busy) return;
    if (current.current.phase === "confirmed" || current.current.phase === "queued" || (!changed.current && !draftError)) onBack();
    else setDialog("back");
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { requestBack(); return true; });
    return () => subscription.remove();
  }, [busy, draftError, onBack, step]);

  function change<Key extends keyof CreationForm>(field: Key, value: CreationForm[Key]): void {
    if (lock.current || frozen || current.current.phase !== "editing") return;
    changed.current = true;
    replaceDraft({ ...current.current, form: { ...current.current.form, [field]: value } });
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setError("");
  }

  function selectCatalog(resource: CreationCatalogResource, item: CatalogItem): void {
    if (lock.current || frozen || current.current.phase !== "editing") return;
    changed.current = true;
    replaceDraft({ ...current.current, form: applyCatalogSelection(current.current.form, resource, item) });
    setErrors((previous) => ({ ...previous, [catalogFormField[resource]]: undefined }));
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
    if (parentMaintenance && latest.current.offline !== undefined && !latest.current.offline?.online) { setError("Conecta para crear un trabajo en este mantenimiento."); return; }
    if (parentEntry && latest.current.offline !== undefined && latest.current.offline !== null && !latest.current.offline.online) { setError(kind === "maintenance" ? "Conecta para crear un mantenimiento en este ingreso." : "Conecta para crear un trabajo en este ingreso."); return; }
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
      if (parentMaintenance && result.groupId !== `maintenance-${parentMaintenance.id}`) throw new Error("CREATION_PARENT_MISMATCH");
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
        } else if (mounted.current) setError("El resultado local no corresponde a esta creación. Revisa el centro offline antes de continuar.");
      } else if (mounted.current) setError(current.current.phase === "pending" ? `${submissionError(failure)} Reintenta confirmar la creación sin duplicarla.` : "No se pudo preparar la creación. Comprueba los campos; no se creó ningún registro.");
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
    catch { setSaveError("No se pudo guardar el borrador. Permanece aquí y reintenta para no perder los datos."); setDialog(null); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }

  async function editAsNew(resetForm: boolean): Promise<void> {
    if (!mounted.current || !latest.current.isUnlocked() || latest.current.busy || lock.current) return;
    lock.current = true;
    setSending(true);
    try {
      const next: CreationDraft = { version: 1, kind, phase: "editing", form: resetForm ? initialForm() : current.current.form };
      await store.write(next);
      if (!mounted.current || !latest.current.isUnlocked()) return;
      replaceDraft(next);
      setReady(true);
      setDraftError(""); setSaveError(""); setError(""); setErrors({}); setStep(0); setDialog(null);
      changed.current = !resetForm;
    } catch { setSaveError("No se pudo preparar un nuevo borrador. No se ha repetido la creación anterior."); setDialog(null); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }

  async function persistAndOpen(saved: Extract<CreationDraft, { phase: "confirmed" | "queued" }>, automatic: boolean): Promise<void> {
    try {
      await store.write(saved);
    } catch {
      if (mounted.current) setSaveError(saved.phase === "queued"
        ? "La creación está guardada en el teléfono. No la repitas; falta guardar el estado de esta pantalla. Usa Ver trabajo local para reintentar."
        : "La creación está confirmada, pero no se pudo guardar la confirmación local. No vuelvas a crearla; reintenta guardar la confirmación.");
      return;
    }
    if (!mounted.current || current.current !== saved) return;
    setSaveError("");
    if (!latest.current.isUnlocked()) return;
    if (automatic && saved.phase === "confirmed" && latest.current.successFlow) { latest.current.successFlow.onConfirmed?.(saved.result); return; }
    if (automatic && !(saved.phase === "queued" ? latest.current.onQueued : latest.current.onCreated)) return;
    try {
      if (saved.phase === "queued" && latest.current.onQueued) await latest.current.onQueued(saved.outcome);
      else if (saved.phase === "confirmed" && latest.current.onCreated) await latest.current.onCreated(saved.result);
      else latest.current.onBack();
    } catch {
      if (mounted.current) setSaveError(saved.phase === "queued"
        ? "El trabajo sigue guardado en la cola local. No se pudo abrir la ficha; usa Ver trabajo local para reintentar sin crear otro."
        : "La creación está confirmada. No se pudo abrir la ficha; reintenta sin volver a crear.");
    }
  }

  const confirmedResult = draft.phase === "confirmed" ? draft.result : null;
  async function openSaved(): Promise<void> {
    if (!mounted.current || !latest.current.isUnlocked() || latest.current.busy || lock.current) return;
    let saved = current.current;
    if (saved.phase !== "confirmed" && saved.phase !== "queued") return;
    if (saved.phase === "queued") {
      const confirmed = queuedCreationState(saved, latest.current.offline).confirmed;
      if (confirmed) { saved = confirmed; replaceDraft(confirmed); }
    }
    lock.current = true;
    setSending(true);
    try { await persistAndOpen(saved, false); }
    finally { lock.current = false; if (mounted.current) setSending(false); }
  }
  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <IconButton name="arrow-back" label="Volver conservando borrador" disabled={busy || sending} onPress={requestBack} />
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={styles.headerTitle}>{creationLabels[kind]}</Text>
          <Text style={styles.headerStep} numberOfLines={1}>{draft.phase === "editing" ? `Paso ${step + 1} de 3 · ${stepTitles[step]}` : draft.phase === "pending" ? "Por confirmar" : "Creación lista"}
            {parentEntry ? ` · Ingreso ${parentEntry.code}` : parentMaintenance ? ` · ${parentMaintenance.code}` : ""}</Text>
        </View>
        <IconButton name="list-outline" label="Volver a mis asignaciones" disabled={busy || sending} onPress={requestExit} />
      </View>
      {connectionStatus}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.context}>{tenant.name} · {branch?.name ?? `Sucursal ${companyBranchId}`} · {user.name} {user.lastnames}</Text>
        {mode === "demo" ? <Badge label="Demostración · no crea registros reales" tone="warning" /> : null}
        {draft.phase === "queued" ? <Card style={styles.card}>
          <Badge label="Creación anterior" tone="neutral" />
          <Text accessibilityRole="header" style={styles.title}>{queuedState?.status === "syncing" ? "Sincronizando creación" : queuedState?.status === "review" ? "Creación por revisar" : queuedState?.status === "auth_required" ? "Verifica tu sesión para sincronizar" : queuedState?.status === "pending" ? "Guardado · pendiente de sincronizar" : "Creación guardada anteriormente"}</Text>
          <Text style={styles.body}>{draft.form.title || creationLabels[kind]}</Text>
          <Text style={styles.body}>{draft.input.schedule.date} · {draft.input.schedule.startTime || "Sin inicio"}–{draft.input.schedule.endTime || "Sin fin"}</Text>
          <Text style={styles.hint}>{queuedState?.status === "unavailable" ? "No se pudo comprobar su estado actual. Revisa tus asignaciones antes de repetir este trabajo." : queuedState?.status === "review" ? "La creación se conserva en el centro de sincronización y necesita revisión." : "La creación está guardada. No necesitas repetirla."}</Text>
          <Text style={styles.hint}>Puedes crear otro trabajo distinto sin borrar esta creación.</Text>
          <Button title="Ver trabajo local" loading={sending} disabled={busy} onPress={() => void openSaved()} />
          <Button title="Crear otro" icon="add-outline" variant="secondary" disabled={sending || busy} onPress={() => void editAsNew(true)} />
        </Card> : confirmedResult ? <Card style={styles.card}>
          <Badge label={mode === "demo" ? "Simulación confirmada" : "Creación confirmada"} tone="success" />
          <Text accessibilityRole="header" style={styles.title}>{mode === "demo" ? "La simulación está lista" : "Tu planificación está lista"}</Text>
          <Text selectable style={styles.body}>Referencia: {confirmedResult.groupId}</Text>
          <Text selectable style={styles.body}>{confirmedResult.kind === "maintenance" ? `Trabajo de mantenimiento #${confirmedResult.workId}` : assignmentWorkCode({ id: String(confirmedResult.workId) })}</Text>
          <Text style={styles.body}>{confirmedResult.schedule.date} · {confirmedResult.schedule.startTime || "Sin inicio"}–{confirmedResult.schedule.endTime || "Sin fin"}</Text>
          <Text style={styles.body}>{confirmedResult.schedule.plannedMinutes === null ? "Sin duración prevista" : `${confirmedResult.schedule.plannedMinutes} min`} · {confirmedResult.schedule.timezone}</Text>
          <Text style={styles.hint}>La creación ya se confirmó. Abrir o actualizar la agenda no volverá a enviarla.</Text>
          <Button title={kind === "maintenance" ? "Gestionar mantenimiento" : "Gestionar trabajo"} loading={sending} disabled={busy} onPress={() => void openSaved()} />
          <Button title="Crear otro" variant="secondary" disabled={sending || busy} onPress={() => void editAsNew(true)} />
        </Card> : <>
          <CreationStepper steps={steps} current={step} onPick={draft.phase === "editing" && !frozen ? (index) => { setStep(index); setError(""); } : undefined} />
          {draftError ? <Card style={styles.card}><Text accessibilityRole="alert" style={styles.warning}>{draftError}</Text><Button title="Descartar borrador no recuperable" variant="secondary" onPress={() => setDialog("invalid")} /></Card> : null}
          {!ready && !draftError ? <ActivityIndicator accessibilityLabel="Recuperando borrador" color={palette.primary} /> : null}
          {loadingOptions ? <ActivityIndicator accessibilityLabel="Cargando opciones de creación" color={palette.primary} /> : null}
          {optionsError ? <Card style={styles.card}><Text accessibilityRole="alert" style={styles.warning}>{optionsError}</Text><Button title="Reintentar opciones" variant="secondary" onPress={() => setReload((value) => value + 1)} /></Card> : null}
          {ready && options ? <>
            {draft.phase === "pending" ? <Card style={styles.card}>
              <Text accessibilityRole="alert" style={styles.warning}>No se ha confirmado si el registro se creó. Se conservan los datos para reintentar sin duplicarlo.</Text>
              <Text style={styles.hint}>Si se perdió la conexión, usa Reintentar creación. Crear otro registro puede duplicar uno ya guardado.</Text>
            </Card> : null}
            {step === 0 ? <Card><CreationFields kind={kind} editing={!!parentMaintenance} showWorkSystem={kind === "maintenance" || !!parentMaintenance} form={form} errors={errors} options={options} disabled={frozen} onChange={change} onSelectCatalog={setCatalog}
              equipmentLookup={parentEntry ? <LinkedEquipmentCard title={`EQUIPO DEL INGRESO ${parentEntry.code}`} label={parentEntry.equipmentLabel}
                  hint={kind === "maintenance" ? "El mantenimiento queda unido al ingreso con su equipo propio." : "El trabajo queda unido al ingreso con su cliente y equipo."} />
                : parentMaintenance ? <LinkedEquipmentCard title="EQUIPO DEL MANTENIMIENTO" label={parentMaintenance.equipment?.label ?? "No informado"}
                  detail={parentMaintenance.equipment?.internalNumber ?? parentMaintenance.equipment?.identifier} hint={`El trabajo queda dentro de ${parentMaintenance.code}.`} /> : <CreationEquipmentLookup companyBranchId={companyBranchId} userId={user.id} workerId={user.workerId}
                required={kind === "maintenance"} disabled={frozen} selected={form.equipment} error={errors.equipment} cache={catalogCache}
                onLoadOptions={onLoadOptions} onSelect={(item) => change("equipment", item)} />} /></Card> : null}
            {step === 1 ? <Card style={styles.card}>
              <CreationScheduleFields form={form} errors={errors} disabled={frozen} optionalTimes={kind === "work"} scopeKey={JSON.stringify([draftKey, form.date])} today={initialDate} onChange={change} />
              {kind !== "work" ? <Text accessibilityLiveRegion="polite" style={styles.body}>Duración: {minutes === null ? "completa un horario válido" : durationText(minutes)}</Text> : null}
              <Text style={styles.hint}>Un solo día, en hora de {options.timezone}. Para cruzar la medianoche o repetir, planifícalo desde la web.</Text>
            </Card> : null}
            {step === 2 ? <CreationReview disabled={frozen || draft.phase !== "editing"} onEdit={(index) => { setStep(index); setError(""); }}
              note="Se asignará a ti en esta sucursal, sin iniciar su ejecución."
              sections={[
                kind !== "non_productive" ? { title: "Datos del trabajo", icon: "document-text-outline" as const, step: 0, rows: [
                  { icon: "text-outline" as const, label: "Título", value: form.title.trim(), strong: true },
                  ...((kind === "work" ? form.summary : form.motive).trim() ? [{ icon: "reader-outline" as const, label: kind === "work" ? "Resumen" : "Motivo", value: (kind === "work" ? form.summary : form.motive).trim() }] : []),
                  ...(kind === "maintenance" ? [{ icon: "build-outline" as const, label: "Tipo", value: form.maintenanceType === "correctivo" ? "Correctivo" : "Detención" }] : []),
                  { icon: "flag-outline" as const, label: "Prioridad", value: priorityLabels[form.priority] },
                  { icon: "construct-outline" as const, label: "Equipo", value: parentEntry ? `${parentEntry.equipmentLabel} · Ingreso ${parentEntry.code}` : parentMaintenance ? parentMaintenance.equipment?.label ?? "No informado" : form.equipment ? form.equipment.label : "Sin equipo asociado" },
                  ...(form.specialty ? [{ icon: "hammer-outline" as const, label: "Especialidad", value: form.specialty.label }] : []),
                  ...(form.system && (kind === "maintenance" || parentMaintenance) ? [{ icon: "git-network-outline" as const, label: "Sistema", value: `${form.system.label}${form.component ? ` · ${form.component.label}` : ""}` }] : []),
                  ...(kind === "maintenance" && form.damageType ? [{ icon: "warning-outline" as const, label: "Daño", value: form.damageType === "desgaste" ? "Desgaste" : "Operacional" }] : [])
                ] } : { title: "Motivo", icon: "pause-circle-outline" as const, step: 0, rows: [
                  { icon: "pause-outline" as const, label: "Motivo", value: options.nonProductiveReasons.find((item) => item.value === form.reason)?.label ?? form.reason, strong: true },
                  ...(form.reasonText.trim() ? [{ icon: "reader-outline" as const, label: "Detalle", value: form.reasonText.trim() }] : []),
                  ...(form.initialComment.trim() ? [{ icon: "chatbubble-outline" as const, label: "Comentario", value: form.initialComment.trim() }] : [])
                ] },
                { title: "Fecha y horario", icon: "time-outline" as const, step: 1, rows: [
                  { icon: "calendar-outline" as const, label: "Día", value: form.date },
                  { icon: "hourglass-outline" as const, label: kind === "work" ? "Tiempo asignado" : "Duración", value: minutes === null ? "Sin tiempo asignado" : durationText(minutes), strong: true },
                  { icon: "time-outline" as const, label: "Horario", value: form.startTime || form.endTime ? `${form.startTime || "Sin inicio"} – ${form.endTime || "Sin fin"}` : "Sin hora fija" }
                ] }
              ]} /> : null}
            {step > 0 && preview.overlaps.length > 0 ? <Card style={styles.card}>
              <Text style={styles.warning}>Este horario coincide con otros trabajos de tu agenda. Puedes continuar.</Text>
              {preview.overlaps.map((title) => <Text key={title} style={styles.body}>• {title}</Text>)}
            </Card> : null}
            {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            {step < 2 ? <Button title={step === 0 ? "Continuar a horario" : "Revisar creación"} disabled={frozen} onPress={() => { if (checkForm(step === 1)) setStep(step + 1); }} /> : <>
              <Button title={draft.phase === "pending" ? "Reintentar creación" : mode === "demo" ? "Simular creación" : "Confirmar y crear"} icon="checkmark-outline" loading={sending} disabled={busy || loadingOptions} onPress={() => void submit()} />
              {draft.phase === "pending" ? <Button title="Editar como nueva creación" variant="secondary" disabled={busy || sending} onPress={() => setDialog("new")} /> : null}
            </>}
            {step > 0 && draft.phase === "editing" ? <Button title="Paso anterior" variant="ghost" disabled={sending || busy} onPress={() => { setStep(step - 1); setError(""); }} /> : null}
            <Text style={styles.hint}>El borrador se conserva en este dispositivo para esta sesión, empresa, sucursal y tipo de creación.</Text>
          </> : null}
        </>}
        {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
    {confirmedResult && successFlow ? <CreationDone busy={sending || busy}
      title={mode === "demo" ? "¡Simulación lista!" : kind === "maintenance" ? "¡Mantenimiento creado!" : "¡Trabajo creado!"}
      code={confirmedResult.kind === "maintenance" ? null : assignmentWorkCode({ id: String(confirmedResult.workId) })}
      subtitle={successFlow.subtitle ?? (parentEntry ? `Quedó en el ingreso ${parentEntry.code} y asignado a ti.` : parentMaintenance ? `Quedó en ${parentMaintenance.code} y asignado a ti.` : "Quedó en tu agenda y asignado a ti.")}
      details={[
        { icon: "document-text-outline", label: draft.form.title.trim() || creationLabels[kind] },
        { icon: "calendar-outline", label: `${confirmedResult.schedule.date}${confirmedResult.schedule.startTime ? ` · ${confirmedResult.schedule.startTime}–${confirmedResult.schedule.endTime || "sin fin"}` : " · sin hora fija"}` },
        ...(confirmedResult.schedule.plannedMinutes ? [{ icon: "hourglass-outline" as const, label: `Tiempo asignado: ${durationText(confirmedResult.schedule.plannedMinutes)}` }] : []),
        ...(draft.form.specialty ? [{ icon: "hammer-outline" as const, label: draft.form.specialty.label }] : [])
      ]}
      primary={{ label: successFlow.viewLabel, icon: "list-outline", onPress: () => successFlow.onView(confirmedResult) }}
      secondary={{ label: kind === "maintenance" ? "Crear otro mantenimiento" : "Crear otro trabajo", icon: "add-circle-outline", onPress: () => void editAsNew(true) }}
      tertiary={successFlow.hideOpen ? undefined : { label: kind === "maintenance" ? "Abrir el mantenimiento" : "Abrir el trabajo creado", onPress: () => void openSaved() }} /> : null}
    {catalog && !frozen ? <CreationCatalogSelector resource={catalog} systemId={form.system?.id} companyBranchId={companyBranchId} userId={user.id} workerId={user.workerId} cache={catalogCache}
      selected={form[catalogFormField[catalog]]} onLoadOptions={onLoadOptions} onClose={() => setCatalog(null)}
      onSelect={(item) => selectCatalog(catalog, item)} /> : null}
    {dialog ? <CreationModal title={dialog === "back" ? "Volver sin perder tus datos" : "Crear otro registro"} onClose={() => { if (!lock.current) setDialog(null); }}>
      <Text style={styles.body}>{dialog === "back" ? "Se conservará el borrador. Si ya intentaste crear el registro, podrás reintentar sin duplicarlo." : "El registro anterior podría haberse creado aunque no recibieras respuesta. Revisa tu agenda primero. Continuar prepara una creación distinta y podría generar un duplicado."}</Text>
      <Button title={dialog === "back" ? "Guardar borrador y volver" : "Entiendo: editar como nueva creación"} loading={sending} onPress={() => { if (dialog === "back") void leaveWithDraft(); else void editAsNew(dialog === "invalid"); }} />
      <Button title="Seguir aquí" variant="secondary" disabled={sending} onPress={() => setDialog(null)} />
    </CreationModal> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.border },
  headerText: { flex: 1, gap: 2, minWidth: 0 }, title: { ...typography.heading, color: palette.text },
  headerTitle: { fontSize: 17, fontWeight: "800", color: palette.heading }, headerStep: { ...typography.caption, color: palette.textSecondary },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 20, paddingBottom: 40, gap: 16 },
  context: { ...typography.caption, color: palette.textSecondary }, card: { gap: 14 },
  heading: { ...typography.heading, color: palette.text }, body: { ...typography.body, color: palette.text }, reviewTitle: { ...typography.heading, color: palette.text },
  warning: { ...typography.body, color: palette.amber }, hint: { ...typography.caption, color: palette.textSecondary }, error: { ...typography.body, color: palette.danger },
});