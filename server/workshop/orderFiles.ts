import type { Router } from "express";
import { z } from "zod";
import { parseUpstream } from "../contracts";
import { GatewayError } from "../errors";
import { documentForm, readDocuments, releaseDocuments } from "../files/documents";
import { panelFilesSchema } from "../panel/contracts";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { loadWorkshopEntry } from "./entry";
import { loadOrderDocument, NO_ENTRY } from "./orderDetail";
import { workshopActor } from "./support";

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Ingreso 0: OT abierta desde Mi jornada.
const entryRef = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const orderIds = z.object({ entryId: entryRef, orderId: id }).strict();
const fileIds = z.object({ entryId: entryRef, orderId: id, fileId: id }).strict();
const branchQuery = z.object({ companyBranchId: id }).strict();

/** La OT (no un mantenimiento) pertenece al ingreso de la sucursal. */
async function assertOrderOfEntry(upstream: Upstream, token: string, branchId: number, entryId: number, orderId: number): Promise<void> {
  if (entryId === NO_ENTRY) { await loadOrderDocument(upstream, token, branchId, NO_ENTRY, orderId); return; }
  const entry = await loadWorkshopEntry(upstream, token, branchId, entryId);
  if (!entry.orders.available) throw new GatewayError(503, "WORKSHOP_ENTRY_INCOMPLETE", "No se pudieron revisar las órdenes del ingreso. Inténtalo de nuevo.");
  if (!entry.orders.items.some((item) => item.id === orderId && item.kind !== "maintenance")) {
    throw new GatewayError(404, "NEGOTIATION_NOT_FOUND", "Esa orden no pertenece a este ingreso. Actualiza la ficha.");
  }
}

/** Archivos de la OT (los mismos de la pestaña Archivos de la OT en la web y en Mi jornada). */
export function registerOrderFileRoutes(router: Router, upstream: Upstream): void {
  const list = (token: string, branchId: number, orderId: number, page = 0) => upstream.request(`/negotiation_files/${orderId}`, { token, query: new URLSearchParams({
    companyBranchId: String(branchId), filters: JSON.stringify({ companyBranchId: branchId }), pagination: JSON.stringify({ page, limit: 1000 })
  }) }).then((raw) => parseUpstream(panelFilesSchema, raw));
  let uploading = 0;

  router.get("/entries/:entryId/orders/:orderId/files", async (req, res) => {
    const { entryId, orderId } = orderIds.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    await assertOrderOfEntry(upstream, token, companyBranchId, entryId, orderId);
    res.set("Cache-Control", "no-store").json(await list(token, companyBranchId, orderId));
  });

  router.post("/entries/:entryId/orders/:orderId/files", async (req, res) => {
    const { entryId, orderId } = orderIds.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    if (uploading >= 2) throw new GatewayError(429, "UPLOAD_BUSY");
    uploading += 1;
    try {
      const { token } = await workshopActor(upstream, req, companyBranchId);
      await assertOrderOfEntry(upstream, token, companyBranchId, entryId, orderId);
      const files = await readDocuments(req, res);
      await upstream.request(`/negotiation_files/${orderId}`, { method: "POST", token, form: documentForm(files, "attachments", companyBranchId) });
      res.status(201).json({ success: true });
    } finally { releaseDocuments(req); uploading -= 1; }
  });

  router.delete("/entries/:entryId/orders/:orderId/files/:fileId", async (req, res) => {
    const { entryId, orderId, fileId } = fileIds.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    await assertOrderOfEntry(upstream, token, companyBranchId, entryId, orderId);
    // Solo se borra un archivo que de verdad es de esta OT.
    let found = false;
    for (let page = 0; page < 100 && !found; page++) {
      const result = await list(token, companyBranchId, orderId, page);
      found = result.data.some((file) => String(file.id) === String(fileId));
      if (found || page + 1 >= result.totalPages || result.data.length === 0) break;
    }
    if (!found) throw new GatewayError(404, "FILE_NOT_FOUND");
    await upstream.request(`/files/${fileId}`, { method: "DELETE", token, query: new URLSearchParams({ companyBranchId: String(companyBranchId) }) });
    res.json({ success: true });
  });
}
