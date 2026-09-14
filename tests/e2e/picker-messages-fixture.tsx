import { useState } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ImagePickerResult } from "expo-image-picker";
import type { AssignmentGroup, Attachment, ChecklistStep, LocalPhoto, WorkDetailTab } from "../../src/domain/models";
import type { OfflineController, OfflineOperation, OfflineSnapshot, TimerReadAssignmentWork } from "../../src/domain/offline";
import { workChecklistProgress } from "../../src/domain/assignmentChecklistProgress";
import { DeviceSecurityProvider } from "../../src/security/DeviceSecurityProvider";
import { useDeviceSecurity } from "../../src/security/DeviceSecurityContext";
import { useTrustedNativePicker } from "../../src/security/useTrustedNativePicker";
import type { DeviceAuthenticationResult, DeviceSecurityAdapter, DeviceLockSnapshot } from "../../src/security/contracts";
import { WorkDetailScreen } from "../../src/screens/WorkDetailScreen";
import { OfflineCenterScreen } from "../../src/screens/offline/OfflineCenterScreen";
import { OfflineStatusBar } from "../../src/screens/offline/OfflineStatusBar";
import { syncUserError, userActionError } from "../../src/screens/offline/syncUserPresentation";
import { pickWorkspaceFiles } from "../../src/screens/workDetail/files/filePicker";

type Scenario = "zero47" | "seven" | "percent22";
interface FixtureMetrics {
  work: TimerReadAssignmentWork;
  snapshot: OfflineSnapshot | null;
  calls: string[];
  progress: ReturnType<typeof workChecklistProgress>;
  security: DeviceLockSnapshot | null;
  unlocked: boolean;
  providerRunnerPresent: boolean;
}
interface FixtureApi {
  render(scenario: Scenario, tab?: WorkDetailTab): void;
  metrics(): FixtureMetrics;
  setTimer(status: OfflineOperation["status"]): void;
  setReadiness(value: "ready" | "auth" | "loading"): void;
  utilityCamera(): Promise<number>;
  friendly(code: string): { direct: string; wrapped: string };
}
interface OsPorts {
  adapter: DeviceSecurityAdapter;
  foreground: boolean;
  prompts: number;
  cameraStarts: number;
  cameraSettled: number;
  privacy: string[];
  events: string[];
  subscribe(listener: (active: boolean) => void): () => void;
  lifecycle(active: boolean): void;
  confirm(): void;
  launchCamera(): Promise<ImagePickerResult>;
  cameraResult(): void;
}
declare global { interface Window { pickerMessages: FixtureApi; pickerOs: OsPorts; } }

const listeners = new Set<(active: boolean) => void>();
let authResult: ((result: DeviceAuthenticationResult) => void) | null = null;
let cameraResult: ((result: ImagePickerResult) => void) | null = null;
const ports: OsPorts = {
  foreground: true, prompts: 0, cameraStarts: 0, cameraSettled: 0, privacy: [], events: [],
  adapter: {
    platformSupported: true, initialForeground: true,
    readPreference: async () => "enabled",
    writePreference: async () => { throw new Error("FIXTURE_FORBIDS_PREFERENCE_CHANGE"); },
    available: async () => true,
    authenticate: () => { ports.prompts++; ports.events.push("auth-prompt"); return new Promise(resolve => { authResult = resolve; }); },
    cancel: async () => { authResult?.({ success: false, error: "user_cancel" }); authResult = null; },
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  lifecycle(active) { ports.foreground = active; ports.events.push(active ? "active" : "background"); for (const listener of [...listeners]) listener(active); },
  confirm() { if (!authResult) throw new Error("NO_SIMULATED_AUTH_PROMPT"); const resolve = authResult; authResult = null; ports.events.push("auth-success"); resolve({ success: true }); },
  launchCamera() { if (cameraResult) throw new Error("DUPLICATE_SIMULATED_CAMERA"); ports.cameraStarts++; ports.events.push("camera-start"); return new Promise(resolve => { cameraResult = resolve; }); },
  cameraResult() {
    if (!cameraResult) throw new Error("NO_SIMULATED_CAMERA");
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d"); if (!context) throw new Error("CANVAS_REQUIRED");
    context.fillStyle = "#007d78"; context.fillRect(0, 0, 64, 64); context.fillStyle = "white"; context.fillRect(16, 16, 32, 32);
    const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), character => character.charCodeAt(0));
    const file = new File([bytes], "camara-simulada.png", { type: "image/png" });
    const resolve = cameraResult; cameraResult = null; ports.cameraSettled++; ports.events.push("camera-result");
    resolve({ canceled: false, assets: [{ uri: URL.createObjectURL(file), width: 64, height: 64, type: "image", fileName: file.name, mimeType: file.type, fileSize: file.size, file }] });
  },
};
window.pickerOs = ports;
const date = "2026-09-14";
const scope = { groupId: "direct-11", workId: "11", companyBranchId: 1, startDate: date, endDate: date };
const deployment = "MOBILE_SYNC_ACTIONS_UNAVAILABLE";
const timer: OfflineOperation = { id: "11111111-1111-4111-8111-111111111111", kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" }, createdAt: 1789387200000, status: "pending", attempts: 2, nextAttemptAt: 1789387500000, lastError: deployment };
function makeSnapshot(): OfflineSnapshot {
  return { online: false, authBlocked: false, preparing: false, syncing: false, pending: 1, conflicts: 0, lastSyncedAt: null, lastError: deployment, coverage: [], operations: [{ ...timer, nextAttemptAt: Date.now() + 300000 }], connection: { status: "service_error", networkConnected: true, foreground: true, checkedAt: 1789387200000, errorCode: deployment } };
}
function makeWork(scenario: Scenario): TimerReadAssignmentWork {
  const confirmed = scenario === "zero47" ? 0 : scenario === "seven" ? 7 : 10;
  const steps: ChecklistStep[] = Array.from({ length: 47 }, (_, index) => {
    const complete = index < confirmed + 1 && index !== 6 && confirmed > 0;
    return { stepId: 1001 + index, order: index + 1, title: index === 6 ? "¿El equipo está limpio?" : `Pregunta ${index + 1}`, description: "", tag: "", type: index === 46 ? "text" : "validation", options: [], isRequired: index !== 46, isFilesRequired: index === 6, isCompleted: complete ? true : null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "", executionStatus: complete ? "completed" : null, attachments: [] };
  });
  return { id: "11", workType: "productive", title: "Inspección previa al despacho del equipo", summary: "Inspección con datos ficticios", specialty: "Mecánica", status: "pending", priority: "high", scheduledDate: date, scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedDates: [date], plannedMinutes: 60, executedMinutes: 20, elapsedSeconds: 1200, commentsCount: 0, filesCount: 0, isFilesRequired: false, checklistDone: confirmed, checklistTotal: 46, isOverdue: false, canExecute: true, canEditDefinition: true, missingRequiredInfo: [], materials: [], responsibles: [], checklists: [{ checklistId: 10, name: "Checklist de despacho", code: "EQUIPMENT_DISPATCH_CHECKLIST_1", required: false, steps }] };
}
const root = createRoot(document.getElementById("root")!);
const api: FixtureApi = {
  render(scenario, tab = "checklist") { root.render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><DeviceSecurityProvider><Fixture key={crypto.randomUUID()} scenario={scenario} tab={tab} /></DeviceSecurityProvider></SafeAreaProvider>); },
  metrics() { throw new Error("FIXTURE_NOT_UNLOCKED"); }, setTimer() {}, setReadiness() {}, utilityCamera: async () => 0,
  friendly(code) { return { direct: syncUserError(code), wrapped: userActionError(new Error(`No se pudo abrir la cámara. ${code}`)) }; },
};
window.pickerMessages = api;

function Fixture({ scenario, tab }: { scenario: Scenario; tab: WorkDetailTab }) {
  const security = useDeviceSecurity();
  const runNativePicker = useTrustedNativePicker();
  const [work] = useState(() => makeWork(scenario));
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(makeSnapshot);
  const [center, setCenter] = useState(false);
  const [identity] = useState(() => `picker-messages-${crypto.randomUUID()}`);
  const [calls] = useState<string[]>([]);
  api.metrics = () => ({ work, snapshot, calls, progress: workChecklistProgress(work), security: security.controller.getSnapshot(), unlocked: security.isUnlocked(), providerRunnerPresent: typeof security.runTrustedNativePicker === "function" && runNativePicker === security.runTrustedNativePicker });
  api.utilityCamera = async () => (await pickWorkspaceFiles("camera", 1, runNativePicker)).length;
  api.setTimer = status => setSnapshot(current => current && ({ ...current, conflicts: status === "conflict" ? 1 : 0, operations: current.operations.map(operation => ({ ...operation, status, ...(status === "applied" ? { receipt: { operationId: operation.id, state: "applied" as const } } : {}) })) }));
  api.setReadiness = value => setSnapshot(value === "loading" ? null : { ...makeSnapshot(), authBlocked: value === "auth" });
  const fail = async (name: string): Promise<never> => { calls.push(name); throw new Error("FIXTURE_FORBIDS_MUTATIONS"); };
  const files = async (): Promise<Attachment[]> => [];
  const controller: OfflineController = { getSnapshot: () => snapshot ?? makeSnapshot(), subscribe: () => () => {}, start() {}, stop() {}, setForeground() {}, syncNow: () => fail("sync"), retry: () => fail("retry"), hasPendingChanges: async () => true, prepareWeek: () => fail("prepare"), readLocalFile: async (): Promise<LocalPhoto> => fail("file-read") };
  const group: AssignmentGroup = { id: scope.groupId, type: "direct_assignment", code: "TR-11", title: "Asignación ficticia", status: work.status, customerName: "Cliente ficticio", locationName: "Taller", locationAddress: null, scheduledDate: date, scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60, isOverdue: false, isResponsible: true, canManage: true, equipment: null, products: [], works: [work] };
  return <View style={{ flex: 1, minHeight: 0 }} testID="picker-messages-fixture">
    <View style={[{ flex: 1, minHeight: 0 }, center && { display: "none" }]}>
      <WorkDetailScreen tenant={{ id: "isolated", name: "Empresa ficticia", portalOrigin: "https://example.invalid", environment: "development" }} branchName="Sucursal ficticia" group={group} work={work} generatedAt={`${date}T12:00:00Z`} mode="live" range={scope} busy={false} error="No se pudo verificar la conexión con Qualitzer. Los pendientes siguen guardados en el dispositivo." storageKey={identity} companyBranchId={1} initialTab={tab} allowEditExecutionTime={false} offline={snapshot}
        connectionStatus={<OfflineStatusBar snapshot={snapshot} embedded onOpen={() => setCenter(true)} onSync={controller.syncNow} />}
        onBack={() => { calls.push("back"); }} onRefresh={() => fail("refresh")} onStatus={() => fail("status")} onSaveStep={() => fail("answer")} onReport={() => fail("report")} onUpload={() => fail("upload")}
        onLoadChecklistOptions={async () => ({ items: [], page: 0, pageSize: 20, hasMore: false })} onAttachChecklist={() => fail("checklist")}
        onLoadFiles={files} onLoadStepFiles={files} onUploadDocuments={() => fail("document")} onDeleteFile={() => fail("delete")} onLoadComments={async () => ({ data: [], totalRows: 0, totalPages: 0 })} onAddComment={() => fail("comment")} />
    </View>
    {center ? <OfflineCenterScreen controller={controller} snapshot={snapshot} range={scope} branchId={1} branchName="Sucursal ficticia" onBack={() => setCenter(false)} /> : null}
  </View>;
}
api.render("percent22");