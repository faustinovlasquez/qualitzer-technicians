import express, { Router, type Request } from "express";
import { z } from "zod";
import {
  WORKSHOP_IMAGE_MAX_BYTES, workshopAreaOptionsSchema, workshopCustomerDetailSchema, workshopCustomerOptionsSchema, workshopEquipmentOptionsSchema,
  workshopEquipmentQuerySchema, workshopImageInputSchema, workshopIntakeFormSchema, workshopIntakeInputSchema, workshopIntakeResultSchema,
  type WorkshopContact, type WorkshopEquipmentOption, type WorkshopIntakeInput
} from "../../src/domain/workshopIntake";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { equipmentSummary } from "./entry";
import { asRecord, branchAreas, branchEntry, clip, list, positive, text, workshopActor, type WorkshopRequestLedger } from "./support";

const branchQuery = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict();
const idParam = (name: string) => z.object({ [name]: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const valid = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  return parsed.data;
};

/** "Nombre (RUT)" del selector web a nombre y documento. */
export function customerOption(raw: unknown) {
  const row = asRecord(raw);
  const customerId = positive(row.value ?? row.id);
  const label = text(row.label ?? row.name);
  if (customerId === null || label === null) return null;
  const match = /^(.*)\(([^()]*)\)\s*$/.exec(label);
  const name = (match?.[1]?.trim() || label).slice(0, 300);
  const document = match?.[2]?.trim();
  return { id: customerId, name, document: document && document !== "Sin RUT" ? document.slice(0, 60) : null };
}

export function contact(raw: unknown): WorkshopContact | null {
  const row = asRecord(raw);
  const contactId = positive(row.id);
  if (contactId === null || row.isDeleted === true) return null;
  return {
    id: contactId, fullName: (text(row.fullName) ?? text(row.email) ?? `Contacto ${contactId}`).slice(0, 300),
    email: clip(text(row.email), 200), phone: clip(text(row.phone), 60), position: clip(text(row.position), 200)
  };
}

function equipmentOption(raw: unknown, source: "customer" | "own"): WorkshopEquipmentOption | null {
  const row = asRecord(raw);
  const equipmentId = positive(row.id);
  if (equipmentId === null) return null;
  const summary = equipmentSummary(row);
  const year = text(row.year);
  const detail = [text(asRecord(row.classification).name), year].filter((part): part is string => part !== null).join(" · ");
  return {
    id: equipmentId, source, label: summary.label, code: summary.code ?? clip(text(row.identificationEquipment), 120), typeName: clip(summary.typeName, 200),
    detail: detail ? detail.slice(0, 300) : null, imageUrl: clip(text(row.equipmentImageURL) ?? text(row.image), 4000)
  };
}

/** Campos del ingreso como los envía el formulario web (multipart). Contactos y sucursales siempre completos: el backend los reemplaza. */
function entryForm(input: WorkshopIntakeInput, creating: boolean): FormData {
  const form = new FormData();
  form.set("companyBranchId", String(input.companyBranchId));
  form.set("operationAreaId", String(input.operationAreaId));
  form.set("title", input.title);
  form.set("notes", input.notes ?? "");
  form.set("isInternalEntry", String(input.isInternalEntry));
  // Vacío borra el valor anterior al editar (por ejemplo, al pasar de equipo del cliente a equipo propio).
  const optional = (key: string, value: number | null) => { if (value !== null) form.set(key, String(value)); else if (!creating) form.set(key, ""); };
  optional("customerId", input.isInternalEntry ? null : input.customerId);
  optional("customerEquipmentId", input.isInternalEntry ? null : input.customerEquipmentId);
  optional("rentalEquipmentId", input.isInternalEntry ? input.rentalEquipmentId : null);
  form.set("contacts", JSON.stringify(input.isInternalEntry ? [] : input.contactIds.map((contactId) => ({ id: contactId, isNew: false }))));
  form.set("branchesCustomer", JSON.stringify(input.isInternalEntry ? [] : input.branchIds.map((branchId) => ({ id: branchId, value: String(branchId) }))));
  if (creating) {
    form.set("entryDateTime", input.entryAt);
    if (input.estimatedDeliveryAt) form.set("estimatedDepartureDateTime", input.estimatedDeliveryAt);
  }
  return form;
}

/** Contactos y sucursales actuales del ingreso, para no perderlos al subir solo la foto. */
function currentLinks(raw: Record<string, unknown>): { contacts: string; branches: string } {
  const contacts = list(raw.contacts).flatMap((item) => { const value = positive(asRecord(item).id); return value === null ? [] : [{ id: value, isNew: false }]; });
  const branches = list(raw.branchesCustomer).flatMap((item) => { const value = positive(asRecord(item).value ?? asRecord(item).id); return value === null ? [] : [{ id: value, value: String(value) }]; });
  return { contacts: JSON.stringify(contacts), branches: JSON.stringify(branches) };
}

/** JPEG en data URI, verificado por su firma. */
export function jpegBytes(dataUri: string, maxBytes = WORKSHOP_IMAGE_MAX_BYTES): Buffer {
  const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  if (bytes.length === 0 || bytes.length > maxBytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new GatewayError(400, "WORKSHOP_IMAGE_INVALID", "La foto no es válida. Vuelve a tomarla.");
  }
  return bytes;
}

export const WORKSHOP_IMAGE_PATH = /^\/api\/workshop\/entries\/[1-9]\d*\/image\/?$/i;
const imageJson = express.json({ limit: WORKSHOP_IMAGE_MAX_BYTES * 2, strict: true, inflate: false });

/** Paso 1 del ingreso: opciones (clientes, equipos, naves), crear, editar y foto del equipo. */
export function registerIntakeRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger): void {
  router.get("/options/customers", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const items = list(await upstream.request("/customers/select", { token, query: new URLSearchParams({ page: "1" }) }))
      .map(customerOption).filter((item) => item !== null).slice(0, 20_000);
    items.sort((a, b) => a.name.localeCompare(b.name, "es"));
    res.json(valid(workshopCustomerOptionsSchema, { items }));
  });

  router.get("/options/customers/:customerId", async (req, res) => {
    const { customerId } = idParam("customerId").parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const [customer, branches] = await Promise.all([
      upstream.request(`/customers/${customerId}`, { token }),
      upstream.request(`/customer_branches/select/${customerId}`, { token, query: new URLSearchParams({ page: "1" }) })
    ]);
    const row = asRecord(customer);
    if (positive(row.id) !== customerId) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(valid(workshopCustomerDetailSchema, {
      id: customerId, name: (text(row.name) ?? text(row.fantasyName) ?? `Cliente ${customerId}`).slice(0, 300),
      contacts: list(row.contacts).map(contact).filter((item) => item !== null).slice(0, 1000),
      branches: list(branches).flatMap((item) => {
        const branch = asRecord(item);
        const branchId = positive(branch.value ?? branch.id);
        const name = text(branch.label ?? branch.name);
        return branchId !== null && name !== null ? [{ id: branchId, name: name.slice(0, 300) }] : [];
      }).slice(0, 1000)
    }));
  });

  router.get("/options/equipment", async (req, res) => {
    const raw = z.object({ companyBranchId: z.string(), source: z.string(), customerId: z.string().optional(), search: z.string().optional(), page: z.string().optional() }).strict().parse(req.query);
    const query = workshopEquipmentQuerySchema.parse({ ...raw, companyBranchId: Number(raw.companyBranchId), customerId: raw.customerId === undefined ? undefined : Number(raw.customerId),
      page: raw.page === undefined ? 0 : Number(raw.page), search: raw.search || undefined });
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
    const pageSize = 20;
    if (query.source === "customer") {
      // Equipos del cliente: esta lista solo pide sesión (el listado general exige permiso del módulo). Viene agrupada por tipo.
      const grouped = asRecord(await upstream.request(`/customers_equipments/customers/${query.customerId}`, { token,
        query: new URLSearchParams(query.search ? { filters: JSON.stringify({ search: query.search }) } : {}) }));
      const all = Object.values(grouped).flatMap((group) => list(group)).map((item) => equipmentOption(item, "customer")).filter((item) => item !== null);
      const start = query.page * pageSize;
      res.json(valid(workshopEquipmentOptionsSchema, { items: all.slice(start, start + pageSize), hasMore: all.length > start + pageSize }));
      return;
    }
    const result = asRecord(await upstream.request("/rental_equipments", { token, query: new URLSearchParams({
      pagination: JSON.stringify({ limit: pageSize, page: query.page }),
      filters: JSON.stringify({ ...(query.search ? { search: query.search, useSmartSearch: true } : {}), ownership: "own" })
    }) }));
    const rows = list(result).filter((item) => { const status = asRecord(item).status; return (typeof status === "string" ? status : text(asRecord(status).value)) !== "OUT_OF_SERVICE"; });
    const totalPages = Number(result.totalPages) || 0;
    res.json(valid(workshopEquipmentOptionsSchema, { items: rows.map((item) => equipmentOption(item, "own")).filter((item) => item !== null).slice(0, pageSize), hasMore: query.page + 1 < totalPages }));
  });

  router.get("/options/areas", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive(), workshopId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
    const rows = list(await upstream.request("/operation_area/select", { token, query: new URLSearchParams({ workshopId: String(query.workshopId), page: "1" }) }));
    res.json(valid(workshopAreaOptionsSchema, { items: rows.flatMap((item) => {
      const area = asRecord(item);
      const areaId = positive(area.value ?? area.id);
      const title = text(area.label ?? area.title);
      return areaId !== null && title !== null ? [{ id: areaId, title: title.slice(0, 300) }] : [];
    }).slice(0, 500) }));
  });

  router.get("/entries/:entryId/form", async (req, res) => {
    const { entryId } = idParam("entryId").parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const { raw } = await branchEntry(upstream, token, companyBranchId, entryId);
    const internal = raw.isInternalEntry === true;
    const equipmentRaw = internal ? raw.rentalEquipment : raw.customerEquipment;
    const equipment = equipmentRaw ? equipmentOption(equipmentRaw, internal ? "own" : "customer") : null;
    const customerId = positive(raw.customerId);
    const signature = asRecord(raw.responsibleSignature);
    res.json(valid(workshopIntakeFormSchema, {
      entryId, operationAreaId: positive(raw.operationAreaId), areaTitle: clip(text(asRecord(raw.operationArea).title), 300),
      title: (text(raw.title) ?? "").slice(0, 500), notes: clip(text(raw.notes), 4000), isInternalEntry: internal,
      customer: customerId !== null ? { id: customerId, name: (text(raw.customerName) ?? `Cliente ${customerId}`).slice(0, 300) } : null,
      equipment,
      branches: list(raw.branchesCustomer).flatMap((item) => {
        const branch = asRecord(item);
        const branchId = positive(branch.value ?? branch.id);
        return branchId === null ? [] : [{ id: branchId, name: (text(branch.label ?? branch.name) ?? `Sucursal ${branchId}`).slice(0, 300) }];
      }),
      contacts: list(raw.contacts).map(contact).filter((item) => item !== null),
      entryAt: text(raw.entryDateTime), estimatedDeliveryAt: text(raw.estimatedDepartureDateTime),
      imageUrl: clip(text(raw.image) ?? text(raw.avatarThumbnail), 4000),
      signed: text(signature.id) !== null && text(signature.signatureImage) !== null
    }));
  });

  const write = async (req: Request, entryId: number | null) => {
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopIntakeInputSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    // La nave elegida y, al editar, el ingreso deben ser de la sucursal.
    const areas = entryId === null ? await branchAreas(upstream, token, input.companyBranchId) : (await branchEntry(upstream, token, input.companyBranchId, entryId)).areas;
    if (!areas.has(input.operationAreaId)) throw new GatewayError(400, "WORKSHOP_AREA_INVALID", "Esa nave no es de tu sucursal. Elige otra.");
    const { result } = await ledger.run(`${user.id}`, input.requestId, { entryId, input }, async () => {
      const created = asRecord(await upstream.request(entryId === null ? "/operation_area_entries" : `/operation_area_entries/${entryId}`, {
        token, method: entryId === null ? "POST" : "PUT", form: entryForm(input, entryId === null)
      }));
      const savedId = positive(created.id);
      if (savedId === null || (entryId !== null && savedId !== entryId)) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      return { id: savedId };
    });
    return valid(workshopIntakeResultSchema, result);
  };
  router.post("/entries", async (req, res) => { res.status(201).json(await write(req, null)); });
  router.put("/entries/:entryId", async (req, res) => { res.json(await write(req, idParam("entryId").parse(req.params).entryId)); });

  router.post("/entries/:entryId/image", imageJson, async (req, res) => {
    const { entryId } = idParam("entryId").parse(req.params);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopImageInputSchema.parse(req.body);
    const bytes = jpegBytes(input.image);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    const { raw } = await branchEntry(upstream, token, input.companyBranchId, entryId);
    const links = currentLinks(raw);
    const form = new FormData();
    form.set("companyBranchId", String(input.companyBranchId));
    form.set("contacts", links.contacts);
    form.set("branchesCustomer", links.branches);
    form.set("image", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), `equipo-${entryId}.jpg`);
    const saved = asRecord(await upstream.request(`/operation_area_entries/${entryId}`, { token, method: "PUT", form }));
    if (positive(saved.id) !== entryId) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json({ id: entryId });
  });
}
