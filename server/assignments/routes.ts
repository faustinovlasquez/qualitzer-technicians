import { Router, type RequestHandler } from "express";
import { bearer } from "../auth";
import { GatewayError } from "../errors";
import { readPhotos } from "../files/uploads";
import type { Upstream } from "../upstream";
import { resourceParamsSchema } from "../validation";
import { ownedStep } from "./authorization";
import { AssignmentService } from "./service";

export interface UploadConcurrency { active: number; }

export function assignmentRouter(upstream: Upstream, uploadLimiter: RequestHandler, uploads: UploadConcurrency = { active: 0 }): Router {
  const router = Router();
  const service = new AssignmentService(upstream);
  router.use((req, _res, next) => { bearer(req); next(); });
  router.get("/", async (req, res) => { res.json(await service.authorization.list(req)); });
  const base = "/:groupId/works/:workId";
  router.get(`${base}/files`, async (req, res) => { res.json(await service.files(req)); });
  router.post(`${base}/status`, async (req, res) => {
    await service.mutate(req, () => service.status(req));
    res.json({ success: true });
  });
  router.patch(`${base}/steps/:stepId`, async (req, res) => {
    await service.mutate(req, () => service.step(req));
    res.json({ success: true });
  });
  router.post(`${base}/report`, async (req, res) => {
    await service.mutate(req, () => service.report(req));
    res.json({ success: true });
  });
  const upload: RequestHandler = async (req, res) => {
    if (uploads.active >= 2) throw new GatewayError(429, "UPLOAD_BUSY");
    uploads.active += 1;
    try {
      await service.mutate(req, async () => {
        const scope = await service.authorization.work(req, true);
        const { stepId } = resourceParamsSchema.parse(req.params);
        if (stepId) {
          ownedStep(scope, stepId);
          if (scope.maintenanceId === null) throw new GatewayError(400, "STANDARD_STEP_UPLOAD_UNSUPPORTED", "El backend no admite archivos por paso en trabajos estándar; use los archivos del trabajo.");
        }
        const files = await readPhotos(req, res);
        try { await service.upload(req, files); }
        finally { for (const file of files) file.buffer = Buffer.alloc(0); }
      });
      res.status(201).json({ success: true });
    } finally { uploads.active -= 1; }
  };
  router.post(`${base}/files`, uploadLimiter, upload);
  router.post(`${base}/steps/:stepId/files`, uploadLimiter, upload);
  return router;
}