import { json, Router } from "express";
import { locationAckSchema, locationBatchSchema, locationHistoryQuerySchema, locationHistorySchema } from "../../src/domain/locationTracking";
import { assertBranch, bearer, currentUser } from "../auth";
import { emptySchema } from "../validation";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

export function createLocationRouter(upstream: Upstream): Router {
  const router = Router();
  router.post("/batch", json({ limit: "64kb", strict: true, inflate: false }), async (req, res) => {
    const token = bearer(req);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const body = locationBatchSchema.parse(req.body);
    const user = await currentUser(upstream, token);
    assertBranch(user, body.companyBranchId);
    if (!user.workerId) throw new GatewayError(403, "WORKER_REQUIRED");
    if (body.expectedActor.userId !== user.id || body.expectedActor.workerId !== user.workerId) throw new GatewayError(409, "LOCATION_ACTOR_CHANGED");
    const response = await upstream.request("/worker-locations/batch", { method: "POST", token, json: body });
    const parsed = locationAckSchema.safeParse(response);
    if (!parsed.success || new Set(parsed.data.acceptedIds).size !== parsed.data.acceptedIds.length || parsed.data.acceptedIds.some(id => !body.points.some(point => point.id === id))) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(parsed.data);
  });
  router.get("/me", async (req, res) => {
    const token = bearer(req);
    emptySchema.parse(req.body ?? {});
    const input = locationHistoryQuerySchema.parse({ ...req.query, companyBranchId: Number(req.query.companyBranchId), page: req.query.page === undefined ? 0 : Number(req.query.page), workId: req.query.workId === undefined ? undefined : Number(req.query.workId) });
    const user = await currentUser(upstream, token); assertBranch(user, input.companyBranchId);
    if (!user.workerId) throw new GatewayError(403, "WORKER_REQUIRED");
    const query = new URLSearchParams({ companyBranchId: String(input.companyBranchId), startDate: input.startDate, endDate: input.endDate, page: String(input.page) });
    if (input.groupId !== undefined) query.set("groupId", input.groupId);
    if (input.workId !== undefined) query.set("workId", String(input.workId));
    const response = locationHistorySchema.safeParse(await upstream.request("/worker-locations/me", { token, query }));
    if (!response.success || response.data.page !== input.page || response.data.items.some(item => item.point.companyBranchId !== input.companyBranchId
      || input.groupId !== undefined && item.point.groupId !== input.groupId || input.workId !== undefined && item.point.workId !== input.workId)) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(response.data);
  });
  return router;
}