import type { Cents } from "../../money";
import { PAY_PERIODS, roundCents, taxFromBracket, type PayFrequency } from "../types";
import { CT_CREDIT, CT_EXEMPTION, CT_INITIAL_TAX, CT_NO_FORM_RATE, CT_PHASE_OUT, CT_RECAPTURE, type CtCode, type Steps } from "../tables/2026/ct";

export interface CtW4 {
  /** null = no Form CT-W4 on file. */
  code: CtCode | null;
  /** Line 2: additional withholding per pay period. */
  additional?: Cents;
  /** Line 3: reduced withholding per pay period. */
  reduction?: Cents;
}

/** Count of whole-or-partial bands above `start`. "Over X but not over Y" boundaries. */
function bandsOver(salary: number, start: number, band: number): number {
  return salary <= start ? 0 : Math.ceil((salary - start) / band);
}

export function ctExemption(code: CtCode, salary: Cents): Cents {
  const e = CT_EXEMPTION[code];
  if (e.full === 0) return 0;
  return Math.max(0, e.full - bandsOver(salary, e.start, 100_000) * 100_000);
}

function stepped(segments: Steps[], salary: Cents): Cents {
  let amount = 0;
  for (const seg of segments) {
    if (salary <= seg.start) break;
    amount = Math.min(seg.max, seg.base + bandsOver(salary, seg.start, seg.band) * seg.step);
  }
  return amount;
}

export function ctCreditDecimal(code: Exclude<CtCode, "E">, salary: Cents): number {
  const rows = CT_CREDIT[code];
  let d = rows[0].decimal;
  for (const r of rows) if (salary > r.over) d = r.decimal;
  return d;
}

/** Connecticut withholding per pay period by TPG-211 Steps 1-16. */
export function ctWithholding(wages: Cents, frequency: PayFrequency, w4: CtW4): Cents {
  const periods = PAY_PERIODS[frequency];
  if (w4.code === "E") return 0;
  if (w4.code === null) return roundCents(wages * CT_NO_FORM_RATE);

  const code = w4.code;
  const salary = wages * periods; // Step 3
  const taxable = salary - ctExemption(code, salary); // Steps 5-6
  let perPeriod = 0;
  if (taxable > 0) {
    const initial = taxFromBracket(CT_INITIAL_TAX[code], taxable); // Step 7
    const total = initial + stepped(CT_PHASE_OUT[code], salary) + stepped(CT_RECAPTURE[code], salary); // Steps 8-10
    const annual = total * (1 - ctCreditDecimal(code, salary)); // Steps 11-12
    perPeriod = annual / periods; // Step 13
  }
  return Math.max(0, roundCents(perPeriod) + (w4.additional ?? 0) - (w4.reduction ?? 0)); // Steps 14-16
}
