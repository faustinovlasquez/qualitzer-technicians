/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import type { AssignmentWork, StatusInput, WorkOpenOptions } from "../src/domain/models";
import type { OfflineOperation, TimerReadAssignmentWork } from "../src/domain/offline";
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

async function detailFixture(initialAction?: "deliver") {
  const hooks = durableReactFixture(); const dialogHooks = durableReactFixture(); const memory = memoryDraftStorage();
  const drafts = uiModule<typeof import("../src/screens/workDetail/useWorkDraft")>("screens/workDetail/useWorkDraft.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "./localPhotos": {},
  });
  const component = uiModule<{ WorkDetailScreen: Wrapped<WorkDetailScreenProps> }>("screens/WorkDetailScreen.tsx", hooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./workDetail/ChecklistTab": { ChecklistTab: "ChecklistTab" }, "./workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" },
    "./workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" }, "./workDetail/localPhotos": { openLocalPhotoScope: () => {} },
    "./workDetail/useAttachmentFiles": { useAttachmentFiles: () => ({ files: [], error: null, loading: false, load: async () => {} }) },
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
  const render = () => renderWrapped(hooks, component.WorkDetailScreen, props);
  const review = () => { const found = elements<CompletionDialogProps>(render(), "CompletionDialog")[0]; assert.ok(found); return found.props; };
  const renderReview = () => { const tree = dialogHooks.render(() => dialog.CompletionDialog(review())); dialogHooks.flush(); return tree; };
  render(); await settle(); render();
  return { props, calls, render, review, renderReview, refresh, refreshes: () => refreshes, close: () => { hooks.unmount(); dialogHooks.unmount(); } };
}

const blockers: { name: string; apply(props: WorkDetailScreenProps): void; reason: RegExp }[] = [
  { name: "five pending changes and unavailable service", apply: (props) => { props.offline = { ...uiSnapshot(pending(5)), connection: { status: "service_error", networkConnected: true, foreground: true, checkedAt: 1, errorCode: "MOBILE_SYNC_ACTIONS_UNAVAILABLE" } }; }, reason: /los 5 cambios pendientes/ },
  { name: "offline", apply: (props) => { props.offline = uiSnapshot(); }, reason: /Conéctate/ },
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
  { name: "applied without causal proof", apply: (props) => { props.offline = { ...uiSnapshot([{ ...uiOperation, kind: "timer", status: "applied", payload: { status: "paused", baseStatus: "in_progress" }, receipt: { operationId: uiOperation.id, state: "applied" } }]), online: true }; }, reason: /último cambio del cronómetro/ },
];

for (const scenario of blockers) test(`delivery review opens for ${scenario.name}, but real and forced confirmation cannot submit`, async (t) => {
  const f = await detailFixture(); t.after(f.close); scenario.apply(f.props);
  f.render(); await settle();
  const before = JSON.stringify(f.props.work);
  const button = action(f.render(), "Entregar trabajo"); assert.equal(button.disabled, false); button.onPress();
  assert.equal(f.calls.length, 0); assert.equal(f.refreshes(), 0);
  assert.equal(f.review().canSubmit, false); assert.match(f.review().reasons.join(" "), scenario.reason);
  assert.doesNotMatch(f.review().reasons.join(" "), /MOBILE_|[0-9a-f]{8}-[0-9a-f]{4}-/);
  const tree = f.renderReview(); const confirm = action(tree, "Confirmar y entregar"); assert.equal(confirm.disabled, true);
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
  assert.equal(f.props.offline.pending, 5); assert.match(f.review().reasons[0], /los 3 cambios pendientes/);
  const body = elements<{ children: ReactNode }>(f.renderReview(), "BodyText").map((element) => JSON.stringify(element.props.children)).join(" ");
  assert.ok(body.indexOf("los 3 cambios") < body.indexOf("Las pausas"), "blockers precede execution inputs");
});

test("valid online required checklist sends exactly once, even through retained and forced callbacks", async (t) => {
  const f = await detailFixture(); t.after(f.close);
  const tree = f.render(); assert.equal(elements<{ title: string }>(tree, "Button").filter(({ props }) => props.title === "Entregar trabajo").length, 1);
  action(tree, "Entregar trabajo").onPress(); assert.equal(f.calls.length, 0);
  assert.equal(f.review().canSubmit, true);
  const submit = f.review().onSubmit; const confirm = action(f.renderReview(), "Confirmar y entregar");
  assert.equal(confirm.disabled, false); confirm.onPress(); confirm.onPress(); submit(input); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].status, "delivered");
});

test("review remains mounted across pending/read-only updates and refresh never submits", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  const retained = action(f.renderReview(), "Confirmar y entregar");
  f.props.offline = uiSnapshot(pending(1)); f.renderReview(); retained.onPress(); await settle(); assert.equal(f.calls.length, 0);
  const refresh = action(f.renderReview(), "Actualizar ficha"); refresh.onPress(); refresh.onPress();
  assert.equal(f.refreshes(), 1); assert.equal(action(f.renderReview(), "Confirmar y entregar").disabled, true);
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
  assert.equal(action(f.renderReview(), "Confirmar y entregar").disabled, true);
  await settle(); assert.equal(f.calls.length, 0);
});

test("causally reconciled timer permits review confirmation without reclassifying the work", async (t) => {
  const f = await detailFixture("deliver"); t.after(f.close);
  const timer: OfflineOperation = { ...uiOperation, kind: "timer", status: "applied", payload: { status: "paused", baseStatus: "in_progress" }, receipt: { operationId: uiOperation.id, state: "applied" } };
  f.props.offline = { ...uiSnapshot([timer]), online: true };
  assert.equal(f.review().canSubmit, false);
  const candidate: TimerReadAssignmentWork = { ...f.props.work, offlineTimerRead: { scope: uiScope, appliedOperationIds: [timer.id] } };
  f.props.work = candidate; assert.equal(f.review().canSubmit, true);
  action(f.renderReview(), "Confirmar y entregar").onPress(); await settle(); assert.equal(f.calls.length, 1);
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