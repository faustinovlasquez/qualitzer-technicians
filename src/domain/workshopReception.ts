import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Trabajador que recibe el equipo (lista de trabajadores de la sucursal). */
export const workshopWorkerSchema = z.object({
  id, name: z.string().max(300), userId: id.nullable(), email: z.string().max(200).nullable(), phone: z.string().max(60).nullable()
}).strict();
export const workshopWorkersSchema = z.object({ items: z.array(workshopWorkerSchema).max(5000) }).strict();

/** Firma guardada en el perfil del trabajador (como en la web). La imagen es una dirección https o la imagen embebida. */
export const SAVED_SIGNATURE_MAX_CHARS = 1_500_000;
export const workshopSavedSignatureSchema = z.object({
  id, name: z.string().max(300), email: z.string().max(200).nullable(), phone: z.string().max(60).nullable(),
  image: z.string().max(SAVED_SIGNATURE_MAX_CHARS).nullable(), isDefault: z.boolean()
}).strict();
export const workshopSavedSignaturesSchema = z.object({ items: z.array(workshopSavedSignatureSchema).max(100) }).strict();

const SIGNATURE_MAX_CHARS = Math.ceil((1024 * 1024) / 3) * 4 + 30;
export const workshopReceptionInputSchema = z.object({
  companyBranchId: id,
  requestId: z.uuid(),
  workerId: id,
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().max(100).nullable(),
  phone: z.string().trim().max(50).nullable(),
  signature: z.discriminatedUnion("source", [
    z.object({ source: z.literal("USER_SIGNATURE"), userSignatureId: id }).strict(),
    z.object({ source: z.literal("MANUAL"), image: z.string().max(SIGNATURE_MAX_CHARS).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/) }).strict()
  ]),
  observation: z.string().trim().max(500).nullable()
}).strict();

/** El ingreso queda firmado; la observación y el estado "En proceso" pueden quedar pendientes sin deshacer la firma. */
export const workshopReceptionResultSchema = z.object({ id, observationSaved: z.boolean(), statusUpdated: z.boolean() }).strict();

export type WorkshopWorker = z.infer<typeof workshopWorkerSchema>;
export type WorkshopSavedSignature = z.infer<typeof workshopSavedSignatureSchema>;
export type WorkshopReceptionInput = z.infer<typeof workshopReceptionInputSchema>;
export type WorkshopReceptionResult = z.infer<typeof workshopReceptionResultSchema>;

export interface WorkshopReceptionPort {
  workshopWorkers(branchId: number): Promise<{ items: WorkshopWorker[] }>;
  workshopSavedSignatures(branchId: number, userId: number): Promise<{ items: WorkshopSavedSignature[] }>;
  signWorkshopReception(entryId: number, input: WorkshopReceptionInput): Promise<WorkshopReceptionResult>;
}

/** Igual que la web: avanza el estado solo hacia adelante. */
export const ENTRY_STATUS_RANK: Record<string, number> = { PENDING: 0, DIAGNOSIS: 1, ON_HOLD: 1, IN_PROGRESS: 2, UNDER_REVIEW: 3, COMPLETED: 4 };
export function shouldMoveToStatus(current: string | null, target: string): boolean {
  const targetRank = ENTRY_STATUS_RANK[target];
  if (targetRank === undefined) return false;
  if (current === null || current === "") return true;
  const currentRank = ENTRY_STATUS_RANK[current];
  return currentRank !== undefined && currentRank < targetRank;
}
