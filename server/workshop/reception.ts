import express, { Router } from "express";
import { z } from "zod";
import {
  SAVED_SIGNATURE_MAX_CHARS, shouldMoveToStatus, workshopReceptionInputSchema, workshopReceptionResultSchema, workshopSavedSignaturesSchema, workshopWorkersSchema,
  type WorkshopSavedSignature, type WorkshopWorker
} from "../../src/domain/workshopReception";
import { evaluateInspection } from "../../src/domain/workshopEntry";
import { GatewayError } from "../errors";
import { signatureSchema } from "../orders/validation";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { loadWorkshopEntry } from "./entry";
import { asRecord, clip, list, positive, text, workshopActor, type WorkshopRequestLedger } from "./support";

const branchQuery = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict();

export const WORKSHOP_RECEPTION_PATH = /^\/api\/workshop\/entries\/[1-9]\d*\/reception\/?$/i;
const receptionJson = express.json({ limit: 3 * 1024 * 1024, strict: true, inflate: false });

export function worker(raw: unknown): WorkshopWorker | null {
  const row = asRecord(raw);
  const workerId = positive(row.value ?? row.id);
  const name = text(row.label);
  if (workerId === null || name === null) return null;
  const profile = asRecord(row.profile);
  return { id: workerId, name: name.slice(0, 300), userId: positive(row.userId ?? profile.userId),
    email: clip(text(asRecord(profile.user).email) ?? text(profile.email), 200), phone: clip(text(profile.phone), 60) };
}

function savedSignatures(raw: unknown, defaultId: number | null): WorkshopSavedSignature[] {
  return list(asRecord(raw).options).flatMap((item) => {
    const row = asRecord(item);
    const signatureId = positive(row.id ?? row.value);
    if (signatureId === null) return [];
    const image = text(row.signatureImage);
    return [{ id: signatureId, name: (text(row.signatureName) ?? text(row.label) ?? `Firma ${signatureId}`).slice(0, 300), email: clip(text(row.signatureEmail), 200),
      phone: clip(text(row.signaturePhone), 60), image: image && /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(image) && image.length <= SAVED_SIGNATURE_MAX_CHARS ? image : null,
      isDefault: signatureId === defaultId || row.isDefaultForBranch === true }];
  }).slice(0, 100);
}

/** Paso 3 del ingreso: quién recibe, su firma (guardada o dibujada) y la observación. Deja el ingreso "En proceso". */
export function registerReceptionRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger): void {
  router.get("/options/workers", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    // El backend filtra por sucursal con filterByBranch (companyBranchId lo ignora).
    const items = list(await upstream.request("/select/employees", { token, query: new URLSearchParams({ filterByBranch: String(companyBranchId) }) }))
      .map(worker).filter((item) => item !== null);
    items.sort((a, b) => a.name.localeCompare(b.name, "es"));
    const parsed = workshopWorkersSchema.safeParse({ items: items.slice(0, 5000) });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(parsed.data);
  });

  router.get("/options/signatures", async (req, res) => {
    const query = z.object({ companyBranchId: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }).strict().parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, query.companyBranchId);
    const raw = await upstream.request("/user_signatures/options", { token, query: new URLSearchParams({ userId: String(query.userId), companyBranchId: String(query.companyBranchId) }) });
    const parsed = workshopSavedSignaturesSchema.safeParse({ items: savedSignatures(raw, positive(asRecord(raw).defaultSignatureId)) });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(parsed.data);
  });

  router.post("/entries/:entryId/reception", receptionJson, async (req, res) => {
    const { entryId } = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().parse(req.params);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopReceptionInputSchema.parse(req.body);
    if (input.signature.source === "MANUAL" && !signatureSchema.safeParse(input.signature.image).success) {
      throw new GatewayError(400, "WORKSHOP_SIGNATURE_INVALID", "La firma no es válida. Vuelve a firmar.");
    }
    const actor = await workshopActor(upstream, req, input.companyBranchId);
    const { token } = actor;
    const { result } = await ledger.run(`${actor.user.id}`, input.requestId, { entryId, input }, async () => {
      // Igual que la web: la inspección de ingreso debe cumplir lo que exige la sucursal antes de firmar.
      const detail = await loadWorkshopEntry(upstream, token, input.companyBranchId, entryId);
      if (detail.delivery) throw new GatewayError(409, "DEPARTURE_ALREADY_EXISTS", "Este equipo ya fue entregado.");
      const check = evaluateInspection(detail.inspections.entryRequirement, detail.inspections.entry, detail.inspections.photoSlots);
      if (!detail.inspections.available || !check.met) {
        throw new GatewayError(409, "WORKSHOP_INSPECTION_INCOMPLETE", `Antes de firmar completa la inspección de ingreso: ${check.missing.join(" · ") || "no se pudo verificar"}.`);
      }

      const workers = list(await upstream.request("/select/employees", { token, query: new URLSearchParams({ filterByBranch: String(input.companyBranchId) }) })).map(worker);
      const receiver = workers.find((item) => item?.id === input.workerId);
      if (!receiver) throw new GatewayError(400, "WORKSHOP_WORKER_NOT_FOUND", "El trabajador elegido ya no está disponible en la sucursal.");
      let signatureImage: string;
      let userSignatureId: number | null = null;
      if (input.signature.source === "USER_SIGNATURE") {
        // La firma guardada debe ser del trabajador que recibe: igual que la web, se guarda su imagen tal cual.
        if (receiver.userId === null) throw new GatewayError(400, "WORKSHOP_SIGNATURE_INVALID", "El trabajador no tiene firmas guardadas. Firma en pantalla.");
        const raw = await upstream.request("/user_signatures/options", { token, query: new URLSearchParams({ userId: String(receiver.userId), companyBranchId: String(input.companyBranchId) }) });
        const chosen = savedSignatures(raw, null).find((item) => item.id === input.signature.userSignatureId);
        if (!chosen?.image) throw new GatewayError(400, "WORKSHOP_SIGNATURE_INVALID", "Esa firma guardada ya no está disponible. Elige otra o firma en pantalla.");
        signatureImage = chosen.image;
        userSignatureId = chosen.id;
      } else signatureImage = input.signature.image;

      const raw = asRecord(await upstream.request(`/operation_area_entries/${entryId}`, { token }));
      const form = new FormData();
      form.set("companyBranchId", String(input.companyBranchId));
      // El backend borra contactos y sucursales si no vienen: se reenvían los actuales.
      form.set("contacts", JSON.stringify(list(raw.contacts).flatMap((item) => { const value = positive(asRecord(item).id); return value === null ? [] : [{ id: value, isNew: false }]; })));
      form.set("branchesCustomer", JSON.stringify(list(raw.branchesCustomer).flatMap((item) => { const value = positive(asRecord(item).value ?? asRecord(item).id); return value === null ? [] : [{ id: value, value: String(value) }]; })));
      form.set("responsibleSignature", JSON.stringify({
        id: String(input.workerId), workerId: String(input.workerId), name: input.name, email: input.email || null, phone: input.phone || null,
        userSignatureId, signatureSource: input.signature.source, signatureImage, signedAt: new Date().toISOString()
      }));
      const saved = asRecord(await upstream.request(`/operation_area_entries/${entryId}`, { token, method: "PUT", form }));
      if (positive(saved.id) !== entryId) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");

      // Observación de recepción en la inspección de ingreso (pide permiso de equipos de arriendo: si falta, la firma ya quedó).
      let observationSaved = true;
      if (input.observation) {
        observationSaved = false;
        try {
          const internal = raw.isInternalEntry === true;
          const ensured = asRecord(await upstream.request("/equipment_dispatches/inspections/ensure", { token, method: "POST", json: {
            type: "DISPATCH", operationAreaEntryId: entryId, rentalEquipmentId: internal ? positive(raw.rentalEquipmentId) : null, customerEquipmentId: internal ? null : positive(raw.customerEquipmentId)
          } }));
          const inspectionId = positive(ensured.inspectionId);
          if (inspectionId !== null) {
            await upstream.request(`/equipment_dispatches/inspections/${inspectionId}/meta`, { token, method: "PUT", json: { observation: input.observation } });
            observationSaved = true;
          }
        } catch (error) { if (error instanceof GatewayError && error.status === 401) throw error; }
      }

      // Estado "En proceso", solo hacia adelante (igual que la web).
      let statusUpdated = true;
      const current = text(asRecord(raw.status).key);
      if (shouldMoveToStatus(current, "IN_PROGRESS")) {
        statusUpdated = false;
        try {
          const statuses = list(await upstream.request("/master_commercial/get-all-status", { token, query: new URLSearchParams({ module: "OPERATION_AREAS_ENTRIES", companyBranchId: String(input.companyBranchId) }) }))
            .map(asRecord).filter((row) => row.isPrimary === true && row.isEnabled !== false);
          const target = statuses.find((row) => text(row.name) === "IN_PROGRESS");
          const statusId = positive(target?.id);
          if (statusId !== null) {
            await upstream.request(`/operation_area_entries/${entryId}/change-status`, { token, method: "PATCH", json: { statusId, subStatusId: positive(target?.defaultSubStatusId) } });
            statusUpdated = true;
          }
        } catch (error) { if (error instanceof GatewayError && error.status === 401) throw error; }
      }
      return { id: entryId, observationSaved, statusUpdated };
    });
    res.json(workshopReceptionResultSchema.parse(result));
  });
}
