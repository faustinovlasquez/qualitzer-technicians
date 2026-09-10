import type { IncomingMessage, ServerResponse } from "node:http";

export interface EmbeddedGatewayOptions {
  backendUrl: string;
  sessionFile: string;
  trustedProxyIps: string[];
  corsOrigins?: string[];
}

export type EmbeddedGatewayHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;