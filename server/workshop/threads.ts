import type { Router } from "express";
import { z } from "zod";
import { GatewayError } from "../errors";
import { registerThreadRoutes } from "../threads/routes";
import type { Upstream } from "../upstream";
import { loadWorkshopEntry } from "./entry";
import { assertOrderOfEntry } from "./orderFiles";
import { NO_ENTRY } from "./orderDetail";
import { workshopActor } from "./support";

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const params = z.object({ entryId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), orderId: id.optional() }).passthrough();
const branchQuery = z.object({ companyBranchId: id }).strict();

/** Comentarios (chat) del ingreso y de sus OT: los mismos de la web. */
export function registerWorkshopThreadRoutes(router: Router, upstream: Upstream): void {
  registerThreadRoutes(router, upstream, "/threads/entries/:entryId", async (req, query) => {
    const { entryId } = params.parse(req.params);
    if (entryId === NO_ENTRY) throw new GatewayError(404, "ENTRY_NOT_FOUND");
    const { companyBranchId } = branchQuery.parse(query);
    const { token, user } = await workshopActor(upstream, req, companyBranchId);
    await loadWorkshopEntry(upstream, token, companyBranchId, entryId);
    return { token, userId: user.id, userName: `${user.name} ${user.lastnames}`.trim(), companyBranchId, base: "operation_area_entries/comments", entityId: entryId, tabs: [] };
  });
  registerThreadRoutes(router, upstream, "/threads/entries/:entryId/orders/:orderId", async (req, query) => {
    const { entryId, orderId } = params.parse(req.params);
    if (orderId === undefined) throw new GatewayError(404, "NEGOTIATION_NOT_FOUND");
    const { companyBranchId } = branchQuery.parse(query);
    const { token, user } = await workshopActor(upstream, req, companyBranchId);
    await assertOrderOfEntry(upstream, token, companyBranchId, entryId, orderId);
    return { token, userId: user.id, userName: `${user.name} ${user.lastnames}`.trim(), companyBranchId, base: "negotiations/comments", entityId: orderId, tabs: [], module: "work_orders" };
  });
}
