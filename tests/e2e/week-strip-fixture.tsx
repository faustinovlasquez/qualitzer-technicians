import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { dailyRange } from "../../src/domain/assignmentSchedule";
import { shiftDate, weekRange } from "../../src/domain/format";
import type { Assignments, AssignmentWork, DateRange, User } from "../../src/domain/models";
import type { OfflineSnapshot } from "../../src/domain/offline";
import { DashboardScreen } from "../../src/screens/DashboardScreen";

type Screen = "today" | "agenda" | "list";
type Scenario = "full" | "missing" | "local" | "busy" | "loading";
interface Metrics { ranges: DateRange[]; focus: string[]; opened: string[]; status: number; }
interface FixtureApi { render(screen: Screen, scenario?: Scenario, date?: string): void; scenario(value: Scenario): void; metrics(): Metrics; }
declare global { interface Window { weekStripFixture: FixtureApi; } }
const user: User = { id: 1, workerId: 1, name: "Alex", lastnames: "Fixture", email: "alex@example.invalid", role: { name: "Técnico" },
  accessBranchs: [{ id: 1, name: "Fixture", main: true }], system: { name: "Fixture", timezone: "UTC" } };
let metrics: Metrics = { ranges: [], focus: [], opened: [], status: 0 };
let revision = 0;
let changeScenario: ((value: Scenario) => void) | null = null;

function Fixture({ screen, scenario: initialScenario, date }: { screen: Screen; scenario: Scenario; date: string }) {
  const [scenario, setScenario] = useState(initialScenario);
  changeScenario = setScenario;
  const [range, setRange] = useState(screen === "today" ? dailyRange(date) : weekRange(date));
  const [focusDate, setFocusDate] = useState(date);
  const week = weekRange(range.startDate);
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(week.startDate, index));
  const partial = scenario === "missing" || scenario === "local";
  const works: AssignmentWork[] = (scenario === "missing" ? [] : [dates[0]!, dates[5]!]).map((scheduledDate, index) => ({
    id: `${scenario === "local" ? "local-" : ""}${index + 1}`, workType: "productive", title: `Trabajo ${index + 1}`, summary: "Fixture", specialty: "Mantenimiento", status: "pending",
    priority: "medium", scheduledDate, scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: 60, executedMinutes: 0,
    elapsedSeconds: 0, isManualExecution: true, commentsCount: 0, filesCount: 0, checklistDone: 0, checklistTotal: 0,
    isOverdue: false, canExecute: true, canEditDefinition: false, missingRequiredInfo: [], materials: [], checklists: [], responsibles: [],
  }));
  const data: Assignments = { generatedAt: "2026-09-12T08:00:00Z", technician: { id: 1, name: "Alex", allowEditExecutionTime: false },
    summary: { totalGroups: 1, totalWorks: works.length, activeWorks: 0, overdueWorks: 0, plannedMinutes: works.length * 60 },
    groups: [{ id: "101", type: "direct_assignment", code: "AS-101", title: "Fixture", status: "pending", customerName: "Fixture", locationName: "Taller",
      locationAddress: null, scheduledDate: dates[0]!, scheduledStartTime: "08:00", scheduledEndTime: "09:00", plannedMinutes: works.length * 60,
      isOverdue: false, isResponsible: true, canManage: false, equipment: null, products: [], works }] };
  const offline: OfflineSnapshot = { online: !partial, preparing: false, syncing: false, authBlocked: false, pending: scenario === "local" ? 2 : 0,
    conflicts: 0, lastSyncedAt: null, lastError: null, coverage: partial ? [] : dates.map(day => ({ date: day, branchId: 1, fetchedAt: 1 })), operations: [] };
  return <DashboardScreen data={data} user={user} range={range} loading={scenario === "loading"} busy={scenario === "busy"} error={null}
    onRefresh={() => {}} onRangeChange={value => { metrics.ranges.push(value); setRange(value); }} onFocusDate={day => { metrics.focus.push(day); setFocusDate(day); }}
    focusDate={focusDate} onOpenWork={(_group, work) => { metrics.opened.push(`${work.id}:${work.scheduledDate}`); }} onOpenGroup={() => {}}
    onWorkStatus={async () => { metrics.status += 1; }} offline={offline} companyBranchId={1} view={screen === "today" ? "today" : "agenda"} />;
}
const container = document.getElementById("root");
if (!container) throw new Error("FIXTURE_ROOT_REQUIRED");
const root = createRoot(container);
window.weekStripFixture = {
  render(screen, scenario = "full", date = "2026-09-12") {
    metrics = { ranges: [], focus: [], opened: [], status: 0 };
    root.render(<SafeAreaProvider key={++revision} initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      <Fixture screen={screen} scenario={scenario} date={date} />
    </SafeAreaProvider>);
  },
  metrics: () => metrics,
  scenario: value => { changeScenario?.(value); },
};
window.weekStripFixture.render("today");