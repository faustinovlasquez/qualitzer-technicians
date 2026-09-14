import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Assignments, AssignmentWork, DateRange, User } from "../../src/domain/models";
import type { OfflineSnapshot } from "../../src/domain/offline";
import { DashboardScreen, type DashboardScreenProps } from "../../src/screens/DashboardScreen";
import { LoginScreen } from "../../src/screens/LoginScreen";

type Scenario = "full" | "supplemental" | "partial" | "partial-empty" | "null-coverage" | "no-data";
type Screen = "login" | "dashboard";
const range: DateRange = { startDate: "2026-09-12", endDate: "2026-09-12" };
const user: User = { id: 1, workerId: 1, name: "Alex", lastnames: "Fixture", email: "alex@example.invalid", role: { name: "Técnico" },
  accessBranchs: [{ id: 1, name: "Sucursal ficticia", main: true }], system: { name: "Fixture aislada", timezone: "UTC" } };

function assignments(scenario: Scenario): Assignments {
  const states: AssignmentWork["status"][] = scenario === "supplemental" ? ["pending", "pending", "paused", "delivered"] : ["pending", "pending", "in_progress", "completed"];
  const minutes = [120, 90, 135, 60];
  const works: AssignmentWork[] = scenario === "partial-empty" ? [] : states.map((status, index) => ({
    id: String(index + 1), workType: "productive", title: `Tarea de prueba ${index + 1}`, summary: "Trabajo de fixture", specialty: "Mantenimiento",
    status, priority: "medium", scheduledDate: range.startDate, scheduledStartTime: "08:00", scheduledEndTime: "10:00", plannedMinutes: minutes[index],
    executedMinutes: 0, elapsedSeconds: 0, isManualExecution: true, commentsCount: 0, filesCount: 0, checklistDone: 0, checklistTotal: 0,
    isOverdue: false, canExecute: true, canEditDefinition: false, missingRequiredInfo: [], materials: [], checklists: [], responsibles: [],
  }));
  return { generatedAt: "2026-09-12T08:00:00Z", technician: { id: 1, name: "Alex", allowEditExecutionTime: false },
    summary: { totalGroups: 1, totalWorks: works.length, activeWorks: 1, overdueWorks: 0, plannedMinutes: 405 },
    groups: [{ id: "101", type: "direct_assignment", code: "AS-101", title: "Asignación ficticia", status: "pending", customerName: "Cliente ficticio",
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
        : <DashboardScreen data={scenario === "no-data" ? null : assignments(scenario)} user={user} range={range} loading={false} error={null}
          onRefresh={() => { metrics.refreshCalls += 1; }} onRangeChange={value => { metrics.rangeCalls.push(value); }}
          onOpenWork={onOpenWork} onOpenGroup={() => { metrics.openCalls += 1; }} onWorkStatus={async () => { metrics.statusCalls += 1; }}
          offline={coverage(scenario)} companyBranchId={1} busy={busy} view="today" />}
    </SafeAreaProvider>);
  },
  metrics: () => metrics,
  releaseLogin: () => { releaseLogin?.(); releaseLogin = null; },
};
window.compactOverviewFixture.render("login");