import { z } from "zod";
import { attachmentSchema } from "../contracts";
import { positiveId } from "../validation";

const publicUrl = z.string().refine((value) => {
  if (!value) return true;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}).catch("");
const resourceId = z.union([positiveId, z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]);

export const panelFileSchema = z.intersection(attachmentSchema, z.object({
  originalUrl: publicUrl.nullish(), size: z.number().finite().nonnegative().nullish(),
  unit: z.enum(["KB", "MB"]).optional(),
})).refine((file) => file.unit !== undefined || file.size == null || Number.isSafeInteger(file.size))
  .transform(({ unit, ...file }) => ({
  ...file, url: file.url || file.originalUrl || "", originalUrl: file.originalUrl || file.url,
  size: unit === undefined ? file.size ?? null : null,
}));
export const panelFilesSchema = z.object({
  data: z.array(panelFileSchema), totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
});
export const panelCommentsSchema = z.object({
  data: z.array(z.object({
    id: resourceId.transform(String), text: z.string(), createdAt: z.string().nullable(),
    author: z.object({ id: z.number().int().positive().nullable(), name: z.string(), avatarUrl: publicUrl.nullable() }),
    files: z.array(panelFileSchema),
  })),
  totalRows: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(),
});