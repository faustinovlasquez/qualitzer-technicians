import express, { Router } from "express";
import { z } from "zod";
import { deliveryBlockers, workshopDeliveryInputSchema, workshopDeliveryResultSchema } from "../../src/domain/workshopDelivery";
import { GatewayError } from "../errors";
import { signatureSchema } from "../orders/validation";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { loadWorkshopEntry } from "./entry";
import { workshopActor, type WorkshopRequestLedger } from "./support";

export const WORKSHOP_DELIVERY_PATH = /^\/api\/workshop\/entries\/[1-9]\d*\/delivery\/?$/i;
const deliveryJson = express.json({ limit: 3 * 1024 * 1024, strict: true, inflate: false });

/** Entregar el equipo: valida las condiciones de la ficha (igual que la web), la firma y registra la salida. */
export function registerDeliveryRoutes(router: Router, upstream: Upstream, ledger: WorkshopRequestLedger): void {
  router.post("/entries/:entryId/delivery", deliveryJson, async (req, res) => {
    const { entryId } = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().parse(req.params);
    emptySchema.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = workshopDeliveryInputSchema.parse(req.body);
    if (!signatureSchema.safeParse(input.receiverSignature).success) throw new GatewayError(400, "WORKSHOP_SIGNATURE_INVALID", "La firma no es válida. Vuelve a firmar.");
    if (Date.parse(input.deliveredAt) > Date.now() + 10 * 60_000) throw new GatewayError(400, "WORKSHOP_DELIVERY_IN_FUTURE", "La fecha de entrega no puede ser futura.");
    const actor = await workshopActor(upstream, req, input.companyBranchId);
    const { result } = await ledger.run(`${actor.user.id}`, input.requestId, { entryId, input }, async () => {
      const detail = await loadWorkshopEntry(upstream, actor.token, input.companyBranchId, entryId);
      if (detail.delivery) throw new GatewayError(409, "DEPARTURE_ALREADY_EXISTS", "Este equipo ya fue entregado.");
      const { pending } = deliveryBlockers(detail);
      if (pending.length > 0) throw new GatewayError(409, "WORKSHOP_DELIVERY_BLOCKED", `Falta cumplir: ${pending.map((condition) => condition.title).join(", ")}.`);
      await upstream.request(`/operation_area_entries/${entryId}/deliver`, { token: actor.token, method: "PATCH", json: {
        companyBranchId: input.companyBranchId, deliveredAt: input.deliveredAt, deliveryNote: input.note || null,
        receiverName: input.receiverName, receiverPhone: input.receiverPhone || null, receiverEmail: input.receiverEmail || null, receiverSignature: input.receiverSignature
      } });
      return { id: entryId, deliveredAt: input.deliveredAt };
    });
    res.json(workshopDeliveryResultSchema.parse(result));
  });
}
