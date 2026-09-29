import { Router } from "express";
import { z } from "zod";
import { materialReceiptInputSchema, materialReceiptResultSchema, materialReceiptsSchema, verifyMaterialReceiptResult } from "../../src/domain/materialReceipts";
import { assertBranch, bearer, currentUser } from "../auth";
import { emptySchema } from "../validation";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";

export function createMaterialReceiptRouter(upstream: Upstream): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const token = bearer(req);
    const user = await currentUser(upstream, token);
    assertBranch(user, query.companyBranchId);
    if (!user.workerId) throw new GatewayError(403, "WORKER_REQUIRED");
    const result = materialReceiptsSchema.safeParse(await upstream.request("/inventory_consumptions_v2/my-receipts", { token, query: new URLSearchParams({ companyBranchId: String(query.companyBranchId) }) }));
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
  return router;
}