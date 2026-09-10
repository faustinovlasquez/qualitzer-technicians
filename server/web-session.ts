import type { CookieOptions, Request, Response } from "express";
import type { LoginResult, Tenant } from "../src/domain/models";
import { GatewayError } from "./errors";
import type { IssuedSession } from "./sessions";

export const WEB_SESSION_HEADER = "X-Qualitzer-Session";
export const WEB_SESSION_COOKIE = "qz_mobile_session";
export const WEB_SESSION_TOKEN = "cookie-session";
export const WEB_SESSION_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

export interface WebSessionOptions {
  readonly webOrigins: readonly string[];
  readonly secureCookies: boolean;
}

export function assertWebSessionTransport(req: Request, options?: WebSessionOptions): boolean {
  const transport = req.headers[WEB_SESSION_HEADER.toLowerCase()];
  if (transport === undefined) return false;
  if (transport !== "cookie") throw new GatewayError(400, "INVALID_SESSION_TRANSPORT");
  const origin = req.headers.origin;
  if (!origin || !options?.webOrigins.includes(origin)) throw new GatewayError(403, "ORIGIN_FORBIDDEN");
  return true;
}

export function readWebSessionToken(req: Request): string {
  let token: string | undefined;
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    const name = (separator < 0 ? part : part.slice(0, separator)).trim();
    if (name !== WEB_SESSION_COOKIE) continue;
    const value = separator < 0 ? "" : part.slice(separator + 1).trim();
    if (token !== undefined || !/^qzm_[A-Za-z0-9_-]{43}$/.test(value)) throw new GatewayError(401, "UNAUTHORIZED");
    token = value;
  }
  if (!token) throw new GatewayError(401, "UNAUTHORIZED");
  return token;
}

function cookieOptions(req: Request, options?: WebSessionOptions): CookieOptions {
  return { httpOnly: true, path: "/api", secure: (options?.secureCookies ?? false) || req.secure, sameSite: options?.secureCookies ? "none" : "lax" };
}

export function clearWebSessionCookie(req: Request, res: Response, options?: WebSessionOptions): void {
  res.clearCookie(WEB_SESSION_COOKIE, cookieOptions(req, options));
}

export function respondLogin(req: Request, res: Response, result: LoginResult, issued: IssuedSession, tenant: Tenant, options?: WebSessionOptions): void {
  const webSession = assertWebSessionTransport(req, options);
  if (webSession) {
    const maxAge = Math.min(issued.expiresAt - Date.now(), WEB_SESSION_MAX_AGE_MS);
    if (!(maxAge > 0)) throw new GatewayError(401, "UNAUTHORIZED");
    res.cookie(WEB_SESSION_COOKIE, issued.token, { ...cookieOptions(req, options), maxAge });
  }
  res.set("Cache-Control", "no-store");
  res.json({ ...result, token: webSession ? WEB_SESSION_TOKEN : issued.token, tenant });
}