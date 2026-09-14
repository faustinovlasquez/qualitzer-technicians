/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import type { AssignmentWork, StatusInput, WorkStatus } from "../src/domain/models";
import { assignmentDays, assignmentWorkForQueryDate, assignmentWorkQueryRange, assignmentWorkSnapshotForQueryDate, dailyRange, mergeDailyAssignments, type DailyAssignmentSnapshot } from "../src/domain/assignmentSchedule";
import type { TimerReadAssignmentWork } from "../src/domain/offline";
import type { AssignmentWorkCardProps } from "../src/screens/orders/AssignmentWorkCard";
import type { WorkDetailScreenProps } from "../src/screens/WorkDetailScreen";
import { pendingTimerForWork, type PendingTimer } from "../src/screens/offline/offlineUi";
import { assignments, group, work } from "../server/tests/fixtures";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import { reactFixture } from "./helpers/tenant-challenge";
import { action, deferred, elements, memoryDraftStorage, queued, renderWrapped, settle, uiModule, uiOperation, uiScope, uiSnapshot, type Wrapped } from "./helpers/durable-ui";

const start: PendingTimer = { ...uiOperation, kind: "timer", payload: { status: "in_progress", baseStatus: "pending" } };
const applied: PendingTimer = { ...start, status: "applied", receipt: { operationId: start.id, state: "applied" } };
const weekRange = { startDate: "2026-09-14", endDate: "2026-09-20" };
const weekScope = { ...uiScope, ...dailyRange(weekRange.startDate) };
const weekApplied: PendingTimer = { ...applied, scope: weekScope };
function weekSnapshots(fresh: boolean): DailyAssignmentSnapshot[] {
  const statuses: WorkStatus[] = [fresh ? "paused" : "pending", "pending", "in_progress", "paused", "completed", "delivered", "pending"];
  return assignmentDays(weekRange).map((date, index) => {
    const candidate: TimerReadAssignmentWork = { ...work({ scheduledDate: "2026-09-11", plannedDates: ["2026-09-11"],
      status: statuses[index], canExecute: index !== 1 && index !== 3, isOverdue: true, elapsedSeconds: index === 0 ? fresh ? 91 : 45 : 100 + index }),
      offlineTimerRead: { scope: { ...uiScope, ...dailyRange(date) }, appliedOperationIds: fresh && index === 0 ? [applied.id] : [] } };
    return { date, data: { ...assignments([group({ works: [candidate] })]), generatedAt: `2026-09-14T10:00:0${index}.000Z` } };
  });
}
function readWork(candidate: AssignmentWork, ids: string[] = [start.id]): TimerReadAssignmentWork {
  return { ...candidate, offlineTimerRead: { scope: uiScope, appliedOperationIds: ids } };
}
function clockProps(node: ReactNode): { pending?: boolean; work: AssignmentWork } | undefined {
  if (Array.isArray(node)) return node.map(clockProps).find((value) => value !== undefined);
  if (!isValidElement<{ children?: ReactNode; pending?: boolean; work: AssignmentWork }>(node)) return undefined;
  if (typeof node.type === "function" && ["WorkExecution", "ElapsedTimer"].includes(node.type.name)) return node.props;
  return clockProps(node.props.children);
}
function cardFixture() {
  const hooks = reactFixture();
  const module = uiModule<{ AssignmentWorkCard: Wrapped<AssignmentWorkCardProps> }>("screens/orders/AssignmentWorkCard.tsx", hooks, {
    "./AssignmentMetadataRow": { AssignmentMetadataRow: "AssignmentMetadataRow" },
  });
  const candidate = work({ status: "pending", elapsedSeconds: 45 });
  const calls: StatusInput[] = []; const accepted = deferred<void>();
  const props: AssignmentWorkCardProps = { group: group({ works: [candidate] }), work: candidate, offline: uiSnapshot(), online: true,
    onOpenWork: () => {}, onWorkStatus: async (_group, _work, input) => { calls.push(input); await accepted.promise; } };
  const render = () => renderWrapped(hooks, module.AssignmentWorkCard, props);
  render();
  return { hooks, props, calls, accepted, render };
}

test("actual card keeps intent and freezes canonical elapsed across queued to applied before the fresh work prop", async () => {
  const f = cardFixture();
  try {
    const initial = action(f.render(), "Iniciar"); initial.onPress(); initial.onPress();
    assert.equal(f.calls.length, 1);
    f.accepted.reject(queued("timer")); await settle();
    f.props.offline = { ...uiSnapshot([start]), online: true };
    const pause = action(f.render(), "Pausar"); assert.equal(pause.disabled, false);
    f.props.offline = { ...uiSnapshot([applied]), online: true };
    const tree = f.render();
    assert.equal(action(tree, "Pausar").disabled, true);
    assert.equal(action(tree, "Entregar").disabled, false, "unproven applied intent allows review, not submission");
    initial.onPress(); pause.onPress(); action(tree, "Pausar").onPress();
    assert.equal(f.calls.length, 1, "old and current callbacks cannot repeat a confirmed operation");
    assert.equal(action(tree, "Pausar").title, "Pausar · Actualizando…");
    assert.ok(elements<{ label: string }>(tree, "Badge").some((badge) => badge.props.label === "Pendiente"));
    assert.equal(clockProps(tree)?.pending, true); assert.equal(clockProps(tree)?.work.elapsedSeconds, 45);
    f.props.work = readWork({ ...f.props.work, status: "paused", elapsedSeconds: 63 });
    const fresh = f.render();
    assert.equal(action(fresh, "Reanudar").disabled, false);
    assert.equal(action(fresh, "Entregar").disabled, false);
    assert.equal(clockProps(fresh)?.pending, false); assert.equal(clockProps(fresh)?.work.elapsedSeconds, 63);
    assert.ok(!JSON.stringify(fresh).includes("Actualizando…"));
  } finally { f.hooks.unmount(); }
});

test("read failure retains compact updating state without authorizing duplicate timer; supplied null cannot erase durable applied intent", () => {
  const f = cardFixture();
  try {
    f.props.pendingTimer = null;
    f.props.offline = { ...uiSnapshot([applied]), online: false, lastError: "OFFLINE_NETWORK_UNAVAILABLE" };
    const tree = f.render();
    assert.equal(action(tree, "Pausar").disabled, true);
    assert.equal(action(tree, "Pausar").title, "Pausar · Actualizando…");
    assert.ok(!JSON.stringify(tree).includes("No se pudo actualizar la ficha"));
    assert.equal(f.calls.length, 0);
  } finally { f.hooks.unmount(); }
});

test("overdue card uses query date for pending, applied reconciliation and delivery instead of scheduled date", () => {
  const f = cardFixture();
  try {
    const queryDate = "2026-09-02";
    const scope = { ...uiScope, startDate: queryDate, endDate: queryDate };
    const overdueStart: PendingTimer = { ...start, scope };
    f.props.queryDate = queryDate; f.props.companyBranchId = 1;
    f.props.work = { ...f.props.work, isOverdue: true };
    f.props.offline = { ...uiSnapshot([overdueStart]), online: true };
    const pending = f.render();
    assert.equal(action(pending, "Pausar").disabled, false);
    assert.equal(action(pending, "Entregar").disabled, false);
    assert.equal(clockProps(pending)?.pending, true);
    assert.equal(action(pending, "Pausar").title, "Pausar · Guardando…");
    const overdueApplied: PendingTimer = { ...overdueStart, status: "applied", receipt: applied.receipt };
    f.props.offline = { ...uiSnapshot([overdueApplied]), online: true };
    assert.equal(action(f.render(), "Pausar").disabled, true);
    f.props.work = readWork({ ...f.props.work, status: "paused" });
    assert.equal(action(f.render(), "Pausar").disabled, true, "scheduled-day read proof cannot reconcile the query-day timer");
    const fresh: TimerReadAssignmentWork = { ...f.props.work, offlineTimerRead: { scope, appliedOperationIds: [start.id] } };
    f.props.work = fresh;
    const reconciled = f.render();
    assert.equal(action(reconciled, "Reanudar").disabled, false);
    assert.equal(action(reconciled, "Entregar").disabled, false);
    assert.equal(clockProps(reconciled)?.pending, false);
    assert.equal(f.props.work.scheduledDate, uiScope.startDate);
  } finally { f.hooks.unmount(); }
});

test("overdue card never borrows timers from another query date, work, group or branch", () => {
  const f = cardFixture();
  try {
    const queryDate = "2026-09-02";
    const scope = { ...uiScope, startDate: queryDate, endDate: queryDate };
    f.props.queryDate = queryDate; f.props.companyBranchId = 1;
    for (const other of [uiScope, { ...scope, workId: "12" }, { ...scope, groupId: "external-11" }, { ...scope, companyBranchId: 2 }]) {
      f.props.offline = { ...uiSnapshot([{ ...start, scope: other }]), online: true };
      const tree = f.render();
      assert.equal(action(tree, "Iniciar").disabled, false);
      assert.equal(action(tree, "Entregar").disabled, false);
      assert.equal(clockProps(tree)?.pending, false);
    }
    const checklist = { ...uiOperation, scope, kind: "checklist" as const, payload: { checklistId: 17 } };
    f.props.offline = { ...uiSnapshot([checklist]), online: true };
    assert.equal(action(f.render(), "Entregar").disabled, false, "query-day checklist allows delivery review");
    f.props.offline = { ...uiSnapshot([{ ...uiOperation, scope: { ...scope, workId: undefined }, kind: "document",
      file: { id: "root-file", namespace: "ui", name: "proof.png", mimeType: "image/png", size: 10, sha256: "a".repeat(64) } }]), online: true };
    assert.equal(action(f.render(), "Entregar").disabled, false, "query-day root operation allows delivery review");
  } finally { f.hooks.unmount(); }
});

test("timer reconciliation requires exact displayed work, day, branch and applied causal marker", () => {
  const candidate = work({ status: "paused" });
  const snapshot = uiSnapshot([applied]);
  assert.equal(pendingTimerForWork(snapshot, uiScope, candidate)?.id, applied.id);
  assert.equal(pendingTimerForWork(snapshot, uiScope, readWork(candidate, []))?.id, applied.id);
  assert.equal(pendingTimerForWork(snapshot, uiScope, readWork(candidate)), null);
  for (const otherScope of [{ ...uiScope, companyBranchId: 2 }, { ...uiScope, workId: "12" },
    { ...uiScope, startDate: "2026-09-02", endDate: "2026-09-02" }, { ...uiScope, groupId: "maintenance-11" }]) {
    const different: TimerReadAssignmentWork = { ...candidate, offlineTimerRead: { scope: otherScope, appliedOperationIds: [applied.id] } };
    assert.equal(pendingTimerForWork(snapshot, uiScope, different)?.id, applied.id);
  }
  const later: PendingTimer = { ...start, id: "later", createdAt: 1, payload: { status: "paused", baseStatus: "in_progress" }, dependencyId: start.id };
  assert.equal(pendingTimerForWork(uiSnapshot([start, later]), uiScope, candidate)?.id, later.id, "durable order survives local clock rollback");
  assert.equal(pendingTimerForWork(uiSnapshot([{ ...applied, status: "needs_review" }]), uiScope, readWork(candidate))?.status, "needs_review");
});

test("retained timer callback cannot cross auth, unready, stale, or foreground locks", () => {
  const f = cardFixture();
  try {
    const retained = action(f.render(), "Iniciar");
    for (const snapshot of [null, { ...uiSnapshot(), authBlocked: true },
      { ...uiSnapshot(), connection: { status: "ready" as const, networkConnected: true, foreground: false, checkedAt: 1000 } }]) {
      f.props.offline = snapshot; f.render(); retained.onPress();
      assert.equal(f.calls.length, 0);
    }
    f.props.offline = uiSnapshot(); f.props.staleReadOnly = true; f.render(); retained.onPress();
    assert.equal(f.calls.length, 0);
  } finally { f.hooks.unmount(); }
});

async function detailFixture() {
  const hooks = reactFixture(); const memory = memoryDraftStorage();
  const drafts = uiModule<typeof import("../src/screens/workDetail/useWorkDraft")>("screens/workDetail/useWorkDraft.ts", hooks, {
    "@react-native-async-storage/async-storage": memory.storage, "./localPhotos": {},
  });
  const attachments = { files: [], error: null, loading: false, load: async () => {} };
  const module = uiModule<{ WorkDetailScreen: Wrapped<WorkDetailScreenProps> }>("screens/WorkDetailScreen.tsx", hooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./workDetail/ChecklistTab": { ChecklistTab: "ChecklistTab" }, "./workDetail/CompletionDialog": { CompletionDialog: "CompletionDialog" },
    "./workDetail/EvidenceTab": { EvidenceTab: "EvidenceTab" }, "./workDetail/localPhotos": { openLocalPhotoScope: () => {} },
    "./workDetail/useAttachmentFiles": { useAttachmentFiles: () => attachments }, "./workDetail/useWorkDraft": drafts,
    "./workDetail/WorkInformation": { EquipmentTab: "EquipmentTab", WorkTab: "WorkTab" }, "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
    "./workDetail/CommentsTab": { CommentsTab: "CommentsTab" }, "./offline/QueuedNotice": { QueuedNotice: "QueuedNotice" },
    "./workDetail/checklist/ChecklistAssociationPanel": { ChecklistAssociationPanel: "ChecklistAssociationPanel" },
  });
  const candidate = work({ status: "pending", elapsedSeconds: 45 }); let refreshes = 0; let mutations = 0;
  const unused = async (): Promise<never> => { throw new Error("UNEXPECTED_ACTION"); };
  const props: WorkDetailScreenProps = { tenant: { id: "timer-ui", name: "UI", portalOrigin: "https://ui.example.com", environment: "development" },
    branchName: "UI", group: group({ works: [candidate] }), work: candidate, generatedAt: "2026-09-01T10:00:00Z", mode: "live", range: uiScope,
    busy: false, error: null, storageKey: "timer-reconciliation-ui", initialTab: "work", allowEditExecutionTime: false, companyBranchId: 1,
    offline: { ...uiSnapshot([start]), online: true }, onBack: () => {},
    onRefresh: async () => { refreshes++; throw new Error("SNAPSHOT_READ_FAILED"); },
    onStatus: async () => { mutations++; throw queued("timer"); }, onSaveStep: unused,
    onLoadChecklistOptions: async () => ({ items: [], page: 0, pageSize: 20, hasMore: false }), onAttachChecklist: unused,
    onLoadFiles: async () => [], onLoadStepFiles: async () => [], onUpload: unused, onReport: unused, onUploadDocuments: unused, onDeleteFile: unused,
    onLoadComments: async () => ({ data: [], page: 0, pageSize: 20, totalRows: 0, totalPages: 0 }), onAddComment: unused,
  };
  const render = () => renderWrapped(hooks, module.WorkDetailScreen, props);
  render(); await settle(); render();
  return { hooks, props, render, refreshes: () => refreshes, mutations: () => mutations };
}

test("actual detail holds applied intent, allows manual refresh, shows failure, and accepts later external snapshot", async () => {
  const f = await detailFixture();
  try {
    const pause = action(f.render(), "Pausar trabajo"); assert.equal(pause.disabled, false);
    f.props.offline = { ...uiSnapshot([applied]), online: true };
    const waiting = f.render(); pause.onPress(); action(waiting, "Pausar trabajo").onPress(); await settle();
    assert.equal(f.mutations(), 0); assert.equal(action(waiting, "Pausar trabajo").disabled, true);
    assert.equal(action(waiting, "Entregar trabajo").disabled, false);
    action(waiting, "Entregar trabajo").onPress();
    assert.equal(elements<{ canSubmit: boolean }>(f.render(), "CompletionDialog")[0].props.canSubmit, false);
    assert.equal(clockProps(waiting)?.pending, true); assert.equal(clockProps(waiting)?.work.elapsedSeconds, 45);
    const refresh = action(waiting, "Actualizar asignación y evidencias"); assert.equal(refresh.disabled, false);
    refresh.onPress(); await settle(); assert.equal(f.refreshes(), 1);
    assert.ok(JSON.stringify(f.render()).includes("SNAPSHOT_READ_FAILED"));
    assert.equal(action(f.render(), "Pausar trabajo").disabled, true);
    f.props.work = readWork({ ...f.props.work, status: "paused", elapsedSeconds: 72 });
    const fresh = f.render(); assert.equal(action(fresh, "Reanudar trabajo").disabled, false);
    assert.equal(clockProps(fresh)?.pending, false); assert.equal(clockProps(fresh)?.work.elapsedSeconds, 72);
    f.props.offline = { ...uiSnapshot([applied]), online: true, connection: { status: "ready", networkConnected: true, foreground: false, checkedAt: 1 } };
    const retained = action(fresh, "Reanudar trabajo"); f.render(); retained.onPress(); await settle();
    assert.equal(f.mutations(), 0);
  } finally { f.hooks.unmount(); }
});

test("merged seven-query overdue work preserves display counts and every query's complete canonical version", () => {
  const snapshots = weekSnapshots(true);
  const before = structuredClone(snapshots);
  const merged = mergeDailyAssignments(snapshots, weekRange.startDate);
  const candidate = merged.groups[0].works[0];
  assert.equal(merged.groups.length, 1); assert.equal(merged.summary.totalWorks, 1);
  assert.equal(merged.summary.plannedMinutes, 60); assert.equal(candidate.schedules?.length, 1);
  assert.equal(candidate.schedules?.[0].date, "2026-09-20", "existing display preference remains unchanged");
  assert.equal(candidate.status, "pending"); assert.equal(candidate.elapsedSeconds, 106);
  assert.equal(candidate.schedules?.[0].dailyVersions?.length, 7);
  assert.deepEqual(assignmentWorkQueryRange(candidate, weekRange), dailyRange("2026-09-14"));
  for (const source of snapshots) {
    const version = assignmentWorkForQueryDate(candidate, source.date);
    assert.ok(version);
    const original = source.data.groups[0].works[0];
    assert.equal(version.status, original.status); assert.equal(version.canExecute, original.canExecute);
    assert.equal(version.elapsedSeconds, original.elapsedSeconds);
    assert.deepEqual((version as TimerReadAssignmentWork).offlineTimerRead, (original as TimerReadAssignmentWork).offlineTimerRead);
    assert.equal(assignmentWorkSnapshotForQueryDate(candidate, source.date)?.generatedAt, source.data.generatedAt);
  }
  assert.deepEqual(snapshots, before, "selection never mutates or transfers read proof between source snapshots");
  assert.equal(pendingTimerForWork(uiSnapshot([weekApplied]), weekScope, candidate)?.id, applied.id);
  assert.equal(pendingTimerForWork(uiSnapshot([weekApplied]), weekScope, assignmentWorkForQueryDate(candidate, "2026-09-14")), null);
});

test("exact scheduled-day preference and future, missing, legacy and newer unproven query versions remain isolated", () => {
  const snapshots = weekSnapshots(true);
  for (const snapshot of snapshots) snapshot.data.groups[0].works[0].scheduledDate = "2026-09-16";
  const candidate = mergeDailyAssignments(snapshots, weekRange.startDate).groups[0].works[0];
  assert.equal(candidate.schedules?.[0].date, "2026-09-16"); assert.equal(candidate.status, "in_progress");
  assert.equal(assignmentWorkForQueryDate(candidate, "2026-09-20")?.status, "pending");
  assert.equal(assignmentWorkForQueryDate(candidate, "2030-01-15"), undefined);
  const legacy = structuredClone(candidate); delete legacy.schedules![0].dailyVersions;
  assert.equal(assignmentWorkForQueryDate(legacy, "2026-09-14"), undefined, "queryDates alone are not canonical data");
  assert.equal(assignmentWorkForQueryDate(legacy, "2026-09-16")?.status, "in_progress");
  const newer = weekSnapshots(false)[0]; newer.data.generatedAt = "2026-09-14T11:00:00Z";
  const refreshed = mergeDailyAssignments([...weekSnapshots(true), newer], weekRange.startDate).groups[0].works[0];
  const exact = assignmentWorkForQueryDate(refreshed, weekRange.startDate);
  assert.equal(exact?.elapsedSeconds, 45);
  assert.equal(pendingTimerForWork(uiSnapshot([weekApplied]), weekScope, exact)?.id, applied.id, "a later unproven read must not inherit an older proof");
  const missing = mergeDailyAssignments(weekSnapshots(true).slice(1), weekRange.startDate).groups[0].works[0];
  assert.equal(assignmentWorkForQueryDate(missing, weekRange.startDate), undefined);
});

test("actual card reconciles day 14 only after all seven fresh reads and uses exact timestamp, status and permissions on other query days", () => {
  const f = cardFixture();
  try {
    f.props.queryDate = weekScope.startDate; f.props.companyBranchId = 1;
    f.props.work = mergeDailyAssignments(weekSnapshots(false), weekRange.startDate).groups[0].works[0];
    f.props.offline = { ...uiSnapshot([weekApplied]), online: true };
    const waiting = f.render();
    assert.equal(action(waiting, "Pausar").disabled, true); assert.equal(clockProps(waiting)?.work.elapsedSeconds, 45);
    const retained = action(waiting, "Pausar");
    f.props.work = mergeDailyAssignments(weekSnapshots(true), weekRange.startDate).groups[0].works[0];
    const fresh = f.render();
    assert.equal(action(fresh, "Reanudar").disabled, false); assert.equal(action(fresh, "Entregar").disabled, false);
    assert.equal(clockProps(fresh)?.pending, false); assert.equal(clockProps(fresh)?.work.elapsedSeconds, 91);
    const wrapper = uiModule<{ AssignmentWorkCard: Wrapped<AssignmentWorkCardProps> }>("screens/orders/AssignmentWorkCard.tsx", f.hooks, {
      "./AssignmentMetadataRow": { AssignmentMetadataRow: "AssignmentMetadataRow" },
    });
    assert.equal(wrapper.AssignmentWorkCard(f.props).props.generatedAt, "2026-09-14T10:00:00.000Z");
    retained.onPress(); assert.equal(f.calls.length, 0, "retained pause must not reverse the newer authoritative pause");
    f.props.queryDate = "2026-09-15";
    assert.equal(action(f.render(), "Iniciar").disabled, true, "query-specific canExecute is retained");
    f.props.queryDate = "2026-09-16";
    assert.equal(action(f.render(), "Pausar").disabled, false); assert.equal(clockProps(f.render())?.work.elapsedSeconds, 102);
    f.props.queryDate = "2026-09-19";
    assert.ok(JSON.stringify(f.render()).includes("entregado"));
    f.props.queryDate = "2030-01-15";
    assert.equal(action(f.render(), "Iniciar").disabled, true); assert.equal(action(f.render(), "Entregar").disabled, false);
    f.props.queryDate = weekScope.startDate;
    f.props.work = mergeDailyAssignments(weekSnapshots(false), weekRange.startDate).groups[0].works[0];
    f.props.offline = { ...uiSnapshot([weekApplied]), lastError: "OFFLINE_NETWORK_UNAVAILABLE" };
    assert.equal(action(f.render(), "Pausar").disabled, true);
    assert.equal(action(f.render(), "Pausar").title, "Pausar · Actualizando…");
  } finally { f.hooks.unmount(); }
});

test("actual hook and detail render the exact merged week query after applied refresh, reject missing versions and retain security gates", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture({ online: true }); t.after(() => f.unmount());
  const ui = await detailFixture(); t.after(() => ui.hooks.unmount());
  let app = await f.loadDay(); app.setTab("agenda"); app = await f.flush();
  app.changeRange(weekRange); await f.flush();
  f.reads.at(-1)!.resolve(mergeDailyAssignments(weekSnapshots(false), weekRange.startDate)); app = await f.flush();
  const selectedGroup = app.data!.groups[0]; app.openWork(selectedGroup, selectedGroup.works[0]); app = await f.flush();
  assert.equal(app.detailRange.startDate, "2026-09-14"); assert.equal(app.canonicalDetailWork?.elapsedSeconds, 45);
  const selection = app.selected;
  f.wrappers[0].update({ operations: [weekApplied] }); app = await f.flush();
  ui.props.range = app.detailRange; ui.props.work = app.canonicalDetailWork!; ui.props.generatedAt = app.detailGeneratedAt; ui.props.offline = app.offline;
  assert.equal(action(ui.render(), "Pausar trabajo").disabled, true);
  f.reads.at(-1)!.reject(new Error("WEEK_READ_FAILED")); app = await f.flush();
  assert.equal(app.canonicalDetailWork?.elapsedSeconds, 45);
  assert.ok(pendingTimerForWork(app.offline, weekScope, app.canonicalDetailWork));
  const refreshing = app.refresh(); await f.flush();
  f.reads.at(-1)!.resolve(mergeDailyAssignments(weekSnapshots(true), weekRange.startDate)); await refreshing; app = await f.flush();
  assert.deepEqual(app.selected, selection); assert.equal(app.canonicalDetailWork?.status, "paused");
  assert.equal(app.canonicalDetailWork?.elapsedSeconds, 91); assert.equal(app.detailGeneratedAt, "2026-09-14T10:00:00.000Z");
  ui.props.work = app.canonicalDetailWork!; ui.props.generatedAt = app.detailGeneratedAt; ui.props.offline = app.offline;
  const rendered = ui.render();
  assert.equal(action(rendered, "Reanudar trabajo").disabled, false); assert.equal(clockProps(rendered)?.pending, false);
  assert.equal(clockProps(rendered)?.work.elapsedSeconds, 91);
  const retained = app.changeStatus;
  f.access.allowed = false; await f.flush();
  await assert.rejects(async () => retained({ status: "in_progress" })); assert.equal(f.calls.statuses, 0);
  f.access.allowed = true; app = await f.flush();
  const pending = app.refresh(); await f.flush();
  const partial = mergeDailyAssignments(weekSnapshots(true), weekRange.startDate);
  partial.groups[0].works[0].schedules![0].dailyVersions = partial.groups[0].works[0].schedules![0].dailyVersions!.filter((version) => version.date !== "2026-09-14");
  f.reads.at(-1)!.resolve(partial); await pending; app = await f.flush();
  assert.equal(app.canonicalDetailWork, undefined, "no alternate day can replace a missing selected query");
  await assert.rejects(async () => app.changeStatus({ status: "in_progress" }), /ya no está disponible/);
  assert.equal(f.calls.statuses, 0);
});