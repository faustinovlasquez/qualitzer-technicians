import { Router, json, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { syncCommandSchema, syncOperationIdSchema, syncResourceIdSchema, type SyncReceipt } from "../../src/domain/offlineProtocol";
import { mobileActor } from "../creation/authorization";
import { bearer, currentUser } from "../auth";
import type { UploadConcurrency } from "../assignments/routes";
import { GatewayError } from "../errors";
import { releaseDocuments } from "../files/documents";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { readSyncDocument } from "./upload";

const receiptQuery = z.object({ companyBranchId: syncResourceIdSchema }).strict();
function respond(res: Response, result: { status: number; receipt: SyncReceipt }): void {
  if (result.receipt.state === "in_progress") res.set("Retry-After", "5");
  res.status(result.status).json(result.receipt);
}

export function createOfflineRouter(upstream: Upstream, uploadLimiter: RequestHandler, uploads: UploadConcurrency): Router {
  const router = Router();
  router.use((req, res, next) => { bearer(req); res.set("Cache-Control", "no-store"); next(); });
  router.post("/commands", (req, _res, next) => {
    if (req.headers["content-encoding"] !== undefined && req.headers["content-encoding"] !== "identity") throw new GatewayError(415, "UNSUPPORTED_CONTENT_ENCODING");
    next();
  }, json({ limit: "64kb", strict: true, inflate: false }), async (req, res) => {
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = syncCommandSchema.parse(req.body);
    const { token } = await mobileActor(upstream, req, input.scope.companyBranchId);
    respond(res, await upstream.requestReceipt("/mobile-sync/commands", input.operationId, { method: "POST", token, json: input }));
  });
  router.get("/receipts/:operationId", async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const id = syncOperationIdSchema.parse(req.params.operationId);
    const { companyBranchId } = receiptQuery.parse(req.query);
    const { token } = await mobileActor(upstream, req, companyBranchId);
    respond(res, await upstream.requestReceipt(`/mobile-sync/receipts/${id}`, id, { token, query: new URLSearchParams({ companyBranchId: String(companyBranchId) }) }));
  });
  router.post("/documents", uploadLimiter, async (req, res) => {
    emptySchema.parse(req.query);
    if (uploads.active >= 2) throw new GatewayError(429, "UPLOAD_BUSY");
    uploads.active++;
    try {
      const user = await currentUser(upstream, bearer(req));
      if (user.workerId === null || user.workerId <= 0) throw new GatewayError(403, "WORKER_REQUIRED");
      const { metadata, file } = await readSyncDocument(req, res);
      const { token, user: fresh } = await mobileActor(upstream, req, metadata.scope.companyBranchId);
      if (fresh.id !== user.id || fresh.workerId !== user.workerId) throw new GatewayError(401, "SESSION_CHANGED");
      const form = new FormData();
      const { sha256: _sha256, ...backendMetadata } = metadata;
      form.append("metadata", JSON.stringify(backendMetadata));
      form.append("files", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
      respond(res, await upstream.requestReceipt("/mobile-sync/documents", metadata.operationId, { method: "POST", token, form }));
    } finally { releaseDocuments(req); uploads.active--; }
  });
  return router;
}