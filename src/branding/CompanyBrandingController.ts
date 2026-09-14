import { companyBrandingInputKey, companyBrandingNamespace, prepareCompanyBranding } from "./companyBranding";
import type { CompanyBrandingInput, CompanyBrandingPayload, CompanyBrandingPort, CompanyBrandingStatus, CompanyPinResult } from "./contracts";

export class CompanyBrandingController {
  private revision = 0;
  private payload: CompanyBrandingPayload | null = null;
  private ready = false;
  private pinBusy = false;
  private readonly automaticAttempts = new Set<string>();
  private inputKey: string | null = null;
  private namespace: string | null = null;
  private synchronization: Promise<CompanyBrandingStatus | null> | null = null;

  constructor(private readonly native: CompanyBrandingPort, private readonly digest: (namespace: string) => Promise<string>) {}

  async synchronize(input: CompanyBrandingInput): Promise<CompanyBrandingStatus | null> {
    const key = companyBrandingInputKey(input);
    if (this.inputKey === key && this.synchronization) return this.synchronization;
    const snapshot: CompanyBrandingInput = {
      gatewayUrl: input.gatewayUrl,
      verified: input.verified,
      branchName: input.branchName,
      session: input.session ? { mode: input.session.mode, tenant: {
        id: input.session.tenant.id,
        name: input.session.tenant.name,
        logo: input.session.tenant.logo,
        portalOrigin: input.session.tenant.portalOrigin,
        environment: input.session.tenant.environment,
      } } : null,
    };
    const namespace = companyBrandingNamespace(snapshot);
    const reset = this.inputKey === null || this.namespace !== namespace;
    const revision = this.native.invalidate();
    this.revision = revision;
    this.inputKey = key;
    this.namespace = namespace;
    this.payload = null;
    this.ready = false;
    this.synchronization = this.apply(snapshot, revision, reset);
    return this.synchronization;
  }

  private async apply(input: CompanyBrandingInput, revision: number, reset: boolean): Promise<CompanyBrandingStatus | null> {
    const resetStatus = reset ? await this.native.synchronize(revision, null) : null;
    if (revision !== this.revision) return null;
    const payload = await prepareCompanyBranding(input, this.digest);
    if (revision !== this.revision) return null;
    if (!payload) return resetStatus;
    const status = await this.native.synchronize(revision, payload);
    if (revision !== this.revision) return null;
    this.payload = payload;
    this.ready = status.ready && status.pinSupported;
    return status;
  }

  async clear(): Promise<void> {
    this.inputKey = null;
    this.namespace = null;
    this.synchronization = null;
    this.revision = this.native.invalidate();
    this.payload = null;
    this.ready = false;
    await this.native.synchronize(this.revision, null);
  }

  isCurrentConfirmation(shortcutId: string, revision: number): boolean {
    return this.ready && revision === this.revision && shortcutId === this.payload?.shortcutId;
  }

  async requestPin(automatic = false): Promise<CompanyPinResult> {
    if (!this.ready || !this.payload || this.pinBusy) return "unavailable";
    if (automatic && (!this.payload.branchName || !this.native.requestAutomaticPin)) return "unavailable";
    if (automatic && this.automaticAttempts.has(this.payload.shortcutId)) return "skipped";
    const revision = this.revision;
    if (automatic) this.automaticAttempts.add(this.payload.shortcutId);
    this.pinBusy = true;
    try {
      const result = automatic
        ? await this.native.requestAutomaticPin!(revision)
        : await this.native.requestPin(revision);
      return revision === this.revision ? result : "stale";
    } finally {
      this.pinBusy = false;
    }
  }
}