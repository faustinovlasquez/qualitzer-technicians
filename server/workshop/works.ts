import { Router } from "express";
import { z } from "zod";
import { workshopFreeWorksSchema, workshopLinkWorksInputSchema, workshopLinkWorksResultSchema } from "../../src/domain/workshopWorks";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { asRecord, branchEntry, list, positive, text, workshopActor } from "./support";

const entryParam = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();

/**
 * Unir trabajos libres al ingreso. Los trabajos nuevos se crean con la creación móvil normal (con el ingreso) y se
 * gestionan desde su ficha normal en la app.
 */
export function registerWorkRoutes(router: Router, upstream: Upstream): void {
  router.get("/entries/:entryId/free-works", async (req, res) => {
    entryParam.parse(req.params);
    const query = z.object({ companyBranchId: z.coerce.number().int().positive(), search: z.string().trim().max(100).optional() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
    const raw = await upstream.request("/works", { token, query: new URLSearchParams({
      filters: JSON.stringify({ companyBranchId: query.companyBranchId, withoutWorkOrder: true, withoutEntry: true, ...(query.search ? { search: query.search } : {}) }),
      pagination: JSON.stringify({ page: 0, limit: 30 })
    }) });
    res.json(workshopFreeWorksSchema.parse({ items: list(raw).flatMap((item) => {
      const row = asRecord(item);
      const workId = positive(row.id);
      if (workId === null) return [];
      return [{ id: workId, code: `TR-${String(workId).padStart(5, "0")}`, title: (text(row.title) ?? "Sin título").slice(0, 500), statusName: text(row.mainStatus)?.slice(0, 120) ?? null }];
    }).slice(0, 100) }));
  });

  router.post("/entries/:entryId/works/link", async (req, res) => {
    const { entryId } = entryParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopLinkWorksInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    const workIds = [...new Set(input.workIds)];
    // El backend solo revisa que el trabajo no tenga ingreso: el conector exige además que el ingreso sea de la sucursal y
    // siga en taller, y que cada trabajo sea de la misma sucursal.
    const [{ raw: entry }, rows] = await Promise.all([
      branchEntry(upstream, token, input.companyBranchId, entryId),
      Promise.all(workIds.map((workId) => upstream.request(`/works/${workId}`, { token }).then(asRecord)))
    ]);
    if (text(entry.deliveredAt) !== null) throw new GatewayError(409, "DEPARTURE_ALREADY_EXISTS", "Este equipo ya fue entregado.");
    if (rows.some((row, index) => positive(row.id) !== workIds[index] || row.isDeleted === true || positive(row.companyBranchId) !== input.companyBranchId || positive(row.operationAreaEntryId) !== null)) {
      throw new GatewayError(409, "WORKSHOP_WORK_NOT_FREE", "Alguno de los trabajos ya no está libre o no es de tu sucursal. Actualiza la lista.");
    }
    let raw: unknown;
    try {
      raw = await upstream.request("/works/link-entry", { token, method: "PATCH", json: { operationAreaEntryId: entryId, workIds } });
    } catch (error) {
      if (error instanceof GatewayError && error.status === 403) throw new GatewayError(403, "WORKS_PERMISSION_REQUIRED", "Tu perfil no tiene permiso para unir trabajos. Pide que te den \"editar\" en Trabajos.");
      throw error;
    }
    const row = asRecord(raw);
    res.json(workshopLinkWorksResultSchema.parse({ linked: Math.max(0, Math.floor(Number(row.linked) || 0)), skipped: Math.max(0, Math.floor(Number(row.skipped) || 0)) }));
  });
}
