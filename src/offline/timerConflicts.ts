import type { OfflineOperation } from "../domain/offline";
import type { OfflineState } from "./contracts";

type Intention = Extract<OfflineOperation, { kind: "timer" | "completion" }>;
export type ServerWorkStatus = "pending" | "in_progress" | "paused" | "completed" | "delivered";

/** Conflictos que se resuelven releyendo el estado real: el servidor rechazó la base, no el contenido. */
export function isStatusConflict(operation: OfflineOperation): operation is Intention {
  if (operation.kind !== "timer" && operation.kind !== "completion") return false;
  const code = operation.receipt?.error ?? operation.lastError;
  return (operation.status === "conflict" && code === "MOBILE_SYNC_STATUS_CONFLICT")
    || (operation.status === "blocked" && code === "MOBILE_SYNC_INVALID_STATUS");
}

function sameScope(left: Intention["scope"], right: Intention["scope"]): boolean {
  return left.companyBranchId === right.companyBranchId && left.groupId === right.groupId && left.workId === right.workId
    && left.startDate === right.startDate && left.endDate === right.endDate;
}

/** Ámbitos (trabajo + fecha) con un cronómetro o entrega en conflicto de estado, listos para resolverse. */
export function conflictedTimerScopes(state: OfflineState): Intention["scope"][] {
  const scopes: Intention["scope"][] = [];
  for (const operation of state.operations) {
    if (!isStatusConflict(operation) || scopes.some(scope => sameScope(scope, operation.scope))) continue;
    // No se reescribe una cadena mientras alguna de sus operaciones se está enviando.
    if (state.operations.some(entry => (entry.kind === "timer" || entry.kind === "completion") && sameScope(entry.scope, operation.scope) && entry.status === "syncing")) continue;
    scopes.push(operation.scope);
  }
  return scopes;
}

export interface TimerRebaseResult { replaced: Array<{ from: string; to: string }>; resolved: string[]; }

/**
 * Reescribe la cadena local de inicio/pausa/entrega de un trabajo sobre el estado real del servidor.
 * Conserva la hora en que el técnico tocó cada botón (recordedAt) y su reloj local; solo cambia la base y el identificador,
 * porque el identificador anterior ya tiene un recibo de conflicto en el servidor y no puede reutilizarse con otro contenido.
 * Las intenciones que el servidor ya refleja (o que dejaron de ser posibles) se retiran y liberan las operaciones que esperaban por ellas.
 */
export function rebaseTimerChain(state: OfflineState, scope: Intention["scope"], serverStatus: ServerWorkStatus, uuid: () => string): TimerRebaseResult {
  const chain = state.operations
    .filter((entry): entry is Intention => (entry.kind === "timer" || entry.kind === "completion") && sameScope(entry.scope, scope) && entry.status !== "applied")
    .sort((left, right) => left.createdAt - right.createdAt);
  const result: TimerRebaseResult = { replaced: [], resolved: [] };
  if (!chain.some(isStatusConflict) || chain.some(entry => entry.status === "syncing")) return result;
  const rename = new Map<string, string | undefined>();
  let base: ServerWorkStatus = serverStatus;
  let previousTimer: string | undefined;
  const rebuilt: Intention[] = [];
  for (const operation of chain) {
    // Una operación ya enviada sin conflicto de estado (otro error) no se toca: sigue su propio camino de revisión.
    if (operation.receipt && !isStatusConflict(operation)) { rebuilt.push(operation); continue; }
    const fresh = { id: uuid(), status: "pending" as const, attempts: 0, nextAttemptAt: 0, lastError: undefined, receipt: undefined, contractRecoveryVersion: undefined };
    if (operation.kind === "timer") {
      const target = operation.payload.status;
      const valid = target === "paused" ? base === "in_progress" : base === "pending" || base === "paused";
      if (base === target || !valid) { rename.set(operation.id, previousTimer); result.resolved.push(operation.id); continue; }
      const next: Intention = { ...operation, ...fresh, dependencyId: previousTimer,
        payload: { ...operation.payload, baseStatus: base as "pending" | "in_progress" | "paused", previousOperationId: previousTimer } };
      if (!previousTimer) delete next.payload.previousOperationId;
      if (!next.dependencyId) delete next.dependencyId;
      rename.set(operation.id, next.id); result.replaced.push({ from: operation.id, to: next.id });
      rebuilt.push(next); base = target; previousTimer = next.id;
      continue;
    }
    const target = operation.payload.input.status;
    if (base === target || base === "completed" || base === "delivered") { rename.set(operation.id, undefined); result.resolved.push(operation.id); continue; }
    const next: Intention = { ...operation, ...fresh, dependencyId: undefined,
      payload: { ...operation.payload, baseStatus: base, previousTimerOperationId: previousTimer } };
    if (!previousTimer) delete next.payload.previousTimerOperationId;
    delete next.dependencyId;
    rename.set(operation.id, next.id); result.replaced.push({ from: operation.id, to: next.id });
    rebuilt.push(next); base = target;
  }
  for (const entry of rebuilt) for (const key of Object.keys(entry) as Array<keyof Intention>) if (entry[key] === undefined) delete entry[key];
  const replacement = new Map<string, Intention>();
  for (const item of rebuilt) {
    const from = result.replaced.find(entry => entry.to === item.id)?.from ?? item.id;
    replacement.set(from, item);
  }
  const removed = new Set(chain.map(entry => entry.id));
  state.operations = state.operations.flatMap(entry => !removed.has(entry.id) ? [entry] : replacement.has(entry.id) ? [replacement.get(entry.id)!] : []);
  // Las demás operaciones apuntan ahora al reemplazo; las que esperaban una intención retirada quedan libres.
  for (const entry of state.operations) {
    if (entry.dependencyId && rename.has(entry.dependencyId)) {
      const target = rename.get(entry.dependencyId);
      if (target) entry.dependencyId = target; else delete entry.dependencyId;
    }
    if (entry.kind === "completion") entry.prerequisiteIds = entry.prerequisiteIds.flatMap(id => rename.has(id) ? (rename.get(id) ? [rename.get(id)!] : []) : [id]);
  }
  return result;
}
