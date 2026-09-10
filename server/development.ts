/// <reference path="../types/qrcode.d.ts" />
import { isIP } from "node:net";
import os from "node:os";
import { Router } from "express";
import { emptySchema } from "./validation";

export interface DevelopmentRouterOptions {
  enabled: boolean;
  metroPort: number;
  gatewayPort: number;
  preferredHost?: string;
}

export interface DevelopmentConnection {
  expoUrl: string;
  gatewayUrl: string;
  qrDataUrl: string;
  metroReachable?: boolean;
  lanAvailable?: boolean;
  message?: string;
}

const cacheDuration = 30_000;
const excludedInterface = /vpn|tailscale|zerotier|wireguard|hamachi|(?:^|[\s_-])(?:tun|tap|utun|ppp)\d*|docker|veth|vmnet|virtual|wsl|hyper-v|bridge|^br\d*$|loopback/i;

function privateIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function interfacePriority(name: string): number {
  if (/wi[\s-]?fi|wlan|^wl/i.test(name)) return 0;
  if (/^en\d|^en[opsx]|ethernet/i.test(name)) return 1;
  return 2;
}

export function selectDevelopmentHost(interfaces: ReturnType<typeof os.networkInterfaces>, preferredHost?: string): string {
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !excludedInterface.test(name))
    .sort(([left], [right]) => interfacePriority(left) - interfacePriority(right))
    .flatMap(([, entries]) => (entries ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal && privateIpv4(entry.address)));
  if (preferredHost !== undefined && privateIpv4(preferredHost) && candidates.some((entry) => entry.address === preferredHost)) return preferredHost;
  return candidates[0]?.address ?? "localhost";
}

async function metroIsReachable(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Accept: "text/plain" }, signal: controller.signal, redirect: "error", credentials: "omit",
    });
    return response.ok && (await response.text()).trim() === "packager-status:running";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function createConnection(host: string, metroPort: number, gatewayPort: number): Promise<DevelopmentConnection> {
  const { default: qrCode } = await import("qrcode");
  const expoUrl = `exp://${host}:${metroPort}`;
  const [qrDataUrl, metroReachable] = await Promise.all([
    qrCode.toDataURL(expoUrl, { type: "image/png", width: 280, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } }),
    metroIsReachable(metroPort),
  ]);
  const lanAvailable = host !== "localhost";
  return {
    expoUrl, gatewayUrl: `http://${host}:${gatewayPort}`, qrDataUrl, metroReachable, lanAvailable,
    ...(!lanAvailable ? { message: "No se detectó una red LAN privada. localhost sólo funciona en este equipo; conecta el equipo y el teléfono a la misma red Wi-Fi y pulsa Actualizar." } : {}),
  };
}

export function developmentRouter(options: DevelopmentRouterOptions = { enabled: false, metroPort: 8081, gatewayPort: 8787 }): Router {
  const router = Router();
  if (options.enabled !== true) {
    router.use((_req, res) => { res.set("Cache-Control", "no-store").status(404).json({ error: "NOT_FOUND" }); });
    return router;
  }
  const { metroPort, gatewayPort, preferredHost } = options;
  if (![metroPort, gatewayPort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65535)) {
    throw new Error("DEVELOPMENT_PORT_INVALID");
  }
  let cache: { key: string; expiresAt: number; connection: Promise<DevelopmentConnection> } | undefined;

  router.get("/connection", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET") { res.status(404).json({ error: "NOT_FOUND" }); return; }
    if (!emptySchema.safeParse(req.query).success || !emptySchema.safeParse(req.params).success ||
        req.body !== undefined || req.headers["transfer-encoding"] !== undefined ||
        (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0")) {
      res.status(400).json({ error: "INVALID_INPUT" });
      return;
    }
    try {
      const host = selectDevelopmentHost(os.networkInterfaces(), preferredHost);
      const key = `${host}:${metroPort}:${gatewayPort}`;
      if (!cache || cache.key !== key || cache.expiresAt <= Date.now()) {
        const entry = { key, expiresAt: Number.POSITIVE_INFINITY, connection: createConnection(host, metroPort, gatewayPort) };
        cache = entry;
        void entry.connection.then(() => { entry.expiresAt = Date.now() + cacheDuration; }, () => { if (cache === entry) cache = undefined; });
      }
      res.json(await cache.connection);
    } catch {
      res.status(503).json({ error: "DEVELOPMENT_CONNECTION_UNAVAILABLE" });
    }
  });
  return router;
}