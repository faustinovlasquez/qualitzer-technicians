import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { Connectivity } from "./contracts";

let configured = false;
export function createConnectivity(): Connectivity {
  if (!configured) {
    NetInfo.configure({ reachabilityShouldRun: () => false, shouldFetchWiFiSSID: false });
    configured = true;
  }
  return {
    current: async () => (await NetInfo.fetch()).isConnected,
    subscribe: (listener) => NetInfo.addEventListener((state: NetInfoState) => listener(state.isConnected)),
  };
}