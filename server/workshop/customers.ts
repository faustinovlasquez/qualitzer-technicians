import { Router } from "express";
import { z } from "zod";
import {
  cleanRut, formatRut, isValidRut, normalizePhone, workshopIdentificationTypesSchema, workshopNewBranchResultSchema, workshopNewBranchSchema,
  workshopNewContactResultSchema, workshopNewContactSchema, workshopNewCustomerResultSchema, workshopNewCustomerSchema,
  workshopEquipmentMastersSchema, workshopNewEquipmentResultSchema, workshopNewEquipmentSchema, workshopDuplicatesSchema,
  equipmentMasterKindSchema, findSimilarMasters, workshopEquipmentDuplicatesSchema, workshopNewEquipmentMasterResultSchema, workshopNewEquipmentMasterSchema, type EquipmentMasterKind
} from "../../src/domain/workshopCustomers";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { contact, forgetCustomerList } from "./intake";
import { asRecord, list, positive, text, workshopActor, type WorkshopRequestLedger } from "./support";

const customerParam = z.object({ customerId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();

/** Un 403 del backend se explica con el permiso que pide la web para esa acción. */
async function permitted<T>(permission: string, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof GatewayError && error.status === 403) throw new GatewayError(403, "CUSTOMERS_PERMISSION_REQUIRED", `Tu perfil no tiene permiso para esto. Pide que te den ${permission}.`);
    throw error;
  }
}

async function identificationTypes(upstream: Upstream, token: string) {
  return workshopIdentificationTypesSchema.parse({ items: list(await upstream.request("/DocumentsSalesCountries/select", { token })).flatMap((item) => {
    const row = asRecord(item);
    const typeId = positive(row.value ?? row.id);
    const label = text(row.label);
    return typeId === null || label === null ? [] : [{ id: typeId, label: label.slice(0, 60), isRut: label.trim().toUpperCase() === "RUT" }];
  }).slice(0, 100) });
}

const MASTER_PATHS = {
  types: "/equipment_masters/types/select", manufacturers: "/equipment_masters/manufacturers/select",
  models: "/equipment_masters/models/select", classifications: "/equipment_masters/classifications/select"
} as const;
const MASTER_NAMES: Record<EquipmentMasterKind, string> = { types: "el tipo de equipo", manufacturers: "el fabricante", models: "el modelo", classifications: "la clasificación" };

/** Tipos, marcas, modelos y clasificaciones de equipos (los mismos selectores de la web, que no filtran modelos por marca). */
async function equipmentMasters(upstream: Upstream, token: string) {
  const load = async (path: (typeof MASTER_PATHS)[keyof typeof MASTER_PATHS]) => list(await upstream.request(path, { token, query: new URLSearchParams({ page: "1" }) })).flatMap((item) => {
    const row = asRecord(item);
    const itemId = positive(row.value ?? row.id);
    const name = text(row.label ?? row.name);
    return itemId === null || name === null ? [] : [{ id: itemId, name: name.slice(0, 300) }];
  }).sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, 5000);
  const [types, manufacturers, models, classifications] = await Promise.all([load(MASTER_PATHS.types), load(MASTER_PATHS.manufacturers), load(MASTER_PATHS.models), load(MASTER_PATHS.classifications)]);
  return workshopEquipmentMastersSchema.parse({ types, manufacturers, models, classifications });
}

/** Equipos (de clientes o internos) con la misma patente o serie, según el servidor. */
async function equipmentDuplicates(upstream: Upstream, token: string, query: { customerId: number; identification: string; internalNumber: string | null }) {
  return workshopEquipmentDuplicatesSchema.parse({ matches: list(asRecord(await upstream.request("/customer_duplicates/equipment", { token, method: "POST", json: query })).matches).slice(0, 20).flatMap((item) => {
    const row = asRecord(item);
    const matchId = positive(row.id);
    if (matchId === null || (row.source !== "customer" && row.source !== "rental")) return [];
    return [{
      id: matchId, source: row.source, name: (text(row.name) ?? "Equipo sin datos").slice(0, 300),
      identification: text(row.identification)?.slice(0, 120) ?? null, internalNumber: text(row.internalNumber)?.slice(0, 120) ?? null,
      owner: text(row.owner)?.slice(0, 500) ?? null, sameCustomer: row.sameCustomer === true, strength: row.strength === "strong" ? "strong" : "possible",
      reasons: list(row.reasons).filter((reason): reason is string => typeof reason === "string").slice(0, 3)
    }];
  }) }).matches;
}

/** Crear cliente, sucursal o contacto desde el ingreso, con los mismos datos y reglas de los formularios rápidos de la web. */
export function registerCustomerRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger): void {
  router.get("/options/equipment-masters", async (req, res) => {
    const { companyBranchId } = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    res.json(await equipmentMasters(upstream, token));
  });

  // Igual que los maestros de equipos de la web (nombre, sin código, activo), sin permitir un nombre repetido.
  router.post("/options/equipment-masters/:kind", async (req, res) => {
    const { kind } = z.object({ kind: equipmentMasterKindSchema }).strict().parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopNewEquipmentMasterSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    const { result, replayed } = await ledger.run(`${user.id}`, input.requestId, { kind, input }, async () => {
      const what = MASTER_NAMES[kind];
      const existing = findSimilarMasters((await equipmentMasters(upstream, token))[kind], input.name).same;
      if (existing) throw new GatewayError(409, "EQUIPMENT_MASTER_EXISTS", `Ya existe ${what} «${existing.name}». Elígelo de la lista.`);
      try {
        await permitted("\"crear\" en Maestros de equipos", () => upstream.request(`/equipment_masters/${kind}`, { token, method: "POST", json: { name: input.name, code: null, isEnabled: true } }));
      } catch (error) {
        if (error instanceof GatewayError && error.status !== 403) {
          throw new GatewayError(409, "EQUIPMENT_MASTER_EXISTS", `No se pudo crear ${what}. Puede que ya exista con ese nombre pero esté desactivado: revísalo en la web.`);
        }
        throw error;
      }
      const created = findSimilarMasters((await equipmentMasters(upstream, token))[kind], input.name).same;
      if (!created) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      return workshopNewEquipmentMasterResultSchema.parse(created);
    });
    res.status(replayed ? 200 : 201).json(result);
  });

  // Igual que «Registrar equipo de cliente» de la web: multipart a /customers_equipments, ficha pública y activo, sin ubicación.
  router.post("/customers/:customerId/equipment", async (req, res) => {
    const { customerId } = customerParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopNewEquipmentSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    const { result, replayed } = await ledger.run(`${user.id}`, input.requestId, { customerId, input }, async () => {
      const masters = await equipmentMasters(upstream, token);
      const named = (items: Array<{ id: number; name: string }>, itemId: number, what: string) => {
        const found = items.find((item) => item.id === itemId);
        if (!found) throw new GatewayError(400, "EQUIPMENT_MASTER_INVALID", `Elige ${what} de la lista.`);
        return found.name;
      };
      const typeName = named(masters.types, input.typeId, "un tipo de equipo");
      const manufacturer = named(masters.manufacturers, input.manufacturerId, "un fabricante");
      const model = named(masters.models, input.modelId, "un modelo");
      const classification = named(masters.classifications, input.classificationId, "una clasificación");
      // Si el servidor aún no tiene la búsqueda de repetidos, se crea igual (el índice único sigue evitando la misma patente exacta).
      const same = (await equipmentDuplicates(upstream, token, { customerId, identification: input.identification, internalNumber: input.internalNumber ?? null }).catch(() => []))
        .find((match) => match.strength === "strong");
      if (same) {
        const where = same.sameCustomer ? "para este cliente. Búscalo en la lista de equipos" : same.source === "rental" ? "como equipo interno" : `para ${same.owner ?? "otro cliente"}`;
        throw new GatewayError(409, "EQUIPMENT_IDENTIFICATION_EXISTS", `Ya existe un equipo con esa identificación (${same.identification ?? input.identification}) ${where}.`);
      }
      const form = new FormData();
      const set = (key: string, value: string | number | null | undefined) => { if (value !== null && value !== undefined) form.set(key, String(value)); };
      set("customerId", customerId); set("companyBranchId", input.companyBranchId); set("identificationTypeId", input.identificationTypeId);
      set("identification", input.identification); set("internalNumber", input.internalNumber); set("typeId", input.typeId);
      set("manufacturerId", input.manufacturerId); set("modelId", input.modelId); set("classificationId", input.classificationId);
      set("year", input.year); set("description", input.description); set("note", input.note);
      set("isPublic", "true"); set("isEnabled", "true"); set("hasAddress", "false");
      let created: Record<string, unknown>;
      try {
        created = asRecord(await permitted("\"crear\" en Equipos de clientes", () => upstream.request("/customers_equipments", { token, method: "POST", form })));
      } catch (error) {
        if (error instanceof GatewayError && error.code === "EQUIPMENT_IDENTIFICATION_EXISTS") {
          throw new GatewayError(409, "EQUIPMENT_IDENTIFICATION_EXISTS", "Ya existe un equipo con esa identificación. Búscalo en la lista o revisa el número.");
        }
        throw error;
      }
      const equipmentId = positive(created.id);
      if (equipmentId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      return workshopNewEquipmentResultSchema.parse({
        id: equipmentId, source: "customer", label: `${manufacturer} · ${typeName} · ${model}`.slice(0, 500), code: input.identification.slice(0, 120), typeName: typeName.slice(0, 200),
        detail: [classification, input.year].filter(Boolean).join(" · ").slice(0, 300) || null, imageUrl: null,
        title: `${manufacturer} ${model}`.slice(0, 300), year: input.year ?? null, color: null, identification: input.identification.slice(0, 120), internalNumber: input.internalNumber ?? null
      });
    });
    res.status(replayed ? 200 : 201).json(result);
  });

  // Antes de crear: registros parecidos que ya existen (mismo RUT, nombre, correo, teléfono o dirección), según el servidor.
  const optionalText = z.string().max(500).nullable().optional();
  type DuplicatePath = "/customer_duplicates/customers" | `/customer_duplicates/customers/${number}/contacts` | `/customer_duplicates/customers/${number}/branches`;
  const duplicates = async (path: DuplicatePath, token: string, json: Record<string, unknown>) =>
    workshopDuplicatesSchema.parse({ matches: list(asRecord(await upstream.request(path, { token, method: "POST", json })).matches).slice(0, 20).flatMap((item) => {
      const row = asRecord(item);
      const matchId = positive(row.id);
      if (matchId === null) return [];
      return [{ id: matchId, name: (text(row.name) ?? "Sin nombre").slice(0, 300), detail: text(row.detail)?.slice(0, 500) ?? null,
        strength: row.strength === "strong" ? "strong" : "possible", reasons: list(row.reasons).filter((reason): reason is string => typeof reason === "string").slice(0, 6) }];
    }) });
  router.post("/duplicates/customers", async (req, res) => {
    emptySchema.parse(req.query);
    const input = z.object({ companyBranchId: z.number().int().positive(), documentIdentification: optionalText, name: optionalText, fantasyName: optionalText }).strict().parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    res.json(await duplicates("/customer_duplicates/customers", token, { documentIdentification: input.documentIdentification ?? null, name: input.name ?? null, fantasyName: input.fantasyName ?? null }));
  });
  router.post("/duplicates/equipment", async (req, res) => {
    emptySchema.parse(req.query);
    const input = z.object({
      companyBranchId: z.number().int().positive(), customerId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      identification: z.string().trim().min(1).max(120), internalNumber: z.string().trim().max(120).nullable().optional()
    }).strict().parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    res.json({ matches: await equipmentDuplicates(upstream, token, { customerId: input.customerId, identification: input.identification, internalNumber: input.internalNumber || null }) });
  });
  router.post("/duplicates/customers/:customerId/contacts", async (req, res) => {
    const { customerId } = customerParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = z.object({ companyBranchId: z.number().int().positive(), name: optionalText, email: optionalText, phone: optionalText }).strict().parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    res.json(await duplicates(`/customer_duplicates/customers/${customerId}/contacts`, token, { name: input.name ?? null, email: input.email ?? null, phone: input.phone ?? null }));
  });
  router.post("/duplicates/customers/:customerId/branches", async (req, res) => {
    const { customerId } = customerParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = z.object({ companyBranchId: z.number().int().positive(), name: optionalText, address: optionalText }).strict().parse(req.body);
    const { token } = await workshopActor(upstream, req, input.companyBranchId);
    res.json(await duplicates(`/customer_duplicates/customers/${customerId}/branches`, token, { name: input.name ?? null, address: input.address ?? null }));
  });

  router.get("/options/identification-types", async (req, res) => {
    const { companyBranchId } = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    res.json(await identificationTypes(upstream, token));
  });

  router.post("/customers", async (req, res) => {
    emptySchema.parse(req.query);
    const input = workshopNewCustomerSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    const { result, replayed } = await ledger.run(`${user.id}`, input.requestId, input, async () => {
      const type = (await identificationTypes(upstream, token)).items.find((item) => item.id === input.identificationTypeId);
      if (!type) throw new GatewayError(400, "IDENTIFICATION_TYPE_INVALID", "Elige un tipo de identificación de la lista.");
      if (input.number && type.isRut && !isValidRut(input.number)) throw new GatewayError(400, "RUT_INVALID", "El RUT no es válido. Revisa el número y el dígito verificador.");
      const number = !input.number ? null : type.isRut ? formatRut(input.number) : input.number.replace(/\s+/g, "");
      if (number) {
        // Igual que la web: antes de crear se busca si ya existe un cliente con esa identificación.
        const found = list(await upstream.request("/customers", { token, query: new URLSearchParams({
          pagination: JSON.stringify({ page: 1, limit: 80 }), filters: JSON.stringify({ search: number })
        }) }));
        const same = (value: unknown) => { const raw = text(value); return raw !== null && (type.isRut ? cleanRut(raw) === cleanRut(number) : raw.replace(/\s+/g, "").toUpperCase() === number.toUpperCase()); };
        const duplicate = found.map(asRecord).find((row) => same(row.documentIdentification) || same(asRecord(row.identification).number) || same(row.rut));
        if (duplicate) throw new GatewayError(409, "CLIENT_IDENTIFICATION_EXISTS", `Ya existe un cliente con esa identificación: ${text(duplicate.name) ?? number}. Búscalo en la lista.`);
      }
      const created = asRecord(await permitted("\"crear\" en Clientes", () => upstream.request("/customers", { token, method: "POST", json: {
        customerType: { name: input.customerType === "person" ? "person" : "company" }, identification: { type: String(type.id), number },
        name: input.name, fantasyName: input.fantasyName ?? "", businessActivity: input.businessActivity ?? "",
        isConsignment: input.customerType === "consignment", isEnabled: true,
        address: { country: "", region: "", county: "", city: "", postalCode: "", address: "", lat: "", lon: "" }, contacts: [], branches: [],
        creditValidation: { customerId: 0, maxDiscount: 0, minCreditInterest: 0, assignableCreditCurrencyId: null, maxPaymentTermId: null,
          totalAssignableCredit: 0, pendingCredit: 0, creditAvailability: 0 }
      } })));
      const customerId = positive(created.id);
      if (customerId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      forgetCustomerList(upstream);
      return workshopNewCustomerResultSchema.parse({ id: customerId, name: input.name.slice(0, 300), document: number?.slice(0, 60) ?? null });
    });
    res.status(replayed ? 200 : 201).json(result);
  });

  router.post("/customers/:customerId/branches", async (req, res) => {
    const { customerId } = customerParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopNewBranchSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    const { result, replayed } = await ledger.run(`${user.id}`, input.requestId, { customerId, input }, async () => {
      if (positive(asRecord(await upstream.request(`/customers/${customerId}`, { token })).id) !== customerId) throw new GatewayError(404, "CUSTOMER_NOT_FOUND", "El cliente ya no existe.");
      const street = input.address ? `${input.address}${input.noStreetNumber ? " S/N" : ""}` : "";
      const created = asRecord(await permitted("\"crear\" en Negocios", () => upstream.request("/customer_branches", { token, method: "POST", json: {
        customerId: String(customerId), name: input.name, description: input.contactName ?? "", country: input.country ?? "", region: input.region ?? "", county: input.county ?? "",
        city: input.city ?? "", address: [street, input.apartment ? `Depto ${input.apartment}` : ""].filter(Boolean).join(", "), postalCode: input.postalCode ?? "",
        lat: input.lat ?? "", lon: input.lon ?? "", isEnabled: true
      } })));
      const branchId = positive(created.id);
      if (branchId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      return workshopNewBranchResultSchema.parse({ id: branchId, name: (text(created.name) ?? input.name).slice(0, 300) });
    });
    res.status(replayed ? 200 : 201).json(result);
  });

  router.post("/customers/:customerId/contacts", async (req, res) => {
    const { customerId } = customerParam.parse(req.params);
    emptySchema.parse(req.query);
    const input = workshopNewContactSchema.parse(req.body);
    const { token, user } = await workshopActor(upstream, req, input.companyBranchId);
    const { result, replayed } = await ledger.run(`${user.id}`, input.requestId, { customerId, input }, async () => {
      const created = await permitted("\"editar\" en Clientes", () => upstream.request(`/customers/${customerId}/contacts`, { token, method: "POST", json: {
        fullName: `${input.firstName} ${input.lastName}`, email: input.email ? input.email.replace(/\s+/g, "").toLowerCase() : "",
        phone: input.phone ? normalizePhone(input.phone) : "", position: input.position ?? "", notes: input.notes ?? ""
      } }));
      const saved = contact(created);
      if (saved === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
      return workshopNewContactResultSchema.parse(saved);
    });
    res.status(replayed ? 200 : 201).json(result);
  });
}
