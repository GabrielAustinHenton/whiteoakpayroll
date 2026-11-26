import type { Cents } from "../money";
import { dollars } from "../money";
import type { Source } from "../tax-engine/types";
import { addBusinessDays, addDays, lastDayOfMonth, nextBusinessDay, quarterOf, quarterReturnDue, weekday } from "./calendar";

/**
 * Tax deposit schedules. Each function returns the due date for taxes from one payday.
 */

export const FEDERAL_DEPOSIT_SOURCE: Source = {
  cite: "IRS Pub. 15 (2026), section 11, Depositing Taxes",
  url: "https://www.irs.gov/publications/p15",
  readOn: "2026-11-26",
  verified: false,
  note: "Long-standing rules (lookback $50,000, $100,000 next-day, $2,500 quarterly de minimis, FUTA $500); re-read the 2026 text.",
};

export type FederalSchedule = "monthly" | "semiweekly";

/**
 * Federal 941 depositor status from the lookback period (July 1 two years back to June 30 of the
 * prior year). $50,000 or less (or a new employer) = monthly; more = semiweekly.
 */
export function federalScheduleFor(lookbackLiability: Cents | null): FederalSchedule {
  return lookbackLiability === null || lookbackLiability <= dollars(50_000) ? "monthly" : "semiweekly";
}

/** Due date for federal income tax, Social Security and Medicare from one payday. */
export function federal941DepositDue(payday: string, schedule: FederalSchedule): string {
  if (schedule === "monthly") {
    const y = Number(payday.slice(0, 4));
    const m = Number(payday.slice(5, 7));
    const due = m === 12 ? `${y + 1}-01-15` : `${y}-${String(m + 1).padStart(2, "0")}-15`;
    return nextBusinessDay(due);
  }
  // Semiweekly: Wed/Thu/Fri paydays are due the following Wednesday; Sat-Tue paydays the following
  // Friday. The employer always gets at least 3 business days after the end of the semiweekly period.
  const w = weekday(payday);
  const periodEnd = w >= 3 && w <= 5 ? addDays(payday, 5 - w) : addDays(payday, (2 - w + 7) % 7);
  const nominal = w >= 3 && w <= 5 ? addDays(payday, 3 - w + 7) : addDays(payday, (5 - w + 7) % 7 || 7);
  const minimum = addBusinessDays(periodEnd, 3);
  return nextBusinessDay(nominal) < minimum ? minimum : nextBusinessDay(nominal);
}

/** $100,000 next-day rule: once accumulated liability reaches $100,000, deposit by the next business day. */
export function nextDayRuleApplies(accumulatedUndeposited: Cents): boolean {
  return accumulatedUndeposited >= dollars(100_000);
}

/** Quarterly liability under $2,500 may be paid with Form 941 instead of deposited. */
export function payWithReturnAllowed(quarterLiability: Cents, priorQuarterLiability: Cents | null): boolean {
  return quarterLiability < dollars(2_500) || (priorQuarterLiability !== null && priorQuarterLiability < dollars(2_500));
}

/**
 * FUTA: deposit once cumulative undeposited liability exceeds $500, by the last day of the month
 * after the quarter. Returns null when the amount can roll into the next quarter (or Form 940).
 */
export function futaDepositDue(year: number, quarter: 1 | 2 | 3 | 4, cumulativeUndeposited: Cents): string | null {
  if (cumulativeUndeposited <= dollars(500)) return null;
  return nextBusinessDay(quarterReturnDue(year, quarter));
}

/* ---------------------------------------------------------------- states */

export const STATE_DEPOSIT_SOURCES: Record<string, Source> = {
  CT: {
    cite: "CT DRS, 2026 Withholding Tax Information (payment due dates); Circular CT (lookback thresholds)",
    url: "https://portal.ct.gov/drs/withholding-taxes/tax-information",
    readOn: "2026-11-26",
    verified: false,
    note: "Weekly and monthly due dates read from DRS. The lookback thresholds ($10,000 weekly, $2,000 quarterly) are from memory and must be checked in IP 2026(1) Circular CT.",
  },
  MA: {
    cite: "MA DOR Circular M, deposit frequency",
    url: "https://www.mass.gov/info-details/massachusetts-withholding-tax-guide",
    readOn: "2026-11-26",
    verified: false,
    note: "Thresholds ($25,000 quarter-monthly, $1,200 monthly, $100 quarterly) and due dates are from memory.",
  },
  OR: {
    cite: "Oregon DOR 150-206-430 (2026), employer remittance",
    url: "https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-tables_206-430_2026.pdf",
    readOn: "2026-11-26",
    verified: true,
    note: "Oregon follows the federal lookback: $50,000 or less = by the 15th of the next month; more = federal semiweekly dates.",
  },
  NY: {
    cite: "NYS Publication NYS-50, Employer's Guide, withholding tax deposits",
    url: "https://www.tax.ny.gov/pdf/publications/withholding/nys50.pdf",
    readOn: "2026-11-26",
    verified: false,
    note: "$700 accumulation rule and 3/5 business-day windows are from memory; verify in the current NYS-50.",
  },
};

export type CtSchedule = "weekly" | "monthly" | "quarterly";

export function ctScheduleFor(lookbackWithholding: Cents | null): CtSchedule {
  if (lookbackWithholding === null) return "monthly";
  if (lookbackWithholding > dollars(10_000)) return "weekly";
  if (lookbackWithholding < dollars(2_000)) return "quarterly";
  return "monthly";
}

export function ctDepositDue(payday: string, schedule: CtSchedule): string {
  const w = weekday(payday);
  if (schedule === "weekly") {
    // Wed-Fri payday: the following Wednesday. Sat-Tue payday: the second Wednesday after payday.
    const firstWed = addDays(payday, (3 - w + 7) % 7 || 7);
    return nextBusinessDay(w >= 3 && w <= 5 ? firstWed : addDays(firstWed, 7));
  }
  if (schedule === "monthly") {
    const y = Number(payday.slice(0, 4));
    const m = Number(payday.slice(5, 7));
    return nextBusinessDay(m === 12 ? `${y + 1}-01-15` : `${y}-${String(m + 1).padStart(2, "0")}-15`);
  }
  const q = quarterOf(payday);
  return nextBusinessDay(quarterReturnDue(q.year, q.quarter));
}

export type MaSchedule = "quarter_monthly" | "monthly" | "quarterly" | "annual";

export function maScheduleFor(annualWithholding: Cents): MaSchedule {
  if (annualWithholding > dollars(25_000)) return "quarter_monthly";
  if (annualWithholding > dollars(1_200)) return "monthly";
  if (annualWithholding >= dollars(100)) return "quarterly";
  return "annual";
}

export function maDepositDue(payday: string, schedule: MaSchedule): string {
  const y = Number(payday.slice(0, 4));
  const m = Number(payday.slice(5, 7));
  const d = Number(payday.slice(8, 10));
  if (schedule === "quarter_monthly") {
    // Periods end the 7th, 15th, 22nd and last day of the month; due within 3 business days.
    const last = Number(lastDayOfMonth(y, m).slice(8, 10));
    const end = [7, 15, 22, last].find((e) => d <= e)!;
    return addBusinessDays(`${y}-${String(m).padStart(2, "0")}-${String(end).padStart(2, "0")}`, 3);
  }
  if (schedule === "monthly" && m % 3 !== 0) return nextBusinessDay(`${y}-${String(m + 1).padStart(2, "0")}-15`);
  if (schedule === "annual") return nextBusinessDay(`${y + 1}-01-31`);
  const q = quarterOf(payday);
  return nextBusinessDay(quarterReturnDue(q.year, q.quarter));
}

export function orDepositDue(payday: string, federal: FederalSchedule): string {
  return federal941DepositDue(payday, federal);
}

/**
 * New York: when withholding accumulated since the last deposit reaches $700, deposit within 3
 * business days after the payday (5 for employers with less than $15,000 in the lookback). Below
 * $700 for the quarter, pay with Form NYS-45.
 */
export function nyDepositDue(payday: string, accumulated: Cents, lookbackUnder15k: boolean): string {
  if (accumulated >= dollars(700)) return addBusinessDays(payday, lookbackUnder15k ? 5 : 3);
  const q = quarterOf(payday);
  return nextBusinessDay(quarterReturnDue(q.year, q.quarter));
}
