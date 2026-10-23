import { z } from "zod";
import { GatewayError } from "./errors";
import { receiptForOperation, syncErrorSchema, syncOperationIdSchema, syncReceiptSchema, type SyncReceipt } from "../src/domain/offlineProtocol";

export const MOBILE_USER_AGENT = "Qualitzer-Mobile/1.0 (Mobile; Gateway)";
/** Rechazos 401 del backend que son falta de permiso, no sesión inválida. */
const NOT_SESSION_401 = ["PERMISSION_REQUIRED", "MAINTENANCE_REOPEN_UNAUTHORIZED", "MAINTENANCE_REOPEN_FORBIDDEN", "TENANT_TYPE_NOT_ALLOWED"] as const;
type BackendPath = "/auth/login" | "/auth/me" | "/auth/logout" | "/auth/forced_password" |
  `/technician-dashboard/panel/${string}/works/${number}/edit` |
  "/user_signatures/me" | `/user_signatures/me/${number}` |
  "/profiles/me" | "/profiles/me/avatar" |
  "/worker-locations/batch" | "/worker-locations/me" |
  "/inventory_consumptions_v2/my-receipts" | "/inventory_consumptions_v2/my-receipts/confirm" | `/inventory_consumptions_v2/my-receipts/${number}/dispositions` |
  "/workshops/select" | "/operation_area/dashboard" |
  `/operation_area_entries/${number}` | `/equipment_dispatches/inspections/by-entry/${number}/compliance` |
  `/branches/${number}/inspectionRequirementsConfig` | "/equipment_masters/required_photos" | "/works" | `/works/${number}` | "/negotiations" | "/maintenances" |
  "/operation_area_entries" | "/operation_area/select" | "/customers/select" | `/customers/${number}` | `/customer_branches/select/${number}` |
  "/customers" | `/customers/${number}/contacts` | "/customer_branches" | "/DocumentsSalesCountries/select" |
  `/customers_equipments/customers/${number}` | "/rental_equipments" | "/checklists" | "/equipment_dispatches/inspections/ensure" |
  `/equipment_dispatches/inspections/${number}` | `/equipment_dispatches/inspections/${number}/${"checklists" | "patio-context" | "checklist-steps" | "photos" | "damages" | "meta" | "complete" | "public-link/extend"}` |
  `/equipment_dispatches/inspections/${number}/photos/${string}` | `/equipment_dispatches/inspections/checklist-steps/${number}/files` |
  `/equipment_dispatches/inspections/checklist-steps/files/${number}` | `/equipment_dispatches/inspections/damages/${number}/files` |
  "/select/employees" | "/user_signatures/options" | "/works/link-entry" | "/works/link-negotiation" |
  "/master_commercial/business-type-select-by-branch" | "/master_commercial/segments/selects" | "/master_commercial/taxes" | `/branches/${number}/negotiationFieldsConfig` | `/branches/${number}/mobileAppConfig` |
  `/negotiations/${number}/send-to-commercial` | `/negotiations/${number}/work-order` | `/negotiations/${number}` | `/negotiations/${number}/update_fields` | "/commercial_transport/select" | "/products" | "/customer_origins/select" | "/master_commercial/tags/selects" | "/customers_equipments" | `/equipment_masters/${"types" | "manufacturers" | "models" | "classifications"}/select` | `/operation_area_entries/${number}/deliver` |
  "/operation_area_entries/move" | `/operation_area_entries/${number}/estimated-delivery-date` | "/master_commercial/get-all-status" | `/operation_area_entries/${number}/change-status` |
  "/auth/mobile/prepare" | "/auth/mobile/exchange" | "/companies/branding" | `/branches/${number}` |
  "/mobile-sync/commands" | "/mobile-sync/documents" | `/mobile-sync/receipts/${string}` |
  "/technician-dashboard/assignments" | "/technician-dashboard/update-work-status" |
  "/technician-dashboard/mobile-creations" | "/technician-dashboard/mobile-creations/options" |
  "/mobile-diagnostics/errors" |
  "/mobile-notifications/status" | "/mobile-notifications/active-timers" | "/mobile-notifications/device" | "/mobile-notifications/inbox" | "/mobile-notifications/test" |
  `/mobile-notifications/device/${string}` | `/mobile-notifications/inbox/${string}/read` | `/mobile-notifications/inbox/${string}` |
  `/works/activity-checklist-steps/${number}` | `/maintenances/works/steps/${number}/response` |
  `/work_files/${number}` | `/maintenance_files/${number}` | `/maintenances/works/${number}/files` |
  `/maintenances/works/steps/${number}/files` | `/works/comments/${number}` |
  `/negotiation_files/${number}` | `/files/${number}` |
  `/maintenances/${number}` | `/maintenances/${number}/start-repair` | `/maintenances/${number}/finalize` |
  `/maintenances/${number}/technician-delivery` |
  `/technician-dashboard/panel/${string}/works/${number}/comments` |
  `/technician-dashboard/panel/${string}/works/${number}/checklists/options` |
  `/technician-dashboard/panel/${string}/works/${number}/checklists` |
  `/technician-dashboard/panel/${string}/works/${number}/activities` |
  `/technician-dashboard/panel/${string}/works/${number}/activities/${number}/complete` |
  `/technician-dashboard/panel/${string}/works/${number}/activities/${number}` |
  `/technician-dashboard/panel/${string}/works/${number}/activities/${number}/files` |
  `/technician-dashboard/panel/${string}/works/${number}/activities/${number}/files/${number}` |
  `/technician-dashboard/panel/${string}/works/${number}/reopen` |
  `/technician-dashboard/panel/${string}/works/${number}/equipment-location/${"work" | "group"}` |
  `/technician-dashboard/panel/${string}/works/${number}/steps/${number}/files`;
interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  onResponse?: (metadata: { status: number; idempotencyReplayed: string | null }) => void;
  token?: string;
  query?: URLSearchParams;
  json?: unknown;
  form?: FormData;
  /** Capacidades que el gateway declara al backend (por ejemplo, entender solicitudes de devolución con cantidad). */
  capabilities?: Record<`x-qualitzer-${string}`, string>;
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

  /** Dirección web de la empresa (la misma que identifica a la empresa ante el backend). Sirve para armar enlaces públicos. */
  get webOrigin(): string {
    return this.config.tenantOrigin;
  }

  /** Descarga un archivo del backend (por ejemplo, el .zip de fotos de una inspección), con tope de tamaño. */
  async download(path: `/equipment_dispatches/inspections/photos/download/${number}`, token: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
    const headers = new Headers({ Origin: this.config.tenantOrigin, "User-Agent": MOBILE_USER_AGENT, Authorization: token, "Cache-Control": "no-cache" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    timeout.unref();
    try {
      const response = await fetch(new URL(`${this.config.backendUrl}${path}`), { headers, redirect: "manual", signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new GatewayError(401, "UNAUTHORIZED");
        if (response.status === 404) throw new GatewayError(404, "RESOURCE_NOT_FOUND", "La inspección todavía no tiene fotos para descargar.");
        throw new GatewayError(502, "UPSTREAM_ERROR");
      }
      const declared = Number(response.headers.get("Content-Length") ?? "0");
      if (declared > maxBytes) { await response.body?.cancel(); throw new GatewayError(413, "DOWNLOAD_TOO_LARGE", "El comprimido es demasiado grande para el teléfono. Descárgalo desde la web."); }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new GatewayError(413, "DOWNLOAD_TOO_LARGE", "El comprimido es demasiado grande para el teléfono. Descárgalo desde la web.");
      return { bytes, contentType: response.headers.get("Content-Type") ?? "application/zip" };
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(503, "UPSTREAM_UNAVAILABLE");
    } finally { clearTimeout(timeout); }
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
    for (const [name, value] of Object.entries(options.capabilities ?? {})) headers.set(name, value);
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
        if (path === "/inventory_consumptions_v2/my-receipts/confirm" && [404, 409].includes(response.status)) {
          let data: unknown;
          try { data = JSON.parse(await readBody(response)); } catch { data = null; }
          const failure = z.object({ error: z.enum(["CONSUMPTION_NOT_FOUND", "CONSUMPTION_VERSION_CONFLICT", "CONSUMPTION_RECEIPT_NOT_PENDING", "CONSUMPTION_RECEIPT_LOCATION_EXPIRED", "CONSUMPTION_REQUEST_ID_REUSED"]) }).safeParse(data);
          if (failure.success) throw new GatewayError(response.status, failure.data.error);
          throw new GatewayError(response.status, "UPSTREAM_REJECTED");
        }
        if (/^\/inventory_consumptions_v2\/my-receipts\/[1-9]\d*\/dispositions$/.test(path) && [404, 409].includes(response.status)) {
          let data: unknown;
          try { data = JSON.parse(await readBody(response)); } catch { data = null; }
          const failure = z.object({ error: z.enum(["CONSUMPTION_NOT_FOUND", "CONSUMPTION_VERSION_CONFLICT", "CONSUMPTION_RECEIPT_NOT_CONFIRMED", "CONSUMPTION_DISPOSITION_CLOSED", "CONSUMPTION_DISPOSITION_RETURN_PROCESSED"]) }).safeParse(data);
          if (failure.success) throw new GatewayError(response.status, failure.data.error);
          throw new GatewayError(response.status, "UPSTREAM_REJECTED");
        }
        if (/\/works\/[1-9]\d*\/edit$/.test(path)) {
          let data: unknown;
          try { data = JSON.parse(await readBody(response)); } catch { data = null; }
          const failure = z.object({ error: z.enum(["WORK_EDIT_CONFLICT", "WORK_EDIT_INVALID_INPUT", "WORK_EDIT_NOT_AVAILABLE", "WORK_EDIT_MAINTENANCE_REQUIRED", "WORK_EQUIPMENT_INHERITED", "WORK_SCHEDULE_READ_ONLY", "WORK_SPECIALTY_READ_ONLY", "WORK_READ_ONLY", "PANEL_WORK_NOT_FOUND", "MOBILE_CREATION_EQUIPMENT_NOT_FOUND", "MOBILE_CREATION_SPECIALTY_NOT_FOUND", "MOBILE_CREATION_TIMEZONE_NOT_CONFIGURED"]) }).safeParse(data);
          if (failure.success && [400, 404, 409].includes(response.status)) throw new GatewayError(response.status, failure.data.error);
          if (response.status === 401) throw new GatewayError(401, "UNAUTHORIZED");
          if (response.status === 404) throw new GatewayError(503, "WORK_EDIT_NOT_AVAILABLE");
          throw new GatewayError(response.status >= 500 ? 503 : response.status, "UPSTREAM_REJECTED");
        }
        if (/\/equipment-location\/(?:work|group)$/.test(path) && [400, 401, 404, 409].includes(response.status)) {
          const text = await readBody(response);
          let value: unknown;
          try { value = JSON.parse(text); } catch { value = null; }
          const failure = z.object({ error: z.enum(["PERMISSION_REQUIRED", "EQUIPMENT_LOCATION_CHANGED", "EQUIPMENT_LOCATION_NOT_AVAILABLE", "EQUIPMENT_NOT_FOUND", "EQUIPMENT_LOCATION_INVALID_ADDRESS", "EQUIPMENT_LOCATION_INVALID_COORDINATES", "EQUIPMENT_LOCATION_ADDRESS_REQUIRED", "EQUIPMENT_LOCATION_INVALID_INPUT"]) }).safeParse(value);
          if (failure.success) {
            const code = failure.data.error;
            const message = code === "PERMISSION_REQUIRED" ? "No tienes permiso para editar la ubicación de este equipo."
              : code === "EQUIPMENT_LOCATION_CHANGED" ? "La ubicación o el equipo cambió. Actualiza la ficha antes de guardar."
              : code === "EQUIPMENT_LOCATION_NOT_AVAILABLE" || code === "EQUIPMENT_NOT_FOUND" ? "No hay una ubicación de equipo disponible para esta asignación."
              : "Revisa la dirección y las coordenadas del equipo.";
            throw new GatewayError(code === "PERMISSION_REQUIRED" ? 403 : response.status, code, message);
          }
          throw new GatewayError(response.status, response.status === 401 ? "UNAUTHORIZED" : "UPSTREAM_REJECTED");
        }
        if (WORKSHOP_BACKEND_PATH.test(path) && [400, 403, 404, 409, 413].includes(response.status)) {
          let failure: unknown;
          try { failure = JSON.parse(await readBody(response)); } catch { failure = null; }
          const parsed = z.object({ error: z.string().regex(WORKSHOP_ERROR_CODE) }).safeParse(failure);
          if (parsed.success) throw new GatewayError(response.status, parsed.data.error, workshopErrorMessage(parsed.data.error));
          if (response.status === 403) throw new GatewayError(403, "FORBIDDEN");
          if (response.status === 404) throw new GatewayError(404, "RESOURCE_NOT_FOUND");
          throw new GatewayError(response.status, "UPSTREAM_REJECTED", "El backend rechazó la operación.");
        }
        if ((path.startsWith("/mobile-notifications/") || path.startsWith("/technician-dashboard/mobile-creations") || path.startsWith("/user_signatures/") || path.startsWith("/profiles/me")) && [400, 401, 403, 404, 409, 429, 500, 503].includes(response.status)) {
          const text = await readBody(response);
          let failure: unknown;
          try { failure = JSON.parse(text); } catch { failure = null; }
          const parsed = z.object({ error: z.string().regex(/^(?:MOBILE_PUSH_[A-Z_]+|MOBILE_CREATION_[A-Z_]+|USER_SIGNATURE_[A-Z_]+|OWN_PROFILE_[A-Z_]+|NON_PRODUCTIVE_REASON_TEXT_REQUIRED|UNAUTHORIZED)$/) }).safeParse(failure);
          if (parsed.success) throw new GatewayError(response.status, parsed.data.error, mobileErrorMessage(parsed.data.error));
        }
        if (response.status === 401) {
          // El backend también responde 401 cuando falta un permiso; eso no invalida la sesión y no debe cerrarla en el teléfono.
          const text = await readBody(response);
          let failure: unknown;
          try { failure = JSON.parse(text); } catch { failure = null; }
          const denied = z.object({ error: z.enum(NOT_SESSION_401) }).safeParse(failure);
          if (denied.success) throw new GatewayError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
          throw new GatewayError(401, "UNAUTHORIZED");
        }
        await response.body?.cancel();
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

/** Rutas del backend que usa el taller: sus códigos de error se conservan para mostrarlos en español. */
const WORKSHOP_BACKEND_PATH = /^\/(?:operation_area|operation_area_entries|operation_area_departures|equipment_dispatches|negotiations|works\/technician|works\/link-negotiation|works\/link-entry|customers_equipments)(?:\/|$)/;
const WORKSHOP_ERROR_CODE = /^(?:OPERATION_AREA_[A-Z_]+|ENTRY_[A-Z_]+|DEPARTURE_[A-Z_]+|RECEIVER_[A-Z_]+|NEGOTIATION_[A-Z_]+|INSPECTION_[A-Z_]+|WORK_ORDER_[A-Z_]+|EQUIPMENT_IDENTIFICATION_EXISTS|ONLY_WORK_ORDERS_CAN_BE_DELETED|WORKS_ALREADY_LINKED|WORKER_NOT_FOUND|INVALID_[A-Z_]+)$/;

export function workshopErrorMessage(code: string): string {
  if (code === "OPERATION_AREA_FULL") return "La nave está llena. Elige otra nave o libera un espacio.";
  if (code === "OPERATION_AREA_SLOTS_NOT_CONFIGURED") return "La nave no tiene espacios configurados. Pide que la configuren en la web.";
  if (code === "INVALID_OPERATION_AREA") return "Elige una nave válida.";
  if (code === "ENTRY_NOT_IN_SOURCE_OPERATION_AREA") return "El equipo ya no está en esa nave. Actualiza el tablero.";
  if (code === "ENTRY_NOT_FOUND") return "El ingreso ya no existe o fue eliminado. Actualiza el tablero.";
  if (code === "DEPARTURE_ALREADY_EXISTS") return "Este equipo ya fue entregado.";
  if (code === "RECEIVER_NAME_REQUIRED") return "Indica el nombre de quien retira el equipo.";
  if (code === "NEGOTIATION_NOT_FOUND") return "La orden de trabajo ya no existe. Actualiza la ficha.";
  if (code === "WORK_ORDER_ALREADY_SENT_TO_COMMERCIAL") return "Esta OT ya fue enviada a comercial: no se puede eliminar.";
  if (code === "WORK_ORDER_HAS_EXECUTED_WORKS") return "Esta OT tiene trabajos con tiempo registrado: no se puede eliminar.";
  if (code === "WORK_ORDER_FINISHED") return "Esta OT ya está finalizada.";
  if (code === "ONLY_WORK_ORDERS_CAN_BE_DELETED") return "Solo se pueden eliminar órdenes de trabajo, no cotizaciones.";
  if (code === "WORKS_ALREADY_LINKED") return "Esos trabajos ya están en una OT.";
  if (code === "NEGOTIATION_APPROVAL_REQUIRED_FIELDS_MISSING") return "La sucursal exige más datos para esta OT. Complétala desde la web.";
  if (code === "WORKER_NOT_FOUND") return "Tu usuario no tiene un trabajador asociado. Contacta a un administrador.";
  if (code.startsWith("INSPECTION_")) return "No se pudo guardar la inspección. Actualiza la ficha e inténtalo de nuevo.";
  return "El servidor rechazó los datos. Revisa el formulario e inténtalo de nuevo.";
}

function mobileErrorMessage(code: string): string {
  if (code === "USER_SIGNATURE_BRANCH_DUPLICATED") return "Una sucursal seleccionada ya tiene otra firma predeterminada. Edita esa firma o elige otra sucursal.";
  if (code === "USER_SIGNATURE_BRANCH_NOT_ASSIGNED") return "No tienes acceso a una de las sucursales de la firma. Actualiza el perfil.";
  if (code === "USER_SIGNATURE_NOT_FOUND") return "La firma ya no está disponible en tu perfil. Actualiza la lista.";
  if (code === "USER_SIGNATURE_IMAGE_INVALID") return "La imagen de firma no es válida o supera 1 MiB.";
  if (code.startsWith("USER_SIGNATURE_")) return "No se pudo guardar la firma. Revisa sus datos y sucursales.";
  if (code === "OWN_PROFILE_AVATAR_INVALID") return "La foto no es válida. Usa una imagen JPEG, PNG o WebP de hasta 3 MB.";
  if (code === "OWN_PROFILE_AVATAR_BUSY") return "Ya se está guardando una foto. Espera a que termine.";
  if (code === "OWN_PROFILE_NOT_FOUND") return "Tu cuenta no tiene un perfil asociado. Contacta a un administrador.";
  if (code.startsWith("OWN_PROFILE_")) return "No se pudo guardar el perfil. Revisa los datos ingresados.";
  if (code === "MOBILE_CREATION_REQUEST_CONFLICT") return "Este intento ya se usó con otros datos. Inicia una nueva creación; para reintentar, conserva los datos originales.";
  if (code === "MOBILE_CREATION_MAINTENANCE_WEB_WIZARD_REQUIRED") return "Este mantenimiento requiere el asistente web.";
  if (code === "MOBILE_CREATION_ENTRY_NOT_FOUND") return "El ingreso ya no existe o no es de tu sucursal. Actualiza el taller.";
  if (code === "MOBILE_CREATION_ENTRY_DELIVERED") return "Este equipo ya fue entregado: no se le pueden agregar trabajos.";
  if (code === "MOBILE_CREATION_ENTRY_NOT_INTERNAL") return "Solo los ingresos de equipos propios pueden tener mantenimientos.";
  if (code.includes("TIMEZONE")) return "La sucursal necesita una zona horaria válida configurada en el servidor.";
  if (code.includes("SCHEMA") || code === "MOBILE_PUSH_UNAVAILABLE") return "La función no está habilitada o requiere completar el despliegue del servidor.";
  if (code === "MOBILE_PUSH_TEST_RATE_LIMIT") return "Se alcanzó el límite de cinco pruebas por hora.";
  if (code.includes("LOCAL_TIME") || code.includes("DST_TRANSITION")) return "El horario coincide con un cambio de hora. Selecciona otra franja.";
  return "El servidor no pudo completar la operación. Comprueba los datos y la configuración de la sucursal.";
}