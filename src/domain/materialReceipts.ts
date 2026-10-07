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
export const materialDispositionSchema = z.enum(["USED", "RETURN_REQUESTED"]);
export const materialReceiptProductSchema = z.object({ id, productId: id, name: z.string(), code: z.string(), quantity: z.number().positive(), unit: z.string(),
  // Ficha opcional: descripción, foto, precio unitario y uso informado (Utilizado/Devolver).
  description: z.string().max(1000).nullable().optional(), imageUrl: z.string().max(4000).nullable().optional(),
  unitCost: z.number().nonnegative().nullable().optional(), currencyIso: z.string().max(10).nullable().optional(),
  returnedQuantity: z.number().nonnegative().optional(), disposition: materialDispositionSchema.nullable().optional(), dispositionAt: z.string().max(40).nullable().optional() }).strict();
export const materialReceiptSchema = z.object({ id, version: id, code: z.string(), sourceLabel: z.string(), destination: z.string(),
  deliveredAt: z.string().nullable(), receiptStatus: z.enum(["PENDING", "CONFIRMED", "INCIDENT"]), products: z.array(materialReceiptProductSchema), acknowledgement: materialAcknowledgementSchema.optional(),
  // Contexto opcional para la línea de tiempo: quién solicitó la confirmación, cuándo, origen, bodega, motivo y notas.
  requestedByName: z.string().max(300).optional(), requestedAt: z.string().max(40).nullable().optional(), sourceType: z.string().max(40).optional(),
  warehouseName: z.string().max(300).optional(), reasonLabel: z.string().max(300).optional(), notes: z.string().max(4000).nullable().optional(),
  // OT/equipo/cliente y plazo de 7 días para Utilizado/Devolver.
  sourceCode: z.string().max(2000).nullable().optional(), equipmentLabel: z.string().max(2000).nullable().optional(), customerName: z.string().max(2000).nullable().optional(),
  dispositionDeadline: z.string().max(40).nullable().optional(), dispositionClosed: z.boolean().optional() }).strict();
export const materialReceiptsSchema = z.object({ hasMore: z.boolean(), items: z.array(materialReceiptSchema).max(200) }).strict();
export const materialReceiptStatusSchema = z.enum(["PENDING", "CONFIRMED"]);
export const materialDispositionInputSchema = z.object({ companyBranchId: id, id, version: id,
  lines: z.array(z.object({ lineId: id, disposition: materialDispositionSchema }).strict()).min(1).max(200) }).strict()
  .refine(input => new Set(input.lines.map(line => line.lineId)).size === input.lines.length);
export type MaterialReceiptInput = z.infer<typeof materialReceiptInputSchema>;
export type MaterialReceiptResult = z.infer<typeof materialReceiptResultSchema>;
export type MaterialReceipts = z.infer<typeof materialReceiptsSchema>;
export type MaterialReceipt = z.infer<typeof materialReceiptSchema>;
export type MaterialReceiptProduct = z.infer<typeof materialReceiptProductSchema>;
export type MaterialReceiptStatus = z.infer<typeof materialReceiptStatusSchema>;
export type MaterialDisposition = z.infer<typeof materialDispositionSchema>;
export type MaterialDispositionInput = z.infer<typeof materialDispositionInputSchema>;
export type MaterialReceiptLocation = z.infer<typeof materialReceiptLocationSchema>;
/** Entregas que originaron un aviso: al abrirlo, la vista de Materiales se filtra por ellas. */
export interface MaterialReceiptFocus { eventId: string; receiptIds: number[]; }
export interface MaterialReceiptPort {
  materialReceipts(branchId: number, status?: MaterialReceiptStatus): Promise<MaterialReceipts>;
  confirmMaterialReceipts(input: MaterialReceiptInput): Promise<MaterialReceiptResult>;
  materialDispositions(input: MaterialDispositionInput): Promise<MaterialReceipt>;
}

/** La respuesta debe ser la misma entrega, ya confirmada, con una versión igual o posterior y las marcas pedidas aplicadas. */
export function verifyMaterialDispositionResult(input: MaterialDispositionInput, result: MaterialReceipt): void {
  if (result.id !== input.id || result.receiptStatus !== "CONFIRMED" || result.version < input.version ||
    input.lines.some(line => result.products.find(product => product.id === line.lineId)?.disposition !== line.disposition)) throw new Error("MATERIAL_DISPOSITION_RESPONSE_MISMATCH");
}

export function verifyMaterialReceiptResult(input: MaterialReceiptInput, result: MaterialReceiptResult, userId: number): void {
  if (result.requestId !== input.requestId || result.companyBranchId !== input.companyBranchId || result.receipts.length !== input.deliveries.length ||
    new Set(result.receipts.map(receipt => receipt.id)).size !== result.receipts.length || result.receipts.some(receipt => receipt.acknowledgement.requestId !== input.requestId || receipt.acknowledgement.userId !== userId ||
      !input.deliveries.some(target => target.id === receipt.id && target.version + 1 === receipt.version))) throw new Error("MATERIAL_RECEIPT_RESPONSE_MISMATCH");
}