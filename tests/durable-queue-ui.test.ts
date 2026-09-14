import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import type { ChecklistCatalogPage, ChecklistAssignmentResult } from "../src/domain/checklistAssignment";
import { checklistAssociationBlocked } from "../src/domain/checklistAssignment";
import type { Attachment, CommentPage, LocalPhoto, StatusInput, StepAnswer } from "../src/domain/models";
import type { OfflineOperation } from "../src/domain/offline";
import type { AssignmentWorkCardProps } from "../src/screens/orders/AssignmentWorkCard";
import type { CommentsTabProps } from "../src/screens/workDetail/CommentsTab";
import type { FileWorkspaceProps } from "../src/screens/workDetail/FileWorkspace";
import type { ChecklistAssociationPanelProps } from "../src/screens/workDetail/checklist/ChecklistAssociationPanel";
import type { WorkDetailScreenProps } from "../src/screens/WorkDetailScreen";
import type { ChecklistTabProps } from "../src/screens/workDetail/ChecklistTab";
import { pendingTimerForWork, type PendingTimer } from "../src/screens/offline/offlineUi";
import { group, work } from "../server/tests/fixtures";
import { durableReactFixture as reactFixture } from "./helpers/durable-ui";
import { action, deferred, elements, memoryDraftStorage, queued, renderWrapped, settle, uiModule, uiOperation, uiScope, uiSnapshot, type Wrapped, type UiAction } from "./helpers/durable-ui";

async function detailFixture() {
  const hooks = reactFixture(); const editorHooks = reactFixture(); const memory = memoryDraftStorage();
  const drafts = uiModule<typeof import("../src/screens/workDetail/useWorkDraft")>("screens/workDetail/useWorkDraft.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "./localPhotos": {},
  });
  const attachments = { files: [], error: null, loading: false, load: async () => {} };
  const module = uiModule<{ WorkDetailScreen: Wrapped<WorkDetailScreenProps> }>("screens/WorkDetailScreen.tsx", hooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./workDetail/ChecklistTab": { ChecklistTab: "ChecklistTab" },
    "./workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" },
    "./workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" },
    "./workDetail/localPhotos": { openLocalPhotoScope: () => {} },
    "./workDetail/useAttachmentFiles": { useAttachmentFiles: () => attachments },
    "./workDetail/useWorkDraft": drafts,
    "./workDetail/WorkInformation": { EquipmentTab: "EquipmentTab", WorkTab: "WorkTab" },
    "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
    "./workDetail/CommentsTab": { CommentsTab: "CommentsTab" },
    "./offline/QueuedNotice": { QueuedNotice: "QueuedNotice" },
    "./workDetail/checklist/ChecklistAssociationPanel": { ChecklistAssociationPanel: "ChecklistAssociationPanel" },
  });
  const editor = uiModule<typeof import("../src/screens/workDetail/checklist/StepEditor")>("screens/workDetail/checklist/StepEditor.tsx", editorHooks, {
    "../useWorkDraft": drafts, "./ResponseInput": { ResponseInput: "ResponseInput" }, "./styles": { checklistStyles: {} },
  });
  const candidate = work({ status: "pending" });
  const commit = deferred<void>(); let saves = 0; let refreshes = 0; let advances = 0;
  const props: WorkDetailScreenProps = { tenant: { id: "ui-only", name: "UI", portalOrigin: "https://ui.example.com", environment: "development" },
    branchName: "UI", group: group({ works: [candidate] }), work: candidate, generatedAt: "2026-09-01T10:00:00Z", mode: "live", range: uiScope,
    busy: false, error: null, storageKey: "ui-only", initialTab: "checklist", allowEditExecutionTime: false, companyBranchId: 1, offline: uiSnapshot(),
    onBack: () => {}, onRefresh: async () => { refreshes++; await new Promise<void>(() => {}); }, onStatus: async () => { throw new Error("UNEXPECTED_STATUS"); },
    onSaveStep: async () => { saves++; await commit.promise; }, onLoadChecklistOptions: async () => ({ page: 0, pageSize: 20, hasMore: false, items: [] }),
    onAttachChecklist: async () => { throw new Error("UNEXPECTED_ATTACH"); }, onLoadFiles: async () => [], onLoadStepFiles: async () => [],
    onUpload: async () => { throw new Error("UNEXPECTED_UPLOAD"); }, onReport: async () => { throw new Error("UNEXPECTED_REPORT"); },
    onUploadDocuments: async () => { throw new Error("UNEXPECTED_UPLOAD"); }, onDeleteFile: async () => { throw new Error("UNEXPECTED_DELETE"); },
    onLoadComments: async () => ({ data: [], page: 0, pageSize: 20, totalRows: 0, totalPages: 0 }), onAddComment: async () => { throw new Error("UNEXPECTED_COMMENT"); },
  };
  const render = () => renderWrapped(hooks, module.WorkDetailScreen, props);
  render(); await settle();
  const context = () => {
    const result = elements<ChecklistTabProps>(render(), "ChecklistTab")[0]; assert.ok(result); return result.props;
  };
  const candidateStep = candidate.checklists[0].steps[0];
  const answer: StepAnswer = { responseValue: "approved", isCompleted: true, executionStatus: "completed", comment: "Borrador" };
  context().onChange(candidateStep, answer); await settle();
  const renderEditor = () => { const tree = editorHooks.render(() => editor.StepEditor({ step: candidateStep, context: context(), onNext: () => { advances++; } })); editorHooks.flush(); return tree; };
  return { hooks, editorHooks, props, memory, candidateStep, answer, commit, context, render, renderEditor, saves: () => saves, refreshes: () => refreshes, advances: () => advances };
}

test("actual detail and step editor advance after durable answer queue, not server refresh, without confirming progress", async () => {
  const f = await detailFixture(); const before = JSON.stringify(f.props.work);
  const save = action(f.renderEditor(), "Guardar y siguiente"); save.onPress(); save.onPress(); await settle();
  assert.equal(f.saves(), 1); assert.equal(f.advances(), 0);
  f.commit.reject(queued("answer")); await settle();
  assert.equal(f.advances(), 1); assert.equal(f.refreshes(), 0);
  const context = f.context();
  assert.equal(context.draft.answers[String(f.candidateStep.stepId)].saved, false);
  assert.equal(context.isAnswerQueued?.(f.candidateStep, f.answer), true);
  assert.equal(JSON.stringify(f.props.work), before);
  assert.equal(action(f.renderEditor(), "Respuesta ya registrada en cola").disabled, true);
  f.editorHooks.unmount(); f.hooks.unmount();
});

test("answer storage failure stays on current step with draft and does not call queue or refresh", async () => {
  const f = await detailFixture(); f.memory.control.fail = true;
  action(f.renderEditor(), "Guardar y siguiente").onPress(); await settle();
  assert.equal(f.advances(), 0); assert.equal(f.saves(), 0); assert.equal(f.refreshes(), 0);
  assert.equal(f.context().draft.answers[String(f.candidateStep.stepId)].saved, false);
  assert.ok(JSON.stringify(f.renderEditor()).includes("borrador se conserva"));
  f.editorHooks.unmount(); f.hooks.unmount();
});

test("confirmed answer does not duplicate hook refresh and a queued response after unmount cannot advance", async () => {
  const confirmed = await detailFixture(); action(confirmed.renderEditor(), "Guardar y siguiente").onPress(); await settle();
  confirmed.commit.resolve(); await settle();
  assert.equal(confirmed.advances(), 1); assert.equal(confirmed.refreshes(), 0);
  assert.equal(confirmed.context().draft.answers[String(confirmed.candidateStep.stepId)].saved, true);
  confirmed.editorHooks.unmount(); confirmed.hooks.unmount();
  const abandoned = await detailFixture(); action(abandoned.renderEditor(), "Guardar y siguiente").onPress(); await settle();
  abandoned.editorHooks.unmount(); abandoned.hooks.unmount(); abandoned.commit.reject(queued("answer")); await settle();
  assert.equal(abandoned.advances(), 0); assert.equal(abandoned.refreshes(), 0);
});

test("detail timer changes visible intent after one commit and delivery review remains mounted when pending work appears", async () => {
  const f = await detailFixture(); const commit = deferred<void>(); let changes = 0;
  f.props.onStatus = async () => { changes++; await commit.promise; };
  action(f.render(), "Trabajo").onPress();
  const start = action(f.render(), "Iniciar trabajo"); start.onPress(); start.onPress(); await settle();
  assert.equal(changes, 1); assert.equal(action(f.render(), "Iniciar trabajo").disabled, true);
  commit.reject(queued("timer")); await settle();
  assert.equal(action(f.render(), "Pausar trabajo").disabled, false); assert.equal(f.refreshes(), 0);
  assert.equal(f.props.work.status, "pending");
  assert.equal(action(f.render(), "Entregar trabajo").disabled, false);
  f.props.offline = { ...uiSnapshot([{ ...uiOperation, kind: "timer", status: "applied", payload: { status: "in_progress", baseStatus: "pending" } }]), online: true };
  f.props.work = { ...f.props.work, status: "in_progress", ...{ offlineTimerRead: { scope: uiScope, appliedOperationIds: [uiOperation.id] } } }; f.render();
  action(f.render(), "Entregar trabajo").onPress();
  assert.equal(elements(f.render(), "CompletionDialog").length, 1);
  f.props.offline = { ...uiSnapshot([{ ...uiOperation, kind: "comment", text: "Pendiente" }]), online: true };
  assert.equal(elements(f.render(), "CompletionDialog").length, 1);
  assert.equal(elements<{ canSubmit: boolean }>(f.render(), "CompletionDialog")[0].props.canSubmit, false);
  assert.equal(action(f.render(), "Entregar trabajo").disabled, false);
  f.editorHooks.unmount(); f.hooks.unmount();
});

function cardFixture() {
  const hooks = reactFixture();
  const module = uiModule<{ AssignmentWorkCard: Wrapped<AssignmentWorkCardProps> }>("screens/orders/AssignmentWorkCard.tsx", hooks, {
    "./AssignmentMetadataRow": { AssignmentMetadataRow: "AssignmentMetadataRow" },
  });
  const candidate = work({ status: "pending" });
  const calls: StatusInput[] = [];
  const commits: ReturnType<typeof deferred<void>>[] = [];
  const opened: object[] = [];
  const props: AssignmentWorkCardProps = { group: group({ works: [candidate] }), work: candidate, offline: uiSnapshot(), online: false,
    onOpenWork: (_group, _work, options) => { opened.push(options ?? {}); },
    onWorkStatus: async (_group, _work, input) => { calls.push(input); const commit = deferred<void>(); commits.push(commit); await commit.promise; },
  };
  const render = () => renderWrapped(hooks, module.AssignmentWorkCard, props);
  render();
  return { hooks, props, calls, commits, opened, render };
}

test("timer UI waits for durable commit, deduplicates synchronous presses, then permits a distinct pause", async () => {
  const f = cardFixture();
  const before = JSON.stringify(f.props.work);
  const start = action(f.render(), "Iniciar");
  assert.equal(start.disabled, false);
  start.onPress(); start.onPress();
  assert.equal(f.calls.length, 1);
  assert.equal(action(f.render(), "Iniciar").loading, true);
  assert.ok(!JSON.stringify(f.render()).includes("solicitado:"));
  f.commits[0].reject(queued("timer")); await settle();
  start.onPress();
  assert.equal(f.calls.length, 1, "same gesture before React rerenders cannot enqueue again");
  const tree = f.render();
  assert.equal(action(tree, "Pausar").title, "Pausar · Guardando…");
  assert.ok(!JSON.stringify(tree).includes("En cola · tiempo pendiente de confirmar"));
  assert.equal(action(tree, "Pausar").disabled, false);
  assert.equal(action(tree, "Entregar").disabled, false);
  action(tree, "Pausar").onPress(); action(tree, "Pausar").onPress();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].status, "paused");
  f.commits[1].reject(queued("timer", "00000000-0000-4000-8000-000000000002")); await settle();
  assert.equal(action(f.render(), "Reanudar").disabled, false);
  assert.equal(JSON.stringify(f.props.work), before, "no confirmed clock/status/checklist mutation");
  f.hooks.unmount();
});

test("timer UI keeps failed state retryable and gates stale, auth, local work and unmount callbacks", async () => {
  const f = cardFixture();
  action(f.render(), "Iniciar").onPress(); f.commits[0].reject(new Error("LOCAL_STORAGE_FAILED")); await settle();
  assert.ok(JSON.stringify(f.render()).includes("LOCAL_STORAGE_FAILED"));
  assert.equal(action(f.render(), "Iniciar").disabled, false);
  const retained = action(f.render(), "Iniciar");
  f.props.offline = { ...uiSnapshot(), authBlocked: true }; f.render(); retained.onPress();
  assert.equal(f.calls.length, 1);
  f.props.offline = null; assert.equal(action(f.render(), "Iniciar").disabled, true);
  f.props.offline = uiSnapshot(); f.props.staleReadOnly = true;
  assert.equal(action(f.render(), "Iniciar").disabled, true);
  f.props.staleReadOnly = false; f.props.work = { ...f.props.work, id: "local-pending" };
  assert.equal(action(f.render(), "Iniciar").disabled, true);
  f.props.work = { ...f.props.work, id: "11" }; f.render(); f.hooks.unmount(); retained.onPress();
  assert.equal(f.calls.length, 1);
});

test("timer helper isolates dates, work and branch and includes attention states without altering elapsed time", () => {
  const start: PendingTimer = { ...uiOperation, kind: "timer", payload: { status: "in_progress", baseStatus: "pending" } };
  const pause: PendingTimer = { ...start, id: "pause", createdAt: 1001, status: "needs_review", payload: { status: "paused", baseStatus: "in_progress" } };
  const others: OfflineOperation[] = [
    { ...pause, id: "other-day", createdAt: 2000, scope: { ...uiScope, startDate: "2026-09-02" } },
    { ...pause, id: "other-work", createdAt: 2000, scope: { ...uiScope, workId: "12" } },
    { ...pause, id: "other-branch", createdAt: 2000, scope: { ...uiScope, companyBranchId: 2 } },
    { ...pause, id: "applied", createdAt: 3000, status: "applied" },
  ];
  const snapshot = uiSnapshot([start, pause, ...others]);
  assert.equal(pendingTimerForWork(snapshot, uiScope)?.id, "applied", "receipt alone cannot dismiss an applied intent");
  const reconciled = { ...work(), offlineTimerRead: { scope: uiScope, appliedOperationIds: ["applied"] } };
  assert.equal(pendingTimerForWork(snapshot, uiScope, reconciled)?.id, "pause");
  assert.equal(pendingTimerForWork(null, uiScope), null);
});

test("restored timer uses optional prop, allows delivery review, never overrides canonical badge", () => {
  const f = cardFixture();
  f.props.pendingTimer = { ...uiOperation, kind: "timer", status: "conflict", payload: { status: "in_progress", baseStatus: "pending" }, lastError: "MOBILE_SYNC_OPERATION_REUSED" };
  f.props.online = true; f.props.offline = { ...uiSnapshot([f.props.pendingTimer]), online: true };
  const tree = f.render();
  assert.equal(action(tree, "Pausar").disabled, true);
  assert.equal(action(tree, "Entregar").disabled, false);
  action(tree, "Entregar").onPress();
  assert.equal(f.opened.length, 1); assert.equal(f.calls.length, 0);
  assert.ok(JSON.stringify(tree).includes("Conflicto"));
  assert.ok(elements<{ label: string }>(tree, "Badge").some((badge) => badge.props.label === "Pendiente"));
  f.hooks.unmount();
});

async function commentsFixture() {
  const hooks = reactFixture(); const memory = memoryDraftStorage();
  const drafts = uiModule<typeof import("../src/screens/workDetail/files/WorkspaceDraftStore")>("screens/workDetail/files/WorkspaceDraftStore.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "expo-file-system": {},
  });
  const module = uiModule<{ CommentsTab: Wrapped<CommentsTabProps> }>("screens/workDetail/CommentsTab.tsx", hooks, { "./files/WorkspaceDraftStore": drafts });
  const store = new drafts.WorkspaceDraftStore("comment-ui", "live");
  const localDrafts = { ...drafts, useWorkspaceDraft: () => ({ ...store.getSnapshot(), store }) };
  const bound = uiModule<typeof module>("screens/workDetail/CommentsTab.tsx", hooks, { "./files/WorkspaceDraftStore": localDrafts });
  const commits: ReturnType<typeof deferred<void>>[] = []; const submitted: string[] = []; let loads = 0;
  const history = deferred<CommentPage>();
  const props: CommentsTabProps = { scopeKey: "comment-ui", mode: "live", busy: false, offlineReady: true, pending: [],
    onLoad: () => { loads++; return history.promise; },
    onSubmit: async (text) => { submitted.push(text); const commit = deferred<void>(); commits.push(commit); await commit.promise; },
  };
  await settle();
  const render = () => renderWrapped(hooks, bound.CommentsTab, props);
  render(); await settle();
  return { hooks, store, memory, props, render, commits, submitted, history, loads: () => loads };
}

test("comments clear only after commit, accept distinct text and reject duplicate queued text without waiting for history", async () => {
  const f = await commentsFixture();
  await f.store.setText("Primer comentario");
  const send = action(f.render(), "Guardar comentario · sincronizar"); send.onPress(); send.onPress(); await settle();
  assert.equal(f.submitted.length, 1); assert.equal(f.store.getSnapshot().text, "Primer comentario");
  f.commits[0].reject(queued("comment")); await settle();
  assert.equal(f.store.getSnapshot().commentBusy, false); assert.equal(f.store.getSnapshot().text, "");
  assert.equal(f.loads(), 1, "queue does not wait or trigger a full history reload");
  await f.store.setText("Primer comentario");
  assert.equal(action(f.render(), "Guardar comentario · sincronizar").disabled, true);
  send.onPress(); await settle(); assert.equal(f.submitted.length, 1);
  await f.store.setText("Segundo comentario");
  action(f.render(), "Guardar comentario · sincronizar").onPress(); await settle();
  assert.equal(f.submitted[1], "Segundo comentario");
  f.commits[1].reject(queued("comment", "00000000-0000-4000-8000-000000000002")); await settle();
  assert.equal(f.store.getSnapshot().text, ""); f.hooks.unmount();
});

test("queued comment cleanup failures preserve sent marker, prevent resubmission and permit explicit draft retry", async () => {
  const f = await commentsFixture(); await f.store.setText("Conservar");
  action(f.render(), "Guardar comentario · sincronizar").onPress(); await settle();
  f.memory.control.failSentMarker = true; f.commits[0].reject(queued("comment")); await settle();
  assert.equal(f.store.getSnapshot().text, "Conservar");
  assert.equal(f.store.getSnapshot().confirmedText, "Conservar");
  assert.ok(f.store.getSnapshot().error);
  action(f.render(), "Guardar comentario · sincronizar").onPress(); await settle(); assert.equal(f.submitted.length, 1);
  f.memory.control.failSentMarker = false; action(f.render(), "Reintentar borrador").onPress(); await settle();
  assert.equal(f.store.getSnapshot().text, ""); assert.equal(f.store.getSnapshot().error, null); f.hooks.unmount();
});

test("failed comment commit keeps draft, new typing during in-flight queue survives, unmounted actions do not submit", async () => {
  const f = await commentsFixture(); await f.store.setText("Falla");
  action(f.render(), "Guardar comentario · sincronizar").onPress(); await settle();
  f.commits[0].reject(new Error("QUEUE_COMMIT_FAILED")); await settle();
  assert.equal(f.store.getSnapshot().text, "Falla"); assert.equal(f.store.getSnapshot().confirmedText, null);
  action(f.render(), "Guardar comentario · sincronizar").onPress(); await settle();
  await f.store.setText("Nuevo borrador"); f.commits[1].reject(queued("comment")); await settle();
  assert.equal(f.store.getSnapshot().text, "Nuevo borrador");
  const retained = action(f.render(), "Guardar comentario · sincronizar"); f.hooks.unmount(); retained.onPress(); await settle();
  assert.equal(f.submitted.length, 2);
});

async function checklistFixture() {
  const hooks = reactFixture();
  const module = uiModule<{ ChecklistAssociationPanel: Wrapped<ChecklistAssociationPanelProps> }>("screens/workDetail/checklist/ChecklistAssociationPanel.tsx", hooks);
  const candidate = work({ status: "pending" }); const commit = deferred<ChecklistAssignmentResult>(); let attaches = 0; let refreshes = 0;
  const catalog: ChecklistCatalogPage = { page: 0, pageSize: 20, hasMore: false, items: [{ id: 25, name: "Lista guardada", code: "LOCAL", description: null, alreadyAssigned: false }] };
  const props: ChecklistAssociationPanelProps = { storageKey: "checklist-ui", group: group({ works: [candidate] }), work: candidate, mode: "live", online: false, busy: false, pending: [], offlineReady: true,
    loadOptions: async () => catalog, attach: () => { attaches++; return commit.promise; }, onAttached: async () => { refreshes++; await new Promise<void>(() => {}); } };
  const render = () => renderWrapped(hooks, module.ChecklistAssociationPanel, props);
  render(); action(render(), "Agregar checklist").onPress(); await settle();
  elements<UiAction>(render(), "Pressable")[0].props.onPress();
  return { hooks, props, commit, render, attaches: () => attaches, refreshes: () => refreshes };
}

test("cached checklist selection closes after durable queue, no refresh wait or invented steps, duplicate disabled", async () => {
  const f = await checklistFixture(); const before = JSON.stringify(f.props.work);
  const confirm = action(f.render(), "Confirmar asociación"); confirm.onPress(); confirm.onPress();
  assert.equal(f.attaches(), 1); assert.equal(action(f.render(), "Cancelar").disabled, true);
  f.commit.reject(queued("checklist")); await settle();
  assert.equal(f.refreshes(), 0); assert.equal(action(f.render(), "Agregar checklist").disabled, false);
  assert.ok(JSON.stringify(f.render()).includes("asociación en cola"));
  assert.equal(elements(f.render(), "Field").length, 0);
  confirm.onPress(); assert.equal(f.attaches(), 1);
  action(f.render(), "Agregar checklist").onPress(); await settle();
  assert.equal(elements<UiAction>(f.render(), "Pressable")[0].props.disabled, true);
  assert.equal(JSON.stringify(f.props.work), before); f.hooks.unmount();
});

test("checklist queue failure preserves selection, and read-only or unmounted callbacks cannot attach", async () => {
  const f = await checklistFixture(); action(f.render(), "Confirmar asociación").onPress(); f.commit.reject(new Error("LOCAL_STORAGE_FAILED")); await settle();
  assert.equal(action(f.render(), "Confirmar asociación").disabled, false);
  assert.ok(JSON.stringify(f.render()).includes("LOCAL_STORAGE_FAILED"));
  const retained = action(f.render(), "Confirmar asociación"); f.props.readOnly = true; f.render(); retained.onPress();
  assert.equal(f.attaches(), 1); f.hooks.unmount(); retained.onPress(); assert.equal(f.attaches(), 1);
  assert.equal(checklistAssociationBlocked(f.props.group, f.props.work, false), null);
  assert.ok(checklistAssociationBlocked(f.props.group, { ...f.props.work, status: "delivered" }, false));
  assert.ok(checklistAssociationBlocked(f.props.group, f.props.work, false, true));
});

test("files release busy after durable copy/ownership, keep stable IDs and reload only after applied revision", async () => {
  const hooks = reactFixture(); const memory = memoryDraftStorage();
  const drafts = uiModule<typeof import("../src/screens/workDetail/files/WorkspaceDraftStore")>("screens/workDetail/files/WorkspaceDraftStore.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "expo-file-system": {},
  });
  const store = new drafts.WorkspaceDraftStore("files-ui", "live"); await settle();
  await store.addFiles([{ uri: "memory:synthetic", name: "evidence.txt", mimeType: "text/plain", size: 4, blob: new Blob(["test"], { type: "text/plain" }) }]);
  const original = store.getSnapshot().files[0];
  const commit = deferred<void>(); const uploaded: LocalPhoto[][] = []; let loads = 0;
  const files = deferred<Attachment[]>();
  const module = uiModule<{ FileWorkspace: Wrapped<FileWorkspaceProps> }>("screens/workDetail/FileWorkspace.tsx", hooks, {
    "./files/WorkspaceDraftStore": { ...drafts, useWorkspaceDraft: () => ({ ...store.getSnapshot(), store }) },
    "./files/filePicker": {}, "./files/WorkspaceFileList": { PendingFileList: "PendingFileList", SavedFileList: "SavedFileList" },
  });
  const props: FileWorkspaceProps = { scopeKey: "files-ui", mode: "live", readOnly: false, offline: uiSnapshot(), pending: [],
    onLoad: () => { loads++; return files.promise; }, onUpload: async (batch) => { uploaded.push(batch); await commit.promise; } };
  const render = (): ReactNode => renderWrapped(hooks, module.FileWorkspace, props);
  render(); action(render(), "Guardar archivos · 1").onPress(); action(render(), "Guardar archivos · 1").onPress(); await settle();
  assert.equal(uploaded.length, 1); assert.equal(uploaded[0][0].id, original.id);
  assert.equal(store.getSnapshot().fileBusy, true); assert.equal(store.getSnapshot().files.length, 1);
  const operation: Extract<OfflineOperation, { kind: "document" }> = { ...uiOperation, kind: "document", sourceDraftId: original.id,
    file: { id: "00000000-0000-4000-8000-000000000004", namespace: "synthetic", name: original.name, mimeType: original.mimeType, size: original.size, sha256: "a".repeat(64) } };
  props.offline = uiSnapshot([operation]); props.pending = [operation];
  commit.reject(queued("document")); await settle();
  assert.equal(store.getSnapshot().fileBusy, false); assert.equal(store.getSnapshot().files.length, 0);
  assert.equal(loads, 1); assert.equal(elements(render(), "OfflineFileCard").length, 1);
  props.offline = uiSnapshot([{ ...operation, status: "applied" }]); props.pending = []; render();
  assert.equal(loads, 2, "background list refresh after applied revision");
  const retained = action(render(), "Guardar archivos · 0"); hooks.unmount(); retained.onPress(); await settle();
  assert.equal(uploaded.length, 1);
});

test("file queue failure retains original draft bytes and ID, and auth gates retained upload callbacks", async () => {
  const hooks = reactFixture(); const memory = memoryDraftStorage();
  const drafts = uiModule<typeof import("../src/screens/workDetail/files/WorkspaceDraftStore")>("screens/workDetail/files/WorkspaceDraftStore.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "expo-file-system": {},
  });
  const store = new drafts.WorkspaceDraftStore("files-failure-ui", "live"); await settle();
  await store.addFiles([{ uri: "memory:synthetic", name: "evidence.txt", blob: new Blob(["test"], { type: "text/plain" }) }]);
  const original = store.getSnapshot().files[0]; let sends = 0;
  const module = uiModule<{ FileWorkspace: Wrapped<FileWorkspaceProps> }>("screens/workDetail/FileWorkspace.tsx", hooks, {
    "./files/WorkspaceDraftStore": { ...drafts, useWorkspaceDraft: () => ({ ...store.getSnapshot(), store }) },
    "./files/filePicker": {}, "./files/WorkspaceFileList": { PendingFileList: "PendingFileList", SavedFileList: "SavedFileList" },
  });
  const props: FileWorkspaceProps = { scopeKey: "files-failure-ui", mode: "live", readOnly: false, offline: uiSnapshot(), pending: [],
    onLoad: async () => [], onUpload: async () => { sends++; throw new Error("DURABLE_QUEUE_FAILED"); } };
  const render = () => renderWrapped(hooks, module.FileWorkspace, props);
  render(); await settle();
  const send = action(render(), "Guardar archivos · 1"); send.onPress(); await settle();
  assert.equal(sends, 1); assert.equal(store.getSnapshot().fileBusy, false);
  assert.equal(store.getSnapshot().files[0].id, original.id); assert.equal(store.getSnapshot().files[0].uri, original.uri);
  assert.equal(store.getSnapshot().files[0].uploaded, false);
  assert.ok(JSON.stringify(render()).includes("DURABLE_QUEUE_FAILED"));
  props.offline = { ...uiSnapshot(), authBlocked: true }; render(); send.onPress(); await settle(); assert.equal(sends, 1);
  props.offline = uiSnapshot(); render(); hooks.unmount(); send.onPress(); await settle(); assert.equal(sends, 1);
  await store.removeFile(original.id);
});