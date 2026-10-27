import type { Request, RequestHandler, Router } from "express";
import { z } from "zod";
import { driveFolderIdSchema, driveFolderNameSchema, driveListQuerySchema, driveMoveSchema, type DriveFolderId } from "../../src/domain/fileDrive";
import { GatewayError } from "../errors";
import { readDocuments, releaseDocuments } from "../files/documents";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { assertAppPermission, mobileAppConfig } from "../workshop/support";
import { DriveService, type DriveTarget } from "./service";

/** Quien sabe autorizar el registro (ingreso, OT, trabajo…) con el resto de la consulta (sucursal, rango). */
export type DriveResolver = (req: Request, query: Record<string, unknown>) => Promise<DriveTarget>;

const DRIVE_KEYS = ["folderId", "search", "page"] as const;
const folderParam = z.string().max(80).transform((value, context) => {
  const parsed = driveFolderIdSchema.safeParse(/^\d+$/.test(value) ? Number(value) : value);
  if (!parsed.success) { context.addIssue({ code: "custom", message: "INVALID_FOLDER" }); return z.NEVER; }
  return parsed.data;
});
const fileParam = z.string().regex(/^[1-9]\d{0,15}$/);

function split(req: Request): { drive: Record<string, unknown>; rest: Record<string, unknown> } {
  const drive: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.query)) (DRIVE_KEYS as readonly string[]).includes(key) ? drive[key] = value : rest[key] = value;
  return { drive, rest };
}
const currentFolder = (drive: Record<string, unknown>): DriveFolderId | null => driveListQuerySchema.pick({ folderId: true }).strict().parse({ folderId: drive.folderId }).folderId;

/**
 * Gestor de archivos genérico: las mismas rutas para cualquier registro, montadas bajo `prefix` (por ejemplo
 * `/drive/entries/:entryId`). Cada cambio revisa que la carpeta y el archivo sean de ese registro.
 */
export function registerDriveRoutes(router: Router, upstream: Upstream, prefix: string, resolve: DriveResolver, uploadLimiter?: RequestHandler): void {
  const service = new DriveService(upstream);
  const busy = new Set<string>();
  let uploading = 0;
  const once = async (target: DriveTarget, action: () => Promise<void>) => {
    const key = `${target.base}:${target.entityId}`;
    if (busy.has(key)) throw new GatewayError(409, "DRIVE_BUSY", "Hay otro cambio en curso en estos archivos. Espera un momento.");
    busy.add(key);
    try { await action(); } finally { busy.delete(key); }
  };
  // Cada cambio exige además lo que permite la sucursal en la app (configuración «Permisos de la app móvil»).
  const allowed = (target: DriveTarget, key: "filesUpload" | "filesFolders" | "filesDelete") => assertAppPermission(upstream, target.token, target.companyBranchId, key);

  router.get(prefix, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { drive, rest } = split(req);
    const query = driveListQuerySchema.strict().parse(drive);
    const target = await resolve(req, rest);
    const config = await mobileAppConfig(upstream, target.token, target.companyBranchId);
    const listing = await service.list(target, query.folderId, query.search, query.page);
    const { capabilities } = listing;
    res.set("Cache-Control", "no-store").json({ ...listing, capabilities: {
      folders: capabilities.folders && config.filesFolders, upload: capabilities.upload && config.filesUpload, remove: capabilities.remove && config.filesDelete
    } });
  });

  const upload: RequestHandler = async (req, res) => {
    const { drive, rest } = split(req);
    const folderId = currentFolder(drive);
    if (uploading >= 2) throw new GatewayError(429, "UPLOAD_BUSY");
    uploading += 1;
    try {
      const target = await resolve(req, rest);
      await allowed(target, "filesUpload");
      const files = await readDocuments(req, res);
      await once(target, () => service.upload(target, folderId, files));
      res.status(201).json({ success: true });
    } finally { releaseDocuments(req); uploading -= 1; }
  };
  if (uploadLimiter) router.post(prefix, uploadLimiter, upload); else router.post(prefix, upload);

  router.post(`${prefix}/folders`, async (req, res) => {
    const { drive, rest } = split(req);
    emptySchema.parse(drive);
    const { name } = driveFolderNameSchema.parse(req.body);
    const target = await resolve(req, rest);
    await allowed(target, "filesFolders");
    let created: Awaited<ReturnType<DriveService["createFolder"]>> | null = null;
    await once(target, async () => { created = await service.createFolder(target, name); });
    res.status(201).json(created);
  });

  router.patch(`${prefix}/folders/:folderId`, async (req, res) => {
    const { drive, rest } = split(req);
    emptySchema.parse(drive);
    const folderId = folderParam.parse(req.params.folderId);
    const { name } = driveFolderNameSchema.parse(req.body);
    const target = await resolve(req, rest);
    await allowed(target, "filesFolders");
    await once(target, () => service.renameFolder(target, folderId, name));
    res.json({ success: true });
  });

  router.delete(`${prefix}/folders/:folderId`, async (req, res) => {
    const { drive, rest } = split(req);
    emptySchema.parse(drive);
    emptySchema.parse(req.body ?? {});
    const folderId = folderParam.parse(req.params.folderId);
    const target = await resolve(req, rest);
    await allowed(target, "filesFolders");
    await once(target, () => service.deleteFolder(target, folderId));
    res.json({ success: true });
  });

  // folderId en la consulta: la carpeta donde está hoy el archivo.
  router.patch(`${prefix}/files/:fileId/folder`, async (req, res) => {
    const { drive, rest } = split(req);
    const from = currentFolder(drive);
    const fileId = fileParam.parse(req.params.fileId);
    const { folderId } = driveMoveSchema.parse(req.body);
    const target = await resolve(req, rest);
    await allowed(target, "filesFolders");
    await once(target, () => service.moveFile(target, fileId, from, folderId));
    res.json({ success: true });
  });

  router.delete(`${prefix}/files/:fileId`, async (req, res) => {
    const { drive, rest } = split(req);
    const folderId = currentFolder(drive);
    emptySchema.parse(req.body ?? {});
    const fileId = fileParam.parse(req.params.fileId);
    const target = await resolve(req, rest);
    await allowed(target, "filesDelete");
    await once(target, () => service.deleteFile(target, fileId, folderId));
    res.json({ success: true });
  });
}
