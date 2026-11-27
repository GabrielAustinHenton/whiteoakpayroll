/**
 * Clock math for time entries. Pure: no database. Times are Date (UTC instants); workdays and
 * workweeks are taken in the company's time zone.
 */

export interface BreakSpan {
  kind: string; // MEAL (unpaid) | REST (paid)
  startAt: Date;
  endAt: Date | null;
}

export interface EntrySpan {
  clockInAt: Date;
  clockOutAt: Date | null;
  breaks: BreakSpan[];
}

const MIN = 60_000;

/** Paid minutes in a shift: clock in to clock out (or now, if still in) less unpaid meal breaks. */
export function paidMinutes(e: EntrySpan, now = new Date()): number {
  const end = e.clockOutAt ?? now;
  const total = Math.max(0, end.getTime() - e.clockInAt.getTime());
  let unpaid = 0;
  for (const b of e.breaks) {
    if (b.kind !== "MEAL") continue;
    const bs = Math.max(b.startAt.getTime(), e.clockInAt.getTime());
    const be = Math.min((b.endAt ?? end).getTime(), end.getTime());
    unpaid += Math.max(0, be - bs);
  }
  return Math.round(Math.max(0, total - unpaid) / MIN);
}

export const hoursFromMinutes = (m: number) => Math.round((m / 60) * 100) / 100;

/** "7h 05m". */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h}h ${mm}m`;
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(d: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** "9:05 AM" in the time zone. */
export function localTime(d: Date, timeZone: string): string {
  return d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

/** "Mon, Nov 30" for a YYYY-MM-DD date. */
export function dayLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** Offset of a time zone from UTC at an instant, in minutes (e.g. -300 for New York in winter). */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / MIN);
}

/** The instant a wall-clock time (YYYY-MM-DD, HH:MM) happens in a time zone. */
export function zonedInstant(ymd: string, hm: string, timeZone: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMinutes(new Date(guess), timeZone) * MIN;
  t = guess - offsetMinutes(new Date(t), timeZone) * MIN; // second pass settles DST edges
  return new Date(t);
}

/** Start of the day (midnight) in the time zone. */
export const startOfLocalDay = (ymd: string, timeZone: string) => zonedInstant(ymd, "00:00", timeZone);

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day (YYYY-MM-DD) of the workweek holding a date. weekStartsOn: 0 = Sunday. */
export function weekStart(ymd: string, weekStartsOn: number): string {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return addDays(ymd, -((dow - weekStartsOn + 7) % 7));
}

/** Default time zone for a launch state. */
export function stateTimeZone(state: string): string {
  return state === "OR" ? "America/Los_Angeles" : "America/New_York";
}

export const TIME_ZONES: [string, string][] = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
];
