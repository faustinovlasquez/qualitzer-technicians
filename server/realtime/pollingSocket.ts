/**
 * Cliente mínimo de socket.io (protocolo 4, transporte por consultas largas) para escuchar las salas de comentarios
 * del backend sin dependencias nuevas. Solo usa fetch: abre la sesión, se identifica con la clave del backend,
 * responde los «ping» y entrega los eventos.
 */
const SEPARATOR = "\u001e";

export type SocketEvent = (name: string, data: unknown) => void;

export class PollingSocket {
  private sid: string | null = null;
  private closed = false;
  private pingInterval = 25_000;
  private pingTimeout = 20_000;
  private controller: AbortController | null = null;
  private connected: { resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(
    private readonly backendOrigin: string,
    private readonly tenantOrigin: string,
    private readonly auth: Record<string, string>,
    private readonly onEvent: SocketEvent,
    private readonly onClose: () => void
  ) {}

  private url(): string {
    const query = new URLSearchParams({ EIO: "4", transport: "polling", t: `${Date.now()}${Math.random().toString(36).slice(2, 6)}` });
    if (this.sid) query.set("sid", this.sid);
    return `${this.backendOrigin}/socket.io/?${query.toString()}`;
  }

  private headers(): Headers {
    return new Headers({ Origin: this.tenantOrigin, "Content-Type": "text/plain;charset=UTF-8", "User-Agent": "QualitzerMobileGateway" });
  }

  async connect(timeoutMs = 10_000): Promise<void> {
    const response = await fetch(this.url(), { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error("REALTIME_HANDSHAKE_FAILED");
    const open = (await response.text()).split(SEPARATOR).find((packet) => packet.startsWith("0"));
    if (!open) throw new Error("REALTIME_HANDSHAKE_FAILED");
    const handshake = JSON.parse(open.slice(1)) as { sid?: unknown; pingInterval?: unknown; pingTimeout?: unknown };
    if (typeof handshake.sid !== "string" || !handshake.sid) throw new Error("REALTIME_HANDSHAKE_FAILED");
    this.sid = handshake.sid;
    if (typeof handshake.pingInterval === "number") this.pingInterval = handshake.pingInterval;
    if (typeof handshake.pingTimeout === "number") this.pingTimeout = handshake.pingTimeout;
    const ready = new Promise<void>((resolve, reject) => { this.connected = { resolve, reject }; });
    const timer = setTimeout(() => this.connected?.reject(new Error("REALTIME_CONNECT_TIMEOUT")), timeoutMs);
    timer.unref();
    await this.send(`40${JSON.stringify(this.auth)}`);
    void this.loop();
    try { await ready; } finally { clearTimeout(timer); }
  }

  private async send(payload: string): Promise<void> {
    if (!this.sid || this.closed) return;
    const response = await fetch(this.url(), { method: "POST", headers: this.headers(), body: payload, signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error("REALTIME_SEND_FAILED");
  }

  emit(name: string, data: unknown): void {
    void this.send(`42${JSON.stringify([name, data])}`).catch(() => this.close());
  }

  private handle(packet: string): void {
    if (packet === "2") { void this.send("3").catch(() => this.close()); return; }
    if (packet === "1") { this.close(); return; }
    if (packet.startsWith("40")) { this.connected?.resolve(); this.connected = null; return; }
    if (packet.startsWith("44")) { this.connected?.reject(new Error("REALTIME_AUTH_REJECTED")); this.close(); return; }
    if (packet.startsWith("42")) {
      try {
        const value = JSON.parse(packet.slice(2)) as unknown;
        if (Array.isArray(value) && typeof value[0] === "string") this.onEvent(value[0], value[1]);
      } catch { /* paquete ilegible: se ignora */ }
    }
  }

  private async loop(): Promise<void> {
    while (!this.closed) {
      this.controller = new AbortController();
      const timer = setTimeout(() => this.controller?.abort(), this.pingInterval + this.pingTimeout + 5_000);
      timer.unref();
      try {
        const response = await fetch(this.url(), { headers: this.headers(), signal: this.controller.signal });
        if (!response.ok) throw new Error("REALTIME_POLL_FAILED");
        const body = await response.text();
        for (const packet of body.split(SEPARATOR)) if (packet) this.handle(packet);
      } catch {
        this.close();
      } finally { clearTimeout(timer); }
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.sid) void fetch(this.url(), { method: "POST", headers: this.headers(), body: "1", signal: AbortSignal.timeout(5_000) }).then((response) => response.body?.cancel(), () => undefined);
    this.closed = true;
    this.connected?.reject(new Error("REALTIME_CLOSED"));
    this.connected = null;
    this.controller?.abort();
    this.onClose();
  }

  get isClosed(): boolean { return this.closed; }
}
