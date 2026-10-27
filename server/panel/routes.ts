import { Router, type RequestHandler } from "express";
import type { UploadConcurrency } from "../assignments/routes";
import { bearer } from "../auth";
import { GatewayError } from "../errors";
import { readDocuments, releaseDocuments } from "../files/documents";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { PanelService } from "./service";
import { PanelAuthorization } from "./authorization";
import { registerDriveRoutes, type DriveResolver } from "../drive/routes";
import { registerThreadRoutes, type ThreadResolver } from "../threads/routes";
import { currentUser } from "../auth";
import { z } from "zod";
import { commentInputSchema, panelRequest, type PanelTarget } from "./validation";
import { deletionCheckSchema } from "../../src/domain/deletion";
import { assertAppPermission } from "../workshop/support";

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

  // Gestor de archivos con carpetas del mantenimiento, la OT o el trabajo asignado (mismos archivos de la web).
  const authorization = new PanelAuthorization(upstream);
  const drive = (target: "group" | "work"): DriveResolver => async (req, query) => {
    const params = target === "group" ? { groupId: req.params.groupId } : { groupId: req.params.groupId, workId: req.params.workId };
    const scope = await authorization.resolve(panelRequest(Object.create(req, { params: { value: params }, query: { value: query } }), target));
    const branch = scope.range.companyBranchId;
    const numeric = (prefix: string) => Number(scope.group.id.slice(prefix.length));
    if (scope.group.type === "internal_maintenance") {
      return { token: scope.token, companyBranchId: branch, base: "maintenance_files", entityId: numeric("maintenance-"),
        ...(scope.work ? { fixedFolder: `maintenance_work_${Number(scope.work.id)}` } : {}) };
    }
    if (scope.work) return { token: scope.token, companyBranchId: branch, base: "work_files", entityId: Number(scope.work.id) };
    if (scope.group.type !== "external_ot") throw new GatewayError(404, "FILES_NOT_AVAILABLE", "Este grupo no tiene archivos propios; ábrelos desde el trabajo.");
    return { token: scope.token, companyBranchId: branch, base: "negotiation_files", entityId: numeric("external-") };
  };
  registerDriveRoutes(router, upstream, "/:groupId/drive", drive("group"), uploadLimiter);
  registerDriveRoutes(router, upstream, `${work}/drive`, drive("work"), uploadLimiter);

  // Comentarios (chat): la OT en una conversación; cada trabajo (también de un mantenimiento) solo en la técnica, la del
  // equipo en terreno (la general queda para la web).
  const thread = (target: "group" | "work"): ThreadResolver => async (req, query) => {
    const params = target === "group" ? { groupId: req.params.groupId } : { groupId: req.params.groupId, workId: req.params.workId };
    const scope = await authorization.resolve(panelRequest(Object.create(req, { params: { value: params }, query: { value: query } }), target));
    const user = await currentUser(upstream, scope.token);
    const branch = scope.range.companyBranchId;
    if (!scope.work) {
      if (scope.group.type !== "external_ot") throw new GatewayError(404, "COMMENTS_NOT_AVAILABLE", "Los comentarios están en cada trabajo.");
      return { token: scope.token, userId: user.id, userName: `${user.name} ${user.lastnames}`.trim(), companyBranchId: branch, base: "negotiations/comments", entityId: Number(scope.group.id.slice("external-".length)), tabs: [], module: "work_orders" };
    }
    // El servidor indica el trabajo real de los comentarios (en un mantenimiento, su trabajo vinculado).
    const resolved = z.object({ workId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).passthrough().parse(await upstream.request(
      `/technician-dashboard/panel/${scope.group.id}/works/${Number(scope.work.id)}/comment-target`, { token: scope.token, query: new URLSearchParams({
        startDate: scope.range.startDate, endDate: scope.range.endDate, companyBranchId: String(branch), groupType: scope.group.type
      }) }));
    return { token: scope.token, userId: user.id, userName: `${user.name} ${user.lastnames}`.trim(), companyBranchId: branch, base: "works/comments", entityId: resolved.workId, tabs: ["technical"] };
  };
  registerThreadRoutes(router, upstream, "/:groupId/thread", thread("group"), uploadLimiter);
  registerThreadRoutes(router, upstream, `${work}/thread`, thread("work"), uploadLimiter);

  // Eliminar lo que el técnico creó y sigue pendiente (trabajo suelto, mantenimiento u OT). GET explica si se puede y por
  // qué no; DELETE elimina. El servidor revisa creador, estado y horas; aquí se exige además el permiso de la sucursal.
  const deletion = (target: "group" | "work"): RequestHandler => async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const scope = await authorization.resolve(panelRequest(req, target));
    const deleting = req.method === "DELETE";
    if (deleting) await assertAppPermission(upstream, scope.token, scope.range.companyBranchId, "deleteOwn");
    const query = new URLSearchParams({ startDate: scope.range.startDate, endDate: scope.range.endDate, companyBranchId: String(scope.range.companyBranchId), groupType: scope.group.type });
    const path = scope.work ? `/technician-dashboard/panel/${scope.group.id}/works/${Number(scope.work.id)}/deletion` as const : `/technician-dashboard/panel/${scope.group.id}/deletion` as const;
    const result = deletionCheckSchema.parse(await upstream.request(path, { token: scope.token, method: deleting ? "DELETE" : "GET", query }));
    res.json(result);
  };
  router.get("/:groupId/deletion", deletion("group"));
  router.delete("/:groupId/deletion", deletion("group"));
  router.get(`${work}/deletion`, deletion("work"));
  router.delete(`${work}/deletion`, deletion("work"));
  return router;
}