import { Router } from "express";
import { z } from "zod";
import { materialDispositionInputSchema, materialReceiptInputSchema, materialReceiptResultSchema, materialReceiptSchema, materialReceiptsSchema, materialReceiptStatusSchema,
  verifyMaterialDispositionResult, verifyMaterialReceiptResult } from "../../src/domain/materialReceipts";
import { assertBranch, bearer, currentUser } from "../auth";
import { emptySchema } from "../validation";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

export function createMaterialReceiptRouter(upstream: Upstream): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive(), status: materialReceiptStatusSchema.optional() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const token = bearer(req);
    const user = await currentUser(upstream, token);
    assertBranch(user, query.companyBranchId);
    if (!user.workerId) throw new GatewayError(403, "WORKER_REQUIRED");
    // Sin status se mantiene la llamada original para backends que aún no conocen el historial.
    const params = new URLSearchParams({ companyBranchId: String(query.companyBranchId) });
    if (query.status === "CONFIRMED") params.set("status", "CONFIRMED");
    const result = materialReceiptsSchema.safeParse(await upstream.request("/inventory_consumptions_v2/my-receipts", { token, query: params }));
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result.data);
  });
  router.post("/confirm", async (req, res) => {
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = materialReceiptInputSchema.parse(req.body);
    if (input.client !== "MOBILE") throw new GatewayError(400, "INVALID_INPUT");
    const token = bearer(req);
    const user = await currentUser(upstream, token);
    assertBranch(user, input.companyBranchId);
    if (!user.workerId) throw new GatewayError(403, "WORKER_REQUIRED");
    const result = materialReceiptResultSchema.safeParse(await upstream.request("/inventory_consumptions_v2/my-receipts/confirm", { token, method: "POST", json: input }));
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    try { verifyMaterialReceiptResult(input, result.data, user.id); }
    catch { throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE"); }
    res.json(result.data);
  });
  router.post("/:id/dispositions", async (req, res) => {
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const body = req.body !== null && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const input = materialDispositionInputSchema.parse({ ...body, id: z.coerce.number().int().positive().parse(req.params.id) });
    const token = bearer(req);
    const user = await currentUser(upstream, token);
    assertBranch(user, input.companyBranchId);
    if (!user.workerId) throw new GatewayError(403, "WORKER_REQUIRED");
    const result = materialReceiptSchema.safeParse(await upstream.request(`/inventory_consumptions_v2/my-receipts/${input.id}/dispositions`, { token, method: "POST",
      json: { companyBranchId: input.companyBranchId, version: input.version, lines: input.lines } }));
    if (!result.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    try { verifyMaterialDispositionResult(input, result.data); }
    catch { throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE"); }
    res.json(result.data);
  });
  return router;
}