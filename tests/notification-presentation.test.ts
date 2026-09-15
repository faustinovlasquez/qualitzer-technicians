import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { NotificationInboxItem } from "../src/domain/notifications";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../src/notifications/notificationSafety";
import { notificationCounts, notificationDeliveryLabels, notificationErrorMessage, notificationKinds, notificationNoticeMessage, notificationSupportCode, notificationTimestamp, notificationWorkDate, notificationWorkReference, sameNotificationPreferences } from "../src/screens/notifications/notificationPresentation";

function item(change: Partial<NotificationInboxItem["data"]> = {}): NotificationInboxItem {
  return {
    id: "00000000-0000-4000-8000-000000000001", kind: "WORK_TECHNICIAN_ASSIGNED", state: "pending", readAt: null, lastFailure: null,
    createdAt: "2026-09-12T12:00:00Z",
    data: { tenantOrigin: "https://example.com", companyBranchId: 1, eventId: "00000000-0000-4000-8000-000000000001", kind: "WORK_TECHNICIAN_ASSIGNED", groupType: "work", groupId: 42, workId: 42, date: "2026-09-12", ...change },
  };
}

test("unknown server counts are not replaced with zero or a partial inbox length", () => {
  assert.equal(notificationCounts(null, null), "… sin leer · … en total");
  assert.equal(notificationCounts(undefined, undefined), "… sin leer · … en total");
  assert.equal(notificationCounts(0, 52), "0 sin leer · 52 en total");
  assert.equal(notificationCounts(34, null), "34 sin leer · … en total");
});

test("references distinguish OT, maintenance, root work and parent-only assignments", () => {
  assert.equal(notificationWorkReference(item()), "Trabajo #42");
  assert.equal(notificationWorkReference(item({ groupType: "negotiation", groupId: 8, workId: 9 })), "OT #8 · Trabajo #9");
  assert.equal(notificationWorkReference(item({ groupType: "negotiation", groupId: 8, workId: null })), "OT #8");
  assert.equal(notificationWorkReference(item({ groupType: "maintenance", groupId: 8, workId: 9 })), "Mantenimiento #8 · Trabajo #9");
  assert.equal(notificationWorkReference(item({ groupType: "maintenance", groupId: 8, workId: null })), "Mantenimiento #8");
  assert.equal(notificationWorkReference({ ...item(), kind: "MOBILE_PUSH_TEST" }), null);
});

test("work date uses the branch calendar date, not the phone timezone", () => {
  assert.match(notificationWorkDate("2026-09-12") ?? "", /12/);
  assert.match(notificationWorkDate("2026-09-12") ?? "", /2026/);
  assert.equal(notificationWorkDate(null), null);
  assert.equal(notificationWorkDate("2026-02-31"), null);
  assert.equal(notificationWorkDate("not-a-date"), null);
});

test("relative timestamps handle recent, yesterday, future and invalid values honestly", () => {
  const now = new Date(2026, 8, 12, 12, 0, 0).getTime();
  assert.equal(notificationTimestamp(new Date(now - 30_000).toISOString(), now), "Ahora");
  assert.equal(notificationTimestamp(new Date(now - 180_000).toISOString(), now), "Hace 3 min");
  assert.match(notificationTimestamp(new Date(now - 3_600_000).toISOString(), now), /^Hoy,/);
  assert.match(notificationTimestamp(new Date(2026, 8, 11, 12).toISOString(), now), /^Ayer,/);
  assert.doesNotMatch(notificationTimestamp(new Date(now + 180_000).toISOString(), now), /Hace -|Ahora/);
  assert.equal(notificationTimestamp("invalid", now), "Fecha no disponible");
});

test("provider receipts do not claim phone delivery", () => {
  assert.equal(notificationDeliveryLabels.receipt_ok, "Procesado por el proveedor");
  for (const label of Object.values(notificationDeliveryLabels)) assert.doesNotMatch(label, /entregad|leíd|mostrad/i);
  for (const kind of Object.values(notificationKinds)) assert.doesNotMatch(kind.title, /MOBILE_|WORK_|RUNNING_/);
});

test("errors have friendly text and only safe support identifiers may be displayed", () => {
  assert.match(notificationErrorMessage("MOBILE_PUSH_PERMISSION_BLOCKED"), /ajustes/);
  assert.match(notificationErrorMessage("MOBILE_PUSH_TEST_RATE_LIMITED"), /5 pruebas/);
  assert.match(notificationErrorMessage("MOBILE_PUSH_DELETE_UNSUPPORTED"), /actualización/);
  const privateMessage = "upstream response https://private.example?token=secret";
  assert.doesNotMatch(notificationErrorMessage(privateMessage), /secret|upstream|private/);
  assert.equal(notificationSupportCode(privateMessage), null);
  assert.equal(notificationSupportCode("MOBILE_PUSH_PERMISSION_BLOCKED"), "MOBILE_PUSH_PERMISSION_BLOCKED");
  assert.equal(notificationSupportCode("EXPO_INVALID_CREDENTIALS"), "EXPO_INVALID_CREDENTIALS");
});

test("unknown notices are never rendered raw and queued tests never imply delivery", () => {
  assert.doesNotMatch(notificationNoticeMessage("private server body"), /private server body/);
  assert.match(notificationNoticeMessage("Prueba pendiente en el servidor. Respeta el horario silencioso; no confirma entrega al teléfono."), /pendiente de envío/);
  assert.equal(notificationNoticeMessage("Preferencias guardadas en el servidor."), "Tus preferencias se han guardado.");
});

test("dirty comparison covers all six preference fields without changing legacy values", () => {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, repeatEveryMinutes: 60 as const };
  assert.equal(sameNotificationPreferences(preferences, { ...preferences }), true);
  const changes = [
    { assignments: false }, { timers: false }, { remindAfterMinutes: 120 as const }, { repeatEveryMinutes: 240 as const },
    { quietHoursStart: "00:00" }, { quietHoursEnd: "00:00" },
  ];
  for (const change of changes) assert.equal(sameNotificationPreferences(preferences, { ...preferences, ...change }), false);
  assert.equal(preferences.repeatEveryMinutes, 60);
});

const screenSource = (name: string): string => readFileSync(new URL(`../src/screens/notifications/${name}`, import.meta.url), "utf8");

test("inbox source uses server filtering, safe refresh colors and no preferences", () => {
  const source = screenSource("NotificationCenterScreen.tsx");
  assert.match(source, /client\.loadInbox\(more, filter\)/);
  assert.doesNotMatch(source, /inbox\.filter|savePreferences|NotificationStatusCard|Switch|sendTest/);
  assert.match(source, /colors=\{\[palette\.primary\]\}/);
  assert.match(source, /PrivateModal/);
  assert.match(source, /await client\.deleteNotification\(deleteTarget\.id\)/);
  assert.match(source, /if \(removed\) setDeleteTarget\(null\)/);
  assert.match(source, /state\.canDelete === true/);
});

test("settings source preserves drafts across client replacements and saves only explicitly", () => {
  const source = screenSource("NotificationSettingsScreen.tsx");
  assert.match(source, /key=\{props\.notifications\.storageKey\}/);
  assert.match(source, /dirtyRef\.current\) return/);
  assert.match(source, /latestClient\.current !== client/);
  assert.match(source, /savedRevision !== revision\.current/);
  assert.match(source, /quietHoursStart: "00:00", quietHoursEnd: "00:00"/);
  assert.match(source, /Valor guardado: 60 min/);
  assert.match(source, /PrivateModal/);
  assert.doesNotMatch(source, /scheduleNotification|from "expo-notifications"|Modal.*from "react-native"/);
});