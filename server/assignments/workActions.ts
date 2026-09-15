import type { Request, RequestHandler, Router } from "express";
import { workActivityInputSchema, workActivityResultSchema, workActivitySchema } from "../../src/domain/workActivities";
import { attachmentSchema, parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import { readDocuments, releaseDocuments } from "../files/documents";
import type { Upstream } from "../upstream";
import { emptySchema, resourceParamsSchema } from "../validation";
import { AssignmentAuthorization } from "./authorization";
import type { UploadConcurrency } from "./routes";

export function registerWorkActions(router: Router, upstream: Upstream, uploadLimiter: RequestHandler, uploads: UploadConcurrency): void {
  const authorization = new AssignmentAuthorization(upstream);
  const base = "/:groupId/works/:workId";
  async function owned(req: Request, mutation: boolean) {
    const scope = await authorization.work(req, mutation);
    const query = new URLSearchParams({ startDate: scope.range.startDate, endDate: scope.range.endDate, companyBranchId: String(scope.range.companyBranchId), groupType: scope.group.type });
    const prefix = `/technician-dashboard/panel/${scope.group.id}/works/${scope.workId}` as const;
    return { scope, query, prefix };
  }
  function activityId(req: Request): number {
    const value = resourceParamsSchema.parse(req.params).activityId;
    if (!value) throw new GatewayError(400, "WORK_ACTIVITY_ID_REQUIRED");
    return Number(value);
  }
  router.get(`${base}/activities`, async (req, res) => {
    const { scope, query, prefix } = await owned(req, false);
    res.json(parseUpstream(workActivitySchema.array(), await upstream.request(`${prefix}/activities`, { token: scope.token, query })));
  });
  router.post(`${base}/activities`, async (req, res) => {
    const input = workActivityInputSchema.parse(req.body);
    const { scope, query, prefix } = await owned(req, true);
    res.status(201).json(parseUpstream(workActivityResultSchema, await upstream.request(`${prefix}/activities`, { token: scope.token, query, method: "POST", json: input })));
  });
  router.post(`${base}/activities/:activityId/complete`, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const id = activityId(req);
    const { scope, query, prefix } = await owned(req, true);
    await upstream.request(`${prefix}/activities/${id}/complete`, { token: scope.token, query, method: "POST", json: {} });
    res.json({ success: true });
  });
  router.get(`${base}/activities/:activityId/files`, async (req, res) => {
    const id = activityId(req);
    const { scope, query, prefix } = await owned(req, false);
    res.json(parseUpstream(attachmentSchema.array(), await upstream.request(`${prefix}/activities/${id}/files`, { token: scope.token, query })));
  });
  router.post(`${base}/activities/:activityId/files`, uploadLimiter, async (req, res) => {
    const id = activityId(req);
    await owned(req, true);
    if (uploads.active >= 2) throw new GatewayError(429, "UPLOAD_BUSY");
    uploads.active++;
    try {
      const files = await readDocuments(req, res);
      const { scope, query, prefix } = await owned(req, true);
      const form = new FormData();
      for (const file of files) form.append("files", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
      await upstream.request(`${prefix}/activities/${id}/files`, { token: scope.token, query, method: "POST", form });
      res.status(201).json({ success: true });
    } finally { releaseDocuments(req); uploads.active--; }
  });
  router.post(`${base}/reopen`, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { scope, query, prefix } = await owned(req, false);
    if (scope.work.status !== "delivered") throw new GatewayError(409, "WORK_REOPEN_REQUIRES_DELIVERED", "Solo se puede reabrir un trabajo entregado, no finalizado.");
    if (scope.range.startDate !== scope.range.endDate) throw new GatewayError(400, "WORK_REOPEN_SINGLE_DATE_REQUIRED");
    await upstream.request(`${prefix}/reopen`, { token: scope.token, query, method: "POST", json: {} });
    res.json({ success: true });
  });
}