import { z } from "zod";
import { workshopBranchOptionSchema, workshopContactSchema, workshopCustomerOptionSchema, workshopEquipmentOptionSchema } from "./workshopIntake";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const requestId = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable();

/** RUT chileno sin puntos ni guion, en mayúsculas (12345678K). */
export const cleanRut = (value: string) => value.replace(/[^0-9kK]/g, "").toUpperCase();
/** Dígito verificador correcto (módulo 11), como `rut.js` en la web. */
export function isValidRut(value: string): boolean {
  const rut = cleanRut(value);
  if (!/^\d{7,8}[0-9K]$/.test(rut)) return false;
  const body = rut.slice(0, -1);
  let sum = 0; let factor = 2;
  for (let index = body.length - 1; index >= 0; index--) { sum += Number(body[index]) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const expected = 11 - (sum % 11);
  return rut.slice(-1) === (expected === 11 ? "0" : expected === 10 ? "K" : String(expected));
}
/** 76.123.456-7, igual que la web. */
export function formatRut(value: string): string {
  const rut = cleanRut(value);
  if (rut.length < 2) return rut;
  return `${rut.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${rut.slice(-1)}`;
}
/** Correo de contacto con las mismas reglas de la web: parte local ≤ 64, dominio con 2+ partes y terminación de letras. */
export function isValidContactEmail(value: string): boolean {
  const email = value.replace(/\s+/g, "").toLowerCase();
  const match = /^([a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(email);
  if (!match || match[1]!.startsWith(".") || match[1]!.endsWith(".") || match[1]!.includes("..")) return false;
  const labels = match[2]!.split(".");
  return labels.every((label) => label.length > 0 && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-")) && /^[a-z]{2,}$/.test(labels.at(-1)!);
}
/** Teléfono con código de país (+56 9 1234 5678), guardado como +56912345678. */
export const normalizePhone = (value: string) => { const digits = value.replace(/[^\d+]/g, ""); return digits.startsWith("+") ? digits : digits ? `+${digits}` : ""; };
export const isValidPhone = (value: string) => /^\+\d{8,15}$/.test(normalizePhone(value));

export const workshopIdentificationTypesSchema = z.object({
  items: z.array(z.object({ id, label: z.string().max(60), isRut: z.boolean() }).strict()).max(100)
}).strict();

export const customerTypeSchema = z.enum(["company", "person", "consignment"]);
/** Nuevo cliente con los campos del formulario rápido de la web. */
export const workshopNewCustomerSchema = z.object({
  companyBranchId: id, requestId, customerType: customerTypeSchema, identificationTypeId: id,
  number: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(255),
  fantasyName: optionalText(255), businessActivity: optionalText(255)
}).strict();
/** Nueva sucursal del cliente (la web no guarda correo ni teléfono de la sucursal). */
export const workshopNewBranchSchema = z.object({
  companyBranchId: id, requestId, name: z.string().trim().min(1).max(255), contactName: optionalText(255),
  address: optionalText(255), apartment: optionalText(60), noStreetNumber: z.boolean(),
  county: optionalText(120), city: optionalText(120), region: optionalText(120),
  /** Del mapa de Google (como la web): país, código postal y coordenadas; opcionales. */
  country: optionalText(120).optional(), postalCode: optionalText(32).optional(),
  lat: z.string().regex(/^-?\d{1,2}(?:\.\d+)?$/).refine((value) => Math.abs(Number(value)) <= 90).nullable().optional(),
  lon: z.string().regex(/^-?\d{1,3}(?:\.\d+)?$/).refine((value) => Math.abs(Number(value)) <= 180).nullable().optional()
}).strict().refine((value) => (value.lat == null) === (value.lon == null), "COORDINATES_INCOMPLETE");
/** Nuevo contacto del cliente. */
export const workshopNewContactSchema = z.object({
  companyBranchId: id, requestId, firstName: z.string().trim().min(1).max(120), lastName: z.string().trim().min(1).max(120),
  position: optionalText(200), email: optionalText(200).refine((value) => value === null || isValidContactEmail(value), "EMAIL_INVALID"),
  phone: optionalText(30).refine((value) => value === null || isValidPhone(value), "PHONE_INVALID"), notes: optionalText(2000)
}).strict();

/** Listas del formulario «Registrar equipo de cliente» de la web. */
const masterItems = z.array(z.object({ id, name: z.string().max(300) }).strict()).max(5000);
export const workshopEquipmentMastersSchema = z.object({ types: masterItems, manufacturers: masterItems, models: masterItems, classifications: masterItems }).strict();
/** Tipos de identificación fijos de la web: número de serie o patente. */
export const EQUIPMENT_IDENTIFICATION_TYPES = [{ id: 2, label: "Patente" }, { id: 1, label: "Número de serie" }] as const;
/** Nuevo equipo del cliente con los campos obligatorios de la web (tipo, marca, modelo, clasificación e identificación). */
export const workshopNewEquipmentSchema = z.object({
  companyBranchId: id, requestId, identificationTypeId: z.union([z.literal(1), z.literal(2)]), identification: z.string().trim().min(1).max(120),
  internalNumber: optionalText(120), typeId: id, manufacturerId: id, modelId: id, classificationId: id,
  year: z.string().trim().regex(/^(\d{4})?$/, "YEAR_INVALID").transform((value) => value || null).nullable(),
  description: optionalText(2000), note: optionalText(2000)
}).strict();
export const workshopNewEquipmentResultSchema = workshopEquipmentOptionSchema;
export type WorkshopEquipmentMasters = z.infer<typeof workshopEquipmentMastersSchema>;
export type WorkshopNewEquipment = z.input<typeof workshopNewEquipmentSchema>;

export const workshopNewCustomerResultSchema = workshopCustomerOptionSchema;
export const workshopNewBranchResultSchema = workshopBranchOptionSchema;
export const workshopNewContactResultSchema = workshopContactSchema;

export type WorkshopIdentificationTypes = z.infer<typeof workshopIdentificationTypesSchema>;
export type WorkshopNewCustomer = z.input<typeof workshopNewCustomerSchema>;
export type WorkshopNewBranch = z.input<typeof workshopNewBranchSchema>;
export type WorkshopNewContact = z.input<typeof workshopNewContactSchema>;

export interface WorkshopCustomersPort {
  workshopIdentificationTypes(branchId: number): Promise<WorkshopIdentificationTypes>;
  createWorkshopCustomer(input: WorkshopNewCustomer): Promise<z.infer<typeof workshopNewCustomerResultSchema>>;
  createWorkshopCustomerBranch(customerId: number, input: WorkshopNewBranch): Promise<z.infer<typeof workshopNewBranchResultSchema>>;
  createWorkshopCustomerContact(customerId: number, input: WorkshopNewContact): Promise<z.infer<typeof workshopNewContactResultSchema>>;
  workshopEquipmentMasters(branchId: number): Promise<WorkshopEquipmentMasters>;
  createWorkshopCustomerEquipment(customerId: number, input: WorkshopNewEquipment): Promise<z.infer<typeof workshopNewEquipmentResultSchema>>;
}
