import type { Cents } from "../money";
import type { Deduction } from "../tax-engine/deductions";
import type { PaycheckResult } from "../tax-engine/paycheck";
import { quarterOf } from "./calendar";

/** One approved, paid paycheck as stored for filings. Filings are computed only from these. */
export interface PaycheckRecord {
  payday: string;
  /** Pay period covered, ISO dates inclusive. */
  periodStart: string;
  periodEnd: string;
  employeeId: string;
  result: PaycheckResult;
  deductionDetail: Deduction[];
  /** Tips reported (not modeled yet; always 0). */
  tips?: Cents;
}

export function sumLines(records: PaycheckRecord[], id: string, field: "amount" | "taxableWages" = "amount"): Cents {
  let t = 0;
  for (const r of records) for (const l of r.result.lines) if (l.id === id) t += l[field];
  return t;
}

export function inQuarter(records: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4): PaycheckRecord[] {
  return records.filter((r) => {
    const q = quarterOf(r.payday);
    return q.year === year && q.quarter === quarter;
  });
}

export function inYear(records: PaycheckRecord[], year: number): PaycheckRecord[] {
  return records.filter((r) => r.payday.startsWith(`${year}-`));
}

export function byEmployee(records: PaycheckRecord[]): Map<string, PaycheckRecord[]> {
  const m = new Map<string, PaycheckRecord[]>();
  for (const r of records) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
  return m;
}

export function sumDeductions(records: PaycheckRecord[], kind: Deduction["kind"]): Cents {
  return records.reduce((s, r) => s + r.deductionDetail.filter((d) => d.kind === kind).reduce((a, d) => a + d.amount, 0), 0);
}
