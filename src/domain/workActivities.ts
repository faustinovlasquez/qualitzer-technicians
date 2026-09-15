import { z } from "zod";
import type { Activity, Attachment, LocalPhoto, WorkScope } from "./models";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const link = z.string().nullish().transform(value => {
  if (!value) return "";
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : ""; } catch { return ""; }
});
export const workActivityInputSchema = z.object({ activity: z.string().trim().min(1).max(240).refine(value => !value.includes("__WORK_CHECKLIST__")), executionTime: z.number().int().min(0).max(44639) }).strict();
export type WorkActivityInput = z.infer<typeof workActivityInputSchema>;
export const workActivitySchema: z.ZodType<Activity> = z.object({
  id, activity: z.string(), executionTime: z.number().nonnegative(), isStarted: z.boolean(), isCompleted: z.boolean(),
  technicalDocuments: z.array(z.object({ id, documentName: z.string(), notes: z.string().nullable(), file: z.object({ id, name: z.string(), url: link, thumbnailUrl: link, type: z.string().nullable().optional() }).nullable() })).default([]),
});
export const workActivityResultSchema = z.object({ id });
export interface WorkActivitiesPort {
  activities(scope: WorkScope): Promise<Activity[]>;
  createActivity(scope: WorkScope, input: WorkActivityInput): Promise<{ id: number }>;
  completeActivity(scope: WorkScope, id: number): Promise<void>;
  activityFiles(scope: WorkScope, id: number): Promise<Attachment[]>;
  uploadActivityFiles(scope: WorkScope, id: number, files: LocalPhoto[]): Promise<void>;
  reopenWork(scope: WorkScope): Promise<void>;
}
export function workActions(repository: Partial<WorkActivitiesPort>): WorkActivitiesPort {
  if (!repository.activities || !repository.createActivity || !repository.completeActivity || !repository.activityFiles || !repository.uploadActivityFiles || !repository.reopenWork) throw new Error("Estas acciones requieren actualizar el servicio de trabajos.");
  return { activities: repository.activities.bind(repository), createActivity: repository.createActivity.bind(repository), completeActivity: repository.completeActivity.bind(repository), activityFiles: repository.activityFiles.bind(repository), uploadActivityFiles: repository.uploadActivityFiles.bind(repository), reopenWork: repository.reopenWork.bind(repository) };
}