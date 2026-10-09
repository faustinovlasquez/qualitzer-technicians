import type { Assignments } from "./models";

export interface AssignmentReadOptions {
  signal?: AbortSignal;
  priorityDate?: string;
  getPriorityDate?: () => string | null;
  onProgress?: (data: Assignments, loadedDates: string[]) => void;
  /** Días con copia local más reciente que esto se usan sin consultar al servidor (solo el repositorio offline). */
  maxAgeMs?: number;
  /**
   * Huella de la copia local de ese día (solo consultas de un día). Si el servidor confirma que no cambió, la lectura
   * termina con `AssignmentsUnchangedError` en vez de volver a descargar la agenda.
   */
  knownRevision?: string;
}

/** Huella de agenda que entrega el gateway: hexadecimal SHA-256. */
export const ASSIGNMENTS_REVISION_PATTERN = /^[a-f0-9]{64}$/;

export class AssignmentReadCancelledError extends Error {
  readonly name = "AbortError";
  constructor() { super("La consulta de asignaciones fue cancelada."); }
}

/** El servidor confirmó que la agenda de ese día es igual a la copia local con la huella enviada. */
export class AssignmentsUnchangedError extends Error {
  readonly name = "AssignmentsUnchangedError";
  constructor(readonly revision: string) { super("ASSIGNMENTS_UNCHANGED"); }
}
