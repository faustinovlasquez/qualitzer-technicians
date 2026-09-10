import { createHash, timingSafeEqual } from "node:crypto";
import { extname } from "node:path";
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { syncDocumentSchema, type SyncDocument } from "../../src/domain/offlineProtocol";
import { GatewayError } from "../errors";
import { detectDocument, MAX_DOCUMENT_BYTES, releaseDocuments } from "../files/documents";

export const MAX_SYNC_METADATA_BYTES = 16 * 1024;
export const MAX_SYNC_MULTIPART_BYTES = MAX_DOCUMENT_BYTES + MAX_SYNC_METADATA_BYTES + 65536;

function validateFile(file: Express.Multer.File): void {
  const invalid = () => new GatewayError(415, "MOBILE_SYNC_INVALID_FILE_TYPE");
  const name = Buffer.from(file.originalname, "latin1").toString("utf8").normalize("NFKC");
  if (!name || name.length > 180 || /[\\/\u0000-\u001f\u007f\ufffd]/.test(name)) throw invalid();
  const type = detectDocument(file.buffer, name);
  const extension = extname(name).slice(1).toLowerCase();
  if (type.extension === "heic" || !(extension === type.extension || (extension === "jpeg" && type.extension === "jpg"))) throw invalid();
  if (file.mimetype !== type.mime && file.mimetype !== "application/octet-stream") throw invalid();
  if (["txt", "csv"].includes(type.extension) && /<\s*(?:!doctype|html|script|svg|iframe)/i.test(file.buffer.toString("utf8"))) throw invalid();
  if (type.extension === "csv" && /(?:^|[,;\r\n])\s*["']?\s*[=+@]/m.test(file.buffer.toString("utf8"))) throw invalid();
  if (type.extension === "pdf") {
    const content = file.buffer.toString("latin1").replace(/#([0-9a-f]{2})/gi, (_match, value: string) => String.fromCharCode(parseInt(value, 16)));
    if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(content) || !/%%EOF\s*$/.test(content.slice(-1024)) || /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia)\b/i.test(content)) throw invalid();
  }
  file.originalname = name.replace(/[^a-zA-Z0-9._ -]/g, "_");
  file.mimetype = type.mime;
}

export async function readSyncDocument(req: Request, res: Response): Promise<{ metadata: SyncDocument; file: Express.Multer.File }> {
  if (!req.is("multipart/form-data")) throw new GatewayError(415, "MULTIPART_REQUIRED");
  if (req.headers["content-encoding"] !== undefined && req.headers["content-encoding"] !== "identity") throw new GatewayError(415, "UNSUPPORTED_CONTENT_ENCODING");
  if (Number(req.headers["content-length"] ?? 0) > MAX_SYNC_MULTIPART_BYTES) throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
  const storage: multer.StorageEngine = {
    _handleFile(request, file, callback) {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        request.off("aborted", abort);
        if (error) callback(error); else callback(null, { buffer: Buffer.concat(chunks), size });
        chunks.length = 0;
      };
      const abort = () => finish(new GatewayError(400, "UPLOAD_ABORTED"));
      request.once("aborted", abort);
      file.stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) { finish(new GatewayError(413, "DOCUMENT_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      file.stream.once("error", finish);
      file.stream.once("end", () => finish());
    },
    _removeFile(_request, file, callback) { file.buffer = Buffer.alloc(0); callback(null); },
  };
  const upload = multer({ storage, preservePath: true, limits: { files: 1, fields: 1, parts: 3, fileSize: MAX_DOCUMENT_BYTES + 1, fieldSize: MAX_SYNC_METADATA_BYTES, fieldNameSize: 100, headerPairs: 50 } }).array("files", 1);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let size = 0;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        req.off("aborted", abort);
        req.off("data", count);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new GatewayError(400, "UPLOAD_ABORTED"));
      const count = (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_SYNC_MULTIPART_BYTES) { finish(new GatewayError(413, "DOCUMENT_TOO_LARGE")); req.destroy(); }
      };
      const timeout = setTimeout(() => { finish(new GatewayError(408, "UPLOAD_TIMEOUT")); req.destroy(); }, 120000);
      timeout.unref();
      req.once("aborted", abort);
      req.on("data", count);
      upload(req, res, finish);
    });
    const fields = z.object({ metadata: z.string().refine((value) => Buffer.byteLength(value) <= MAX_SYNC_METADATA_BYTES) }).strict().parse(req.body);
    const metadata = syncDocumentSchema.parse(JSON.parse(fields.metadata));
    if (!Array.isArray(req.files) || req.files.length !== 1) throw new GatewayError(400, "ONE_DOCUMENT_REQUIRED");
    const file = req.files[0]!;
    const actual = createHash("sha256").update(file.buffer).digest();
    if (!timingSafeEqual(actual, Buffer.from(metadata.sha256, "hex"))) throw new GatewayError(400, "OFFLINE_DOCUMENT_DIGEST_MISMATCH");
    validateFile(file);
    return { metadata, file };
  } catch (error) {
    releaseDocuments(req);
    if (error instanceof GatewayError) throw error;
    if (error instanceof multer.MulterError && ["LIMIT_FILE_SIZE", "LIMIT_FIELD_VALUE"].includes(error.code)) throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
    throw new GatewayError(400, "MOBILE_SYNC_INVALID_MULTIPART");
  }
}