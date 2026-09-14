import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { assignmentCodes } from "../domain/assignmentCodes";
import { clock, duration, plainText, shortDate, STATUS_LABELS } from "../domain/format";
import type { AssignmentGroup, AssignmentWork, Attachment, ChecklistStep, CommentPage, DateRange, LocalPhoto, StatusInput, StepAnswer, Tenant, WorkDetailTab, WorkStatus } from "../domain/models";
import { Badge, BodyText, Button, Card, IconButton, SectionTitle, type BadgeTone, type IconName } from "../ui/components";
import { palette } from "../ui/theme";
import { SessionContextBar } from "../ui/SessionContextBar";
import { ChecklistTab } from "./workDetail/ChecklistTab";
import { CompletionDialog } from "./workDetail/CompletionDialog";
import { Notice } from "./workDetail/DetailUi";
import { answerError, completionReasons, errorMessage, executionDate, readOnlyWork, withinRange } from "./workDetail/detailRules";
import { styles } from "./workDetail/detailStyles";
import { EvidenceTab } from "./workDetail/EvidenceTab";
import { deleteLocalPhoto, MAX_PHOTOS, openLocalPhotoScope, pickPhotos, preparePhotos, validateLocalPhotos } from "./workDetail/localPhotos";
import { useAttachmentFiles } from "./workDetail/useAttachmentFiles";
import { useWorkDraft, workDetailDraftKey } from "./workDetail/useWorkDraft";
import { EquipmentTab, WorkTab } from "./workDetail/WorkInformation";
import { FileWorkspace } from "./workDetail/FileWorkspace";
import { CommentsTab } from "./workDetail/CommentsTab";
import { isExecutionFinalization, executionDateAllowed } from "../domain/workExecution";
import { isOfflineQueuedError, type OfflineController, type OfflineSnapshot } from "../domain/offline";
import { answerKey, confirmedEvidenceWork, isConfirmedAttachment, offlineAttachment, operationsForWork, pendingTimerForWork, timerPendingLabel, operationErrorReason, operationStatusLabels, queueOwnsDocument, registeredAnswerKey, type PendingAnswer, type PendingChecklist, type PendingComment, type PendingDocument, type QueuedTimerMarker } from "./offline/offlineUi";
import { QueuedNotice } from "./offline/QueuedNotice";
import { ChecklistAssociationPanel } from "./workDetail/checklist/ChecklistAssociationPanel";
import type { ChecklistAssignmentResult, ChecklistCatalogPage, ChecklistCatalogQuery } from "../domain/checklistAssignment";

export { clearWorkDetailDrafts, workDetailDraftKey } from "./workDetail/useWorkDraft";

export interface WorkDetailScreenProps {
  tenant: Tenant;
  branchName: string;
  connectionStatus?: ReactNode;
  group: AssignmentGroup;
  work: AssignmentWork;
  generatedAt: string;
  mode: "live" | "demo";
  range: DateRange;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onStatus: (input: StatusInput) => Promise<void>;
  onSaveStep: (stepId: string, answer: StepAnswer) => Promise<void>;
  onLoadChecklistOptions: (query: ChecklistCatalogQuery) => Promise<ChecklistCatalogPage>;
  onAttachChecklist: (checklistId: number) => Promise<ChecklistAssignmentResult>;
  onLoadFiles: () => Promise<Attachment[]>;
  onLoadStepFiles: (stepId: string) => Promise<Attachment[]>;
  onUpload: (photos: LocalPhoto[], stepId?: string) => Promise<void>;
  onReport: (note: string) => Promise<void>;
  initialTab?: WorkDetailTab;
  initialAction?: "deliver";
  allowEditExecutionTime: boolean;
  onUploadDocuments: (files: LocalPhoto[], stepId?: string) => Promise<void>;
  onDeleteFile: (fileId: string, stepId?: string) => Promise<void>;
  onLoadComments: (page: number) => Promise<CommentPage>;
  onAddComment: (text: string) => Promise<void>;
  storageKey: string;
  draftIdentity?: { groupId: string; workId: string };
  staleReadOnly?: boolean;
  offline?: OfflineSnapshot | null;
  companyBranchId?: number;
  readLocalFile?: OfflineController["readLocalFile"];
}

type Tab = WorkDetailTab;
const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "work", label: "Trabajo", icon: "construct-outline" },
  { id: "checklist", label: "Checklist", icon: "checkbox-outline" },
  { id: "evidence", label: "Archivos", icon: "folder-open-outline" },
  { id: "comments", label: "Comentarios", icon: "chatbubbles-outline" },
  { id: "equipment", label: "Equipo", icon: "hardware-chip-outline" },
];
const statusTones: { [key in WorkStatus]: BadgeTone } = { pending: "warning", in_progress: "teal", paused: "warning", completed: "success", delivered: "info" };

function ElapsedTimer({ work, generatedAt, online = true, pending = false }: Pick<WorkDetailScreenProps, "work" | "generatedAt"> & { online?: boolean; pending?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (work.status !== "in_progress" || !online || pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [work.status, generatedAt, online, pending]);
  const snapshotTime = Date.parse(generatedAt);
  const baseline = Number.isFinite(work.elapsedSeconds) ? Math.max(0, work.elapsedSeconds) : 0;
  const extra = online && !pending && work.status === "in_progress" && Number.isFinite(snapshotTime) ? Math.max(0, Math.floor((now - snapshotTime) / 1000)) : 0;
  return <View style={styles.timerBox}>
    <Text style={styles.heroOverline}>TIEMPO DE EJECUCIÓN</Text>
    <Text style={styles.timer} accessibilityLabel={`Tiempo de ejecución: ${clock(baseline + extra)}`}>{clock(baseline + extra)}</Text>
    <Text style={styles.heroText}>{pending ? "Último tiempo recibido, sin incremento local mientras se confirma o actualiza el estado." : !online ? "Último tiempo recibido. Sin conexión no se simula ni confirma el cronómetro." : work.status === "in_progress" ? "Tiempo recibido + transcurrido desde la última actualización. El servidor confirma el tiempo final." : "Tiempo acumulado informado en la asignación."}</Text>
  </View>;
}

export function WorkDetailScreen(props: WorkDetailScreenProps) {
  const identity = workDetailDraftKey(props.storageKey, props.mode, { type: props.group.type, id: props.draftIdentity?.groupId ?? props.group.id }, props.draftIdentity?.workId ?? props.work.id);
  return <WorkDetailContent key={identity} {...props} />;
}

function WorkDetailContent(props: WorkDetailScreenProps) {
  const { group, work, generatedAt, mode, range, busy, onBack, onRefresh, onStatus, onSaveStep, onUpload, onReport, storageKey } = props;
  const insets = useSafeAreaInsets();
  const codes = assignmentCodes(group, work);
  const draftGroupId = props.draftIdentity?.groupId ?? group.id;
  const draftWorkId = props.draftIdentity?.workId ?? work.id;
  const identity = workDetailDraftKey(storageKey, mode, { type: group.type, id: draftGroupId }, draftWorkId);
  const resourceKey = JSON.stringify([group.type, group.id, work.id, range.startDate, range.endDate, props.companyBranchId]);
  const callbacks = useRef(props);
  callbacks.current = props;
  const draft = useWorkDraft(identity);
  const files = useAttachmentFiles(identity, async () => {
    const current = callbacks.current;
    const attachments = await current.onLoadFiles();
    const operations = operationsForWork(current.offline, { groupId: current.group.id, workId: current.work.id, ...current.range, companyBranchId: current.companyBranchId });
    return attachments.filter((file) => {
      const operationId = offlineAttachment(file)?.offline.operationId;
      return !operationId || operations.some((operation) => operation.id === operationId && operation.kind === "document" && operation.stepId === undefined);
    });
  });
  const online = props.offline === undefined || (props.offline !== null && props.offline.online && !props.offline.authBlocked);
  const offlineReady = props.offline !== null && !props.offline?.authBlocked;
  const localWork = work.id.startsWith("local-") || group.id.startsWith("local-");
  const staleReadOnly = props.staleReadOnly === true || work.missingRequiredInfo.includes("OFFLINE_AWAITING_SERVER_SNAPSHOT");
  const evidenceWork = confirmedEvidenceWork(work);
  const scopedOperations = operationsForWork(props.offline, { groupId: group.id, workId: work.id, ...range, companyBranchId: props.companyBranchId });
  const answerOperations = scopedOperations.filter((operation): operation is PendingAnswer => operation.kind === "answer");
  const pendingAnswers = answerOperations.filter((operation) => operation.status !== "applied");
  const pendingComments = scopedOperations.filter((operation): operation is PendingComment => operation.kind === "comment");
  const checklistOperations = scopedOperations.filter((operation): operation is PendingChecklist => operation.kind === "checklist");
  const pendingTimer = pendingTimerForWork(props.offline, { groupId: group.id, workId: work.id, ...range, companyBranchId: props.companyBranchId }, work);
  const [queuedTimer, setQueuedTimer] = useState<QueuedTimerMarker | null>(null);
  const queuedTimerRef = useRef(queuedTimer);
  const unobservedTimer = queuedTimer && !scopedOperations.some((operation) => operation.id === queuedTimer.operationId) ? queuedTimer : null;
  const desiredStatus = unobservedTimer?.status ?? pendingTimer?.payload.status ?? work.status;
  const timerPending = Boolean(pendingTimer || unobservedTimer);
  const timerNeedsAttention = props.offline?.connection?.foreground === false || pendingTimer !== null && pendingTimer.status !== "pending" && pendingTimer.status !== "syncing";
  const hasPendingOperations = timerPending || scopedOperations.some((operation) => operation.status !== "applied")
    || operationsForWork(props.offline, { groupId: group.id, ...range, companyBranchId: props.companyBranchId }).some((operation) => operation.status !== "applied");
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "work");
  const [target, setTarget] = useState<string | undefined>();
  const allPendingDocuments = scopedOperations.filter((operation): operation is PendingDocument => operation.kind === "document" && operation.status !== "applied");
  const pendingDocuments = allPendingDocuments.filter((operation) => operation.stepId === target);
  const [queuedAnswers, setQueuedAnswers] = useState<{ [stepId: string]: { signature: string; operationId: string } }>({});
  const queuedAnswersRef = useRef(queuedAnswers);
  const [action, setAction] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(props.error);
  const [message, setMessage] = useState<string | null>(null);
  const [exitWarning, setExitWarning] = useState(false);
  const [completing, setCompleting] = useState(props.initialAction === "deliver");
  const [awaitingStatus, setAwaitingStatus] = useState<WorkStatus | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const operationEpoch = useRef(0);
  const pickerEpoch = useRef(0);
  const parentBusy = useRef(busy);
  parentBusy.current = busy;
  const maintenance = group.type === "internal_maintenance";
  const readOnly = readOnlyWork(group, work) || localWork || staleReadOnly;
  const awaitingConfirmation = awaitingStatus !== null && awaitingStatus !== work.status;
  const locked = busy || action !== null;
  const disabled = locked || !draft.hydrated || !offlineReady || awaitingConfirmation;
  const executionGates = useRef({ readOnly, disabled, online, hasPendingOperations, desiredStatus, timerNeedsAttention });
  executionGates.current = { readOnly, disabled, online, hasPendingOperations, desiredStatus, timerNeedsAttention };
  const selectedDate = executionDate(work, range);
  const reasons = completionReasons(group, evidenceWork, files.files?.filter(isConfirmedAttachment) ?? null, files.error);
  if (!online) reasons.push("La entrega requiere conexión. No se encola ni simula offline.");
  if (hasPendingOperations) reasons.push("Hay operaciones pendientes de confirmación del servidor. Deben resolverse antes de entregar.");
  const currentStepIds = new Set(work.checklists.flatMap((checklist) => checklist.steps.map((step) => String(step.stepId))));
  if (draft.data.report.trim() && draft.data.report.trim() !== draft.data.savedReport) reasons.push("Guarda el reporte pendiente o vacía el texto antes de cerrar.");
  if (Object.entries(draft.data.answers).some(([id, answer]) => currentStepIds.has(id) && !answer.saved)) reasons.push("Guarda o descarta las respuestas que aún están en borrador antes de cerrar.");
  if (draft.data.photos.some((item) => !item.uploaded)) reasons.push("Sube o quita las fotos pendientes antes de cerrar el trabajo.");

  useEffect(() => {
    mounted.current = true;
    openLocalPhotoScope(storageKey);
    return () => { mounted.current = false; };
  }, [storageKey]);
  useEffect(() => { if (props.error) setOperationError(props.error); }, [props.error]);
  useEffect(() => { if (awaitingStatus === work.status) setAwaitingStatus(null); }, [awaitingStatus, work.status]);
  useEffect(() => {
    if (!queuedTimerRef.current || !scopedOperations.some((operation) => operation.id === queuedTimerRef.current?.operationId)) return;
    queuedTimerRef.current = null;
    setQueuedTimer(null);
  }, [props.offline?.operations]);
  const previousResource = useRef(resourceKey);
  useEffect(() => {
    if (previousResource.current === resourceKey) return;
    previousResource.current = resourceKey;
    void files.load();
  }, [resourceKey, files.load]);
  const appliedRevision = scopedOperations.filter((operation) => operation.status === "applied").map((operation) => operation.id).join("|");
  const previousAppliedRevision = useRef(appliedRevision);
  useEffect(() => {
    if (previousAppliedRevision.current === appliedRevision) return;
    previousAppliedRevision.current = appliedRevision;
    void files.load();
  }, [appliedRevision, files.load]);

  async function runAction(name: string, operation: () => Promise<void>): Promise<void> {
    if (!mounted.current || running.current || parentBusy.current) return;
    running.current = true;
    const epoch = ++operationEpoch.current;
    if (mounted.current) setAction(name);
    try { await operation(); }
    catch (error) { if (mounted.current && epoch === operationEpoch.current) setOperationError(errorMessage(error)); }
    finally {
      if (epoch === operationEpoch.current) {
        running.current = false;
        if (mounted.current) setAction(null);
      }
    }
  }

  async function refreshAfterSave(): Promise<void> {
    if (!mounted.current) return;
    try { await onRefresh(); }
    catch (error) { if (mounted.current) setOperationError(`El envío fue confirmado, pero no se pudo actualizar la ficha. No repitas el envío; actualiza la información: ${errorMessage(error)}`); }
  }

  function goBack(): void {
    void runAction("back", async () => {
      try { await draft.store.flush(); }
      catch (error) { if (mounted.current) setExitWarning(true); throw error; }
      if (mounted.current) onBack();
    });
  }
  const back = useRef(goBack);
  back.current = goBack;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back.current(); return true; });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const warnBeforeExit = (event: BeforeUnloadEvent): void => {
      const snapshot = draft.store.getSnapshot();
      if (running.current || parentBusy.current || snapshot.saving || snapshot.error || snapshot.data.photos.some((photo) => !photo.uploaded)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    globalThis.addEventListener("beforeunload", warnBeforeExit);
    return () => globalThis.removeEventListener("beforeunload", warnBeforeExit);
  }, [draft.store]);

  function refresh(): void {
    void runAction("refresh", async () => {
      await onRefresh();
      if (mounted.current) await files.load();
    });
  }

  function updateStatus(input: StatusInput): void {
    const finalizing = isExecutionFinalization(input.status);
    const gates = executionGates.current;
    if (!mounted.current || gates.readOnly || gates.disabled || callbacks.current.offline?.authBlocked || callbacks.current.offline === null || (!gates.online && props.offline === undefined)) return;
    if (finalizing && (!gates.online || gates.hasPendingOperations || queuedTimerRef.current)) return;
    if (!finalizing && (gates.timerNeedsAttention || queuedTimerRef.current?.status === input.status || gates.desiredStatus === input.status)) return;
    void runAction("status", async () => {
      if (input.status === "in_progress" && !work.canExecute) throw new Error("Qualitzer no habilita la ejecución de este trabajo.");
      if (isExecutionFinalization(input.status) && reasons.length > 0) throw new Error(reasons.join("\n"));
      if (input.executionDates?.some((date) => !executionDateAllowed(work, range, date))) throw new Error("La fecha de ejecución no está dentro del período o planificación permitidos.");
      await draft.store.flush();
      if (!mounted.current || callbacks.current.offline === null || callbacks.current.offline?.authBlocked || callbacks.current.staleReadOnly || readOnlyWork(callbacks.current.group, callbacks.current.work)) return;
      if (!finalizing && executionGates.current.timerNeedsAttention) return;
      if (finalizing && (!executionGates.current.online || executionGates.current.hasPendingOperations || queuedTimerRef.current)) return;
      try { await onStatus(input); }
      catch (error) {
        if (!finalizing && isOfflineQueuedError(error) && error.kind === "timer" && (input.status === "in_progress" || input.status === "paused")) {
          queuedTimerRef.current = { operationId: error.operationId, status: input.status };
          if (mounted.current) { setQueuedTimer(queuedTimerRef.current); setOperationError(null); setCompleting(false); }
          return;
        }
        throw error;
      }
      if (mounted.current) {
        setAwaitingStatus(input.status);
        setCompleting(false);
        setMessage(mode === "demo" ? "Estado guardado localmente en demostración." : "Cambio de estado confirmado por Qualitzer.");
      }
    });
  }

  async function saveStep(step: ChecklistStep, answer: StepAnswer): Promise<void> {
    if (!mounted.current || readOnly || disabled || running.current) throw new Error("Espera a que termine la operación actual.");
    const id = String(step.stepId);
    const signature = answerKey(step, answer);
    if (registeredAnswerKey(answerOperations, step, queuedAnswersRef.current[id]) === signature) {
      setMessage("Esta respuesta ya está registrada en la cola local. No se ha vuelto a enviar; consulta su estado en el centro offline.");
      return;
    }
    running.current = true;
    setAction(`step:${step.stepId}`);
    try {
      const validation = answerError(step, answer);
      if (validation) throw new Error(validation);
      draft.store.setAnswer(step, answer);
      await draft.store.flush();
      if (!mounted.current || callbacks.current.offline === null || callbacks.current.offline?.authBlocked || callbacks.current.staleReadOnly || readOnlyWork(callbacks.current.group, callbacks.current.work)) throw new Error("La ficha no permite guardar ahora. El borrador se conserva.");
      await onSaveStep(String(step.stepId), answer);
      draft.store.confirmAnswer(step, answer);
      if (mounted.current) setMessage(mode === "demo" ? "Respuesta guardada localmente en demostración." : "Respuesta guardada en Qualitzer.");
      await draft.store.flush();
    } catch (error) {
      if (isOfflineQueuedError(error) && error.kind === "answer") {
        queuedAnswersRef.current = { ...queuedAnswersRef.current, [id]: { signature, operationId: error.operationId } };
        if (mounted.current) {
          setQueuedAnswers(queuedAnswersRef.current);
          setOperationError(null);
          setMessage("Respuesta guardada en este dispositivo · en cola. El progreso del servidor no ha cambiado.");
        }
        return;
      }
      if (mounted.current) setOperationError(errorMessage(error));
      throw error;
    } finally {
      running.current = false;
      if (mounted.current) setAction(null);
    }
  }

  function saveReport(): void {
    if (readOnly || disabled || !online) return;
    void runAction("report", async () => {
      const note = draft.store.getSnapshot().data.report.trim();
      if (!note) throw new Error("Escribe una nota antes de guardar el reporte.");
      if (note === draft.store.getSnapshot().data.savedReport) return;
      await draft.store.flush();
      await onReport(note);
      draft.store.confirmReport(note);
      if (mounted.current) setMessage(mode === "demo" ? "Reporte guardado localmente en demostración." : "Reporte guardado en Qualitzer.");
      await draft.store.flush();
      await refreshAfterSave();
      if (mounted.current && maintenance) await files.load();
    });
  }

  function choosePhotos(source: "camera" | "library"): void {
    if (readOnly || disabled) return;
    const selectedTarget = target;
    const selection = ++pickerEpoch.current;
    void runAction("photos", async () => {
      const pending = draft.store.getSnapshot().data.photos.filter((item) => !item.uploaded);
      const result = await pickPhotos(source, MAX_PHOTOS - pending.length);
      if (result.canceled || !mounted.current || selection !== pickerEpoch.current) return;
      const photos = await preparePhotos(storageKey, result.assets, pending.map((item) => item.photo));
      if (Platform.OS === "web" && selection !== pickerEpoch.current) return;
      draft.store.addPhotos(photos, selectedTarget);
      await draft.store.flush();
    });
  }

  function cancelWebPicker(): void {
    if (Platform.OS !== "web" || action !== "photos") return;
    pickerEpoch.current += 1;
    operationEpoch.current += 1;
    running.current = false;
    setAction(null);
  }

  async function cleanUploadedPhotos(): Promise<void> {
    await draft.store.flush();
    const confirmed = draft.store.getSnapshot().data.photos.filter((item) => item.uploaded);
    for (const item of confirmed) deleteLocalPhoto(storageKey, item.photo);
    const ids = new Set(confirmed.map((item) => item.photo.id));
    draft.store.setPhotos(draft.store.getSnapshot().data.photos.filter((item) => !ids.has(item.photo.id)));
    await draft.store.flush();
  }

  function uploadPhotos(): void {
    if (disabled) return;
    const selectedTarget = target;
    void runAction("upload", async () => {
      if (selectedTarget !== undefined && !currentStepIds.has(selectedTarget)) throw new Error("No se puede subir evidencia al paso seleccionado.");
      const selected = draft.store.getSnapshot().data.photos.filter((item) => item.stepId === selectedTarget && !item.uploaded);
      if (selected.length === 0) return;
      validateLocalPhotos(storageKey, selected.map((item) => item.photo));
      await draft.store.flush();
      let queued = false;
      for (const item of selected) {
        try { await props.onUploadDocuments([item.photo], selectedTarget); }
        catch (error) {
          if (!queueOwnsDocument(error)) throw error;
          queued = true;
        }
        draft.store.setPhotos(draft.store.getSnapshot().data.photos.map((current) => current.photo.id === item.photo.id ? { ...current, uploaded: true } : current));
        await draft.store.flush();
      }
      if (mounted.current) setMessage(queued ? "Fotos guardadas en este dispositivo · pendientes de sincronizar. No cuentan como evidencia confirmada." : mode === "demo" ? "Fotos guardadas localmente en demostración." : "Fotos guardadas en Qualitzer.");
      try { await cleanUploadedPhotos(); }
      catch (error) { if (mounted.current) setOperationError(`Las fotos ya fueron transferidas a la cola o confirmadas; no las vuelvas a subir. No se pudo terminar la limpieza local: ${errorMessage(error)}`); }
      if (!queued) await refreshAfterSave();
      if (!queued && mounted.current) void files.load();
    });
  }

  function removePhoto(id: string): void {
    if (readOnly || disabled) return;
    void runAction("remove-photo", async () => {
      const photo = draft.store.getSnapshot().data.photos.find((item) => item.photo.id === id);
      if (!photo) return;
      const original = draft.store.getSnapshot().data.photos;
      draft.store.setPhotos(original.filter((item) => item.photo.id !== id));
      try {
        await draft.store.flush();
        deleteLocalPhoto(storageKey, photo.photo);
      } catch (error) {
        draft.store.setPhotos(original);
        throw error;
      }
    });
  }

  const snapshotDate = new Date(generatedAt);
  const loadedAt = Number.isFinite(snapshotDate.getTime()) ? snapshotDate.toLocaleString("es-CL") : "Fecha de actualización no disponible";
  const storageMessage = !draft.hydrated ? "Recuperando borrador de este trabajo…" : draft.saving ? "Protegiendo borrador en dispositivo…" : "Borrador en dispositivo · los envíos a Qualitzer son explícitos";
  const compactDetail = tab === "checklist" || tab === "evidence";
  const checklistNotices = <View style={styles.tight}>
    {mode === "demo" ? <Text style={styles.caption}>Demostración · cambios locales</Text> : null}
    {operationError ? <Notice message={operationError} tone="error" onDismiss={() => setOperationError(null)} /> : null}
    {message ? <Notice message={message} onDismiss={() => setMessage(null)} /> : null}
    {draft.error ? <><Notice message={draft.error} tone="error" /><Button title="Reintentar almacenamiento local" variant="secondary" disabled={locked} onPress={() => { void runAction("draft", draft.store.retry); }} /></> : null}
    {!draft.hydrated || draft.saving ? <Text accessibilityLiveRegion="polite" style={styles.caption}>{storageMessage}</Text> : null}
    {!online ? <Notice message={offlineReady ? "Sin conexión verificada. Las respuestas se guardan en la cola local; no cuentan como confirmadas. Eliminar y entregar requieren conexión." : "Recuperando la cola local. Espera antes de guardar."} tone="warning" /> : null}
    {staleReadOnly ? <Notice message="Ficha sin verificar. Actualiza antes de responder; los borradores se conservan." tone="warning" /> : null}
    {localWork ? <Notice message="Trabajo pendiente de sincronizar. Las respuestas se habilitarán después de la confirmación del servidor." tone="warning" /> : null}
    {awaitingConfirmation ? <Notice message="Cambio aceptado. Actualiza la ficha para habilitar nuevas acciones." tone="warning" /> : null}
    {timerPending ? <Notice message={`${timerPendingLabel(pendingTimer)} · solicitado: ${STATUS_LABELS[desiredStatus]}.${pendingTimer?.lastError ? ` ${operationErrorReason(pendingTimer.lastError)}` : ""}${pendingTimer?.status === "applied" && props.offline?.lastError ? " No se pudo actualizar la ficha. Reintenta la actualización manual." : ""}`} tone="warning" /> : null}
    <QueuedNotice answers={pendingAnswers} count={pendingAnswers.length + Object.values(queuedAnswers).filter((entry) => !answerOperations.some((operation) => operation.id === entry.operationId)).length} />
    {exitWarning ? <View style={styles.tight}>
      <Notice message="No se pudo proteger el borrador. Volver ahora puede perder cambios al cerrar la aplicación." tone="warning" />
      <Button title="Seguir aquí y conservar los cambios" variant="secondary" disabled={locked} onPress={() => setExitWarning(false)} />
      <Button title="Volver sin copia duradera" variant="danger" disabled={locked} onPress={onBack} />
    </View> : null}
  </View>;

  const evidenceStep = work.checklists.flatMap((checklist) => checklist.steps).find((step) => String(step.stepId) === target);
  const evidenceContent = <FileWorkspace
    compact
    scopeKey={`${storageKey}:work:${draftGroupId}:${draftWorkId}:${target ?? "files"}`}
    resourceKey={JSON.stringify([resourceKey, target])}
    title={target !== undefined ? plainText(evidenceStep?.title ?? "Paso no disponible") : "Archivos del trabajo"}
    requirement={target !== undefined ? evidenceStep?.isFilesRequired ? "Evidencia obligatoria · debe estar confirmada" : "Evidencia opcional del paso" : work.isFilesRequired ? "Evidencia obligatoria del trabajo" : undefined}
    headerAction={target !== undefined ? <IconButton name="folder-open-outline" label="Archivos del trabajo" onPress={() => setTarget(undefined)} /> : undefined}
    notices={<>
      {operationError ? <Notice message={operationError} tone="error" onDismiss={() => setOperationError(null)} /> : null}
      {draft.error ? <Notice message={draft.error} tone="error" /> : null}
      {target !== undefined && !currentStepIds.has(target) ? <Notice message="El paso ya no está en este trabajo. Vuelve al checklist; el borrador se conserva." tone="warning" /> : null}
      {staleReadOnly ? <Notice message="Ficha sin verificar. Actualiza; los borradores se conservan." tone="warning" /> : null}
      {exitWarning ? <><Notice message="No se pudo proteger el borrador del trabajo." tone="warning" /><Button title="Seguir aquí y conservar los cambios" variant="secondary" onPress={() => setExitWarning(false)} /><Button title="Volver sin copia duradera" variant="danger" onPress={onBack} /></> : null}
    </>}
    mode={mode} readOnly={target !== undefined && !currentStepIds.has(target)} busy={locked || staleReadOnly || !offlineReady} offline={props.offline} pending={pendingDocuments} readLocalFile={props.readLocalFile}
    onLoad={async () => {
      const current = callbacks.current;
      if (target !== undefined && !currentStepIds.has(target)) return [];
      const attachments = await (target !== undefined ? current.onLoadStepFiles(target) : current.onLoadFiles());
      const operations = operationsForWork(current.offline, { groupId: current.group.id, workId: current.work.id, ...current.range, companyBranchId: current.companyBranchId });
      return attachments.filter((file) => {
        const operationId = offlineAttachment(file)?.offline.operationId;
        return !operationId || operations.some((operation) => operation.id === operationId && operation.kind === "document" && operation.stepId === target);
      });
    }}
    onUpload={async (documents) => { await props.onUploadDocuments(documents, target); void refreshAfterSave(); if (mounted.current) void files.load(); }}
    onDelete={async (fileId) => { await props.onDeleteFile(fileId, target); await refreshAfterSave(); if (mounted.current) await files.load(); }}
    listFooter={draft.data.photos.length > 0 ? <Card style={styles.stack}><SectionTitle title="Fotos pendientes anteriores" subtitle="Conservamos las fotos que preparaste antes de esta actualización." /><EvidenceTab work={work} maintenance={maintenance} mode={mode} files={files.files} loading={files.loading} filesError={files.error} photos={draft.data.photos} target={target} disabled={disabled} readOnly={false} preparing={action === "photos"} uploading={action === "upload"} onTarget={setTarget} onPick={choosePhotos} onCancelPick={cancelWebPicker} onRemove={removePhoto} onUpload={uploadPhotos} onCleanup={() => { void runAction("cleanup", cleanUploadedPhotos); }} onLoad={() => { void runAction("files", files.load); }} /></Card> : undefined}
  />;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={insets.top}>
      {compactDetail ? <>
        {props.connectionStatus}
        <View style={styles.checklistHeader} testID="compact-work-header">
          <IconButton name="arrow-back-outline" label="Volver conservando el borrador" disabled={locked} onPress={goBack} />
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.code}>{localWork ? "Pendiente de sincronizar" : codes.workCode ?? "Trabajo"}</Text>
            <Text style={styles.caption}>{STATUS_LABELS[work.status]}</Text>
          </View>
          {tab === "evidence" && target !== undefined ? <Button title="Checklist" accessibilityLabel="Volver al checklist" variant="ghost" style={styles.checklistHeaderButton} onPress={() => setTab("checklist")} /> : <Button title="Trabajo" accessibilityLabel="Ver detalle del trabajo, archivos y comentarios" variant="ghost" style={styles.checklistHeaderButton} onPress={() => setTab("work")} />}
          <IconButton name="refresh-outline" label="Actualizar asignación y evidencias" disabled={locked} onPress={refresh} />
        </View>
      </> : <>
      <SessionContextBar tenant={props.tenant} branchName={props.branchName}>{props.connectionStatus}</SessionContextBar>
      <View style={styles.header}>
        <IconButton name="arrow-back-outline" label="Volver conservando el borrador" disabled={locked} onPress={goBack} />
        <View style={styles.headerText}>
          <View style={styles.row}>
            {localWork ? <><Badge label="Pendiente de sincronizar" tone="warning" />{group.code.trim() ? <Badge label={plainText(group.code)} /> : null}</> : codes.workCode ? <Badge label={codes.workCode} tone="teal" /> : null}
            {!localWork && codes.workOrderCode ? <Badge label={codes.workOrderCode} tone="info" /> : null}
            {!localWork && codes.negotiationCode ? <Badge label={codes.negotiationCode} /> : null}
          </View>
          <Text numberOfLines={1} style={styles.caption}>Detalle de ejecución</Text>
        </View>
        <Badge label={STATUS_LABELS[work.status]} tone={statusTones[work.status]} />
        <IconButton name="refresh-outline" label="Actualizar asignación y evidencias" disabled={locked} onPress={refresh} />
      </View>
      </>}
      {tab === "evidence" ? evidenceContent : tab === "checklist" ? <ChecklistTab work={evidenceWork} draft={draft.data} maintenance={maintenance} disabled={disabled} readOnly={readOnly} mode={mode} storageKey={identity} onRefresh={onRefresh} savingStep={action?.startsWith("step:") ? action.slice(5) : null} isAnswerQueued={(step, answer) => registeredAnswerKey(answerOperations, step, queuedAnswers[String(step.stepId)]) === answerKey(step, answer)} pendingEvidenceCount={(id) => allPendingDocuments.filter((operation) => operation.stepId === id).length} onChange={draft.store.setAnswer} onDiscard={draft.store.discardAnswer} onSave={saveStep} onEvidence={(id) => { setTarget(id); setTab("evidence"); }} notices={checklistNotices} catalogHeader={
        <ChecklistAssociationPanel storageKey={storageKey} group={group} work={work} mode={mode} online={online} busy={locked} pendingLocalWork={localWork} readOnly={staleReadOnly || props.offline?.authBlocked} offlineReady={offlineReady} pending={checklistOperations} loadOptions={props.onLoadChecklistOptions} attach={props.onAttachChecklist} onAttached={async () => { await callbacks.current.onRefresh(); }} />
      } /> : <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={action === "refresh"} onRefresh={refresh} enabled={!locked} tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={palette.surface} />}>
          {mode === "demo" ? <Notice message="Modo demostración · los cambios y confirmaciones son locales, no se envían a Qualitzer." /> : null}
          {operationError ? <Notice message={operationError} tone="error" onDismiss={() => setOperationError(null)} /> : null}
          {exitWarning ? <Card style={styles.stack}>
            <Notice message="No se pudo proteger el borrador en el almacenamiento. Si vuelves ahora, los cambios quedarán solo en esta sesión y podrían perderse al cerrar la aplicación." tone="warning" />
            <Button title="Seguir aquí y conservar los cambios" variant="secondary" disabled={locked} onPress={() => setExitWarning(false)} />
            <Button title="Volver sin copia duradera" variant="danger" disabled={locked} onPress={onBack} />
          </Card> : null}
          {message ? <Notice message={message} tone={props.offline !== undefined ? "info" : "success"} onDismiss={() => setMessage(null)} /> : null}
          {readOnly ? <Notice message={localWork ? "Trabajo guardado en este dispositivo, pendiente de sincronizar. Puedes añadir archivos y comentarios. La ejecución se habilitará solo después de la confirmación y autorización del servidor." : staleReadOnly ? "La ficha actual aún no está verificada. Actualiza para confirmar los datos y permisos del trabajo antes de ejecutar o responder; los borradores se conservan. Esto no indica que la OT esté cerrada." : "Trabajo entregado o completado. La ejecución y las respuestas son de solo lectura; puedes consultar o agregar archivos y comentarios autorizados."} /> : null}
          {!online ? <Notice message={offlineReady ? "Sin conexión verificada: iniciar y pausar se guardan en cola, sin confirmar tiempos. Reportar, eliminar y entregar requieren conexión." : "Recupera la cola local y verifica tu sesión antes de guardar cambios. Los borradores se conservan."} tone="warning" /> : null}
          {timerPending ? <Notice message={`${timerPendingLabel(pendingTimer)} · solicitado: ${STATUS_LABELS[desiredStatus]}. Estado recibido: ${STATUS_LABELS[work.status]}.${pendingTimer ? ` ${operationStatusLabels[pendingTimer.status]}.` : ""}${pendingTimer?.lastError ? ` ${operationErrorReason(pendingTimer.lastError)}` : ""}${pendingTimer?.status === "applied" && props.offline?.lastError ? " No se pudo actualizar la ficha. Reintenta la actualización manual." : ""}`} tone="warning" /> : null}
          {awaitingConfirmation ? <Notice message="El cambio fue aceptado. Esperando la ficha actualizada para habilitar nuevas acciones. Si la actualización falló, pulsa Actualizar." tone="warning" /> : null}
          {!compactDetail ? <>
          <LinearGradient colors={[palette.navy, palette.navyLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Text style={styles.heroOverline}>{maintenance ? "MANTENIMIENTO INTERNO" : group.type === "external_ot" ? "ORDEN DE TRABAJO" : "ASIGNACIÓN DIRECTA"}</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>{plainText(work.title)}</Text>
            <View style={styles.row}><Ionicons name="construct-outline" size={18} color={palette.onDark} accessible={false} /><Text style={styles.heroText}>{plainText(work.specialty) || "Especialidad no informada"}</Text></View>
            <ElapsedTimer work={work} generatedAt={generatedAt} online={online && !localWork && !staleReadOnly} pending={timerPending} />
            <View style={styles.heroMetrics}>
              <View style={styles.metric}><Text style={styles.heroText}>Programado</Text><Text style={styles.metricValue}>{shortDate(work.scheduledDate)}</Text></View>
              <View style={styles.metric}><Text style={styles.heroText}>Tiempo previsto</Text><Text style={styles.metricValue}>{duration(work.plannedMinutes)}</Text></View>
              <View style={styles.metric}><Text style={styles.heroText}>Prioridad</Text><Text style={styles.metricValue}>{work.priority === "high" ? "Alta" : work.priority === "medium" ? "Media" : "Baja"}</Text></View>
            </View>
          </LinearGradient>
          {!readOnly ? <Card style={styles.stack}>
            <SectionTitle title="Control de ejecución" subtitle={`Fecha para iniciar o pausar: ${shortDate(selectedDate)} · ${selectedDate}`} />
            {!work.canExecute ? <Notice message="La ejecución no está habilitada por Qualitzer. Puedes revisar los requisitos y guardar la información pendiente." tone="warning" /> : null}
            {work.missingRequiredInfo.length > 0 ? <View style={styles.tight}>{work.missingRequiredInfo.map((item, index) => <BodyText key={`${index}:${item}`}>• {plainText(item)}</BodyText>)}</View> : null}
            <View style={styles.row}>
              {desiredStatus === "in_progress" ? <Button title="Pausar trabajo" variant="secondary" icon="pause-outline" disabled={disabled || timerNeedsAttention || !withinRange(selectedDate, range)} onPress={() => updateStatus({ status: "paused", executionDates: [selectedDate] })} /> : desiredStatus === "pending" || desiredStatus === "paused" ? <Button title={desiredStatus === "paused" ? "Reanudar trabajo" : "Iniciar trabajo"} icon="play-outline" disabled={disabled || timerNeedsAttention || !work.canExecute || !withinRange(selectedDate, range)} onPress={() => updateStatus({ status: "in_progress", executionDates: [selectedDate] })} /> : null}
              <Button title="Entregar trabajo" icon="checkmark-circle-outline" variant="secondary" disabled={disabled || !online || !work.canExecute || hasPendingOperations} onPress={() => { if (mounted.current && !executionGates.current.disabled && !executionGates.current.readOnly && !executionGates.current.hasPendingOperations && !queuedTimerRef.current && executionGates.current.online) setCompleting(true); }} />
            </View>
            {busy || action === "status" ? <BodyText>Protegiendo el cambio… Espera al guardado local antes de realizar otra acción.</BodyText> : null}
          </Card> : null}
          <View style={styles.tight}>
            <Text accessibilityLiveRegion="polite" style={styles.caption}>{draft.error ? "El borrador aún no está protegido" : storageMessage}</Text>
            {draft.error ? <View style={styles.tight}><Notice message={draft.error} tone="error" /><Button title="Reintentar almacenamiento local" variant="secondary" disabled={locked} onPress={() => { void runAction("draft", draft.store.retry); }} /></View> : null}
            <Text style={styles.caption}>Última carga: {loadedAt}</Text>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} accessibilityLabel={item.label} onPress={() => setTab(item.id)} style={({ pressed }) => [styles.tab, tab === item.id && styles.activeTab, pressed && styles.disabled]}>
              <Ionicons name={item.icon} size={19} color={tab === item.id ? palette.primary : palette.textSecondary} accessible={false} /><Text style={[styles.tabText, tab === item.id && styles.activeTabText]}>{item.label}</Text>
            </Pressable>)}
          </View>
          </> : null}
          {tab === "work" ? <WorkTab group={group} work={work} report={draft.data.report} savedReport={draft.data.savedReport} disabled={disabled || !online || localWork || staleReadOnly} readOnly={readOnlyWork(group, work)} submitting={action === "report"} mode={mode} onReportChange={draft.store.setReport} onReportSubmit={saveReport} /> : null}
            {tab === "comments" ? <CommentsTab scopeKey={`${storageKey}:work:${draftGroupId}:${draftWorkId}:comments`} resourceKey={resourceKey} mode={mode} busy={locked || staleReadOnly} pending={props.offline !== undefined ? pendingComments : undefined} offlineReady={offlineReady} onLoad={props.onLoadComments} onSubmit={props.onAddComment} /> : null}
          {tab === "equipment" ? <EquipmentTab group={group} work={work} /> : null}
        </ScrollView>}
      </KeyboardAvoidingView>
      {completing && online && !readOnly && !hasPendingOperations ? <CompletionDialog work={evidenceWork} allowEditExecutionTime={props.allowEditExecutionTime} generatedAt={generatedAt} maintenance={maintenance} initialDate={selectedDate} range={range} reasons={reasons} error={operationError} busy={locked} mode={mode} onClose={() => setCompleting(false)} onSubmit={updateStatus} /> : null}
    </SafeAreaView>
  );
}