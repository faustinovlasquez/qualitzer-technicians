import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { AssignmentGroup, AssignmentWork, Attachment, ChecklistStep, CommentPage, LocalPhoto, StatusInput, StepAnswer, WorkDetailTab, WorkStatus } from "../../src/domain/models";
import { OfflineQueuedError, type OfflineOperation, type OfflineSnapshot, type TimerReadAssignmentWork } from "../../src/domain/offline";
import { WorkDetailScreen } from "../../src/screens/WorkDetailScreen";
import { AssignmentWorkCard } from "../../src/screens/orders/AssignmentWorkCard";
import { CommentsTab } from "../../src/screens/workDetail/CommentsTab";
import { FileWorkspace } from "../../src/screens/workDetail/FileWorkspace";
import { pendingTimerForWork, type PendingComment, type PendingDocument } from "../../src/screens/offline/offlineUi";

type Screen = "card" | "card-explicit" | "detail" | "answers" | "association" | "comments" | "files";
interface Metrics {
  attempts: OfflineOperation[];
  committed: OfflineOperation[];
  gates: number;
  remoteStarts: number;
  remoteCompleted: number;
  fileLoads: number;
  commentLoads: number;
  refreshes: number;
  opened: number;
  work: TimerReadAssignmentWork;
}
interface DurableFixture {
  render(screen: Screen, options?: { holdReads?: boolean; status?: WorkStatus; offlineReady?: boolean }): void;
  release(): void;
  reject(): void;
  applied(): Promise<void>;
  publishWork(status: WorkStatus, proof: boolean): void;
  revision(): void;
  ready(value: boolean): void;
  metrics(): Metrics;
  durable(): Promise<{ operation: OfflineOperation; bytes?: Blob }[]>;
}
declare global { interface Window { durableFluidity: DurableFixture; } }

const date = "2026-09-14";
const scope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: date, endDate: date };
const initialOffline: OfflineSnapshot = { online: true, authBlocked: false, preparing: false, syncing: false, pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [], operations: [], connection: { status: "ready", networkConnected: true, foreground: true, checkedAt: null } };
function makeStep(index: number): ChecklistStep {
  return { stepId: 1001 + index, order: index + 1, title: index === 0 ? "¿El equipo está limpio?" : "Observación siguiente", description: "", tag: "", type: index === 0 ? "validation" : "text", options: [], isRequired: true, isFilesRequired: false, isCompleted: null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "", executionStatus: null, attachments: [] };
}
function makeWork(status: WorkStatus): TimerReadAssignmentWork {
  return { id: "11", workType: "productive", title: "Inspección de fluidez aislada", summary: "Datos ficticios, sin API", specialty: "Mecánica", status, priority: "medium", scheduledDate: date, scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedDates: [date], plannedMinutes: 60, executedMinutes: 0, elapsedSeconds: 120, commentsCount: 0, filesCount: 0, isFilesRequired: false, checklistDone: 0, checklistTotal: 2, isOverdue: false, canExecute: true, canEditDefinition: true, missingRequiredInfo: [], materials: [], responsibles: [], checklists: [{ checklistId: 10, name: "Checklist de fluidez", code: "FLUIDITY", required: true, steps: [makeStep(0), makeStep(1)] }] };
}
function groupFor(work: AssignmentWork): AssignmentGroup {
  return { id: scope.groupId, type: "direct_assignment", code: "TR-11", title: "Asignación ficticia", status: work.status, customerName: "Cliente ficticio", locationName: "Taller", locationAddress: null, scheduledDate: date, scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60, isOverdue: false, isResponsible: true, canManage: true, equipment: null, products: [], works: [work] };
}
function never<T>(): Promise<T> { return new Promise<T>(() => {}); }
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("durable-fluidity-isolated", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("operations", { keyPath: "operation.id" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function persist(operation: OfflineOperation, bytes?: Blob): Promise<void> {
  const db = await database;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("operations", "readwrite");
    tx.objectStore("operations").put({ operation, bytes });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("FIXTURE_LOCAL_COMMIT_ABORTED"));
  });
}
const root = createRoot(document.getElementById("root")!);
let currentIds = new Set<string>();
const api: DurableFixture = {
  render(screen, options = {}) {
    const identity = `durable-fluidity-${crypto.randomUUID()}`;
    root.render(<Fixture key={identity} identity={identity} screen={screen} options={options} />);
  },
  release() {}, reject() {}, applied: async () => {}, publishWork() {}, revision() {}, ready() {},
  metrics: () => { throw new Error("FIXTURE_NOT_READY"); },
  async durable() {
    const db = await database;
    const records = await new Promise<{ operation: OfflineOperation; bytes?: Blob }[]>((resolve, reject) => {
      const request = db.transaction("operations", "readonly").objectStore("operations").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return records.filter(record => currentIds.has(record.operation.id));
  },
};
window.durableFluidity = api;

function Fixture({ screen, identity, options }: { screen: Screen; identity: string; options: { holdReads?: boolean; status?: WorkStatus; offlineReady?: boolean } }) {
  const [state] = useState(() => ({
    metrics: { attempts: [], committed: [], gates: 0, remoteStarts: 0, remoteCompleted: 0, fileLoads: 0, commentLoads: 0, refreshes: 0, opened: 0, work: makeWork(options.status ?? (screen === "answers" ? "in_progress" : "pending")) } as Metrics,
    gates: [] as { resolve(): void; reject(error: Error): void }[],
    localFiles: new Map<string, LocalPhoto>(),
    ids: new Set<string>(),
  }));
  const [work, setWork] = useState(state.metrics.work);
  const [offline, setOffline] = useState(initialOffline);
  const [ready, setReady] = useState(options.offlineReady ?? true);
  const [revision, setRevision] = useState(0);
  state.metrics.work = work;
  currentIds = state.ids;
  function publish(): void {
    setOffline({ ...initialOffline, syncing: state.metrics.remoteStarts > 0, pending: state.metrics.committed.filter(op => op.status !== "applied").length, operations: [...state.metrics.committed] });
  }
  function base() {
    return { id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0, nextAttemptAt: 0, status: "pending" as const, scope };
  }
  async function enqueue(operation: OfflineOperation, file?: LocalPhoto, bytes?: Blob): Promise<never> {
    state.metrics.attempts.push(operation);
    state.ids.add(operation.id);
    await new Promise<void>((resolve, reject) => { state.gates.push({ resolve, reject }); state.metrics.gates = state.gates.length; });
    await persist(operation, bytes);
    if (file && operation.kind === "document") state.localFiles.set(operation.file.id, { ...file, id: operation.file.id });
    state.metrics.committed.push(operation);
    state.metrics.remoteStarts++;
    void never<void>().then(() => { state.metrics.remoteCompleted++; });
    publish();
    throw new OfflineQueuedError({ operationId: operation.id, operationIds: [operation.id], kind: operation.kind, date, ownsFiles: operation.kind === "document" });
  }
  api.release = () => { const gate = state.gates.shift(); if (!gate) throw new Error("NO_LOCAL_COMMIT_WAITING"); state.metrics.gates = state.gates.length; gate.resolve(); };
  api.reject = () => { const gate = state.gates.shift(); if (!gate) throw new Error("NO_LOCAL_COMMIT_WAITING"); state.metrics.gates = state.gates.length; gate.reject(new Error("FIXTURE_LOCAL_COMMIT_FAILED")); };
  api.metrics = () => state.metrics;
  api.ready = setReady;
  api.revision = () => setRevision(value => value + 1);
  api.applied = async () => {
    const stored = new Map((await api.durable()).map(record => [record.operation.id, record]));
    state.metrics.committed = state.metrics.committed.map(operation => ({ ...operation, status: "applied", receipt: { operationId: operation.id, state: "applied" } }));
    for (const operation of state.metrics.committed) await persist(operation, stored.get(operation.id)?.bytes);
    publish();
  };
  api.publishWork = (status, proof) => setWork(current => ({ ...current, status, offlineTimerRead: proof ? { scope, appliedOperationIds: state.metrics.committed.filter(op => op.kind === "timer" && op.status === "applied").map(op => op.id) } : undefined }));
  const onStatus = async (input: StatusInput): Promise<void> => {
    if (input.status !== "in_progress" && input.status !== "paused") throw new Error("FIXTURE_FORBIDS_DELIVERY");
    const previous = [...state.metrics.committed].reverse().find(op => op.kind === "timer");
    const baseStatus = previous?.kind === "timer" ? previous.payload.status : work.status;
    if (baseStatus !== "pending" && baseStatus !== "in_progress" && baseStatus !== "paused") throw new Error("INVALID_FIXTURE_BASE");
    return enqueue({ ...base(), kind: "timer", dependencyId: previous?.id, payload: { status: input.status, baseStatus } });
  };
  const onSave = async (stepId: string, answer: StepAnswer): Promise<void> => enqueue({ ...base(), kind: "answer", stepId, answer, base: { responseValue: "", isCompleted: false, executionStatus: null, comment: "" } });
  const upload = async (files: LocalPhoto[], stepId?: string): Promise<void> => {
    if (files.length !== 1) throw new Error("FIXTURE_REQUIRES_SINGLE_FILE_CALLBACK");
    const file = files[0];
    const operation = base();
    if (!file.uri.startsWith(`blob:${location.origin}/`)) throw new Error("FIXTURE_FILE_NOT_LOCAL_BLOB");
    const bytes = await (await fetch(file.uri)).blob();
    const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    return enqueue({ ...operation, kind: "document", stepId, sourceDraftId: file.id, file: { id: operation.id, namespace: identity, name: file.name, mimeType: file.mimeType, size: bytes.size, sha256 } }, file, bytes);
  };
  const loadFiles = async (): Promise<Attachment[]> => { state.metrics.fileLoads++; return options.holdReads ? never<Attachment[]>() : []; };
  const loadComments = async (): Promise<CommentPage> => { state.metrics.commentLoads++; return options.holdReads ? never<CommentPage>() : { data: [], totalRows: 0, totalPages: 0 }; };
  const refresh = async (): Promise<void> => { state.metrics.refreshes++; return never<void>(); };
  const comments = offline.operations.filter((op): op is PendingComment => op.kind === "comment");
  const files = offline.operations.filter((op): op is PendingDocument => op.kind === "document");
  const addComment = async (text: string): Promise<void> => enqueue({ ...base(), kind: "comment", text });
  const readLocalFile = async (id: string): Promise<LocalPhoto> => { const file = state.localFiles.get(id); if (!file) throw new Error("FIXTURE_FILE_NOT_OWNED"); return file; };
  const group = groupFor(work);
  let content: ReactNode;
  if (screen === "card" || screen === "card-explicit") {
    content = <ScrollView contentContainerStyle={{ padding: 12 }}><AssignmentWorkCard group={group} work={work} generatedAt={`${date}T12:00:00Z`} offline={screen === "card-explicit" ? undefined : ready ? offline : null} pendingTimer={screen === "card-explicit" ? pendingTimerForWork(offline, scope, work) : undefined} onOpenWork={() => { state.metrics.opened++; }} onWorkStatus={async (_group, _work, input) => onStatus(input)} /></ScrollView>;
  } else if (screen === "comments") {
    content = <ScrollView contentContainerStyle={{ padding: 12 }}><CommentsTab scopeKey={identity} mode="live" busy={false} pending={comments} offlineReady={ready} appliedRevision={`${revision}:${comments.filter(op => op.status === "applied").map(op => op.id).join("|")}`} onLoad={loadComments} onSubmit={addComment} /></ScrollView>;
  } else if (screen === "files") {
    content = <FileWorkspace compact scopeKey={identity} mode="live" readOnly={false} offline={ready ? offline : null} pending={files} onLoad={loadFiles} onUpload={upload} readLocalFile={readLocalFile} onDelete={async () => { throw new Error("FIXTURE_FORBIDS_DELETE"); }} />;
  } else {
    const initialTab: WorkDetailTab = screen === "answers" || screen === "association" ? "checklist" : "work";
    content = <WorkDetailScreen tenant={{ id: "isolated", name: "Empresa ficticia", portalOrigin: "https://example.invalid", environment: "development" }} branchName="Sucursal ficticia" group={group} work={work} generatedAt={`${date}T12:00:00Z`} mode="live" range={scope} busy={false} error={null} storageKey={identity} companyBranchId={1} initialTab={initialTab} allowEditExecutionTime={false} offline={ready ? offline : null}
      onBack={() => { state.metrics.opened++; }} onRefresh={refresh} onStatus={onStatus} onSaveStep={onSave} onReport={async () => { throw new Error("FIXTURE_FORBIDS_REPORT"); }} onUpload={upload}
      onLoadChecklistOptions={async () => ({ items: [{ id: 20, name: "Inspección adicional", code: "EXTRA", description: null, alreadyAssigned: false }], page: 0, pageSize: 20, hasMore: false })}
      onAttachChecklist={async checklistId => enqueue({ ...base(), kind: "checklist", payload: { checklistId } })}
      onLoadFiles={loadFiles} onLoadStepFiles={loadFiles} onUploadDocuments={upload} onDeleteFile={async () => { throw new Error("FIXTURE_FORBIDS_DELETE"); }} onLoadComments={loadComments} onAddComment={addComment} readLocalFile={readLocalFile} />;
  }
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><View style={{ flex: 1 }} testID="durable-fixture">{content}</View></SafeAreaProvider>;
}
api.render("card");