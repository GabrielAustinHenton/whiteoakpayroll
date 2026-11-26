/**
 * Business-day calendar for tax deposit due dates. Dates are ISO strings (YYYY-MM-DD) in local
 * calendar terms; no time zones are involved.
 *
 * Federal deposits due on a Saturday, Sunday or legal holiday in the District of Columbia move to
 * the next business day (IRC 7503; Pub. 15 section 11). We use the federal holiday list plus DC
 * Emancipation Day (April 16), observed on the nearest weekday.
 */

export function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(d: string): number {
  return parse(d).getUTCDay();
}

function nthWeekday(year: number, month: number, dow: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (dow - first.getUTCDay() + 7) % 7;
  return fmt(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)));
}

function lastWeekday(year: number, month: number, dow: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - dow + 7) % 7;
  return fmt(new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset)));
}

/** A fixed-date holiday falling on Saturday is observed Friday; on Sunday, Monday. */
function observed(d: string): string {
  const w = weekday(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d;
}

const cache = new Map<number, Set<string>>();

/** Federal legal holidays (5 U.S.C. 6103) plus DC Emancipation Day, as observed. */
export function holidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const p = (m: number, d: number) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const set = new Set<string>([
    observed(p(1, 1)),
    nthWeekday(year, 1, 1, 3), // MLK Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    observed(p(4, 16)), // DC Emancipation Day
    lastWeekday(year, 5, 1), // Memorial Day
    observed(p(6, 19)),
    observed(p(7, 4)),
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(p(11, 11)),
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(p(12, 25)),
  ]);
  // New Year's Day of the following year observed on Dec 31.
  const nextNy = observed(`${year + 1}-01-01`);
  if (nextNy.startsWith(String(year))) set.add(nextNy);
  cache.set(year, set);
  return set;
}

export function isBusinessDay(d: string): boolean {
  const w = weekday(d);
  return w !== 0 && w !== 6 && !holidays(Number(d.slice(0, 4))).has(d);
}

export function nextBusinessDay(d: string): string {
  let x = d;
  while (!isBusinessDay(x)) x = addDays(x, 1);
  return x;
}

/** The nth business day after `d` (not counting `d`). */
export function addBusinessDays(d: string, n: number): string {
  let x = d;
  for (let i = 0; i < n; i++) x = nextBusinessDay(addDays(x, 1));
  return x;
}

export function lastDayOfMonth(year: number, month: number): string {
  return fmt(new Date(Date.UTC(year, month, 0)));
}

export function quarterOf(d: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  return { year: Number(d.slice(0, 4)), quarter: (Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** Last day of the month after the quarter (the usual quarterly return due date), before business-day rollover. */
export function quarterReturnDue(year: number, quarter: 1 | 2 | 3 | 4): string {
  return quarter === 4 ? `${year + 1}-01-31` : lastDayOfMonth(year, quarter * 3 + 1);
}
