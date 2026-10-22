import express, { Router, type Request } from "express";
import { z } from "zod";
import {
  CUSTOM_SLOT_KEY, INSPECTION_PHOTO_MAX_BYTES, inspectionShareSchema, inspectionAnswerInputSchema, inspectionBackendType, inspectionBranchInputSchema, inspectionChecklistOptionsSchema,
  inspectionChecklistsInputSchema, inspectionDamageInputSchema, inspectionMetaInputSchema, inspectionOpenInputSchema, inspectionPhotoInputSchema,
  inspectionSavedSchema, inspectionStepTypeSchema, isInspectionStepCompleted, isValidInspectionResponse, workshopInspectionStateSchema,
  type InspectionKind, type InspectionStep, type WorkshopInspectionState
} from "../../src/domain/workshopInspection";
import { inspectionRequirementSchema } from "../../src/domain/workshopEntry";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { photoSlots } from "./entry";
import { jpegBytes } from "./intake";
import { asRecord, branchEntry, clip, isoDate, list, positive, text, workshopActor, type Raw, type WorkshopActor } from "./support";

const ids = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), inspectionId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const branchQuery = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict();
const base = (inspectionId: number) => `/equipment_dispatches/inspections/${inspectionId}` as const;

/** Rutas con foto en JSON (más grandes que el límite general). */
export const WORKSHOP_INSPECTION_PHOTO_PATH = /^\/api\/workshop\/entries\/[1-9]\d*\/inspections\/[1-9]\d*\/(?:photos\/[^/]+|steps\/[1-9]\d*\/files|damages\/[1-9]\d*\/photos)\/?$/i;
const photoJson = express.json({ limit: INSPECTION_PHOTO_MAX_BYTES * 2, strict: true, inflate: false });

const fileOf = (raw: unknown) => {
  const row = asRecord(raw);
  const file = asRecord(row.file);
  const fileId = positive(row.fileId ?? file.id);
  const url = text(file.thumbnailUrl) ?? text(file.url);
  return fileId !== null && url !== null && row.isDeleted !== true ? { fileId, url: url.slice(0, 4000), fullUrl: clip(text(file.url), 4000) } : null;
};
const options = (value: unknown) => {
  let parsed = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { parsed = []; } }
  return list(parsed).flatMap((item) => {
    const option = asRecord(item);
    const optionValue = text(option.value);
    return optionValue === null ? [] : [{ value: optionValue.slice(0, 200), label: (text(option.label) ?? optionValue).slice(0, 300) }];
  }).slice(0, 100);
};
const responseText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value === "" ? null : value.slice(0, 4000);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value).slice(0, 4000);
};

/** Permiso de escritura de inspecciones: el backend pide "editar" en equipos de arriendo. */
async function writing<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof GatewayError && error.status === 403) {
      throw new GatewayError(403, "INSPECTION_PERMISSION_REQUIRED", "Tu perfil no tiene permiso para guardar inspecciones. Pide que te den \"editar\" en Equipos de arriendo.");
    }
    throw error;
  }
}

interface Loaded { detail: Raw; actor: WorkshopActor; kind: InspectionKind }

/** La inspección existe y pertenece a este ingreso (el teléfono no puede tocar inspecciones de otro ingreso). */
async function owned(upstream: Upstream, req: Request, branchId: number): Promise<Loaded & { entryId: number; inspectionId: number }> {
  const { entryId, inspectionId } = ids.parse(req.params);
  const actor = await workshopActor(upstream, req, branchId);
  const [detail] = await Promise.all([upstream.request(base(inspectionId), { token: actor.token }).then(asRecord), branchEntry(upstream, actor.token, branchId, entryId)]);
  const type = text(detail.type);
  if (positive(detail.id) !== inspectionId || positive(detail.operationAreaEntryId) !== entryId || (type !== "DISPATCH" && type !== "RETURN")) {
    throw new GatewayError(404, "INSPECTION_NOT_FOUND", "La inspección no pertenece a este ingreso. Vuelve a abrirla desde la ficha.");
  }
  return { detail, actor, kind: type === "DISPATCH" ? "entry" : "exit", entryId, inspectionId };
}

function stepFrom(raw: unknown, saved: Raw[]): InspectionStep | null {
  const step = asRecord(raw);
  const checklistStepId = positive(step.id);
  const type = inspectionStepTypeSchema.safeParse(text(step.type));
  if (checklistStepId === null || !type.success) return null;
  const answer = saved.find((row) => positive(row.checklistStepId) === checklistStepId && row.isDeleted !== true);
  const stepId = answer ? positive(answer.id) : null;
  return {
    checklistStepId, order: Math.max(0, Math.min(100_000, Number(step.order) || 0)), title: (text(step.title) ?? "Pregunta").slice(0, 500),
    description: clip(text(step.description), 2000), type: type.data, options: options(step.value), isRequired: step.isRequired !== false,
    isFilesRequired: step.isFilesRequired === true,
    answer: answer && stepId !== null ? {
      stepId, responseValue: responseText(answer.responseValue), comment: clip(text(answer.comment), 2000),
      isCompleted: answer.isCompleted === true || answer.executionStatus === "completed",
      files: list(answer.photos).map(fileOf).filter((item) => item !== null).slice(0, 50)
    } : null
  };
}

/** Fotos de la inspección de ingreso del mismo ingreso (referencia para comparar en la entrega). Si falla, sin referencia. */
async function entryPhotos(upstream: Upstream, token: string, entryId: number): Promise<Raw[]> {
  try {
    const compliance = asRecord(await upstream.request(`/equipment_dispatches/inspections/by-entry/${entryId}/compliance`, { token }));
    const entryInspectionId = positive(asRecord(compliance.entryInspection).id);
    if (entryInspectionId === null) return [];
    const detail = asRecord(await upstream.request(base(entryInspectionId), { token }));
    if (positive(detail.operationAreaEntryId) !== entryId) return [];
    return list(detail.photos).map(asRecord).filter((row) => row.isDeleted !== true);
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) throw error;
    return [];
  }
}

async function loadState(upstream: Upstream, actor: WorkshopActor, inspectionId: number, entryId: number, kind: InspectionKind, detail?: Raw): Promise<WorkshopInspectionState> {
  const token = actor.token;
  const [fresh, config, context, branchConfig, reference] = await Promise.all([
    detail ? Promise.resolve(detail) : upstream.request(base(inspectionId), { token }),
    upstream.request(`${base(inspectionId)}/checklists`, { token }),
    upstream.request(`${base(inspectionId)}/patio-context`, { token }),
    // Sin la configuración se asume "no exigida", salvo sesión vencida (debe llegar a la app).
    upstream.request(`/branches/${actor.branchId}/inspectionRequirementsConfig`, { token }).catch((error: unknown) => { if (error instanceof GatewayError && error.status === 401) throw error; return null; }),
    kind === "exit" ? entryPhotos(upstream, token, entryId) : Promise.resolve([])
  ]);
  const inspection = asRecord(fresh);
  const patio = asRecord(context);
  const saved = list(inspection.checklistSteps).map(asRecord);
  const photos = list(inspection.photos).map(asRecord).filter((row) => row.isDeleted !== true);
  const referenceOf = (key: string) => fileOf(reference.find((row) => text(row.photoType) === key));
  // Fotos adicionales ("Agregar foto"): clave custom-… y el nombre que se les dio, al final como en la web.
  const customSlots = photos.filter((row) => CUSTOM_SLOT_KEY.test(text(row.photoType) ?? "")).map((row) => ({
    key: text(row.photoType)!, name: (text(row.label) ?? "Foto adicional").slice(0, 200), isRequired: false, photo: fileOf(row), custom: true, reference: null
  }));
  const requirement = inspectionRequirementSchema.safeParse(asRecord(asRecord(branchConfig).inspectionRequirementsConfig)[kind]);
  const state = workshopInspectionStateSchema.safeParse({
    inspectionId, entryId, kind, requirement: requirement.success ? requirement.data : "none",
    completedAt: isoDate(inspection.completedAt), observation: clip(text(inspection.observation), 2000),
    slots: [...photoSlots(patio.requiredPhotos, positive(patio.equipmentTypeId), text(patio.equipmentTypeName)).map((slot) => ({
      ...slot, photo: fileOf(photos.find((row) => text(row.photoType) === slot.key)), custom: false, reference: kind === "exit" ? referenceOf(slot.key) : null
    })), ...customSlots].slice(0, 200),
    checklists: list(config).map(asRecord).flatMap((item) => {
      const checklist = asRecord(item.checklist);
      const checklistId = positive(item.checklistId ?? checklist.id);
      if (checklistId === null) return [];
      const steps = list(checklist.steps).map((step) => stepFrom(step, saved.filter((row) => positive(row.checklistId) === checklistId))).filter((step) => step !== null);
      steps.sort((a, b) => a.order - b.order);
      return [{ checklistId, name: (text(checklist.name) ?? `Lista ${checklistId}`).slice(0, 300), isRequired: item.isRequired === true,
        locked: text(item.origin) === "DISPATCH_DEFAULT", steps: steps.slice(0, 300) }];
    }).slice(0, 50),
    damages: list(inspection.damages).map(asRecord).filter((row) => row.isDeleted !== true).flatMap((row) => {
      const damageId = positive(row.id);
      if (damageId === null) return [];
      const severity = text(row.severity);
      const responsibility = text(row.responsibility);
      return [{ id: damageId, description: (text(row.description) ?? "").slice(0, 2000),
        severity: severity === "LOW" || severity === "HIGH" ? severity : "MEDIUM",
        responsibility: responsibility === "CLIENT" || responsibility === "WEAR" ? responsibility : "PENDING",
        location: clip(text(row.location), 300), isAdditional: row.isAdditional === true, photos: list(row.photos).map(fileOf).filter((file) => file !== null).slice(0, 50) }];
    }).slice(0, 200)
  });
  if (!state.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  return state.data;
}

const captured = (actor: WorkshopActor, source: "camera" | "gallery") => ({
  captureSources: JSON.stringify([source === "camera" ? "live_camera" : "gallery_upload"]),
  capturedAts: JSON.stringify([new Date().toISOString()]),
  capturedByNames: JSON.stringify([`${actor.user.name} ${actor.user.lastnames}`.trim() || actor.user.email])
});
const imageForm = (actor: WorkshopActor, image: string, source: "camera" | "gallery", extra: Record<string, string>) => {
  const form = new FormData();
  form.set("companyBranchId", String(actor.branchId));
  for (const [key, value] of Object.entries({ ...captured(actor, source), ...extra })) form.set(key, value);
  form.append("files", new Blob([new Uint8Array(jpegBytes(image, INSPECTION_PHOTO_MAX_BYTES))], { type: "image/jpeg" }), `inspeccion-${Date.now()}.jpg`);
  return form;
};

/** Guarda una pregunta completa (el backend reemplaza todos los campos), recalculando si quedó completa. */
async function saveStep(upstream: Upstream, token: string, inspectionId: number, checklistId: number, step: InspectionStep, responseValue: string | null, comment: string | null, filesCount: number) {
  const completed = isInspectionStepCompleted(step, responseValue, filesCount);
  const saved = asRecord(await writing(() => upstream.request(`${base(inspectionId)}/checklist-steps`, { token, method: "PUT", json: {
    checklistId, checklistStepId: step.checklistStepId, order: step.order, title: step.title, description: step.description, type: step.type,
    value: step.options, isFilesRequired: step.isFilesRequired, responseValue, comment, isCompleted: completed, executionStatus: completed ? "completed" : null
  } })));
  const stepId = positive(saved.stepId);
  if (stepId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
  return stepId;
}

/** Vuelve a guardar la pregunta dueña de una foto para que su estado "completa" considere la foto nueva o quitada. */
async function refreshStepOf(upstream: Upstream, loaded: Loaded & { entryId: number; inspectionId: number }, stepId: number) {
  const state = await loadState(upstream, loaded.actor, loaded.inspectionId, loaded.entryId, loaded.kind);
  for (const checklist of state.checklists) for (const step of checklist.steps) {
    if (step.answer?.stepId === stepId) await saveStep(upstream, loaded.actor.token, loaded.inspectionId, checklist.checklistId, step, step.answer.responseValue, step.answer.comment, step.answer.files.length);
  }
}

/** Inspección de ingreso o de entrega desde la app: fotos por ángulo, listas de revisión, daños y término. */
export function registerInspectionRoutes(router: Router, upstream: Upstream): void {
  router.get("/options/checklists", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const rows = list(await upstream.request("/checklists", { token, query: new URLSearchParams({
      pagination: JSON.stringify({ limit: 100, page: 0 }), filters: JSON.stringify({ isEnabled: "true", checklistType: "EQUIPMENT" }), companyBranchId: String(companyBranchId)
    }) }));
    const items = rows.map(asRecord).filter((row) => text(row.classification) !== "TRANSPORT" && row.isEnabled !== false).flatMap((row) => {
      const checklistId = positive(row.id);
      const name = text(row.name);
      return checklistId !== null && name !== null ? [{ id: checklistId, name: name.slice(0, 300) }] : [];
    });
    const parsed = inspectionChecklistOptionsSchema.safeParse({ items: items.slice(0, 500) });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(parsed.data);
  });

  router.post("/entries/:entryId/inspections", async (req, res) => {
    const { entryId } = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().parse(req.params);
    emptySchema.parse(req.query);
    const input = inspectionOpenInputSchema.parse(req.body);
    const actor = await workshopActor(upstream, req, input.companyBranchId);
    const { raw: entry } = await branchEntry(upstream, actor.token, input.companyBranchId, entryId);
    const internal = entry.isInternalEntry === true;
    // Si el ingreso ya tiene una inspección de este tipo (aunque esté terminada) se abre esa: "ensure" del backend solo
    // reutiliza las no terminadas y crearía una nueva en blanco que reemplazaría a la terminada en la ficha.
    const compliance = asRecord(await upstream.request(`/equipment_dispatches/inspections/by-entry/${entryId}/compliance`, { token: actor.token }));
    const existingId = positive(asRecord(input.kind === "entry" ? compliance.entryInspection : compliance.exitInspection).id);
    if (existingId !== null) {
      const existing = asRecord(await upstream.request(base(existingId), { token: actor.token }));
      if (positive(existing.operationAreaEntryId) === entryId && text(existing.type) === inspectionBackendType(input.kind)) {
        res.json(await loadState(upstream, actor, existingId, entryId, input.kind, existing));
        return;
      }
    }
    const ensured = asRecord(await writing(() => upstream.request("/equipment_dispatches/inspections/ensure", { token: actor.token, method: "POST", json: {
      type: inspectionBackendType(input.kind), operationAreaEntryId: entryId,
      rentalEquipmentId: internal ? positive(entry.rentalEquipmentId) : null, customerEquipmentId: internal ? null : positive(entry.customerEquipmentId)
    } })));
    const inspectionId = positive(ensured.inspectionId);
    if (inspectionId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    if (ensured.created === true) {
      // Igual que la web: el técnico que la abre queda como responsable.
      const name = `${actor.user.name} ${actor.user.lastnames}`.trim();
      if (name) await writing(() => upstream.request(`${base(inspectionId)}/meta`, { token: actor.token, method: "PUT", json: { technicianName: name.slice(0, 200) } }));
    }
    res.json(await loadState(upstream, actor, inspectionId, entryId, input.kind));
  });

  router.get("/entries/:entryId/inspections/:inspectionId", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const loaded = await owned(upstream, req, companyBranchId);
    res.json(await loadState(upstream, loaded.actor, loaded.inspectionId, loaded.entryId, loaded.kind, loaded.detail));
  });

  router.put("/entries/:entryId/inspections/:inspectionId/checklists", async (req, res) => {
    emptySchema.parse(req.query);
    const input = inspectionChecklistsInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    // El backend antepone siempre las listas obligatorias de la sucursal; las demás se guardan como opcionales, igual que la web.
    await writing(() => upstream.request(`${base(loaded.inspectionId)}/checklists`, { token: loaded.actor.token, method: "PUT",
      json: { items: [...new Set(input.checklistIds)].map((checklistId) => ({ checklistId, isRequired: false })) } }));
    res.json(await loadState(upstream, loaded.actor, loaded.inspectionId, loaded.entryId, loaded.kind));
  });

  router.put("/entries/:entryId/inspections/:inspectionId/steps", async (req, res) => {
    emptySchema.parse(req.query);
    const input = inspectionAnswerInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    const state = await loadState(upstream, loaded.actor, loaded.inspectionId, loaded.entryId, loaded.kind, loaded.detail);
    const step = state.checklists.find((checklist) => checklist.checklistId === input.checklistId)?.steps.find((item) => item.checklistStepId === input.checklistStepId);
    if (!step) throw new GatewayError(404, "INSPECTION_STEP_NOT_FOUND", "Esa pregunta ya no está en la lista. Actualiza la inspección.");
    if (!isValidInspectionResponse(step, input.responseValue)) throw new GatewayError(400, "INSPECTION_ANSWER_INVALID", "La respuesta no corresponde a la pregunta.");
    const stepId = await saveStep(upstream, loaded.actor.token, loaded.inspectionId, input.checklistId, step, input.responseValue, input.comment || null, step.answer?.files.length ?? 0);
    res.json(inspectionSavedSchema.parse({ id: stepId }));
  });

  router.post("/entries/:entryId/inspections/:inspectionId/photos/:slotKey", photoJson, async (req, res) => {
    const slotKey = z.string().min(1).max(120).parse(req.params.slotKey);
    emptySchema.parse(req.query);
    const input = inspectionPhotoInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    const state = await loadState(upstream, loaded.actor, loaded.inspectionId, loaded.entryId, loaded.kind, loaded.detail);
    // Foto adicional nueva (clave custom-… con nombre libre), igual que "Agregar foto" en la web.
    const slot = state.slots.find((item) => item.key === slotKey)
      ?? (CUSTOM_SLOT_KEY.test(slotKey) && input.label ? { key: slotKey, name: input.label } : null);
    if (!slot) throw new GatewayError(404, "INSPECTION_SLOT_NOT_FOUND", "Ese ángulo de foto no corresponde a este equipo.");
    const saved = asRecord(await writing(() => upstream.request(`${base(loaded.inspectionId)}/photos`, { token: loaded.actor.token, method: "POST",
      form: imageForm(loaded.actor, input.image, input.source, { photoTypes: JSON.stringify([slot.key]), labels: JSON.stringify([slot.name]) }) })));
    const fileId = positive(list(saved.fileIds)[0]);
    if (fileId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json({ id: fileId });
  });

  router.delete("/entries/:entryId/inspections/:inspectionId/photos/:slotKey", async (req, res) => {
    const slotKey = z.string().min(1).max(120).parse(req.params.slotKey);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const loaded = await owned(upstream, req, companyBranchId);
    await writing(() => upstream.request(`${base(loaded.inspectionId)}/photos/${encodeURIComponent(slotKey)}`, { token: loaded.actor.token, method: "DELETE" }));
    res.json({ id: loaded.inspectionId });
  });

  router.post("/entries/:entryId/inspections/:inspectionId/steps/:stepId/files", photoJson, async (req, res) => {
    const stepId = z.coerce.number().int().positive().parse(req.params.stepId);
    emptySchema.parse(req.query);
    const input = inspectionPhotoInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    if (!list(loaded.detail.checklistSteps).some((row) => positive(asRecord(row).id) === stepId && asRecord(row).isDeleted !== true)) {
      throw new GatewayError(404, "INSPECTION_STEP_NOT_FOUND", "Responde la pregunta antes de agregarle fotos.");
    }
    const saved = asRecord(await writing(() => upstream.request(`/equipment_dispatches/inspections/checklist-steps/${stepId}/files`, { token: loaded.actor.token, method: "POST",
      form: imageForm(loaded.actor, input.image, input.source, {}) })));
    const fileId = positive(list(saved.fileIds)[0]);
    if (fileId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    await refreshStepOf(upstream, loaded, stepId);
    res.json({ id: fileId });
  });

  router.delete("/entries/:entryId/inspections/:inspectionId/step-files/:fileId", async (req, res) => {
    const fileId = z.coerce.number().int().positive().parse(req.params.fileId);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const loaded = await owned(upstream, req, companyBranchId);
    const owner = list(loaded.detail.checklistSteps).map(asRecord).find((row) => list(row.photos).some((photo) => fileOf(photo)?.fileId === fileId));
    const stepId = owner ? positive(owner.id) : null;
    if (stepId === null) throw new GatewayError(404, "INSPECTION_FILE_NOT_FOUND", "La foto ya no está en esta inspección.");
    await writing(() => upstream.request(`/equipment_dispatches/inspections/checklist-steps/files/${fileId}`, { token: loaded.actor.token, method: "DELETE" }));
    await refreshStepOf(upstream, loaded, stepId);
    res.json({ id: fileId });
  });

  router.put("/entries/:entryId/inspections/:inspectionId/damages", async (req, res) => {
    emptySchema.parse(req.query);
    const input = inspectionDamageInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    if (input.id !== null && !list(loaded.detail.damages).some((row) => positive(asRecord(row).id) === input.id && asRecord(row).isDeleted !== true)) {
      throw new GatewayError(404, "INSPECTION_DAMAGE_NOT_FOUND", "El daño ya no está en esta inspección.");
    }
    const saved = asRecord(await writing(() => upstream.request(`${base(loaded.inspectionId)}/damages`, { token: loaded.actor.token, method: "PUT", json: {
      ...(input.id !== null ? { id: input.id } : {}), description: input.description, severity: input.severity, responsibility: input.responsibility,
      location: input.location, isAdditional: input.isAdditional
    } })));
    const damageId = positive(saved.damageId);
    if (damageId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json({ id: damageId });
  });

  router.delete("/entries/:entryId/inspections/:inspectionId/damages/:damageId", async (req, res) => {
    const damageId = z.coerce.number().int().positive().parse(req.params.damageId);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const loaded = await owned(upstream, req, companyBranchId);
    if (!list(loaded.detail.damages).some((row) => positive(asRecord(row).id) === damageId)) throw new GatewayError(404, "INSPECTION_DAMAGE_NOT_FOUND", "El daño ya no está en esta inspección.");
    await writing(() => upstream.request(`${base(loaded.inspectionId)}/damages`, { token: loaded.actor.token, method: "PUT", json: { id: damageId, isDeleted: true } }));
    res.json({ id: damageId });
  });

  router.post("/entries/:entryId/inspections/:inspectionId/damages/:damageId/photos", photoJson, async (req, res) => {
    const damageId = z.coerce.number().int().positive().parse(req.params.damageId);
    emptySchema.parse(req.query);
    const input = inspectionPhotoInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    if (!list(loaded.detail.damages).some((row) => positive(asRecord(row).id) === damageId && asRecord(row).isDeleted !== true)) {
      throw new GatewayError(404, "INSPECTION_DAMAGE_NOT_FOUND", "El daño ya no está en esta inspección.");
    }
    const saved = asRecord(await writing(() => upstream.request(`/equipment_dispatches/inspections/damages/${damageId}/files`, { token: loaded.actor.token, method: "POST",
      form: imageForm(loaded.actor, input.image, input.source, {}) })));
    const fileId = positive(list(saved.fileIds)[0]);
    if (fileId === null) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json({ id: fileId });
  });

  router.put("/entries/:entryId/inspections/:inspectionId/meta", async (req, res) => {
    emptySchema.parse(req.query);
    const input = inspectionMetaInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    await writing(() => upstream.request(`${base(loaded.inspectionId)}/meta`, { token: loaded.actor.token, method: "PUT", json: { observation: input.observation || null } }));
    res.json({ id: loaded.inspectionId });
  });

  router.post("/entries/:entryId/inspections/:inspectionId/complete", async (req, res) => {
    emptySchema.parse(req.query);
    const input = inspectionBranchInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    await writing(() => upstream.request(`${base(loaded.inspectionId)}/complete`, { token: loaded.actor.token, method: "POST", json: {} }));
    res.json({ id: loaded.inspectionId });
  });

  /** Enlace público con la misma dirección de la web: {web de la empresa}/es/patio-preview?inspectionId=…&token=… */
  const shareOf = async (loaded: Loaded & { inspectionId: number }) => {
    const patio = asRecord(await upstream.request(`${base(loaded.inspectionId)}/patio-context`, { token: loaded.actor.token }));
    const token = text(patio.publicLinkToken);
    if (token === null) throw new GatewayError(409, "INSPECTION_SHARE_UNAVAILABLE", "Esta inspección no tiene enlace para compartir. Ábrela desde la web una vez.");
    const remaining = Math.max(0, Math.floor(Number(patio.publicLinkRemainingSeconds) || 0));
    const url = new URL("/es/patio-preview", upstream.webOrigin);
    url.searchParams.set("inspectionId", String(loaded.inspectionId));
    url.searchParams.set("token", token);
    return inspectionShareSchema.parse({ url: url.toString(), expiresAt: isoDate(patio.publicLinkExpiresAt), remainingSeconds: remaining, active: remaining > 0 });
  };
  router.get("/entries/:entryId/inspections/:inspectionId/share", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    res.json(await shareOf(await owned(upstream, req, companyBranchId)));
  });
  router.post("/entries/:entryId/inspections/:inspectionId/share/extend", async (req, res) => {
    emptySchema.parse(req.query);
    const input = inspectionBranchInputSchema.parse(req.body);
    const loaded = await owned(upstream, req, input.companyBranchId);
    await writing(() => upstream.request(`${base(loaded.inspectionId)}/public-link/extend`, { token: loaded.actor.token, method: "PUT", json: {} }));
    res.json(await shareOf(loaded));
  });

  /** Fotos ya subidas en un .zip (lo arma el backend, como "Descargar comprimido" en la web). */
  router.get("/entries/:entryId/inspections/:inspectionId/photos.zip", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const loaded = await owned(upstream, req, companyBranchId);
    if (!list(loaded.detail.photos).some((row) => asRecord(row).isDeleted !== true)) {
      throw new GatewayError(404, "INSPECTION_PHOTOS_EMPTY", "La inspección todavía no tiene fotos para descargar.");
    }
    const { bytes, contentType } = await upstream.download(`/equipment_dispatches/inspections/photos/download/${loaded.inspectionId}`, loaded.actor.token, 150 * 1024 * 1024);
    res.setHeader("Content-Type", contentType.includes("zip") ? "application/zip" : "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="inspeccion-${loaded.entryId}-${loaded.kind === "entry" ? "ingreso" : "entrega"}.zip"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(bytes);
  });
}
