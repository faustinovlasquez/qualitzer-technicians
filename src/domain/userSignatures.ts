import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const branch = z.object({ value: z.string().regex(/^[1-9]\d*$/), label: z.string() });
const optionalText = z.string().nullable();

export const userSignatureSchema = z.object({
  id,
  value: z.string(),
  label: z.string(),
  signatureName: z.string(),
  signatureEmail: optionalText,
  signaturePhone: optionalText,
  signatureImage: optionalText,
  isDefaultForBranch: z.boolean(),
  branches: z.array(branch),
});

export const userSignatureOptionsSchema = z.object({
  userId: id,
  companyBranchId: id,
  defaultSignatureId: id.nullable(),
  selectedSignatureId: id.nullable(),
  options: z.array(userSignatureSchema),
});

export const userSignatureInputSchema = z.object({
  id: id.optional(),
  signatureName: z.string().trim().min(1).max(200),
  signatureEmail: z.email().nullable(),
  signaturePhone: z.string().trim().max(100).nullable(),
  signatureImage: z.string().max(1400000).startsWith("data:image/png;base64,").nullable().optional(),
  branchIds: z.array(id).min(1).max(100).refine(values => new Set(values).size === values.length),
}).strict();

export type UserSignatureInput = z.infer<typeof userSignatureInputSchema>;

export type UserSignature = z.infer<typeof userSignatureSchema>;
export type UserSignatureOptions = z.infer<typeof userSignatureOptionsSchema>;

export interface UserSignatureActions {
  load(): Promise<UserSignatureOptions>;
  save(input: UserSignatureInput): Promise<UserSignatureOptions>;
  remove(id: number): Promise<UserSignatureOptions>;
}

export interface UserSignatureAccess {
  scopeKey: string;
  userId: number;
  branchId: number;
  name: string;
  email: string;
  branches: Array<{ id: number; name: string }>;
  available: boolean;
  actions: UserSignatureActions;
}

export interface SelectedUserSignature {
  id: number;
  name: string;
  png: string;
}

export interface UserSignaturesPort {
  userSignatures(branchId: number): Promise<UserSignatureOptions>;
  saveUserSignature(branchId: number, input: UserSignatureInput): Promise<UserSignatureOptions>;
  deleteUserSignature(branchId: number, signatureId: number): Promise<UserSignatureOptions>;
}

export function userSignaturesPort(repository: Partial<UserSignaturesPort>): UserSignaturesPort {
  if (!repository.userSignatures || !repository.saveUserSignature || !repository.deleteUserSignature) throw new Error("USER_SIGNATURES_UNAVAILABLE");
  return { userSignatures: repository.userSignatures.bind(repository), saveUserSignature: repository.saveUserSignature.bind(repository), deleteUserSignature: repository.deleteUserSignature.bind(repository) };
}

export function ownSignatureOptions(value: unknown, userId: number, companyBranchId: number): UserSignatureOptions {
  const result = userSignatureOptionsSchema.parse(value);
  const uniqueIds = new Set(result.options.map(signature => signature.id));
  if (result.userId !== userId || result.companyBranchId !== companyBranchId || uniqueIds.size !== result.options.length) {
    throw new Error("USER_SIGNATURE_IDENTITY_MISMATCH");
  }
  const defaults = result.options.filter(signature => signature.isDefaultForBranch);
  if (defaults.length > 1 || (defaults[0]?.id ?? null) !== result.defaultSignatureId
    || result.options.some(signature => signature.isDefaultForBranch !== signature.branches.some(item => item.value === String(companyBranchId)))
    || result.selectedSignatureId !== null && !uniqueIds.has(result.selectedSignatureId)) {
    throw new Error("USER_SIGNATURE_BRANCH_MISMATCH");
  }
  return result;
}

export function defaultUserSignature(options: UserSignatureOptions): UserSignature | null {
  return options.options.find(signature => signature.id === options.defaultSignatureId) ?? null;
}