import { NetworkError, errorText } from "./errors";

function privateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (/^(fc|fd)[\da-f]{2}:/i.test(host) || /^fe[89ab][\da-f]:/i.test(host)) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

function loopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "localhost." || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

export function validGatewayUrl(value: string): string {
  const invalid = "Ingresa la URL base de la pasarela, por ejemplo http://192.168.1.105:8787.";
  if (/[\u0000-\u001f\u007f\\?#]/.test(value)) throw new Error(invalid);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(invalid); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !["", "/"].includes(url.pathname)) throw new Error(invalid);
  if (url.protocol === "http:" && !loopbackHost(url.hostname) && !privateHost(url.hostname)) throw new Error("Una pasarela pública debe usar HTTPS para proteger tus credenciales.");
  return url.origin;
}

export function safeGatewayUrl(value: string): string | undefined {
  try { return validGatewayUrl(value); } catch { return undefined; }
}

export function gatewayLoopbackWarning(value: string): string | null {
  const url = safeGatewayUrl(value);
  return url && loopbackHost(new URL(url).hostname)
    ? "Esta dirección apunta al propio teléfono, no al equipo donde corre la pasarela. Usa la IP local del equipo o la dirección indicada por tu administrador."
    : null;
}

export function expoGatewayUrl(hostUri: string | null | undefined): string | undefined {
  if (!hostUri || /[\s\\?#]/.test(hostUri)) return undefined;
  try {
    const url = new URL(hostUri.includes("://") ? hostUri : `http://${hostUri}`);
    if (!["http:", "exp:"].includes(url.protocol) || url.username || url.password || url.pathname && url.pathname !== "/" || !privateHost(url.hostname)) return undefined;
    return validGatewayUrl(`http://${url.hostname}:8787`);
  } catch { return undefined; }
}

export function suggestedExpoGatewayUrl(hostUri: string | null | undefined, current: string): string | undefined {
  const suggested = expoGatewayUrl(hostUri);
  return suggested && suggested !== safeGatewayUrl(current) ? suggested : undefined;
}

export function loginConnectionError(error: unknown, gatewayUrl: string): string {
  if (!(error instanceof NetworkError)) return errorText(error);
  const base = safeGatewayUrl(gatewayUrl);
  return `${error.kind === "timeout" ? "La conexión tardó demasiado" : "No se pudo conectar"} con ${base ?? "la pasarela configurada"}. Comprueba la conexión con esta dirección; este error no indica que tu contraseña haya sido rechazada.`;
}

export type GatewayProbeStatus = "ready" | "backend_unavailable" | "invalid_url" | "http_error" | "unexpected_response" | "network" | "timeout";
export interface GatewayProbeResult { status: GatewayProbeStatus; message: string; }
export type GatewayProbeFetch = (url: string, init: {
  method: "GET";
  credentials: "omit";
  redirect: "error";
  headers: { Accept: string };
  signal: AbortSignal;
}) => Promise<{ ok: boolean; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

export async function probeGatewayConnection(value: string, fetch: GatewayProbeFetch, timeoutMs = 5000): Promise<GatewayProbeResult> {
  const base = safeGatewayUrl(value);
  if (!base) return { status: "invalid_url", message: "La URL de la pasarela no es válida. Usa una URL base sin credenciales, rutas ni parámetros." };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<GatewayProbeResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: "timeout", message: `La comprobación de ${base} tardó demasiado. Revisa la dirección y la red del dispositivo.` });
      controller.abort();
    }, timeoutMs);
  });
  async function check(): Promise<GatewayProbeResult> {
    let response: Awaited<ReturnType<GatewayProbeFetch>>;
    try {
      response = await fetch(`${base}/health`, { method: "GET", credentials: "omit", redirect: "error", headers: { Accept: "application/json" }, signal: controller.signal });
    } catch {
      return { status: "network", message: `No se pudo conectar con ${base}. Revisa la red y la dirección; en web también puede ser un bloqueo CORS. No se enviaron credenciales.` };
    }
    if (!response.ok) return { status: "http_error", message: "El servidor respondió con un error HTTP. No se pudo confirmar el estado de la pasarela." };
    const unexpected: GatewayProbeResult = { status: "unexpected_response", message: "El servidor no devolvió el estado JSON esperado de la pasarela. Revisa la dirección; no se verificaron credenciales." };
    if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return unexpected;
    let body: unknown;
    try { body = await response.json(); } catch { return unexpected; }
    if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true || !("backendReachable" in body) || typeof body.backendReachable !== "boolean") return unexpected;
    return body.backendReachable
      ? { status: "ready", message: "Pasarela accesible y backend disponible. Esta comprobación no valida tu usuario ni contraseña." }
      : { status: "backend_unavailable", message: "La pasarela responde, pero no puede conectar con el backend de Qualitzer. Revisa el backend con tu administrador." };
  }
  try { return await Promise.race([timeout, check()]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}