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
  number: optionalText(30), name: z.string().trim().min(1).max(255),
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
export const equipmentMasterKindSchema = z.enum(["types", "manufacturers", "models", "classifications"]);
export type EquipmentMasterKind = z.infer<typeof equipmentMasterKindSchema>;
export const workshopNewEquipmentMasterSchema = z.object({ companyBranchId: id, requestId, name: z.string().trim().min(1).max(255) }).strict();
export const workshopNewEquipmentMasterResultSchema = z.object({ id, name: z.string().max(300) }).strict();
export type WorkshopNewEquipmentMaster = z.input<typeof workshopNewEquipmentMasterSchema>;

/** Nombre comparable: sin tildes, mayúsculas, espacios ni signos ("Caterpillar-320 D" = "caterpillar320d"). */
export function normalizeMasterName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Antes de crear un tipo, marca, modelo o clasificación: el que ya existe con el mismo nombre y los de nombre casi igual. */
export function findSimilarMasters<T extends { id: number; name: string }>(items: readonly T[], name: string): { same: T | null; similar: T[] } {
  const wanted = normalizeMasterName(name);
  if (!wanted) return { same: null, similar: [] };
  const same = items.find((item) => normalizeMasterName(item.name) === wanted) ?? null;
  const similar = same ? [] : items.filter((item) => {
    const current = normalizeMasterName(item.name);
    if (!current) return false;
    if (Math.min(current.length, wanted.length) >= 3 && (current.includes(wanted) || wanted.includes(current))) return true;
    const allowed = Math.max(current.length, wanted.length) >= 7 ? 2 : Math.max(current.length, wanted.length) >= 4 ? 1 : 0;
    return allowed > 0 && Math.abs(current.length - wanted.length) <= allowed && editDistance(current, wanted) <= allowed;
  }).slice(0, 8);
  return { same, similar };
}

export const workshopNewCustomerResultSchema = workshopCustomerOptionSchema;
export const workshopNewBranchResultSchema = workshopBranchOptionSchema;
export const workshopNewContactResultSchema = workshopContactSchema;

export type WorkshopIdentificationTypes = z.infer<typeof workshopIdentificationTypesSchema>;
export type WorkshopNewCustomer = z.input<typeof workshopNewCustomerSchema>;
export type WorkshopNewBranch = z.input<typeof workshopNewBranchSchema>;
export type WorkshopNewContact = z.input<typeof workshopNewContactSchema>;

/** Registro parecido que ya existe: "strong" casi seguro el mismo (RUT, correo o teléfono), "possible" conviene revisar. */
export const workshopDuplicateMatchSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(300),
  detail: z.string().max(500).nullable(),
  strength: z.enum(["strong", "possible"]),
  reasons: z.array(z.enum(["SAME_DOCUMENT", "SAME_NAME", "SIMILAR_NAME", "SAME_EMAIL", "SAME_PHONE", "SAME_ADDRESS"])).max(6)
}).strict();
export const workshopDuplicatesSchema = z.object({ matches: z.array(workshopDuplicateMatchSchema).max(20) }).strict();
export type WorkshopDuplicateMatch = z.infer<typeof workshopDuplicateMatchSchema>;
export const DUPLICATE_REASON_LABELS: Record<WorkshopDuplicateMatch["reasons"][number], string> = {
  SAME_DOCUMENT: "Mismo RUT", SAME_NAME: "Mismo nombre", SIMILAR_NAME: "Nombre casi igual",
  SAME_EMAIL: "Mismo correo", SAME_PHONE: "Mismo teléfono", SAME_ADDRESS: "Misma dirección"
};
/** Equipo que ya existe con la misma patente o serie (de cualquier cliente o de la flota interna). "strong": misma identificación. */
export const workshopEquipmentDuplicateSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["customer", "rental"]),
  name: z.string().max(300),
  identification: z.string().max(120).nullable(),
  internalNumber: z.string().max(120).nullable(),
  owner: z.string().max(500).nullable(),
  sameCustomer: z.boolean(),
  strength: z.enum(["strong", "possible"]),
  reasons: z.array(z.enum(["SAME_IDENTIFICATION", "SIMILAR_IDENTIFICATION", "SAME_INTERNAL_NUMBER"])).max(3)
}).strict();
export const workshopEquipmentDuplicatesSchema = z.object({ matches: z.array(workshopEquipmentDuplicateSchema).max(20) }).strict();
export type WorkshopEquipmentDuplicate = z.infer<typeof workshopEquipmentDuplicateSchema>;
export const EQUIPMENT_DUPLICATE_REASON_LABELS: Record<WorkshopEquipmentDuplicate["reasons"][number], string> = {
  SAME_IDENTIFICATION: "Misma patente o serie", SIMILAR_IDENTIFICATION: "Patente o serie casi igual", SAME_INTERNAL_NUMBER: "Mismo número interno"
};
export interface WorkshopEquipmentDuplicateQuery { companyBranchId: number; customerId: number; identification: string; internalNumber?: string | null }
export interface WorkshopCustomerDuplicateQuery { companyBranchId: number; documentIdentification?: string | null; name?: string | null; fantasyName?: string | null }
export interface WorkshopContactDuplicateQuery { companyBranchId: number; name?: string | null; email?: string | null; phone?: string | null }
export interface WorkshopBranchDuplicateQuery { companyBranchId: number; name?: string | null; address?: string | null }

export interface WorkshopCustomersPort {
  workshopIdentificationTypes(branchId: number): Promise<WorkshopIdentificationTypes>;
  /** Antes de crear: clientes, contactos o sucursales parecidos que ya existen (gateways anteriores no lo tienen). */
  workshopCustomerDuplicates?(query: WorkshopCustomerDuplicateQuery): Promise<WorkshopDuplicateMatch[]>;
  workshopContactDuplicates?(customerId: number, query: WorkshopContactDuplicateQuery): Promise<WorkshopDuplicateMatch[]>;
  workshopBranchDuplicates?(customerId: number, query: WorkshopBranchDuplicateQuery): Promise<WorkshopDuplicateMatch[]>;
  workshopEquipmentDuplicates?(query: WorkshopEquipmentDuplicateQuery): Promise<WorkshopEquipmentDuplicate[]>;
  createWorkshopCustomer(input: WorkshopNewCustomer): Promise<z.infer<typeof workshopNewCustomerResultSchema>>;
  createWorkshopCustomerBranch(customerId: number, input: WorkshopNewBranch): Promise<z.infer<typeof workshopNewBranchResultSchema>>;
  createWorkshopCustomerContact(customerId: number, input: WorkshopNewContact): Promise<z.infer<typeof workshopNewContactResultSchema>>;
  workshopEquipmentMasters(branchId: number): Promise<WorkshopEquipmentMasters>;
  createWorkshopCustomerEquipment(customerId: number, input: WorkshopNewEquipment): Promise<z.infer<typeof workshopNewEquipmentResultSchema>>;
  /** Nuevo tipo, marca, modelo o clasificación de equipos (gateways anteriores no lo tienen). */
  createWorkshopEquipmentMaster?(kind: EquipmentMasterKind, input: WorkshopNewEquipmentMaster): Promise<z.infer<typeof workshopNewEquipmentMasterResultSchema>>;
}
