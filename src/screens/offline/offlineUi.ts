import { z } from "zod";
import { calendarDateSchema, mobileUuidSchema } from "../../domain/creation";
import { normalizeChecklistAnswer } from "../../domain/checklistProgress";
import { syncResponseForStep } from "../../domain/offlineProtocol";
import type { AssignmentWork, Attachment, ChecklistStep, DateRange, LocalPhoto, StepAnswer } from "../../domain/models";
import { isOfflineQueuedError } from "../../domain/offline";
import type { OfflineAttachment, OfflineOperation, OfflineOperationStatus, OfflineQueuedOutcome, OfflineScope, OfflineSnapshot } from "../../domain/offline";
import { requiresDeployment } from "../../offline/connection";
import { timerReconciledWithWork } from "../../offline/queueIntentions";

export type PendingComment = Extract<OfflineOperation, { kind: "comment" }>;
export type PendingAnswer = Extract<OfflineOperation, { kind: "answer" }>;
export type PendingDocument = Extract<OfflineOperation, { kind: "document" }>;
export type PendingTimer = Extract<OfflineOperation, { kind: "timer" }>;
export type PendingChecklist = Extract<OfflineOperation, { kind: "checklist" }>;
export type PendingCompletion = Extract<OfflineOperation, { kind: "completion" }>;

export function completionStatusLabel(completion: PendingCompletion): string {
  if (["conflict", "blocked", "needs_review", "auth_required"].includes(completion.status)) return "Entrega por revisar";
  const status = completion.payload.input.status === "delivered" ? "Entregado" : "Completado";
  return completion.status === "applied" ? `${status} · actualizando` : `${status} local · pendiente`;
}

export function completionForWork(operations: readonly OfflineOperation[], work: AssignmentWork): PendingCompletion | undefined {
  return operations.find((operation): operation is PendingCompletion => operation.kind === "completion"
    && !timerReconciledWithWork(operation, work)
    && !(operation.status === "applied" && work.status === operation.payload.input.status));
}

export function locallySavedWork(work: AssignmentWork, operations: readonly OfflineOperation[]): AssignmentWork {
  return { ...work, checklists: work.checklists.map(list => ({ ...list, steps: list.steps.map(step => {
    const answer = operations.filter((operation): operation is PendingAnswer => operation.kind === "answer" && String(operation.stepId) === String(step.stepId)
      && ["pending", "syncing", "applied"].includes(operation.status)).at(-1);
    const saved = answer?.answer;
    const value = saved ? "executionStatus" in saved ? saved.responseValue : syncResponseForStep(step, saved) : undefined;
    const documents = operations.filter((operation): operation is PendingDocument => operation.kind === "document" && operation.stepId === String(step.stepId)
      && ["pending", "syncing", "applied"].includes(operation.status));
    return { ...step, ...(saved ? { isCompleted: saved.isCompleted, comment: saved.comment ?? "",
      responseValue: typeof value === "string" ? value : step.responseValue,
      selectValue: typeof value === "string" ? value : step.selectValue, optionsSelectValue: Array.isArray(value) ? value : step.optionsSelectValue } : {}),
      attachments: [...step.attachments.filter(isConfirmedAttachment), ...documents.map(pendingDocumentAttachment)] };
  }) })) };
}
export interface QueuedTimerMarker { operationId: string; status: "in_progress" | "paused"; }
export const PENDING_TIMER_LABEL = "Guardando…";
export function timerPendingLabel(timer: PendingTimer | null): string {
  return timer?.status === "applied" ? "Actualizando…"
    : timer?.status === "conflict" ? "Conflicto · revisar"
    : timer?.status === "needs_review" || timer?.status === "blocked" ? "Requiere revisión"
    : timer?.status === "auth_required" ? "Verificar sesión"
    : timer?.payload.recordedAt ? timer.status === "syncing" ? "Sincronizando…" : "Guardado local" : PENDING_TIMER_LABEL;
}
export const queuedCreationOutcomeSchema = z.object({
  operationId: mobileUuidSchema, operationIds: z.array(mobileUuidSchema).length(1), kind: z.literal("create"),
  localGroupId: z.string(), localWorkId: z.string(), date: calendarDateSchema, ownsFiles: z.literal(false),
}).strict().refine((value) => value.operationIds[0] === value.operationId && value.localGroupId === `local-${value.operationId}` && value.localWorkId === `local-${value.operationId}`);

export function queuedOutcomeData(value: OfflineQueuedOutcome): OfflineQueuedOutcome {
  return { operationId: value.operationId, operationIds: [...value.operationIds], kind: value.kind, localGroupId: value.localGroupId,
    localWorkId: value.localWorkId, date: value.date, ownsFiles: value.ownsFiles };
}

export const operationStatusLabels: { [Status in OfflineOperationStatus]: string } = {
  pending: "Pendiente", syncing: "Sincronizando", applied: "Confirmado", blocked: "Bloqueado",
  auth_required: "Requiere sesión verificada", needs_review: "Requiere revisión", conflict: "Conflicto",
};

export function canRetryOperation(operation: OfflineOperation, now = Date.now()): boolean {
  if (operation.receipt && operation.receipt.state !== "applied") return false;
  if (operation.lastError === "MOBILE_SYNC_OPERATION_REUSED" || operation.lastError === "MOBILE_CREATION_REQUEST_CONFLICT") return false;
  if ((requiresDeployment(operation.lastError) || operation.lastError === "MOBILE_SYNC_IN_PROGRESS") && operation.nextAttemptAt > now) return false;
  return operation.status === "pending" || (operation.status === "blocked" &&
    ["OFFLINE_NETWORK_UNAVAILABLE", "OFFLINE_TIMEOUT_UNCERTAIN", "OFFLINE_CYCLE_INTERRUPTED"].includes(operation.lastError ?? ""));
}

export function offlineAttachment(file: Attachment): OfflineAttachment | null {
  if (!("offline" in file) || !Object.prototype.hasOwnProperty.call(file, "offline") || !file.offline || typeof file.offline !== "object" || Array.isArray(file.offline)) return null;
  const metadata = file.offline;
  if (!("confirmed" in metadata) || !Object.prototype.hasOwnProperty.call(metadata, "confirmed") || typeof metadata.confirmed !== "boolean"
    || !("downloaded" in metadata) || !Object.prototype.hasOwnProperty.call(metadata, "downloaded") || typeof metadata.downloaded !== "boolean") return null;
  return file as OfflineAttachment;
}

export function isConfirmedAttachment(file: Attachment): boolean {
  return "offline" in file ? offlineAttachment(file)?.offline.confirmed === true : !String(file.id).startsWith("local-");
}

export function confirmedEvidenceWork<T extends { checklists: { steps: ChecklistStep[] }[] }>(work: T): T {
  return { ...work, checklists: work.checklists.map((list) => ({ ...list, steps: list.steps.map((step) => ({ ...step, attachments: step.attachments.filter(isConfirmedAttachment) })) })) };
}

export function answerKey(step: ChecklistStep, answer: StepAnswer): string {
  const normalized = normalizeChecklistAnswer(step, answer);
  const value = Array.isArray(normalized.responseValue) ? normalized.responseValue.map((item) => item.value).sort() : normalized.responseValue;
  return JSON.stringify({ responseValue: value, isCompleted: normalized.isCompleted, executionStatus: normalized.executionStatus, comment: normalized.comment ?? "" });
}

export function operationsForWork(snapshot: OfflineSnapshot | null | undefined, scope: Omit<OfflineScope, "companyBranchId"> & { companyBranchId?: number }): OfflineOperation[] {
  if (!snapshot) return [];
  return snapshot.operations.filter((operation) => {
    if (operation.kind === "create") return false;
    const source = operation.scope;
    if (source.startDate !== scope.startDate || source.endDate !== scope.endDate || (scope.companyBranchId !== undefined && source.companyBranchId !== scope.companyBranchId)) return false;
    if (source.groupId === scope.groupId && source.workId === scope.workId) return true;
    const parent = snapshot.operations.find((entry) => entry.kind === "create" && entry.localGroupId === source.groupId
      && (source.workId === undefined || entry.localWorkId === source.workId)
      && (operation.dependencyId === undefined || entry.id === operation.dependencyId)
      && entry.input.companyBranchId === source.companyBranchId);
    if (parent?.kind !== "create" || parent.status !== "applied" || !parent.result || parent.result.companyBranchId !== source.companyBranchId) return false;
    return parent.result.groupId === scope.groupId && (source.workId === undefined ? scope.workId === undefined : String(parent.result.workId) === scope.workId);
  });
}

export function pendingDocumentAttachment(operation: PendingDocument): OfflineAttachment {
  return { id: `local-${operation.file.id}`, name: operation.file.name, url: "", type: operation.file.mimeType, size: operation.file.size,
    createdAt: new Date(operation.createdAt).toISOString(), offline: { confirmed: false, downloaded: true, localFileId: operation.file.id, operationId: operation.id, status: operation.status } };
}

export function pendingTimerForWork(snapshot: OfflineSnapshot | null | undefined, scope: Omit<OfflineScope, "companyBranchId"> & { companyBranchId?: number }, work?: AssignmentWork): PendingTimer | null {
  return operationsForWork(snapshot, scope).reduce<PendingTimer | null>((latest, operation) =>
    operation.kind === "timer" && !timerReconciledWithWork(operation, work) ? operation : latest, null);
}

export function coverageDates(range: DateRange): string[] {
  if (!calendarDateSchema.safeParse(range.startDate).success || !calendarDateSchema.safeParse(range.endDate).success || range.endDate < range.startDate) return [];
  const result: string[] = [];
  const cursor = new Date(`${range.startDate}T12:00:00Z`);
  while (result.length < 7 && cursor.toISOString().slice(0, 10) <= range.endDate) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export interface QueuedAnswerMarker { signature: string; operationId: string; }
export function registeredAnswerKey(operations: PendingAnswer[], step: ChecklistStep, local?: QueuedAnswerMarker): string | null {
  const answers = operations.filter((operation) => operation.stepId === String(step.stepId));
  const latest = answers.reduce<PendingAnswer | undefined>((current, operation) => !current || operation.createdAt >= current.createdAt ? operation : current, undefined);
  if (local && (!answers.some((operation) => operation.id === local.operationId) || latest?.id === local.operationId)) return local.signature;
  if (!latest) return null;
  if ("executionStatus" in latest.answer) return answerKey(step, latest.answer);
  try {
    return answerKey(step, { responseValue: syncResponseForStep(step, latest.answer), isCompleted: latest.answer.isCompleted ?? false, executionStatus: null, comment: latest.answer.comment });
  } catch { return null; }
}

export function queueOwnsDocument(error: unknown): boolean {
  return isOfflineQueuedError(error) && error.kind === "document" && error.ownsFiles;
}

export function trustedLocalFile(fileId: string, file: LocalPhoto, platform: string): boolean {
  if (file.id !== fileId || /[\s\\\u0000-\u001f\u007f]/.test(file.uri)) return false;
  try {
    const url = new URL(file.uri);
    if (platform === "web") return url.protocol === "blob:";
    const path = decodeURIComponent(url.pathname);
    return file.uri.startsWith("file:///") && url.protocol === "file:" && !url.hostname && !url.username && !url.password
      && !url.search && !url.hash && path.startsWith("/") && !path.startsWith("//") && !path.endsWith("/") && !/[\\\u0000-\u001f\u007f]/.test(path);
  } catch { return false; }
}

export function operationTitle(operation: OfflineOperation): string {
  if (operation.kind === "document") return `Archivo · ${operation.file.name}`;
  if (operation.kind === "comment") return "Comentario";
  if (operation.kind === "answer") return "Respuesta de checklist";
  if (operation.kind === "timer") return operation.payload.status === "paused" ? "Pausar trabajo" : "Iniciar o reanudar trabajo";
  if (operation.kind === "checklist") return `Asociar checklist · ${operation.payload.checklistId}`;
  if (operation.kind === "completion") return operation.payload.input.status === "delivered" ? "Entregar trabajo" : "Terminar trabajo";
  const input = operation.input;
  return input.kind === "work" ? `Crear trabajo · ${input.work.title}` : input.kind === "maintenance" ? `Crear mantenimiento · ${input.maintenance.title}` : "Registrar tiempo no productivo";
}

export function operationErrorReason(code: string | undefined): string {
  if (!code) return "";
  if (requiresDeployment(code)) return "Requiere actualizar el servidor. Se reintentará automáticamente; los datos y archivos están conservados.";
  if (code === "OFFLINE_NETWORK_UNAVAILABLE" || code === "OFFLINE_TIMEOUT_UNCERTAIN") return "No se pudo confirmar el envío a Qualitzer. Se conserva para reintentar con el mismo identificador.";
  if (code === "MOBILE_CREATION_REQUEST_CONFLICT" || code === "MOBILE_SYNC_OPERATION_REUSED") return "El identificador tiene un conflicto. Requiere revisión; no se reenvía automáticamente.";
  if (code === "MOBILE_SYNC_IN_PROGRESS") return "El servidor está procesando esta operación. Se comprobará de nuevo después de la espera.";
  if (code === "OFFLINE_DOCUMENT_RECOVERY_PENDING") return "Recuperando el envío del archivo. Se comprobarán su copia local y el recibo sin crear un duplicado.";
  if (code === "OFFLINE_SYNC_UNEXPECTED_RESPONSE" || code === "OFFLINE_DOCUMENT_UNEXPECTED_ERROR" || code === "OFFLINE_DOCUMENT_SUBMISSION_FAILED") return "No se pudo comprobar el resultado del envío. La copia local sigue conservada; no elimines el archivo ni crees otro envío.";
  if (code === "OFFLINE_DOCUMENT_INVALID_SCOPE" || code === "OFFLINE_DOCUMENT_INVALID_METADATA") return "No se pudo validar el destino del archivo. La copia se conserva y no se envía a un trabajo distinto.";
  if (code === "OFFLINE_DOCUMENT_MULTIPART_PREPARATION_FAILED" || code === "OFFLINE_LOCAL_FILE_UNREADABLE") return "No se pudo leer o preparar la copia local para enviarla. Se conserva para revisar el problema del dispositivo.";
  if (code === "OFFLINE_FILE_INTEGRITY_MISMATCH" || code === "OFFLINE_LOCAL_FILE_MISSING") return "La copia local no coincide con el archivo guardado o no está disponible. El envío se detuvo para no adjuntar otro contenido.";
  if (code === "OFFLINE_DOCUMENT_FILE_ID_INVALID" || code === "OFFLINE_INVALID_RECEIPT" || code === "OFFLINE_RECEIPT_INVALID_RESPONSE") return "Qualitzer no devolvió una confirmación válida del archivo. La copia sigue guardada y no se marca como evidencia confirmada.";
  return code;
}

export interface OperationDependencyInfo {
  status: "waiting" | "blocked" | "missing" | "ready";
  title: string;
  reason: string;
  parent?: OfflineOperation;
}
export function dependencyInfo(operation: OfflineOperation, operations: readonly OfflineOperation[] | ReadonlyMap<string, OfflineOperation>): OperationDependencyInfo {
  if (operation.kind === "completion" && operation.status !== "applied") {
    const items = [...operations.values()];
    const id = operation.prerequisiteIds.find(id => items.find(item => item.id === id)?.status !== "applied");
    if (id) return dependencyInfo({ ...operation, kind: "comment", text: "", dependencyId: id }, operations);
  }
  if (!operation.dependencyId || operation.status === "applied") return { status: "ready", title: "", reason: "" };
  const parent = "get" in operations ? operations.get(operation.dependencyId) : operations.find((entry) => entry.id === operation.dependencyId);
  if (!parent) return { status: "missing", title: "Esperando operación anterior", reason: "No se encontró la operación anterior en esta cola. Los cambios siguen guardados; requieren revisión." };
  if (parent.status === "applied") return { status: "ready", title: "", reason: "", parent };
  const blocked = ["blocked", "conflict", "needs_review", "auth_required"].includes(parent.status);
  return { status: blocked ? "blocked" : "waiting", title: parent.kind === "create" ? "Esperando crear el trabajo" : "Esperando operación anterior", parent,
    reason: operationErrorReason(parent.lastError) || (blocked ? `La operación anterior requiere atención: ${operationStatusLabels[parent.status]}.` : "Primero debe confirmarse la operación anterior. Este elemento aún no se ha enviado; no es un fallo.") };
}