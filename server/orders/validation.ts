import type { Request } from "express";
import { z } from "zod";
import { detectPhoto } from "../files/uploads";
import { positiveId, rangeQuerySchema, resourceParamsSchema } from "../validation";
import { faultTypeSchema } from "./contracts";

export const MAX_SIGNATURE_BYTES = 1024 * 1024;
export const ORDER_DELIVERY_JSON_LIMIT_BYTES = 3 * 1024 * 1024;
const signaturePrefix = "data:image/png;base64,";

function isPngSignature(value: string): boolean {
  if (!value.startsWith(signaturePrefix) || value.length > signaturePrefix.length + Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4) return false;
  const encoded = value.slice(signaturePrefix.length);
  if (!encoded || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_SIGNATURE_BYTES || bytes.toString("base64") !== encoded) return false;
  try { if (detectPhoto(bytes).mime !== "image/png") return false; } catch { return false; }
  if (bytes.readUInt32BE(8) !== 13) return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0 || width > 4096 || height > 4096 || width * height > 4_194_304) return false;
  let hasImageData = false;
  let chunks = 0;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    if (++chunks > 1024) return false;
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const next = offset + 12 + size;
    if (next > bytes.length || !/^[A-Za-z]{4}$/.test(type) || (offset !== 8 && type === "IHDR")) return false;
    if (type === "IDAT" && size > 0) hasImageData = true;
    if (type === "IEND") return size === 0 && next === bytes.length && hasImageData;
    offset = next;
  }
  return false;
}

export const signatureSchema = z.string().refine(isPngSignature, "INVALID_PNG_SIGNATURE");
export const deliveryInputSchema = z.object({
  note: z.string().max(10000).nullable().optional().default(null),
  durationMinutes: z.number().int().min(0).max(525600).nullable().optional().default(null),
  faultType: faultTypeSchema.nullable().optional().default(null),
  receivedByName: z.string().max(200).trim().refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).nullable().optional().default(null),
  clientSignature: signatureSchema.nullable().optional().default(null),
  technicianSignature: signatureSchema,
}).strict();
export type OrderDeliveryInput = z.infer<typeof deliveryInputSchema>;

export function orderRequest(req: Request): string {
  const { groupId } = z.object({
    groupId: resourceParamsSchema.shape.groupId.refine((value) => positiveId.safeParse(value.slice(value.lastIndexOf("-") + 1)).success),
  }).strict().parse(req.params);
  rangeQuerySchema.parse(req.query);
  return groupId;
}