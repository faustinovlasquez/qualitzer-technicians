import { z } from "zod";
import type { Activity, Attachment, LocalPhoto, WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const link = z.string().nullish().transform(value => {
  if (!value) return "";
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : ""; } catch { return ""; }
});
export const workActivityInputSchema = z.object({ activity: z.string().trim().min(1).max(240).refine(value => !value.includes("\u0000") && !value.includes("__WORK_CHECKLIST__")), executionTime: z.number().int().min(0).max(44639) }).strict();
export type WorkActivityInput = z.infer<typeof workActivityInputSchema>;
export type WorkActivityList = Activity[] & { appliedOperationIds?: string[] };
export const workActivitySchema: z.ZodType<Activity> = z.object({
  id, activity: z.string(), executionTime: z.number().nonnegative(), isStarted: z.boolean(), isCompleted: z.boolean(),
  isChecklist: z.boolean().optional(), checklistId: id.nullish(),
  technicalDocuments: z.array(z.object({ id, documentName: z.string(), notes: z.string().nullable(), file: z.object({ id, name: z.string(), url: link, thumbnailUrl: link, type: z.string().nullable().optional() }).nullable() })).default([]),
});
export const workActivityResultSchema = z.object({ id });
export const workActivityCompletionSchema = z.object({ isCompleted: z.boolean().optional() }).strict();
export function isWorkActivity(activity: Activity): boolean {
  return activity.isChecklist !== true && activity.checklistId == null && !activity.activity.startsWith("__WORK_CHECKLIST__");
}
export interface WorkActivitiesPort {
  activities(scope: WorkScope): Promise<WorkActivityList>;
  createActivity(scope: WorkScope, input: WorkActivityInput, operationId?: string): Promise<{ id: number }>;
  updateActivity(scope: WorkScope, id: number, input: WorkActivityInput): Promise<void>;
  completeActivity(scope: WorkScope, id: number, isCompleted?: boolean): Promise<void>;
  deleteActivity(scope: WorkScope, id: number): Promise<void>;
  activityFiles(scope: WorkScope, id: number): Promise<Attachment[]>;
  deleteActivityFile(scope: WorkScope, id: number, fileId: string): Promise<void>;
  uploadActivityFiles(scope: WorkScope, id: number, files: LocalPhoto[]): Promise<void>;
  reopenWork(scope: WorkScope): Promise<void>;
}
export function workActions(repository: Partial<WorkActivitiesPort>): WorkActivitiesPort {
  if (!repository.activities || !repository.createActivity || !repository.completeActivity || !repository.activityFiles || !repository.uploadActivityFiles || !repository.reopenWork) throw new Error("Estas acciones requieren actualizar el servicio de trabajos.");
  return { activities: repository.activities.bind(repository), createActivity: repository.createActivity.bind(repository), updateActivity: repository.updateActivity?.bind(repository) ?? (async () => { throw new Error("Actualiza el servicio para editar actividades."); }), completeActivity: repository.completeActivity.bind(repository), deleteActivity: repository.deleteActivity?.bind(repository) ?? (async () => { throw new Error("Actualiza el servicio para eliminar actividades."); }), activityFiles: repository.activityFiles.bind(repository), deleteActivityFile: repository.deleteActivityFile?.bind(repository) ?? (async () => { throw new Error("Actualiza el servicio para eliminar archivos de actividades."); }), uploadActivityFiles: repository.uploadActivityFiles.bind(repository), reopenWork: repository.reopenWork.bind(repository) };
}