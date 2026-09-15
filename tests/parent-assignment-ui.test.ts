import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import type { AssignmentGroup } from "../src/domain/models";
import { matchesOrderSearch } from "../src/domain/assignmentCodes";
import { assignments, user } from "../server/tests/fixtures";
import type { DashboardScreenProps } from "../src/screens/DashboardScreen";
import { durableReactFixture, elements, uiModule, uiSnapshot } from "./helpers/durable-ui";
import { agendaFixture } from "./helpers/agenda-load-lifecycle";

test("main navigation returns to the preceding screen and home resets its history", async () => {
  const fixture = agendaFixture();
  try {
    let app = await fixture.loadDay();
    app.setTab("profile"); app = await fixture.flush();
    app.setTab("notifications"); app = await fixture.flush();
    app.backTab(); app = await fixture.flush();
    assert.equal(app.tab, "profile");
    app.homeTab(); app = await fixture.flush();
    assert.equal(app.tab, "today");
    app.backTab(); app = await fixture.flush();
    assert.equal(app.tab, "today");
  } finally { fixture.unmount(); }
});

for (const type of ["internal_maintenance", "external_ot"] as const) {
  test(`${type}: actual app hook opens an authorized parent-only notification`, async () => {
    const fixture = agendaFixture();
    try {
      const app = await fixture.loadDay();
      assert.ok(app.session?.tenant);
      const data = assignments();
      const id = type === "internal_maintenance" ? "maintenance-12" : "external-12";
      data.technician.id = app.session.user.workerId!;
      data.groups = [{ ...data.groups[0], id, type, works: [] }];
      fixture.setNotificationAssignments(data);
      const payload = { tenantOrigin: app.session.tenant.portalOrigin, companyBranchId: 1, eventId: "00000000-0000-4000-8000-000000000012", kind: "WORK_TECHNICIAN_ASSIGNED" as const, groupType: type === "internal_maintenance" ? "maintenance" as const : "negotiation" as const, groupId: 12, workId: null, date: "2026-09-12" };
      assert.equal(await fixture.openNotification({ ...payload, companyBranchId: 2 }), false);
      assert.equal(await fixture.openNotification(payload), true);
      const opened = await fixture.flush();
      assert.equal(opened.selectedOrder?.id, id);
      assert.equal(opened.selected, null);
      assert.equal(opened.data?.groups[0].works.length, 0);
    } finally { fixture.unmount(); }
  });
  test(`${type}: empty assigned parent remains visible and opens without a fabricated work`, () => {
    const hooks = durableReactFixture();
    const data = assignments();
    const group: AssignmentGroup = { ...data.groups[0], type, id: type === "internal_maintenance" ? "maintenance-12" : "external-12", title: "Revision de bateria", works: [], scheduledDate: "2026-09-12", status: "pending" };
    data.groups = [group];
    const opened: string[] = [];
    const props: DashboardScreenProps = { data, user: user(), range: { startDate: "2026-09-12", endDate: "2026-09-12" }, view: "today", loading: false, error: null,
      offline: { ...uiSnapshot(), coverage: [{ date: "2026-09-12", branchId: 1, fetchedAt: 1 }] }, companyBranchId: 1,
      onRefresh() {}, onRangeChange() {}, onOpenWork() { assert.fail("NO_CHILD_AVAILABLE"); }, onOpenGroup(parent) { opened.push(parent.id); }, async onWorkStatus() { assert.fail("NO_TIMER_AVAILABLE"); } };
    const module = uiModule<{ DashboardScreen(props: DashboardScreenProps): ReactNode }>("screens/DashboardScreen.tsx", hooks, {
      "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", RefreshControl: "RefreshControl", ScrollView: "ScrollView", StyleSheet: { create: (styles: object) => styles }, Text: "Text", TextInput: "TextInput", View: "View", useWindowDimensions: () => ({ width: 390 }) },
      "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {} } },
      "../ui/components": { Badge: "Badge", Button: "Button", Card: "Card", EmptyState: "EmptyState", IconButton: "IconButton", SectionTitle: "SectionTitle" },
      "./orders/AssignmentOrderCard": { AssignmentOrderCard: "AssignmentOrderCard" },
      "./orders/AssignmentWorkCard": { AssignmentWorkCard: "AssignmentWorkCard" },
      "./schedule/WeeklySchedule": { WeeklySchedule: "WeeklySchedule" },
      "./notifications/RunningTimersNotice": { RunningTimersNotice: "RunningTimersNotice" },
    });
    const render = () => hooks.render(() => module.DashboardScreen(props));
    let tree = render();
    assert.equal(elements(tree, "AssignmentOrderCard").length, 0, "Trabajos must not render maintenance or OT cards");
    const tabs = elements<{ accessibilityRole?: string; accessibilityLabel?: string; onPress(): void }>(tree, "Pressable");
    const tab = tabs.find(({ props }) => props.accessibilityRole === "tab" && props.accessibilityLabel?.startsWith(type === "internal_maintenance" ? "Mantenimientos" : "OTs"));
    assert.ok(tab);
    tab.props.onPress();
    tree = render();
    const cards = elements<{ group: AssignmentGroup; matchingWorkCount: number; onOpenGroup: DashboardScreenProps["onOpenGroup"] }>(tree, "AssignmentOrderCard");
    assert.equal(cards.length, 1);
    assert.equal(cards[0].props.matchingWorkCount, 0);
    assert.equal(cards[0].props.group.works.length, 0);
    cards[0].props.onOpenGroup(cards[0].props.group);
    assert.deepEqual(opened, [group.id]);
    assert.equal(elements(tree, "AssignmentWorkCard").length, 0);
    assert.equal(elements(tree, "EmptyState").length, 0);
    const search = elements<{ onChangeText(text: string): void }>(tree, "TextInput")[0];
    search.props.onChangeText("bateria");
    assert.equal(elements(render(), "AssignmentOrderCard").length, 1);
    search.props.onChangeText("otro equipo");
    assert.equal(elements(render(), "AssignmentOrderCard").length, 0);
    search.props.onChangeText("");
    group.scheduledDate = "2026-10-01";
    tree = render();
    assert.equal(elements(tree, "AssignmentOrderCard").length, 0);
    assert.equal(matchesOrderSearch(group, "REVISION"), true);
    hooks.unmount();
  });
}