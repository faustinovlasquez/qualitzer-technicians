import { z } from "zod";

/** Error de la app enviado al log del backend. Sin datos de formularios: solo mensaje, stack y contexto técnico. */
export const appErrorSchema = z.object({
  message: z.string().min(1).max(1000), stack: z.string().max(6000).nullable(), source: z.enum(["global", "render", "promise"]), fatal: z.boolean(),
  screen: z.string().max(60).nullable(), appVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/), platform: z.enum(["android", "ios", "web"]), occurredAt: z.iso.datetime(),
}).strict();
export const appErrorBatchSchema = z.object({ errors: z.array(appErrorSchema).min(1).max(10) }).strict();
export const appErrorResultSchema = z.object({ accepted: z.number().int().min(0).max(10) }).strict();
export type AppError = z.infer<typeof appErrorSchema>;
export interface AppErrorPort { reportAppErrors(errors: AppError[]): Promise<{ accepted: number }>; }
