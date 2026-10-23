import { asRecord, list, text, type Raw } from "./support";

/**
 * Guardado completo de una OT (`PUT /negotiations/:id`) a partir del documento que entrega el backend, igual que el
 * formulario web: el backend no guarda por sección. Se conservan precios, estados, impuestos y totales tal como estaban
 * y solo se recalculan los totales de la sección que cambió el técnico, con las mismas fórmulas de la web
 * (productsCalculations, othersCalculations, transportCalculations y negotiationCalculations).
 */

type Rate = (isoFrom: string, isoTo: string) => number;
export type ItemSection = "products" | "transports" | "others";
/** Secciones cuyos totales se recalculan: las de ítems y los trabajos (al quitar uno de la OT). */
export type MoneySection = ItemSection | "services";
const SECTION_KEY: Record<MoneySection, string> = { products: "products", transports: "transports", others: "others", services: "services" };

const num = (value: unknown): number => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Detalles por defecto de cada sección (domain/negotiation.ts de la web) cuando el backend no los tiene. */
const DEFAULT_DETAILS: Record<string, Raw> = {
  workSection: { discountPercentage: 0, genericDescription: "", showGenericDescription: false, showItemDescriptionInPdf: true, showWorkHoursInPdf: true, assignedBudget: 0, freeConsumption: true, blockConsumption: false },
  transportSection: { discountPercentage: 0, genericDescription: "", showGenericDescription: false, showItemDescriptionInPdf: true, assignedBudget: 0, freeConsumption: true, blockConsumption: false },
  othersSection: { discountPercentage: 0, genericDescription: "", showGenericDescription: false, showItemDescriptionInPdf: true, assignedBudget: 0, freeConsumption: true, blockConsumption: false },
  productsSection: { discountPercentage: 0, genericDescription: "", showGenericDescription: false, showStock: true, showItemDescriptionInPdf: false, assignedBudget: 0, freeConsumption: true, blockConsumption: false },
  rentalEquipmentSection: { fuelPriceRental: 0, fuelPriceRentalIso: "CLP", genericDescription: "", showGenericDescription: false, discountPercentage: 0, assignedBudget: 0, freeConsumption: true,
    blockConsumption: false, showFuelInPdf: false, showOperatorInPdf: false, showGpsInPdf: false, showOnlyEquipmentTypeInPdf: false, showItemDescriptionInPdf: true }
};
const ROW_KEYS: Record<string, string> = { workSection: "works", transportSection: "transports", othersSection: "others", productsSection: "products", rentalEquipmentSection: "rentalEquipments" };

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** Conversión de monedas de la OT (buildConversionRateResolver de la web). */
function conversionRate(data: Raw): Rate {
  const conversions = list(parsed(data.currenciesConversions)).map(asRecord);
  return (isoFrom, isoTo) => {
    const factor = Number(conversions.find((item) => item.isoFrom === isoFrom && item.isoTo === isoTo)?.conversionFactor);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  };
}
const convert = (value: number, rate: Rate, target: string, source: string) => source === target ? value : value * rate(target, source);

const activeTaxes = (taxes: unknown) => {
  const byId = new Map<string, Raw>();
  for (const tax of list(taxes).map(asRecord)) if (tax.isDeleted !== true) byId.set(String(tax.taxId), tax);
  return [...byId.values()];
};
const taxTotal = (net: number, taxes: unknown) => activeTaxes(taxes).reduce((sum, tax) => sum + (net * num(tax.rate)) / 100, 0);
const itemDiscount = (base: number, percent: unknown, amount: number) => num(percent) > 0 ? Number(((base * num(percent)) / 100).toFixed(2)) : amount > 0 ? amount : 0;

/** `netCost` es el costo neto de la sección (para márgenes); `cost` su aporte a totalCostWorkOrder (fórmula propia de la web). */
export interface SectionTotals { subtotal: number; itemDiscount: number; discount: number; net: number; tax: number; gross: number; estimatedMargin: number; realMargin: number; cost: number; netCost: number }

function productsTotals(section: Raw, target: string, rate: Rate, internal: boolean): SectionTotals {
  const rows = list(section.products).map(asRecord).filter((row) => row.isDeleted !== true).map((row) => {
    const cost = convert(num(row.costPrice), rate, target, text(row.isoCostPrice) ?? target);
    const sale = internal ? cost : convert(num(row.netSalePrice), rate, target, text(row.isoNetSalePrice) ?? target);
    const quantity = num(row.quantity);
    const raw = sale * quantity;
    const discount = num(row.discountPercent) > 0 ? Number(((raw * num(row.discountPercent)) / 100).toFixed(2))
      : num(row.discountAmount) > 0 ? convert(num(row.discountAmount), rate, target, text(row.isoNetSalePrice) ?? target) : 0;
    // Igual que calculateProductFields: el descuento calculado queda en la fila.
    if (num(row.discountPercent) > 0) row.discountAmount = discount;
    return { cost: cost * quantity, raw, discount, total: raw - discount, rowCost: num(row.costPrice) * quantity - num(row.discountAmount) };
  });
  return finish(section, rows, internal, false);
}

function othersTotals(section: Raw, target: string, rate: Rate, internal: boolean): SectionTotals {
  const rows = list(section.others).map(asRecord).filter((row) => row.isDeleted !== true && row.isGrouped !== true).map((row) => {
    const unit = convert(num(row.unitCost), rate, target, text(row.isoUnitCost) ?? target);
    const quantity = num(row.quantity) || 1;
    const margin = internal ? 0 : num(row.margin);
    const raw = unit * quantity;
    const base = internal ? raw : raw * (1 / (1 - margin / 100));
    const discountAmount = num(row.discountAmount) > 0 ? convert(num(row.discountAmount), rate, target, text(row.isoUnitCost) ?? target) : 0;
    const discount = itemDiscount(base, row.discountPercent, discountAmount);
    return { cost: raw, raw: base, discount, total: base - discount, rowCost: unit * num(row.quantity) - num(row.discountAmount) };
  });
  const totals = finish(section, rows, internal, true);
  return { ...totals, estimatedMargin: internal ? 0 : totals.net - totals.netCost, realMargin: 0 };
}

function transportsTotals(section: Raw, target: string, rate: Rate, internal: boolean): SectionTotals {
  const rows = list(section.transports).map(asRecord).filter((row) => row.isDeleted !== true).map((row) => {
    const source = text(row.isoTransport) ?? target;
    const cost = convert(num(row.costUnit), rate, target, source);
    const sale = internal ? cost : convert(num(row.salePriceUnit), rate, target, source);
    const quantity = num(row.quotedValue);
    const raw = sale * quantity;
    let discount = num(row.discountPercent) > 0 ? Number(((raw * num(row.discountPercent)) / 100).toFixed(2))
      : num(row.discountAmount) > 0 ? convert(num(row.discountAmount), rate, target, source) : 0;
    discount = Math.min(discount, Math.max(0, raw));
    if (num(row.discountPercent) > 0) row.discountAmount = discount;
    return { cost: cost * quantity, raw, discount, total: raw - discount, rowCost: num(row.costUnit) * quantity - num(row.discountAmount) };
  });
  const totals = finish(section, rows, internal, false);
  const estimatedMargin = totals.net - totals.netCost;
  return { ...totals, estimatedMargin, realMargin: totals.net === 0 ? 0 : (estimatedMargin / totals.net) * 100 };
}

function finish(section: Raw, rows: Array<{ cost: number; raw: number; discount: number; total: number; rowCost: number }>, internal: boolean, others: boolean): SectionTotals {
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const subtotal = rows.reduce((sum, row) => sum + row.raw, 0);
  const item = rows.reduce((sum, row) => sum + row.discount, 0);
  const afterItems = rows.reduce((sum, row) => sum + row.total, 0);
  const discount = (afterItems * num(asRecord(section.details).discountPercentage)) / 100;
  const net = afterItems - discount;
  const tax = taxTotal(net, section.taxes);
  return {
    subtotal, itemDiscount: item, discount, net, tax, gross: net + tax,
    estimatedMargin: internal ? 0 : others ? net - cost : afterItems - cost, realMargin: internal ? 0 : net - cost,
    cost: rows.reduce((sum, row) => sum + row.rowCost, 0), netCost: cost
  };
}

/** Trabajos (getServiceTotals de la web); los quitados de la OT ya no cuentan. */
function servicesTotals(section: Raw, target: string, rate: Rate, internal: boolean): SectionTotals {
  const rows = list(section.works).map(asRecord).filter((row) => row.isDeleted !== true && row.isRemoved !== true).map((row) => {
    const iso = text(row.isoCostPerHH) ?? target;
    const costHH = convert(num(row.netCostHH), rate, target, iso);
    const manual = num(row.netCostHH) <= 0 && num(row.netSalePerHH) > 0;
    const margin = internal ? 0 : num(row.marginHH);
    const saleHH = manual ? convert(num(row.netSalePerHH), rate, target, iso) : internal ? costHH : costHH * (1 / (1 - margin / 100));
    const hours = num(row.assignedTime) / 60;
    const raw = saleHH * hours;
    const discount = itemDiscount(raw, row.discountPercent, num(row.discountAmount));
    return { cost: costHH * hours, raw, discount, total: raw - discount, rowCost: num(row.netCostHH) * hours - num(row.discountAmount) };
  });
  const totals = finish(section, rows, false, false);
  const margins = rows.reduce((sum, row) => sum + (row.total - row.cost), 0);
  return { ...totals, estimatedMargin: margins - totals.discount, realMargin: margins };
}

const SECTION_PROP: Record<MoneySection, string> = { products: "productsSection", transports: "transportSection", others: "othersSection", services: "workSection" };

export function sectionTotals(document: Raw, section: MoneySection): SectionTotals {
  const data = asRecord(document.negotiationDataSection);
  const target = text(asRecord(data.currency).iso) ?? "";
  const rate = conversionRate(data);
  const internal = data.isWorkOrderInternal === true;
  const raw = asRecord(document[SECTION_PROP[section]]);
  if (section === "services") return servicesTotals(raw, target, rate, internal);
  return section === "products" ? productsTotals(raw, target, rate, internal) : section === "others" ? othersTotals(raw, target, rate, internal) : transportsTotals(raw, target, rate, internal);
}

/**
 * Cuerpo del PUT a partir del documento del GET (receta del formulario web, prepareNegotiationDataForSubmit y
 * transformNegotiationForSubmit): sin envío a comercial ni transformación, sin campos que el backend reescribe por su
 * cuenta (contactos, contratistas, crédito, honorarios) y con los detalles por defecto si faltan.
 */
export function editableDocument(raw: unknown, branchId: number): Raw {
  const document = clone(asRecord(raw));
  const data = asRecord(document.negotiationDataSection);
  data.commercialSend = false;
  data.transformToNegotiationAndSend = false;
  data.companyBranchId = branchId;
  // maintenanceOccupation: el GET la entrega con hora de 12 h sin AM/PM; reenviarla movería la reserva del equipo (sin la clave el backend no la toca en una OT interna).
  for (const key of ["sentToCommercialAt", "contractors", "hasContractor", "contacts", "creditValidation", "createdAt", "updatedAt", "maintenanceOccupation"]) delete data[key];
  data.currenciesConversions = list(parsed(data.currenciesConversions)).map(asRecord).map((item) => { const { conversionActual: _ignored, ...rest } = item; return rest; });
  document.negotiationDataSection = data;
  const businessType = text(document.businessTypeName);
  if (businessType !== "project" && businessType !== "per_person" && businessType !== "result") document.taxes = [];
  if (businessType !== "result") delete document.resultFees;
  delete document.termsCondition;
  delete document.totalProjectBudget;
  for (const [sectionKey, rowsKey] of Object.entries(ROW_KEYS)) {
    const section = asRecord(document[sectionKey]);
    section[rowsKey] = list(section[rowsKey]);
    section.details = section.details && typeof section.details === "object" ? section.details : { ...DEFAULT_DETAILS[sectionKey] };
    section.taxes = list(section.taxes).map(asRecord).map((tax) => { const { isDefaultNegotiation: _a, isRemovable: _b, ...rest } = tax; return rest; });
    document[sectionKey] = section;
  }
  // Los trabajos solo reescriben sus costos (los mismos que vinieron); no se tocan actividades, responsables ni especialidades.
  const works = asRecord(document.workSection);
  works.works = list(works.works).map(asRecord).map((row) => {
    const { activities: _a, specialties: _b, responsibles: _c, ...rest } = row;
    return { ...rest, isNew: false, isRemoved: false, hasChangesGeneralData: false, isStatusChanged: false };
  });
  // Otros: el backend solo actualiza filas con isNew === false.
  const others = asRecord(document.othersSection);
  others.others = list(others.others).map(asRecord).map((row) => ({ ...row, isNew: false }));
  // Transportes: no reescribir ocupaciones existentes.
  const transports = asRecord(document.transportSection);
  transports.transports = list(transports.transports).map(asRecord).map((row) => { const { transportOccupations: _a, ...rest } = row; return { ...rest, isNew: false }; });
  return document;
}

/** Ajusta totalsSection y sectionTotals con la diferencia de la sección editada (el resto de secciones no cambia). */
export function applySectionDelta(document: Raw, section: MoneySection, before: SectionTotals, after: SectionTotals): void {
  const data = asRecord(document.negotiationDataSection);
  const totals = { ...asRecord(document.totalsSection) };
  const delta = (key: keyof SectionTotals) => after[key] - before[key];
  const subTotal = num(totals.subTotal) + delta("subtotal");
  const totalDiscount = num(totals.totalDiscount) + delta("itemDiscount") + delta("discount");
  const totalNet = subTotal - totalDiscount;
  const totalTax = num(totals.totalTax) + delta("tax");
  document.totalsSection = {
    ...totals,
    subTotal, totalDiscount, totalNet, totalTax, totalGross: totalNet + totalTax,
    discountPercentage: subTotal > 0 ? (totalDiscount / subTotal) * 100 : 0,
    estimatedMargin: num(totals.estimatedMargin) + delta("estimatedMargin"),
    // getNegotiationTotals de la web suma el margen real solo de trabajos, transporte y otros (otros siempre 0).
    realMargin: num(totals.realMargin) + (section === "services" || section === "transports" ? delta("realMargin") : 0),
    totalCostWorkOrder: num(data.totalCostWorkOrder) + delta("cost")
  };
  const snapshot = asRecord(parsed(data.sectionTotals));
  document.sectionTotals = { ...snapshot, [SECTION_KEY[section]]: { subtotal: after.subtotal, discount: after.itemDiscount + after.discount, net: after.net, tax: after.tax, gross: after.gross } };
}

