import type { Session } from "../domain/models";

export interface CompanyBrandingInput {
  session: Pick<Session, "mode" | "tenant"> | null;
  gatewayUrl: string;
  verified: boolean;
  branchName?: string | null;
}

export interface CompanyBrandingPayload {
  shortcutId: string;
  displayName: string;
  branchName: string | null;
  logoDataUri: string | null;
  logoHttpsUrl?: string | null;
}

export interface CompanyBrandingStatus {
  ready: boolean;
  pinSupported: boolean;
  logoUsed: "company" | "qualitzer";
}

export type CompanyPinResult = "pending" | "updated" | "unsupported" | "stale" | "unavailable" | "skipped";

export interface CompanyBrandingPort {
  invalidate(): number;
  synchronize(revision: number, payload: CompanyBrandingPayload | null): Promise<CompanyBrandingStatus>;
  requestPin(revision: number): Promise<CompanyPinResult>;
  requestAutomaticPin?(revision: number): Promise<CompanyPinResult>;
  addListener(event: "onPinConfirmed", listener: (event: { shortcutId: string; revision: number }) => void): { remove(): void };
}

export interface CompanyBrandingUi {
  available: boolean;
  busy: boolean;
  canPin: boolean;
  message: string;
  logoMessage: string;
  onPin(): void;
}