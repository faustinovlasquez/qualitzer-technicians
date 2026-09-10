import Constants from "expo-constants";
import { Platform } from "react-native";
import { expoGatewayUrl, resolveGatewayConfiguration } from "./gatewayConnection";

export const gatewayConfiguration = resolveGatewayConfiguration({
  standaloneFlag: process.env.EXPO_PUBLIC_STANDALONE,
  configuredUrl: process.env.EXPO_PUBLIC_GATEWAY_URL,
  extra: Constants.expoConfig?.extra?.gateway,
  nativeRelease: Platform.OS !== "web" && !__DEV__,
  developmentUrl: () => Platform.OS === "web"
    ? `http://${globalThis.location.hostname}:8787`
    : expoGatewayUrl(Constants.expoConfig?.hostUri) ?? "http://localhost:8787",
});