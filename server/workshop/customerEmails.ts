import express, { type Router } from "express";
import { z } from "zod";
import {
  EMAIL_PROVIDERS, EMAIL_PROVIDER_LABEL, emailEligibilitySchema, emailHistorySchema, emailOptionsSchema, emailPreviewInputSchema, emailPreviewSchema,
  emailSendInputSchema, emailSendResultSchema, type EmailProvider
} from "../../src/domain/workshopCustomerEmail";
import { GatewayError } from "../errors";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { asRecord, clip, list, positive, text, workshopActor } from "./support";

const branchQuery = z.object({ companyBranchId: z.coerce.number().int().positive() }).strict();
const entryParams = z.object({ entryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const json = express.json({ limit: 64 * 1024, strict: true, inflate: false });
const providers = new Set<string>(EMAIL_PROVIDERS);

const provider = (value: unknown): EmailProvider | null => typeof value === "string" && providers.has(value) ? value as EmailProvider : null;
const bool = (value: unknown) => value === true;
const texts = (value: unknown, max: number) => list(value).flatMap((item) => { const value = clip(text(item), max); return value === null ? [] : [value]; });
const issues = (value: unknown) => list(value).flatMap((item) => {
  const row = asRecord(item);
  const code = clip(text(row.code), 80);
  const message = clip(text(row.message), 500);
  return code === null || message === null ? [] : [{ code, message }];
});

/** HTML del correo a texto por párrafos: la app muestra la vista previa sin un visor web. */
export function htmlToParagraphs(html: string): string[] {
  const withoutHead = html.replace(/<head[\s\S]*?<\/head>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const marked = withoutHead
    // Etiquetas del diseño (la de arriba y los títulos del resumen) van en su propia línea.
    .replace(/<span class="(?:status-pill|info-label)"[^>]*>([\s\S]*?)<\/span>/gi, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(?:p|div|h[1-6]|li|tr|table)(?:\s[^>]*)?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const decoded = marked
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return decoded.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line !== "").slice(0, 200).map((line) => line.slice(0, 5000));
}

/** Por qué un canal no funcionó, en palabras simples (como en la web). */
function explainNote(detail: string | null, status: "sent" | "failed", used: EmailProvider | null): string | null {
  if (detail === null) return null;
  const names: Record<string, string> = { ...EMAIL_PROVIDER_LABEL, NO_EMAIL_CHANNEL: "ningún canal" };
  const failed = detail.split("|").map((part) => part.trim().split(":")[0]?.trim() ?? "").filter((code) => code !== "").map((code) => names[code] ?? code);
  const reason = /NOT_CONFIGURED|CONFIG_NOT_FOUND|CONFIG_INCOMPLETE/.test(detail) ? "no está configurado en el servidor"
    : /AUTH|CREDENTIAL|INVALID_GRANT|UNAUTHORIZED|401/.test(detail) ? "la cuenta rechazó la conexión"
      : /NO_EMAIL_CHANNEL/.test(detail) ? "no hay ninguna cuenta de correo disponible" : "no respondió";
  const list = failed.join(" y ");
  return status === "sent" && used !== null
    ? `No se pudo usar ${list} (${reason}); se envió por ${EMAIL_PROVIDER_LABEL[used]}.`
    : `No se pudo enviar: ${list} ${reason}.`;
}

/**
 * Correo de confirmación de ingreso al cliente desde la app: si se puede enviar, las plantillas y canales, la vista
 * previa, el envío y el historial (con lectura). El backend hace el envío real; aquí solo se valida y se adapta.
 */
export function registerCustomerEmailRoutes(router: Router, upstream: Upstream): void {
  router.get("/entries/:entryId/emails/eligibility", async (req, res) => {
    const { entryId } = entryParams.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const raw = asRecord(await upstream.request(`/operation_area_entries/${entryId}/emails/confirmation/eligibility`, { token, query: new URLSearchParams({ companyBranchId: String(companyBranchId) }) }));
    const setting = asRecord(raw.setting);
    const template = asRecord(raw.template);
    const sender = asRecord(raw.sender);
    const parsed = emailEligibilitySchema.safeParse({
      mode: ["off", "manual", "automatic"].includes(String(raw.mode)) ? raw.mode : "manual",
      canSend: bool(raw.canSend),
      canAutoSend: bool(raw.canAutoSend),
      shouldPrompt: bool(raw.shouldPrompt),
      alreadySent: bool(raw.alreadySent),
      receptionSigned: bool(raw.receptionSigned),
      isInternalEntry: bool(raw.isInternalEntry),
      includeInternalEntries: bool(setting.includeInternalEntries),
      attachReport: setting.attachReport !== false,
      ccEmails: texts(setting.ccEmails, 320).slice(0, 20),
      issues: issues(raw.issues),
      warnings: issues(raw.warnings),
      recipients: list(raw.recipients).flatMap((item) => {
        const row = asRecord(item);
        const email = clip(text(row.email), 320);
        return email === null ? [] : [{ email, name: clip(text(row.name), 300), contactId: positive(row.contactId) }];
      }).slice(0, 100),
      contactsWithoutEmail: texts(raw.contactsWithoutEmail, 300).slice(0, 100),
      template: positive(template.id) !== null ? { id: positive(template.id), name: clip(text(template.name), 200) ?? "Plantilla" } : null,
      sender: { provider: provider(sender.provider), email: clip(text(sender.email), 320), reason: clip(text(sender.reason), 500) }
    });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.set("Cache-Control", "no-store").json(parsed.data);
  });

  router.get("/emails/options", async (req, res) => {
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const query = new URLSearchParams({ companyBranchId: String(companyBranchId) });
    const [templates, channels] = await Promise.all([
      upstream.request("/email_templates", { token, query: new URLSearchParams({ event: "entry_confirmation", companyBranchId: String(companyBranchId) }) }),
      upstream.request("/email_template_settings/channels", { token, query })
    ]);
    const parsed = emailOptionsSchema.safeParse({
      templates: list(templates).flatMap((item) => {
        const row = asRecord(item);
        const id = positive(row.id);
        if (id === null || row.isEnabled === false || row.availableInBranch === false) return [];
        return [{ id, name: clip(text(row.name), 200) ?? "Plantilla", isDefault: bool(row.isDefault), attachReport: row.attachReport !== false }];
      }).slice(0, 200),
      channels: list(channels).flatMap((item) => {
        const row = asRecord(item);
        const value = provider(row.provider);
        return value === null ? [] : [{ provider: value, available: bool(row.available), email: clip(text(row.email), 320), reason: clip(text(row.reason), 500), howTo: clip(text(row.howTo), 1000) ?? "" }];
      })
    });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.set("Cache-Control", "no-store").json(parsed.data);
  });

  router.post("/entries/:entryId/emails/preview", json, async (req, res) => {
    const { entryId } = entryParams.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = emailPreviewInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const raw = asRecord(await upstream.request(`/operation_area_entries/${entryId}/emails/confirmation/preview`, {
      token, method: "POST", query: new URLSearchParams({ companyBranchId: String(companyBranchId) }), json: { templateId: input.templateId, recipientName: input.recipientName }
    }));
    const parsed = emailPreviewSchema.safeParse({
      subject: clip(text(raw.subject), 500) ?? "",
      paragraphs: htmlToParagraphs(typeof raw.html === "string" ? raw.html : ""),
      missing: texts(raw.missing, 120).slice(0, 100),
      attachmentName: clip(text(raw.attachmentName), 300)
    });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(parsed.data);
  });

  router.post("/entries/:entryId/emails", json, async (req, res) => {
    const { entryId } = entryParams.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    if (!req.is("application/json")) throw new GatewayError(415, "JSON_REQUIRED");
    const input = emailSendInputSchema.parse(req.body);
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const raw = asRecord(await upstream.request(`/operation_area_entries/${entryId}/emails/confirmation`, {
      token, method: "POST", query: new URLSearchParams({ companyBranchId: String(companyBranchId) }),
      json: { templateId: input.templateId, recipients: input.recipients, cc: input.cc, attachReport: input.attachReport, saveNewContacts: input.saveNewContacts, provider: input.provider }
    }));
    const parsed = emailSendResultSchema.safeParse({
      results: list(raw.results).flatMap((item) => {
        const row = asRecord(item);
        const email = clip(text(row.email), 320);
        if (email === null) return [];
        const status = row.status === "sent" ? "sent" : "failed";
        const used = provider(row.provider);
        return [{ email, status, provider: used, senderEmail: clip(text(row.senderEmail), 320), error: explainNote(clip(text(row.error), 4000), status, used) }];
      }).slice(0, 20)
    });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.json(parsed.data);
  });

  router.get("/entries/:entryId/emails", async (req, res) => {
    const { entryId } = entryParams.parse(req.params);
    const { companyBranchId } = branchQuery.parse(req.query);
    emptySchema.parse(req.body ?? {});
    const { token } = await workshopActor(upstream, req, companyBranchId);
    const raw = asRecord(await upstream.request(`/operation_area_entries/${entryId}/emails`, { token, query: new URLSearchParams({ companyBranchId: String(companyBranchId) }) }));
    const summary = asRecord(raw.summary);
    const count = (value: unknown) => { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : 0; };
    const parsed = emailHistorySchema.safeParse({
      items: list(raw.items).flatMap((item) => {
        const row = asRecord(item);
        const id = positive(row.id);
        if (id === null) return [];
        const status = row.status === "failed" ? "failed" : "sent";
        const used = provider(row.provider);
        const opens = list(row.opens);
        const responsible = asRecord(row.responsible);
        return [{
          id,
          date: clip(text(row.date), 60),
          trigger: row.trigger === "automatic" ? "automatic" : row.trigger === "test" ? "test" : "manual",
          status,
          provider: used,
          senderEmail: clip(text(row.senderEmail), 320),
          recipients: texts(row.recipients, 320).slice(0, 50),
          subject: clip(text(row.subject), 500),
          templateName: clip(text(row.templateName), 200),
          responsibleName: clip(text(responsible.name), 300),
          read: bool(row.read),
          readCount: count(row.readCount),
          lastOpenedAt: opens.length > 0 ? clip(text(asRecord(opens[opens.length - 1]).openedAt), 60) : null,
          note: explainNote(clip(text(row.errorDetail), 4000), status, used)
        }];
      }).slice(0, 200),
      summary: { sent: count(summary.sent), failed: count(summary.failed), recipients: count(summary.recipients), read: count(summary.read) },
      trackingReachable: raw.trackingReachable !== false
    });
    if (!parsed.success) throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE");
    res.set("Cache-Control", "no-store").json(parsed.data);
  });
}
