import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import multer from "multer";
import { GatewayError } from "../errors";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
interface PhotoType { mime: string; extension: string; }

export function detectPhoto(buffer: Buffer): PhotoType {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString("ascii", 12, 16) === "IHDR") return { mime: "image/png", extension: "png" };
  if (buffer.length >= 20 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16))) return { mime: "image/webp", extension: "webp" };
  if (buffer.length >= 24 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const boxSize = buffer.readUInt32BE(0);
    if (boxSize >= 24 && boxSize <= buffer.length && boxSize <= 4096 && boxSize % 4 === 0) {
      const brands = [buffer.toString("ascii", 8, 12)];
      for (let offset = 16; offset < boxSize; offset += 4) brands.push(buffer.toString("ascii", offset, offset + 4));
      if (brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand))) return { mime: "image/heic", extension: "heic" };
    }
  }
  throw new GatewayError(400, "UNSUPPORTED_IMAGE", "Solo se permiten imágenes JPEG, PNG, WebP o HEIC verificadas por su firma.");
}

export async function readPhotos(req: Request, res: Response): Promise<Express.Multer.File[]> {
  if (!req.is("multipart/form-data")) throw new GatewayError(415, "MULTIPART_REQUIRED");
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (declaredLength > MAX_TOTAL_BYTES + 65536) throw new GatewayError(413, "UPLOAD_TOTAL_TOO_LARGE");
  let totalBytes = 0;
  const storage: multer.StorageEngine = {
    _handleFile(request, file, callback) {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        request.off("aborted", abort);
        if (error) { chunks.length = 0; callback(error); }
        else { callback(null, { buffer: Buffer.concat(chunks), size }); chunks.length = 0; }
      };
      const abort = (): void => finish(new GatewayError(400, "UPLOAD_ABORTED"));
      request.once("aborted", abort);
      file.stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        totalBytes += chunk.length;
        size += chunk.length;
        if (size > MAX_FILE_BYTES) { finish(new GatewayError(413, "FILE_TOO_LARGE")); return; }
        if (totalBytes > MAX_TOTAL_BYTES) { finish(new GatewayError(413, "UPLOAD_TOTAL_TOO_LARGE", "El total de imágenes no puede superar 40 MiB.")); return; }
        chunks.push(chunk);
      });
      file.stream.once("error", (error: Error) => finish(error));
      file.stream.once("end", () => finish());
    },
    _removeFile(_request, file, callback) { file.buffer = Buffer.alloc(0); callback(null); },
  };
  const upload = multer({ storage, limits: { files: 4, fileSize: MAX_FILE_BYTES + 1, fields: 0, parts: 5, fieldNameSize: 100, headerPairs: 50 } }).array("files", 4);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      req.off("aborted", abort);
      if (!error) { resolve(); return; }
      reject(error instanceof GatewayError || error instanceof multer.MulterError ? error : new GatewayError(400, "INVALID_MULTIPART"));
    };
    const abort = (): void => finish(new GatewayError(400, "UPLOAD_ABORTED"));
    const timeout = setTimeout(() => { finish(new GatewayError(408, "UPLOAD_TIMEOUT")); req.destroy(); }, 120_000);
    timeout.unref();
    req.once("aborted", abort);
    upload(req, res, finish);
  });
  if (!Array.isArray(req.files) || req.files.length === 0) throw new GatewayError(400, "FILES_REQUIRED");
  for (const file of req.files) detectPhoto(file.buffer);
  return req.files;
}

export function photoForm(files: Express.Multer.File[], field: "files" | "attachments", companyBranchId: number, workId?: number): FormData {
  const form = new FormData();
  form.set("companyBranchId", String(companyBranchId));
  if (workId !== undefined) form.set("workId", String(workId));
  for (const file of files) {
    const type = detectPhoto(file.buffer);
    form.append(field, new Blob([new Uint8Array(file.buffer)], { type: type.mime }), `photo-${randomUUID()}.${type.extension}`);
  }
  return form;
}