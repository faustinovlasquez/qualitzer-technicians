import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  THREAD_ATTACHMENTS_MAX, THREAD_TEXT_MAX, threadMentionsSchema, threadPageSchema, threadPlainText,
  type ThreadAttachment, type ThreadMention, type ThreadPage, type ThreadPerson, type ThreadTab
} from "../../src/domain/threads";
import { GatewayError } from "../errors";
import { detectDocument, documentFilename, MAX_DOCUMENT_BYTES } from "../files/documents";
import type { Upstream } from "../upstream";

export type ThreadBase = "operation_area_entries/comments" | "negotiations/comments" | "works/comments";

/** De quién son los comentarios (ya autorizado por la ruta): el servidor, el registro y las pestañas que tiene. */
export interface ThreadTarget {
  token: string;
  userId: number;
  userName: string;
  companyBranchId: number;
  base: ThreadBase;
  entityId: number;
  /** Trabajos: conversación técnica y general; el resto tiene una sola. */
  tabs: ThreadTab[];
  /** Módulo para menciones y avisos al crear (OT). */
  module?: string;
}

const PAGE_SIZE = 20;
// Igual que el panel del técnico: el texto viaja escapado para que la web nunca lo interprete como HTML.
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : null;
const url = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  try { const parsed = new URL(value); return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password ? parsed.href.slice(0, 4000) : null; }
  catch { return null; }
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const positive = (value: unknown) => { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; };
const dateText = (value: unknown) => typeof value === "string" ? value.slice(0, 60) : value instanceof Date ? value.toISOString() : null;

function tabQuery(target: ThreadTarget, tab: ThreadTab | null): Record<string, string> {
  if (target.base === "works/comments") return tab === "technical" ? { isTechnical: "true" } : {};
  if (target.base === "negotiations/comments") return { isCommercial: "false" };
  return {};
}

/** Sala en vivo del backend para esta conversación (la misma que usa la web). */
export function threadRoomKey(target: ThreadTarget, tab: ThreadTab | null, tenantOrigin: string): string {
  const scope = target.base === "operation_area_entries/comments" ? "comments:operations_areas:entry"
    : target.base === "negotiations/comments" ? "comments:negotiations:general"
      : tab === "technical" ? "comments:works:technical" : "comments:works:general";
  return `${tenantOrigin}:${scope}:${target.entityId}`;
}

const PEOPLE_TTL_MS = 5 * 60_000;

export class ThreadService {
  private readonly peopleCache = new Map<string, { at: number; people: ThreadPerson[] }>();

  constructor(private readonly upstream: Upstream) {}

  /** Personas de la sucursal que se pueden mencionar (la lista de la web), guardada unos minutos. */
  async people(target: ThreadTarget): Promise<ThreadPerson[]> {
    const key = `${target.companyBranchId}:${target.userId}`;
    const cached = this.peopleCache.get(key);
    if (cached && Date.now() - cached.at < PEOPLE_TTL_MS) return cached.people;
    const raw = await this.upstream.request("/users/comment/whitelist", { token: target.token, query: new URLSearchParams({ companyBranchId: String(target.companyBranchId) }) });
    const people = rows(raw).slice(0, 2000).flatMap((item) => {
      const row = record(item);
      const id = positive(row.id);
      const name = text(row.value ?? row.name, 300)?.replace(/\s+/g, " ").trim();
      return id === null || !name ? [] : [{ id: String(id), name, avatar: url(row.avatarThumbnail) }];
    }).sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (this.peopleCache.size > 200) this.peopleCache.clear();
    this.peopleCache.set(key, { at: Date.now(), people });
    return people;
  }

  /**
   * Texto para el backend: escapado como el panel, con cada «@Nombre» de una persona real convertido al formato de
   * la web («[[{…}]]») y su etiqueta, para que se guarde la mención y le llegue el aviso.
   */
  private async compose(target: ThreadTarget, comment: string, mentions: ThreadMention[]): Promise<{ comment: string; tags: string[] }> {
    let body = escapeHtml(comment);
    if (mentions.length === 0) return { comment: body, tags: [] };
    const people = new Map((await this.people(target)).map((person) => [person.id, person]));
    const tags: string[] = [];
    for (const mention of mentions) {
      const person = people.get(mention.id);
      if (!person || tags.length >= 20) continue;
      const written = escapeHtml(`@${mention.name}`);
      const index = body.indexOf(written);
      if (index < 0) continue;
      const tag = JSON.stringify({ id: person.id, value: person.name, prefix: "@" });
      body = `${body.slice(0, index)}[[${tag}]]${body.slice(index + written.length)}`;
      tags.push(tag);
    }
    return { comment: body, tags };
  }

  tab(target: ThreadTarget, requested: ThreadTab | null): ThreadTab | null {
    if (target.tabs.length === 0) return null;
    if (requested !== null && !target.tabs.includes(requested)) throw new GatewayError(400, "THREAD_TAB_INVALID");
    return requested ?? target.tabs[0]!;
  }

  async list(target: ThreadTarget, tab: ThreadTab | null, page: number, write = true): Promise<ThreadPage> {
    const raw = record(await this.upstream.request(`/${target.base}/${target.entityId}`, { token: target.token, query: new URLSearchParams({
      ...tabQuery(target, tab), companyBranchId: String(target.companyBranchId),
      filters: JSON.stringify({ companyBranchId: target.companyBranchId }), pagination: JSON.stringify({ page, limit: PAGE_SIZE })
    }) }));
    const total = Math.max(0, Math.trunc(Number(raw.total ?? raw.totalRows ?? 0)) || 0);
    const messages = rows(raw.data).slice(0, 100).flatMap((item) => {
      const row = record(item);
      const id = positive(row.id);
      if (id === null) return [];
      const user = record(row.user);
      const authorId = positive(row.userId);
      const attachments: ThreadAttachment[] = [
        ...rows(row.images).flatMap((image) => {
          const value = record(image);
          const original = url(value.originalUrl);
          return original ? [{ name: "Foto", url: original, thumbnailUrl: url(value.thumbnailUrl), type: "image/jpeg" }] : [];
        }),
        ...rows(row.files).flatMap((file) => {
          const value = record(file);
          const link = url(value.url ?? value.originalUrl);
          return link ? [{ name: text(value.name, 500) ?? "Archivo", url: link, thumbnailUrl: url(value.thumbnailUrl), type: text(value.type, 200) }] : [];
        })
      ].slice(0, 50);
      return [{
        id: String(id), authorId, authorName: text(user.name, 300)?.trim() || "Usuario", authorAvatar: url(user.avatar),
        mine: authorId !== null && authorId === target.userId,
        text: threadPlainText(text(row.comment, 20_000) ?? "").slice(0, 20_000),
        createdAt: dateText(row.createdAt), editedAt: dateText(row.editedAt), attachments
      }];
    });
    return threadPageSchema.parse({
      messages, page, totalPages: Math.ceil(total / PAGE_SIZE), total, tab, tabs: target.tabs,
      capabilities: { attachments: write, edit: write, write }
    });
  }

  async create(target: ThreadTarget, tab: ThreadTab | null, comment: string, files: Express.Multer.File[], mentions: ThreadMention[] = []): Promise<void> {
    const composed = await this.compose(target, comment, mentions);
    const form = new FormData();
    form.set("comment", composed.comment);
    form.set("companyBranchId", String(target.companyBranchId));
    composed.tags.forEach((tag, index) => form.set(`tags[${index}]`, tag));
    for (const file of files) {
      const type = detectDocument(file.buffer, file.originalname);
      form.append("attachments", new Blob([new Uint8Array(file.buffer)], { type: type.mime }), documentFilename(file.originalname, type.extension));
    }
    await this.upstream.request(`/${target.base}/${target.entityId}`, { method: "POST", token: target.token, form, query: new URLSearchParams({
      ...tabQuery(target, tab), ...(target.module ? { module: target.module } : {})
    }) });
  }

  /** Solo se edita un comentario propio de esta conversación (el servidor también exige que sea del autor). */
  async edit(target: ThreadTarget, tab: ThreadTab | null, messageId: string, comment: string, mentions: ThreadMention[] = []): Promise<void> {
    let found = false;
    for (let page = 0; page < 25 && !found; page++) {
      const result = await this.list(target, tab, page);
      const message = result.messages.find((item) => item.id === messageId);
      if (message) {
        if (!message.mine) throw new GatewayError(403, "COMMENT_EDIT_NOT_ALLOWED", "Solo puedes editar tus propios comentarios.");
        found = true;
      }
      if (page + 1 >= result.totalPages) break;
    }
    if (!found) throw new GatewayError(404, "COMMENT_NOT_FOUND", "Ese comentario ya no está en esta conversación.");
    const composed = await this.compose(target, comment, mentions);
    await this.upstream.request(`/comments/${Number(messageId)}`, { method: "PUT", token: target.token, json: {
      comment: composed.comment, tags: composed.tags, companyBranchId: target.companyBranchId,
      moduleName: target.base === "operation_area_entries/comments" ? "operation_area_entries" : target.base === "works/comments" ? "works" : target.module ?? "negotiations",
      childrenId: target.entityId
    } });
  }
}

/** Comentario nuevo: el texto (campo `text`) y hasta 5 archivos (campo `files`), cada uno verificado como en el resto de la app. */
export async function readThreadForm(req: Request, res: Response): Promise<{ text: string; files: Express.Multer.File[]; mentions: ThreadMention[] }> {
  if (!req.is("multipart/form-data")) {
    const body = z.object({ text: z.string().max(THREAD_TEXT_MAX), mentions: threadMentionsSchema.optional() }).strict().parse(req.body);
    return { text: body.text.trim(), files: [], mentions: body.mentions ?? [] };
  }
  if (Number(req.headers["content-length"] ?? 0) > THREAD_ATTACHMENTS_MAX * MAX_DOCUMENT_BYTES + 65536) throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: THREAD_ATTACHMENTS_MAX, fileSize: MAX_DOCUMENT_BYTES + 1, fields: 2, fieldSize: THREAD_TEXT_MAX * 4, parts: THREAD_ATTACHMENTS_MAX + 2, headerPairs: 50 } })
    .fields([{ name: "files", maxCount: THREAD_ATTACHMENTS_MAX }]);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new GatewayError(408, "UPLOAD_TIMEOUT")); req.destroy(); }, 120_000);
      timeout.unref();
      upload(req, res, (error?: unknown) => { clearTimeout(timeout); if (error) reject(error); else resolve(); });
    });
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") throw new GatewayError(413, "DOCUMENT_TOO_LARGE");
    throw new GatewayError(400, "INVALID_COMMENT_MULTIPART", "Envía el texto y hasta 5 archivos de 25 MB.");
  }
  const body = z.object({ text: z.string().max(THREAD_TEXT_MAX).optional(), mentions: z.string().max(20_000).optional() }).strict().parse(req.body ?? {});
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.files ?? [];
  for (const file of files) {
    const type = detectDocument(file.buffer, file.originalname);
    file.originalname = documentFilename(file.originalname, type.extension);
    file.mimetype = type.mime;
  }
  let mentions: ThreadMention[] = [];
  if (body.mentions) {
    try { mentions = threadMentionsSchema.parse(JSON.parse(body.mentions)); }
    catch { throw new GatewayError(400, "INVALID_MENTIONS"); }
  }
  return { text: (body.text ?? "").trim(), files, mentions };
}

export function releaseThreadForm(req: Request): void {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.files;
  if (files) for (const file of files) file.buffer = Buffer.alloc(0);
}
