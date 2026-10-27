import { z } from "zod";
import { driveRoute, type DriveScope, type DriveUpload } from "./fileDrive";

/**
 * Comentarios como chat (los mismos de la web) de un ingreso, una OT o un trabajo. Los trabajos tienen dos
 * conversaciones: técnica y general.
 */
export const threadTabSchema = z.enum(["general", "technical"]);
export type ThreadTab = z.infer<typeof threadTabSchema>;
export const THREAD_TAB_LABELS: Record<ThreadTab, string> = { general: "General", technical: "Técnico" };

const link = z.string().max(4000);
export const threadAttachmentSchema = z.object({
  name: z.string().max(500), url: link, thumbnailUrl: link.nullable(), type: z.string().max(200).nullable()
}).strict();
export type ThreadAttachment = z.infer<typeof threadAttachmentSchema>;

export const threadMessageSchema = z.object({
  id: z.string().regex(/^[1-9]\d{0,15}$/),
  authorId: z.number().int().positive().nullable(),
  authorName: z.string().max(300),
  authorAvatar: link.nullable(),
  mine: z.boolean(),
  text: z.string().max(20_000),
  createdAt: z.string().max(60).nullable(),
  editedAt: z.string().max(60).nullable(),
  attachments: z.array(threadAttachmentSchema).max(50)
}).strict();
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

/** Una página de mensajes, del más nuevo al más antiguo. */
export const threadPageSchema = z.object({
  messages: z.array(threadMessageSchema).max(100),
  page: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  total: z.number().int().min(0),
  tab: threadTabSchema.nullable(),
  tabs: z.array(threadTabSchema).max(2),
  // write: la sucursal permite comentar desde la app (sin el dato, pasarela anterior: permitido).
  capabilities: z.object({ attachments: z.boolean(), edit: z.boolean(), write: z.boolean().optional() }).strict()
}).strict();
export type ThreadPage = z.infer<typeof threadPageSchema>;

export const THREAD_TEXT_MAX = 5000;
export const THREAD_ATTACHMENTS_MAX = 5;
export const threadTextSchema = z.string().trim().max(THREAD_TEXT_MAX);
/** Persona que se puede mencionar con @ (la misma lista de la web para la sucursal). */
export const threadPersonSchema = z.object({ id: z.string().regex(/^[1-9]\d{0,15}$/), name: z.string().min(1).max(300), avatar: z.string().max(4000).nullable() }).strict();
export const threadPeopleSchema = z.object({ people: z.array(threadPersonSchema).max(2000) }).strict();
export type ThreadPerson = z.infer<typeof threadPersonSchema>;
/** Mención en un mensaje: el texto lleva «@Nombre» y aquí va a quién corresponde. */
export const threadMentionSchema = z.object({ id: z.string().regex(/^[1-9]\d{0,15}$/), name: z.string().min(1).max(300) }).strict();
export type ThreadMention = z.infer<typeof threadMentionSchema>;
export const threadMentionsSchema = z.array(threadMentionSchema).max(20);
export const threadCreateSchema = z.object({ text: z.string().max(THREAD_TEXT_MAX), mentions: threadMentionsSchema.optional() }).strict();
export const threadEditSchema = z.object({ text: z.string().trim().min(1).max(THREAD_TEXT_MAX), mentions: threadMentionsSchema.optional() }).strict();

/** Estado en vivo: cuántos cambios hubo (para recargar) y quién está escribiendo. Sin conexión en vivo, live es false. */
export const threadLiveSchema = z.object({ live: z.boolean(), version: z.number().int().min(0), typing: z.array(z.string().max(120)).max(5) }).strict();
export type ThreadLive = z.infer<typeof threadLiveSchema>;

/** Las menciones que siguen escritas en el texto (si se borró «@Nombre», ya no se menciona). */
export function threadActiveMentions(text: string, mentions: readonly ThreadMention[]): ThreadMention[] {
  const unique = new Map(mentions.map((mention) => [mention.id, mention]));
  return [...unique.values()].filter((mention) => text.includes(`@${mention.name}`)).slice(0, 20);
}

/** Lo que se está escribiendo después de una «@» al final del texto (para sugerir personas), o null. */
export function threadMentionQuery(text: string): string | null {
  const match = text.match(/(?:^|\s)@([\p{L}\p{N} .'-]{0,40})$/u);
  if (!match) return null;
  const query = match[1]!;
  return query.includes("  ") ? null : query.trimStart();
}

/** De quién es la conversación: mismo origen que el gestor de archivos (ingreso, OT o asignación de Mi jornada). */
export type ThreadScope = DriveScope;

/** Ruta del chat en el intermediario: la del gestor de archivos cambiando «drive» por «threads»/«thread». */
export function threadRoute(scope: ThreadScope): { path: string; query: URLSearchParams } {
  const { path, query } = driveRoute(scope);
  return { path: scope.kind === "assignment" ? path.replace(/\/drive$/, "/thread") : path.replace("/api/workshop/drive/", "/api/workshop/threads/"), query };
}

export interface ThreadApi {
  list(tab: ThreadTab | null, page: number): Promise<ThreadPage>;
  send(tab: ThreadTab | null, text: string, files: DriveUpload[], mentions: ThreadMention[]): Promise<void>;
  edit(tab: ThreadTab | null, messageId: string, text: string, mentions: ThreadMention[]): Promise<void>;
  people(): Promise<ThreadPerson[]>;
  /** Espera (hasta ~25 s) a que haya mensajes nuevos o cambie quién escribe. */
  live(tab: ThreadTab | null, version: number, typingSeen: string[]): Promise<ThreadLive>;
  typing(tab: ThreadTab | null, typing: boolean): Promise<void>;
}

export interface ThreadPort {
  threadList(scope: ThreadScope, tab: ThreadTab | null, page: number): Promise<ThreadPage>;
  threadSend(scope: ThreadScope, tab: ThreadTab | null, text: string, files: DriveUpload[], mentions: ThreadMention[]): Promise<void>;
  threadEdit(scope: ThreadScope, tab: ThreadTab | null, messageId: string, text: string, mentions: ThreadMention[]): Promise<void>;
  threadPeople(scope: ThreadScope): Promise<ThreadPerson[]>;
  threadLive(scope: ThreadScope, tab: ThreadTab | null, version: number, typingSeen: string[]): Promise<ThreadLive>;
  threadTyping(scope: ThreadScope, tab: ThreadTab | null, typing: boolean): Promise<void>;
}

const THREAD_METHODS = ["threadList", "threadSend", "threadEdit", "threadPeople", "threadLive", "threadTyping"] as const;

/** El puerto del servidor con sus métodos ligados, o null si no los tiene todos. */
export function threadPort(port: Partial<ThreadPort> | null | undefined): ThreadPort | null {
  if (!port || THREAD_METHODS.some((name) => typeof port[name] !== "function")) return null;
  return Object.fromEntries(THREAD_METHODS.map((name) => [name, (port[name] as (...args: unknown[]) => unknown).bind(port)])) as unknown as ThreadPort;
}

export function threadApi(port: ThreadPort, scope: ThreadScope): ThreadApi {
  return {
    list: (tab, page) => port.threadList(scope, tab, page),
    send: (tab, text, files, mentions) => port.threadSend(scope, tab, text, files, mentions),
    edit: (tab, messageId, text, mentions) => port.threadEdit(scope, tab, messageId, text, mentions),
    people: () => port.threadPeople(scope),
    live: (tab, version, typingSeen) => port.threadLive(scope, tab, version, typingSeen),
    typing: (tab, typing) => port.threadTyping(scope, tab, typing)
  };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Fecha del servidor (ISO o «dd-mm-aaaa hh:mm», según la sucursal) a fecha local; null si no se reconoce. */
export function threadDate(value: string | null): Date | null {
  if (!value) return null;
  const local = value.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  if (local) {
    const date = new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]), Number(local[4] ?? 0), Number(local[5] ?? 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Separador del chat: «Hoy», «Ayer» o «lun 26 oct». */
export function threadDayLabel(date: Date, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ""}`;
}

/** Texto legible de un comentario: las menciones y etiquetas guardadas por la web («[[{…}]]») quedan como @Nombre o #Código. */
export function threadPlainText(raw: string): string {
  return raw.replace(/\[\[(\{[^\]]{0,2000}\})\]\]/g, (whole, json: string) => {
    try {
      const tag = JSON.parse(json) as { value?: unknown; prefix?: unknown };
      const value = typeof tag.value === "string" ? tag.value : "";
      if (!value) return whole;
      const prefix = typeof tag.prefix === "string" && /^[@#]$/.test(tag.prefix) ? tag.prefix : "@";
      return `${prefix}${value}`;
    } catch { return whole; }
  }).replace(/<br\s*\/?>/gi, "\n").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
