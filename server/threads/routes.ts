import { createHash } from "node:crypto";
import type { Request, RequestHandler, Router } from "express";
import { z } from "zod";
import { threadEditSchema, threadLiveSchema, threadPeopleSchema, threadTabSchema } from "../../src/domain/threads";
import { bearer } from "../auth";
import { GatewayError } from "../errors";
import { realtimeHub } from "../realtime/hub";
import type { Upstream } from "../upstream";
import { emptySchema } from "../validation";
import { assertAppPermission, mobileAppConfig } from "../workshop/support";
import { readThreadForm, releaseThreadForm, threadRoomKey, ThreadService, type ThreadTarget } from "./service";

/** Quien sabe autorizar el registro con el resto de la consulta (sucursal o rango de la asignación). */
export type ThreadResolver = (req: Request, query: Record<string, unknown>) => Promise<ThreadTarget>;

const THREAD_KEYS = ["tab", "page", "version", "typing"] as const;
const threadQuery = z.object({
  tab: threadTabSchema.optional(),
  page: z.coerce.number().int().min(0).max(1000).optional().default(0),
  version: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().default(0),
  typing: z.string().max(700).optional().default("")
}).strict();
const LIVE_WAIT_MS = 25_000;
const LIVE_AUTH_TTL_MS = 3 * 60_000;

function split(req: Request) {
  const own: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.query)) (THREAD_KEYS as readonly string[]).includes(key) ? own[key] = value : rest[key] = value;
  return { query: threadQuery.parse(own), rest };
}

/**
 * Comentarios genéricos (chat) montados bajo `prefix`: listar por página y pestaña, comentar con texto, adjuntos y
 * menciones, editar un comentario propio, personas para mencionar, y el estado en vivo (mensajes nuevos y quién escribe).
 */
export function registerThreadRoutes(router: Router, upstream: Upstream, prefix: string, resolve: ThreadResolver, uploadLimiter?: RequestHandler): void {
  const service = new ThreadService(upstream);
  let sending = 0;
  // Las consultas en vivo se repiten cada pocos segundos: la autorización se recuerda un rato por sesión y conversación.
  const authorized = new Map<string, { at: number; target: ThreadTarget }>();
  async function liveTarget(req: Request, rest: Record<string, unknown>): Promise<ThreadTarget> {
    const base = req.path.replace(/\/(?:live|typing)$/, "");
    const key = createHash("sha256").update(JSON.stringify([bearer(req), base, rest])).digest("hex");
    const cached = authorized.get(key);
    if (cached && Date.now() - cached.at < LIVE_AUTH_TTL_MS) return cached.target;
    const target = await resolve(req, rest);
    if (authorized.size > 1000) authorized.clear();
    authorized.set(key, { at: Date.now(), target });
    return target;
  }

  router.get(prefix, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { query, rest } = split(req);
    const target = await resolve(req, rest);
    // La sucursal puede dejar los comentarios solo para leer desde la app (configuración «Permisos de la app móvil»).
    const write = (await mobileAppConfig(upstream, target.token, target.companyBranchId)).commentsWrite;
    res.set("Cache-Control", "no-store").json(await service.list(target, service.tab(target, query.tab ?? null), query.page, write));
  });
  const assertWrite = (target: ThreadTarget) => assertAppPermission(upstream, target.token, target.companyBranchId, "commentsWrite");

  const create: RequestHandler = async (req, res) => {
    const { query, rest } = split(req);
    if (sending >= 4) throw new GatewayError(429, "UPLOAD_BUSY");
    sending += 1;
    try {
      const target = await resolve(req, rest);
      const tab = service.tab(target, query.tab ?? null);
      await assertWrite(target);
      const { text, files, mentions } = await readThreadForm(req, res);
      if (!text && files.length === 0) throw new GatewayError(400, "COMMENT_REQUIRED", "Escribe un mensaje o adjunta un archivo.");
      await service.create(target, tab, text, files, mentions);
      res.status(201).json({ success: true });
    } finally { releaseThreadForm(req); sending -= 1; }
  };
  if (uploadLimiter) router.post(prefix, uploadLimiter, create); else router.post(prefix, create);

  router.patch(`${prefix}/messages/:messageId`, async (req, res) => {
    const { query, rest } = split(req);
    const messageId = z.string().regex(/^[1-9]\d{0,15}$/).parse(req.params.messageId);
    const { text, mentions } = threadEditSchema.parse(req.body);
    const target = await resolve(req, rest);
    await assertWrite(target);
    await service.edit(target, service.tab(target, query.tab ?? null), messageId, text, mentions ?? []);
    res.json({ success: true });
  });

  router.get(`${prefix}/people`, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { rest } = split(req);
    const target = await resolve(req, rest);
    res.set("Cache-Control", "no-store").json(threadPeopleSchema.parse({ people: await service.people(target) }));
  });

  router.get(`${prefix}/live`, async (req, res) => {
    emptySchema.parse(req.body ?? {});
    const { query, rest } = split(req);
    const target = await liveTarget(req, rest);
    const tab = service.tab(target, query.tab ?? null);
    const state = await realtimeHub.wait(upstream.backendOrigin, upstream.webOrigin, threadRoomKey(target, tab, upstream.webOrigin),
      { userId: target.userId, name: target.userName }, query.version, query.typing, LIVE_WAIT_MS);
    res.set("Cache-Control", "no-store").json(threadLiveSchema.parse(state));
  });

  router.post(`${prefix}/typing`, async (req, res) => {
    const { query, rest } = split(req);
    const { typing } = z.object({ typing: z.boolean() }).strict().parse(req.body);
    const target = await liveTarget(req, rest);
    const tab = service.tab(target, query.tab ?? null);
    const sent = await realtimeHub.typing(upstream.backendOrigin, upstream.webOrigin, threadRoomKey(target, tab, upstream.webOrigin), { userId: target.userId, name: target.userName }, typing);
    res.json({ live: sent });
  });
}
