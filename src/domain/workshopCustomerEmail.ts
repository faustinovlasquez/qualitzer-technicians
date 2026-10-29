import { z } from "zod";

/** Correo de confirmación de ingreso al cliente (igual que en la web): canales, plantillas, envío e historial. */
export const EMAIL_PROVIDERS = ["GOOGLE_OAUTH", "USER_SMTP", "OFFICE365", "SMTP"] as const;
export type EmailProvider = typeof EMAIL_PROVIDERS[number];

export const EMAIL_PROVIDER_LABEL: Record<EmailProvider, string> = {
  GOOGLE_OAUTH: "Gmail con Google",
  USER_SMTP: "SMTP (tu correo)",
  OFFICE365: "Microsoft 365",
  SMTP: "Cuenta del sistema"
};

const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const email = z.string().trim().toLowerCase().max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Correo no válido");

export const emailIssueSchema = z.object({ code: text(80), message: text(500) });

export const emailRecipientSchema = z.object({
  email,
  name: nullableText(300),
  contactId: z.number().int().positive().nullable()
});
export type EmailRecipient = z.infer<typeof emailRecipientSchema>;

export const emailEligibilitySchema = z.object({
  mode: z.enum(["off", "manual", "automatic"]),
  canSend: z.boolean(),
  canAutoSend: z.boolean(),
  shouldPrompt: z.boolean(),
  alreadySent: z.boolean(),
  receptionSigned: z.boolean(),
  isInternalEntry: z.boolean(),
  includeInternalEntries: z.boolean(),
  attachReport: z.boolean(),
  ccEmails: z.array(text(320)).max(20),
  issues: z.array(emailIssueSchema).max(20),
  warnings: z.array(emailIssueSchema).max(20),
  recipients: z.array(emailRecipientSchema).max(100),
  contactsWithoutEmail: z.array(text(300)).max(100),
  template: z.object({ id: z.number().int().positive(), name: text(200) }).nullable(),
  sender: z.object({ provider: z.enum(EMAIL_PROVIDERS).nullable(), email: nullableText(320), reason: nullableText(500) })
});
export type EmailEligibility = z.infer<typeof emailEligibilitySchema>;

export const emailOptionsSchema = z.object({
  templates: z.array(z.object({ id: z.number().int().positive(), name: text(200), isDefault: z.boolean(), attachReport: z.boolean() })).max(200),
  channels: z.array(z.object({
    provider: z.enum(EMAIL_PROVIDERS), available: z.boolean(), email: nullableText(320), reason: nullableText(500), howTo: text(1000)
  })).max(10)
});
export type EmailOptions = z.infer<typeof emailOptionsSchema>;

export const emailPreviewInputSchema = z.object({
  templateId: z.number().int().positive().nullable(),
  recipientName: nullableText(300)
}).strict();

/** Vista previa en texto (la app no muestra HTML): asunto, párrafos del mensaje y resumen del ingreso. */
export const emailPreviewSchema = z.object({
  subject: text(500),
  paragraphs: z.array(text(5000)).max(200),
  missing: z.array(text(120)).max(100),
  attachmentName: nullableText(300)
});
export type EmailPreview = z.infer<typeof emailPreviewSchema>;

export const emailSendInputSchema = z.object({
  templateId: z.number().int().positive().nullable(),
  recipients: z.array(emailRecipientSchema).min(1, "Elige al menos un destinatario.").max(20),
  cc: z.array(email).max(20),
  attachReport: z.boolean(),
  saveNewContacts: z.boolean(),
  provider: z.enum(EMAIL_PROVIDERS).nullable()
}).strict();
export type EmailSendInput = z.infer<typeof emailSendInputSchema>;

export const emailSendResultSchema = z.object({
  results: z.array(z.object({
    email: text(320), status: z.enum(["sent", "failed"]), provider: z.enum(EMAIL_PROVIDERS).nullable(), senderEmail: nullableText(320), error: nullableText(4000)
  })).max(20)
});
export type EmailSendResult = z.infer<typeof emailSendResultSchema>;

export const emailHistorySchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    date: nullableText(60),
    trigger: z.enum(["manual", "automatic", "test"]),
    status: z.enum(["sent", "failed"]),
    provider: z.enum(EMAIL_PROVIDERS).nullable(),
    senderEmail: nullableText(320),
    recipients: z.array(text(320)).max(50),
    subject: nullableText(500),
    templateName: nullableText(200),
    responsibleName: nullableText(300),
    read: z.boolean(),
    readCount: z.number().int().min(0),
    lastOpenedAt: nullableText(60),
    /** Explicación simple si un canal falló (el detalle técnico queda en la web). */
    note: nullableText(600)
  })).max(200),
  summary: z.object({ sent: z.number().int().min(0), failed: z.number().int().min(0), recipients: z.number().int().min(0), read: z.number().int().min(0) }),
  trackingReachable: z.boolean()
});
export type EmailHistory = z.infer<typeof emailHistorySchema>;
export type EmailHistoryItem = EmailHistory["items"][number];

/** Estado corto para la ficha del ingreso. */
export function emailStatusLabel(summary: EmailHistory["summary"]): { label: string; tone: "success" | "danger" | "warning" } {
  if (summary.sent > 0) return { label: `Enviado a ${summary.recipients} · leído por ${summary.read}`, tone: "success" };
  if (summary.failed > 0) return { label: "El envío falló", tone: "danger" };
  return { label: "Aún no enviado", tone: "warning" };
}

/** Lo que la app necesita del servidor para el correo de confirmación de ingreso. */
export interface WorkshopCustomerEmailPort {
  workshopEmailEligibility(branchId: number, entryId: number): Promise<EmailEligibility>;
  workshopEmailOptions(branchId: number): Promise<EmailOptions>;
  workshopEmailPreview(branchId: number, entryId: number, input: z.infer<typeof emailPreviewInputSchema>): Promise<EmailPreview>;
  sendWorkshopEmail(branchId: number, entryId: number, input: EmailSendInput): Promise<EmailSendResult>;
  workshopEmailHistory(branchId: number, entryId: number): Promise<EmailHistory>;
}
