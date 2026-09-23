import { createRoot } from "react-dom/client";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Assignments, AssignmentWork, DateRange, User } from "../../src/domain/models";
import type { OfflineSnapshot } from "../../src/domain/offline";
import { DashboardScreen, type DashboardScreenProps } from "../../src/screens/DashboardScreen";
import { LoginScreen } from "../../src/screens/LoginScreen";
import { monthRange, weekRange } from "../../src/domain/format";

type Scenario = "full" | "supplemental" | "partial" | "partial-empty" | "null-coverage" | "no-data" | "empty-maintenance" | "empty-ot" | "agenda-date16" | "badges" | "badges-many";
type Screen = "login" | "dashboard" | "agenda";
const range: DateRange = { startDate: "2026-09-12", endDate: "2026-09-12" };
const user: User = { id: 1, workerId: 1, name: "Alex", lastnames: "Fixture", email: "alex@example.invalid", role: { name: "Técnico" },
  accessBranchs: [{ id: 1, name: "Sucursal ficticia", main: true }], system: { name: "Fixture aislada", timezone: "UTC" } };

function assignments(scenario: Scenario): Assignments {
  const states: AssignmentWork["status"][] = scenario === "supplemental" ? ["pending", "pending", "paused", "delivered"] : ["pending", "pending", "in_progress", "completed"];
  const minutes = [120, 90, 135, 60];
  const works: AssignmentWork[] = scenario === "partial-empty" || scenario.startsWith("empty-") ? [] : states.map((status, index) => ({
    id: String(index + 1), workType: "productive", title: `Tarea de prueba ${index + 1}`, summary: "Trabajo de fixture", specialty: "Mantenimiento",
    status, priority: "medium", scheduledDate: range.startDate, scheduledStartTime: "08:00", scheduledEndTime: "10:00", plannedMinutes: minutes[index],
    executedMinutes: 0, elapsedSeconds: 0, isManualExecution: true, commentsCount: 0, filesCount: 0, checklistDone: 0, checklistTotal: 0,
    isOverdue: false, canExecute: true, canEditDefinition: false, missingRequiredInfo: [], materials: [], checklists: [], responsibles: [],
  }));
  return { generatedAt: "2026-09-12T08:00:00Z", technician: { id: 1, name: "Alex", allowEditExecutionTime: false },
    summary: { totalGroups: 1, totalWorks: works.length, activeWorks: 1, overdueWorks: 0, plannedMinutes: 405 },
    groups: [{ id: scenario === "empty-maintenance" ? "maintenance-101" : scenario === "empty-ot" ? "external-101" : "101", type: scenario === "empty-maintenance" ? "internal_maintenance" : scenario === "empty-ot" ? "external_ot" : "direct_assignment", code: "AS-101", title: scenario.startsWith("empty-") ? "Revisión de batería del equipo de transporte" : "Asignación ficticia", status: "pending", customerName: "Cliente ficticio",
      locationName: "Taller", locationAddress: null, scheduledDate: range.startDate, scheduledStartTime: "08:00", scheduledEndTime: "15:00",
      plannedMinutes: 405, isOverdue: false, isResponsible: true, canManage: false, equipment: null, products: [], works }] };
}

function coverage(scenario: Scenario): OfflineSnapshot | null {
  if (scenario === "null-coverage") return null;
  const partial = scenario === "partial" || scenario === "partial-empty";
  return { online: !partial, preparing: false, syncing: false, authBlocked: false, pending: 0, conflicts: 0, lastSyncedAt: null,
    lastError: null, coverage: partial ? [] : [{ date: range.startDate, branchId: 1, fetchedAt: 1 }], operations: [] };
}

interface Metrics {
  loginCalls: { username: string; passwordMatches: boolean }[];
  demoCalls: number;
  gatewayChanges: number;
  statusCalls: number;
  openCalls: number;
  refreshCalls: number;
  rangeCalls: DateRange[];
}
interface FixtureApi {
  render(screen: Screen, scenario?: Scenario, busy?: boolean): void;
  metrics(): Metrics;
  releaseLogin(): void;
}
declare global { interface Window { compactOverviewFixture: FixtureApi } }
const container = document.getElementById("root");
if (!container) throw new Error("FIXTURE_ROOT_REQUIRED");
const root = createRoot(container);
let revision = 0;
let releaseLogin: (() => void) | null = null;
let metrics: Metrics;

function DashboardFixture({ screen, scenario, busy, onOpenWork }: { screen: Screen; scenario: Scenario; busy: boolean; onOpenWork: DashboardScreenProps["onOpenWork"] }) {
  const [currentRange, setRange] = useState(scenario === "agenda-date16" ? monthRange(range.startDate) : screen === "agenda" ? weekRange(range.startDate) : range);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const data = assignments(scenario);
  if (scenario === "badges" || scenario === "badges-many") {
    const base = data.groups[0];
    if (scenario === "badges-many") base.works = Array.from({ length: 120 }, (_, index) => ({ ...base.works[0], id: String(index + 1), status: "pending" as const }));
    data.groups.push(
      { ...base, id: "maintenance-102", type: "internal_maintenance", title: "Revision de bateria", status: "pending", works: [] },
      { ...base, id: "maintenance-103", type: "internal_maintenance", title: "Cambio de aceite", status: "delivered", works: [] },
      { ...base, id: "external-104", type: "external_ot", title: "Orden activa", status: "in_progress", works: [] },
      { ...base, id: "external-105", type: "external_ot", title: "Orden cerrada", status: "completed", works: [] },
    );
  }
  if (scenario === "agenda-date16") {
    const base = data.groups[0];
    data.groups = [
      { ...base, works: [{ ...base.works[0], id: "16", title: "Tarea programada del 16", scheduledDate: "2026-09-16" }, { ...base.works[0], id: "160", title: "Tarea sin hora del 16", scheduledDate: "2026-09-16", scheduledStartTime: "", scheduledEndTime: "" }] },
      { ...base, id: "maintenance-16", type: "internal_maintenance", code: "OT-COR-0016", title: "Mantenimiento del 16 sin trabajos", scheduledDate: "2026-09-16", works: [] },
      { ...base, id: "maintenance-17", type: "internal_maintenance", code: "OT-COR-0017", scheduledDate: "2026-09-16", works: [{ ...base.works[0], id: "161", title: "Revision de equipo del 16", scheduledDate: "2026-09-16", scheduledStartTime: "14:00", scheduledEndTime: "15:00" }] },
    ];
  }
  if (screen === "agenda" && scenario !== "agenda-date16" && currentRange.endDate.endsWith("30")) {
    const base = data.groups[0]?.works[0];
    if (base) data.groups[0].works.push({ ...base, id: "month-last", title: "Trabajo del último día", scheduledDate: currentRange.endDate, scheduledStartTime: "14:00", scheduledEndTime: "16:00", plannedMinutes: 120 });
  }
  return <DashboardScreen data={scenario === "no-data" ? null : data} user={user} range={currentRange} focusDate={focusDate} onFocusDate={setFocusDate} loading={scenario === "agenda-date16"} pendingDates={scenario === "agenda-date16" ? ["2026-09-17"] : undefined} error={null}
    onRefresh={() => { metrics.refreshCalls += 1; }} onRangeChange={value => { metrics.rangeCalls.push(value); setRange(value); }}
    onOpenWork={onOpenWork} onOpenGroup={() => { metrics.openCalls += 1; }} onWorkStatus={async () => { metrics.statusCalls += 1; }}
    offline={screen === "agenda" ? undefined : coverage(scenario)} companyBranchId={1} busy={busy} view={screen === "agenda" ? "agenda" : "today"} />;
}

window.compactOverviewFixture = {
  render(screen, scenario = "full", busy = false) {
    releaseLogin?.();
    releaseLogin = null;
    metrics = { loginCalls: [], demoCalls: 0, gatewayChanges: 0, statusCalls: 0, openCalls: 0, refreshCalls: 0, rangeCalls: [] };
    const onOpenWork: DashboardScreenProps["onOpenWork"] = () => { metrics.openCalls += 1; };
    root.render(<SafeAreaProvider key={++revision} initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {screen === "login" ? <LoginScreen gatewayUrl="https://fixture.example.invalid/mobile" busy={busy} error={null}
        onLogin={async (username, password) => {
          metrics.loginCalls.push({ username, passwordMatches: password === "Fixture password only" });
          await new Promise<void>(resolve => { releaseLogin = resolve; });
        }} onDemo={() => { metrics.demoCalls += 1; }} onGatewayChange={() => { metrics.gatewayChanges += 1; }} />
        : <DashboardFixture screen={screen} scenario={scenario} busy={busy} onOpenWork={onOpenWork} />}
    </SafeAreaProvider>);
  },
  metrics: () => metrics,
  releaseLogin: () => { releaseLogin?.(); releaseLogin = null; },
};
window.compactOverviewFixture.render("login");