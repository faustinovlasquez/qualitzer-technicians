import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { Connectivity } from "./contracts";

const REFRESH_TIMEOUT_MS = 3_000;

let configured = false;
export function createConnectivity(): Connectivity {
  if (!configured) {
    NetInfo.configure({ reachabilityShouldRun: () => false, shouldFetchWiFiSSID: false });
    configured = true;
  }
  return {
    // `fetch` devuelve el último aviso guardado: si el teléfono no avisó que volvió la red (corte breve), queda pegado en
    // «sin red». Se pregunta de nuevo al teléfono y, si no responde a tiempo, se usa lo último conocido.
    current: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fallback = new Promise<NetInfoState>((resolve) => { timer = setTimeout(() => resolve(NetInfo.fetch()), REFRESH_TIMEOUT_MS); });
      try { return (await Promise.race([NetInfo.refresh(), fallback])).isConnected; }
      finally { if (timer) clearTimeout(timer); }
    },
    subscribe: (listener) => NetInfo.addEventListener((state: NetInfoState) => listener(state.isConnected)),
  };
}
