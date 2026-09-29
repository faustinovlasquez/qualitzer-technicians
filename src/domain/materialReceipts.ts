import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const materialReceiptLocationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("AVAILABLE"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000), capturedAt: z.iso.datetime() }).strict(),
  z.object({ status: z.literal("UNAVAILABLE"), reason: z.enum(["PERMISSION_DENIED", "TIMEOUT", "UNAVAILABLE", "UNSUPPORTED"]) }).strict()
]);
export const materialAcknowledgementSchema = z.object({ requestId: z.uuid(), userId: id, confirmedAt: z.iso.datetime(), method: z.literal("AUTHENTICATED_RECIPIENT"), client: z.enum(["WEB", "MOBILE"]), location: materialReceiptLocationSchema }).strict();
export const materialReceiptInputSchema = z.object({ companyBranchId: id, requestId: z.uuid(), deliveries: z.array(z.object({ id, version: id }).strict()).min(1).max(200),
  location: materialReceiptLocationSchema, client: z.enum(["WEB", "MOBILE"]) }).strict().refine(input => new Set(input.deliveries.map(delivery => delivery.id)).size === input.deliveries.length);
export const materialReceiptResultSchema = z.object({ companyBranchId: id, requestId: z.uuid(), receipts: z.array(z.object({ id, version: id, acknowledgement: materialAcknowledgementSchema }).strict()).min(1).max(200) }).strict();
export const materialReceiptsSchema = z.object({ hasMore: z.boolean(), items: z.array(z.object({ id, version: id, code: z.string(), sourceLabel: z.string(), destination: z.string(),
  deliveredAt: z.string().nullable(), receiptStatus: z.enum(["PENDING", "CONFIRMED", "INCIDENT"]), products: z.array(z.object({ id, productId: id, name: z.string(), code: z.string(), quantity: z.number().positive(), unit: z.string() }).strict()), acknowledgement: materialAcknowledgementSchema.optional() }).strict()).max(200) }).strict();
export type MaterialReceiptInput = z.infer<typeof materialReceiptInputSchema>;
export type MaterialReceiptResult = z.infer<typeof materialReceiptResultSchema>;
export type MaterialReceipts = z.infer<typeof materialReceiptsSchema>;
export type MaterialReceiptLocation = z.infer<typeof materialReceiptLocationSchema>;
export interface MaterialReceiptPort {
  materialReceipts(branchId: number): Promise<MaterialReceipts>;
  confirmMaterialReceipts(input: MaterialReceiptInput): Promise<MaterialReceiptResult>;
}

export function verifyMaterialReceiptResult(input: MaterialReceiptInput, result: MaterialReceiptResult, userId: number): void {
  if (result.requestId !== input.requestId || result.companyBranchId !== input.companyBranchId || result.receipts.length !== input.deliveries.length ||
    new Set(result.receipts.map(receipt => receipt.id)).size !== result.receipts.length || result.receipts.some(receipt => receipt.acknowledgement.requestId !== input.requestId || receipt.acknowledgement.userId !== userId ||
      !input.deliveries.some(target => target.id === receipt.id && target.version + 1 === receipt.version))) throw new Error("MATERIAL_RECEIPT_RESPONSE_MISMATCH");
}