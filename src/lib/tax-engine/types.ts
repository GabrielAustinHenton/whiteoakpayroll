import type { Cents } from "../money";

/**
 * Shared types for the in-house tax engine.
 *
 * Every tax figure lives in a versioned table under `tables/<year>/` and carries the official
 * source it came from plus whether it was checked against that source. The engine itself holds no
 * rates; it only reads tables, so a new tax year is a new data file plus tests.
 */

export interface Source {
  /** Short citation, e.g. "IRS Pub. 15-T (2026), Worksheet 1A". */
  cite: string;
  url: string;
  /** Date the figure was read from the source (ISO). */
  readOn: string;
  /**
   * true = copied from the official publication and cross-checked.
   * false = from a secondary source or memory; must be verified before live payroll.
   */
  verified: boolean;
  note?: string;
}

/** One row of an annual percentage-method table: tax = base + rate * (wages - over). */
export interface BracketRow {
  /** Column A: wages at least this amount (annual, cents). */
  over: Cents;
  /** Column C: tentative tax at the start of the row (annual, cents). */
  base: Cents;
  /** Column D. */
  rate: number;
}

export type Bracket = readonly BracketRow[];

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "semiannually" | "annually" | "daily";

/** Pub. 15-T Table 3. */
export const PAY_PERIODS: Record<PayFrequency, number> = {
  annually: 1,
  semiannually: 2,
  quarterly: 4,
  monthly: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
  daily: 260,
};

/** Apply a bracket table to an annual amount. Rows must be sorted ascending by `over`. */
export function taxFromBracket(table: Bracket, annual: Cents): number {
  if (annual <= 0) return 0;
  let row = table[0];
  for (const r of table) if (annual >= r.over) row = r;
  return row.base + (annual - row.over) * row.rate;
}

/** Round to whole cents, half away from zero. */
export function roundCents(x: number): Cents {
  return Math.sign(x) * Math.round(Math.abs(x));
}
