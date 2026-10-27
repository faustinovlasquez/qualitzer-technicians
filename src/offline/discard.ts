import type { OfflineOperation } from "../domain/offline";

/** Estados terminales que el técnico puede descartar: el servidor ya los rechazó, chocaron o quedaron en revisión. */
export const DISCARDABLE_STATUSES: readonly OfflineOperation["status"][] = ["blocked", "conflict", "needs_review"];

/**
 * Lo que se descarta junto con una operación: las que dependen de ella (encadenadas, prerrequisitos de una entrega o,
 * si es la creación de un trabajo, todo lo hecho en ese trabajo local). Nunca incluye operaciones ya aplicadas.
 */
export function discardSet(operations: readonly OfflineOperation[], id: string): OfflineOperation[] {
  const target = operations.find((entry) => entry.id === id);
  if (!target) return [];
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const op of operations) {
      if (ids.has(op.id) || op.status === "applied") continue;
      const dependent = (op.dependencyId !== undefined && ids.has(op.dependencyId))
        || (op.kind === "completion" && op.prerequisiteIds.some((prerequisite) => ids.has(prerequisite)))
        || (target.kind === "create" && op.kind !== "create" && (op.scope.groupId === target.localGroupId || op.scope.workId === target.localWorkId));
      if (dependent) { ids.add(op.id); grew = true; }
    }
  }
  return operations.filter((op) => ids.has(op.id));
}
