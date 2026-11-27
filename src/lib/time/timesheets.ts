/**
 * Pay-period timesheets: hours per employee from punches, approval, fixes to shifts, and filling a
 * draft pay run's hours grid.
 */
import { db } from "../db";
import { nextPeriod, periodFor, type Frequency } from "../app/periods";
import { addDays, localDate, startOfLocalDay, weekStart, zonedInstant } from "./clock";
import { periodHours, toHours, type PeriodHours } from "./timesheet";
import { timeSettings } from "./service";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface PeriodChoice {
  label: string;
  start: string;
  end: string;
}

/** The current and previous pay period of each pay schedule, for the timesheet picker. */
export async function periodChoices(companyId: string): Promise<PeriodChoice[]> {
  const schedules = await db.paySchedule.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const out: PeriodChoice[] = [];
  for (const s of schedules) {
    const last = await db.payRun.findFirst({ where: { payScheduleId: s.id, offCycle: false, status: { not: "VOIDED" } }, orderBy: { payday: "desc" } });
    const f = s.frequency as Frequency;
    const next = nextPeriod(f, iso(s.anchorPayday), s.payLagDays, last ? iso(last.payday) : null);
    // A draft run is the period being worked on; otherwise the next one.
    const current = last && last.status === "DRAFT" ? { periodStart: iso(last.periodStart), periodEnd: iso(last.periodEnd), payday: iso(last.payday) } : next;
    out.push({ label: `${s.name}: ${current.periodStart} to ${current.periodEnd} (payday ${current.payday})`, start: current.periodStart, end: current.periodEnd });
    const prev = last && last.status !== "DRAFT" ? periodFor(f, iso(last.payday), s.payLagDays) : null;
    if (prev) out.push({ label: `${s.name}: ${prev.periodStart} to ${prev.periodEnd} (paid ${prev.payday})`, start: prev.periodStart, end: prev.periodEnd });
  }
  return out;
}

export interface EmployeePeriod {
  employee: { id: string; firstName: string; lastName: string; payBasis: string; workState: string; status: string };
  hours: PeriodHours;
  flagged: number;
  timesheet: { approvedAt: Date; approvedById: string; regularMinutes: number; overtimeMinutes: number } | null;
  pendingCorrections: number;
}

/** Hours for every employee with punches in the period (or hourly and active). */
export async function periodSummary(companyId: string, start: string, end: string): Promise<{ rows: EmployeePeriod[]; timeZone: string }> {
  const s = await timeSettings(companyId);
  const tz = s.timeZone;
  const from = startOfLocalDay(weekStart(start, s.weekStartsOn), tz);
  const to = startOfLocalDay(addDays(end, 1), tz);
  const [entries, employees, sheets, pending] = await Promise.all([
    db.timeEntry.findMany({ where: { companyId, clockInAt: { gte: from, lt: to } }, include: { breaks: true } }),
    db.employee.findMany({ where: { companyId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.timesheet.findMany({ where: { companyId, periodStart: start, periodEnd: end } }),
    db.timeCorrection.groupBy({ by: ["employeeId"], where: { companyId, status: "PENDING" }, _count: true }),
  ]);
  const rows: EmployeePeriod[] = [];
  for (const e of employees) {
    const mine = entries.filter((x) => x.employeeId === e.id);
    const inPeriod = mine.filter((x) => { const d = localDate(x.clockInAt, tz); return d >= start && d <= end; });
    if (inPeriod.length === 0 && !(e.payBasis === "HOURLY" && e.status === "ACTIVE")) continue;
    const hours = periodHours(mine, { timeZone: tz, weekStartsOn: s.weekStartsOn, periodStart: start, periodEnd: end, workState: e.workState });
    const ts = sheets.find((x) => x.employeeId === e.id) ?? null;
    rows.push({
      employee: e,
      hours,
      flagged: inPeriod.filter((x) => x.flags.length > 0).length,
      timesheet: ts,
      pendingCorrections: pending.find((p) => p.employeeId === e.id)?._count ?? 0,
    });
  }
  return { rows, timeZone: tz };
}

/** An approved timesheet covering this employee's workday, if any (its shifts are locked). */
export async function lockingTimesheet(employeeId: string, date: string) {
  return db.timesheet.findFirst({ where: { employeeId, periodStart: { lte: date }, periodEnd: { gte: date } } });
}

/** Shift times from a form: a date and HH:MM in and out in the company time zone. An out time before the in time is the next morning. */
export function shiftTimes(date: string, inHm: string, outHm: string, timeZone: string): { clockInAt: Date; clockOutAt: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(inHm) || !/^\d{2}:\d{2}$/.test(outHm)) return null;
  const clockInAt = zonedInstant(date, inHm, timeZone);
  let clockOutAt = zonedInstant(date, outHm, timeZone);
  if (clockOutAt <= clockInAt) clockOutAt = zonedInstant(addDays(date, 1), outHm, timeZone);
  if (clockOutAt.getTime() - clockInAt.getTime() > 24 * 3_600_000) return null;
  return { clockInAt, clockOutAt };
}

/** A meal break of `minutes` in the middle of a shift, or none. */
export function middleMeal(clockInAt: Date, clockOutAt: Date, minutes: number) {
  if (!(minutes > 0)) return [];
  const mid = clockInAt.getTime() + (clockOutAt.getTime() - clockInAt.getTime() - minutes * 60_000) / 2;
  return [{ kind: "MEAL", startAt: new Date(mid), endAt: new Date(mid + minutes * 60_000) }];
}

/**
 * Fill a draft pay run's hourly lines with regular and overtime hours from Time Tracking for the
 * run's period. Returns a summary for the pay run page.
 */
export async function fillPayRunFromTime(payRunId: string): Promise<{ filled: number; lines: string[] }> {
  const run = await db.payRun.findUniqueOrThrow({ where: { id: payRunId }, include: { lines: { include: { employee: true } } } });
  const start = iso(run.periodStart);
  const end = iso(run.periodEnd);
  const { rows } = await periodSummary(run.companyId, start, end);
  const byId = new Map(rows.map((r) => [r.employee.id, r]));
  const notes: string[] = [];
  let filled = 0;
  for (const l of run.lines) {
    const e = l.employee;
    if (e.payBasis !== "HOURLY") continue;
    const r = byId.get(e.id);
    const name = `${e.firstName} ${e.lastName}`;
    if (!r || r.hours.regularMinutes + r.hours.overtimeMinutes === 0) {
      notes.push(`No punches for ${name}: set to 0 hours. Type hours in if they worked.`);
    }
    const regular = toHours(r?.hours.regularMinutes ?? 0);
    const overtime = toHours(r?.hours.overtimeMinutes ?? 0);
    await db.payRunLine.update({ where: { id: l.id }, data: { hours: regular, overtimeHours: overtime } });
    filled++;
    if (r && !r.timesheet) notes.push(`${name}: timesheet not approved yet.`);
    if (r?.pendingCorrections) notes.push(`${name}: ${r.pendingCorrections} missed-punch request${r.pendingCorrections > 1 ? "s" : ""} waiting.`);
    for (const w of r?.hours.warnings ?? []) notes.push(`${name}: ${w}.`);
  }
  for (const r of rows) {
    if (r.employee.payBasis === "HOURLY" && !run.lines.some((l) => l.employeeId === r.employee.id) && r.hours.regularMinutes + r.hours.overtimeMinutes > 0)
      notes.push(`${r.employee.firstName} ${r.employee.lastName} has ${toHours(r.hours.regularMinutes + r.hours.overtimeMinutes)} hours punched but isn't on this pay run.`);
  }
  return { filled, lines: notes };
}
