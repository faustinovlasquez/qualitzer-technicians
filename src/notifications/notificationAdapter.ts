import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { AppState, Linking, Platform } from "react-native";
import { z } from "zod";
import type { NotificationAdapter, NotificationPermission } from "./contracts";
import { NotificationPresentationDedupe } from "./notificationPresentationDedupe";
import { notificationReadWithTimeout } from "./MobileNotificationClient";

const projectConfig = z.object({ eas: z.object({ projectId: z.uuid() }).optional() });
const installationKey = "qualitzer:mobile-notifications:installation:v1";
let installationPending: Promise<string> | null = null;
let foregroundOwner: symbol | null = null;
let badgeTail: Promise<boolean> = Promise.resolve(false);
const presentations = new NotificationPresentationDedupe();

function installationId(): Promise<string> {
  if (!installationPending) {
    installationPending = (async () => {
      const stored = await AsyncStorage.getItem(installationKey);
      if (stored && z.uuid().safeParse(stored).success) return stored;
      const { randomUUID } = await import("expo-crypto");
      const id = randomUUID();
      await AsyncStorage.setItem(installationKey, id);
      return id;
    })().catch((error: unknown) => { installationPending = null; throw error; });
  }
  return installationPending;
}

export function createNotificationAdapter(): NotificationAdapter {
  const nativePlatform = Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "unsupported";
  const unsupported = nativePlatform === "unsupported" || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const extra = projectConfig.safeParse(Constants.expoConfig?.extra);
  const builtId = Constants.easConfig?.projectId;
  const extraId = extra.success ? extra.data.eas?.projectId : undefined;
  const candidate = builtId ?? extraId;
  const projectId = z.uuid().safeParse(candidate).success && !(builtId && extraId && builtId !== extraId) ? candidate ?? null : null;
  let sdk: Promise<typeof import("expo-notifications")> | null = null;
  let subscriptionOwner: symbol | null = null;
  function notifications() {
    if (unsupported) throw new Error("MOBILE_PUSH_NATIVE_UNSUPPORTED");
    sdk ??= import("expo-notifications");
    return sdk;
  }
  async function permission(request: boolean): Promise<NotificationPermission> {
    if (unsupported) return "unsupported";
    const module = await notifications();
    const result = request
      ? await module.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } })
      : await module.getPermissionsAsync();
    if (nativePlatform === "android") {
      const channel = await module.getNotificationChannelAsync("technical-work");
      if (channel?.importance === module.AndroidImportance.NONE) return "blocked";
    }
    if (nativePlatform === "ios" && result.ios) {
      switch (result.ios.status) {
        case module.IosAuthorizationStatus.AUTHORIZED: return "granted";
        case module.IosAuthorizationStatus.PROVISIONAL: return "provisional";
        case module.IosAuthorizationStatus.EPHEMERAL: return "ephemeral";
        case module.IosAuthorizationStatus.NOT_DETERMINED: return "undetermined";
        default: return result.canAskAgain ? "denied" : "blocked";
      }
    }
    if (result.granted) return "granted";
    if (result.status === "undetermined") return "undetermined";
    return result.canAskAgain ? "denied" : "blocked";
  }
  return {
    platform: unsupported ? "unsupported" : nativePlatform,
    unsupportedReason: unsupported ? nativePlatform === "unsupported" ? "MOBILE_PUSH_WEB_UNSUPPORTED" : "MOBILE_PUSH_EXPO_GO_UNSUPPORTED" : null,
    projectId,
    getPermission: () => permission(false),
    requestPermission: () => permission(true),
    async prepareChannel() {
      const module = await notifications();
      if (nativePlatform === "android") await module.setNotificationChannelAsync("technical-work", {
        name: "Avisos de Qualitzer", importance: module.AndroidImportance.HIGH, sound: "default", showBadge: true,
        enableVibrate: true, vibrationPattern: [0, 180, 100, 180], lightColor: "#226957",
        description: "Nuevas asignaciones y recordatorios de tu jornada", lockscreenVisibility: module.AndroidNotificationVisibility.PRIVATE,
      });
    },
    async getExpoToken(id, devicePushToken) {
      return notificationReadWithTimeout((async () => {
        const module = await notifications();
        return (await module.getExpoPushTokenAsync({ projectId: id, ...(devicePushToken ? { devicePushToken } : {}) })).data;
      })());
    },
    getInstallationId: installationId,
    async readConsent(key) { return await AsyncStorage.getItem(`${key}:notifications:opt-in:v1`) === "true"; },
    async writeConsent(key, enabled) { await AsyncStorage.setItem(`${key}:notifications:opt-in:v1`, String(enabled)); },
    subscribe(listeners) {
      if (unsupported) return () => {};
      let disposed = false;
      const owner = Symbol("notification-subscription");
      subscriptionOwner = owner;
      foregroundOwner = owner;
      const isOwner = () => !disposed && foregroundOwner === owner;
      let clearHandler: (() => void) | null = null;
      const removers: Array<() => void> = [];
      const app = AppState.addEventListener("change", (state) => { if (isOwner() && state === "active") listeners.foreground(); });
      removers.push(() => app.remove());
      void notifications().then((module) => {
        if (!isOwner()) return;
        module.setNotificationHandler({
          async handleNotification(value) {
            let present = false;
            try {
              present = isOwner() && listeners.shouldPresent?.({ identifier: value.request.identifier, data: value.request.content.data }) === true
                && presentations.accept(value.request.content.data);
            } catch { present = false; }
            return { shouldShowBanner: present, shouldShowList: present, shouldPlaySound: present, shouldSetBadge: false };
          },
        });
        clearHandler = () => module.setNotificationHandler(null);
        const response = module.addNotificationResponseReceivedListener((value) => { if (isOwner()) listeners.response({
          identifier: value.notification.request.identifier, data: value.notification.request.content.data,
          defaultAction: value.actionIdentifier === module.DEFAULT_ACTION_IDENTIFIER,
        }); });
        removers.push(() => response.remove());
        const received = module.addNotificationReceivedListener((value) => { if (isOwner()) listeners.received({ identifier: value.request.identifier, data: value.request.content.data }); });
        removers.push(() => received.remove());
        const token = module.addPushTokenListener((value) => {
          if (isOwner() && (value.type === "android" || value.type === "ios") && typeof value.data === "string") listeners.token({ type: value.type, data: value.data });
        });
        removers.push(() => token.remove());
      }).catch(() => { if (isOwner()) listeners.foreground(); });
      return () => {
        disposed = true;
        if (foregroundOwner === owner) {
          foregroundOwner = null; clearHandler?.();
          badgeTail = badgeTail.catch(() => false).then(async () => {
            const module = await notifications();
            return foregroundOwner === null ? module.setBadgeCountAsync(0) : false;
          }).catch(() => false);
        }
        removers.forEach((remove) => remove());
      };
    },
    async lastResponse() {
      if (unsupported) return null;
      const module = await notifications();
      const value = module.getLastNotificationResponse();
      return value ? { identifier: value.notification.request.identifier, data: value.notification.request.content.data, defaultAction: value.actionIdentifier === module.DEFAULT_ACTION_IDENTIFIER } : null;
    },
    async clearResponse(identifier) {
      if (unsupported) return;
      const module = await notifications();
      if (module.getLastNotificationResponse()?.notification.request.identifier === identifier) module.clearLastNotificationResponse();
    },
    async presented() {
      if (unsupported) return [];
      return (await (await notifications()).getPresentedNotificationsAsync()).map((item) => ({ identifier: item.request.identifier, data: item.request.content.data }));
    },
    async dismiss(identifier) { if (!unsupported) await (await notifications()).dismissNotificationAsync(identifier); },
    async setBadge(count) {
      if (unsupported || !Number.isSafeInteger(count) || count < 0) return false;
      const owner = subscriptionOwner;
      if (owner === null || owner !== foregroundOwner) return false;
      const pending = badgeTail.catch(() => false).then(async () => {
        const module = await notifications();
        return owner === foregroundOwner ? module.setBadgeCountAsync(count) : false;
      });
      badgeTail = pending.catch(() => false);
      return pending;
    },
    async openSettings() { if (!unsupported) await Linking.openSettings(); },
  };
}