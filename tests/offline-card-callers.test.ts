import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import type { DateRange, StatusInput } from "../src/domain/models";
import { assignmentWorkForDay, assignmentWorkQueryRange, dailyRange, mergeDailyAssignments } from "../src/domain/assignmentSchedule";
import { OfflineQueuedError } from "../src/domain/offline";
import type { DashboardScreenProps } from "../src/screens/DashboardScreen";
import type { OrderDetailScreenProps } from "../src/screens/OrderDetailScreen";
import type { AssignmentWorkCardProps } from "../src/screens/orders/AssignmentWorkCard";
import { assignments, group, user, work } from "../server/tests/fixtures";
import { reactFixture, tenant } from "./helpers/tenant-challenge";
import { agendaFixture, frozenNow } from "./helpers/agenda-load-lifecycle";
import { action, deferred, durableReactFixture, elements, memoryDraftStorage, queued, renderWrapped, settle, uiModule, uiScope, uiSnapshot, type Wrapped } from "./helpers/durable-ui";

function cardCalls(relative: string): ts.JsxAttributes[] {
  const filename = resolve(__dirname, "../src/screens", relative);
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls: ts.JsxAttributes[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "AssignmentWorkCard") calls.push(node.attributes);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

test("both actual AssignmentWorkCard callers forward the optional snapshot unchanged", () => {
  for (const [file, expression] of [["DashboardScreen.tsx", "offline"], ["OrderDetailScreen.tsx", "props.offline"]]) {
    const calls = cardCalls(file);
    assert.equal(calls.length, 1, file);
    const attribute = calls[0].properties.find((entry): entry is ts.JsxAttribute => ts.isJsxAttribute(entry) && entry.name.getText() === "offline");
    assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer));
    assert.equal(attribute.initializer.expression?.getText(), expression);
  }
});

test("schedule views contain no execution-card intermediary requiring snapshot forwarding", () => {
  for (const file of readdirSync(resolve(__dirname, "../src/screens/schedule")).filter((name) => name.endsWith(".tsx"))) {
    assert.equal(cardCalls(`schedule/${file}`).length, 0, file);
  }
});

function orderFixture() {
  const hooks = reactFixture();
  const module = uiModule<{ OrderDetailScreen: Wrapped<OrderDetailScreenProps> }>("screens/OrderDetailScreen.tsx", hooks, {
    "../ui/SessionContextBar": { SessionContextBar: "SessionContextBar" },
    "./orders/AssignmentOrderCard": { AssignmentOrderSummary: "AssignmentOrderSummary" },
    "./orders/AssignmentWorkCard": { AssignmentWorkCard: "AssignmentWorkCard" },
    "./orders/OrderMaterialsTab": { OrderMaterialsTab: "OrderMaterialsTab" },
    "./orders/OrderLifecyclePanel": { OrderLifecyclePanel: "OrderLifecyclePanel" },
    "./offline/OfflineOrderLifecyclePanel": { OfflineOrderLifecyclePanel: "OfflineOrderLifecyclePanel" },
    "./workDetail/FileWorkspace": { FileWorkspace: "FileWorkspace" },
  });
  const candidate = work({ status: "pending" });
  const commits = deferred<void>();
  const calls: StatusInput[] = [];
  const props: OrderDetailScreenProps = { group: group({ works: [candidate] }), tenant, branchName: "Principal", mode: "live", busy: false,
    storageKey: "order-card-isolated", offline: uiSnapshot(), companyBranchId: 1, range: uiScope, technicianName: "Test",
    onBack: () => {}, onOpenWork: () => {}, onRefresh: async () => {}, onLoadFiles: async () => [],
    onUploadFiles: async () => {}, onDeleteFile: async () => {}, onLoadDelivery: async () => { throw new Error("UNEXPECTED_DELIVERY_READ"); },
    onStart: async () => { throw new Error("UNEXPECTED_ORDER_START"); }, onDeliver: async () => { throw new Error("UNEXPECTED_DELIVERY"); },
    onWorkStatus: async (_group, _work, input) => { calls.push(input); await commits.promise; } };
  const render = () => renderWrapped(hooks, module.OrderDetailScreen, props);
  const card = (): AssignmentWorkCardProps => {
    const element = elements<AssignmentWorkCardProps>(render(), "AssignmentWorkCard")[0]; assert.ok(element); return element.props;
  };
  return { hooks, props, commits, calls, card, candidate, render };
}

test("order intermediary forwards durable timer outcomes, blocks double actions, and does not turn queued into confirmed", async (t) => {
  const f = orderFixture(); t.after(() => f.hooks.unmount());
  const card = f.card(); assert.equal(card.offline, f.props.offline);
  const first = card.onWorkStatus(f.props.group, f.candidate, { status: "in_progress" });
  const rejection = assert.rejects(first, OfflineQueuedError);
  await assert.rejects(card.onWorkStatus(f.props.group, f.candidate, { status: "in_progress" }), /operación en curso/);
  assert.equal(f.calls.length, 1);
  f.commits.reject(queued("timer")); await rejection; await settle();
  assert.equal(f.candidate.status, "pending"); assert.equal(f.card().busy, false);
});

test("order intermediary never queues delivery and blocks timers while storage, auth, or canonical data are unavailable", async (t) => {
  const f = orderFixture(); t.after(() => f.hooks.unmount());
  await assert.rejects(f.card().onWorkStatus(f.props.group, f.candidate, { status: "delivered" }), /requiere conexión/);
  for (const snapshot of [null, { ...uiSnapshot(), authBlocked: true }]) {
    f.props.offline = snapshot;
    await assert.rejects(f.card().onWorkStatus(f.props.group, f.candidate, { status: "in_progress" }), /cola local/);
  }
  f.props.offline = uiSnapshot(); f.props.staleReadOnly = true;
  await assert.rejects(f.card().onWorkStatus(f.props.group, f.candidate, { status: "paused" }), /cola local/);
  f.props.staleReadOnly = false; f.props.group = { ...f.props.group, id: "local-unconfirmed" };
  await assert.rejects(f.card().onWorkStatus(f.props.group, f.candidate, { status: "in_progress" }), /cola local/);
  assert.equal(f.calls.length, 0);
});

const week: DateRange = { startDate: "2026-09-01", endDate: "2026-09-07" };
function weekData() {
  const overdue = work({ scheduledDate: "2026-08-30", plannedDates: ["2026-08-30"], isOverdue: true, status: "pending" });
  const scheduled = work({ id: "12", scheduledDate: "2026-09-03", plannedDates: ["2026-09-03"], status: "pending" });
  return mergeDailyAssignments([
    { date: "2026-09-02", data: assignments([group({ id: "external-90", type: "external_ot", works: [overdue] })]) },
    { date: "2026-09-03", data: assignments([group({ id: "external-90", type: "external_ot", works: [scheduled] })]) },
    { date: "2026-09-04", data: assignments([group({ id: "external-90", type: "external_ot", works: [overdue] })]) },
  ]);
}

test("query-range helper preserves daily visibility and per-work query provenance without arbitrary date clamping", () => {
  const data = weekData(); const overdue = data.groups[0].works.find((candidate) => candidate.id === "11")!;
  const scheduled = data.groups[0].works.find((candidate) => candidate.id === "12")!;
  assert.deepEqual(assignmentWorkQueryRange(overdue, dailyRange("2026-09-02")), dailyRange("2026-09-02"));
  assert.deepEqual(assignmentWorkQueryRange(overdue, week), dailyRange("2026-09-04"));
  assert.deepEqual(assignmentWorkQueryRange(scheduled, week), dailyRange("2026-09-03"));
  assert.deepEqual(assignmentWorkQueryRange(assignmentWorkForDay(overdue, "2026-09-02"), week), dailyRange("2026-09-04"));
  assert.deepEqual(assignmentWorkQueryRange(overdue, dailyRange("2030-01-15")), dailyRange("2030-01-15"));
  assert.deepEqual(assignmentWorkQueryRange(overdue, { startDate: "2026-09-02", endDate: "2026-09-08" }), dailyRange("2026-09-02"), "prefer an actually observed range-start query when present");
  assert.deepEqual(assignmentWorkQueryRange(work({ scheduledDate: "2026-08-30" }), week), dailyRange(week.startDate));
});

test("actual hook selection and card query helper agree for daily overdue and separate weekly works", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: frozenNow });
  const f = agendaFixture(); t.after(() => f.unmount());
  await f.restore();
  f.reads[0].resolve(assignments([group({ works: [work({ scheduledDate: "2026-08-30", status: "pending", isOverdue: true })] })]));
  let app = await f.flush();
  let selectedGroup = app.data!.groups[0]; let candidate = selectedGroup.works[0];
  const daily = assignmentWorkQueryRange(candidate, app.range);
  app.openWork(selectedGroup, candidate); app = await f.flush();
  assert.equal(app.detailRange.startDate, daily.startDate); assert.equal(daily.startDate, "2026-09-11");
  app.closeWork(); app = await f.flush(); app.setTab("agenda"); app = await f.flush();
  app.changeRange(week); await f.flush();
  f.reads.at(-1)!.resolve(weekData()); app = await f.flush();
  for (const id of ["11", "12"]) {
    selectedGroup = app.data!.groups[0]; candidate = selectedGroup.works.find((item) => item.id === id)!;
    const expected = assignmentWorkQueryRange(candidate, app.range);
    app.openWork(selectedGroup, candidate); app = await f.flush();
    assert.equal(app.detailRange.startDate, expected.startDate);
    assert.equal(app.detailRange.startDate, id === "11" ? "2026-09-04" : "2026-09-03");
    app.closeWork(); app = await f.flush();
  }
});

test("order cards use each work's query range, not the first work's OT resource date", (t) => {
  const f = orderFixture(); t.after(() => f.hooks.unmount());
  f.props.group = weekData().groups[0];
  f.props.range = dailyRange("2026-09-04");
  f.props.assignmentsRange = week;
  const cards = elements<AssignmentWorkCardProps>(f.render(), "AssignmentWorkCard");
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.equal(card.props.queryDate, card.props.work.id === "11" ? "2026-09-04" : "2026-09-03");
    assert.equal(card.props.companyBranchId, 1);
    assert.equal(card.props.offline, f.props.offline);
  }
  f.props.assignmentsRange = undefined;
  assert.ok(elements<AssignmentWorkCardProps>(f.render(), "AssignmentWorkCard").every((card) => card.props.queryDate === "2026-09-04"), "legacy daily caller fallback remains explicit");
});

function dashboardFixture() {
  const hooks = durableReactFixture(); const memory = memoryDraftStorage();
  const module = uiModule<{ DashboardScreen: (props: DashboardScreenProps) => import("react").ReactNode }>("screens/DashboardScreen.tsx", hooks, {
    "react-native": { StyleSheet: { create: (styles: object) => styles }, useWindowDimensions: () => ({ width: 390, height: 844 }),
      View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", RefreshControl: "RefreshControl", TextInput: "TextInput", ActivityIndicator: "ActivityIndicator" },
    "@react-native-async-storage/async-storage": memory.storage,
    "./orders/AssignmentOrderCard": { AssignmentOrderCard: "AssignmentOrderCard" },
    "./orders/AssignmentWorkCard": { AssignmentWorkCard: "AssignmentWorkCard" },
    "./schedule/WeeklySchedule": { WeeklySchedule: "WeeklySchedule" },
    "./notifications/RunningTimersNotice": { RunningTimersNotice: "RunningTimersNotice" },
  });
  const props: DashboardScreenProps = { data: weekData(), user: user(), range: week, loading: false, error: null, view: "agenda",
    onRefresh: () => {}, onRangeChange: () => {}, onOpenWork: () => {}, onOpenGroup: () => {}, onWorkStatus: async () => {}, companyBranchId: 1 };
  const render = () => { const tree = hooks.render(() => module.DashboardScreen(props)); hooks.flush(); return tree; };
  return { hooks, props, render };
}

test("actual Dashboard forwards daily overdue query and per-card weekly query even under a selected-day filter", (t) => {
  const f = dashboardFixture(); t.after(() => f.hooks.unmount());
  action(f.render(), "Filtros y OTs de agenda").onPress();
  const cards = elements<AssignmentWorkCardProps>(f.render(), "AssignmentWorkCard");
  assert.equal(cards.length, 2);
  assert.equal(cards.find((card) => card.props.work.id === "11")?.props.queryDate, "2026-09-04");
  assert.equal(cards.find((card) => card.props.work.id === "12")?.props.queryDate, "2026-09-03");
  interface DayButton { accessibilityHint?: string; accessibilityLabel?: string; onPress(): void; }
  const day = elements<DayButton>(f.render(), "Pressable").find((entry) => entry.props.accessibilityHint?.startsWith("Muestra este día") && entry.key === "2026-09-02");
  assert.ok(day); day.props.onPress();
  const filtered = elements<AssignmentWorkCardProps>(f.render(), "AssignmentWorkCard");
  assert.equal(filtered.length, 1); assert.equal(filtered[0].props.work.id, "11");
  assert.equal(filtered[0].props.queryDate, "2026-09-04", "the filter does not change the hook's loaded weekly scope");
  f.props.view = "today"; f.props.range = dailyRange("2026-09-02");
  f.props.data = assignments([group({ works: [work({ scheduledDate: "2026-08-30", isOverdue: true })] })]);
  const daily = elements<AssignmentWorkCardProps>(f.render(), "AssignmentWorkCard");
  assert.equal(daily.length, 1); assert.equal(daily[0].props.queryDate, "2026-09-02");
  assert.equal(daily[0].props.work.scheduledDate, "2026-08-30"); assert.equal(daily[0].props.companyBranchId, 1);
});

test("App forwards the loaded assignments range separately from the order resource range", () => {
  const filename = resolve(__dirname, "../App.tsx");
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "OrderDetailScreen") {
      const attribute = node.attributes.properties.find((entry): entry is ts.JsxAttribute => ts.isJsxAttribute(entry) && entry.name.getText(source) === "assignmentsRange");
      assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer));
      values.push(attribute.initializer.expression?.getText(source) ?? "");
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert.deepEqual(values, ["app.range"]);
});