import { File } from "expo-file-system";
import { Platform } from "react-native";
import type { Attachment } from "../../../domain/models";
import { httpUrl } from "../detailRules";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_TOTAL_BYTES } from "../localPhotos";

export const MAX_FILES = MAX_PHOTOS;
export const MAX_FILE_BYTES = MAX_PHOTO_BYTES;
export const MAX_FILES_BYTES = MAX_TOTAL_BYTES;
export const MAX_COMMENT_LENGTH = 10000;
export type WorkspaceMode = "live" | "demo";
export type FileSource = "camera" | "library" | "pdf" | "document";
export interface SelectedFile { uri: string; name: string; mimeType?: string; size?: number; blob?: Blob; }
export interface FileMetadata { name: string; mimeType: string; size: number; }

const formats = [
  { extension: "jpg", mimeType: "image/jpeg" },
  { extension: "jpeg", mimeType: "image/jpeg" },
  { extension: "png", mimeType: "image/png" },
  { extension: "webp", mimeType: "image/webp" },
  { extension: "heic", mimeType: "image/heic" },
  { extension: "heif", mimeType: "image/heif" },
  { extension: "gif", mimeType: "image/gif" },
  { extension: "bmp", mimeType: "image/bmp" },
  { extension: "avif", mimeType: "image/avif" },
  { extension: "pdf", mimeType: "application/pdf" },
  { extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { extension: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { extension: "txt", mimeType: "text/plain" },
  { extension: "csv", mimeType: "text/csv" },
];

export const DOCUMENT_MIME_TYPES = [...new Set(formats.map((format) => format.mimeType))];
export function fileExtension(mimeType: string): string {
  const format = formats.find((candidate) => candidate.mimeType === mimeType);
  if (!format) throw new Error("Formato de archivo no admitido.");
  return format.extension;
}

export function isImageType(mimeType: string | null | undefined): boolean {
  return formats.some((format) => format.mimeType === mimeType?.toLowerCase() && format.mimeType.startsWith("image/"));
}

export function describeFile(asset: SelectedFile): FileMetadata {
  const name = asset.name.trim();
  if (!name || name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(name)) throw new Error("El nombre del archivo no es válido o supera 240 caracteres.");
  if (Platform.OS !== "web" && !/^(?:file:\/\/\/|content:\/\/)/.test(asset.uri)) throw new Error(`«${name}»: el selector no entregó un archivo local válido.`);
  const nativeFile = Platform.OS === "web" ? null : new File(asset.uri);
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  const byExtension = formats.find((format) => format.extension === extension);
  const declared = (asset.mimeType ?? asset.blob?.type ?? nativeFile?.type ?? "").toLowerCase().split(";")[0].trim();
  const byMime = formats.find((format) => format.mimeType === declared);
  const generic = declared === "" || declared === "application/octet-stream";
  const officeZip = (extension === "docx" || extension === "xlsx") && ["application/zip", "application/x-zip-compressed"].includes(declared);
  const csv = extension === "csv" && ["text/plain", "application/vnd.ms-excel"].includes(declared);
  const format = byExtension ?? (extension === undefined ? byMime : undefined);
  if (!format || (!generic && !officeZip && !csv && declared !== format.mimeType)) throw new Error(`«${name}»: formato no admitido. Usa imágenes, PDF, DOCX, XLSX, TXT o CSV; no SVG, ejecutables ni archivos con macros.`);
  const size = Platform.OS === "web" ? asset.blob?.size : nativeFile?.size;
  if (size === undefined || !Number.isSafeInteger(size) || size <= 0) throw new Error(`«${name}»: no se pudo verificar el tamaño o el archivo está vacío. Vuelve a seleccionarlo.`);
  if (size > MAX_FILE_BYTES) throw new Error(`«${name}» supera 25 MB (25 MiB). No se añadió ningún archivo de esta selección.`);
  const fileName = extension === undefined ? `${name}.${format.extension}` : name;
  if (fileName.length > 240) throw new Error("El nombre del archivo, incluida su extensión, supera 240 caracteres.");
  return { name: fileName, size, mimeType: format.mimeType };
}

export function safeFileUrl(value: string | null | undefined): string | null {
  if (!value || /[\s\u0000-\u001f\u007f\\]/.test(value) || !/^https?:\/\//i.test(value)) return null;
  return httpUrl(value);
}

export function presentAttachment(file: Attachment, mode: WorkspaceMode): Attachment {
  const localImage = (value: string | null | undefined): string | null => {
    if (mode !== "demo" || !isImageType(file.type) || !value) return null;
    if (Platform.OS === "web" && value.startsWith("blob:")) return value;
    if (/^data:image\/(?:jpeg|png|webp|heic);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
    if (Platform.OS !== "web" && value.startsWith("file:///")) return value;
    return null;
  };
  return { ...file, url: safeFileUrl(file.url) ?? localImage(file.url) ?? "", thumbnailUrl: safeFileUrl(file.thumbnailUrl) ?? localImage(file.thumbnailUrl), type: isImageType(file.type) ? file.type?.toLowerCase() : "application/octet-stream" };
}

export function sortedAttachments(files: Attachment[]): Attachment[] {
  const timestamp = (file: Attachment): number => {
    const date = file.createdAt ? Date.parse(file.createdAt) : 0;
    return Number.isFinite(date) ? date : 0;
  };
  return [...files].sort((left, right) => timestamp(right) - timestamp(left) || left.name.localeCompare(right.name, "es", { numeric: true }) || String(left.id).localeCompare(String(right.id)));
}

export function fileSizeLabel(size: number): string { return `${(size / 1024 / 1024).toFixed(1)} MB`; }

export function commentDate(value: string | null): string {
  if (!value) return "Fecha no informada";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Fecha no disponible";
}