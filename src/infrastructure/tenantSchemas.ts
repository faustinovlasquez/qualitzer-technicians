import { z } from "zod";

export const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
  name: z.string().min(1).max(120),
  portalOrigin: z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value && !url.username && !url.password;
  }),
  environment: z.enum(["development", "production"]),
  logo: z.string().max(1_400_000).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
});
export const tenantListSchema = z.object({ data: z.array(tenantSchema) }).refine(({ data }) => new Set(data.map((tenant) => tenant.id)).size === data.length);
export const tenantLoginSchema = z.object({
  token: z.union([z.string().regex(/^qzm_[A-Za-z0-9_-]{43}$/), z.literal("cookie-session")]), username: z.string(), email: z.string(),
  nextStep: z.enum(["DONE", "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"]), tenant: tenantSchema,
});
export const tenantChallengeSchema = z.object({
  nextStep: z.literal("SELECT_TENANT"), challenge: z.string().regex(/^qzc_[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(), tenants: z.array(tenantSchema).min(2),
});
export const loginStartSchema = z.union([tenantLoginSchema, tenantChallengeSchema]);