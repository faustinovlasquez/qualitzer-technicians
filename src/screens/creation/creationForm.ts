import { z } from "zod";
import { calendarDateSchema, creationInputSchema, creationKindSchema, creationPrioritySchema, creationResultSchema, mobileUuidSchema, nonProductiveReasonSchema, positiveCreationIdSchema, workEditInputSchema, type WorkEditDocument, type WorkEditInput, type CreationInput, type CreationKind, type CreationSchedule } from "../../domain/creation";
import type { Assignments } from "../../domain/models";
import type { OfflineSnapshot } from "../../domain/offline";
import { buildWeeklySchedule, scheduleTimeMinutes } from "../../domain/weeklySchedule";
import { queuedCreationOutcomeSchema } from "../offline/offlineUi";

const draftText = (max: number) => z.string().max(max).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/);
export const creationFormSchema = z.object({
  maintenanceId: positiveCreationIdSchema.optional(),
  title: draftText(255), summary: draftText(5000), motive: draftText(5000),
  priority: creationPrioritySchema, maintenanceType: z.enum(["correctivo", "detencion"]),
  equipment: z.object({ id: positiveCreationIdSchema, label: draftText(500), internalNumber: draftText(500).nullish(), identifier: draftText(500).nullish(), equipmentType: draftText(500).nullish() }).strict().nullable(),
  specialty: z.object({ id: positiveCreationIdSchema, label: draftText(500) }).strict().nullable(),
  damageType: z.enum(["", "operacional", "desgaste"]), reason: nonProductiveReasonSchema,
  reasonText: draftText(500), initialComment: draftText(5000),
  date: z.string().max(10).regex(/^[0-9-]*$/), startTime: z.string().max(5).regex(/^[0-9:]*$/), endTime: z.string().max(5).regex(/^[0-9:]*$/),
}).strict();
export type CreationForm = z.infer<typeof creationFormSchema>;
export type CatalogItem = NonNullable<CreationForm["equipment"]>;
export type CreationFormErrors = Partial<{ [Key in keyof CreationForm]: string }>;

export function emptyCreationForm(initialDate: string): CreationForm {
  return { title: "", summary: "", motive: "", priority: "medium", maintenanceType: "correctivo", equipment: null, specialty: null,
    damageType: "", reason: "waiting_parts", reasonText: "", initialComment: "", date: calendarDateSchema.safeParse(initialDate).success ? initialDate : "", startTime: "", endTime: "" };
}

export function creationPayload(kind: CreationKind, form: CreationForm, companyBranchId: number, clientRequestId: string): CreationInput {
  const base = { companyBranchId, clientRequestId, schedule: { date: form.date, startTime: form.startTime, endTime: form.endTime } };
  const specialty = form.specialty ? { specialtyId: form.specialty.id } : {};
  if (kind === "work") return creationInputSchema.parse({ ...base, kind, ...(form.maintenanceId ? { maintenanceId: form.maintenanceId } : {}), work: {
    title: form.title, summary: form.summary.trim(), priority: form.priority, ...specialty,
    ...(form.equipment && !form.maintenanceId ? { rentalEquipmentId: form.equipment.id } : {}),
  } });
  if (kind === "maintenance") return creationInputSchema.parse({ ...base, kind, maintenance: {
    type: form.maintenanceType, title: form.title, motive: form.motive, equipmentId: form.equipment?.id, priority: form.priority,
    ...specialty, ...(form.damageType ? { damageType: form.damageType } : {}),
  } });
  return creationInputSchema.parse({ ...base, kind, nonProductive: {
    reason: form.reason, ...(form.reasonText.trim() ? { reasonText: form.reasonText } : {}),
    ...(form.initialComment.trim() ? { initialComment: form.initialComment } : {}),
  } });
}

export function validateCreationForm(kind: CreationKind, form: CreationForm): CreationFormErrors {
  const errors: CreationFormErrors = {};
  const requiredText = (field: "title" | "summary" | "motive" | "reasonText", label: string): void => {
    if (!form[field].trim()) errors[field] = `${label} es obligatorio.`;
  };
  if (kind !== "non_productive") requiredText("title", "El título");
  if (kind === "maintenance") { requiredText("motive", "El motivo"); if (!form.equipment) errors.equipment = "Selecciona un equipo."; }
  if (kind === "non_productive" && form.reason === "other") requiredText("reasonText", "El detalle del motivo");
  if (!calendarDateSchema.safeParse(form.date).success) errors.date = "Ingresa una fecha real YYYY-MM-DD entre 2000 y 2100.";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ((kind !== "work" || form.startTime) && !time.test(form.startTime)) errors.startTime = "Usa HH:mm, por ejemplo 09:00.";
  if ((kind !== "work" || form.endTime) && !time.test(form.endTime)) errors.endTime = "Usa HH:mm, por ejemplo 10:30.";
  else if (form.startTime && form.endTime && !errors.startTime && form.startTime >= form.endTime) errors.endTime = "El fin debe ser posterior al inicio, en el mismo día.";
  const parsed = creationFormSchema.safeParse(form);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in creationFormSchema.shape) {
      const key = field as keyof CreationForm;
      errors[key] = "Revisa el formato y la longitud de este campo.";
    }
  }
  return errors;
}

export function creationDuration(form: Pick<CreationForm, "startTime" | "endTime">): number | null {
  const start = scheduleTimeMinutes(form.startTime);
  const end = scheduleTimeMinutes(form.endTime);
  return start !== null && end !== null && end > start ? end - start : null;
}

const common = { version: z.literal(1), kind: creationKindSchema, form: creationFormSchema };
export const creationDraftSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("editing") }).strict(),
  z.object({ ...common, phase: z.literal("pending"), input: creationInputSchema }).strict(),
  z.object({ ...common, phase: z.literal("queued"), input: creationInputSchema, outcome: queuedCreationOutcomeSchema }).strict(),
  z.object({ ...common, phase: z.literal("confirmed"), input: creationInputSchema, result: creationResultSchema }).strict(),
]).superRefine((draft, context) => {
  if (draft.phase === "editing") return;
  try {
    const expected = creationPayload(draft.kind, draft.form, draft.input.companyBranchId, draft.input.clientRequestId);
    if (JSON.stringify(expected) !== JSON.stringify(draft.input)) throw new Error("DRAFT_INPUT_MISMATCH");
    if (draft.phase === "queued" && (draft.outcome.operationId !== draft.input.clientRequestId || draft.outcome.date !== draft.input.schedule.date)) throw new Error("DRAFT_QUEUE_MISMATCH");
    if (draft.phase === "confirmed" && (draft.result.kind !== draft.kind || draft.result.companyBranchId !== draft.input.companyBranchId ||
      draft.result.schedule.date !== draft.input.schedule.date || draft.result.schedule.startTime !== draft.input.schedule.startTime || draft.result.schedule.endTime !== draft.input.schedule.endTime)) throw new Error("DRAFT_RESULT_MISMATCH");
  } catch { context.addIssue({ code: "custom", message: "CREATION_DRAFT_MISMATCH" }); }
});
export type CreationDraft = z.infer<typeof creationDraftSchema>;

export function queuedCreationState(draft: Extract<CreationDraft, { phase: "queued" }>, snapshot?: OfflineSnapshot | null): {
  status: "unavailable" | "pending" | "syncing" | "review" | "auth_required" | "confirmed";
  confirmed?: Extract<CreationDraft, { phase: "confirmed" }>;
} {
  const operation = snapshot?.operations.find(item => item.id === draft.input.clientRequestId);
  if (!operation || operation.kind !== "create" || operation.localGroupId !== draft.outcome.localGroupId || operation.localWorkId !== draft.outcome.localWorkId) return { status: "unavailable" };
  const input = creationInputSchema.safeParse(operation.input);
  if (!input.success || JSON.stringify(input.data) !== JSON.stringify(draft.input)) return { status: "unavailable" };
  if (operation.status === "applied") {
    const confirmed = creationDraftSchema.safeParse({ version: draft.version, kind: draft.kind, phase: "confirmed", form: draft.form, input: draft.input, result: operation.result });
    return confirmed.success && confirmed.data.phase === "confirmed" ? { status: "confirmed", confirmed: confirmed.data } : { status: "unavailable" };
  }
  if (snapshot?.authBlocked || operation.status === "auth_required") return { status: "auth_required" };
  if (operation.status === "blocked" || operation.status === "needs_review" || operation.status === "conflict") return { status: "review" };
  return { status: operation.status };
}

export function readCreationDraft(raw: string, kind: CreationKind, companyBranchId: number): CreationDraft | null {
  if (raw.length > 80_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = creationDraftSchema.safeParse(value);
    if (!parsed.success || parsed.data.kind !== kind) return null;
    if (parsed.data.phase !== "editing" && (parsed.data.input.companyBranchId !== companyBranchId || !mobileUuidSchema.safeParse(parsed.data.input.clientRequestId).success)) return null;
    return parsed.data;
  } catch { return null; }
}

export interface CreationConflictPreview { overlaps: string[]; message: string; generatedAt: string | null; }
export function creationConflictPreview(data: Assignments | null, schedule: CreationSchedule): CreationConflictPreview {
  const unavailable = { overlaps: [], message: "No hay cobertura cargada verificable para esta fecha. La revisión de conflictos es incompleta; el servidor no confirma disponibilidad.", generatedAt: data?.generatedAt ?? null };
  if (!data || !calendarDateSchema.safeParse(schedule.date).success) return unavailable;
  const covered = data.groups.some((group) => group.works.some((work) => work.schedules?.some((item) => item.queryDates.includes(schedule.date))));
  if (!covered) return unavailable;
  const start = scheduleTimeMinutes(schedule.startTime);
  const end = scheduleTimeMinutes(schedule.endTime);
  if (start === null || end === null || end <= start) return unavailable;
  const weekly = buildWeeklySchedule(data, { startDate: schedule.date, endDate: schedule.date });
  const overlaps = [...new Set(weekly.days.flatMap((day) => day.blocks.filter((block) => block.startMinute < end && block.endMinute > start).map((block) => block.work.title)))];
  return { overlaps, generatedAt: data.generatedAt,
    message: `${overlaps.length ? "Hay horarios superpuestos en las asignaciones cargadas. Puedes continuar." : "Sin superposiciones en los horarios cargados."} ${weekly.unscheduled.length ? "Hay trabajos sin horario comparable; revisión incompleta. " : ""}Es una advertencia local, no una confirmación de disponibilidad del servidor.` };
}

export function workEditForm(document: WorkEditDocument): CreationForm {
  return { ...emptyCreationForm(document.fields.schedule.date), title: document.fields.title, summary: document.fields.summary,
    priority: document.fields.priority, equipment: document.equipment, specialty: document.specialty,
    startTime: document.fields.schedule.startTime, endTime: document.fields.schedule.endTime };
}

export function workEditPayload(document: WorkEditDocument, form: CreationForm): WorkEditInput {
  return workEditInputSchema.parse({ expectedRevision: document.revision, fields: {
    title: form.title, summary: form.summary, priority: form.priority,
    specialtyId: document.equipmentInherited ? document.fields.specialtyId : form.specialty?.id ?? null,
    rentalEquipmentId: document.equipmentInherited ? document.fields.rentalEquipmentId : form.equipment?.id ?? null,
    schedule: document.scheduleEditable ? { date: form.date, startTime: form.startTime, endTime: form.endTime, endDateOffset: 0 } : document.fields.schedule,
  } });
}