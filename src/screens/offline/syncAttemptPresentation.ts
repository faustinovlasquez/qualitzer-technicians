import type { OfflineController, OfflineSnapshot } from "../../domain/offline";
import { ApiError } from "../../infrastructure/errors";
import { requiresDeployment } from "../../offline/connection";
import { userActionError, syncUserError } from "./syncUserPresentation";

export interface SyncAttemptBaseline { appliedIds: ReadonlySet<string>; known: boolean; }
export interface SyncAttempt {
  before: SyncAttemptBaseline;
  failure?: { error: unknown };
}
export interface SyncAttemptFeedback {
  title: string;
  detail: string;
  tone: "success" | "warning" | "error" | "info";
  applied: number;
  nextAttemptAt?: number;
}

export function captureSyncAttempt(snapshot: OfflineSnapshot | null): SyncAttemptBaseline {
  return { known: snapshot !== null, appliedIds: new Set(snapshot?.operations.filter((operation) => operation.status === "applied").map((operation) => operation.id) ?? []) };
}

export function requestManualSync(controller: OfflineController): Promise<void> {
  return controller.requestSync ? controller.requestSync() : controller.syncNow();
}

export function syncSnapshotKey(snapshot: OfflineSnapshot | null): string {
  if (!snapshot) return "unknown";
  return JSON.stringify([snapshot.online, snapshot.authBlocked, snapshot.syncing, snapshot.pending, snapshot.conflicts,
    snapshot.lastError, snapshot.lastSyncedAt, snapshot.connection, snapshot.awaitingDeploymentByKind,
    snapshot.operations.map(({ id, status, attempts, nextAttemptAt, lastError }) => [id, status, attempts, nextAttemptAt, lastError])]);
}

export function deploymentPendingCount(snapshot: OfflineSnapshot): number {
  if (snapshot.awaitingDeploymentByKind) return Object.values(snapshot.awaitingDeploymentByKind).reduce((total, count) => total + count, 0);
  return snapshot.operations.filter((operation) => operation.status !== "applied" && requiresDeployment(operation.lastError)).length;
}

export function syncAttemptPresentation(attempt: SyncAttempt, snapshot: OfflineSnapshot | null): SyncAttemptFeedback {
  const applied = snapshot && attempt.before.known ? new Set(snapshot.operations.filter((operation) => operation.status === "applied" && !attempt.before.appliedIds.has(operation.id)).map((operation) => operation.id)).size : 0;
  const sent = applied === 1 ? "Se envió 1 cambio" : `Se enviaron ${applied} cambios`;
  const error = attempt.failure?.error;
  if (snapshot?.authBlocked || snapshot?.connection?.status === "auth_required" || error instanceof ApiError && error.status === 401) {
    return { title: "Verifica tu sesión", detail: "Vuelve a ingresar con la misma cuenta. Los pendientes se conservan.", tone: "error", applied };
  }
  if (attempt.failure) return { title: applied > 0 ? `${sent}; ocurrió un error` : "No se pudo completar el envío", detail: userActionError(error), tone: "error", applied };
  if (!snapshot) return { title: "No se pudo comprobar la cola", detail: "El estado de los pendientes aún no está disponible.", tone: "info", applied };
  const awaiting = deploymentPendingCount(snapshot);
  const deployment = awaiting > 0 ? `${awaiting} ${awaiting === 1 ? "cambio requiere" : "cambios requieren"} actualizar el servicio. Contacta a soporte.` : "";
  const pending = snapshot.pending;
  const title = applied > 0 ? `${sent}; ${pending === 1 ? "queda 1 pendiente" : `quedan ${pending} pendientes`}`
    : pending > 0 ? `Hay ${pending === 1 ? "1 pendiente" : `${pending} pendientes`}` : "No se pudo confirmar el estado";
  const problem = snapshot.lastError ?? snapshot.connection?.errorCode;
  if (problem && !requiresDeployment(problem) && !["OFFLINE_NETWORK_UNAVAILABLE", "OFFLINE_TIMEOUT_UNCERTAIN", "OFFLINE_CYCLE_INTERRUPTED", "MOBILE_SYNC_IN_PROGRESS"].includes(problem)) {
    return { title: applied > 0 ? title : "No se pudo completar el envío", detail: syncUserError(problem), tone: "error", applied };
  }
  if (awaiting > 0) return { title, detail: deployment, tone: "warning", applied };
  if (snapshot.conflicts > 0 || snapshot.operations.some((operation) => ["blocked", "conflict", "needs_review", "auth_required"].includes(operation.status))) {
    return { title, detail: "Hay cambios que requieren revisión en el registro de operaciones.", tone: "warning", applied };
  }
  const known = snapshot.online && !snapshot.syncing && (!snapshot.connection || snapshot.connection.status === "ready")
    && pending === 0 && snapshot.operations.every((operation) => operation.status === "applied");
  if (known) return { title: applied > 0 ? `${sent}; no quedan pendientes` : "No hay cambios pendientes", detail: "Cola comprobada.", tone: "success", applied };
  if (pending > 0) {
    const attempts = snapshot.operations.filter((operation) => operation.status === "pending" && Number.isFinite(operation.nextAttemptAt) && operation.nextAttemptAt > 0).map((operation) => operation.nextAttemptAt);
    return { title, detail: snapshot.connection?.foreground === false ? "Vuelve a la app para continuar el envío automático."
      : snapshot.connection?.status === "offline" ? "Se reintentará automáticamente cuando haya conexión." : "Reintento automático.",
      tone: "info", applied, nextAttemptAt: attempts.length ? Math.min(...attempts) : undefined };
  }
  return { title, detail: "Espera a que se verifique la conexión y la cola.", tone: "info", applied };
}

export function syncAttemptMessage(feedback: SyncAttemptFeedback, now = Date.now()): string {
  const seconds = feedback.nextAttemptAt === undefined ? null : Math.max(0, Math.ceil((feedback.nextAttemptAt - now) / 1000));
  return `${feedback.title}. ${feedback.detail}${seconds !== null && seconds > 0 ? ` Próximo intento previsto en ${seconds} s.` : ""}`;
}