import type { NotificationAdapter } from "./contracts";

export function createNotificationAdapter(): NotificationAdapter {
  return {
    platform: "unsupported", unsupportedReason: "MOBILE_PUSH_WEB_UNSUPPORTED", projectId: null,
    async getPermission() { return "unsupported"; },
    async requestPermission() { return "unsupported"; },
    async prepareChannel() {},
    async getExpoToken() { throw new Error("MOBILE_PUSH_WEB_UNSUPPORTED"); },
    async getInstallationId() { throw new Error("MOBILE_PUSH_WEB_UNSUPPORTED"); },
    async readConsent() { return false; },
    async writeConsent() {},
    subscribe() { return () => {}; },
    async lastResponse() { return null; },
    async clearResponse() {},
    async presented() { return []; },
    async dismiss() {},
    async setBadge() { return false; },
    async openSettings() {},
  };
}