import { z } from "zod";
import { positiveCreationIdSchema } from "./creation";

const coordinate = (limit: number) => z.string().trim().max(32).refine(value => /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit).nullable();
export const equipmentAddressSchema = z.object({
  country: z.string().trim().max(255), region: z.string().trim().max(255), county: z.string().trim().max(255),
  city: z.string().trim().max(255), postalCode: z.string().trim().max(32), address: z.string().trim().max(255),
  lat: coordinate(90), lon: coordinate(180),
}).strict().refine(value => (value.lat === null) === (value.lon === null));
export const equipmentLocationTargetSchema = z.enum(["work", "group"]);
export const equipmentLocationSchema = z.object({ equipmentId: positiveCreationIdSchema, equipmentContext: z.enum(["rental", "customer"]),
  label: z.string().max(1000), address: equipmentAddressSchema.nullable(), canEdit: z.boolean(),
  currentAddress: equipmentAddressSchema.nullable(), currentSource: z.enum(["REGISTERED", "DISPATCH_ADDRESS", "SAFEGUARD"]), currentLabel: z.string().max(1000).nullable(), }).strict();
export const equipmentLocationUpdateSchema = z.object({ expected: equipmentAddressSchema.nullable(), address: equipmentAddressSchema.refine(value => value.address.length > 0) }).strict();
export type EquipmentAddress = z.infer<typeof equipmentAddressSchema>;
export type EquipmentLocation = z.infer<typeof equipmentLocationSchema>;
export type EquipmentLocationUpdate = z.infer<typeof equipmentLocationUpdateSchema>;
export type EquipmentLocationTarget = z.infer<typeof equipmentLocationTargetSchema>;
export interface EquipmentLocationPort {
  load(target: EquipmentLocationTarget): Promise<EquipmentLocation>;
  save(target: EquipmentLocationTarget, input: EquipmentLocationUpdate): Promise<EquipmentLocation>;
}