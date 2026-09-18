/// <reference types="node" />
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../picker-messages-fixture";
import type { Activity, AssignmentWork, Attachment, LocalPhoto, Session, StatusInput } from "../../../src/domain/models";
import type { OfflineAttachment, OfflineCommand, OfflineController, OfflineOperation } from "../../../src/domain/offline";
import type { NotificationPreferences } from "../../../src/domain/notifications";
import type { NotificationAdapter, NotificationApi } from "../../../src/notifications/contracts";
import { MobileNotificationClient } from "../../../src/notifications/MobileNotificationClient";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../../src/notifications/notificationSafety";
import { DeviceSecurityProvider } from "../../../src/security/DeviceSecurityProvider";
import { useDeviceSecurity } from "../../../src/security/DeviceSecurityContext";
import { TimeField } from "../../../src/ui/time/TimeField";
import { DayOffsetField, NumericSelectField } from "../../../src/ui/time/NumericSelectField";
import { CompletionDialog } from "../../../src/screens/workDetail/CompletionDialog";
import { FileWorkspace } from "../../../src/screens/workDetail/FileWorkspace";
import { WorkDetailScreen } from "../../../src/screens/WorkDetailScreen";
import { WorkTab } from "../../../src/screens/workDetail/WorkInformation";
import { CreationScreen } from "../../../src/screens/creation/CreationScreen";
import { creationDraftKey, openCreationDraftStore } from "../../../src/screens/creation/creationDrafts";
import { emptyCreationForm } from "../../../src/screens/creation/creationForm";
import { MaintenanceDeliveryDialog } from "../../../src/screens/orders/lifecycle/MaintenanceDeliveryDialog";
import type { DeliveryDraft } from "../../../src/screens/orders/lifecycle/lifecycleRules";
import { NotificationSettingsScreen } from "../../../src/screens/notifications/NotificationSettingsScreen";
import { OfflineCenterScreen } from "../../../src/screens/offline/OfflineCenterScreen";
import { OfflineStatusBar } from "../../../src/screens/offline/OfflineStatusBar";
import { OfflineEngine } from "../../../src/offline/engine";
import { updateState } from "../../../src/offline/state";
import { fixture, assignmentsWithStep, uuid, user } from "../../../src/offline/tests/fakes";
import { ApiError } from "../../../src/infrastructure/errors";
import { ProfileScreen } from "../../../src/screens/ProfileScreen";
import { Button } from "../../../src/ui/components";
import { userSignatureInputSchema, type UserSignature, type UserSignatureAccess, type UserSignatureOptions } from "../../../src/domain/userSignatures";
import type { MaintenanceDeliveryInput } from "../../../src/domain/orderLifecycle";

type Screen = "widget" | "invalid" | "creation" | "completion" | "blocked" | "notification" | "maintenance" | "sync" | "files" | "detail" | "checklist-summary" | "signatures";
const date = "2026-09-14";
const range = { startDate: date, endDate: date };
const scope = { ...range, companyBranchId: 1, groupId: "direct-80", workId: "80" };
const session: Session = { user, tenant: user.tenant!, branchId: 1, mode: "live", token: "isolated-fixture-not-a-credential" };
const projectId = uuid(999);
const root = createRoot(document.getElementById("root")!);
const calls: { name: string; value: unknown }[] = [];
const clockCalls: { label: string; value: string }[] = [];
let dispose = () => {};
let revision = 0;
let activeEngine: OfflineEngine | null = null;
let upgraded = false;
const sent: OfflineCommand[] = [];
let manualCalls = 0;
let original: OfflineOperation[] = [];
let readState: (() => Promise<unknown>) | null = null;
let submitted: StatusInput[] = [];
let registrations: NotificationPreferences[] = [];
let readCreation: (() => Promise<unknown>) | null = null;
let metrics = (): unknown => ({});
let changeScope = () => {};
let activityRows: Activity[] = [];
let activityFiles: Attachment[] = [];
let profileSignatures: UserSignature[] = [];
let signatureDeliveries: MaintenanceDeliveryInput[] = [];
let signatureId = 1;
const bitmap: unknown = require("../../../assets/qualitzer-icon.png");
if (typeof bitmap !== "string") throw new Error("FIXTURE_BITMAP_REQUIRED");
const bitmapBytes = Uint8Array.from(atob(bitmap.split(",")[1]), character => character.charCodeAt(0));
const localPhoto: LocalPhoto = { id: "copy-43", name: "Evidencia.png", mimeType: "image/png", uri: URL.createObjectURL(new Blob([bitmapBytes], { type: "image/png" })) };
const readLocalFile = async (id: string): Promise<LocalPhoto> => {
  if (id !== localPhoto.id) throw new Error("UNEXPECTED_FILE_ID");
  return localPhoto;
};
const confirmedFile: OfflineAttachment = { id: 43, name: localPhoto.name, type: localPhoto.mimeType, url: "", responsible: { id: 7, name: "Técnico de prueba" }, offline: { confirmed: true, downloaded: true, localFileId: localPhoto.id } };
const listedFiles: Attachment[] = [confirmedFile,
  { id: 44, name: "Manual.pdf", type: "application/pdf", url: "https://files.invalid/manual.pdf", responsible: { id: 7, name: "Técnico de prueba" } },
];

function notifications() {
  let preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const api: NotificationApi = {
    notificationStatus: async () => ({ enabled: true, reasons: [], projectId, reconciliationSeconds: 120, deliveryGuaranteed: false,
      device: { installationId: uuid(998), active: true, disabledReason: null, preferences } }),
    notificationRegister: async (_session, input) => { registrations.push({ ...input.preferences }); preferences = { ...input.preferences }; return { installationId: uuid(998), active: true, preferences, baselineCapturedAt: null }; },
    notificationUnregister: async () => { throw new Error("UNEXPECTED_UNREGISTER"); },
    notificationInbox: async () => ({ items: [], page: 1, pageSize: 25, total: 0, unreadCount: 0, canDelete: true }),
    notificationRead: async () => { throw new Error("UNEXPECTED_READ"); },
    notificationDelete: async () => { throw new Error("UNEXPECTED_DELETE"); },
    notificationTest: async () => { throw new Error("UNEXPECTED_PUSH"); },
  };
  const adapter: NotificationAdapter = { platform: "android", projectId, unsupportedReason: null,
    getPermission: async () => "granted", requestPermission: async () => "granted", prepareChannel: async () => {},
    getExpoToken: async () => "ExpoPushToken[isolated_fixture]", getInstallationId: async () => uuid(998),
    readConsent: async () => true, writeConsent: async () => {}, subscribe: () => () => {}, lastResponse: async () => null,
    clearResponse: async () => {}, presented: async () => [], dismiss: async () => {}, setBadge: async () => true,
    openSettings: async () => { throw new Error("UNEXPECTED_SETTINGS"); } };
  return new MobileNotificationClient({ session, storageKey: `time-sync-${revision}`, api, adapter,
    isCurrent: () => true, onOpen: async () => false, isInteractionAllowed: () => window.pickerOs.foreground });
}

function NotificationFixture({ client }: { client: MobileNotificationClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return <NotificationSettingsScreen notifications={{ client, state, storageKey: `time-sync-${revision}`, revokeForSession: async () => {} }} onBack={() => calls.push({ name: "back", value: null })} />;
}

function SyncFixture({ engine }: { engine: OfflineEngine }) {
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const [center, setCenter] = useState(false);
  const controller: OfflineController = { getSnapshot: engine.getSnapshot, subscribe: engine.subscribe, start: () => engine.start(), stop: () => engine.stop(),
    setForeground: value => engine.setForeground(value), syncNow: () => engine.syncNow(), requestSync: () => { manualCalls++; return engine.requestSync(); },
    retry: id => engine.retry(id), hasPendingChanges: () => engine.hasPendingChanges(),
    prepareWeek: async () => { throw new Error("UNEXPECTED_PREPARE"); }, readLocalFile: async () => { throw new Error("UNEXPECTED_FILE_READ"); } };
  return <View style={{ flex: 1, minHeight: 0 }}>
    <OfflineStatusBar snapshot={snapshot} onOpen={() => setCenter(true)} onSync={() => { manualCalls++; return engine.requestSync(); }} />
    {center ? <OfflineCenterScreen controller={controller} snapshot={snapshot} range={range} branchId={1} onBack={() => setCenter(false)} /> : null}
  </View>;
}

function Fixture({ screen, client }: { screen: Screen; client: MobileNotificationClient | null }) {
  const security = useDeviceSecurity();
  const [value, setValue] = useState(screen === "invalid" ? "invalid-original" : "08:49");
  const [hours, setHours] = useState("24");
  const [minutes, setMinutes] = useState("49");
  const [offset, setOffset] = useState("1");
  const [scopeKey, setScope] = useState("initial");
  const [workStatus, setWorkStatus] = useState<AssignmentWork["status"]>("paused");
  const [draft, setDraft] = useState<DeliveryDraft>({ note: "Conservar observaciones", hours: "24", minutes: "49", faultType: null, receivedByName: "", technicianStrokes: [], clientStrokes: [] });
  const [signatureDelivery, setSignatureDelivery] = useState(false);
  changeScope = () => setScope(current => current + "-changed");
  metrics = () => ({ unlocked: security.isUnlocked(), security: security.controller.getSnapshot(), value, hours, minutes, offset, scopeKey, draft, calls, submitted,
    registrations, clockCalls, profileSignatures, signatureDeliveries, snapshot: activeEngine?.getSnapshot() ?? null, sent, manualCalls, original });
  const work: AssignmentWork = { ...assignmentsWithStep().groups[0].works[0], scheduledDate: date, plannedDates: [date], status: "paused", canExecute: true,
    firstInProgressTime: "08:00", elapsedSeconds: 1489 * 60, executedMinutes: 1489, missingRequiredInfo: [], checklists: [] };
  const record = (name: string, next: string, setter: (value: string) => void) => { calls.push({ name, value: next }); setter(next); };
  if (screen === "signatures") {
    const catalog = (selected?: number): UserSignatureOptions => ({ userId: user.id, companyBranchId: 1, options: structuredClone(profileSignatures), defaultSignatureId: profileSignatures.find(signature => signature.isDefaultForBranch)?.id ?? null, selectedSignatureId: selected ?? profileSignatures.find(signature => signature.isDefaultForBranch)?.id ?? null });
    const access: UserSignatureAccess = { scopeKey: `signatures-${revision}-${scopeKey}`, userId: user.id, branchId: 1, name: "Tecnico de prueba", email: "tecnico@example.invalid", available: true, branches: [{ id: 1, name: "Taller" }, { id: 2, name: "Faena" }], actions: {
      load: async () => catalog(),
      save: async value => {
        const input = userSignatureInputSchema.parse(value);
        if (profileSignatures.some(signature => signature.id !== input.id && signature.branches.some(branch => input.branchIds.includes(Number(branch.value))))) throw new Error("Sucursal con otra firma");
        const previous = profileSignatures.find(signature => signature.id === input.id);
        const id = input.id ?? signatureId++;
        profileSignatures = [...profileSignatures.filter(signature => signature.id !== id), { id, value: String(id), label: input.signatureName, signatureName: input.signatureName, signatureEmail: input.signatureEmail, signaturePhone: input.signaturePhone, signatureImage: input.signatureImage === undefined ? previous?.signatureImage ?? null : input.signatureImage, isDefaultForBranch: input.branchIds.includes(1), branches: input.branchIds.map(branchId => ({ value: String(branchId), label: branchId === 1 ? "Taller" : "Faena" })) }];
        calls.push({ name: "signature-save", value: { id, branchIds: input.branchIds } });
        return catalog(id);
      },
      remove: async id => { profileSignatures = profileSignatures.filter(signature => signature.id !== id); calls.push({ name: "signature-delete", value: id }); return catalog(); },
    } };
    return <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0 }}><ProfileScreen session={session} signatureAccess={access} gatewayUrl="https://example.invalid/mobile" busy={false} error={null} health={null} onBranch={() => {}} onLogout={() => {}} onCheck={() => {}} companyBranding={{ available: false, busy: false, canPin: false, message: "", logoMessage: "", onPin() {} }} /></View>
      <Button title="Preparar OT de prueba" onPress={() => setSignatureDelivery(true)} />
      {signatureDelivery ? <MaintenanceDeliveryDialog orderLabel="OT-COR-0001" technicianName="Tecnico de prueba" mode="demo" signatureAccess={access}
        context={{ groupId: "maintenance-1", status: "paused", maintenanceType: "preventivo", finalizationNote: null, damageType: null, durationMinutes: 30, startedAt: null, finalizedAt: null, incompleteChecklists: [] }}
        draft={draft} busy={false} unavailable={false} reasons={[]} error={null} onChange={setDraft} onClose={() => setSignatureDelivery(false)} onReload={() => {}} onSubmit={async input => { signatureDeliveries.push(input); setSignatureDelivery(false); }} /> : null}
    </View>;
  }
  if (screen === "checklist-summary") {
    const base = assignmentsWithStep().groups[0].works[0].checklists[0];
    const steps = Array.from({ length: 47 }, (_, index) => ({ ...base.steps[0], stepId: String(index + 1), type: index === 0 ? "text" as const : "approval" as const, isRequired: true, isFilesRequired: false, attachments: [], selectValue: index === 1 || index === 2 ? "approved" : "", responseValue: "" }));
    const checklists = [
      { ...base, checklistId: 81, name: "Check List de equipos", required: true, steps },
      { ...base, checklistId: 82, name: "Revisión de seguridad y condiciones del equipo de transporte", required: false, steps: [steps[1]] },
      { ...base, checklistId: 83, name: "Inspección pendiente de definir", required: false, steps: [] },
    ];
    return <ScrollView contentContainerStyle={{ padding: 16, width: "100%", maxWidth: 900, alignSelf: "center" }}><WorkTab group={{ ...assignmentsWithStep().groups[0], products: [] }} work={{ ...work, materials: [], responsibles: [], checklists }} report="" savedReport={null} disabled={false} readOnly={false} submitting={false} mode="demo" activitiesPanel={<View />} onReportChange={() => {}} onReportSubmit={() => {}} onChecklist={id => calls.push({ name: "checklist", value: id })} /></ScrollView>;
  }
  if (screen === "detail") return <WorkDetailScreen tenant={session.tenant} branchName="Taller" group={{ ...assignmentsWithStep().groups[0], id: "external-80", type: "external_ot", code: "OT-COR-0053" }} work={{ ...work, status: workStatus, title: "Reparación de puerta", activities: activityRows, checklists: assignmentsWithStep().groups[0].works[0].checklists.map(checklist => ({ ...checklist, required: false, steps: checklist.steps.map(step => ({ ...step, isFilesRequired: false })) })) }} generatedAt={`${date}T12:00:00Z`} mode="live" range={range} busy={false} error={null} storageKey={`activity-${revision}`} allowEditExecutionTime onBack={() => calls.push({ name: "back", value: null })} onRefresh={async () => {}} onStatus={async input => { submitted.push(input); setWorkStatus(input.status); }} onReopen={async () => { calls.push({ name: "reopen", value: null }); setWorkStatus("pending"); }} onSaveStep={async () => {}} onLoadChecklistOptions={async () => ({ items: [], page: 0, pageSize: 20, hasMore: false })} onAttachChecklist={async id => ({ checklistId: id, alreadyAssigned: false })} onLoadFiles={async () => []} onLoadStepFiles={async () => []} onUpload={async () => {}} onReport={async () => {}} onUploadDocuments={async () => {}} onDeleteFile={async () => {}} onLoadComments={async () => ({ data: [], totalRows: 0, totalPages: 0 })} onAddComment={async () => {}} activityActions={{
    load: async () => structuredClone(activityRows),
    create: async input => { const id = 72; activityRows.push({ ...input, id, isStarted: false, isCompleted: false, technicalDocuments: [] }); calls.push({ name: "activity", value: input }); return { id }; },
    update: async (id, input) => { Object.assign(activityRows.find(item => item.id === id)!, input); calls.push({ name: "edit-activity", value: { id, ...input } }); },
    complete: async (id, isCompleted = true) => { const activity = activityRows.find(item => item.id === id)!; activity.isCompleted = isCompleted; calls.push({ name: "complete", value: { id, isCompleted } }); },
    remove: async id => { activityRows = activityRows.filter(activity => activity.id !== id); calls.push({ name: "delete-activity", value: id }); },
    files: async () => activityFiles,
    upload: async (id, files) => { calls.push({ name: "upload", value: { id, count: files.length } }); activityFiles = [...activityFiles, ...files.map((file, index) => ({ id: index + 400 + activityFiles.length, name: file.name, type: file.mimeType, url: "https://files.invalid/evidence.txt" }))]; }
  }} />;
  if (screen === "completion" || screen === "blocked") return <CompletionDialog maintenance={false} work={work} allowEditExecutionTime generatedAt={`${date}T12:00:00Z`} initialDate={date} range={range} reasons={screen === "blocked" ? ["Completa el checklist obligatorio."] : []} canSubmit={screen !== "blocked"} busy={false} error={null} mode="live" onClose={() => {}} onSubmit={input => { submitted.push(input); }} />;
  if (screen === "files") return <FileWorkspace compact scopeKey={`files-${revision}`} resourceKey="fixture-files" mode="live" readOnly={false} readLocalFile={readLocalFile} onLoad={async () => listedFiles} onUpload={async () => { throw new Error("UNEXPECTED_UPLOAD"); }} onDelete={async () => { throw new Error("UNEXPECTED_DELETE"); }} />;
  if (screen === "maintenance") return <MaintenanceDeliveryDialog orderLabel="OT de prueba" technicianName="Técnico ficticio" mode="live" context={{ groupId: scopeKey, status: "paused", maintenanceType: "preventivo", finalizationNote: null, damageType: null, durationMinutes: 1489, startedAt: null, finalizedAt: null, incompleteChecklists: [] }} draft={draft} busy={false} unavailable={false} reasons={[]} error={null} onChange={next => { calls.push({ name: "maintenance", value: next }); setDraft(next); }} onClose={() => {}} onReload={() => {}} onSubmit={async () => { throw new Error("UNEXPECTED_DELIVERY"); }} />;
  if (screen === "notification" && client) return <NotificationFixture client={client} />;
  if (screen === "sync" && activeEngine) return <SyncFixture engine={activeEngine} />;
  if (screen === "creation") return <CreationScreen kind="work" user={user} tenant={session.tenant} companyBranchId={1} initialDate={date} data={null} mode="live" storageKey={`time-sync-${revision}`} onBack={() => {}}
    onLoadOptions={async () => ({ companyBranchId: 1, userId: user.id, workerId: 7, timezone: "UTC", priorities: ["medium"], maintenanceTypes: [], nonProductiveReasons: [], schedule: { sameDayOnly: true, conflictPolicy: "warning" } })}
    onSubmit={async input => { calls.push({ name: "create", value: input }); throw new Error("NO_ACTUAL_CREATION"); }} />;
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    <TimeField label="Reloj" value={value} scopeKey={scopeKey} onChange={next => record("clock", next, setValue)} />
    <NumericSelectField label="Horas" max={99} value={hours} scopeKey={scopeKey} onChange={next => record("hours", next, setHours)} />
    <NumericSelectField label="Minutos" max={59} value={minutes} scopeKey={scopeKey} onChange={next => record("minutes", next, setMinutes)} />
    <DayOffsetField label="Día de término" value={offset} scopeKey={scopeKey} onChange={next => record("offset", next, setOffset)} />
  </ScrollView>;
}

async function render(screen: Screen) {
  dispose(); activeEngine = null; calls.length = 0; clockCalls.length = 0; sent.length = 0; submitted = []; registrations = []; manualCalls = 0; upgraded = false; revision++;
  profileSignatures = []; signatureDeliveries = []; signatureId = 1;
  activityRows = [{ id: 71, activity: "Revisar cierre", executionTime: 30, isStarted: false, isCompleted: false, technicalDocuments: [{ id: 1, documentName: "Manual del supervisor", notes: null, file: { id: 2, name: "manual.pdf", url: "https://files.invalid/manual.pdf", type: "application/pdf" } }] }]; activityFiles = [];
  activityRows.push({ id: 73, activity: "Ruedas y torque pernos", isChecklist: true, executionTime: 0, isStarted: false, isCompleted: true, technicalDocuments: [] });
  let client: MobileNotificationClient | null = null;
  if (screen === "creation") {
    const key = creationDraftKey(`time-sync-${revision}`, session.tenant.id, user.id, 1, "work", "live");
    const store = openCreationDraftStore(key, "work", 1);
    await store.write({ version: 1, kind: "work", phase: "editing", form: { ...emptyCreationForm(date), title: "Trabajo ficticio", summary: "Sin envío real", startTime: "08:00", endTime: "09:00", priority: "medium" } });
    readCreation = () => store.read();
  }
  if (screen === "notification") { client = notifications(); dispose = client.start(); }
  if (screen === "sync") {
    const storage = fixture(); storage.dependencies.now = () => Date.now();
    const base = (id: number) => ({ id: uuid(id), createdAt: Date.now() - 1000, attempts: 0, nextAttemptAt: 0, status: "pending" as const });
    const file = await storage.files.own("a", { id: uuid(700), uri: "fixture:document", name: "prueba.pdf", mimeType: "application/pdf", size: 10 });
    original = [
      { ...base(801), kind: "timer", scope, payload: { status: "in_progress", baseStatus: "pending" } },
      { ...base(802), kind: "timer", scope, dependencyId: uuid(801), payload: { status: "paused", baseStatus: "in_progress" } },
      { ...base(803), kind: "comment", scope, text: "Comentario independiente" },
      { ...base(804), kind: "document", scope, file },
    ];
    await updateState(storage.store, "a", state => { state.operations = structuredClone(original); });
    const send = storage.upstream.offlineCommand.bind(storage.upstream);
    storage.upstream.offlineCommand = async command => { sent.push(structuredClone(command)); if (!upgraded && command.kind === "timer") throw new ApiError(503, "MOBILE_SYNC_ACTIONS_UNAVAILABLE", "Fixture unsupported"); return send(command); };
    activeEngine = new OfflineEngine(storage.dependencies); await activeEngine.refresh();
    const engine = activeEngine; dispose = () => engine.stop(); readState = () => storage.store.read("a");
  }
  root.render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}><DeviceSecurityProvider><Fixture key={revision} screen={screen} client={client} /></DeviceSecurityProvider></SafeAreaProvider>);
}
const api = { render, metrics: () => metrics(), scope: () => changeScope(), creation: () => readCreation?.(), state: () => readState?.(),
  restore: () => { upgraded = true; }, start: () => activeEngine?.start(), stop: () => dispose(), clockCommit: (label: string, value: string) => { clockCalls.push({ label, value }); } };
declare global { interface Window { timeSync: typeof api; } }
window.timeSync = api;
void render("widget");