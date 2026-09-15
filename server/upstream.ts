import { z } from "zod";
import { GatewayError } from "./errors";
import { receiptForOperation, syncErrorSchema, syncOperationIdSchema, syncReceiptSchema, type SyncReceipt } from "../src/domain/offlineProtocol";

export const MOBILE_USER_AGENT = "Qualitzer-Mobile/1.0 (Mobile; Gateway)";
type BackendPath = "/auth/login" | "/auth/me" | "/auth/logout" | "/auth/forced_password" |
  "/auth/mobile/prepare" | "/auth/mobile/exchange" | "/companies/branding" | `/branches/${number}` |
  "/mobile-sync/commands" | "/mobile-sync/documents" | `/mobile-sync/receipts/${string}` |
  "/technician-dashboard/assignments" | "/technician-dashboard/update-work-status" |
  "/technician-dashboard/mobile-creations" | "/technician-dashboard/mobile-creations/options" |
  "/mobile-notifications/status" | "/mobile-notifications/device" | "/mobile-notifications/inbox" | "/mobile-notifications/test" |
  `/mobile-notifications/device/${string}` | `/mobile-notifications/inbox/${string}/read` | `/mobile-notifications/inbox/${string}` |
  `/works/activity-checklist-steps/${number}` | `/maintenances/works/steps/${number}/response` |
  `/work_files/${number}` | `/maintenance_files/${number}` | `/maintenances/works/${number}/files` |
  `/maintenances/works/steps/${number}/files` | `/works/comments/${number}` |
  `/negotiation_files/${number}` | `/files/${number}` |
  `/maintenances/${number}` | `/maintenances/${number}/start-repair` | `/maintenances/${number}/finalize` |
  `/technician-dashboard/panel/${string}/works/${number}/comments` |
  `/technician-dashboard/panel/${string}/works/${number}/checklists/options` |
  `/technician-dashboard/panel/${string}/works/${number}/checklists` |
  `/technician-dashboard/panel/${string}/works/${number}/activities` |
  `/technician-dashboard/panel/${string}/works/${number}/activities/${number}/complete` |
  `/technician-dashboard/panel/${string}/works/${number}/activities/${number}/files` |
  `/technician-dashboard/panel/${string}/works/${number}/reopen` |
  `/technician-dashboard/panel/${string}/works/${number}/steps/${number}/files`;
interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  onResponse?: (metadata: { status: number; idempotencyReplayed: string | null }) => void;
  token?: string;
  query?: URLSearchParams;
  json?: unknown;
  form?: FormData;
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new GatewayError(502, "UPSTREAM_RESPONSE_TOO_LARGE");
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export class Upstream {
  private readonly config: { backendUrl: string; tenantOrigin: string };

  constructor(config: { backendUrl: string; tenantOrigin?: string }) {
    if (!config.tenantOrigin) throw new Error("UPSTREAM_TENANT_BINDING_REQUIRED");
    this.config = { backendUrl: config.backendUrl, tenantOrigin: config.tenantOrigin };
  }

  async request(path: BackendPath, options: RequestOptions = {}): Promise<unknown> {
    return this.performRequest(path, options);
  }

  async requestReceipt(path: "/mobile-sync/commands" | "/mobile-sync/documents" | `/mobile-sync/receipts/${string}`, operationId: string, options: RequestOptions = {}): Promise<{ status: number; receipt: SyncReceipt }> {
    const id = syncOperationIdSchema.parse(operationId);
    const method = options.method ?? "GET";
    if (!((path === "/mobile-sync/commands" || path === "/mobile-sync/documents") && method === "POST") && !(path === `/mobile-sync/receipts/${id}` && method === "GET")) throw new GatewayError(400, "INVALID_INPUT");
    let status = 200;
    const result = await this.performRequest(path, { ...options, onResponse: (metadata) => { status = metadata.status; } }, id);
    const receipt = syncReceiptSchema.safeParse(result);
    if (!receipt.success || receipt.data.operationId !== id) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    return { status, receipt: receipt.data };
  }

  private async performRequest(path: BackendPath, options: RequestOptions, receiptOperationId?: string): Promise<unknown> {
    const url = new URL(`${this.config.backendUrl}${path}`);
    if (options.query) url.search = options.query.toString();
    const headers = new Headers({ Origin: this.config.tenantOrigin, "User-Agent": MOBILE_USER_AGENT, Accept: "application/json", "Cache-Control": "no-cache" });
    if (options.token) headers.set("Authorization", options.token);
    if (options.json !== undefined) headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path === "/companies/branding" || /^\/branches\/[1-9]\d*$/.test(path) ? 2_500 : options.form ? 120_000 : 25_000);
    timeout.unref();
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET", headers, redirect: "manual", signal: controller.signal,
        body: options.form ?? (options.json === undefined ? undefined : JSON.stringify(options.json)),
      });
      if (receiptOperationId !== undefined) {
        const text = await readBody(response);
        let data: unknown;
        try { data = JSON.parse(text); } catch { data = null; }
        const receipt = receiptForOperation(data, receiptOperationId, response.status);
        if (receipt) {
          options.onResponse?.({ status: response.status, idempotencyReplayed: null });
          return receipt;
        }
        if (response.status === 401) throw new GatewayError(401, "UNAUTHORIZED");
        if (data !== null && typeof data === "object" && ("operationId" in data || "state" in data)) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
        const error = z.object({ error: syncErrorSchema }).safeParse(data);
        if (error.success && [400, 403, 404, 409, 413, 415, 429, 503].includes(response.status)) {
          if (response.status === 404 && error.data.error === "MOBILE_SYNC_RECEIPT_NOT_FOUND" && path.startsWith("/mobile-sync/receipts/")) throw new GatewayError(404, "OFFLINE_RECEIPT_NOT_FOUND");
          throw new GatewayError(response.status, error.data.error);
        }
        if (response.status === 404) throw new GatewayError(404, "OFFLINE_SYNC_ROUTE_NOT_FOUND");
        if ([400, 403, 409, 413, 415, 429].includes(response.status)) throw new GatewayError(response.status, "UPSTREAM_REJECTED");
        throw new GatewayError(response.status >= 500 ? 503 : 502, "UPSTREAM_INVALID_RESPONSE");
      }
      if (!response.ok) {
        if ((path.startsWith("/mobile-notifications/") || path.startsWith("/technician-dashboard/mobile-creations")) && [400, 401, 403, 404, 409, 429, 500, 503].includes(response.status)) {
          const text = await readBody(response);
          let failure: unknown;
          try { failure = JSON.parse(text); } catch { failure = null; }
          const parsed = z.object({ error: z.string().regex(/^(?:MOBILE_PUSH_[A-Z_]+|MOBILE_CREATION_[A-Z_]+|NON_PRODUCTIVE_REASON_TEXT_REQUIRED|UNAUTHORIZED)$/) }).safeParse(failure);
          if (parsed.success) throw new GatewayError(response.status, parsed.data.error, mobileErrorMessage(parsed.data.error));
        }
        await response.body?.cancel();
        if (response.status === 401) throw new GatewayError(401, "UNAUTHORIZED");
        if (response.status === 403) throw new GatewayError(403, "FORBIDDEN");
        if (response.status === 404) throw new GatewayError(404, "RESOURCE_NOT_FOUND");
        if ([400, 409, 413, 422, 429].includes(response.status)) throw new GatewayError(response.status, "UPSTREAM_REJECTED", "El backend rechazó la operación.");
        throw new GatewayError(502, "UPSTREAM_ERROR");
      }
      options.onResponse?.({ status: response.status, idempotencyReplayed: response.headers.get("Idempotency-Replayed") });
      const body = await readBody(response);
      if (!body.trim()) return null;
      let data: unknown;
      try { data = JSON.parse(body); } catch { throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE"); }
      const envelope = z.object({ success: z.boolean().optional(), error: z.unknown().optional() }).safeParse(data);
      if (envelope.success && (envelope.data.success === false || envelope.data.error != null)) {
        throw new GatewayError(502, "UPSTREAM_REJECTED");
      }
      return data;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE");
    } finally { clearTimeout(timeout); }
  }

  async reachable(): Promise<boolean> {
    try { await this.request("/auth/me"); return true; }
    catch (error) { return error instanceof GatewayError && error.status === 401; }
  }
}

function mobileErrorMessage(code: string): string {
  if (code === "MOBILE_CREATION_REQUEST_CONFLICT") return "Este intento ya se usó con otros datos. Inicia una nueva creación; para reintentar, conserva los datos originales.";
  if (code === "MOBILE_CREATION_MAINTENANCE_WEB_WIZARD_REQUIRED") return "Este mantenimiento requiere el asistente web.";
  if (code.includes("TIMEZONE")) return "La sucursal necesita una zona horaria válida configurada en el servidor.";
  if (code.includes("SCHEMA") || code === "MOBILE_PUSH_UNAVAILABLE") return "La función no está habilitada o requiere completar el despliegue del servidor.";
  if (code === "MOBILE_PUSH_TEST_RATE_LIMIT") return "Se alcanzó el límite de cinco pruebas por hora.";
  if (code.includes("LOCAL_TIME") || code.includes("DST_TRANSITION")) return "El horario coincide con un cambio de hora. Selecciona otra franja.";
  return "El servidor no pudo completar la operación. Comprueba los datos y la configuración de la sucursal.";
}