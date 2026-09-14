import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DeviceLockController } from "../../src/security/DeviceLockController";
import { DeviceLockScreen } from "../../src/security/DeviceLockScreen";
import { DeviceSecurityCard } from "../../src/security/DeviceSecurityCard";
import { DeviceSecurityContext, type DeviceSecurityUi } from "../../src/security/DeviceSecurityContext";
import type { DeviceAuthenticationResult, DeviceLockPreference, DeviceSecurityAdapter } from "../../src/security/contracts";
import { palette } from "../../src/ui/theme";

type Scenario = "offer" | "loading" | "locked" | "card" | "readError";
interface FixtureApi {
  render(scenario: Scenario): void;
  backgroundAndReturn(): void;
  releaseRead(): void;
  metrics(): { authentications: number; writes: DeviceLockPreference[]; ready: boolean; busy: boolean; locked: boolean; enabled: boolean; offered: boolean };
}
declare global { interface Window { deviceSecurityFixture: FixtureApi } }

class MemoryOsAdapter implements DeviceSecurityAdapter {
  readonly platformSupported = true;
  readonly initialForeground = true;
  authentications = 0;
  writes: DeviceLockPreference[] = [];
  private finish: ((result: DeviceAuthenticationResult) => void) | null = null;
  private finishRead: (() => void) | null = null;
  showDialog: (visible: boolean) => void = () => {};
  constructor(private readonly scenario: Scenario) {}
  async readPreference(): Promise<DeviceLockPreference | null> {
    if (this.scenario === "loading") await new Promise<void>(resolve => { this.finishRead = resolve; });
    if (this.scenario === "readError") throw new Error("FIXTURE_READ_UNAVAILABLE");
    return this.scenario === "locked" ? "enabled" : this.scenario === "card" ? "declined" : null;
  }
  async writePreference(value: DeviceLockPreference): Promise<void> { this.writes.push(value); }
  async available(): Promise<boolean> { return true; }
  authenticate(): Promise<DeviceAuthenticationResult> {
    this.authentications += 1;
    this.showDialog(true);
    return new Promise(resolve => { this.finish = resolve; });
  }
  complete(result: DeviceAuthenticationResult): void {
    const finish = this.finish;
    this.finish = null;
    this.showDialog(false);
    finish?.(result);
  }
  async cancel(): Promise<void> { this.complete({ success: false, error: "user_cancel" }); }
  releaseRead(): void { this.finishRead?.(); this.finishRead = null; }
}

const container = document.getElementById("root");
if (!container) throw new Error("FIXTURE_ROOT_REQUIRED");
const root = createRoot(container);
let active: { controller: DeviceLockController; adapter: MemoryOsAdapter } | null = null;
let revision = 0;

function Fixture({ controller, adapter, scenario }: { controller: DeviceLockController; adapter: MemoryOsAdapter; scenario: Scenario }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [dialog, setDialog] = useState(false);
  const blocked = !state.ready || state.locked || state.offered || state.busy || !state.foreground;
  const security: DeviceSecurityUi = { controller, state, blocked, isUnlocked: () => !blocked };
  useEffect(() => {
    adapter.showDialog = setDialog;
    void controller.initialize().then(() => { if (scenario === "offer") controller.offer(); });
    return () => { adapter.showDialog = () => {}; };
  }, [adapter, controller, scenario]);
  const screen = scenario !== "card" && blocked;
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
    <DeviceSecurityContext.Provider value={security}>
      <View style={{ flex: 1, minHeight: 0, backgroundColor: palette.background }}>
        <View style={{ flex: 1, minHeight: 0 }} aria-hidden={dialog}>
          {screen ? <DeviceLockScreen security={security} privacyError={null} /> : <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: "100%", maxWidth: 540, alignSelf: "center" }}>
            <Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 30, fontWeight: "700" }}>Perfil de prueba aislada</Text>
            <DeviceSecurityCard security={security} disabled={false} />
            <Text>Solo interfaz de prueba. Sin sesión ni datos privados.</Text>
          </ScrollView>}
        </View>
        {dialog ? <div role="dialog" aria-modal="true" aria-label="Simulación de seguridad del sistema" style={{ position: "fixed", inset: 0, zIndex: 100, background: "#0009", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 20, width: "100%", maxWidth: 360, maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Diálogo simulado</h2>
            <p style={{ margin: 0 }}>Prueba web: no solicita huella, PIN ni credenciales reales.</p>
            <button type="button" autoFocus style={{ minHeight: 48, whiteSpace: "normal" }} onClick={() => adapter.complete({ success: true })}>Confirmar simulación</button>
            <button type="button" style={{ minHeight: 48, whiteSpace: "normal" }} onClick={() => void adapter.cancel()}>Cancelar simulación</button>
          </div>
        </div> : null}
      </View>
    </DeviceSecurityContext.Provider>
  </SafeAreaProvider>;
}

window.deviceSecurityFixture = {
  render(scenario) {
    active?.controller.dispose();
    const adapter = new MemoryOsAdapter(scenario);
    const controller = new DeviceLockController(adapter);
    active = { adapter, controller };
    root.render(<Fixture key={++revision} adapter={adapter} controller={controller} scenario={scenario} />);
  },
  backgroundAndReturn() { active?.controller.setForeground(false); active?.controller.setForeground(true); },
  releaseRead() { active?.adapter.releaseRead(); },
  metrics() {
    if (!active) throw new Error("FIXTURE_NOT_MOUNTED");
    const { ready, busy, locked, enabled, offered } = active.controller.getSnapshot();
    return { ready, busy, locked, enabled, offered, authentications: active.adapter.authentications, writes: [...active.adapter.writes] };
  },
};
window.deviceSecurityFixture.render("offer");