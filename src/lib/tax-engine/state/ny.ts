import type { Cents } from "../../money";
import { PAY_PERIODS, roundCents, taxFromBracket, type Bracket, type PayFrequency } from "../types";
import { NYC_2026, NYS_2026, YONKERS_2026 } from "../tables/2026/ny";

export interface NyIt2104 {
  /** Head of household withholds as single. */
  status: "single" | "married";
  /** IT-2104 line 1: allowances for New York State and Yonkers. */
  allowances: number;
  /** IT-2104 line 2: allowances for New York City. Defaults to line 1 when absent. */
  nycAllowances?: number;
  /** Extra NYS / NYC / Yonkers per pay period (IT-2104 lines 3-5). */
  additionalState?: Cents;
  additionalNyc?: Cents;
  additionalYonkers?: Cents;
  /** Exempt by Form IT-2104-E (IT-2104 itself cannot claim exemption). */
  exempt?: boolean;
  nycResident?: boolean;
  yonkersResident?: boolean;
  /** Nonresident working in Yonkers. */
  yonkersNonresidentWorker?: boolean;
}

/** Per-period version of an annual schedule, rounded the way NYS-50-T publishes it. */
export function perPeriodSchedule(annual: Bracket, periods: number): Bracket {
  return annual.map((r) => ({ over: Math.round(r.over / periods / 100) * 100, base: Math.round(r.base / periods), rate: r.rate }));
}

function methodIIIRate(status: "single" | "married", annualNet: Cents): number | null {
  let rate: number | null = null;
  for (const t of NYS_2026.methodIII[status]) if (annualNet >= t.atLeast) rate = t.rate;
  return rate;
}

/** New York State withholding by Method II (exact calculation), Method III for high wages. */
export function nysWithholding(wages: Cents, frequency: PayFrequency, w4: NyIt2104): Cents {
  if (w4.exempt) return 0;
  const t = NYS_2026;
  const periods = PAY_PERIODS[frequency];
  const idx = w4.status === "single" ? 0 : 1;
  const deduction = t.deductionAllowance[frequency]?.[idx] ?? Math.round(t.annualDeduction[w4.status] / periods);
  const exemption = t.exemption[frequency] ?? Math.round(t.annualExemption / periods);
  const net = Math.max(0, wages - deduction - exemption * w4.allowances);

  const flat = methodIIIRate(w4.status, net * periods);
  const tax = flat !== null ? net * flat : taxFromBracket(perPeriodSchedule(t[w4.status], periods), net);
  return roundCents(tax) + (w4.additionalState ?? 0);
}

/** New York City resident withholding (annualized formula). See NYC_2026 for the open verification. */
export function nycWithholding(wages: Cents, frequency: PayFrequency, w4: NyIt2104): Cents {
  if (w4.exempt || !w4.nycResident) return 0;
  const t = NYC_2026;
  const periods = PAY_PERIODS[frequency];
  const annualNet = Math.max(0, wages * periods - t.annualDeduction[w4.status] - t.annualExemption * (w4.nycAllowances ?? w4.allowances));
  return roundCents(taxFromBracket(t.schedule, annualNet) / periods) + (w4.additionalNyc ?? 0);
}

/** Yonkers: resident surcharge on NYS tax, or nonresident earnings tax on wages. */
export function yonkersWithholding(wages: Cents, nysTax: Cents, w4: NyIt2104): Cents {
  if (w4.exempt) return 0;
  if (w4.yonkersResident) return roundCents((nysTax - (w4.additionalState ?? 0)) * YONKERS_2026.residentSurchargeRate) + (w4.additionalYonkers ?? 0);
  if (w4.yonkersNonresidentWorker) return roundCents(wages * YONKERS_2026.nonresidentRate);
  return 0;
}
