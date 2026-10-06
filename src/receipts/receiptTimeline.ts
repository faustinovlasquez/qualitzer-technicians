import type { MaterialReceipts } from "../domain/materialReceipts";

export type MaterialReceiptItem = MaterialReceipts["items"][number];
export type ReceiptEntryState = "pending" | "incident" | "confirmed";
export interface ReceiptTimelineEntry { key: string; state: ReceiptEntryState; item: MaterialReceiptItem; at: Date | null; time: string; relative: string; confirmedAt: Date | null; }
export interface ReceiptTimelineDay { key: string; label: string; entries: ReceiptTimelineEntry[]; }

const DAY_MS = 86_400_000;

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Materiales (líneas de producto) que el técnico aún debe confirmar: base del badge del menú. */
export function pendingMaterialCount(data: MaterialReceipts | null | undefined): number {
  return (data?.items ?? []).filter(item => item.receiptStatus !== "CONFIRMED").reduce((total, item) => total + item.products.length, 0);
}

export function receiptTime(date: Date | null): string {
  return date ? new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "--:--";
}

export function receiptRelative(date: Date | null, now: Date): string {
  if (!date) return "Sin fecha de entrega";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "Hace un momento";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Hace 1 día" : `Hace ${days} días`;
}

export function receiptDayLabel(date: Date | null, now: Date): string {
  if (!date) return "Sin fecha";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((today - day) / DAY_MS);
  if (difference === 0) return "Hoy";
  if (difference === 1) return "Ayer";
  const label = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Agrupa entregas pendientes y confirmadas en la sesión por día, de la más reciente a la más antigua. */
export function receiptTimeline(items: MaterialReceiptItem[], recent: Array<{ item: MaterialReceiptItem; confirmedAt: string }>, now: Date = new Date()): ReceiptTimelineDay[] {
  const entries: ReceiptTimelineEntry[] = [
    ...items.filter(item => item.receiptStatus !== "CONFIRMED").map(item => {
      const at = parse(item.requestedAt) ?? parse(item.deliveredAt);
      return { key: `open-${item.id}`, state: item.receiptStatus === "INCIDENT" ? "incident" as const : "pending" as const, item, at, time: receiptTime(at), relative: receiptRelative(at, now), confirmedAt: null };
    }),
    ...recent.filter(entry => !items.some(item => item.id === entry.item.id && item.receiptStatus !== "CONFIRMED")).map(entry => {
      const at = parse(entry.item.requestedAt) ?? parse(entry.item.deliveredAt);
      return { key: `done-${entry.item.id}`, state: "confirmed" as const, item: entry.item, at, time: receiptTime(at), relative: receiptRelative(at, now), confirmedAt: parse(entry.confirmedAt) };
    }),
  ];
  entries.sort((left, right) => (right.at?.getTime() ?? 0) - (left.at?.getTime() ?? 0) || right.item.id - left.item.id);
  const days: ReceiptTimelineDay[] = [];
  for (const entry of entries) {
    const key = entry.at ? dayKey(entry.at) : "none";
    const day = days.find(candidate => candidate.key === key);
    if (day) day.entries.push(entry);
    else days.push({ key, label: receiptDayLabel(entry.at, now), entries: [entry] });
  }
  return days;
}

export function receiptSourceIcon(sourceType: string | undefined): "build-outline" | "document-text-outline" | "construct-outline" | "cube-outline" {
  const value = (sourceType ?? "").toUpperCase();
  if (value.includes("MAINTENANCE")) return "build-outline";
  if (value.includes("NEGOTIATION")) return "document-text-outline";
  if (value.includes("WORK")) return "construct-outline";
  return "cube-outline";
}

export function receiptQuantity(quantity: number, unit: string): string {
  const text = Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString("es-CL", { maximumFractionDigits: 4 });
  return unit ? `${text} ${unit}` : text;
}

/** "06 oct 2026 · 10:35" para la cabecera de cada entrega. */
export function receiptDateTime(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return "Sin fecha";
  const day = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(/\./g, "");
  return `${day} · ${receiptTime(date)}`;
}

export function receiptMoney(amount: number | null | undefined, currencyIso: string | null | undefined): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const currency = (currencyIso || "CLP").toUpperCase();
  try { return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: currency === "CLP" ? 0 : 2 }).format(amount); }
  catch { return `${amount.toLocaleString("es-CL")} ${currency}`; }
}

/** Días corridos que quedan para Utilizado/Devolver (0 = vence hoy o ya venció). */
export function dispositionDaysLeft(deadline: string | null | undefined, now: Date = new Date()): number | null {
  const end = parse(deadline);
  return end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)) : null;
}

export type ProductDispositionState = "USED" | "RETURN_REQUESTED" | "RETURNED" | "AUTO_USED" | "OPEN";
/** Estado visible de un material confirmado: devuelto por bodega, marcado por el técnico, utilizado al vencer el plazo o aún abierto. */
export function productDispositionState(product: MaterialReceiptItem["products"][number], closed: boolean): ProductDispositionState {
  if ((product.returnedQuantity ?? 0) > 0) return "RETURNED";
  if (product.disposition) return product.disposition;
  return closed ? "AUTO_USED" : "OPEN";
}

export function receiptWarehouses(items: MaterialReceiptItem[]): string[] {
  return [...new Set(items.map(item => (item.warehouseName ?? "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "es"));
}

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export type ReceiptSourceFilter = "ALL" | "WORK_ORDER" | "MAINTENANCE" | "OTHER";
export function receiptSourceKind(sourceType: string | undefined): Exclude<ReceiptSourceFilter, "ALL"> {
  const value = (sourceType ?? "").toUpperCase();
  if (value.includes("MAINTENANCE")) return "MAINTENANCE";
  if (value.includes("WORK") || value.includes("NEGOTIATION")) return "WORK_ORDER";
  return "OTHER";
}

/** Búsqueda por código de entrega, OT, equipo, cliente, nota o material; más filtros de bodega y origen. */
export function filterReceipts(items: MaterialReceiptItem[], filter: { query?: string; warehouse?: string | null; source?: ReceiptSourceFilter }): MaterialReceiptItem[] {
  const terms = normalize(filter.query ?? "").split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (filter.warehouse && (item.warehouseName ?? "").trim() !== filter.warehouse) return false;
    if (filter.source && filter.source !== "ALL" && receiptSourceKind(item.sourceType) !== filter.source) return false;
    if (terms.length === 0) return true;
    const text = normalize([item.code, item.sourceCode, item.sourceLabel, item.equipmentLabel, item.customerName, item.destination, item.notes, item.requestedByName,
      ...item.products.flatMap(product => [product.code, product.name])].filter(Boolean).join(" "));
    return terms.every(term => text.includes(term));
  });
}
