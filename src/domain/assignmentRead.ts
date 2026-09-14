export interface AssignmentReadOptions {
  signal?: AbortSignal;
}

export class AssignmentReadCancelledError extends Error {
  readonly name = "AbortError";
  constructor() { super("La consulta de asignaciones fue cancelada."); }
}