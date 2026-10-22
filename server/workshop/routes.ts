import { Router } from "express";
import { z } from "zod";
import { workshopBoardSchema, workshopListSchema, type WorkshopArea, type WorkshopEntry } from "../../src/domain/workshopBoard";
import { emptySchema } from "../validation";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { asRecord, clip, count, isoDate, list, positive, text, workshopActor, WorkshopRequestLedger } from "./support";
import { registerIntakeRoutes } from "./intake";
import { registerInspectionRoutes } from "./inspection";
import { registerReceptionRoutes } from "./reception";
import { registerWorkRoutes } from "./works";
import { registerOrderRoutes } from "./orders";
import { registerDeliveryRoutes } from "./delivery";
import { registerManageRoutes } from "./manage";
import { registerCustomerRoutes } from "./customers";
import { equipmentSummary, loadWorkshopEntry } from "./entry";

/** Ingreso del tablero web (operation_area/dashboard) a la forma que muestra la app. */
function toEntry(raw: unknown): WorkshopEntry | null {
  const entry = asRecord(raw);
  const entryId = positive(entry.id);
  if (entryId === null) return null;
  const equipment = asRecord(entry.equipment);
  const summary = equipmentSummary(equipment);
  const status = asRecord(entry.status);
  const subStatus = asRecord(entry.subStatus);
  return {
    id: entryId,
    code: `ING-${String(entryId).padStart(5, "0")}`,
    title: clip(text(entry.title), 500),
    statusKey: clip(text(status.key), 80),
    statusColor: clip(text(status.color), 40),
    subStatusName: clip(text(subStatus.key), 200),
    equipmentLabel: summary.label,
    equipmentCode: summary.code,
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

/** Taller (naves e ingresos) para la app, con la sesión del usuario. */
export function createWorkshopRouter(upstream: Upstream): Router {
  const router = Router();
  const ledger = new WorkshopRequestLedger();
  registerIntakeRoutes(router, upstream, ledger);
  registerInspectionRoutes(router, upstream);
  registerReceptionRoutes(router, upstream, ledger);
  registerWorkRoutes(router, upstream);
  registerOrderRoutes(router, upstream, ledger);
  registerDeliveryRoutes(router, upstream, ledger);
  registerManageRoutes(router, upstream);
  registerCustomerRoutes(router, upstream, ledger);
  router.get("/workshops", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
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
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
    const raw = await upstream.request("/operation_area/dashboard", {
      token,
      query: new URLSearchParams({ companyBranchId: String(query.companyBranchId), workshopId: String(query.workshopId) })
    });
    const areas = list(raw).map(toArea).filter((area): area is WorkshopArea => area !== null);
    const result = workshopBoardSchema.safeParse({ workshopId: query.workshopId, areas: areas.slice(0, 500) });
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result.data);
  });
  router.get("/entries/:entryId", async (req, res) => {
    const { entryId } = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().parse(req.params);
    const query = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
    res.json(await loadWorkshopEntry(upstream, token, query.companyBranchId, entryId));
  });
  return router;
}
