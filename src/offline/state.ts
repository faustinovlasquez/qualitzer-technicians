import { z } from "zod";
import { creationInputSchema, creationResultSchema } from "../domain/creation";
import { OfflineUnavailableError, type OfflineOperation } from "../domain/offline";
import type { CacheEntry, DurableStore, OfflineState } from "./contracts";
import { OFFLINE_LIMITS } from "./contracts";
import { syncAnswerSchema, syncAnswerFromStep, toSyncAnswer } from "../domain/offlineProtocol";
import { answerFromStep } from "../domain/format";
import { cachedAssignmentsSchema, resourceCacheKey, sameResource } from "./cacheSchemas";

const choice = z.object({ value: z.string(), label: z.string() });
const uiAnswer = z.object({ responseValue: z.union([z.string(), z.boolean(), z.array(choice), z.null()]), isCompleted: z.boolean(), executionStatus: z.enum(["completed", "partial", "not_completed"]).nullable(), comment: z.string().nullable() }).strict();
const answer = z.union([uiAnswer, syncAnswerSchema]);
const scope = z.object({ groupId: z.string(), workId: z.string().optional(), startDate: z.string(), endDate: z.string(), companyBranchId: z.number() });
const workScope = scope.extend({ workId: z.string() });
const fileSchema = z.object({ id: z.string(), namespace: z.string(), name: z.string(), mimeType: z.string(), size: z.number(), sha256: z.string() });
export const receiptSchema = z.object({ operationId: z.string(), state: z.enum(["applied", "conflict", "rejected", "needs_review"]), error: z.string().optional(), fileId: z.union([z.string(), z.number()]).optional() });
const common = z.object({ id: z.string(), createdAt: z.number(), status: z.enum(["pending", "syncing", "applied", "blocked", "auth_required", "needs_review", "conflict"]), attempts: z.number(), nextAttemptAt: z.number(), lastError: z.string().optional(), dependencyId: z.string().optional(), receipt: receiptSchema.optional() });
const operation = z.discriminatedUnion("kind", [
  common.extend({ kind: z.literal("create"), input: creationInputSchema, localGroupId: z.string(), localWorkId: z.string(), result: creationResultSchema.optional() }),
  common.extend({ kind: z.literal("comment"), scope: workScope, text: z.string() }),
  common.extend({ kind: z.literal("answer"), scope: workScope, stepId: z.string(), answer, base: answer, wire: z.object({ answer: syncAnswerSchema, base: syncAnswerSchema }).optional() }),
  common.extend({ kind: z.literal("document"), scope, stepId: z.string().optional(), file: fileSchema, sourceDraftId: z.string().min(1).optional() }),
]);
const tenant = z.object({ id: z.string(), name: z.string(), portalOrigin: z.string(), environment: z.enum(["development", "production"]), logo: z.string().nullish(), description: z.string().nullish() });
export const offlineUserSchema = z.object({
  id: z.number(), workerId: z.number().nullable(), name: z.string(), lastnames: z.string(), email: z.string(), avatarThumbnail: z.string().optional(),
  role: z.object({ name: z.string(), isTechnician: z.boolean().optional() }),
  accessBranchs: z.array(z.object({ id: z.number(), name: z.string(), main: z.boolean(), isEnabled: z.boolean().optional(), isDeleted: z.boolean().optional() })),
  system: z.object({ name: z.string(), timezone: z.string() }), tenant: tenant.optional(),
});
const stateSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), operations: z.array(operation),
  revokedResources: z.array(z.object({ key: z.string(), status: z.union([z.literal(403), z.literal(404)]) })).default([]),
  cache: z.array(z.object({ key: z.string(), json: z.string(), fetchedAt: z.number().nonnegative(), coverage: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId: z.number().int().positive(), fetchedAt: z.number().nonnegative() }).optional() })),
  passports: z.array(z.object({ key: z.string(), user: offlineUserSchema, verifiedAt: z.number(), disabled: z.boolean() })),
  reservations: z.array(z.object({ id: z.string(), size: z.number(), namespace: z.string() })),
  attachments: z.array(z.object({ scope, stepId: z.string().optional(), attachmentId: z.string(), file: fileSchema })).default([]),
  lease: z.object({ owner: z.string(), until: z.number() }).nullable(), authBlocked: z.boolean(), lastSyncedAt: z.number().nullable(),
});
export function emptyState(): OfflineState { return { version: 1, revision: 0, operations: [], cache: [], revokedResources: [], passports: [], reservations: [], attachments: [], lease: null, authBlocked: false, lastSyncedAt: null }; }
export function decodeState(json: string): OfflineState {
  const state: OfflineState = stateSchema.parse(JSON.parse(json));
  for (const entry of state.cache) {
    const kind = entry.key.startsWith("files:") ? "files" : entry.key.startsWith("comments:") ? "comments" : undefined;
    if (!kind) continue;
    try {
      const key = z.tuple([scope, z.union([z.string(), z.number(), z.null()])]).safeParse(JSON.parse(entry.key.slice(kind.length + 1)));
      if (key.success) entry.key = resourceCacheKey(kind, key.data[0], key.data[1] ?? undefined);
    } catch { /* Leave unknown legacy keys intact. */ }
  }
  for (const op of state.operations) {
    if (op.kind !== "answer" || op.wire || op.status === "applied") continue;
    try {
      if (!("executionStatus" in op.answer) && !("executionStatus" in op.base)) {
        op.wire = { answer: syncAnswerSchema.parse(op.answer), base: syncAnswerSchema.parse(op.base) };
        continue;
      }
      const entry = state.cache.find((item) => item.key === `assignments:${op.scope.startDate}`);
      if (entry?.coverage && (entry.coverage.date !== op.scope.startDate || entry.coverage.branchId !== op.scope.companyBranchId)) throw new Error("OFFLINE_CACHE_SCOPE_MISMATCH");
      const data = entry && cachedAssignmentsSchema.parse(JSON.parse(entry.json));
      const step = data?.groups.find((group) => group.id === op.scope.groupId)?.works.find((work) => work.id === op.scope.workId)?.checklists.flatMap((checklist) => checklist.steps).find((step) => String(step.stepId) === op.stepId);
      if (!step) throw new Error("OFFLINE_ANSWER_TYPE_UNKNOWN");
      const base = "executionStatus" in op.base ? toSyncAnswer(step.type, op.base) : syncAnswerSchema.parse(op.base);
      op.wire = { answer: "executionStatus" in op.answer ? toSyncAnswer(step.type, op.answer) : syncAnswerSchema.parse(op.answer),
        base: JSON.stringify(op.base) === JSON.stringify(answerFromStep(step)) ? syncAnswerFromStep(step) : base };
    } catch {
      op.status = "needs_review";
      op.lastError = "OFFLINE_ANSWER_TYPE_UNKNOWN";
    }
  }
  for (const op of state.operations) {
    if (op.kind !== "document" || op.status !== "applied" || op.receipt?.fileId === undefined) continue;
    let scope = op.scope;
    if (scope.groupId.startsWith("local-") || scope.workId?.startsWith("local-")) {
      const parent = state.operations.find((entry) => entry.kind === "create" && entry.localGroupId === scope.groupId);
      if (parent?.kind !== "create" || parent.status !== "applied" || !parent.result || (scope.workId && scope.workId !== parent.localWorkId)) continue;
      scope = { ...scope, groupId: parent.result.groupId, ...(scope.workId ? { workId: String(parent.result.workId) } : {}) };
    }
    if (!state.attachments.some((entry) => sameResource(entry.scope, scope) && entry.stepId === op.stepId && entry.attachmentId === String(op.receipt?.fileId))) {
      state.attachments.push({ scope, stepId: op.stepId, attachmentId: String(op.receipt.fileId), file: op.file });
    }
  }
  return state;
}
export function cloneState(state: OfflineState): OfflineState { return decodeState(JSON.stringify(state)); }

export async function updateState(store: DurableStore, namespace: string, change: (state: OfflineState) => void): Promise<OfflineState> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await store.read(namespace);
    const revision = state.revision;
    change(state);
    state.revision = revision + 1;
    if (await store.compareAndSwap(namespace, revision, state)) return state;
  }
  throw new OfflineUnavailableError("OFFLINE_STORAGE_BUSY");
}
export function pendingOperation(operation: OfflineOperation): boolean { return operation.status !== "applied"; }
export async function hasPendingChanges(store: DurableStore): Promise<boolean> {
  for (const namespace of await store.namespaces()) if ((await store.read(namespace)).operations.some(pendingOperation)) return true;
  return false;
}
export function putCache(state: OfflineState, entry: CacheEntry): void {
  if (entry.json.length * 2 > OFFLINE_LIMITS.cacheBytes) throw new OfflineUnavailableError("OFFLINE_CACHE_ENTRY_TOO_LARGE");
  const entries = state.cache.filter((item) => item.key !== entry.key).concat(entry).sort((a, b) => a.fetchedAt - b.fetchedAt || a.key.localeCompare(b.key));
  let bytes = entries.reduce((total, item) => total + item.json.length * 2, 0);
  while (entries.length > OFFLINE_LIMITS.cacheEntries || bytes > OFFLINE_LIMITS.cacheBytes) bytes -= (entries.shift()?.json.length ?? 0) * 2;
  state.cache = entries;
}
export function validateQuota(size: number, used: number): void {
  if (!Number.isSafeInteger(size) || size <= 0 || size > OFFLINE_LIMITS.fileBytes) throw new OfflineUnavailableError("OFFLINE_FILE_LIMIT_25_MIB");
  if (used + size > OFFLINE_LIMITS.totalFileBytes) throw new OfflineUnavailableError("OFFLINE_STORAGE_FULL");
}