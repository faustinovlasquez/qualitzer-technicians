import { Router } from "express";
import { z } from "zod";
import { workshopBoardSchema, workshopListSchema, type WorkshopArea, type WorkshopEntry } from "../../src/domain/workshopBoard";
import { assertBranch, bearer, currentUser } from "../auth";
import { emptySchema } from "../validation";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

type Raw = Record<string, unknown>;
const asRecord = (value: unknown): Raw => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Raw : {});
const text = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const count = (value: unknown): number => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 1_000_000) : 0;
};
const isoDate = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const clip = (value: string | null, max: number): string | null => (value === null ? null : value.slice(0, max));
/** Listas del backend: arreglo directo o envuelto en `data` / `items` / `rows`. */
const list = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of ["data", "items", "rows", "opciones"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
};

/** Ingreso del tablero web (operation_area/dashboard) a la forma que muestra la app. */
function toEntry(raw: unknown): WorkshopEntry | null {
  const entry = asRecord(raw);
  const entryId = positive(entry.id);
  if (entryId === null) return null;
  const equipment = asRecord(entry.equipment);
  const nameOf = (value: unknown) => text(asRecord(value).name);
  const equipmentParts = [nameOf(equipment.manufacturer), nameOf(equipment.type), nameOf(equipment.model)].filter((part): part is string => part !== null);
  const equipmentCode = text(equipment.identification) ?? text(equipment.internalNumber) ?? text(equipment.autoGenerateCode);
  const status = asRecord(entry.status);
  const subStatus = asRecord(entry.subStatus);
  return {
    id: entryId,
    code: `ING-${String(entryId).padStart(5, "0")}`,
    title: clip(text(entry.title), 500),
    statusKey: clip(text(status.key), 80),
    statusColor: clip(text(status.color), 40),
    subStatusName: clip(text(subStatus.key), 200),
    equipmentLabel: (equipmentParts.length > 0 ? equipmentParts.join(" · ") : equipmentCode ?? "Sin equipo").slice(0, 500),
    equipmentCode: clip(equipmentCode, 120),
    customerName: clip(text(entry.customerName), 300),
    isInternalEntry: entry.isInternalEntry === true,
    daysInArea: count(entry.daysElapsed),
    estimatedDeliveryAt: isoDate(entry.estimatedDepartureDateTime),
    isReceptionPending: entry.isReceptionPending === true,
    negotiationsCount: count(entry.negotiationsCount),
    imageUrl: clip(text(entry.image) ?? text(entry.avatarThumbnail) ?? text(equipment.image), 4000)
  };
}

function toArea(raw: unknown): WorkshopArea | null {
  const area = asRecord(raw);
  const areaId = positive(area.id);
  if (areaId === null) return null;
  const entries = list(area.entries).map(toEntry).filter((entry): entry is WorkshopEntry => entry !== null);
  return {
    id: areaId,
    title: (text(area.title) ?? `Nave ${areaId}`).slice(0, 300),
    maxSlots: count(area.maxSlots),
    occupiedSlots: count(area.occupiedSlots ?? entries.length),
    hasUnlimitedSlots: area.hasUnlimitedSlots === true,
    entries
  };
}

/** Taller (naves e ingresos) para la app: solo lectura, con la sesión del usuario. */
export function createWorkshopRouter(upstream: Upstream): Router {
  const router = Router();
  router.get("/workshops", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const token = bearer(req);
    const user = await currentUser(upstream, token);
    assertBranch(user, query.companyBranchId);
    const raw = await upstream.request("/workshops/select", { token, query: new URLSearchParams({ companyBranchId: String(query.companyBranchId), page: "1", limit: "100" }) });
    const items = list(raw).flatMap((option) => {
      const record = asRecord(option);
      const workshopId = positive(record.value ?? record.id);
      const name = text(record.label ?? record.name ?? record.title);
      return workshopId !== null && name !== null ? [{ id: workshopId, name: name.slice(0, 300) }] : [];
    });
    const result = workshopListSchema.safeParse({ items: items.slice(0, 200) });
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result.data);
  });
  router.get("/board", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive(), workshopId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const token = bearer(req);
    const user = await currentUser(upstream, token);
    assertBranch(user, query.companyBranchId);
    const raw = await upstream.request("/operation_area/dashboard", {
      token,
      query: new URLSearchParams({ companyBranchId: String(query.companyBranchId), workshopId: String(query.workshopId) })
    });
    const areas = list(raw).map(toArea).filter((area): area is WorkshopArea => area !== null);
    const result = workshopBoardSchema.safeParse({ workshopId: query.workshopId, areas: areas.slice(0, 500) });
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result.data);
  });
  return router;
}
