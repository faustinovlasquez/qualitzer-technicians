import type { Assignments } from "./models";

export interface AssignmentReadOptions {
  signal?: AbortSignal;
  priorityDate?: string;
  getPriorityDate?: () => string | null;
  onProgress?: (data: Assignments, loadedDates: string[]) => void;
}

export class AssignmentReadCancelledError extends Error {
  readonly name = "AbortError";
  constructor() { super("La consulta de asignaciones fue cancelada."); }
}