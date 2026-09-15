import { plainText } from "./format";
import type { AssignmentGroup, AssignmentWork } from "./models";

export interface AssignmentCodes {
  workCode: string | null;
  workOrderCode: string | null;
  negotiationCode: string | null;
}

const maintenancePrefixes = new Map<string, string>([
  ["preventivo", "PRE"], ["preventive", "PRE"],
  ["correctivo", "COR"], ["corrective", "COR"],
  ["rutinario", "RUT"], ["routine", "RUT"],
  ["detencion", "DET"], ["detention", "DET"], ["checklist", "CHK"],
]);
const businessPrefixes = new Map<string, string>([
  ["service", "SER"], ["servicio", "SER"],
  ["periodic_services", "SER"], ["servicios periodicos", "SER"],
  ["rental", "ARR"], ["arriendo", "ARR"],
  ["products", "PRO"], ["productos", "PRO"],
  ["project", "PRO"], ["proyecto", "PRO"],
  ["rental_service", "SER"], ["servicio y arriendo", "SER"],
]);
const modalityPrefixes = new Map<string, string>([["formal_quote", "COT"], ["direct_agreement", "VEN"]]);

function normalize(value: string): string {
  return plainText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

function positiveNumber(value: string | number | null | undefined): number | null {
  if (value == null || !/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeCode(value: string | null | undefined): string | null {
  const code = value?.trim() ?? "";
  return /^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,119}$/u.test(code) && /\d/.test(code) ? code : null;
}

export function assignmentWorkCode(work: Pick<AssignmentWork, "id">): string | null {
  const id = positiveNumber(work.id);
  return id === null ? null : `TR-${String(id).padStart(5, "0")}`;
}

export function assignmentWorkOrderCode(group: AssignmentGroup): string | null {
  if (group.type === "direct_assignment") return null;
  const actual = safeCode(group.code);
  if (group.type === "internal_maintenance") {
    const id = positiveNumber(/^maintenance-(\d+)$/.exec(group.id)?.[1]);
    const prefix = maintenancePrefixes.get(normalize(group.maintenanceType ?? ""));
    if (id !== null && prefix) return `OT-${prefix}-${String(id).padStart(4, "0")}`;
    const formatted = /^OT-(PRE|COR|RUT|DET|CHK)-(\d+)$/i.exec(actual ?? "");
    const number = positiveNumber(formatted?.[2]);
    return formatted && number !== null ? `OT-${formatted[1]!.toUpperCase()}-${String(number).padStart(4, "0")}` : actual;
  }
  const internal = positiveNumber(group.workOrderInternalNumber);
  if (group.isWorkOrderInternal === true) {
    return internal === null ? actual : `OT-INT-${String(internal).padStart(4, "0")}`;
  }
  const external = positiveNumber(group.workOrderNumber);
  return external === null ? actual : `OT-${String(external).padStart(5, "0")}`;
}

export function assignmentNegotiationCode(group: AssignmentGroup): string | null {
  const actual = safeCode(group.negotiationCode);
  if (actual && /\p{L}/u.test(actual)) return actual;
  const id = positiveNumber(group.negotiationCorrelative);
  const modality = modalityPrefixes.get(normalize(group.businessModality ?? ""));
  const type = businessPrefixes.get(normalize(group.businessTypeName ?? ""));
  return id !== null && modality && type ? `${modality}-${type}-${String(id).padStart(4, "0")}` : null;
}

export function assignmentCodes(group: AssignmentGroup, work: AssignmentWork): AssignmentCodes {
  return { workCode: assignmentWorkCode(work), workOrderCode: assignmentWorkOrderCode(group), negotiationCode: assignmentNegotiationCode(group) };
}

export function matchesAssignmentSearch(group: AssignmentGroup, work: AssignmentWork, query: string): boolean {
  const equipment = work.workEquipment ?? group.equipment;
  const codes = assignmentCodes(group, work);
  return normalize([
    work.id, work.title, work.summary, work.specialty, group.id, group.code, group.negotiationCode,
    codes.workCode, codes.workOrderCode, codes.negotiationCode, group.title, group.locationName,
    group.locationAddress, work.workCustomerName ?? group.customerName,
    equipment?.label, equipment?.identifier, equipment?.internalNumber,
  ].filter(Boolean).join(" ")).includes(normalize(query));
}

export function matchesOrderSearch(group: AssignmentGroup, query: string): boolean {
  return normalize([
    group.id, group.code, group.negotiationCode, assignmentWorkOrderCode(group), assignmentNegotiationCode(group),
    group.title, group.locationName, group.locationAddress, group.customerName,
    group.equipment?.label, group.equipment?.identifier, group.equipment?.internalNumber,
  ].filter(Boolean).join(" ")).includes(normalize(query));
}