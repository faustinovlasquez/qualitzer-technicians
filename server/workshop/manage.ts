import { Router } from "express";
import { z } from "zod";
import {
  workshopEstimatedDateInputSchema, workshopManageResultSchema, workshopMoveInputSchema, workshopStatusesSchema, workshopStatusInputSchema, type WorkshopStatuses
} from "../../src/domain/workshopManage";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { asRecord, branchEntry, clip, list, positive, text, workshopActor } from "./support";

const entryParam = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();

/** Lista plana del backend (principales y subestados) a principales con sus subestados, solo habilitados. */
async function statusesOf(upstream: Upstream, token: string, branchId: number): Promise<WorkshopStatuses> {
  const rows = list(await upstream.request("/master_commercial/get-all-status", { token, query: new URLSearchParams({ module: "OPERATION_AREAS_ENTRIES", companyBranchId: String(branchId) }) }))
    .map(asRecord).filter((row) => row.isEnabled !== false);
  const mains = rows.filter((row) => row.isPrimary === true);
  mains.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  return workshopStatusesSchema.parse({ items: mains.flatMap((main) => {
    const mainId = positive(main.id);
    const name = text(main.name);
    if (mainId === null || name === null) return [];
    return [{ id: mainId, name: name.slice(0, 120), color: clip(text(main.color), 40),
      subStatuses: rows.filter((row) => row.isPrimary !== true && positive(row.mainStatusId) === mainId).flatMap((sub) => {
        const subId = positive(sub.id);
        const subName = text(sub.name);
        return subId === null || subName === null ? [] : [{ id: subId, name: subName.slice(0, 200), color: clip(text(sub.color), 40) }];
      }).slice(0, 100) }];
  }).slice(0, 100) });
}

/** El ingreso es de la sucursal y no está entregado. */
async function openEntry(upstream: Upstream, token: string, branchId: number, entryId: number) {
  const found = await branchEntry(upstream, token, branchId, entryId);
  if (text(found.raw.deliveredAt) !== null) throw new GatewayError(409, "DEPARTURE_ALREADY_EXISTS", "Este equipo ya fue entregado.");
  return found;
}

/** Gestión del ingreso: mover de nave, fecha estimada de entrega con motivo y estado/subestado. */
export function registerManageRoutes(router: Router, upstream: Upstream): void {
  router.get("/options/statuses", async (req, res) => {
    const { companyBranchId } = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    res.json(await statusesOf(upstream, token, companyBranchId));
  });

  router.post("/entries/:entryId/move", async (req, res) => {
    const { entryId } = entryParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopMoveInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    const { raw, areas } = await openEntry(upstream, token, input.companyBranchId, entryId);
    const from = positive(raw.operationAreaId)!;
    if (from === input.toAreaId) throw new GatewayError(400, "WORKSHOP_SAME_AREA", "El equipo ya está en esa nave.");
    // Igual que en la web (se arrastra dentro del tablero): solo a otra nave del mismo taller.
    if (areas.get(input.toAreaId) !== areas.get(from)) throw new GatewayError(400, "WORKSHOP_AREA_INVALID", "Esa nave no es de este taller. Elige otra.");
    // Ojo: el backend escribe "Operations" en estos nombres.
    await upstream.request("/operation_area_entries/move", { token, method: "PATCH", json: {
      entryId, fromOperationsAreaId: from, toOperationsAreaId: input.toAreaId, ...(input.note ? { note: input.note } : {})
    } });
    res.json(workshopManageResultSchema.parse({ id: entryId }));
  });

  router.post("/entries/:entryId/estimated-delivery", async (req, res) => {
    const { entryId } = entryParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopEstimatedDateInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    await openEntry(upstream, token, input.companyBranchId, entryId);
    await upstream.request(`/operation_area_entries/${entryId}/estimated-delivery-date`, { token, method: "PATCH", json: {
      estimatedDeliveryDate: input.estimatedDeliveryAt, reason: input.reason, companyBranchId: input.companyBranchId
    } });
    res.json(workshopManageResultSchema.parse({ id: entryId }));
  });

  router.post("/entries/:entryId/status", async (req, res) => {
    const { entryId } = entryParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopStatusInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    await openEntry(upstream, token, input.companyBranchId, entryId);
    const statuses = await statusesOf(upstream, token, input.companyBranchId);
    const status = statuses.items.find((item) => item.id === input.statusId);
    if (!status || (input.subStatusId !== null && !status.subStatuses.some((sub) => sub.id === input.subStatusId))) {
      throw new GatewayError(400, "WORKSHOP_STATUS_INVALID", "Ese estado ya no está disponible. Actualiza la lista.");
    }
    await upstream.request(`/operation_area_entries/${entryId}/change-status`, { token, method: "PATCH", json: { statusId: input.statusId, subStatusId: input.subStatusId } });
    res.json(workshopManageResultSchema.parse({ id: entryId }));
  });
}
