import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { tenantSchema } from "./tenantSchemas";

const key = "qualitzer.mobile.session.v2";
const legacyKey = "qualitzer.mobile.session.v1";
const sessionToken = Platform.OS === "web" ? z.literal("cookie-session") : z.string().regex(/^qzm_[A-Za-z0-9_-]{43}$/);
const storedSession = z.object({ token: sessionToken, gatewayUrl: z.string().url(), branchId: z.number().int().positive().nullable(), tenant: tenantSchema.pick({ id: true, name: true, portalOrigin: true, environment: true }) });
let storageOperation: Promise<void> = Promise.resolve();
function serialize(operation: () => Promise<void>): Promise<void> {
  const pending = storageOperation.then(operation, operation);
  storageOperation = pending.catch(() => undefined);
  return pending;
}
export type StoredSession = z.infer<typeof storedSession>;
export async function loadSession(): Promise<StoredSession | null> {
  await storageOperation;
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(legacyKey);
  const raw = Platform.OS === "web" ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
  if (!raw) return null;
  let input: unknown;
  try { input = JSON.parse(raw); } catch { await removeSession(); return null; }
  const parsed = storedSession.safeParse(input);
  if (!parsed.success) { await removeSession(); return null; }
  return parsed.data;
}
export async function saveSession(value: StoredSession): Promise<void> {
  const json = JSON.stringify(storedSession.parse(value));
  await serialize(() => Platform.OS === "web" ? AsyncStorage.setItem(key, json) : SecureStore.setItemAsync(key, json, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }));
}
export async function removeSession(): Promise<void> {
  await serialize(async () => {
    if (Platform.OS === "web") await AsyncStorage.multiRemove([key, legacyKey]);
    else { await SecureStore.deleteItemAsync(key); await SecureStore.deleteItemAsync(legacyKey); }
  });
}
export async function loadGateway(): Promise<string | null> { return AsyncStorage.getItem("qualitzer.gateway"); }
export async function saveGateway(value: string): Promise<void> { await AsyncStorage.setItem("qualitzer.gateway", value); }