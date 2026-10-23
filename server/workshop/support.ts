import { createHash } from "node:crypto";
import type { Request } from "express";
import type { User } from "../../src/domain/models";
import { ALL_APP_PERMISSIONS, APP_PERMISSION_LABELS, isAppPermissionAllowed, normalizeMobileAppConfig, type MobileAppConfig, type MobileAppPermission } from "../../src/domain/mobileAppConfig";
import { assertBranch, bearer, currentUser } from "../auth";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

export type Raw = Record<string, unknown>;
export const asRecord = (value: unknown): Raw => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Raw : {});
export const text = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
export const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
export const count = (value: unknown): number => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 1_000_000) : 0;
};
export const isoDate = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
export const clip = (value: string | null, max: number): string | null => (value === null ? null : value.slice(0, max));
/** Listas del backend: arreglo directo o envuelto en `data` / `items` / `rows`. */
export const list = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of ["data", "items", "rows", "opciones"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
};

export interface WorkshopActor { token: string; user: User; branchId: number }

/** Permiso de la app que exige cada ruta del taller (lo marca un middleware antes de leer el cuerpo). */
const requiredPermission = new WeakMap<Request, MobileAppPermission>();
export const requireAppPermissionFor = (req: Request, key: MobileAppPermission) => { requiredPermission.set(req, key); };

/** Configuración de la sucursal por pocos segundos: una inspección sube muchas fotos seguidas. */
const configCache = new WeakMap<Upstream, Map<number, { config: MobileAppConfig; at: number }>>();
export async function mobileAppConfig(upstream: Upstream, token: string, branchId: number): Promise<MobileAppConfig> {
  const cache = configCache.get(upstream) ?? new Map<number, { config: MobileAppConfig; at: number }>();
  configCache.set(upstream, cache);
  const cached = cache.get(branchId);
  if (cached && Date.now() - cached.at < 20_000) return cached.config;
  let config: MobileAppConfig;
  try { config = normalizeMobileAppConfig(asRecord(await upstream.request(`/branches/${branchId}/mobileAppConfig`, { token })).mobileAppConfig); }
  catch (error) {
    // Backend anterior sin esta configuración: todo permitido, como antes.
    if (error instanceof GatewayError && error.status === 404) config = ALL_APP_PERMISSIONS;
    else throw error;
  }
  cache.set(branchId, { config, at: Date.now() });
  return config;
}

export async function assertAppPermission(upstream: Upstream, token: string, branchId: number, key: MobileAppPermission): Promise<void> {
  if (isAppPermissionAllowed(await mobileAppConfig(upstream, token, branchId), key)) return;
  throw new GatewayError(403, "BRANCH_APP_ACTION_DISABLED", `La sucursal no permite ${APP_PERMISSION_LABELS[key]} desde la app. Pide el cambio a un administrador o hazlo desde la web.`);
}

/** Sesión vigente del usuario con acceso a la sucursal pedida. El taller no exige trabajador. */
export async function workshopActor(upstream: Upstream, req: Request, branchId: number): Promise<WorkshopActor> {
  const token = bearer(req);
  const user = await currentUser(upstream, token);
  assertBranch(user, branchId);
  const permission = requiredPermission.get(req);
  if (permission) await assertAppPermission(upstream, token, branchId, permission);
  return { token, user, branchId };
}

/**
 * Naves de los talleres de la sucursal (nave → taller). El backend no revisa a qué sucursal pertenece un ingreso o una
 * nave, así que el conector lo confirma con el tablero de cada taller (el listado de naves omite las llenas).
 */
export async function branchAreas(upstream: Upstream, token: string, branchId: number): Promise<Map<number, number>> {
  const workshops = list(await upstream.request("/workshops/select", { token, query: new URLSearchParams({ companyBranchId: String(branchId), page: "1", limit: "100" }) }))
    .flatMap((option) => { const id = positive(asRecord(option).value ?? asRecord(option).id); return id === null ? [] : [id]; });
  const boards = await Promise.all(workshops.map(async (workshopId) => ({ workshopId, areas: list(await upstream.request("/operation_area/dashboard", {
    token, query: new URLSearchParams({ companyBranchId: String(branchId), workshopId: String(workshopId) })
  })) })));
  const areas = new Map<number, number>();
  for (const board of boards) for (const area of board.areas) { const areaId = positive(asRecord(area).id); if (areaId !== null) areas.set(areaId, board.workshopId); }
  return areas;
}

/** El ingreso existe y su nave es de un taller de la sucursal del usuario. Devuelve el ingreso tal como lo da el backend. */
export async function branchEntry(upstream: Upstream, token: string, branchId: number, entryId: number): Promise<{ raw: Raw; areas: Map<number, number> }> {
  const [entry, areas] = await Promise.all([upstream.request(`/operation_area_entries/${entryId}`, { token }), branchAreas(upstream, token, branchId)]);
  const raw = asRecord(entry);
  const areaId = positive(raw.operationAreaId);
  if (positive(raw.id) !== entryId || areaId === null || !areas.has(areaId)) {
    throw new GatewayError(404, "ENTRY_NOT_FOUND", "Este ingreso no está en tu sucursal o ya no existe. Actualiza el tablero.");
  }
  return { raw, areas };
}

interface LedgerEntry { fingerprint: string; expiresAt: number; result: Promise<unknown> }

/**
 * El backend del taller no evita duplicados: un doble toque o un reintento crearía dos ingresos o dos entregas.
 * Cada escritura lleva un `requestId` (UUID) de la app; el mismo intento con los mismos datos devuelve el primer resultado
 * (también mientras sigue en curso) y con otros datos se rechaza. Un intento fallido se olvida para poder reintentarlo.
 */
export class WorkshopRequestLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  constructor(private readonly ttlMs = 15 * 60_000, private readonly maxEntries = 1000, private readonly now: () => number = Date.now) {}

  async run<T>(scope: string, requestId: string, payload: unknown, action: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    const key = `${scope}:${requestId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(payload) ?? "").digest("hex");
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new GatewayError(409, "WORKSHOP_REQUEST_CONFLICT", "Este intento ya se usó con otros datos. Vuelve a abrir el formulario.");
      return { result: await existing.result as T, replayed: true };
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const result = action();
    this.entries.set(key, { fingerprint, expiresAt: now + this.ttlMs, result });
    try {
      return { result: await result, replayed: false };
    } catch (error) {
      if (this.entries.get(key)?.result === result) this.entries.delete(key);
      throw error;
    }
  }
}
