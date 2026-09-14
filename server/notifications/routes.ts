import { Router } from "express";
import { z } from "zod";
import { mobileUuidSchema } from "../../src/domain/creation";
import { notificationDeleteResultSchema, notificationDeviceInputSchema, notificationDeviceResultSchema, notificationInboxSchema, notificationReadResultSchema, notificationStatusSchema, notificationTestResultSchema } from "../../src/domain/notifications";
import { mobileActor } from "../creation/authorization";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema, positiveId } from "../validation";

const branchQuery = z.object({ companyBranchId: positiveId.transform(Number) }).strict();
const inboxQuery = branchQuery.extend({ page: positiveId.transform(Number).pipe(z.number().max(1000)).default(1), unreadOnly: z.enum(["true", "false"]).optional() });
const queryFor = (branch: number) => new URLSearchParams({ companyBranchId: String(branch) });

export function createNotificationsRouter(upstream: Upstream, tenantOrigin: string): Router {
  const router = Router();
  router.use((req, _res, next) => {
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
    if (hasBody && (!["POST", "PUT"].includes(req.method) || !req.is("application/json"))) throw new GatewayError(400, "INVALID_INPUT");
    next();
  });
  router.get("/status", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { companyBranchId } = branchQuery.parse(req.query);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    res.json(parseUpstream(notificationStatusSchema, await upstream.request("/mobile-notifications/status", { token, query: queryFor(companyBranchId) })));
  });
  router.put("/device", async (req, res) => {
    const body: unknown = req.body;
    req.body = undefined;
    emptySchema.parse(req.query);
    const input = notificationDeviceInputSchema.parse(body);
    const { token } = await mobileActor(upstream, req, input.companyBranchId);
    const status = parseUpstream(notificationStatusSchema, await upstream.request("/mobile-notifications/status", { token, query: queryFor(input.companyBranchId) }));
    if (!status.enabled) throw new GatewayError(503, "MOBILE_PUSH_UNAVAILABLE");
    if (status.projectId !== input.projectId) throw new GatewayError(400, "MOBILE_PUSH_PROJECT_NOT_ALLOWED");
    const result = parseUpstream(notificationDeviceResultSchema, await upstream.request("/mobile-notifications/device", { method: "PUT", token, json: input }));
    if (result.installationId !== input.installationId) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result);
  });
  router.delete("/device/:installationId", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { companyBranchId } = branchQuery.parse(req.query);
    const installation = mobileUuidSchema.parse(req.params.installationId);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    await upstream.request(`/mobile-notifications/device/${installation}`, { method: "DELETE", token, query: queryFor(companyBranchId) });
    res.status(200).send();
  });
  router.get("/inbox", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { companyBranchId, page, unreadOnly } = inboxQuery.parse(req.query);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    const query = queryFor(companyBranchId);
    query.set("page", String(page));
    if (unreadOnly === "true") query.set("unreadOnly", "true");
    const result = parseUpstream(notificationInboxSchema, await upstream.request("/mobile-notifications/inbox", { token, query }));
    if (result.page !== page || result.items.some((item) => item.data.tenantOrigin !== tenantOrigin || item.data.companyBranchId !== companyBranchId)) throw new GatewayError(502, "MOBILE_PUSH_IDENTITY_MISMATCH");
    res.json(result);
  });
  router.patch("/inbox/:id/read", async (req, res) => {
    if (req.body !== undefined) throw new GatewayError(400, "INVALID_INPUT");
    const { companyBranchId } = branchQuery.parse(req.query);
    const id = mobileUuidSchema.parse(req.params.id);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    const result = parseUpstream(notificationReadResultSchema, await upstream.request(`/mobile-notifications/inbox/${id}/read`, { method: "PATCH", token, query: queryFor(companyBranchId) }));
    if (result.id !== id) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result);
  });
  router.delete("/inbox/:id", async (req, res) => {
    if (req.body !== undefined) throw new GatewayError(400, "INVALID_INPUT");
    const { companyBranchId } = branchQuery.parse(req.query);
    const id = mobileUuidSchema.parse(req.params.id);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    const result = parseUpstream(notificationDeleteResultSchema, await upstream.request(`/mobile-notifications/inbox/${encodeURIComponent(id)}`, { method: "DELETE", token, query: queryFor(companyBranchId) }));
    if (result.id !== id) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(result);
  });
  router.post("/test", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { companyBranchId } = branchQuery.parse(req.query);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    res.status(201).json(parseUpstream(notificationTestResultSchema, await upstream.request("/mobile-notifications/test", { method: "POST", token, query: queryFor(companyBranchId) })));
  });
  return router;
}