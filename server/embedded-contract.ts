import type { IncomingMessage, ServerResponse } from "node:http";

export interface EmbeddedGatewayOptions {
  backendUrl: string;
  sessionFile: string;
  trustedProxyIps: string[];
  corsOrigins?: string[];
  /** Clave de los comentarios en vivo del backend (SOCKET_IO_TOKEN); sin ella el chat se actualiza por consultas. */
  socketToken?: string;
}

export type EmbeddedGatewayHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;