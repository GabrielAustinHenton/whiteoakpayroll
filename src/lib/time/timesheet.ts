/**
 * Hours for a pay period from punches: regular and overtime, per day, plus meal break warnings.
 * Pure: no database.
 *
 * Overtime: federal FLSA and CT, MA, OR and NY all pay 1.5x for hours over 40 in a fixed 7-day
 * workweek; none of the launch states has daily overtime. A workweek that starts before the pay
 * period counts its earlier hours toward the 40, so overtime isn't lost at a period boundary.
 * Shifts belong to the workday they start on (company time zone).
 */
import { type EntrySpan, localDate, paidMinutes, weekStart } from "./clock";

export interface Shift extends EntrySpan {
  id: string;
}

export interface PeriodHours {
  regularMinutes: number;
  overtimeMinutes: number;
  /** Paid minutes per day (YYYY-MM-DD) in the period. */
  byDay: Record<string, number>;
  /** Shifts with no punch out yet; not counted. */
  openShifts: number;
  warnings: string[];
}

/**
 * Meal period rules by work state: a meal break of at least `minutes` is required once a shift is
 * longer than `afterHours`. Shown as warnings for the manager; nothing is blocked.
 *   CT: Conn. Gen. Stat. 31-51ii, 30 minutes for 7.5 or more consecutive hours.
 *   MA: M.G.L. c.149 s.100, 30 minutes for more than 6 hours.
 *   NY: Labor Law 162, 30 minutes (noonday) for shifts over 6 hours spanning 11 AM to 2 PM.
 *   OR: OAR 839-020-0050, 30 minutes for shifts of 6 hours or more (plus paid 10-minute rest per 4 hours).
 */
export const MEAL_RULES: Record<string, { afterHours: number; minutes: number; cite: string }> = {
  CT: { afterHours: 7.5, minutes: 30, cite: "Connecticut requires a 30-minute meal break after 7.5 hours" },
  MA: { afterHours: 6, minutes: 30, cite: "Massachusetts requires a 30-minute meal break for shifts over 6 hours" },
  NY: { afterHours: 6, minutes: 30, cite: "New York requires a 30-minute meal break for shifts over 6 hours" },
  OR: { afterHours: 6, minutes: 30, cite: "Oregon requires a 30-minute meal break for shifts of 6 hours or more" },
};

export function mealWarning(shift: EntrySpan, state: string): string | null {
  const rule = MEAL_RULES[state];
  if (!rule || !shift.clockOutAt) return null;
  const hours = (shift.clockOutAt.getTime() - shift.clockInAt.getTime()) / 3_600_000;
  if (hours <= rule.afterHours) return null;
  const longest = Math.max(0, ...shift.breaks.filter((b) => b.kind === "MEAL" && b.endAt).map((b) => (b.endAt!.getTime() - b.startAt.getTime()) / 60_000));
  if (longest >= rule.minutes - 0.5) return null;
  return longest > 0 ? `meal break only ${Math.round(longest)} minutes (${rule.cite})` : `no meal break (${rule.cite})`;
}

/**
 * shifts must include every shift from the start of the workweek holding periodStart through
 * periodEnd, so earlier hours in that week count toward 40.
 */
export function periodHours(shifts: Shift[], opts: { timeZone: string; weekStartsOn: number; periodStart: string; periodEnd: string; workState: string; now?: Date }): PeriodHours {
  const { timeZone, weekStartsOn, periodStart, periodEnd, workState } = opts;
  const out: PeriodHours = { regularMinutes: 0, overtimeMinutes: 0, byDay: {}, openShifts: 0, warnings: [] };
  const sorted = [...shifts].sort((a, b) => a.clockInAt.getTime() - b.clockInAt.getTime());
  const weekTotals = new Map<string, number>();
  for (const s of sorted) {
    const date = localDate(s.clockInAt, timeZone);
    const inPeriod = date >= periodStart && date <= periodEnd;
    if (!s.clockOutAt) {
      if (inPeriod) out.openShifts++;
      continue;
    }
    const minutes = paidMinutes(s);
    const wk = weekStart(date, weekStartsOn);
    const before = weekTotals.get(wk) ?? 0;
    weekTotals.set(wk, before + minutes);
    if (!inPeriod) continue;
    const ot = Math.max(0, before + minutes - 2400) - Math.max(0, before - 2400);
    out.overtimeMinutes += ot;
    out.regularMinutes += minutes - ot;
    out.byDay[date] = (out.byDay[date] ?? 0) + minutes;
    const meal = mealWarning(s, workState);
    if (meal) out.warnings.push(`${date}: ${meal}`);
  }
  if (out.openShifts) out.warnings.push(`${out.openShifts} shift${out.openShifts > 1 ? "s have" : " has"} no punch out yet and ${out.openShifts > 1 ? "aren't" : "isn't"} counted`);
  return out;
}

export const toHours = (m: number) => Math.round((m / 60) * 100) / 100;
