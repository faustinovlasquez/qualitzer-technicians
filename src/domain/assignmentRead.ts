import type { Assignments } from "./models";

export interface AssignmentReadOptions {
  signal?: AbortSignal;
  priorityDate?: string;
  getPriorityDate?: () => string | null;
  onProgress?: (data: Assignments, loadedDates: string[]) => void;
  /** Días con copia local más reciente que esto se usan sin consultar al servidor (solo el repositorio offline). */
  maxAgeMs?: number;
}

export class AssignmentReadCancelledError extends Error {
  readonly name = "AbortError";
  constructor() { super("La consulta de asignaciones fue cancelada."); }
}