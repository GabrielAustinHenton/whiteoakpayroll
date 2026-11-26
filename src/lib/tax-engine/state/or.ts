import type { Cents } from "../../money";
import { PAY_PERIODS, roundCents, type PayFrequency } from "../types";
import { OR_2026, type OrRow } from "../tables/2026/or";

export interface OrW4 {
  /** "married_single_rate" = married but withhold at the higher single rate; uses single tables. */
  filingStatus: "single" | "married" | "married_single_rate";
  allowances: number;
  additional?: Cents;
  exempt?: boolean;
  /** No Form OR-W-4 (or withholding statement) on file: flat 8%. */
  noForm?: boolean;
}

function fromSchedule(rows: readonly OrRow[], base: number): number {
  let row = rows[0];
  for (const r of rows) if (base >= r.over) row = r;
  return row.base + (base - row.over) * row.rate;
}

export interface OrInput {
  wages: Cents;
  frequency: PayFrequency;
  w4: OrW4;
  /** Federal income tax withheld this period (from the federal calculation). */
  federalWithholding: Cents;
}

/** Oregon withholding by the ODR 150-206-436 formula. */
export function orWithholding(input: OrInput): Cents {
  const t = OR_2026;
  const { w4 } = input;
  if (w4.exempt) return 0;
  if (w4.noForm) return roundCents(input.wages * t.noFormRate);

  const periods = PAY_PERIODS[input.frequency];
  const annualWages = input.wages * periods;
  const married = w4.filingStatus === "married";
  // Single with 3+ allowances uses the married deduction and schedules but the single phase-out.
  const marriedSchedules = married || w4.allowances >= 3;

  const allowances = annualWages > (married ? t.allowanceCutoff.married : t.allowanceCutoff.single) ? 0 : w4.allowances;

  let cap: number = t.federalSubtractionCap;
  if (annualWages >= t.highWageThreshold) {
    for (const p of married ? t.phaseOut.married : t.phaseOut.single) if (annualWages >= p.wagesAtLeast) cap = p.cap;
  }
  const fedSubtraction = Math.min(input.federalWithholding * periods, cap);
  const stdDeduction = marriedSchedules ? t.standardDeduction.marriedOrSingle3Plus : t.standardDeduction.single;
  const base = annualWages - fedSubtraction - stdDeduction;
  // The schedules start with a $263 constant that the allowance credit offsets; with no BASE there
  // is no Oregon tax, so do not let that constant produce withholding.
  if (base <= 0) return w4.additional ?? 0;

  const high = annualWages >= t.highWageThreshold;
  const rows = high
    ? marriedSchedules ? t.schedules.highMarried : t.schedules.highSingle
    : marriedSchedules ? t.schedules.lowMarried : t.schedules.lowSingle;
  const annualTax = Math.max(0, fromSchedule(rows, base) - allowances * t.exemptionCredit);
  return roundCents(annualTax / periods) + (w4.additional ?? 0);
}
