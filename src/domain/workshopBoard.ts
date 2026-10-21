import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0).max(1_000_000);

/** Taller (sitio con naves) disponible en la sucursal. */
export const workshopOptionSchema = z.object({ id, name: z.string().max(300) }).strict();
export const workshopListSchema = z.object({ items: z.array(workshopOptionSchema).max(200) }).strict();

/** Ingreso de equipo que está hoy en una nave (vista de solo lectura del tablero). */
export const workshopEntrySchema = z.object({
  id,
  code: z.string().max(40),
  title: z.string().max(500).nullable(),
  statusKey: z.string().max(80).nullable(),
  statusColor: z.string().max(40).nullable(),
  subStatusName: z.string().max(200).nullable(),
  equipmentLabel: z.string().max(500),
  equipmentCode: z.string().max(120).nullable(),
  customerName: z.string().max(300).nullable(),
  isInternalEntry: z.boolean(),
  daysInArea: count,
  estimatedDeliveryAt: z.string().max(40).nullable(),
  /** Registrado pero sin firma de recepción: "Pendiente por terminar". */
  isReceptionPending: z.boolean(),
  negotiationsCount: count,
  imageUrl: z.string().max(4000).nullable()
}).strict();

/** Nave del taller con su ocupación y los ingresos que tiene. */
export const workshopAreaSchema = z.object({
  id,
  title: z.string().max(300),
  maxSlots: count,
  occupiedSlots: count,
  hasUnlimitedSlots: z.boolean(),
  entries: z.array(workshopEntrySchema).max(500)
}).strict();

export const workshopBoardSchema = z.object({ workshopId: id, areas: z.array(workshopAreaSchema).max(500) }).strict();

export type WorkshopOption = z.infer<typeof workshopOptionSchema>;
export type WorkshopList = z.infer<typeof workshopListSchema>;
export type WorkshopEntry = z.infer<typeof workshopEntrySchema>;
export type WorkshopArea = z.infer<typeof workshopAreaSchema>;
export type WorkshopBoard = z.infer<typeof workshopBoardSchema>;

export interface WorkshopBoardPort {
  workshops(branchId: number): Promise<WorkshopList>;
  workshopBoard(branchId: number, workshopId: number): Promise<WorkshopBoard>;
}

/** Estados base del ingreso (nombres fijos de la semilla) en español. */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  DIAGNOSIS: "Diagnóstico",
  IN_PROGRESS: "En proceso",
  ON_HOLD: "En espera",
  UNDER_REVIEW: "En revisión",
  COMPLETED: "Completado"
};

export function workshopStatusLabel(key: string | null): string {
  if (!key) return "Sin estado";
  return STATUS_LABELS[key.trim().toUpperCase()] ?? key;
}

/** La fecha posible de entrega ya pasó. */
export function isWorkshopEntryOverdue(entry: WorkshopEntry, now: Date = new Date()): boolean {
  if (!entry.estimatedDeliveryAt) return false;
  const time = Date.parse(entry.estimatedDeliveryAt);
  return Number.isFinite(time) && time < now.getTime();
}

/** La nave todavía tiene espacio para otro ingreso. */
export function workshopAreaHasRoom(area: WorkshopArea): boolean {
  return area.hasUnlimitedSlots || area.occupiedSlots < area.maxSlots;
}
