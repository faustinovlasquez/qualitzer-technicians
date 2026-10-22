import { z } from "zod";
import { inspectionRequirementSchema, type InspectionRequirement } from "./workshopEntry";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const url = z.string().max(4000);

/** Inspección de ingreso (DISPATCH en el backend) o de entrega (RETURN). */
export const inspectionKindSchema = z.enum(["entry", "exit"]);
export type InspectionKind = z.infer<typeof inspectionKindSchema>;
export const inspectionBackendType = (kind: InspectionKind) => kind === "entry" ? "DISPATCH" : "RETURN";

export const inspectionStepTypeSchema = z.enum(["validation", "text", "number", "select", "multiselect", "approval"]);
export type InspectionStepType = z.infer<typeof inspectionStepTypeSchema>;
const choiceSchema = z.object({ value: z.string().max(200), label: z.string().max(300) }).strict();
export type InspectionChoice = z.infer<typeof choiceSchema>;
/** Opciones fijas de "aprobación", como en la web. */
export const APPROVAL_CHOICES: InspectionChoice[] = [{ value: "approved", label: "Aprobado" }, { value: "rejected", label: "Rechazado" }, { value: "not_applicable", label: "No aplica" }];

/** Foto subida: `url` es la miniatura y `fullUrl` la imagen completa (para verla en grande). */
export const inspectionFileSchema = z.object({ fileId: id, url, fullUrl: url.nullable().optional() }).strict();

export const inspectionStepSchema = z.object({
  checklistStepId: id,
  order: z.number().int().min(0).max(100_000),
  title: z.string().max(500),
  description: z.string().max(2000).nullable(),
  type: inspectionStepTypeSchema,
  options: z.array(choiceSchema).max(100),
  isRequired: z.boolean(),
  isFilesRequired: z.boolean(),
  /** Respuesta guardada: el texto tal como lo guarda la web ("true", "approved", JSON de opciones…). */
  answer: z.object({
    stepId: id, responseValue: z.string().max(4000).nullable(), comment: z.string().max(2000).nullable(), isCompleted: z.boolean(), files: z.array(inspectionFileSchema).max(50)
  }).strict().nullable()
}).strict();

export const inspectionChecklistSchema = z.object({
  checklistId: id, name: z.string().max(300), isRequired: z.boolean(), locked: z.boolean(), steps: z.array(inspectionStepSchema).max(300)
}).strict();

/**
 * Ángulo de foto. `custom`: foto adicional con nombre libre ("Agregar foto", clave `custom-…` como en la web).
 * `reference`: en la entrega, la foto del mismo ángulo tomada al ingreso (para comparar).
 */
export const inspectionSlotSchema = z.object({
  key: z.string().max(120), name: z.string().max(200), isRequired: z.boolean(), photo: inspectionFileSchema.nullable(),
  custom: z.boolean().optional(), reference: inspectionFileSchema.nullable().optional()
}).strict();
export const CUSTOM_SLOT_KEY = /^custom-\d{6,16}$/;

export const inspectionSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const inspectionResponsibilitySchema = z.enum(["CLIENT", "WEAR", "PENDING"]);
export const inspectionDamageSchema = z.object({
  id, description: z.string().max(2000), severity: inspectionSeveritySchema, responsibility: inspectionResponsibilitySchema,
  location: z.string().max(300).nullable(), isAdditional: z.boolean(), photos: z.array(inspectionFileSchema).max(50)
}).strict();

export const workshopInspectionStateSchema = z.object({
  inspectionId: id,
  entryId: id,
  kind: inspectionKindSchema,
  requirement: inspectionRequirementSchema,
  completedAt: z.string().max(40).nullable(),
  observation: z.string().max(2000).nullable(),
  slots: z.array(inspectionSlotSchema).max(200),
  checklists: z.array(inspectionChecklistSchema).max(50),
  damages: z.array(inspectionDamageSchema).max(200)
}).strict();

export const inspectionChecklistOptionsSchema = z.object({ items: z.array(z.object({ id, name: z.string().max(300) }).strict()).max(500) }).strict();

const branch = { companyBranchId: id };
const jpeg = z.string().max(Math.ceil((4 * 1024 * 1024) / 3) * 4 + 30).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
export const INSPECTION_PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export const inspectionOpenInputSchema = z.object({ ...branch, kind: inspectionKindSchema }).strict();
export const inspectionChecklistsInputSchema = z.object({ ...branch, checklistIds: z.array(id).max(50) }).strict();
export const inspectionAnswerInputSchema = z.object({
  ...branch, checklistId: id, checklistStepId: id, responseValue: z.string().max(4000).nullable(), comment: z.string().trim().max(2000).nullable()
}).strict();
export const inspectionPhotoInputSchema = z.object({ ...branch, image: jpeg, source: z.enum(["camera", "gallery"]), label: z.string().trim().min(1).max(150).optional() }).strict();
/** Enlace público de la inspección (como "Compartir" en la web): otra persona sube fotos sin iniciar sesión mientras no venza. */
export const inspectionShareSchema = z.object({
  url: z.string().url().max(2000), expiresAt: z.string().max(40).nullable(), remainingSeconds: z.number().int().min(0), active: z.boolean()
}).strict();
export type InspectionShare = z.infer<typeof inspectionShareSchema>;
export const inspectionDamageInputSchema = z.object({
  ...branch, id: id.nullable(), description: z.string().trim().min(1).max(2000), severity: inspectionSeveritySchema,
  responsibility: inspectionResponsibilitySchema, location: z.string().trim().max(300).nullable(), isAdditional: z.boolean()
}).strict();
export const inspectionMetaInputSchema = z.object({ ...branch, observation: z.string().trim().max(2000).nullable() }).strict();
export const inspectionBranchInputSchema = z.object(branch).strict();
export const inspectionSavedSchema = z.object({ id }).strict();

export type InspectionFile = z.infer<typeof inspectionFileSchema>;
export type InspectionStep = z.infer<typeof inspectionStepSchema>;
export type InspectionChecklist = z.infer<typeof inspectionChecklistSchema>;
export type InspectionSlot = z.infer<typeof inspectionSlotSchema>;
export type InspectionDamage = z.infer<typeof inspectionDamageSchema>;
export type InspectionSeverity = z.infer<typeof inspectionSeveritySchema>;
export type InspectionResponsibility = z.infer<typeof inspectionResponsibilitySchema>;
export type WorkshopInspectionState = z.infer<typeof workshopInspectionStateSchema>;
export type InspectionAnswerInput = z.infer<typeof inspectionAnswerInputSchema>;
export type InspectionDamageInput = z.infer<typeof inspectionDamageInputSchema>;

export interface WorkshopInspectionPort {
  openInspection(entryId: number, input: z.infer<typeof inspectionOpenInputSchema>): Promise<WorkshopInspectionState>;
  inspection(entryId: number, inspectionId: number, branchId: number): Promise<WorkshopInspectionState>;
  inspectionChecklistOptions(branchId: number): Promise<z.infer<typeof inspectionChecklistOptionsSchema>>;
  setInspectionChecklists(entryId: number, inspectionId: number, input: z.infer<typeof inspectionChecklistsInputSchema>): Promise<WorkshopInspectionState>;
  answerInspectionStep(entryId: number, inspectionId: number, input: InspectionAnswerInput): Promise<{ id: number }>;
  uploadInspectionPhoto(entryId: number, inspectionId: number, slotKey: string, input: z.infer<typeof inspectionPhotoInputSchema>): Promise<{ id: number }>;
  deleteInspectionPhoto(entryId: number, inspectionId: number, slotKey: string, branchId: number): Promise<{ id: number }>;
  uploadInspectionStepFile(entryId: number, inspectionId: number, stepId: number, input: z.infer<typeof inspectionPhotoInputSchema>): Promise<{ id: number }>;
  deleteInspectionStepFile(entryId: number, inspectionId: number, fileId: number, branchId: number): Promise<{ id: number }>;
  saveInspectionDamage(entryId: number, inspectionId: number, input: InspectionDamageInput): Promise<{ id: number }>;
  deleteInspectionDamage(entryId: number, inspectionId: number, damageId: number, branchId: number): Promise<{ id: number }>;
  uploadInspectionDamagePhoto(entryId: number, inspectionId: number, damageId: number, input: z.infer<typeof inspectionPhotoInputSchema>): Promise<{ id: number }>;
  saveInspectionMeta(entryId: number, inspectionId: number, input: z.infer<typeof inspectionMetaInputSchema>): Promise<{ id: number }>;
  completeInspection(entryId: number, inspectionId: number, branchId: number): Promise<{ id: number }>;
  inspectionShare(entryId: number, inspectionId: number, branchId: number): Promise<InspectionShare>;
  extendInspectionShare(entryId: number, inspectionId: number, branchId: number): Promise<InspectionShare>;
  /** Descarga el .zip con las fotos ya subidas y lo deja listo para guardar o enviar. */
  downloadInspectionPhotos(entryId: number, inspectionId: number, branchId: number, name: string): Promise<void>;
}

/** Respuesta en pantalla, antes de convertirla al texto que guarda la web. */
export type InspectionAnswer =
  | { type: "validation"; value: "true" | "false" | "not_applicable" | null }
  | { type: "text" | "number"; value: string }
  | { type: "select" | "approval"; value: string | null }
  | { type: "multiselect"; value: InspectionChoice[] };

/** Igual que el codificador web (inspectionCapture.helpers): Sí/No como "true"/"false", opciones como su valor, varias como JSON. */
export function encodeInspectionAnswer(answer: InspectionAnswer): string | null {
  if (answer.type === "multiselect") return answer.value.length > 0 ? JSON.stringify(answer.value) : null;
  if (answer.type === "text" || answer.type === "number") return answer.value.trim() === "" ? null : answer.value.trim();
  return answer.value === null || answer.value === "" ? null : answer.value;
}

export function decodeInspectionAnswer(step: Pick<InspectionStep, "type" | "options">, responseValue: string | null): InspectionAnswer {
  if (step.type === "validation") return { type: "validation", value: responseValue === "true" || responseValue === "false" || responseValue === "not_applicable" ? responseValue : null };
  if (step.type === "multiselect") {
    if (!responseValue) return { type: "multiselect", value: [] };
    try {
      const parsed: unknown = JSON.parse(responseValue);
      const list = Array.isArray(parsed) ? parsed : [];
      return { type: "multiselect", value: list.flatMap((item) => { const choice = choiceSchema.safeParse(item); return choice.success ? [choice.data] : []; }) };
    } catch { return { type: "multiselect", value: [] }; }
  }
  if (step.type === "select" || step.type === "approval") return { type: step.type, value: responseValue };
  return { type: step.type, value: responseValue ?? "" };
}

/** Respuesta válida para el tipo de pregunta (el conector la revisa antes de guardarla). */
export function isValidInspectionResponse(step: Pick<InspectionStep, "type" | "options">, responseValue: string | null): boolean {
  if (responseValue === null) return true;
  if (step.type === "validation") return ["true", "false", "not_applicable"].includes(responseValue);
  if (step.type === "number") return /^-?\d+(?:[.,]\d+)?$/.test(responseValue) && responseValue.length <= 30;
  if (step.type === "text") return responseValue.length <= 2000;
  const options = step.type === "approval" ? APPROVAL_CHOICES : step.options;
  if (step.type === "select" || step.type === "approval") return options.some((option) => option.value === responseValue);
  const decoded = decodeInspectionAnswer(step, responseValue);
  return decoded.type === "multiselect" && decoded.value.length > 0 && decoded.value.every((item) => step.options.some((option) => option.value === item.value));
}

/** Igual que la web: una pregunta respondida queda completa, salvo que exija foto y no la tenga. Las no obligatorias no bloquean. */
export function isInspectionStepCompleted(step: Pick<InspectionStep, "isRequired" | "isFilesRequired">, responseValue: string | null, filesCount: number): boolean {
  const answered = responseValue !== null && responseValue !== "";
  if (step.isFilesRequired && answered && filesCount === 0) return false;
  if (!step.isRequired) return true;
  return answered && (!step.isFilesRequired || filesCount > 0);
}

/** Lo que falta para terminar la inspección según lo que exige la sucursal (mismo criterio de la ficha). */
export function inspectionPending(state: Pick<WorkshopInspectionState, "requirement" | "slots" | "checklists">, requirement: InspectionRequirement = state.requirement): string[] {
  const missing: string[] = [];
  if (requirement === "photos" || requirement === "full") {
    const required = state.slots.filter((slot) => slot.isRequired);
    const pending = required.filter((slot) => !slot.photo);
    if (required.length === 0 && state.slots.every((slot) => !slot.photo)) missing.push("Al menos una foto del equipo");
    if (pending.length > 0) missing.push(`Faltan fotos: ${pending.map((slot) => slot.name).join(", ")}`);
  }
  if (requirement === "checklist" || requirement === "full") {
    // Las preguntas no obligatorias no bloquean.
    const steps = state.checklists.flatMap((checklist) => checklist.steps).filter((step) => step.isRequired);
    const done = steps.filter((step) => step.answer?.isCompleted).length;
    if (state.checklists.length === 0) missing.push("Elige al menos una lista de revisión");
    else if (done < steps.length) missing.push(`Lista de revisión: ${done} de ${steps.length}`);
  }
  return missing;
}

export const SEVERITY_LABELS: Record<InspectionSeverity, string> = { LOW: "Leve", MEDIUM: "Medio", HIGH: "Grave" };
export const RESPONSIBILITY_LABELS: Record<InspectionResponsibility, string> = { CLIENT: "Operacional (cliente)", WEAR: "Desgaste", PENDING: "Por definir" };
