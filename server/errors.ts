import type { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly publicMessage?: string,
  ) {
    super(code);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof GatewayError) {
    res.status(error.status).json({ error: error.code, ...(error.publicMessage ? { message: error.publicMessage } : {}) });
    return;
  }
  if (error instanceof ZodError || error instanceof URIError || error instanceof SyntaxError) {
    res.status(400).json({ error: "INVALID_INPUT" });
    return;
  }
  if (error instanceof MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "INVALID_MULTIPART", message: "Se permiten hasta 4 imágenes en el campo files, de hasta 25 MiB cada una." });
    return;
  }
  if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    return;
  }
  res.status(500).json({ error: "GATEWAY_ERROR" });
};