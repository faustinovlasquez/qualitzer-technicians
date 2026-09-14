import type { OfflineDeploymentCounts, OfflineOperation, OfflineOperationKind } from "../domain/offline";
import { requiresDeployment } from "./connection";

export function deploymentKinds(operation: OfflineOperation): readonly OfflineOperationKind[] | undefined {
  // Shared schema/missing-route errors do not prove which endpoint is unavailable.
  if (operation.lastError === "MOBILE_SYNC_ACTIONS_UNAVAILABLE" && (operation.kind === "timer" || operation.kind === "checklist")) return ["timer", "checklist"];
  if (operation.lastError === "MOBILE_CREATION_SCHEMA_NOT_READY" && operation.kind === "create") return ["create"];
  return undefined;
}

export function canAdvanceManualRetry(operation: OfflineOperation): boolean {
  return operation.status === "pending" && !operation.receipt && !(operation.kind === "create" && operation.result) && (requiresDeployment(operation.lastError)
    || ["OFFLINE_NETWORK_UNAVAILABLE", "OFFLINE_TIMEOUT_UNCERTAIN", "OFFLINE_CYCLE_INTERRUPTED"].includes(operation.lastError ?? ""));
}

export function deploymentWaits(operations: readonly OfflineOperation[]): Map<OfflineOperationKind, number> {
  const waits = new Map<OfflineOperationKind, number>();
  for (const operation of runnableOperations(operations)) {
    if (operation.status !== "pending" || operation.receipt || operation.kind === "create" && operation.result) continue;
    for (const kind of deploymentKinds(operation) ?? []) waits.set(kind, Math.min(waits.get(kind) ?? Infinity, operation.nextAttemptAt));
  }
  return waits;
}

export function protectDeploymentCooldown(operations: OfflineOperation[], failed: OfflineOperation): void {
  const kinds = deploymentKinds(failed);
  if (!kinds || failed.status !== "pending" || failed.receipt || failed.kind === "create" && failed.result) return;
  // Persist the actual failure's floor, including held children so later dependency release cannot evade it.
  for (const operation of operations) {
    if (operation.status !== "pending" || operation.receipt || operation.kind === "create" && operation.result
      || !kinds.includes(operation.kind) || operation.lastError !== undefined && operation.lastError !== failed.lastError) continue;
    operation.nextAttemptAt = Math.max(operation.nextAttemptAt, failed.nextAttemptAt);
    operation.lastError = failed.lastError;
  }
}

export function runnableOperations(operations: readonly OfflineOperation[]): OfflineOperation[] {
  const applied = new Set(operations.filter((operation) => operation.status === "applied").map((operation) => operation.id));
  return operations.filter((operation) => (operation.status === "pending" || operation.status === "syncing")
    && (!operation.dependencyId || applied.has(operation.dependencyId)));
}

export function awaitingDeploymentCounts(operations: readonly OfflineOperation[]): OfflineDeploymentCounts {
  const counts: OfflineDeploymentCounts = { create: 0, comment: 0, answer: 0, document: 0, timer: 0, checklist: 0 };
  const waiting = new Set<string>();
  const kinds = new Set<OfflineOperationKind>();
  for (const operation of operations) {
    if (operation.status !== "pending" || operation.receipt || !requiresDeployment(operation.lastError)) continue;
    waiting.add(operation.id);
    for (const kind of deploymentKinds(operation) ?? []) kinds.add(kind);
  }
  const pending = operations.filter((operation) => operation.status === "pending" || operation.status === "syncing");
  for (const operation of pending) if (kinds.has(operation.kind)) waiting.add(operation.id);
  // Dependency order is not guaranteed in restored queues; propagate without bypassing a held parent.
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of pending) {
      if (!waiting.has(operation.id) && operation.dependencyId && waiting.has(operation.dependencyId)) {
        waiting.add(operation.id);
        changed = true;
      }
    }
  }
  for (const operation of pending) if (waiting.has(operation.id)) counts[operation.kind]++;
  return counts;
}