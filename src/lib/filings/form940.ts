import type { Cents } from "../money";
import { applyRate } from "../money";
import { FUTA_2026 } from "../tax-engine/tables/2026/federal";
import { byEmployee, inYear, sumLines, type PaycheckRecord } from "./records";
import { quarterOf } from "./calendar";

/** Form 940, Employer's Annual Federal Unemployment (FUTA) Tax Return. */
export interface Form940 {
  year: number;
  /** Line 1a: single state where FUTA wages were paid, or "multi" (Schedule A required). */
  line1a_state: string | "multi";
  line3_totalPayments: Cents;
  line4_exemptPayments: Cents;
  line5_over7000: Cents;
  line6_subtotal: Cents;
  line7_futaWages: Cents;
  line8_futaBeforeAdjustments: Cents;
  /** Line 11: credit reduction from Schedule A. */
  line11_creditReduction: Cents;
  line12_totalFuta: Cents;
  line13_deposits: Cents;
  line14_balanceDue: Cents;
  line15_overpayment: Cents;
  /** Part 5, line 16a-16d: liability by quarter (required when line 12 exceeds $500). */
  quarterlyLiability: [Cents, Cents, Cents, Cents];
}

/**
 * `futaExemptPayments` is gross pay not subject to FUTA (e.g. section 125 premiums) for line 4;
 * we derive it from each paycheck's gross less FUTA wages.
 */
export function form940(all: PaycheckRecord[], year: number, deposits: Cents, states: string[]): Form940 {
  const recs = inYear(all, year);
  const line3 = recs.reduce((s, r) => s + r.result.gross, 0);
  const subjectWages = recs.reduce((s, r) => s + r.result.wages.futa, 0);
  const line4 = line3 - subjectWages;
  // Line 5: per employee, wages above $7,000.
  let line5 = 0;
  for (const [, rs] of byEmployee(recs)) {
    const w = rs.reduce((s, r) => s + r.result.wages.futa, 0);
    line5 += Math.max(0, w - FUTA_2026.wageBase);
  }
  const line6 = line4 + line5;
  const line7 = line3 - line6;
  const line8 = applyRate(line7, FUTA_2026.grossRate - FUTA_2026.maxCredit);
  const reduction = states.reduce((s, st) => s + (FUTA_2026.creditReduction[st] ?? 0), 0);
  const line11 = reduction > 0 ? applyRate(line7, reduction) : 0; // single-state simplification; Schedule A splits by state
  const line12 = line8 + line11;
  const q: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  for (const r of recs) q[quarterOf(r.payday).quarter - 1] += r.result.lines.filter((l) => l.id === "futa").reduce((s, l) => s + l.amount, 0);
  return {
    year,
    line1a_state: states.length === 1 ? states[0] : "multi",
    line3_totalPayments: line3,
    line4_exemptPayments: line4,
    line5_over7000: line5,
    line6_subtotal: line6,
    line7_futaWages: line7,
    line8_futaBeforeAdjustments: line8,
    line11_creditReduction: line11,
    line12_totalFuta: line12,
    line13_deposits: deposits,
    line14_balanceDue: Math.max(0, line12 - deposits),
    line15_overpayment: Math.max(0, deposits - line12),
    quarterlyLiability: q,
  };
}

/** Sanity check: line 7 times 0.6% should be within rounding of the per-paycheck FUTA amounts. */
export function futaRoundingDifference(all: PaycheckRecord[], year: number): Cents {
  const recs = inYear(all, year);
  return form940(all, year, 0, ["CT"]).line8_futaBeforeAdjustments - sumLines(recs, "futa");
}
