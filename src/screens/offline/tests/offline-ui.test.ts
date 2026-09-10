/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment, ChecklistStep, LocalPhoto, StepAnswer, WorkScope } from "../../../domain/models";
import { OfflineQueuedError, type OfflineOperation, type OfflineQueuedOutcome, type OfflineSnapshot } from "../../../domain/offline";
import { creationPayload, emptyCreationForm, readCreationDraft } from "../../creation/creationForm";
import { answerKey, canRetryOperation, confirmedEvidenceWork, coverageDates, isConfirmedAttachment, operationsForWork, pendingDocumentAttachment, queuedCreationOutcomeSchema, queuedOutcomeData, queueOwnsDocument, registeredAnswerKey, trustedLocalFile, type PendingAnswer, type PendingComment, type PendingDocument } from "../offlineUi";
import { dependencyInfo, operationErrorReason, operationTitle } from "../offlineUi";

const id = "52b5201d-4ea9-4dad-9f9d-191d11ea8461";
const date = "2026-09-10";
const form = { ...emptyCreationForm(date), title: "Revisar conexión", summary: "Comprobar terminales", startTime: "09:00", endTime: "10:00" };
const input = creationPayload("work", form, 1, id);
const outcome: OfflineQueuedOutcome = { operationId: id, operationIds: [id], kind: "create", localGroupId: `local-${id}`, localWorkId: `local-${id}`, date, ownsFiles: false };
const scope: WorkScope = { groupId: "direct-4", workId: "4", companyBranchId: 1, startDate: date, endDate: date };
const base = { id, createdAt: 1000, status: "pending" as const, attempts: 0, nextAttemptAt: 0 };
const step: ChecklistStep = { stepId: "7", order: 1, title: "Validación", description: "", tag: "", type: "validation", options: [], isFilesRequired: false, isCompleted: null, selectValue: "", optionsSelectValue: [], responseValue: "", comment: "", executionStatus: null, attachments: [] };
const answer: StepAnswer = { responseValue: true, isCompleted: true, executionStatus: "completed", comment: null };
const answerOperation: PendingAnswer = { ...base, kind: "answer", scope, stepId: "7", answer, base: { ...answer, responseValue: null, isCompleted: false, executionStatus: null } };
const comment: PendingComment = { ...base, kind: "comment", scope, text: "Revisión pendiente" };
const documentOperation: PendingDocument = { ...base, kind: "document", scope, file: { id: "photo-id", namespace: "private-scope", name: "foto.png", size: 100, mimeType: "image/png", sha256: "a".repeat(64) } };
function snapshot(operations: OfflineOperation[]): OfflineSnapshot {
  return { online: false, preparing: false, syncing: false, authBlocked: false, pending: operations.length, conflicts: 0, lastError: null, lastSyncedAt: null, coverage: [], operations };
}

test("queued creation persists exact input and outcome without error instance fields", () => {
  const error = new OfflineQueuedError(outcome);
  assert.equal(queuedCreationOutcomeSchema.safeParse(error).success, false);
  const decoded = queuedCreationOutcomeSchema.parse(queuedOutcomeData(error));
  const restored = readCreationDraft(JSON.stringify({ version: 1, kind: "work", phase: "queued", form, input, outcome: decoded }), "work", 1);
  assert.ok(restored && restored.phase === "queued");
  assert.equal(restored.input.clientRequestId, id);
  assert.deepEqual(restored.outcome, outcome);
});

test("queued creation rejects foreign UUID/date/scope and malformed outcome", () => {
  const draft = { version: 1, kind: "work", phase: "queued", form, input, outcome };
  for (const changed of [{ ...outcome, date: "2026-09-11" }, { ...outcome, localWorkId: "4" }, { ...outcome, operationIds: [] }, { ...outcome, ownsFiles: true }, { ...outcome, kind: "document" }, { ...outcome, token: "not-allowed" }]) {
    assert.equal(readCreationDraft(JSON.stringify({ ...draft, outcome: changed }), "work", 1), null);
  }
  assert.equal(readCreationDraft(JSON.stringify(draft), "work", 2), null);
});

test("legacy pending creation retains the original UUID", () => {
  const restored = readCreationDraft(JSON.stringify({ version: 1, kind: "work", phase: "pending", form, input }), "work", 1);
  assert.ok(restored && restored.phase === "pending");
  assert.equal(restored.input.clientRequestId, id);
});

test("only committed owned document outcomes allow releasing original files", () => {
  assert.equal(queueOwnsDocument(new OfflineQueuedError({ ...outcome, kind: "document", ownsFiles: true })), true);
  assert.equal(queueOwnsDocument(new OfflineQueuedError({ ...outcome, kind: "document", ownsFiles: false })), false);
  assert.equal(queueOwnsDocument(new OfflineQueuedError(outcome)), false);
  assert.equal(queueOwnsDocument({ ...outcome, kind: "document", ownsFiles: true }), false);
  assert.equal(queueOwnsDocument(new Error("Network error")), false);
});

test("answer comparison canonicalizes field order and derived state", () => {
  assert.equal(answerKey(step, answer), answerKey(step, { comment: "", executionStatus: null, isCompleted: false, responseValue: true }));
  assert.notEqual(answerKey(step, answer), answerKey(step, { ...answer, responseValue: false }));
  assert.notEqual(answerKey(step, answer), answerKey(step, { ...answer, comment: "Nueva observación" }));
});

test("multiselect equality ignores order and translated labels", () => {
  const multi = { ...step, type: "multiselect" as const };
  assert.equal(answerKey(multi, { ...answer, responseValue: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }), answerKey(multi, { ...answer, responseValue: [{ value: "b", label: "Bee" }, { value: "a", label: "Ay" }] }));
});

test("after restart the same queued answer is recognized without marking draft saved", () => {
  const operations: PendingAnswer[] = [JSON.parse(JSON.stringify(answerOperation))];
  assert.equal(registeredAnswerKey(operations, step), answerKey(step, answer));
  const draft = { answer, saved: false };
  registeredAnswerKey(operations, step);
  assert.equal(draft.saved, false);
});

test("only latest answer is deduplicated, allowing an explicit A-B-A edit", () => {
  const newer = { ...answerOperation, id: "newer", createdAt: 2000, answer: { ...answer, responseValue: false } };
  assert.notEqual(registeredAnswerKey([answerOperation, newer], step), answerKey(step, answer));
  assert.equal(registeredAnswerKey([answerOperation], step, { signature: answerKey(step, newer.answer), operationId: newer.id }), answerKey(step, newer.answer));
  assert.equal(registeredAnswerKey([answerOperation, newer], step, { signature: answerKey(step, answer), operationId: id }), answerKey(step, newer.answer));
});

test("pending comments and answers match only their own branch/work/date scope", () => {
  const operations: OfflineOperation[] = [comment, answerOperation, { ...comment, id: "other-work", scope: { ...scope, workId: "99" } }, { ...comment, id: "other-branch", scope: { ...scope, companyBranchId: 2 } }, { ...comment, id: "other-date", scope: { ...scope, startDate: "2026-09-11" } }];
  assert.deepEqual(operationsForWork(snapshot(operations), scope), [comment, answerOperation]);
  assert.deepEqual(operationsForWork(null, scope), []);
});

test("local creation mappings retain pending child comments under canonical IDs", () => {
  const creation: OfflineOperation = { ...base, kind: "create", input, localGroupId: `local-${id}`, localWorkId: `local-${id}`, status: "applied", result: { kind: "work", companyBranchId: 1, groupId: "direct-4", workId: 4, schedule: { ...input.schedule, plannedMinutes: 60, timezone: "America/Santiago" } } };
  const localComment = { ...comment, scope: { ...scope, groupId: `local-${id}`, workId: `local-${id}` } };
  assert.deepEqual(operationsForWork(snapshot([creation, localComment]), scope), [localComment]);
});

test("pending files never satisfy completion evidence and original snapshot is unchanged", () => {
  const pending = pendingDocumentAttachment(documentOperation);
  const confirmed: Attachment = { id: 1, name: "server.png", url: "https://example.org/server.png" };
  const work = { checklists: [{ steps: [{ ...step, isFilesRequired: true, attachments: [pending, confirmed] }] }] };
  const filtered = confirmedEvidenceWork(work);
  assert.deepEqual(filtered.checklists[0].steps[0].attachments, [confirmed]);
  assert.equal(work.checklists[0].steps[0].attachments.length, 2);
  assert.equal(isConfirmedAttachment(pending), false);
  assert.equal(pending.url, "");
});

test("applied local file receipts can count as confirmed without authorizing deletion of local IDs", () => {
  const file = pendingDocumentAttachment(documentOperation);
  const confirmed = { ...file, offline: { ...file.offline, confirmed: true } };
  assert.equal(isConfirmedAttachment(confirmed), true);
  assert.equal(String(file.id).startsWith("local-"), true);
});

test("retry never blindly reenqueues conflict, rejected, review or syncing operations", () => {
  assert.equal(canRetryOperation(comment), true);
  for (const status of ["conflict", "needs_review", "auth_required", "syncing", "applied", "blocked"] as const) assert.equal(canRetryOperation({ ...comment, status }), false);
  assert.equal(canRetryOperation({ ...comment, status: "blocked", lastError: "OFFLINE_NETWORK_UNAVAILABLE" }), true);
  assert.equal(canRetryOperation({ ...comment, receipt: { operationId: id, state: "rejected" } }), false);
});

test("coverage lists at most seven real calendar dates and rejects invalid ranges", () => {
  assert.deepEqual(coverageDates({ startDate: "2026-09-28", endDate: "2026-10-04" }), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(coverageDates({ startDate: date, endDate: "2026-10-10" }).length, 7);
  assert.deepEqual(coverageDates({ startDate: "2026-02-30", endDate: date }), []);
});

test("local preview accepts only the resolved file identity and platform URI", () => {
  const local: LocalPhoto = { id: "photo-id", uri: "blob:https://example.org/generated", name: "foto.png", mimeType: "image/png" };
  assert.equal(trustedLocalFile(local.id, local, "web"), true);
  assert.equal(trustedLocalFile("other-id", local, "web"), false);
  assert.equal(trustedLocalFile(local.id, { ...local, uri: "https://example.org/untrusted" }, "web"), false);
  assert.equal(trustedLocalFile(local.id, { ...local, uri: "javascript:alert(1)" }, "web"), false);
  assert.equal(trustedLocalFile(local.id, { ...local, uri: "file:///documents/offline/photo.png" }, "ios"), true);
  assert.equal(trustedLocalFile(local.id, local, "android"), false);
});

test("zero-attempt dependency describes parent deployment without marking child failed or mutating bytes", () => {
  const parent: OfflineOperation = { ...base, kind: "create", input, localGroupId: `local-${id}`, localWorkId: `local-${id}`, lastError: "MOBILE_CREATION_SCHEMA_NOT_READY", nextAttemptAt: 61000 };
  const child: OfflineOperation = { ...documentOperation, id: "child", dependencyId: id };
  const before = structuredClone([parent, child]);
  const info = dependencyInfo(child, [parent, child]);
  assert.equal(info.status, "waiting"); assert.equal(info.title, "Esperando crear el trabajo");
  assert.equal(info.parent, parent); assert.match(info.reason, /actualizar el servidor/);
  assert.equal(child.attempts, 0); assert.equal(child.status, "pending");
  assert.deepEqual([parent, child], before); assert.match(operationTitle(child), /foto.png/);
  assert.match(operationTitle(parent), /Revisar conexión/);
  assert.equal(canRetryOperation(parent, 1000), false); assert.equal(canRetryOperation(parent, 61000), true);
});

test("dependency states cover blocked, missing, ready, map lookup and never retry permanent parent conflicts", () => {
  const parent: OfflineOperation = { ...base, kind: "create", input, localGroupId: `local-${id}`, localWorkId: `local-${id}`, status: "conflict", lastError: "MOBILE_CREATION_REQUEST_CONFLICT" };
  const child = { ...comment, id: "child", dependencyId: id };
  const info = dependencyInfo(child, new Map([[id, parent]]));
  assert.equal(info.status, "blocked"); assert.match(info.reason, /Requiere revisión/); assert.equal(canRetryOperation(parent), false);
  assert.equal(dependencyInfo(child, []).status, "missing");
  assert.equal(dependencyInfo(child, [{ ...parent, status: "applied" }]).status, "ready");
  assert.equal(dependencyInfo(comment, []).status, "ready");
  assert.match(operationErrorReason("MOBILE_SYNC_SCHEMA_NOT_READY"), /automáticamente/);
});

test("document diagnostics explain recovery and preservation without promising an unverified success", () => {
  assert.match(operationErrorReason("OFFLINE_DOCUMENT_RECOVERY_PENDING"), /sin crear un duplicado/);
  for (const code of ["OFFLINE_SYNC_UNEXPECTED_RESPONSE", "OFFLINE_DOCUMENT_UNEXPECTED_ERROR", "OFFLINE_DOCUMENT_MULTIPART_PREPARATION_FAILED", "OFFLINE_LOCAL_FILE_UNREADABLE", "OFFLINE_FILE_INTEGRITY_MISMATCH", "OFFLINE_LOCAL_FILE_MISSING", "OFFLINE_DOCUMENT_FILE_ID_INVALID", "OFFLINE_INVALID_RECEIPT", "OFFLINE_RECEIPT_INVALID_RESPONSE"]) {
    const reason = operationErrorReason(code);
    assert.notEqual(reason, code);
    assert.doesNotMatch(reason, /archivo enviado|envío confirmado|guardado en el servidor/i);
  }
});