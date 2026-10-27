import { createHash } from "node:crypto";
import { PollingSocket } from "./pollingSocket";

/**
 * Clave del backend para los comentarios en vivo (SOCKET_IO_TOKEN; vacía si el backend no tiene una). Sin configurar,
 * la app se actualiza por consultas.
 */
let socketToken: string | null = null;
export function configureRealtime(token: string | undefined | null): void {
  socketToken = typeof token === "string" ? token : null;
}
export const realtimeEnabled = (): boolean => socketToken !== null;
// Registro breve para diagnosticar la conexión en vivo (GATEWAY_REALTIME_TRACE=on); no incluye contenido ni datos personales.
const trace = (line: string) => { if (process.env.GATEWAY_REALTIME_TRACE === "on") process.stdout.write(`${new Date().toISOString()} ${line}\n`); };

export interface LiveUser { userId: number; name: string }
export interface LiveState { live: boolean; version: number; typing: string[] }

interface Viewer {
  socket: PollingSocket | null;
  ready: Promise<boolean>;
  roomKey: string;
  user: LiveUser;
  version: number;
  typing: string[];
  waiters: Set<() => void>;
  lastSeen: number;
}

const IDLE_MS = 70_000;
const MAX_VIEWERS = 500;

/**
 * Una conexión en vivo por persona y conversación abierta en la app: entra a la sala del backend, cuenta los
 * mensajes nuevos o editados y quién escribe. Se cierra sola si la app deja de preguntar.
 */
class RealtimeHub {
  private readonly viewers = new Map<string, Viewer>();

  constructor() {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, viewer] of this.viewers) if (now - viewer.lastSeen > IDLE_MS) this.drop(key, viewer);
    }, 20_000);
    sweep.unref();
  }

  private drop(key: string, viewer: Viewer): void {
    this.viewers.delete(key);
    if (viewer.socket && !viewer.socket.isClosed) {
      viewer.socket.emit("comments:leave", { roomKey: viewer.roomKey, user: viewer.user });
      setTimeout(() => viewer.socket?.close(), 500).unref();
    }
    for (const waiter of viewer.waiters) waiter();
  }

  private viewer(backendOrigin: string, tenantOrigin: string, roomKey: string, user: LiveUser): Viewer {
    const key = createHash("sha256").update(JSON.stringify([backendOrigin, tenantOrigin, roomKey, user.userId])).digest("hex");
    const existing = this.viewers.get(key);
    if (existing && !(existing.socket?.isClosed ?? false)) { existing.lastSeen = Date.now(); return existing; }
    if (existing) this.viewers.delete(key);
    if (this.viewers.size >= MAX_VIEWERS) {
      const oldest = [...this.viewers.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) this.drop(oldest[0], oldest[1]);
    }
    const viewer: Viewer = { socket: null, ready: Promise.resolve(false), roomKey, user, version: 0, typing: [], waiters: new Set(), lastSeen: Date.now() };
    const notify = () => { for (const waiter of viewer.waiters) waiter(); };
    const socket = new PollingSocket(backendOrigin, tenantOrigin, { token: socketToken ?? "" }, (name, data) => {
      const payload = data !== null && typeof data === "object" ? data as Record<string, unknown> : {};
      if (name.startsWith("comment")) trace(`REALTIME_EVENT ${name} ${String(payload.roomKey)}${payload.roomKey === roomKey ? "" : " (otra sala)"}`);
      if (payload.roomKey !== roomKey) return;
      if (name === "comment:created" || name === "comment:updated") { viewer.version += 1; notify(); }
      if (name === "comments:typing:update") {
        const users = Array.isArray(payload.users) ? payload.users : [];
        viewer.typing = [...new Set(users.flatMap((item) => {
          const person = item !== null && typeof item === "object" ? item as Record<string, unknown> : {};
          return Number(person.userId) === user.userId || typeof person.name !== "string" ? [] : [person.name.slice(0, 120)];
        }))].slice(0, 5);
        notify();
      }
    }, () => { if (this.viewers.get(key) === viewer) this.viewers.delete(key); notify(); });
    viewer.socket = socket;
    viewer.ready = socket.connect().then(() => {
      socket.emit("comments:join", { roomKey, user });
      trace(`REALTIME_JOINED ${roomKey}`);
      return true;
    }, (error: unknown) => {
      trace(`REALTIME_CONNECT_FAILED ${error instanceof Error ? error.message : "UNKNOWN"} ${backendOrigin}`);
      socket.close();
      return false;
    });
    this.viewers.set(key, viewer);
    return viewer;
  }

  /** Espera hasta que haya algo nuevo (o se cumpla el plazo) y devuelve el estado de la conversación. */
  async wait(backendOrigin: string, tenantOrigin: string, roomKey: string, user: LiveUser, since: number, typingSeen: string, timeoutMs: number): Promise<LiveState> {
    if (socketToken === null) { trace("REALTIME_DISABLED"); return { live: false, version: 0, typing: [] }; }
    const viewer = this.viewer(backendOrigin, tenantOrigin, roomKey, user);
    trace(`REALTIME_WAIT ${roomKey} desde ${since} (actual ${viewer.version})`);
    if (!await viewer.ready || viewer.socket?.isClosed) return { live: false, version: viewer.version, typing: [] };
    const changed = () => viewer.version !== since || viewer.typing.join("|") !== typingSeen;
    if (!changed()) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); viewer.waiters.delete(done); resolve(); };
        const timer = setTimeout(done, timeoutMs);
        timer.unref();
        viewer.waiters.add(done);
      });
    }
    viewer.lastSeen = Date.now();
    return { live: !(viewer.socket?.isClosed ?? true), version: viewer.version, typing: viewer.typing };
  }

  /** Avisa a la sala que la persona está escribiendo (o dejó de hacerlo). */
  async typing(backendOrigin: string, tenantOrigin: string, roomKey: string, user: LiveUser, isTyping: boolean): Promise<boolean> {
    if (socketToken === null) return false;
    const viewer = this.viewer(backendOrigin, tenantOrigin, roomKey, user);
    if (!await viewer.ready || !viewer.socket || viewer.socket.isClosed) return false;
    viewer.socket.emit("comments:typing", { roomKey, user, isTyping });
    return true;
  }
}

export const realtimeHub = new RealtimeHub();
