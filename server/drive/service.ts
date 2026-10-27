import { z } from "zod";
import { driveFolderSchema, driveListingSchema, type DriveFile, type DriveFolder, type DriveFolderId, type DriveListing } from "../../src/domain/fileDrive";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import { documentForm } from "../files/documents";
import { panelFilesSchema } from "../panel/contracts";
import type { Upstream } from "../upstream";

export type DriveBase = "operation_area_entries/files" | "negotiation_files" | "work_files" | "maintenance_files";

/** Dónde viven los archivos de un ingreso, OT, trabajo o mantenimiento (ya autorizado por la ruta). */
export interface DriveTarget {
  token: string;
  companyBranchId: number;
  base: DriveBase;
  entityId: number;
  /** Todo en una carpeta fija del servidor, sin carpetas propias (trabajo dentro de un mantenimiento). */
  fixedFolder?: string;
}

const PAGE_SIZE = 50;
const rawFolderSchema = z.object({
  id: z.union([z.number(), z.string()]), name: z.string(), fileCount: z.union([z.number(), z.string()]).nullish(),
  parentId: z.union([z.number(), z.string()]).nullish(), readOnly: z.boolean().nullish()
}).passthrough();

const sameFolder = (left: DriveFolderId | null, right: DriveFolderId | null) => left === null || right === null ? left === right : String(left) === String(right);

export class DriveService {
  constructor(private readonly upstream: Upstream) {}

  async folders(target: DriveTarget): Promise<DriveFolder[]> {
    if (target.fixedFolder) return [];
    const raw = await this.upstream.request(`/${target.base}/folders/${target.entityId}`, { token: target.token, query: new URLSearchParams({
      filters: JSON.stringify({ companyBranchId: target.companyBranchId })
    }) });
    const rows = Array.isArray(raw) ? raw : z.object({ data: z.array(z.unknown()) }).passthrough().parse(raw).data;
    return rows.slice(0, 500).flatMap((row) => {
      const parsed = rawFolderSchema.safeParse(row);
      if (!parsed.success) return [];
      const folder = driveFolderSchema.safeParse({
        id: typeof parsed.data.id === "string" && /^\d+$/.test(parsed.data.id) ? Number(parsed.data.id) : parsed.data.id,
        name: parsed.data.name.slice(0, 300),
        fileCount: Math.max(0, Math.trunc(Number(parsed.data.fileCount ?? 0)) || 0),
        parentId: parsed.data.parentId == null ? null : typeof parsed.data.parentId === "string" && /^\d+$/.test(parsed.data.parentId) ? Number(parsed.data.parentId) : parsed.data.parentId,
        // Las carpetas automáticas (id de texto) nunca se editan, aunque el servidor no lo diga.
        readOnly: parsed.data.readOnly === true || typeof parsed.data.id === "string" && !/^\d+$/.test(parsed.data.id)
      });
      return folder.success ? [folder.data] : [];
    });
  }

  private async page(target: DriveTarget, folderId: DriveFolderId | null, search: string | null, page: number) {
    const folder = target.fixedFolder ?? folderId;
    return parseUpstream(panelFilesSchema, await this.upstream.request(`/${target.base}/${target.entityId}`, { token: target.token, query: new URLSearchParams({
      companyBranchId: String(target.companyBranchId),
      filters: JSON.stringify({ companyBranchId: target.companyBranchId, ...(folder !== null ? { folderId: folder } : {}), ...(search ? { search } : {}) }),
      pagination: JSON.stringify({ page, limit: PAGE_SIZE })
    }) }));
  }

  /** Carpeta existente de este registro (o la raíz con null). */
  private async folderOf(target: DriveTarget, folderId: DriveFolderId | null, folders?: DriveFolder[]): Promise<DriveFolder | null> {
    if (folderId === null) return null;
    const found = (folders ?? await this.folders(target)).find((folder) => sameFolder(folder.id, folderId));
    if (!found) throw new GatewayError(404, "FOLDER_NOT_FOUND", "Esa carpeta ya no existe. Actualiza la lista.");
    return found;
  }

  private async editableFolder(target: DriveTarget, folderId: DriveFolderId): Promise<DriveFolder> {
    if (target.fixedFolder) throw new GatewayError(409, "FOLDERS_NOT_AVAILABLE", "Aquí no se pueden crear ni cambiar carpetas.");
    const folder = await this.folderOf(target, folderId);
    if (!folder || folder.readOnly || typeof folder.id !== "number") throw new GatewayError(409, "FOLDER_READ_ONLY", "Esta carpeta la crea el sistema y no se puede cambiar.");
    return folder;
  }

  async list(target: DriveTarget, folderId: DriveFolderId | null, search: string | null, page: number): Promise<DriveListing> {
    const folders = await this.folders(target);
    const current = await this.folderOf(target, folderId, folders);
    const result = await this.page(target, folderId, search, page);
    const files: DriveFile[] = result.data.slice(0, 200).map((file) => ({
      id: String(file.id), name: file.name.slice(0, 500), url: (file.originalUrl || file.url || "").slice(0, 4000),
      thumbnailUrl: file.thumbnailUrl ? file.thumbnailUrl.slice(0, 4000) : null, type: file.type ? file.type.slice(0, 200) : null,
      size: typeof file.size === "number" && Number.isSafeInteger(file.size) ? file.size : null,
      createdAt: file.createdAt ? file.createdAt.slice(0, 60) : null, responsibleName: file.responsible?.name ? file.responsible.name.slice(0, 300) : null
    }));
    return driveListingSchema.parse({
      folderId, folders, files, page, totalPages: result.totalPages, totalFiles: result.totalRows,
      capabilities: { folders: !target.fixedFolder, upload: !current?.readOnly, remove: true }
    });
  }

  /** El archivo está en esa carpeta de este registro (se busca en sus páginas, sin confiar en el teléfono). */
  private async assertFileIn(target: DriveTarget, folderId: DriveFolderId | null, fileId: string): Promise<void> {
    for (let page = 0; page < 100; page++) {
      const result = await this.page(target, folderId, null, page);
      if (result.data.some((file) => String(file.id) === fileId)) return;
      if (page + 1 >= result.totalPages || result.data.length === 0) break;
    }
    throw new GatewayError(404, "FILE_NOT_FOUND", "Ese archivo ya no está en esta carpeta. Actualiza la lista.");
  }

  async upload(target: DriveTarget, folderId: DriveFolderId | null, files: Express.Multer.File[]): Promise<void> {
    const folder = await this.folderOf(target, folderId);
    if (folder?.readOnly) throw new GatewayError(409, "FOLDER_READ_ONLY", "En esta carpeta no se pueden subir archivos.");
    const form = documentForm(files, "attachments", target.companyBranchId);
    const destination = target.fixedFolder ?? folderId;
    if (destination !== null) form.set("folderId", String(destination));
    await this.upstream.request(`/${target.base}/${target.entityId}`, { method: "POST", token: target.token, form });
  }

  async createFolder(target: DriveTarget, name: string): Promise<DriveFolder> {
    if (target.fixedFolder) throw new GatewayError(409, "FOLDERS_NOT_AVAILABLE", "Aquí no se pueden crear carpetas.");
    const folders = await this.folders(target);
    if (folders.some((folder) => folder.parentId === null && folder.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new GatewayError(409, "FOLDER_EXISTS", "Ya hay una carpeta con ese nombre.");
    }
    await this.upstream.request(`/${target.base}/folders/${target.entityId}`, { method: "POST", token: target.token, json: { name, companyBranchId: target.companyBranchId } });
    const created = (await this.folders(target)).find((folder) => typeof folder.id === "number" && folder.name.trim().toLowerCase() === name.toLowerCase() && !folders.some((before) => before.id === folder.id));
    if (!created) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    return created;
  }

  async renameFolder(target: DriveTarget, folderId: DriveFolderId, name: string): Promise<void> {
    const folder = await this.editableFolder(target, folderId);
    await this.upstream.request(`/${target.base}/folders/${folder.id as number}`, { method: "PATCH", token: target.token, json: { name } });
  }

  async deleteFolder(target: DriveTarget, folderId: DriveFolderId): Promise<void> {
    const folder = await this.editableFolder(target, folderId);
    const folders = await this.folders(target);
    if (folder.fileCount > 0 || folders.some((child) => sameFolder(child.parentId, folder.id))) {
      throw new GatewayError(409, "FOLDER_NOT_EMPTY", "La carpeta tiene archivos. Muévelos o bórralos antes de eliminarla.");
    }
    await this.upstream.request(`/${target.base}/folders/${folder.id as number}`, { method: "DELETE", token: target.token });
  }

  async moveFile(target: DriveTarget, fileId: string, from: DriveFolderId | null, to: DriveFolderId | null): Promise<void> {
    if (target.fixedFolder) throw new GatewayError(409, "FOLDERS_NOT_AVAILABLE", "Aquí no se pueden mover archivos.");
    if (sameFolder(from, to)) return;
    const source = await this.folderOf(target, from);
    if (source?.readOnly) throw new GatewayError(409, "FOLDER_READ_ONLY", "Los archivos de esta carpeta no se pueden mover.");
    const destination = to === null ? null : await this.editableFolder(target, to);
    await this.assertFileIn(target, from, fileId);
    await this.upstream.request(`/files/${Number(fileId)}/folder`, { method: "PATCH", token: target.token, json: { folderId: destination?.id ?? null } });
  }

  async deleteFile(target: DriveTarget, fileId: string, folderId: DriveFolderId | null): Promise<void> {
    const folder = await this.folderOf(target, folderId);
    if (folder?.readOnly) throw new GatewayError(409, "FOLDER_READ_ONLY", "Los archivos de esta carpeta se borran desde su origen.");
    await this.assertFileIn(target, folderId, fileId);
    const id = Number(fileId);
    const query = new URLSearchParams({ companyBranchId: String(target.companyBranchId) });
    // Ingreso y OT tienen su propio borrado (desvincula y borra); trabajos y mantenimientos usan el general.
    if (target.base === "operation_area_entries/files") await this.upstream.request(`/operation_area_entries/files/${target.entityId}/${id}`, { method: "DELETE", token: target.token, query });
    else if (target.base === "negotiation_files") await this.upstream.request(`/negotiation_files/${target.entityId}/${id}`, { method: "DELETE", token: target.token, query });
    else await this.upstream.request(`/files/${id}`, { method: "DELETE", token: target.token, query });
  }
}
