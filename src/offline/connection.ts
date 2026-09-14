import { ZodError } from "zod";
import { OfflineUnavailableError, type OfflineConnection } from "../domain/offline";
import { ApiError, NetworkError } from "../infrastructure/errors";

export function requiresDeployment(code: string | undefined): boolean {
  return code === "MOBILE_CREATION_SCHEMA_NOT_READY" || code === "MOBILE_SYNC_SCHEMA_NOT_READY" || code === "OFFLINE_SYNC_ROUTE_NOT_FOUND"
    || code === "MOBILE_SYNC_ACTIONS_UNAVAILABLE";
}

export function connectionErrorCode(error: unknown): string {
  if (error instanceof ApiError || error instanceof OfflineUnavailableError) return error.code;
  if (error instanceof NetworkError) return error.kind === "timeout" ? "OFFLINE_TIMEOUT_UNCERTAIN" : "OFFLINE_NETWORK_UNAVAILABLE";
  return "OFFLINE_SYNC_UNEXPECTED_RESPONSE";
}

export function isServiceFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.status >= 500 || error.status === 429 || requiresDeployment(error.code) || error.code === "UPSTREAM_INVALID_RESPONSE")
    || error instanceof SyntaxError || error instanceof ZodError
    || error instanceof Error && error.message === "CHECKLIST_ASSIGNMENT_INVALID_RESPONSE"
    || error instanceof OfflineUnavailableError && ["OFFLINE_SYNC_CONTRACT_UNAVAILABLE", "OFFLINE_CREATION_RESULT_MISMATCH", "OFFLINE_RECEIPT_ID_MISMATCH"].includes(error.code);
}

export function failedConnection(previous: OfflineConnection, error: unknown, checkedAt: number): OfflineConnection {
  const status = error instanceof ApiError && error.status === 401 ? "auth_required"
    : error instanceof NetworkError ? previous.networkConnected === false ? "offline" : "unreachable" : "service_error";
  return { ...previous, status, checkedAt, errorCode: connectionErrorCode(error) };
}