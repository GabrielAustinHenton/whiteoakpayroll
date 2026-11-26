import type { Cents } from "../money";
import { roundCents } from "../tax-engine/types";
import { inQuarter, sumLines, type PaycheckRecord } from "./records";

/**
 * Form 941, Employer's QUARTERLY Federal Tax Return, computed from paid paychecks.
 * Line numbers follow the 2026 form. Output is data for review, PDF rendering and e-file (MeF
 * 94x XML through an IRS-authorized transmitter, which needs our own e-file application).
 */
export interface Form941 {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  line1_employees: number;
  line2_wages: Cents;
  line3_incomeTaxWithheld: Cents;
  line5a_ssWages: Cents;
  line5a_ssTax: Cents;
  line5b_ssTips: Cents;
  line5b_ssTipsTax: Cents;
  line5c_medicareWages: Cents;
  line5c_medicareTax: Cents;
  line5d_addlMedicareWages: Cents;
  line5d_addlMedicareTax: Cents;
  line5e_total: Cents;
  line6_totalBeforeAdjustments: Cents;
  /** Fractions of cents: difference between line 5 at form rates and what was actually withheld + owed. */
  line7_fractionsOfCents: Cents;
  line10_totalAfterAdjustments: Cents;
  line12_totalAfterCredits: Cents;
  line13_deposits: Cents;
  line14_balanceDue: Cents;
  line15_overpayment: Cents;
  /** Line 16: monthly liabilities for monthly depositors (semiweekly depositors file Schedule B instead). */
  monthlyLiability: [Cents, Cents, Cents];
  /** Schedule B: liability by payday, for semiweekly depositors. */
  scheduleB: Record<string, Cents>;
}

/** Line 1: employees who received wages for the pay period that includes the 12th of the quarter's third month. */
function employeesOnThe12th(records: PaycheckRecord[], year: number, quarter: number): number {
  const the12th = `${year}-${String(quarter * 3).padStart(2, "0")}-12`;
  const ids = new Set(records.filter((r) => r.periodStart <= the12th && the12th <= r.periodEnd).map((r) => r.employeeId));
  return ids.size;
}

function liability(r: PaycheckRecord): Cents {
  const ids = ["federal_income", "social_security", "medicare", "additional_medicare", "social_security_er", "medicare_er"];
  return r.result.lines.filter((l) => ids.includes(l.id)).reduce((s, l) => s + l.amount, 0);
}

export function form941(all: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4, deposits: Cents): Form941 {
  const recs = inQuarter(all, year, quarter);
  const ssWages = sumLines(recs, "social_security", "taxableWages");
  const medWages = sumLines(recs, "medicare", "taxableWages");
  // Line 5d: wages above $200,000 per employee in the year; read from the additional_medicare amounts.
  const addlTax = sumLines(recs, "additional_medicare");
  const addlWages = roundCents(addlTax / 0.009);

  const ss = roundCents(ssWages * 0.124);
  const med = roundCents(medWages * 0.029);
  const addl = roundCents(addlWages * 0.009);
  const line5e = ss + med + addl;
  const line3 = sumLines(recs, "federal_income");
  const line6 = line3 + line5e;

  const actualFica =
    sumLines(recs, "social_security") + sumLines(recs, "social_security_er") + sumLines(recs, "medicare") + sumLines(recs, "medicare_er") + addlTax;
  const line7 = actualFica - line5e;
  const line10 = line6 + line7;
  const line12 = line10;

  const monthly: [Cents, Cents, Cents] = [0, 0, 0];
  const scheduleB: Record<string, Cents> = {};
  for (const r of recs) {
    const idx = Number(r.payday.slice(5, 7)) - (quarter - 1) * 3 - 1;
    monthly[idx] += liability(r);
    scheduleB[r.payday] = (scheduleB[r.payday] ?? 0) + liability(r);
  }

  return {
    year,
    quarter,
    line1_employees: employeesOnThe12th(recs, year, quarter),
    line2_wages: sumLines(recs, "federal_income", "taxableWages"),
    line3_incomeTaxWithheld: line3,
    line5a_ssWages: ssWages,
    line5a_ssTax: ss,
    line5b_ssTips: 0,
    line5b_ssTipsTax: 0,
    line5c_medicareWages: medWages,
    line5c_medicareTax: med,
    line5d_addlMedicareWages: addlWages,
    line5d_addlMedicareTax: addl,
    line5e_total: line5e,
    line6_totalBeforeAdjustments: line6,
    line7_fractionsOfCents: line7,
    line10_totalAfterAdjustments: line10,
    line12_totalAfterCredits: line12,
    line13_deposits: deposits,
    line14_balanceDue: Math.max(0, line12 - deposits),
    line15_overpayment: Math.max(0, deposits - line12),
    monthlyLiability: monthly,
    scheduleB,
  };
}

/** Consistency checks the IRS also runs; an empty list means the return balances. */
export function check941(f: Form941): string[] {
  const errs: string[] = [];
  const total = f.monthlyLiability.reduce((a, b) => a + b, 0);
  if (total !== f.line12_totalAfterCredits) errs.push(`Line 16 total ${total} does not equal line 12 ${f.line12_totalAfterCredits}`);
  if (Math.abs(f.line7_fractionsOfCents) > 100 * Math.max(1, f.line1_employees)) errs.push("Line 7 fractions-of-cents adjustment is unusually large");
  return errs;
}
