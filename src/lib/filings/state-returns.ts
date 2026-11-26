import type { Cents } from "../money";
import { byEmployee, inQuarter, inYear, sumLines, type PaycheckRecord } from "./records";

/**
 * Quarterly state returns as data. Each state's e-file channel is listed in docs/registrations.md;
 * line labels follow the paper forms so a reviewer can check them against the form.
 */

/** CT-941, Connecticut Quarterly Reconciliation of Withholding (filed electronically in myconneCT). */
export interface CT941 {
  year: number;
  quarter: number;
  line1_grossWages: Cents;
  line2_ctWages: Cents;
  line3_ctTaxWithheld: Cents;
  line5_payments: Cents;
  line8_balanceDue: Cents;
  line9_overpayment: Cents;
}

export function ct941(all: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4, payments: Cents): CT941 {
  const recs = inQuarter(all, year, quarter).filter((r) => r.result.lines.some((l) => l.id === "ct_income"));
  const tax = sumLines(recs, "ct_income");
  return {
    year,
    quarter,
    line1_grossWages: recs.reduce((s, r) => s + r.result.gross, 0),
    line2_ctWages: sumLines(recs, "ct_income", "taxableWages"),
    line3_ctTaxWithheld: tax,
    line5_payments: payments,
    line8_balanceDue: Math.max(0, tax - payments),
    line9_overpayment: Math.max(0, payments - tax),
  };
}

/** M-941, Massachusetts Employer's Return of Income Taxes Withheld (MassTaxConnect). */
export interface M941 {
  year: number;
  quarter: number;
  massTaxWithheld: Cents;
  payments: Cents;
  balanceDue: Cents;
}

export function m941(all: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4, payments: Cents): M941 {
  const tax = sumLines(inQuarter(all, year, quarter), "ma_income");
  return { year, quarter, massTaxWithheld: tax, payments, balanceDue: tax - payments };
}

/**
 * Oregon Form OQ, Combined Quarterly Tax Report: unemployment insurance, Workers' Benefit Fund,
 * state withholding, statewide transit tax, plus Schedule B (monthly withholding liability).
 * Employee detail goes on Form 132.
 */
export interface FormOQ {
  year: number;
  quarter: number;
  /** Employees covered in the pay period including the 12th of each month. */
  employeesByMonth: [number, number, number];
  totalSubjectWages: Cents;
  excessWages: Cents;
  taxableUiWages: Cents;
  uiTax: Cents;
  /** Workers' Benefit Fund: hours worked x rate. Not modeled yet (needs hours). */
  wbfHours: number | null;
  withholding: Cents;
  statewideTransitTax: Cents;
  scheduleB_monthlyWithholding: [Cents, Cents, Cents];
  form132: { employeeId: string; wages: Cents; hours: number | null }[];
}

export function formOQ(all: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4): FormOQ {
  const recs = inQuarter(all, year, quarter).filter((r) => r.result.lines.some((l) => l.id === "or_sui"));
  const subject = recs.reduce((s, r) => s + r.result.wages.fica, 0);
  const taxable = sumLines(recs, "or_sui", "taxableWages");
  const monthly: [Cents, Cents, Cents] = [0, 0, 0];
  const months: [Set<string>, Set<string>, Set<string>] = [new Set(), new Set(), new Set()];
  for (const r of recs) {
    const i = Number(r.payday.slice(5, 7)) - (quarter - 1) * 3 - 1;
    monthly[i] += r.result.lines.filter((l) => l.id === "or_income").reduce((s, l) => s + l.amount, 0);
    const twelfth = `${year}-${String((quarter - 1) * 3 + i + 1).padStart(2, "0")}-12`;
    if (r.periodStart <= twelfth && twelfth <= r.periodEnd) months[i].add(r.employeeId);
  }
  return {
    year,
    quarter,
    employeesByMonth: [months[0].size, months[1].size, months[2].size],
    totalSubjectWages: subject,
    excessWages: subject - taxable,
    taxableUiWages: taxable,
    uiTax: sumLines(recs, "or_sui"),
    wbfHours: null,
    withholding: sumLines(recs, "or_income"),
    statewideTransitTax: sumLines(recs, "or_transit"),
    scheduleB_monthlyWithholding: monthly,
    form132: [...byEmployee(recs)].map(([employeeId, rs]) => ({ employeeId, wages: rs.reduce((s, r) => s + r.result.wages.fica, 0), hours: null })),
  };
}

/**
 * NYS-45, Quarterly Combined Withholding, Wage Reporting, and Unemployment Insurance Return.
 * Part A: UI. Part B: withholding (NYS, NYC, Yonkers). Part C: employee wage detail; gross federal
 * and NY wages are reported only on the fourth-quarter return (year-to-date).
 */
export interface NYS45 {
  year: number;
  quarter: number;
  partA: {
    employeesByMonth: [number, number, number];
    totalRemuneration: Cents;
    remunerationOverBase: Cents;
    taxableWages: Cents;
    uiContributions: Cents;
    reemploymentServiceFund: Cents;
  };
  partB: { nysWithheld: Cents; nycWithheld: Cents; yonkersWithheld: Cents };
  partC: { employeeId: string; uiRemuneration: Cents; grossFederalWagesYtd?: Cents; nyWagesYtd?: Cents }[];
}

export function nys45(all: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4): NYS45 {
  const recs = inQuarter(all, year, quarter).filter((r) => r.result.lines.some((l) => l.id === "ny_sui"));
  const total = recs.reduce((s, r) => s + r.result.wages.fica, 0);
  const taxable = sumLines(recs, "ny_sui", "taxableWages");
  const months: [Set<string>, Set<string>, Set<string>] = [new Set(), new Set(), new Set()];
  for (const r of recs) {
    const i = Number(r.payday.slice(5, 7)) - (quarter - 1) * 3 - 1;
    const twelfth = `${year}-${String((quarter - 1) * 3 + i + 1).padStart(2, "0")}-12`;
    if (r.periodStart <= twelfth && twelfth <= r.periodEnd) months[i].add(r.employeeId);
  }
  const ytd = byEmployee(inYear(all, year));
  return {
    year,
    quarter,
    partA: {
      employeesByMonth: [months[0].size, months[1].size, months[2].size],
      totalRemuneration: total,
      remunerationOverBase: total - taxable,
      taxableWages: taxable,
      uiContributions: sumLines(recs, "ny_sui"),
      reemploymentServiceFund: sumLines(recs, "ny_rsf"),
    },
    partB: { nysWithheld: sumLines(recs, "ny_income"), nycWithheld: sumLines(recs, "nyc_income"), yonkersWithheld: sumLines(recs, "yonkers_income") },
    partC: [...byEmployee(recs)].map(([employeeId, rs]) => {
      const row: NYS45["partC"][number] = { employeeId, uiRemuneration: rs.reduce((s, r) => s + r.result.wages.fica, 0) };
      if (quarter === 4) {
        const y = ytd.get(employeeId) ?? [];
        row.grossFederalWagesYtd = sumLines(y, "federal_income", "taxableWages");
        row.nyWagesYtd = sumLines(y, "ny_income", "taxableWages");
      }
      return row;
    }),
  };
}

/**
 * CT-W3, Connecticut Annual Reconciliation of Withholding, due January 31 and filed electronically
 * in myconneCT. The W-2s (state copies) go to DRS with it, uploaded in SSA EFW2 format; 1099s that
 * show CT withholding are reported too. Line labels follow the 2025 form: VERIFY against the 2026 form.
 */
export interface CTW3 {
  year: number;
  w2Count: number;
  form1099Count: number;
  line1_grossCtWages: Cents;
  line2_ctTaxWithheldW2: Cents;
  line3_ctTaxWithheld1099: Cents;
  line4_totalCtTaxWithheld: Cents;
  line5_paidForYear: Cents;
  line6_balanceDue: Cents;
  line7_overpayment: Cents;
}

export function ctW3(
  w2s: { states: { state: string; stateWages: Cents; stateTax: Cents }[] }[],
  forms1099: { box5_stateTaxWithheld: Cents; box6_statePayerNumber: string; contractor: { state?: string } }[],
  year: number,
  paidForYear: Cents,
): CTW3 {
  const ct = w2s.flatMap((w) => w.states.filter((s) => s.state === "CT"));
  const ct1099 = forms1099.filter((f) => f.contractor.state === "CT" && f.box5_stateTaxWithheld > 0);
  const w2Tax = ct.reduce((s, x) => s + x.stateTax, 0);
  const t1099 = ct1099.reduce((s, f) => s + f.box5_stateTaxWithheld, 0);
  const total = w2Tax + t1099;
  return {
    year,
    w2Count: ct.length,
    form1099Count: ct1099.length,
    line1_grossCtWages: ct.reduce((s, x) => s + x.stateWages, 0),
    line2_ctTaxWithheldW2: w2Tax,
    line3_ctTaxWithheld1099: t1099,
    line4_totalCtTaxWithheld: total,
    line5_paidForYear: paidForYear,
    line6_balanceDue: Math.max(0, total - paidForYear),
    line7_overpayment: Math.max(0, paidForYear - total),
  };
}
