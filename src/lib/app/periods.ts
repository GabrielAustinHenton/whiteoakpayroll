/**
 * Pay periods for a pay schedule. Dates are ISO strings (YYYY-MM-DD), computed in UTC.
 *
 * - Weekly / bi-weekly: paydays step 7 or 14 days from the anchor payday; the period ends
 *   `payLagDays` before payday and covers the 7 or 14 days before that.
 * - Semi-monthly: paydays on the 15th and the last day of the month, paying the current half
 *   (1st-15th, 16th-end). Common for salaried staff.
 * - Monthly: payday on the last day of the month, paying that month.
 * Paydays that land on a weekend or bank holiday should move earlier; that adjustment is applied
 * by the caller with the filings calendar.
 */
export type Frequency = "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY";

export interface Period {
  periodStart: string;
  periodEnd: string;
  payday: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
const lastOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m + 1, 0)));

function semimonthlyFor(payday: string): Period {
  const d = day(payday);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const mm = String(m + 1).padStart(2, "0");
  if (d.getUTCDate() <= 15) return { periodStart: `${y}-${mm}-01`, periodEnd: `${y}-${mm}-15`, payday: `${y}-${mm}-15` };
  const end = lastOfMonth(y, m);
  return { periodStart: `${y}-${mm}-16`, periodEnd: end, payday: end };
}

function monthlyFor(payday: string): Period {
  const d = day(payday);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { periodStart: `${y}-${String(m + 1).padStart(2, "0")}-01`, periodEnd: lastOfMonth(y, m), payday: lastOfMonth(y, m) };
}

/** The period for a payday on this schedule. */
export function periodFor(freq: Frequency, payday: string, payLagDays: number): Period {
  if (freq === "SEMIMONTHLY") return semimonthlyFor(payday);
  if (freq === "MONTHLY") return monthlyFor(payday);
  const len = freq === "WEEKLY" ? 7 : 14;
  const periodEnd = addDays(payday, -payLagDays);
  return { periodStart: addDays(periodEnd, -(len - 1)), periodEnd, payday };
}

/** The next regular period: the anchor's period if nothing has run, else the one after the last payday. */
export function nextPeriod(freq: Frequency, anchorPayday: string, payLagDays: number, lastPayday: string | null): Period {
  if (!lastPayday || lastPayday < anchorPayday) return periodFor(freq, anchorPayday, payLagDays);
  if (freq === "WEEKLY" || freq === "BIWEEKLY") {
    const step = freq === "WEEKLY" ? 7 : 14;
    let p = anchorPayday;
    while (p <= lastPayday) p = addDays(p, step);
    return periodFor(freq, p, payLagDays);
  }
  if (freq === "SEMIMONTHLY") return semimonthlyFor(addDays(semimonthlyFor(lastPayday).payday, 1));
  return monthlyFor(addDays(monthlyFor(lastPayday).payday, 1));
}

export const PERIODS: Record<Frequency, number> = { WEEKLY: 52, BIWEEKLY: 26, SEMIMONTHLY: 24, MONTHLY: 12 };

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  SEMIMONTHLY: "Twice a month (15th and last day)",
  MONTHLY: "Monthly (last day)",
};

export const DEFAULT_HOURS: Record<Frequency, number> = { WEEKLY: 40, BIWEEKLY: 80, SEMIMONTHLY: 86.67, MONTHLY: 173.33 };
