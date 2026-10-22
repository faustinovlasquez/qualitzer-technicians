import { Router } from "express";
import { z } from "zod";
import {
  cleanRut, formatRut, isValidRut, normalizePhone, workshopIdentificationTypesSchema, workshopNewBranchResultSchema, workshopNewBranchSchema,
  workshopNewContactResultSchema, workshopNewContactSchema, workshopNewCustomerResultSchema, workshopNewCustomerSchema
} from "../../src/domain/workshopCustomers";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { contact } from "./intake";
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

/** Crear cliente, sucursal o contacto desde el ingreso, con los mismos datos y reglas de los formularios rápidos de la web. */
export function registerCustomerRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger): void {
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
      if (type.isRut && !isValidRut(input.number)) throw new GatewayError(400, "RUT_INVALID", "El RUT no es válido. Revisa el número y el dígito verificador.");
      const number = type.isRut ? formatRut(input.number) : input.number.replace(/\s+/g, "");
      // Igual que la web: antes de crear se busca si ya existe un cliente con esa identificación.
      const found = list(await upstream.request("/customers", { token, query: new URLSearchParams({
        pagination: JSON.stringify({ page: 1, limit: 80 }), filters: JSON.stringify({ search: number })
      }) }));
      const same = (value: unknown) => { const raw = text(value); return raw !== null && (type.isRut ? cleanRut(raw) === cleanRut(number) : raw.replace(/\s+/g, "").toUpperCase() === number.toUpperCase()); };
      const duplicate = found.map(asRecord).find((row) => same(row.documentIdentification) || same(asRecord(row.identification).number) || same(row.rut));
      if (duplicate) throw new GatewayError(409, "CLIENT_IDENTIFICATION_EXISTS", `Ya existe un cliente con esa identificación: ${text(duplicate.name) ?? number}. Búscalo en la lista.`);
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
      return workshopNewCustomerResultSchema.parse({ id: customerId, name: input.name.slice(0, 300), document: number.slice(0, 60) });
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
        customerId: String(customerId), name: input.name, description: input.contactName ?? "", country: "", region: input.region ?? "", county: input.county ?? "",
        city: input.city ?? "", address: [street, input.apartment ? `Depto ${input.apartment}` : ""].filter(Boolean).join(", "), postalCode: "", lat: "", lon: "", isEnabled: true
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
