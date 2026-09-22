/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import type { AssignmentWork, Attachment, StatusInput, StepAnswer, WorkOpenOptions } from "../src/domain/models";
import { completionStatusLabel } from "../src/screens/offline/offlineUi";
import { syncCompletionInputSchema } from "../src/domain/offlineProtocol";
import { answerFromStep } from "../src/domain/format";
import { manualDurationCompletion } from "../src/screens/workDetail/completionTiming";
import { OfflineQueuedError, type OfflineOperation, type TimerReadAssignmentWork } from "../src/domain/offline";
import type { WorkDetailScreenProps } from "../src/screens/WorkDetailScreen";
import type { CompletionDialogProps } from "../src/screens/workDetail/CompletionDialog";
import type { AssignmentWorkCardProps } from "../src/screens/orders/AssignmentWorkCard";
import type { OrderDetailScreenProps } from "../src/screens/OrderDetailScreen";
import { group, step, work } from "../server/tests/fixtures";
import { action, deferred, durableReactFixture, elements, memoryDraftStorage, renderWrapped, settle, uiModule, uiOperation, uiScope, uiSnapshot, type Wrapped } from "./helpers/durable-ui";

const input: StatusInput = { status: "delivered", executionDates: [uiScope.startDate], isManual: false };
const tenant = { id: "delivery-ui", name: "UI", portalOrigin: "https://ui.example.com", environment: "development" as const };
const unused = async (): Promise<never> => { throw new Error("UNEXPECTED_ACTION"); };
const pending = (count: number): Extract<OfflineOperation, { kind: "comment" }>[] => Array.from({ length: count }, (_, index) => ({ ...uiOperation, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, kind: "comment", text: "Pendiente" }));
function readyWork(): AssignmentWork {
  return work({ status: "paused", checklists: [{ checklistId: 10, name: "Control", code: "CHK-10", required: true, steps: [step({ selectValue: "approved", responseValue: "approved", isCompleted: true, executionStatus: "completed" })] }] });
}

async function detailFixture(initialAction?: "deliver", storedAnswer?: StepAnswer) {
  const hooks = durableReactFixture(); const dialogHooks = durableReactFixture(); const memory = memoryDraftStorage();
  const fileState: { files: Attachment[] | null; error: string | null } = { files: [], error: null };
  const drafts = uiModule<typeof import("../src/screens/workDetail/useWorkDraft")>("screens/workDetail/useWorkDraft.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "./localPhotos": {},
  });
  const component = uiModule<{ WorkDetailScreen: Wrapped<WorkDetailScreenProps> }>("screens/WorkDetailScreen.tsx", hooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./workDetail/ChecklistTab": { ChecklistTab: "ChecklistTab" }, "./workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" },
    "./workDetail/DeliverySuccess": { DeliverySuccess: "DeliverySuccess" },
    "./workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" }, "./workDetail/localPhotos": { openLocalPhotoScope: () => {} },
    "./workDetail/useAttachmentFiles": { useAttachmentFiles: () => ({ ...fileState, loading: false, load: async () => {} }) },
    "./workDetail/useWorkDraft": drafts, "./workDetail/WorkInformation": { WorkTab: "WorkTab", EquipmentTab: "EquipmentTab" },
    "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" }, "./workDetail/CommentsTab": { CommentsTab: "CommentsTab" },
    "./offline/QueuedNotice": { QueuedNotice: "QueuedNotice" },
    "./workDetail/checklist/ChecklistAssociationPanel": { ChecklistAssociationPanel: "ChecklistAssociationPanel" },
  });
  const dialog = uiModule<{ CompletionDialog: (props: CompletionDialogProps) => ReactNode }>("screens/workDetail/CompletionDialog.tsx", dialogHooks, {
    "./DetailUi": { ChoiceButton: "ChoiceButton", Notice: "Notice" },
  });
  const calls: StatusInput[] = []; const refresh = deferred<void>(); let refreshes = 0;
  const candidate = readyWork();
  const props: WorkDetailScreenProps = { tenant, branchName: "UI", group: group({ works: [candidate] }), work: candidate,
    generatedAt: "2026-09-01T10:00:00Z", mode: "live", range: { startDate: uiScope.startDate, endDate: uiScope.endDate }, busy: false, error: null, storageKey: "delivery-review",
    initialAction, initialTab: "work", allowEditExecutionTime: false, companyBranchId: 1, offline: { ...uiSnapshot(), online: true },
    onBack: () => {}, onRefresh: async () => { refreshes++; await refresh.promise; }, onStatus: async (value) => { calls.push(value); },
    onSaveStep: unused, onLoadChecklistOptions: async () => ({ items: [], page: 0, pageSize: 20, hasMore: false }), onAttachChecklist: unused,
    onLoadFiles: async () => [], onLoadStepFiles: async () => [], onUpload: unused, onReport: unused, onUploadDocuments: unused,
    onDeleteFile: unused, onLoadComments: async () => ({ data: [], totalRows: 0, totalPages: 0 }), onAddComment: unused };
  if (storedAnswer) {
    const stepId = String(candidate.checklists[0].steps[0].stepId);
    const key = drafts.workDetailDraftKey(props.storageKey, props.mode, props.group, candidate.id);
    memory.values.set(key, JSON.stringify({ version: 1, report: "", savedReport: null, photos: [], answers: {
      [stepId]: { answer: storedAnswer, saved: false, baseline: "before-queued-save" },
    } }));
  }
  const render = () => renderWrapped(hooks, component.WorkDetailScreen, props);
  const review = () => { const found = elements<CompletionDialogProps>(render(), "CompletionDialog")[0]; assert.ok(found); return found.props; };
  const renderReview = () => { const tree = dialogHooks.render(() => dialog.CompletionDialog(review())); dialogHooks.flush(); return tree; };
  const confirm = () => action(renderReview(), review().durable ? "Guardar entrega" : "Confirmar y entregar");
  render(); await settle(); render();
  return { props, calls, render, review, renderReview, confirm, refresh, fileState, refreshes: () => refreshes, close: () => { hooks.unmount(); dialogHooks.unmount(); } };
}

const blockers: { name: string; apply(props: WorkDetailScreenProps): void; reason: RegExp }[] = [
  { name: "canExecute false", apply: (props) => { props.work = { ...props.work, canExecute: false }; }, reason: /no habilita/ },
  { name: "stale snapshot", apply: (props) => { props.staleReadOnly = true; }, reason: /verificar los datos y permisos/ },
  { name: "local work", apply: (props) => { props.work = { ...props.work, id: "local-unconfirmed" }; }, reason: /Sincroniza la creación/ },
  { name: "local group", apply: (props) => { props.group = { ...props.group, id: "local-unconfirmed" }; }, reason: /Sincroniza la creación/ },
  { name: "read only", apply: (props) => { props.work = { ...props.work, status: "delivered" }; }, reason: /solo lectura/ },
  { name: "unknown requirements", apply: (props) => { props.work = { ...props.work, checklists: props.work.checklists.map((list) => ({ ...list, required: undefined })) }; }, reason: /verificar sus requisitos/ },
  { name: "missing information", apply: (props) => { props.work = { ...props.work, missingRequiredInfo: ["MOBILE_UNKNOWN_REQUIREMENT"] }; }, reason: /información requerida/ },
  { name: "required checklist unanswered", apply: (props) => { props.work = { ...props.work, checklists: [{ ...props.work.checklists[0], steps: [step()] }] }; }, reason: /Completa/ },
  { name: "invalid required answer", apply: (props) => { props.work = { ...props.work, checklists: [{ ...props.work.checklists[0], steps: [step({ selectValue: "not-in-options" })] }] }; }, reason: /respuestas válidas/ },
  { name: "local evidence", apply: (props) => { props.work = { ...props.work, checklists: [{ ...props.work.checklists[0], steps: [{ ...props.work.checklists[0].steps[0], isFilesRequired: true, attachments: [{ id: "local-file", name: "proof.png", url: "", type: "image/png" }] }] }] }; }, reason: /evidencia/ },
  { name: "conflict", apply: (props) => { props.offline = { ...uiSnapshot(pending(1).map((operation) => ({ ...operation, status: "conflict", lastError: "MOBILE_SYNC_OPERATION_REUSED" }))), online: true }; }, reason: /requieren atención/ },
];

test("back returns through files and checklist before leaving the work", async t => {
  const fixture = await detailFixture(); t.after(fixture.close);
  let exits = 0;
  fixture.props.onBack = () => { exits++; };
  const workTab = elements<{ onChecklist(id: number): void }>(fixture.render(), "WorkTab")[0];
  workTab.props.onChecklist(10);
  assert.doesNotMatch(JSON.stringify(fixture.render()), /work-execution-footer/);
  const checklist = elements<{ onEvidence(id?: string): void }>(fixture.render(), "ChecklistTab")[0];
  checklist.props.onEvidence("102");
  assert.equal(elements(fixture.render(), "FileWorkspace").length, 1);
  assert.doesNotMatch(JSON.stringify(fixture.render()), /work-execution-footer/);
  action(fixture.render(), "Volver conservando el borrador").onPress(); await settle();
  assert.equal(exits, 0);
  assert.equal(elements(fixture.render(), "ChecklistTab").length, 1);
  action(fixture.render(), "Ir al inicio del trabajo").onPress(); await settle();
  assert.equal(elements(fixture.render(), "WorkTab").length, 1);
  assert.match(JSON.stringify(fixture.render()), /work-execution-footer/);
  action(fixture.render(), "Volver conservando el borrador").onPress(); await settle();
  assert.equal(exits, 1);
});

test("work summary omits instructions and empty materials while keeping activities first", () => {
  const hooks = durableReactFixture();
  const module = uiModule<typeof import("../src/screens/workDetail/WorkInformation")>("screens/workDetail/WorkInformation.tsx", hooks);
  const props: Parameters<typeof module.WorkTab>[0] = { group: group({ products: [] }), work: work({ materials: [], checklists: [] }), report: "", savedReport: null, disabled: false, readOnly: false, submitting: false, mode: "demo", onReportChange() {}, onReportSubmit() {}, activitiesPanel: "ACTIVITY_PANEL" };
  const render = () => hooks.render(() => module.WorkTab(props));
  const empty = JSON.stringify(render());
  assert.doesNotMatch(empty, /Instrucciones del trabajo|No se recibieron instrucciones|work-materials-section|shared-materials-section|Sin checklists asociados/);
  assert.ok(empty.indexOf("ACTIVITY_PANEL") < empty.indexOf("Reporte técnico"));
  props.work = { ...props.work, materials: [{ id: "1", name: "Filtro", ref: null, quantity: 1, stockStatus: "reserved" }] };
  assert.match(JSON.stringify(render()), /work-materials-section/);
  hooks.unmount();
});

test("work checklist cards summarize confirmed requirements and preserve exact navigation", () => {
  const hooks = durableReactFixture();
  const module = uiModule<typeof import("../src/screens/workDetail/WorkInformation")>("screens/workDetail/WorkInformation.tsx", hooks);
  const checklist = { checklistId: 10, name: "Control del equipo", code: "CHK-10", required: true, steps: [
    step({ type: "text", responseValue: "" }),
    step({ type: "approval", selectValue: "approved", isFilesRequired: false }),
    step({ type: "validation", isCompleted: false, isFilesRequired: false }),
    step({ type: "approval", selectValue: "approved", isFilesRequired: true, attachments: [{ id: "local-pending", name: "Foto", url: "" }] }),
    step({ type: "approval", isRequired: false, selectValue: "" }),
  ] };
  const opened: number[] = [];
  const props: Parameters<typeof module.WorkTab>[0] = { group: group({ products: [] }), work: work({ checklists: [checklist] }), report: "", savedReport: null, disabled: false, readOnly: false, submitting: false, mode: "demo", onReportChange() {}, onReportSubmit() {}, onChecklist: id => opened.push(id), activitiesPanel: "ACTIVITY_PANEL" };
  const render = () => hooks.render(() => module.WorkTab(props));
  const progress = () => elements<{ accessibilityRole?: string; accessibilityValue?: { min: number; max: number; now: number; text: string } }>(render(), "View").find(({ props }) => props.accessibilityRole === "progressbar");
  try {
    assert.deepEqual({ ...progress()?.props.accessibilityValue }, { min: 0, max: 3, now: 2, text: "67% · 2 de 3 requisitos confirmados" });
    assert.match(JSON.stringify(render()), /2\/3 confirmados · 1 pendiente/);
    elements<{ accessibilityLabel?: string; onPress(): void }>(render(), "Pressable").find(({ props }) => props.accessibilityLabel === checklist.name)!.props.onPress();
    assert.deepEqual(opened, [10]);
    props.work = { ...props.work, checklists: [{ ...checklist, steps: [step({ type: "text" })] }] };
    assert.equal(progress(), undefined);
    assert.match(JSON.stringify(render()), /Sin requisitos obligatorios/);
    props.work = { ...props.work, checklists: [{ ...checklist, steps: [] }] };
    assert.match(JSON.stringify(render()), /Sin pasos/);
    assert.equal(progress(), undefined);
    props.work = { ...props.work, checklists: [{ ...checklist, steps: [step({ type: "approval", selectValue: "approved", isFilesRequired: false })] }] };
    assert.equal(progress()?.props.accessibilityValue?.now, 1);
    assert.match(JSON.stringify(render()), /1\/1 confirmados · Completado/);
    props.work = { ...props.work, checklists: [{ ...checklist, steps: [step({ type: "approval", selectValue: "" })] }] };
    assert.equal(progress()?.props.accessibilityValue?.now, 0);
  } finally { hooks.unmount(); }
});

test("work checklist cards summarize confirmed progress and preserve checklist navigation", () => {
  const hooks = durableReactFixture();
  const module = uiModule<typeof import("../src/screens/workDetail/WorkInformation")>("screens/workDetail/WorkInformation.tsx", hooks);
  const opened: number[] = [];
  const checklist = { checklistId: 53, name: "Check List de equipos", code: "CHK-53", required: true, steps: [
    step({ stepId: "1", type: "approval", isRequired: true, selectValue: "approved", isFilesRequired: false, attachments: [] }),
    step({ stepId: "2", type: "approval", isRequired: true, selectValue: "approved", isFilesRequired: true, attachments: [{ id: "local-photo", name: "Pendiente.jpg", url: "", type: "image/jpeg" }] }),
    step({ stepId: "3", type: "approval", isRequired: true, selectValue: "", isFilesRequired: false, attachments: [] }),
    step({ stepId: "4", type: "text" }),
    step({ stepId: "5", type: "approval", isRequired: false, selectValue: "" }),
  ] };
  const props: Parameters<typeof module.WorkTab>[0] = { group: group({ products: [] }), work: work({ checklists: [checklist] }), report: "", savedReport: null, disabled: false, readOnly: false, submitting: false, mode: "demo", onReportChange() {}, onReportSubmit() {}, onChecklist: id => opened.push(id), activitiesPanel: "ACTIVITY_PANEL" };
  const render = () => hooks.render(() => module.WorkTab(props));
  const progress = () => elements<{ accessibilityRole?: string; accessibilityValue?: { min: number; max: number; now: number; text: string } }>(render(), "View").find(({ props }) => props.accessibilityRole === "progressbar")?.props.accessibilityValue;
  try {
    assert.equal(progress()?.min, 0);
    assert.equal(progress()?.max, 3);
    assert.equal(progress()?.now, 1);
    assert.equal(progress()?.text, "33% · 1 de 3 requisitos confirmados");
    const link = elements<{ accessibilityLabel: string; accessibilityHint: string; onPress(): void }>(render(), "Pressable").find(({ props }) => props.accessibilityLabel === checklist.name);
    assert.ok(link);
    assert.match(link.props.accessibilityHint, /1\/3 confirmados · 2 pendientes/);
    link.props.onPress(); assert.deepEqual(opened, [53]);
    assert.match(JSON.stringify(render()), /Obligatorio/);

    props.work = { ...props.work, checklists: [{ ...checklist, steps: checklist.steps.map(current => ({ ...current, selectValue: "approved", attachments: [{ id: 8, name: "Confirmada.jpg", url: "https://files.invalid/photo.jpg" }] })) }] };
    assert.equal(progress()?.max, 3);
    assert.equal(progress()?.now, 3);
    assert.equal(progress()?.text, "100% · 3 de 3 requisitos confirmados");
    assert.match(JSON.stringify(render()), /Completado/);

    props.work = { ...props.work, checklists: [{ ...checklist, steps: [step({ type: "approval", isRequired: true, selectValue: "", isFilesRequired: false })] }] };
    assert.equal(progress()?.now, 0);
    assert.match(progress()?.text ?? "", /0%/);

    props.work = { ...props.work, checklists: [{ ...checklist, steps: [step({ type: "text" })] }] };
    assert.equal(progress(), undefined);
    assert.match(JSON.stringify(render()), /Sin requisitos obligatorios/);
    props.work = { ...props.work, checklists: [{ ...checklist, steps: [] }] };
    assert.equal(progress(), undefined);
    assert.match(JSON.stringify(render()), /Sin pasos/);
    assert.doesNotMatch(JSON.stringify(render()), /NaN|Infinity/);
  } finally { hooks.unmount(); }
});

test("explicit list exit bypasses section history, but not a busy child", async t => {
  const fixture = await detailFixture(); t.after(fixture.close);
  let exits = 0;
  fixture.props.onHome = () => { exits++; };
  const tabs = elements<{ accessibilityLabel: string; onPress(): void }>(fixture.render(), "Pressable");
  tabs.find(({ props }) => props.accessibilityLabel === "Archivos")!.props.onPress();
  const panel = elements<{ backHandler: { current: ((home?: boolean) => boolean) | null } }>(fixture.render(), "FileWorkspace")[0];
  panel.props.backHandler.current = () => true;
  action(fixture.render(), "Más secciones del trabajo").onPress();
  assert.equal(exits, 0);
  assert.ok(action(fixture.render(), "Comentarios"));
  assert.ok(action(fixture.render(), "Equipo"));
  action(fixture.render(), "Volver a mis asignaciones").onPress(); await settle();
  assert.equal(exits, 0);
  panel.props.backHandler.current = () => false;
  action(fixture.render(), "Más secciones del trabajo").onPress();
  action(fixture.render(), "Volver a mis asignaciones").onPress(); await settle();
  assert.equal(exits, 1);
});

test("synchronized answer left as a local draft does not block delivery when it matches the confirmed answer", async (t) => {
  const confirmed = answerFromStep(readyWork().checklists[0].steps[0]);
  const f = await detailFixture("deliver", confirmed); t.after(f.close);
  assert.equal(f.review().canSubmit, true);
  assert.doesNotMatch(f.review().reasons.join(" "), /borrador/);
  f.confirm().onPress(); await settle();
  assert.equal(f.calls.length, 1);
});

test("a newer local answer still blocks delivery even when the queue is empty", async (t) => {
  const confirmed = answerFromStep(readyWork().checklists[0].steps[0]);
  const f = await detailFixture("deliver", { ...confirmed, comment: "Cambio sin guardar" }); t.after(f.close);
  assert.equal(f.review().canSubmit, false);
  assert.match(f.review().reasons.join(" "), /borrador/);
  f.review().onSubmit(input); await settle();
  assert.equal(f.calls.length, 0);
});

for (const scenario of blockers) test(`delivery review opens for ${scenario.name}, but real and forced confirmation cannot submit`, async (t) => {
  const f = await detailFixture(); t.after(f.close); scenario.apply(f.props);
  f.render(); await settle();
  const before = JSON.stringify(f.props.work);
  const button = action(f.render(), f.props.work.status === "delivered" ? "Revisar entrega" : "Entregar trabajo"); assert.equal(button.disabled, false); button.onPress();
  assert.equal(f.calls.length, 0); assert.equal(f.refreshes(), 0);
  assert.equal(f.review().canSubmit, false); assert.match(f.review().reasons.join(" "), scenario.reason);
  assert.doesNotMatch(f.review().reasons.join(" "), /MOBILE_|[0-9a-f]{8}-[0-9a-f]{4}-/);
  const confirm = f.confirm(); assert.equal(confirm.disabled, true);
  confirm.onPress(); f.review().onSubmit(input); await settle();
  assert.equal(f.calls.length, 0); assert.equal(JSON.stringify(f.props.work), before);
});

test("review count is scoped to work and shared files rather than five changes elsewhere in the app", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  const comments = pending(5);
  const operations: OfflineOperation[] = [comments[0], comments[1],
    { ...uiOperation, id: comments[2].id, kind: "document", scope: { ...uiScope, workId: undefined }, file: { id: "shared-proof", namespace: "delivery-ui", name: "proof.png", mimeType: "image/png", size: 10, sha256: "a".repeat(64) } },
    { ...comments[3], scope: { ...uiScope, workId: "12" } },
    { ...comments[4], scope: { ...uiScope, companyBranchId: 2 } }];
  f.props.offline = { ...uiSnapshot(operations), online: true };
  assert.equal(f.props.offline.pending, 5);
  assert.equal(f.review().canSubmit, true);
  assert.equal(f.confirm().disabled, false);
  assert.doesNotMatch(f.review().reasons.join(" "), /cambios pendientes/);
});

test("valid online required checklist sends exactly once, even through retained and forced callbacks", async (t) => {
  const f = await detailFixture(); t.after(f.close);
  const tree = f.render(); assert.equal(elements<{ title: string }>(tree, "Button").filter(({ props }) => props.title === "Entregar trabajo").length, 1);
  action(tree, "Entregar trabajo").onPress(); assert.equal(f.calls.length, 0);
  assert.equal(f.review().canSubmit, true);
  const submit = f.review().onSubmit; const confirm = f.confirm();
  assert.equal(confirm.disabled, false); confirm.onPress(); confirm.onPress(); submit(input); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].status, "delivered");
  assert.equal(elements(f.render(), "DeliverySuccess").length, 1);
});

test("review remains mounted across pending/read-only updates and refresh never submits", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  const retained = f.confirm();
  f.props.offline = { ...uiSnapshot(pending(1).map(operation => ({ ...operation, status: "conflict", lastError: "MOBILE_SYNC_STATUS_CONFLICT" }))), online: true };
  f.renderReview(); retained.onPress(); await settle(); assert.equal(f.calls.length, 0);
  const refresh = action(f.renderReview(), "Actualizar ficha"); refresh.onPress(); refresh.onPress();
  assert.equal(f.refreshes(), 1); assert.equal(f.confirm().disabled, true);
  f.review().onSubmit(input); assert.equal(f.calls.length, 0);
  f.props.staleReadOnly = true; f.refresh.resolve(); await settle(); assert.equal(f.review().canSubmit, false);
});

test("confirmation rechecks permission after durable draft flush", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  f.review().onSubmit(input);
  f.props.work = { ...f.props.work, canExecute: false }; f.render();
  await settle(); assert.equal(f.calls.length, 0);
});

test("initial delivery review preserves readiness and foreground gates and cannot bypass manual hours or dates", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  for (const snapshot of [null, { ...uiSnapshot(), online: true, authBlocked: true }, { ...uiSnapshot(), online: true, connection: { status: "ready" as const, networkConnected: true, foreground: false, checkedAt: 1 } }]) {
    f.props.offline = snapshot;
    assert.equal(action(f.render(), "Entregar trabajo").disabled, true); assert.equal(f.review().canSubmit, false);
    f.review().onSubmit(input); await settle(); assert.equal(f.calls.length, 0);
  }
  f.props.offline = { ...uiSnapshot(), online: true };
  f.props.busy = true; assert.equal(action(f.render(), "Entregar trabajo").disabled, true); f.review().onSubmit(input);
  f.props.busy = false; f.render();
  for (const invalid of [{ ...input, executionDates: [] }, { ...input, executionDates: ["2030-01-01"] }, { ...input, isManual: true, executionStartTime: "08:00", executionEndTime: "09:00" }]) f.review().onSubmit(invalid);
  f.props.allowEditExecutionTime = true; f.render();
  f.review().onSubmit({ ...input, isManual: true, executionStartTime: "25:00", executionEndTime: "09:00" });
  f.props.work = { ...f.props.work, elapsedSeconds: 0 }; f.render(); f.review().onSubmit(input);
  assert.equal(f.confirm().disabled, true);
  await settle(); assert.equal(f.calls.length, 0);
});

test("causally reconciled timer permits review confirmation without reclassifying the work", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  const timer: OfflineOperation = { ...uiOperation, kind: "timer", status: "applied", payload: { status: "paused", baseStatus: "in_progress" }, receipt: { operationId: uiOperation.id, state: "applied" } };
  f.props.offline = { ...uiSnapshot([timer]), online: true };
  assert.equal(f.review().canSubmit, true);
  const candidate: TimerReadAssignmentWork = { ...f.props.work, offlineTimerRead: { scope: uiScope, appliedOperationIds: [timer.id] } };
  f.props.work = candidate; assert.equal(f.review().canSubmit, true);
  f.confirm().onPress(); await settle(); assert.equal(f.calls.length, 1);
});

test("actual order-to-card callback retains delivery review action for offline, local, stale and unexecutable work", () => {
  const orderHooks = durableReactFixture(); const cardHooks = durableReactFixture();
  const order = uiModule<{ OrderDetailScreen: Wrapped<OrderDetailScreenProps> }>("screens/OrderDetailScreen.tsx", orderHooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" }, "./orders/AssignmentOrderCard": { AssignmentOrderSummary: "AssignmentOrderSummary" },
    "./orders/AssignmentWorkCard": { AssignmentWorkCard: "AssignmentWorkCard" }, "./orders/OrderMaterialsTab": { OrderMaterialsTab: "OrderMaterialsTab" },
    "./orders/OrderLifecyclePanel": { OrderLifecyclePanel: "OrderLifecyclePanel" }, "./offline/OfflineOrderLifecyclePanel": { OfflineOrderLifecyclePanel: "OfflineOrderLifecyclePanel" },
    "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
  });
  const card = uiModule<{ AssignmentWorkCard: Wrapped<AssignmentWorkCardProps> }>("screens/orders/AssignmentWorkCard.tsx", cardHooks, { "./AssignmentMetadataRow": { AssignmentMetadataRow: "AssignmentMetadataRow" } });
  const opened: { id: string; options?: WorkOpenOptions }[] = []; let mutations = 0;
  const props: OrderDetailScreenProps = { tenant, branchName: "UI", group: group(), mode: "live", busy: false, storageKey: "review-order", technicianName: "UI", companyBranchId: 1, range: uiScope,
    offline: uiSnapshot(pending(5)), onBack: () => {}, onOpenWork: (_group, candidate, options) => { opened.push({ id: candidate.id, options }); },
    onWorkStatus: async () => { mutations++; }, onRefresh: unused, onLoadFiles: async () => [], onUploadFiles: unused, onDeleteFile: unused, onLoadDelivery: unused, onStart: unused, onDeliver: unused };
  const render = () => {
    const tree = renderWrapped(orderHooks, order.OrderDetailScreen, props);
    const child = elements<AssignmentWorkCardProps>(tree, "AssignmentWorkCard")[0]; assert.ok(child);
    return renderWrapped(cardHooks, card.AssignmentWorkCard, child.props);
  };
  try {
    for (const candidate of [readyWork(), work({ canExecute: false }), work({ id: "local-unconfirmed" }), work({ missingRequiredInfo: ["OFFLINE_AWAITING_SERVER_SNAPSHOT"] })]) {
      props.group = group({ works: [candidate] }); props.staleReadOnly = true;
      const button = action(render(), "Entregar"); assert.equal(button.disabled, false); button.onPress();
      assert.equal(opened.at(-1)?.id, candidate.id); assert.equal(opened.at(-1)?.options?.action, "deliver");
    }
    const retained = action(render(), "Entregar");
    for (const snapshot of [null, { ...uiSnapshot(), authBlocked: true }]) {
      props.offline = snapshot; assert.equal(action(render(), "Entregar").disabled, true); retained.onPress();
    }
    assert.equal(opened.length, 4); assert.equal(mutations, 0);
  } finally { orderHooks.unmount(); cardHooks.unmount(); }
});

test("manual duration prefills timer total, preserves corrections on refresh and submits the chosen total", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  f.props.allowEditExecutionTime = true;
  f.props.work = { ...f.props.work, elapsedSeconds: 37 * 3600 + 29 * 60, firstInProgressTime: "08:00" };
  f.renderReview();
  elements<{ label: string; onPress(): void }>(f.renderReview(), "ChoiceButton").find(({ props }) => props.label === "Editar horas de ejecución manualmente")!.props.onPress();
  f.renderReview();
  const fields = () => elements<{ label: string; value: string; onChange(value: string): void }>(f.renderReview(), "NumericSelectField");
  assert.deepEqual(fields().map(({ props }) => props.value), ["37", "29"]);
  fields()[0].props.onChange("8"); fields()[1].props.onChange("0");
  f.props.work = { ...f.props.work, elapsedSeconds: 38 * 3600 }; f.renderReview();
  assert.deepEqual(fields().map(({ props }) => props.value), ["8", "0"]);
  f.confirm().onPress(); f.render(); await settle();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(structuredClone(f.calls[0]), { status: "delivered", isManual: true, executionDates: [uiScope.startDate], executionStartTime: "08:00", executionEndTime: "16:00", endDateOffset: 0 });
});

test("manual totals retain single-day and authorized multi-day duration contracts", () => {
  const candidate = { ...readyWork(), plannedDates: ["2026-09-01", "2026-09-02"] };
  const overnight = manualDurationCompletion(["2026-09-01"], "2", "30", "23:00", uiScope, candidate);
  assert.equal(overnight.minutes, 150); assert.equal(overnight.input?.endDateOffset, 1);
  const multiple = manualDurationCompletion(candidate.plannedDates, "30", "0", "08:00", uiScope, candidate);
  assert.equal(multiple.minutes, 1800); assert.equal(multiple.input?.endDateOffset, 1);
  assert.deepEqual(multiple.input?.executionDates, candidate.plannedDates);
  assert.equal(manualDurationCompletion(["2030-01-01"], "8", "0", "08:00", uiScope, candidate).input, null);
  assert.equal(manualDurationCompletion([uiScope.startDate], "0", "0", "08:00", uiScope, candidate).input, null);
  assert.equal(manualDurationCompletion([uiScope.startDate], "8", "60", "08:00", uiScope, candidate).input, null);
});

test("delivered detail keeps status across tabs and reopens once without submitting a timer", async context => {
  const fixture = await detailFixture(); context.after(fixture.close);
  fixture.props.work = { ...fixture.props.work, status: "delivered" };
  let calls = 0;
  fixture.props.onReopen = async () => { calls++; };
  assert.equal(elements<{ testID?: string }>(fixture.render(), "View").filter(node => node.props.testID === "work-closed-banner").length, 1);
  action(fixture.render(), "Reabrir trabajo").onPress();
  action(fixture.render(), "Confirmar reapertura").onPress(); fixture.render(); await settle(); fixture.render();
  assert.equal(calls, 1); assert.equal(fixture.calls.length, 0);
  assert.equal(action(fixture.render(), "Reabierto · actualizando").disabled, true);
  fixture.props.work = { ...fixture.props.work, status: "completed" };
  assert.equal(elements<{ title: string }>(fixture.render(), "Button").filter(node => node.props.title === "Reabrir trabajo").length, 0);
});

for (const type of ["internal_maintenance", "external_ot"] as const) test(`${type}: header back returns from files to works before leaving`, () => {
  const hooks = durableReactFixture();
  const module = uiModule<{ OrderDetailScreen: Wrapped<OrderDetailScreenProps> }>("screens/OrderDetailScreen.tsx", hooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" }, "./orders/AssignmentOrderCard": { AssignmentOrderSummary: "AssignmentOrderSummary" },
    "./orders/AssignmentWorkCard": { AssignmentWorkCard: "AssignmentWorkCard" }, "./orders/OrderMaterialsTab": { OrderMaterialsTab: "OrderMaterialsTab" },
    "./orders/OrderLifecyclePanel": { OrderLifecyclePanel: "OrderLifecyclePanel" }, "./offline/OfflineOrderLifecyclePanel": { OfflineOrderLifecyclePanel: "OfflineOrderLifecyclePanel" },
    "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
  });
  let exits = 0;
  const props: OrderDetailScreenProps = { tenant, branchName: "UI", group: group({ type, products: [] }), mode: "live", busy: false, storageKey: "navigation-order", technicianName: "UI", onBack: () => { exits++; }, onOpenWork() {}, onWorkStatus: unused, onRefresh: unused, onLoadFiles: async () => [], onUploadFiles: unused, onDeleteFile: unused, onLoadDelivery: unused, onStart: unused, onDeliver: unused };
  const render = () => renderWrapped(hooks, module.OrderDetailScreen, props);
  const tabs = elements<{ accessibilityRole?: string; accessibilityLabel: string; onPress(): void }>(render(), "Pressable");
  assert.equal(tabs.some(({ props }) => props.accessibilityLabel.startsWith("Repuestos")), false);
  tabs.find(({ props }) => props.accessibilityLabel === "Archivos")!.props.onPress();
  const panel = elements<{ backHandler: { current: ((home?: boolean) => boolean) | null } }>(render(), "FileWorkspace")[0];
  panel.props.backHandler.current = () => true;
  action(render(), "Volver al paso anterior").onPress();
  assert.equal(elements(render(), "AssignmentWorkCard").length, 0);
  panel.props.backHandler.current = () => false;
  action(render(), "Volver al paso anterior").onPress();
  assert.ok(elements(render(), "AssignmentWorkCard").length > 0);
  assert.equal(exits, 0);
  action(render(), "Opciones de la orden").onPress();
  assert.equal(exits, 0);
  action(render(), "Archivos").onPress();
  const filesPanel = elements<{ compact: boolean; autoSave: boolean }>(render(), "FileWorkspace")[0];
  assert.equal(filesPanel.props.compact, true);
  assert.equal(filesPanel.props.autoSave, true);
  action(render(), "Opciones de la orden").onPress();
  action(render(), "Volver a mis asignaciones").onPress();
  assert.equal(exits, 1);
  hooks.unmount();
});

test("offline untimed work can save a manual delivery without a downloaded start clock", async context => {
  const fixture = await detailFixture("deliver"); context.after(fixture.close);
  fixture.props.timezone = "America/Santiago";
  fixture.props.allowEditExecutionTime = true;
  fixture.props.work = { ...readyWork(), firstInProgressTime: null, scheduledStartTime: "", scheduledEndTime: "", elapsedSeconds: 0 };
  const start: OfflineOperation = { ...uiOperation, kind: "timer", payload: { status: "in_progress", baseStatus: "paused", recordedAt: "2026-09-01T12:00:00.000Z", observedAt: fixture.props.generatedAt }, localClock: { elapsedSeconds: 0 } };
  const pause: OfflineOperation = { ...start, id: "00000000-0000-4000-8000-000000000002", payload: { status: "paused", baseStatus: "in_progress", recordedAt: "2026-09-01T12:03:00.000Z", observedAt: fixture.props.generatedAt, previousOperationId: start.id }, localClock: { elapsedSeconds: 180 } };
  fixture.props.offline = uiSnapshot([start, pause]);
  const render = fixture.renderReview;
  render();
  elements<{ label: string; onPress(): void }>(render(), "ChoiceButton").find(node => node.props.label === "Editar horas de ejecución manualmente")!.props.onPress();
  const fields = elements<{ label: string; onChange(value: string): void }>(render(), "NumericSelectField");
  fields.find(node => node.props.label === "Horas trabajadas")!.props.onChange("1");
  fields.find(node => node.props.label === "Minutos trabajados")!.props.onChange("30");
  const button = action(render(), "Guardar entrega");
  assert.equal(button.disabled, false);
  button.onPress(); button.onPress();
  await settle();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].status, "delivered");
  assert.equal(fixture.calls[0].isManual, true);
  assert.equal(fixture.calls[0].executionStartTime, "08:00");
  assert.equal(fixture.calls[0].executionEndTime, "09:30");
});

test("offline delivery uses downloaded evidence counts but never an empty or unverified file list online", async context => {
  const fixture = await detailFixture("deliver"); context.after(fixture.close);
  fixture.props.offline = uiSnapshot();
  fixture.props.work = { ...fixture.props.work, isFilesRequired: true, filesCount: 1 };
  fixture.fileState.files = null; fixture.fileState.error = "No hay copia local de la lista de archivos";
  assert.equal(action(fixture.renderReview(), "Guardar entrega").disabled, false);
  assert.equal(fixture.review().onRefresh, undefined);
  fixture.props.work.filesCount = 0;
  assert.equal(action(fixture.renderReview(), "Guardar entrega").disabled, true);
  fixture.props.work.filesCount = 1; fixture.fileState.files = [];
  assert.equal(action(fixture.renderReview(), "Guardar entrega").disabled, true);
  fixture.fileState.files = null; fixture.props.offline = { ...uiSnapshot(), online: true };
  assert.equal(action(fixture.renderReview(), "Guardar entrega").disabled, true);
});

test("offline delivery label distinguishes local completion, confirmation and conflict", () => {
  const completion: Extract<OfflineOperation, { kind: "completion" }> = { ...uiOperation, kind: "completion", prerequisiteIds: [], localClock: { elapsedSeconds: 90 },
    payload: { input: syncCompletionInputSchema.parse(input), recordedAt: "2026-09-01T10:00:00Z", observedAt: "2026-09-01T09:00:00Z", baseStatus: "paused" } };
  assert.equal(completionStatusLabel(completion), "Entregado local · pendiente");
  assert.equal(completionStatusLabel({ ...completion, status: "applied" }), "Entregado · actualizando");
  assert.equal(completionStatusLabel({ ...completion, status: "conflict" }), "Entrega por revisar");
});

for (const mode of ["offline", "unavailable", "storage-failure"] as const) test(`offline delivery confirmation ${mode} keeps pending changes and waits for a durable save`, async context => {
  const fixture = await detailFixture("deliver"); context.after(fixture.close);
  const operations: OfflineOperation[] = pending(5);
  fixture.props.offline = { ...uiSnapshot(operations), connection: { status: mode === "unavailable" ? "service_error" : "offline", networkConnected: mode === "unavailable", foreground: true, checkedAt: 1 } };
  let calls = 0;
  fixture.props.onStatus = async value => {
    calls++;
    if (mode === "storage-failure") throw new Error("DISK_FULL");
    operations.push({ ...uiOperation, id: "00000000-0000-4000-8000-000000000099", kind: "completion", prerequisiteIds: operations.map(operation => operation.id),
      localClock: { elapsedSeconds: fixture.props.work.elapsedSeconds }, payload: { input: syncCompletionInputSchema.parse(value), baseStatus: "paused", recordedAt: "2026-09-01T10:00:00Z", observedAt: fixture.props.generatedAt } });
    fixture.props.offline = uiSnapshot(operations);
    throw new OfflineQueuedError({ kind: "completion", operationId: operations.at(-1)!.id, operationIds: [operations.at(-1)!.id], date: uiScope.startDate, ownsFiles: false });
  };
  const button = fixture.confirm(); assert.equal(button.disabled, false);
  button.onPress(); button.onPress(); await settle(); fixture.render();
  assert.equal(calls, 1);
  assert.equal(fixture.props.work.status, "paused", "the server snapshot must remain unchanged");
  assert.equal(elements(fixture.render(), "DeliverySuccess").length, 0);
  assert.equal(operations.length, mode === "storage-failure" ? 5 : 6);
  if (mode !== "storage-failure") assert.match(JSON.stringify(fixture.render()), /Entregado local/);
  else assert.equal(elements(fixture.render(), "CompletionDialog").length, 1);
});