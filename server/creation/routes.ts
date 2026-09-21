import { Router } from "express";
import { z } from "zod";
import { creationInputSchema, creationOptionsQuerySchema, creationOptionsSchema, creationResultSchema, creationPlannedMinutes } from "../../src/domain/creation";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema, positiveId } from "../validation";
import { mobileActor } from "./authorization";

const optionsQuery = z.object({
  companyBranchId: positiveId.transform(Number), kind: z.enum(["equipment", "specialties"]).optional(),
  search: z.string().optional(), page: z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).optional(),
  internalNumber: z.string().optional(),
}).strict().pipe(creationOptionsQuerySchema);

export function createCreationRouter(upstream: Upstream): Router {
  const router = Router();
  router.get("/options", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const input = optionsQuery.parse(req.query);
    const { token, user } = await mobileActor(upstream, req, input.companyBranchId);
    const query = new URLSearchParams({ companyBranchId: String(input.companyBranchId) });
    if (input.kind !== undefined) query.set("kind", input.kind);
    if (input.search !== undefined) query.set("search", input.search);
    if (input.internalNumber !== undefined) query.set("internalNumber", input.internalNumber);
    if (input.page !== undefined) query.set("page", String(input.page));
    const result = parseUpstream(creationOptionsSchema, await upstream.request("/technician-dashboard/mobile-creations/options", { token, query }));
    if (result.userId !== user.id || result.workerId !== user.workerId || result.companyBranchId !== input.companyBranchId) throw new GatewayError(403, "MOBILE_CREATION_IDENTITY_MISMATCH");
    for (const resource of input.kind ? [input.kind] : ["equipment", "specialties"] as const) {
      const page = result[resource];
      if (!page || page.page !== (input.page ?? 0)) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    res.json(result);
  });
  router.post("/", async (req, res) => {
    emptySchema.parse(req.query);
    const input = creationInputSchema.parse(req.body);
    const { token } = await mobileActor(upstream, req, input.companyBranchId);
    let status = 201;
    let replayed = "false";
    const result = parseUpstream(creationResultSchema, await upstream.request("/technician-dashboard/mobile-creations", { method: "POST", token, json: input, onResponse: (metadata) => {
      status = metadata.status;
      replayed = metadata.idempotencyReplayed ?? (status === 200 ? "true" : "false");
    } }));
    if (![200, 201].includes(status) || result.kind !== input.kind || result.companyBranchId !== input.companyBranchId || result.schedule.date !== input.schedule.date || result.schedule.startTime !== input.schedule.startTime || result.schedule.endTime !== input.schedule.endTime || result.schedule.plannedMinutes !== creationPlannedMinutes(input.schedule) || (input.kind !== "maintenance" && result.groupId !== `${input.kind === "work" ? "direct" : "direct-np"}-${result.workId}`)) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.set("Idempotency-Replayed", replayed === "true" ? "true" : "false").status(status).json(result);
  });
  return router;
}