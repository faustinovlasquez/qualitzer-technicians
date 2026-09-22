import { z } from "zod";
import type { ChecklistStep, StepAnswer } from "./models";
import { checklistStepOptions } from "./checklistProgress";
import { workedDatesAllowed } from "./workExecution";

export const syncOperationIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((value) => value.toLowerCase());
export const syncPositiveIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const syncResourceIdSchema = z.union([syncPositiveIdSchema, z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(syncPositiveIdSchema)]);
export const syncCapabilitiesSchema = z.object({ protocolVersion: z.literal(1), companyBranchId: syncPositiveIdSchema,
  userId: syncPositiveIdSchema, workerId: syncPositiveIdSchema, optionalWorkFields: z.literal(true), recordedTimer: z.literal(true), completion: z.literal(true) }).strict();
export type SyncCapabilities = z.infer<typeof syncCapabilitiesSchema>;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const syncScopeSchema = z.object({
  groupId: z.string().regex(/^(?:external|maintenance|direct|direct-np)-[1-9]\d*$/).refine((value) => Number.isSafeInteger(Number(value.split("-").at(-1)))),
  workId: syncResourceIdSchema.optional(), companyBranchId: syncPositiveIdSchema, startDate: date, endDate: date,
}).strict().refine((value) => value.startDate <= value.endDate && Date.parse(value.endDate) - Date.parse(value.startDate) <= 92 * 86400000)
  .refine((value) => !value.groupId.startsWith("direct-") || value.workId !== undefined);
const text = (limit: number) => z.string().max(limit).refine((value) => !value.includes("\u0000")).nullish().transform((value) => value ?? "");
const choice = z.object({ value: z.string().min(1).max(500).refine((value) => !value.includes("\u0000")), label: text(500) }).strict();
export const syncAnswerSchema = z.object({
  isCompleted: z.boolean().nullish().transform((value) => value ?? null), responseValue: text(10000), selectValue: text(500),
  optionsSelectValue: z.array(choice).max(200).nullish().transform((value) => (value ?? []).slice().sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    .refine((values) => new Set(values.map((value) => value.value)).size === values.length), comment: text(10000),
}).strict();
export type SyncStepAnswer = z.output<typeof syncAnswerSchema>;
export const syncTimerPayloadSchema = z.object({
  status: z.enum(["in_progress", "paused"]), baseStatus: z.enum(["pending", "in_progress", "paused"]),
  recordedAt: z.iso.datetime().optional(), observedAt: z.iso.datetime().optional(), previousOperationId: syncOperationIdSchema.optional(),
}).strict().refine(value => (value.recordedAt === undefined) === (value.observedAt === undefined)
  && (value.previousOperationId === undefined || value.recordedAt !== undefined));
export const syncCompletionInputSchema = z.object({
  status: z.enum(["completed", "delivered"]), executionDates: z.array(date).min(1).max(30).refine(values => new Set(values).size === values.length).optional(),
  workedDates: z.array(date).refine(workedDatesAllowed).optional(), isManual: z.boolean().optional(),
  executionStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  executionEndTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), endDateOffset: z.number().int().min(0).max(30).optional(),
}).strict();
export const syncCompletionPayloadSchema = z.object({
  input: syncCompletionInputSchema, recordedAt: z.iso.datetime(), observedAt: z.iso.datetime(),
  baseStatus: z.enum(["pending", "in_progress", "paused"]), previousTimerOperationId: syncOperationIdSchema.optional(),
}).strict();
export type SyncCompletionPayload = z.infer<typeof syncCompletionPayloadSchema>;
export const syncCommandSchema = z.discriminatedUnion("kind", [
  z.object({ operationId: syncOperationIdSchema, kind: z.literal("comment"), scope: syncScopeSchema, payload: z.object({ text: text(10000).transform((value) => value.trim()).pipe(z.string().min(1)) }).strict() }).strict(),
  z.object({ operationId: syncOperationIdSchema, kind: z.literal("answer"), scope: syncScopeSchema, payload: z.object({ stepId: syncResourceIdSchema, answer: syncAnswerSchema, base: syncAnswerSchema }).strict() }).strict(),
  z.object({ operationId: syncOperationIdSchema, kind: z.literal("timer"), scope: syncScopeSchema, payload: syncTimerPayloadSchema }).strict(),
  z.object({ operationId: syncOperationIdSchema, kind: z.literal("checklist"), scope: syncScopeSchema, payload: z.object({ checklistId: syncPositiveIdSchema }).strict() }).strict(),
  z.object({ operationId: syncOperationIdSchema, kind: z.literal("completion"), scope: syncScopeSchema, payload: syncCompletionPayloadSchema }).strict(),
]).refine((value) => value.kind === "comment" || value.scope.workId !== undefined)
  .refine(value => value.kind !== "timer" || value.payload.recordedAt === undefined || value.scope.startDate === value.scope.endDate)
  .refine(value => value.kind !== "completion" || value.scope.startDate === value.scope.endDate
    && (value.payload.input.executionDates === undefined || value.payload.input.executionDates.length === 1 && value.payload.input.executionDates[0] === value.scope.startDate));
export type SyncCommand = z.output<typeof syncCommandSchema>;
export const syncDocumentSchema = z.object({ operationId: syncOperationIdSchema, scope: syncScopeSchema, stepId: syncResourceIdSchema.optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
  .refine((value) => value.stepId === undefined || value.scope.workId !== undefined);
export type SyncDocument = z.output<typeof syncDocumentSchema>;

export const syncErrorSchema = z.enum([
  "MOBILE_SYNC_ACTOR_NOT_AUTHORIZED", "MOBILE_SYNC_BASE_CONFLICT", "MOBILE_SYNC_BRANCH_NOT_FOUND", "MOBILE_SYNC_COMMENT_WORK_REQUIRED",
  "MOBILE_SYNC_FILE_REQUIRED", "MOBILE_SYNC_IN_PROGRESS", "MOBILE_SYNC_INPUT_TOO_LARGE", "MOBILE_SYNC_INVALID_ANSWER",
  "MOBILE_SYNC_INVALID_DATE_RANGE", "MOBILE_SYNC_INVALID_FILE_SIZE", "MOBILE_SYNC_INVALID_FILE_TYPE", "MOBILE_SYNC_INVALID_GROUP_ID",
  "MOBILE_SYNC_INVALID_ID", "MOBILE_SYNC_INVALID_INPUT", "MOBILE_SYNC_INVALID_KIND", "MOBILE_SYNC_INVALID_METADATA",
  "MOBILE_SYNC_INVALID_MULTIPART", "MOBILE_SYNC_INVALID_OPERATION_ID", "MOBILE_SYNC_INVALID_SERVER_ANSWER", "MOBILE_SYNC_INVALID_SERVER_OPTIONS",
  "MOBILE_SYNC_INVALID_STATE", "MOBILE_SYNC_INVALID_TEXT", "MOBILE_SYNC_MULTIPART_REQUIRED", "MOBILE_SYNC_OPERATION_REUSED",
  "MOBILE_SYNC_RECEIPT_NOT_FOUND", "MOBILE_SYNC_REQUIRES_REVIEW", "MOBILE_SYNC_SCHEMA_NOT_READY", "MOBILE_SYNC_STEP_NOT_FOUND",
  "MOBILE_SYNC_UNAUTHORIZED", "MOBILE_SYNC_UNAVAILABLE", "MOBILE_SYNC_WORK_NOT_FOUND", "MOBILE_SYNC_WORK_REQUIRED",
  "MOBILE_SYNC_STATUS_CONFLICT", "MOBILE_SYNC_INVALID_STATUS", "MOBILE_SYNC_INVALID_CHECKLIST",
]);
export const syncReceiptSchema = z.object({ operationId: syncOperationIdSchema, state: z.enum(["applied", "conflict", "rejected", "needs_review", "in_progress"]), fileId: syncPositiveIdSchema.optional(), error: syncErrorSchema.optional() });
export type SyncReceipt = z.output<typeof syncReceiptSchema>;

export function receiptForOperation(input: unknown, operationId: string, status: number): SyncReceipt | null {
  if (input !== null && typeof input === "object" && "success" in input && input.success === false) return null;
  const parsed = syncReceiptSchema.safeParse(input);
  if (!parsed.success || parsed.data.operationId !== syncOperationIdSchema.parse(operationId)) return null;
  const receipt = parsed.data;
  if (receipt.state === "applied" && (status !== 200 || receipt.error !== undefined)) return null;
  if (receipt.state === "rejected" && ![200, 400].includes(status)) return null;
  if (["conflict", "needs_review", "in_progress"].includes(receipt.state) && ![200, 409].includes(status)) return null;
  if (receipt.state === "in_progress" && (status !== 409 || receipt.error !== "MOBILE_SYNC_IN_PROGRESS")) return null;
  if (receipt.error === "MOBILE_SYNC_IN_PROGRESS" && receipt.state !== "in_progress") return null;
  if (receipt.error === "MOBILE_SYNC_OPERATION_REUSED") return { operationId: receipt.operationId, state: "needs_review", error: receipt.error };
  return receipt;
}

export function syncAnswerFromStep(step: ChecklistStep): SyncStepAnswer {
  return syncAnswerSchema.parse({ isCompleted: step.type === "validation" && step.selectValue !== "not_applicable" ? step.isCompleted : null,
    responseValue: step.responseValue, selectValue: step.selectValue, optionsSelectValue: step.optionsSelectValue, comment: step.comment });
}

export function toSyncAnswer(type: ChecklistStep["type"], answer: StepAnswer): SyncStepAnswer {
  const value = answer.responseValue;
  const result: SyncStepAnswer = { isCompleted: null, responseValue: "", selectValue: "", optionsSelectValue: [], comment: answer.comment ?? "" };
  if (type === "validation") {
    if (value === "not_applicable") result.selectValue = value;
    else if (typeof value === "boolean" || value === null) result.isCompleted = value;
    else throw new Error("MOBILE_SYNC_INVALID_ANSWER");
  } else if (type === "multiselect") {
    if (value !== null && !Array.isArray(value)) throw new Error("MOBILE_SYNC_INVALID_ANSWER");
    result.optionsSelectValue = value ?? [];
  } else {
    if (value !== null && typeof value !== "string") throw new Error("MOBILE_SYNC_INVALID_ANSWER");
    if (type === "select" || type === "approval") result.selectValue = value ?? "";
    else result.responseValue = value ?? "";
  }
  return syncAnswerSchema.parse(result);
}

export function syncAnswersEqual(left: SyncStepAnswer, right: SyncStepAnswer): boolean {
  const comparable = (value: SyncStepAnswer) => ({ ...syncAnswerSchema.parse(value), optionsSelectValue: value.optionsSelectValue.map((item) => item.value).sort() });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function syncResponseForStep(step: ChecklistStep, answer: SyncStepAnswer): StepAnswer["responseValue"] {
  const invalid = (): never => { throw new Error("MOBILE_SYNC_INVALID_ANSWER"); };
  if (step.type !== "validation" && answer.isCompleted !== null) invalid();
  if (step.type !== "multiselect" && answer.optionsSelectValue.length) invalid();
  if (!["text", "number"].includes(step.type) && answer.responseValue !== "") invalid();
  if (!["select", "approval", "validation"].includes(step.type) && answer.selectValue !== "") invalid();
  if (step.type === "validation") {
    if (answer.selectValue !== "" && answer.selectValue !== "not_applicable") invalid();
    if (answer.selectValue === "not_applicable") { if (answer.isCompleted !== null) invalid(); return answer.selectValue; }
    return answer.isCompleted;
  }
  if (step.type === "text" || step.type === "number") {
    if (step.type === "number" && answer.responseValue !== "" && (answer.responseValue.trim() === "" || !Number.isFinite(Number(answer.responseValue)))) invalid();
    return answer.responseValue;
  }
  const options = checklistStepOptions(step);
  if (step.type === "multiselect") return answer.optionsSelectValue.map((item) => options.find((option) => option.value === item.value) ?? invalid());
  if (answer.selectValue !== "" && !options.some((option) => option.value === answer.selectValue)) invalid();
  return answer.selectValue;
}