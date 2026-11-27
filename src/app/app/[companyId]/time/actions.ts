"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWrite } from "@/lib/auth/session";
import { audit, recalculate } from "@/lib/app/payroll-service";
import { TIME_ZONES, localDate } from "@/lib/time/clock";
import { fillPayRunFromTime, lockingTimesheet, middleMeal, periodSummary, shiftTimes } from "@/lib/time/timesheets";
import { timeSettings } from "@/lib/time/service";
import { str } from "@/components/ui";

const go = (path: string, msg: { error?: string; ok?: string } = {}): never => {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(path + q);
};

function readLocation(form: FormData) {
  const latitude = Number(str(form.get("latitude")));
  const longitude = Number(str(form.get("longitude")));
  const radiusMeters = Math.round(Number(str(form.get("radiusMeters"))));
  const name = str(form.get("name"));
  if (!name) return { error: "Give the location a name, like \"Main shop\"." };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0))
    return { error: "Place the pin on the map (search the address, or tap the map)." };
  if (!(radiusMeters >= 30 && radiusMeters <= 5000)) return { error: "Choose a radius between 30 and 5,000 meters (about 100 feet to 3 miles)." };
  return { data: { name, address: str(form.get("address")) || null, latitude, longitude, radiusMeters } };
}

export async function saveLocation(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const back = `/app/${companyId}/time/locations`;
  const r = readLocation(form);
  if (r.error) go(back, { error: r.error });
  const locationId = str(form.get("locationId"));
  if (locationId) {
    await db.workLocation.update({ where: { id: (await db.workLocation.findFirstOrThrow({ where: { id: locationId, companyId } })).id }, data: r.data! });
    await audit(user.id, companyId, "time.location_updated", { locationId, ...r.data! });
    go(back, { ok: `Saved ${r.data!.name}.` });
  }
  const created = await db.workLocation.create({ data: { companyId, ...r.data! } });
  await audit(user.id, companyId, "time.location_added", { locationId: created.id, ...r.data! });
  go(back, { ok: `Added ${created.name}. Employees can punch within ${created.radiusMeters} meters of the pin.` });
}

export async function setLocationActive(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const loc = await db.workLocation.findFirstOrThrow({ where: { id: str(form.get("locationId")), companyId } });
  const active = str(form.get("active")) === "true";
  await db.workLocation.update({ where: { id: loc.id }, data: { active } });
  await audit(user.id, companyId, active ? "time.location_reactivated" : "time.location_archived", { locationId: loc.id });
  go(`/app/${companyId}/time/locations`, { ok: active ? `${loc.name} is active again.` : `${loc.name} archived. Past punches keep it.` });
}

export async function saveTimeSettings(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  await timeSettings(companyId);
  const mode = str(form.get("geofenceMode"));
  const tz = str(form.get("timeZone"));
  const acc = Math.round(Number(str(form.get("maxAccuracyMeters"))));
  const week = Number(str(form.get("weekStartsOn")));
  const data = {
    geofenceMode: mode === "FLAG" ? "FLAG" : mode === "OFF" ? "OFF" : "BLOCK",
    maxAccuracyMeters: acc >= 10 && acc <= 1000 ? acc : 100,
    requirePhoto: form.get("requirePhoto") === "on",
    timeZone: TIME_ZONES.some(([z]) => z === tz) ? tz : "America/New_York",
    weekStartsOn: Number.isInteger(week) && week >= 0 && week <= 6 ? week : 0,
  } as const;
  await db.timeSettings.update({ where: { companyId }, data });
  await audit(user.id, companyId, "time.settings_updated", data);
  go(`/app/${companyId}/time/settings`, { ok: "Time Tracking settings saved." });
}

/* ---------- Fixing shifts, missed-punch requests and timesheet approval ---------- */

const backTo = (form: FormData, companyId: string) => {
  const b = str(form.get("back"));
  return b.startsWith(`/app/${companyId}/time`) ? b.split("?")[0] : `/app/${companyId}/time`;
};

async function lockedMessage(employeeId: string, dates: string[]) {
  for (const d of dates) {
    const t = await lockingTimesheet(employeeId, d);
    if (t) return `That day is in an approved timesheet (${t.periodStart} to ${t.periodEnd}). Unapprove it on Timesheets first.`;
  }
  return null;
}

/** Manager adds a shift someone forgot to punch. */
export async function addShift(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const back = backTo(form, companyId);
  const s = await timeSettings(companyId);
  const e = await db.employee.findFirstOrThrow({ where: { id: str(form.get("employeeId")), companyId } });
  const date = str(form.get("date"));
  const t = shiftTimes(date, str(form.get("in")), str(form.get("out")), s.timeZone);
  if (!t) go(back, { error: "Enter the date and both times." });
  const locked = await lockedMessage(e.id, [date]);
  if (locked) go(back, { error: locked });
  const meal = Math.max(0, Math.round(Number(str(form.get("mealMinutes"))) || 0));
  const entry = await db.timeEntry.create({
    data: {
      companyId, employeeId: e.id, clockInAt: t!.clockInAt, clockOutAt: t!.clockOutAt, source: "MANAGER",
      inPunch: { source: "MANAGER", by: user.id }, outPunch: { source: "MANAGER", by: user.id }, flags: ["EDITED"],
      note: str(form.get("note")) || null,
      breaks: { create: middleMeal(t!.clockInAt, t!.clockOutAt, meal) },
    },
  });
  await audit(user.id, companyId, "time.shift_added", { entryId: entry.id, employeeId: e.id, clockInAt: t!.clockInAt, clockOutAt: t!.clockOutAt, mealMinutes: meal });
  go(back, { ok: `Added a shift for ${e.firstName} ${e.lastName}.` });
}

/** Manager changes a shift's punch in and out times. The original times stay in the audit log. */
export async function editShift(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const back = backTo(form, companyId);
  const s = await timeSettings(companyId);
  const entry = await db.timeEntry.findFirstOrThrow({ where: { id: str(form.get("entryId")), companyId }, include: { employee: true } });
  const date = str(form.get("date"));
  const t = shiftTimes(date, str(form.get("in")), str(form.get("out")), s.timeZone);
  if (!t) go(back, { error: "Enter the date and both times." });
  const locked = await lockedMessage(entry.employeeId, [localDate(entry.clockInAt, s.timeZone), date]);
  if (locked) go(back, { error: locked });
  await db.timeEntry.update({
    where: { id: entry.id },
    data: {
      clockInAt: t!.clockInAt, clockOutAt: t!.clockOutAt, outPunch: entry.outPunch ?? { source: "MANAGER", by: user.id },
      flags: [...new Set([...entry.flags.filter((f) => f !== "LONG_SHIFT"), "EDITED"])],
      note: str(form.get("note")) || entry.note,
    },
  });
  await db.timeBreak.updateMany({ where: { entryId: entry.id, endAt: null }, data: { endAt: t!.clockOutAt } });
  await audit(user.id, companyId, "time.shift_edited", { entryId: entry.id, from: { clockInAt: entry.clockInAt, clockOutAt: entry.clockOutAt }, to: t, note: str(form.get("note")) });
  go(back, { ok: `Updated ${entry.employee.firstName} ${entry.employee.lastName}'s shift.` });
}

export async function deleteShift(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const back = backTo(form, companyId);
  const s = await timeSettings(companyId);
  const entry = await db.timeEntry.findFirstOrThrow({ where: { id: str(form.get("entryId")), companyId } });
  const locked = await lockedMessage(entry.employeeId, [localDate(entry.clockInAt, s.timeZone)]);
  if (locked) go(back, { error: locked });
  await db.timeEntry.delete({ where: { id: entry.id } });
  await audit(user.id, companyId, "time.shift_deleted", { entryId: entry.id, employeeId: entry.employeeId, clockInAt: entry.clockInAt, clockOutAt: entry.clockOutAt, inPunch: entry.inPunch, flags: entry.flags });
  go(back, { ok: "Shift deleted (kept in the audit log)." });
}

/** Approve or decline an employee's missed-punch request. */
export async function decideCorrection(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const back = backTo(form, companyId);
  const s = await timeSettings(companyId);
  const c = await db.timeCorrection.findFirstOrThrow({ where: { id: str(form.get("correctionId")), companyId, status: "PENDING" }, include: { employee: true } });
  const approve = str(form.get("decision")) === "approve";
  const name = `${c.employee.firstName} ${c.employee.lastName}`;
  if (approve) {
    const locked = await lockedMessage(c.employeeId, [localDate(c.clockInAt, s.timeZone)]);
    if (locked) go(back, { error: locked });
    const entry = c.entryId ? await db.timeEntry.findFirst({ where: { id: c.entryId, companyId } }) : null;
    if (entry) {
      await db.timeEntry.update({
        where: { id: entry.id },
        data: { clockInAt: c.clockInAt, clockOutAt: c.clockOutAt, outPunch: entry.outPunch ?? { source: "CORRECTION", correctionId: c.id }, flags: [...new Set([...entry.flags.filter((f) => f !== "LONG_SHIFT"), "EDITED"])] },
      });
      await db.timeBreak.updateMany({ where: { entryId: entry.id, endAt: null }, data: { endAt: c.clockOutAt } });
      if (c.mealMinutes > 0 && !(await db.timeBreak.count({ where: { entryId: entry.id, kind: "MEAL" } })))
        await db.timeBreak.createMany({ data: middleMeal(c.clockInAt, c.clockOutAt, c.mealMinutes).map((b) => ({ ...b, entryId: entry.id })) });
    } else {
      await db.timeEntry.create({
        data: {
          companyId, employeeId: c.employeeId, clockInAt: c.clockInAt, clockOutAt: c.clockOutAt, source: "MANAGER",
          inPunch: { source: "CORRECTION", correctionId: c.id }, outPunch: { source: "CORRECTION", correctionId: c.id }, flags: ["EDITED"],
          note: c.reason, breaks: { create: middleMeal(c.clockInAt, c.clockOutAt, c.mealMinutes) },
        },
      });
    }
  }
  await db.timeCorrection.update({ where: { id: c.id }, data: { status: approve ? "APPROVED" : "DECLINED", decidedById: user.id, decidedAt: new Date(), decisionNote: str(form.get("decisionNote")) || null } });
  await audit(user.id, companyId, approve ? "time.correction_approved" : "time.correction_declined", { correctionId: c.id, employeeId: c.employeeId });
  go(back, { ok: approve ? `Fixed ${name}'s punch.` : `Declined ${name}'s request.` });
}

/** Approve the timesheets of the ticked employees for a pay period, locking their shifts. */
export async function approveTimesheets(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const start = str(form.get("start"));
  const end = str(form.get("end"));
  const back = `/app/${companyId}/time/timesheets?start=${start}&end=${end}`;
  const ids = form.getAll("employeeId").map(String);
  if (!ids.length) redirect(`${back}&error=${encodeURIComponent("Tick the timesheets to approve.")}`);
  const { rows } = await periodSummary(companyId, start, end);
  let n = 0;
  for (const r of rows.filter((x) => ids.includes(x.employee.id) && !x.timesheet)) {
    if (r.hours.openShifts) continue;
    await db.timesheet.create({ data: { companyId, employeeId: r.employee.id, periodStart: start, periodEnd: end, regularMinutes: r.hours.regularMinutes, overtimeMinutes: r.hours.overtimeMinutes, approvedById: user.id } });
    n++;
  }
  await audit(user.id, companyId, "time.timesheets_approved", { start, end, count: n });
  const skipped = ids.length - n;
  redirect(`${back}&ok=${encodeURIComponent(`Approved ${n} timesheet${n === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped (already approved, or a shift has no punch out).` : ""}`)}`);
}

export async function unapproveTimesheet(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const t = await db.timesheet.findFirstOrThrow({ where: { id: str(form.get("timesheetId")), companyId } });
  await db.timesheet.delete({ where: { id: t.id } });
  await audit(user.id, companyId, "time.timesheet_unapproved", { employeeId: t.employeeId, start: t.periodStart, end: t.periodEnd });
  redirect(`/app/${companyId}/time/timesheets?start=${t.periodStart}&end=${t.periodEnd}&ok=${encodeURIComponent("Timesheet reopened. Its shifts can be changed again.")}`);
}

/** Fill a draft pay run's hours grid from Time Tracking. */
export async function fillHoursFromTime(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const payRunId = str(form.get("payRunId"));
  const here = `/app/${companyId}/payroll/${payRunId}`;
  const run = await db.payRun.findFirstOrThrow({ where: { id: payRunId, companyId } });
  if (run.status !== "DRAFT") go(here, { error: "This pay run is already approved." });
  const r = await fillPayRunFromTime(payRunId);
  await recalculate(payRunId);
  await audit(user.id, companyId, "payrun.hours_from_time_tracking", { payRunId, filled: r.filled });
  const summary = [`Filled hours for ${r.filled} hourly employee${r.filled === 1 ? "" : "s"} from Time Tracking (overtime over 40 a week).`, ...r.lines].join("\n");
  redirect(`${here}?imported=${encodeURIComponent(summary.slice(0, 1800))}`);
}
