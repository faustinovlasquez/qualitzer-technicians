import assert from "node:assert/strict";
import { test } from "node:test";
import type { Assignments, DateRange } from "../src/domain/models";
import { locateNotice, noticeDayInRange, noticeSearchRange } from "../src/domain/assignmentSchedule";
import { shiftDate } from "../src/domain/format";
import { scheduleClock } from "../src/domain/weeklySchedule";
import { activeTimersSchema } from "../src/domain/notifications";
import { activeTimerElapsed, activeTimerReference } from "../src/notifications/runningTimers";
import { assignments } from "../server/tests/fixtures";
import { agendaFixture } from "./helpers/agenda-load-lifecycle";

const target = { groupType: "negotiation" as const, groupId: 621, workId: 531 };
function orderWith(day: string | null, schedules?: string[]): Assignments {
  const data = assignments();
  const base = data.groups[0];
  const work = { ...base.works[0], id: "531", scheduledDate: day ?? "2026-01-01",
    ...(schedules ? { schedules: schedules.map((date) => ({ date, generatedAt: "2026-10-06T00:00:00.000Z", queryDates: [date], work: { ...base.works[0], id: "531", scheduledDate: date } })) } : {}) };
  data.groups = day === null && !schedules ? [] : [{ ...base, id: "external-621", type: "external_ot", works: [work] }];
  return data;
}

test("ubica el trabajo del aviso solo si está en el día consultado", () => {
  assert.equal(locateNotice(orderWith("2026-10-06"), target, "2026-10-06")?.work?.id, "531");
  assert.equal(locateNotice(orderWith(null), target, "2026-10-06"), null);
  assert.equal(locateNotice(orderWith(null, ["2026-10-01"]), target, "2026-10-06"), null);
  assert.equal(locateNotice(orderWith("2026-10-06"), { ...target, groupType: "maintenance" }, "2026-10-06"), null);
});

test("busca entre la fecha del aviso y hoy, con un máximo de 31 días", () => {
  assert.deepEqual(noticeSearchRange("2026-09-28", "2026-10-06"), { startDate: "2026-09-28", endDate: "2026-10-06" });
  assert.deepEqual(noticeSearchRange("2026-01-01", "2026-10-06"), { startDate: "2026-09-06", endDate: "2026-10-06" });
  assert.deepEqual(noticeSearchRange("2026-10-09", "2026-10-06"), { startDate: "2026-10-06", endDate: "2026-10-09" });
});

test("elige hoy, si no el día más reciente hasta hoy, si no el más próximo", () => {
  const range: DateRange = { startDate: "2026-09-28", endDate: "2026-10-08" };
  assert.equal(noticeDayInRange(orderWith(null, ["2026-09-30", "2026-10-06", "2026-10-08"]), target, range, "2026-10-06"), "2026-10-06");
  assert.equal(noticeDayInRange(orderWith(null, ["2026-09-30", "2026-10-03", "2026-10-08"]), target, range, "2026-10-06"), "2026-10-03");
  assert.equal(noticeDayInRange(orderWith(null, ["2026-10-08"]), target, range, "2026-10-06"), "2026-10-08");
  assert.equal(noticeDayInRange(orderWith("2026-10-02"), target, range, "2026-10-06"), "2026-10-02");
  assert.equal(noticeDayInRange(orderWith(null, ["2026-09-01"]), target, range, "2026-10-06"), null);
  assert.equal(noticeDayInRange(orderWith("2026-10-02"), { ...target, workId: null }, range, "2026-10-06"), null);
});

test("alerta de cronómetro: tiempo transcurrido, referencia y contrato estricto", () => {
  const startedAt = "2026-10-06T10:00:00.000Z";
  assert.equal(activeTimerElapsed(startedAt, Date.parse(startedAt) + 12 * 60000), "12 min");
  assert.equal(activeTimerElapsed(startedAt, Date.parse(startedAt) + 64 * 60000), "1 h 04 min");
  assert.equal(activeTimerReference({ groupType: "negotiation", groupId: 621, workId: 531, date: null, startedAt, title: null }), "OT #621 · Trabajo #531");
  const item = { groupType: "negotiation", groupId: 621, workId: 531, date: "2026-09-20", startedAt, title: "Cambio de bomba" };
  assert.equal(activeTimersSchema.parse({ items: [item] }).items[0].workId, 531);
  assert.equal(activeTimersSchema.safeParse({ items: [{ ...item, extra: 1 }] }).success, false);
  assert.equal(activeTimersSchema.safeParse({ items: [{ ...item, workId: null }] }).success, false);
});

test("el aviso de cronómetro abre el trabajo aunque esté planificado en otro día", async () => {
  const fixture = agendaFixture();
  try {
    const app = await fixture.loadDay();
    assert.ok(app.session?.tenant);
    const today = scheduleClock(app.session.user.system.timezone)!.day;
    const planned = shiftDate(today, -10);
    const running = shiftDate(today, -3);
    fixture.setNotificationAssignments((range) => {
      const data = range.startDate === range.endDate ? orderWith(range.startDate === running ? running : null) : orderWith(running);
      data.technician.id = app.session!.user.workerId!;
      return data;
    });
    const payload = { tenantOrigin: app.session.tenant.portalOrigin, companyBranchId: 1, eventId: "00000000-0000-4000-8000-000000000531", kind: "RUNNING_TIMER_REMINDER" as const,
      groupType: "negotiation" as const, groupId: 621, workId: 531, date: planned };
    assert.equal(await fixture.openNotification(payload), true);
    const opened = await fixture.flush();
    assert.equal(opened.selected?.workId, "531");
    assert.equal(opened.selected?.queryDate, running);
    assert.equal(opened.noticeError, null);
    assert.deepEqual(fixture.notificationReads.map((range) => `${range.startDate}..${range.endDate}`),
      [`${planned}..${planned}`, `${today}..${today}`, `${planned}..${today}`, `${running}..${running}`]);
  } finally { fixture.unmount(); }
});

test("si el trabajo no aparece en el último mes, el error queda en el aviso y no en la jornada", async () => {
  const fixture = agendaFixture();
  try {
    const app = await fixture.loadDay();
    assert.ok(app.session?.tenant);
    fixture.setNotificationAssignments(() => { const data = orderWith(null); data.technician.id = app.session!.user.workerId!; return data; });
    const payload = { tenantOrigin: app.session.tenant.portalOrigin, companyBranchId: 1, eventId: "00000000-0000-4000-8000-000000000532", kind: "RUNNING_TIMER_REMINDER" as const,
      groupType: "negotiation" as const, groupId: 621, workId: 531, date: "2026-09-20" };
    assert.equal(await fixture.openNotification(payload), false);
    const after = await fixture.flush();
    assert.match(after.noticeError ?? "", /No encontramos ese trabajo/);
    assert.equal(after.error, null);
    assert.equal(after.selected, null);
  } finally { fixture.unmount(); }
});
