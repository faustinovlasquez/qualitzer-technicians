import { z } from "zod";
import type { Assignments, AssignmentWork, User, WorkScope } from "../domain/models";
import { OfflineUnavailableError, type OfflineOperation, type TimerReadAssignmentWork } from "../domain/offline";
import { checklistAssignmentInputSchema, checklistCatalogPageSchema, checklistCatalogQuerySchema, type ChecklistCatalogQuery } from "../domain/checklistAssignment";
import { syncScopeSchema, syncTimerPayloadSchema } from "../domain/offlineProtocol";
import { executionElapsedSeconds } from "../domain/workExecution";
import type { OfflineState } from "./contracts";
import { cachedAssignmentsSchema, sameResource } from "./cacheSchemas";

export const canonicalIntentionScopeSchema = syncScopeSchema.transform((scope) => ({ ...scope, workId: scope.workId === undefined ? "" : String(scope.workId) }))
  .refine((scope) => /^[1-9]\d*$/.test(scope.workId) && scope.startDate === scope.endDate
    && (!scope.groupId.startsWith("direct-") || scope.groupId.split("-").at(-1) === scope.workId));
export const timerPayloadSchema = syncTimerPayloadSchema;

export function localTimerElapsedSeconds(timer: Extract<OfflineOperation, { kind: "timer" }>, now: number): number | null {
  if (!timer.localClock || !timer.payload.recordedAt) return null;
  const running = timer.payload.status === "in_progress" && ["pending", "syncing", "applied"].includes(timer.status);
  return timer.localClock.elapsedSeconds + (running ? Math.max(0, Math.floor((now - Date.parse(timer.payload.recordedAt)) / 1000)) : 0);
}

export function checklistCatalogCachePrefix(scope: WorkScope): string {
  return `checklist-options:${JSON.stringify([scope.companyBranchId, scope.groupId, scope.workId, scope.startDate, scope.endDate])}:`;
}
export function checklistCatalogCacheKey(scope: WorkScope, query: ChecklistCatalogQuery): string {
  const parsed = checklistCatalogQuerySchema.parse(query);
  return `${checklistCatalogCachePrefix(scope)}${JSON.stringify([parsed.search, parsed.page])}`;
}
function sameIntentionScope(left: WorkScope, right: WorkScope): boolean {
  return sameResource(left, right) && left.startDate === right.startDate && left.endDate === right.endDate;
}
export function assignmentsWithTimerRead(data: Assignments, date: string, branchId: number, appliedOperationIds?: readonly string[]): Assignments {
  if (!appliedOperationIds) return data;
  return { ...data, groups: data.groups.map((group) => ({ ...group, works: group.works.map((work): TimerReadAssignmentWork => ({ ...work,
    offlineTimerRead: { scope: { groupId: group.id, workId: work.id, companyBranchId: branchId, startDate: date, endDate: date }, appliedOperationIds: [...appliedOperationIds] },
  })) })) };
}
export function timerReconciledWithWork(operation: Extract<OfflineOperation, { kind: "timer" }>, work?: AssignmentWork): boolean {
  if (operation.status !== "applied" || !work || work.id !== operation.scope.workId || !("offlineTimerRead" in work)) return false;
  const read = z.object({ scope: canonicalIntentionScopeSchema, appliedOperationIds: z.array(z.string()) }).safeParse(work.offlineTimerRead);
  return read.success && sameIntentionScope(operation.scope, read.data.scope) && read.data.appliedOperationIds.includes(operation.id);
}
function executableWork(state: OfflineState, scope: WorkScope, user: User, branchId: number): AssignmentWork {
  canonicalIntentionScopeSchema.parse(scope);
  if (scope.companyBranchId !== branchId) throw new OfflineUnavailableError("OFFLINE_BRANCH_NAMESPACE_MISMATCH");
  if (state.authBlocked || !user.accessBranchs.some((branch) => branch.id === branchId && branch.isEnabled !== false && branch.isDeleted !== true)) throw new OfflineUnavailableError("OFFLINE_AUTH_REQUIRED");
  const key = `assignments:${scope.startDate}`;
  const resourcePrefixes = ["files", "comments"].flatMap((kind) => [scope.workId, null].map((workId) => `${kind}:${JSON.stringify([branchId, scope.groupId, workId]).slice(0, -1)},`));
  if (state.revokedResources.some((entry) => entry.key === key || resourcePrefixes.some((prefix) => entry.key.startsWith(prefix)))) throw new OfflineUnavailableError("OFFLINE_RESOURCE_ACCESS_REVOKED");
  const cached = state.cache.find((entry) => entry.key === key);
  if (!cached) throw new OfflineUnavailableError("OFFLINE_WORK_SNAPSHOT_REQUIRED");
  if (cached.coverage && (cached.coverage.branchId !== branchId || cached.coverage.date !== scope.startDate)) throw new OfflineUnavailableError("OFFLINE_CACHE_SCOPE_MISMATCH");
  const data = cachedAssignmentsSchema.parse(JSON.parse(cached.json));
  if (user.workerId === null || data.technician.id !== user.workerId) throw new OfflineUnavailableError("OFFLINE_CACHE_IDENTITY_MISMATCH");
  const groups = data.groups.filter((group) => group.id === scope.groupId);
  const works = groups.flatMap((group) => group.works.filter((work) => work.id === scope.workId));
  if (groups.length !== 1 || works.length !== 1) throw new OfflineUnavailableError("OFFLINE_WORK_SNAPSHOT_REQUIRED");
  const work = works[0]!;
  if (!work.canExecute || work.status === "completed" || work.status === "delivered") throw new OfflineUnavailableError("OFFLINE_WORK_NOT_EXECUTABLE");
  return work;
}
function assertSafeDependency(operation: OfflineOperation, operations: readonly OfflineOperation[], visited = new Set<string>()): void {
  if (visited.has(operation.id) || !["pending", "syncing", "applied"].includes(operation.status)
    || operation.receipt && operation.receipt.state !== "applied"
    || operation.lastError === "MOBILE_SYNC_OPERATION_REUSED") throw new OfflineUnavailableError("OFFLINE_REVIEW_REQUIRED");
  visited.add(operation.id);
  if (!operation.dependencyId) return;
  const parent = operations.find((entry) => entry.id === operation.dependencyId);
  if (!parent) throw new OfflineUnavailableError("OFFLINE_DEPENDENCY_UNRESOLVED");
  assertSafeDependency(parent, operations, visited);
}

export function prepareQueuedIntention(state: OfflineState, input: Extract<OfflineOperation, { kind: "timer" | "checklist" }>, user: User, branchId: number): OfflineOperation {
  const scope = canonicalIntentionScopeSchema.parse(input.scope);
  const work = executableWork(state, scope, user, branchId);
  if (input.kind === "timer") {
    const payload = timerPayloadSchema.parse(input.payload);
    const timers = state.operations.filter((entry): entry is Extract<OfflineOperation, { kind: "timer" }> => entry.kind === "timer" && sameIntentionScope(entry.scope, scope));
    for (const timer of timers) assertSafeDependency(timer, state.operations);
    const previous = timers.at(-1);
    if (previous?.status !== "applied" && previous?.payload.status === payload.status) return previous;
    const readIds = state.cache.find((entry) => entry.key === `assignments:${scope.startDate}`)?.timerReadOperationIds;
    const reconciled = previous?.status === "applied" && readIds?.includes(previous.id) === true;
    const baseStatus = previous && !reconciled ? previous.payload.status : work.status;
    if (baseStatus === "completed" || baseStatus === "delivered" || (payload.status === "paused" && baseStatus !== "in_progress")) throw new OfflineUnavailableError("OFFLINE_TIMER_INVALID_TRANSITION");
    if (previous?.payload.recordedAt && Date.parse(previous.payload.recordedAt) > input.createdAt) throw new OfflineUnavailableError("OFFLINE_TIMER_CLOCK_CHANGED");
    const cached = state.cache.find(entry => entry.key === `assignments:${scope.startDate}`)!;
    const data = cachedAssignmentsSchema.parse(JSON.parse(cached.json));
    const elapsedSeconds = previous && !reconciled ? localTimerElapsedSeconds(previous, input.createdAt) ?? executionElapsedSeconds(work, data.generatedAt, input.createdAt)
      : executionElapsedSeconds(work, data.generatedAt, input.createdAt);
    return { ...input, scope, payload: { status: payload.status, baseStatus, recordedAt: new Date(input.createdAt).toISOString(), observedAt: data.generatedAt,
      ...(previous?.payload.recordedAt && !reconciled ? { previousOperationId: previous.id } : {}) }, localClock: { elapsedSeconds }, dependencyId: previous?.id };
  }
  const payload = checklistAssignmentInputSchema.parse(input.payload);
  const prefix = checklistCatalogCachePrefix(scope);
  if (state.revokedResources.some((entry) => entry.key.startsWith(prefix))) throw new OfflineUnavailableError("OFFLINE_RESOURCE_ACCESS_REVOKED");
  const previous = state.operations.find((entry) => entry.kind === "checklist" && entry.status !== "applied"
    && entry.payload.checklistId === payload.checklistId && sameIntentionScope(entry.scope, scope));
  if (previous) { assertSafeDependency(previous, state.operations); return previous; }
  const candidates = state.cache.filter((entry) => entry.key.startsWith(prefix)).sort((left, right) => right.fetchedAt - left.fetchedAt);
  for (const entry of candidates) {
    const page = checklistCatalogPageSchema.parse(JSON.parse(entry.json));
    const option = page.items.find((item) => item.id === payload.checklistId);
    if (!option) continue;
    if (option.alreadyAssigned) throw new OfflineUnavailableError("OFFLINE_CHECKLIST_ALREADY_ASSIGNED");
    return { ...input, scope, payload, dependencyId: undefined };
  }
  throw new OfflineUnavailableError("OFFLINE_CHECKLIST_OPTION_REQUIRED");
}