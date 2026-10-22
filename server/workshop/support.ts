import { createHash } from "node:crypto";
import type { Request } from "express";
import type { User } from "../../src/domain/models";
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

/** Sesión vigente del usuario con acceso a la sucursal pedida. El taller no exige trabajador. */
export async function workshopActor(upstream: Upstream, req: Request, branchId: number): Promise<WorkshopActor> {
  const token = bearer(req);
  const user = await currentUser(upstream, token);
  assertBranch(user, branchId);
  return { token, user, branchId };
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
