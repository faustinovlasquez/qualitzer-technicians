import type { Session, User } from "../domain/models";
import type { OfflineSnapshot } from "../domain/offline";
import type { CompanyBrandingInput } from "./contracts";

interface BrandingContext {
  session: (Pick<Session, "mode" | "tenant" | "branchId"> & { user: Pick<User, "accessBranchs"> }) | null;
  gatewayUrl: string;
  restoring: boolean;
  finalizingSession: boolean;
  forcePassword: boolean;
  offline: Pick<OfflineSnapshot, "authBlocked" | "online" | "connection"> | null;
  offlineController: object | null;
  offlineVerifiedAt: number | null;
}

export function companyBrandingContext(app: BrandingContext): { input: CompanyBrandingInput; automaticPinEligible: boolean } {
  const verified = Boolean(app.session && !app.restoring && !app.finalizingSession && !app.forcePassword && !app.offline?.authBlocked);
  const branch = app.session?.user.accessBranchs.find((item) => item.id === app.session?.branchId && item.isEnabled !== false && item.isDeleted !== true);
  const onlineVerified = app.offlineController
    ? app.offline?.online === true && app.offline.connection?.status === "ready" && app.offline.connection.foreground
    : app.offlineVerifiedAt !== null;
  return {
    input: {
      session: app.session ? { mode: app.session.mode, tenant: app.session.tenant } : null,
      gatewayUrl: app.gatewayUrl,
      verified,
      branchName: branch?.name,
    },
    automaticPinEligible: Boolean(verified && app.session?.mode === "live" && branch?.name.trim() && onlineVerified),
  };
}