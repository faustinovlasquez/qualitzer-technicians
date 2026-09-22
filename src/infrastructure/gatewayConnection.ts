import { NetworkError, errorText } from "./errors";
import { canonicalGatewayUrl, loopbackHost, privateHost, standaloneGatewayUrl } from "../../config/gatewayPolicy";

export function validGatewayUrl(value: string): string {
  try { return canonicalGatewayUrl(value); }
  catch (error) {
    if (error instanceof Error && error.message === "GATEWAY_PUBLIC_HTTPS_REQUIRED") throw new Error("Una pasarela pública debe usar HTTPS para proteger tus credenciales.");
    throw new Error("Ingresa la URL base completa de la pasarela, incluida su ruta /mobile, sin credenciales, parámetros ni segmentos ambiguos.");
  }
}

export interface GatewayConfiguration {
  readonly locked: boolean;
  readonly url: string;
  readonly error: string | null;
}

export function resolveGatewayConfiguration(input: {
  standaloneFlag?: string;
  configuredUrl?: string;
  extra?: unknown;
  nativeRelease: boolean;
  developmentUrl: () => string;
}): GatewayConfiguration {
  const extra = input.extra;
  const extraStandalone = extra !== null && typeof extra === "object" && "standalone" in extra && extra.standalone === true;
  const extraUrl = extra !== null && typeof extra === "object" && "url" in extra && typeof extra.url === "string" ? extra.url : undefined;
  const locked = input.nativeRelease || input.standaloneFlag === "true" || extraStandalone;
  if (!locked && (input.standaloneFlag === undefined || input.standaloneFlag === "false")) {
    return { locked: false, url: input.configuredUrl || extraUrl || input.developmentUrl(), error: null };
  }
  try {
    if (input.standaloneFlag !== undefined && !["true", "false"].includes(input.standaloneFlag)) throw new Error();
    if (extraStandalone && input.standaloneFlag === "false") throw new Error();
    const url = standaloneGatewayUrl(extraUrl ?? input.configuredUrl ?? "");
    if (input.configuredUrl !== undefined && standaloneGatewayUrl(input.configuredUrl) !== url) throw new Error();
    return { locked: true, url, error: null };
  } catch {
    return { locked: true, url: "", error: "La configuración de esta versión es inválida. Requiere una base HTTPS pública fija y coincidente; no se usará una conexión local. Solicita una compilación corregida al administrador." };
  }
}

export function requireConfiguredGateway(configuration: GatewayConfiguration, value: string): string {
  if (configuration.error) throw new Error(configuration.error);
  const url = validGatewayUrl(value);
  if (configuration.locked && url !== configuration.url) throw new Error("Esta versión solo permite la URL base HTTPS fijada al compilar.");
  return url;
}

export function storedGatewayMismatch(configuration: GatewayConfiguration, storedUrl: string): string | null {
  if (!configuration.locked || (!configuration.error && safeGatewayUrl(storedUrl) === configuration.url)) return null;
  return "La sesión guardada pertenece a otra URL base. Se conservan la sesión, sus archivos y la cola sin enviarlos ni migrarlos. Para recuperarlos, instala una versión configurada para el servidor original; esta versión no permite cambiar la conexión.";
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
  if (!base) return { status: "invalid_url", message: "La URL de la pasarela no es válida. Usa la base completa, incluida su ruta de montaje, sin credenciales, parámetros ni segmentos ambiguos." };
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
    if (!response.ok) return { status: "http_error", message: `El servidor respondió con un error HTTP en ${base}/health. No se pudo confirmar el despliegue de la pasarela en esta base.` };
    const unexpected: GatewayProbeResult = { status: "unexpected_response", message: `El servidor no devolvió el estado JSON esperado en ${base}/health. Revisa la base completa y su despliegue; no se verificaron credenciales.` };
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