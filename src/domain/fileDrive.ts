import { z } from "zod";

/**
 * Gestor de archivos con carpetas (el mismo de la web) para ingresos, OT, trabajos y mantenimientos.
 * Una carpeta real tiene id numérico; las automáticas del servidor (por ejemplo «Trabajo 1 · …» de un mantenimiento)
 * tienen id de texto y son de solo lectura.
 */
export const driveFolderIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[a-z][a-z_]{0,40}_\d{1,15}(?:_[a-z]{1,20})?$/)
]);
export type DriveFolderId = z.infer<typeof driveFolderIdSchema>;

export const driveFolderSchema = z.object({
  id: driveFolderIdSchema,
  name: z.string().max(300),
  fileCount: z.number().int().min(0).max(1_000_000),
  parentId: driveFolderIdSchema.nullable(),
  readOnly: z.boolean()
}).strict();
export type DriveFolder = z.infer<typeof driveFolderSchema>;

const link = z.string().max(4000);
export const driveFileSchema = z.object({
  id: z.string().regex(/^[1-9]\d{0,15}$/),
  name: z.string().max(500),
  url: link,
  thumbnailUrl: link.nullable(),
  type: z.string().max(200).nullable(),
  size: z.number().int().min(0).nullable(),
  createdAt: z.string().max(60).nullable(),
  responsibleName: z.string().max(300).nullable()
}).strict();
export type DriveFile = z.infer<typeof driveFileSchema>;

/** Qué permite este origen: carpetas propias y subir a la carpeta actual. */
export const driveCapabilitiesSchema = z.object({ folders: z.boolean(), upload: z.boolean(), remove: z.boolean() }).strict();

export const driveListingSchema = z.object({
  folderId: driveFolderIdSchema.nullable(),
  folders: z.array(driveFolderSchema).max(500),
  files: z.array(driveFileSchema).max(200),
  page: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  totalFiles: z.number().int().min(0),
  capabilities: driveCapabilitiesSchema
}).strict();
export type DriveListing = z.infer<typeof driveListingSchema>;

export const driveListQuerySchema = z.object({
  folderId: z.string().max(80).optional().transform((value, context) => {
    if (value === undefined || value === "") return null;
    const parsed = driveFolderIdSchema.safeParse(/^\d+$/.test(value) ? Number(value) : value);
    if (!parsed.success) { context.addIssue({ code: "custom", message: "INVALID_FOLDER" }); return z.NEVER; }
    return parsed.data;
  }),
  search: z.string().trim().max(120).optional().transform((value) => value || null),
  page: z.coerce.number().int().min(0).max(1000).optional().default(0)
});

export const driveFolderNameSchema = z.object({ name: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f/\\]+$/) }).strict();
export const driveMoveSchema = z.object({ folderId: driveFolderIdSchema.nullable() }).strict();

/** De quién son los archivos: el ingreso, una OT del ingreso o una asignación de Mi jornada (mantenimiento, OT o trabajo). */
export type DriveScope =
  | { kind: "entry"; companyBranchId: number; entryId: number }
  | { kind: "order"; companyBranchId: number; entryId: number; orderId: number }
  | { kind: "assignment"; groupId: string; workId?: string; range: { startDate: string; endDate: string; companyBranchId: number } };

const positive = (value: number) => z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(value);

/** Ruta base del gestor en el intermediario y la consulta que identifica la sucursal (o el rango de la asignación). */
export function driveRoute(scope: DriveScope): { path: string; query: URLSearchParams } {
  if (scope.kind === "assignment") {
    const group = z.string().regex(/^[a-z_]+-[1-9]\d*$/).parse(scope.groupId);
    const work = scope.workId === undefined ? "" : `/works/${z.string().regex(/^[1-9]\d*$/).parse(scope.workId)}`;
    return { path: `/api/assignments/${group}${work}/drive`, query: new URLSearchParams({ startDate: scope.range.startDate, endDate: scope.range.endDate, companyBranchId: String(positive(scope.range.companyBranchId)) }) };
  }
  // OT abierta desde Mi jornada: ingreso 0 (sin ingreso del Taller).
  const entry = `/api/workshop/drive/entries/${scope.kind === "order" && scope.entryId === 0 ? 0 : positive(scope.entryId)}`;
  return { path: scope.kind === "order" ? `${entry}/orders/${positive(scope.orderId)}` : entry, query: new URLSearchParams({ companyBranchId: String(positive(scope.companyBranchId)) }) };
}

/** Un archivo elegido en el teléfono para subir. */
export interface DriveUpload { id: string; uri: string; name: string; mimeType: string; size?: number }

/** Lo que el gestor de archivos necesita del servidor, para cualquier origen. */
export interface DriveApi {
  list(folderId: DriveFolderId | null, search: string | null, page: number): Promise<DriveListing>;
  upload(file: DriveUpload, folderId: DriveFolderId | null): Promise<void>;
  createFolder(name: string): Promise<DriveFolder>;
  renameFolder(folderId: DriveFolderId, name: string): Promise<void>;
  deleteFolder(folderId: DriveFolderId): Promise<void>;
  moveFile(fileId: string, from: DriveFolderId | null, to: DriveFolderId | null): Promise<void>;
  deleteFile(fileId: string, folderId: DriveFolderId | null): Promise<void>;
}

export interface FileDrivePort {
  driveList(scope: DriveScope, folderId: DriveFolderId | null, search: string | null, page: number): Promise<DriveListing>;
  driveUpload(scope: DriveScope, file: DriveUpload, folderId: DriveFolderId | null): Promise<void>;
  driveCreateFolder(scope: DriveScope, name: string): Promise<DriveFolder>;
  driveRenameFolder(scope: DriveScope, folderId: DriveFolderId, name: string): Promise<void>;
  driveDeleteFolder(scope: DriveScope, folderId: DriveFolderId): Promise<void>;
  driveMoveFile(scope: DriveScope, fileId: string, from: DriveFolderId | null, to: DriveFolderId | null): Promise<void>;
  driveDeleteFile(scope: DriveScope, fileId: string, folderId: DriveFolderId | null): Promise<void>;
}

const DRIVE_METHODS = ["driveList", "driveUpload", "driveCreateFolder", "driveRenameFolder", "driveDeleteFolder", "driveMoveFile", "driveDeleteFile"] as const;

/** El puerto del servidor con sus métodos ligados (el repositorio HTTP es una clase), o null si no los tiene todos. */
export function fileDrivePort(port: Partial<FileDrivePort> | null | undefined): FileDrivePort | null {
  if (!port) return null;
  const methods = DRIVE_METHODS.map((name) => [name, port[name]] as const);
  if (methods.some(([, method]) => typeof method !== "function")) return null;
  return Object.fromEntries(methods.map(([name, method]) => [name, (method as (...args: unknown[]) => unknown).bind(port)])) as unknown as FileDrivePort;
}

/** El gestor de un origen concreto a partir del puerto del servidor. */
export function driveApi(port: FileDrivePort, scope: DriveScope): DriveApi {
  return {
    list: (folderId, search, page) => port.driveList(scope, folderId, search, page),
    upload: (file, folderId) => port.driveUpload(scope, file, folderId),
    createFolder: (name) => port.driveCreateFolder(scope, name),
    renameFolder: (folderId, name) => port.driveRenameFolder(scope, folderId, name),
    deleteFolder: (folderId) => port.driveDeleteFolder(scope, folderId),
    moveFile: (fileId, from, to) => port.driveMoveFile(scope, fileId, from, to),
    deleteFile: (fileId, folderId) => port.driveDeleteFile(scope, fileId, folderId)
  };
}

/** Carpetas de un nivel (raíz si parentId es null), ordenadas por nombre. */
export function driveChildren(folders: readonly DriveFolder[], parentId: DriveFolderId | null): DriveFolder[] {
  return folders.filter((folder) => (folder.parentId ?? null) === parentId).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Ruta desde la raíz hasta la carpeta (para la barra «Archivos › …»). */
export function drivePath(folders: readonly DriveFolder[], folderId: DriveFolderId | null): DriveFolder[] {
  const path: DriveFolder[] = [];
  let current = folderId === null ? undefined : folders.find((folder) => folder.id === folderId);
  for (let guard = 0; current && guard < 20; guard++) {
    path.unshift(current);
    const parent: DriveFolderId | null = current.parentId;
    current = parent === null ? undefined : folders.find((folder) => folder.id === parent);
  }
  return path;
}
