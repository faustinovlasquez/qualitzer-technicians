import { creationOptionsQuerySchema, creationOptionsSchema, normalizeEquipmentInternalNumber, type CreationOptions, type CreationOptionsQuery } from "../../domain/creation";
import { OfflineUnavailableError } from "../../domain/offline";
import { NetworkError } from "../../infrastructure/errors";
import type { CreationCatalogCache, CreationCatalogPage } from "./CreationCatalogSelector";

export type EquipmentOption = CreationCatalogPage["items"][number];
export interface EquipmentLookupContext {
  companyBranchId: number;
  userId: number;
  workerId: number | null;
}
export interface EquipmentLookupResult {
  items: EquipmentOption[];
  page: number;
  hasMore: boolean;
  cachedOnly: boolean;
}

export function exactEquipmentMatches(items: EquipmentOption[], internalNumber: string): EquipmentOption[] {
  const normalized = normalizeEquipmentInternalNumber(internalNumber);
  if (!normalized) return [];
  return [...new Map(items.filter((item) => typeof item.internalNumber === "string" && normalizeEquipmentInternalNumber(item.internalNumber) === normalized)
    .map((item) => [item.id, item])).values()];
}

export async function lookupEquipment(context: EquipmentLookupContext, internalNumber: string, page: number, cache: CreationCatalogCache,
  loadOptions: (query: CreationOptionsQuery) => Promise<CreationOptions>): Promise<EquipmentLookupResult> {
  const query = creationOptionsQuerySchema.parse({ companyBranchId: context.companyBranchId, kind: "equipment", internalNumber, page });
  try {
    const options = creationOptionsSchema.parse(await loadOptions(query));
    if (options.companyBranchId !== context.companyBranchId || options.userId !== context.userId || options.workerId !== context.workerId) throw new Error("CREATION_OPTIONS_CONTEXT_MISMATCH");
    const result = options.equipment;
    if (!result || result.page !== page || result.items.some((item) => exactEquipmentMatches([item], internalNumber).length !== 1)) throw new Error("CREATION_EQUIPMENT_EXACT_LOOKUP_UNAVAILABLE");
    if (cache.size >= 40) cache.clear();
    cache.set(JSON.stringify(["equipment", "internalNumber", query.internalNumber, page]), result);
    return { items: result.items, page, hasMore: result.hasMore && page < 1000, cachedOnly: false };
  } catch (error) {
    if (!(error instanceof NetworkError) && !(error instanceof OfflineUnavailableError && error.code === "OFFLINE_CACHE_MISS")) throw error;
    const items = [...cache.entries()].filter(([key]) => key.startsWith('["equipment",')).flatMap(([, value]) => value.items);
    return { items: exactEquipmentMatches(items, internalNumber), page: 0, hasMore: false, cachedOnly: true };
  }
}