import { Router, type RequestHandler } from "express";
import type { UploadConcurrency } from "../assignments/routes";
import { bearer } from "../auth";
import { GatewayError } from "../errors";
import { readDocuments, releaseDocuments } from "../files/documents";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { PanelService } from "./service";
import { commentInputSchema, panelRequest, type PanelTarget } from "./validation";

export function createPanelRouter(upstream: Upstream, uploadLimiter: RequestHandler, uploads: UploadConcurrency): Router {
  const router = Router();
  const service = new PanelService(upstream);
  router.use((req, res, next) => { bearer(req); res.set("Cache-Control", "no-store"); next(); });

  router.get("/:groupId/files", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await service.files(panelRequest(req, "group")));
  });

  const work = "/:groupId/works/:workId";
  router.get(`${work}/steps/:stepId/files`, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await service.files(panelRequest(req, "step")));
  });
  router.get(`${work}/comments`, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    res.json(await service.comments(panelRequest(req, "work", { comments: true })));
  });
  router.post(`${work}/comments`, async (req, res) => {
    const input = panelRequest(req, "work");
    const { text } = commentInputSchema.parse(req.body);
    await service.mutate(input, (scope) => service.addComment(input, scope, text));
    res.status(201).json({ success: true });
  });

  const upload = (target: PanelTarget): RequestHandler => async (req, res) => {
    const input = panelRequest(req, target);
    emptySchema.parse(req.body ?? {});
    if (uploads.active >= 2) throw new GatewayError(429, "UPLOAD_BUSY");
    uploads.active += 1;
    try {
      await service.mutate(input, async (scope) => {
        const files = await readDocuments(req, res);
        await service.upload(input, scope, files);
      });
      res.status(201).json({ success: true });
    } finally { releaseDocuments(req); uploads.active -= 1; }
  };
  router.post("/:groupId/files", uploadLimiter, upload("group"));
  router.post(`${work}/documents`, uploadLimiter, upload("work"));
  router.post(`${work}/steps/:stepId/documents`, uploadLimiter, upload("step"));

  const remove = (target: PanelTarget): RequestHandler => async (req, res) => {
    const input = panelRequest(req, target, { deleting: true });
    emptySchema.parse(req.body ?? {});
    await service.mutate(input, (scope) => service.deleteFile(input, scope));
    res.json({ success: true });
  };
  router.delete("/:groupId/files/:fileId", remove("group"));
  router.delete(`${work}/files/:fileId`, remove("work"));
  router.delete(`${work}/steps/:stepId/files/:fileId`, remove("step"));
  return router;
}