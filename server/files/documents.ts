import { posix } from "node:path";
import { TextDecoder } from "node:util";
import type { Request, Response } from "express";
import multer from "multer";
import { GatewayError } from "../errors";
import { detectPhoto } from "./uploads";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
interface DocumentType { mime: string; extension: string; }
const utf8 = new TextDecoder("utf-8", { fatal: true });
const docx: DocumentType = { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" };
const xlsx: DocumentType = { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };

function unsupported(): never {
  throw new GatewayError(415, "UNSUPPORTED_DOCUMENT", "Se permiten JPEG, PNG, WebP, GIF, HEIC, PDF, DOCX, XLSX, TXT y CSV verificados; no ZIP genéricos, macros, HTML, SVG ni DOC/XLS antiguos.");
}

function safeZipName(bytes: Buffer): string {
  let name: string;
  try { name = utf8.decode(bytes); } catch { return unsupported(); }
  if (!name || /[\\:\u0000-\u001f\u007f]/.test(name) || name.startsWith("/") || name.split("/").some((part) => part === ".." || part === ".")) return unsupported();
  if (/(?:^|\/)vbaproject\.bin$/i.test(name) || /\.(?:exe|dll|com|bat|cmd|ps1|vbs|js|jse|hta|html?|svg)$/i.test(name) || /(?:^|\/)(?:activex|embeddings)\//i.test(name)) return unsupported();
  return name;
}

// Inspect bounded ZIP metadata without inflating entries or accepting ZIP64/encrypted packages.
function detectOffice(buffer: Buffer): DocumentType {
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) return unsupported();
  const entries = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  const start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0 || buffer.readUInt16LE(end + 8) !== entries || entries < 1 || entries > 2000 || start + size !== end) return unsupported();
  let cursor = start;
  let expandedBytes = 0;
  const names = new Set<string>();
  const foldedNames = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) return unsupported();
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const expandedSize = buffer.readUInt32LE(cursor + 24);
    const nameSize = buffer.readUInt16LE(cursor + 28);
    const extraSize = buffer.readUInt16LE(cursor + 30);
    const commentSize = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    expandedBytes += expandedSize;
    if (next > end || (flags & ~0x080e) !== 0 || ![0, 8].includes(method) || buffer.readUInt16LE(cursor + 34) !== 0 || expandedBytes > 100 * 1024 * 1024 || (method === 0 && compressedSize !== expandedSize)) return unsupported();
    if (((buffer.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) return unsupported();
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = safeZipName(nameBytes);
    if (foldedNames.has(name.toLowerCase())) return unsupported();
    names.add(name);
    foldedNames.add(name.toLowerCase());
    for (let extra = cursor + 46 + nameSize; extra < cursor + 46 + nameSize + extraSize;) {
      if (extra + 4 > cursor + 46 + nameSize + extraSize || buffer.readUInt16LE(extra) === 1) return unsupported();
      extra += 4 + buffer.readUInt16LE(extra + 2);
      if (extra > cursor + 46 + nameSize + extraSize) return unsupported();
    }
    if (local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 26) !== nameSize) return unsupported();
    const dataStart = local + 30 + nameSize + buffer.readUInt16LE(local + 28);
    if (dataStart + compressedSize > start || !buffer.subarray(local + 30, local + 30 + nameSize).equals(nameBytes)) return unsupported();
    if ((flags & 8) === 0 && (buffer.readUInt32LE(local + 18) !== compressedSize || buffer.readUInt32LE(local + 22) !== expandedSize || buffer.readUInt32LE(local + 14) !== buffer.readUInt32LE(cursor + 16))) return unsupported();
    if (["[Content_Types].xml", "word/document.xml", "xl/workbook.xml"].includes(name) && (expandedSize === 0 || compressedSize === 0)) return unsupported();
    ranges.push({ start: local, end: dataStart + compressedSize });
    cursor = next;
  }
  ranges.sort((a, b) => a.start - b.start);
  if (cursor !== end || ranges[0]?.start !== 0 || ranges.some((range, index) => index > 0 && range.start < ranges[index - 1]!.end)) return unsupported();
  if (!names.has("[Content_Types].xml") || names.has("word/document.xml") === names.has("xl/workbook.xml")) return unsupported();
  return names.has("word/document.xml") ? docx : xlsx;
}

function decodedFilename(original: string): string {
  if ([...original].every((character) => character.charCodeAt(0) <= 255)) {
    try { return utf8.decode(Buffer.from(original, "latin1")); } catch { return original; }
  }
  return original;
}

export function documentFilename(original: string, extension?: string): string {
  let name = posix.basename(decodedFilename(original).replace(/\\/g, "/")).normalize("NFC")
    .replace(/[<>:"|?*\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "-").replace(/^\.+|[. ]+$/g, "").trim();
  if (!name) name = "documento";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  if (extension) {
    const current = posix.extname(name).slice(1).toLowerCase();
    if (current !== extension && !(extension === "jpg" && current === "jpeg")) name = `${name.slice(0, name.length - posix.extname(name).length)}.${extension}`;
  }
  const suffix = posix.extname(name);
  if (Buffer.byteLength(suffix, "utf8") > 32) throw new GatewayError(400, "INVALID_DOCUMENT_NAME");
  let stem = name.slice(0, name.length - suffix.length);
  while (Buffer.byteLength(stem + suffix, "utf8") > 240) stem = [...stem].slice(0, -1).join("");
  return stem + suffix;
}

export function detectDocument(buffer: Buffer, filename: string): DocumentType {
  if (buffer.length === 0) throw new GatewayError(400, "EMPTY_DOCUMENT");
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
  try { return detectPhoto(buffer); }
  catch (error) { if (!(error instanceof GatewayError) || error.code !== "UNSUPPORTED_IMAGE") throw error; }
  if (buffer.length >= 14 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6)) && buffer.readUInt16LE(6) > 0 && buffer.readUInt16LE(8) > 0 && buffer.at(-1) === 0x3b) return { mime: "image/gif", extension: "gif" };
  if (buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) return { mime: "application/pdf", extension: "pdf" };
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return detectOffice(buffer);
  const extension = posix.extname(documentFilename(filename)).slice(1).toLowerCase();
  if (!["txt", "csv"].includes(extension) || buffer.subarray(0, 2).equals(Buffer.from("MZ"))) return unsupported();
  let text: string;
  try { text = utf8.decode(buffer); } catch { return unsupported(); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /<\/?[a-z][^>]*>|<!doctype|<\?|<!--/i.test(text)) return unsupported();
  return { mime: extension === "csv" ? "text/csv" : "text/plain", extension };
}

export function releaseDocuments(req: Request): void {
  if (Array.isArray(req.files)) for (const file of req.files) file.buffer = Buffer.alloc(0);
}

export async function readDocuments(req: Request, res: Response): Promise<Express.Multer.File[]> {
  if (!req.is("multipart/form-data")) throw new GatewayError(415, "MULTIPART_REQUIRED");
  if (Number(req.headers["content-length"] ?? 0) > MAX_DOCUMENT_BYTES + 65536) throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_DOCUMENT_BYTES + 1, fields: 0, parts: 2, fieldNameSize: 100, headerPairs: 50 } }).array("files", 1);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        req.off("aborted", abort);
        if (error) reject(error); else resolve();
      };
      const abort = (): void => finish(new GatewayError(400, "UPLOAD_ABORTED"));
      const timeout = setTimeout(() => { finish(new GatewayError(408, "UPLOAD_TIMEOUT")); req.destroy(); }, 120_000);
      timeout.unref();
      req.once("aborted", abort);
      upload(req, res, finish);
    });
    if (!Array.isArray(req.files) || req.files.length !== 1) throw new GatewayError(400, "ONE_DOCUMENT_REQUIRED");
    for (const file of req.files) {
      const type = detectDocument(file.buffer, file.originalname);
      file.originalname = documentFilename(file.originalname, type.extension);
      file.mimetype = type.mime;
    }
    return req.files;
  } catch (error) {
    releaseDocuments(req);
    if (error instanceof GatewayError) throw error;
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
    throw new GatewayError(400, "INVALID_DOCUMENT_MULTIPART", "Envíe un único archivo de hasta 25 MiB en files, sin campos adicionales.");
  }
}

export function documentForm(files: Express.Multer.File[], field: "files" | "attachments", companyBranchId?: number): FormData {
  if (files.length !== 1) throw new GatewayError(400, "ONE_DOCUMENT_REQUIRED");
  const form = new FormData();
  if (companyBranchId !== undefined) form.set("companyBranchId", String(companyBranchId));
  for (const file of files) {
    const type = detectDocument(file.buffer, file.originalname);
    form.append(field, new Blob([new Uint8Array(file.buffer)], { type: type.mime }), documentFilename(file.originalname, type.extension));
  }
  return form;
}