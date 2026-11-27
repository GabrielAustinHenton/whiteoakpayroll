import type { Cents } from "../money";
import type { LineDetail } from "../app/engine";
import { DEDUCTION_LABELS } from "../pay-run/review";

/**
 * Payroll reports built from paid pay runs: the register, tax liability, labor cost and
 * contractor payments. Pure functions over plain rows, so the page, the CSV downloads and the
 * tests all read the same numbers.
 */

export interface ReportLine {
  payday: Date;
  periodStart: Date;
  periodEnd: Date;
  employeeId: string;
  employeeName: string;
  hours: number | null;
  overtimeHours: number;
  regularCents: Cents;
  bonusCents: Cents;
  grossCents: Cents;
  employeeTaxesCents: Cents;
  employerTaxesCents: Cents;
  deductionsCents: Cents;
  netCents: Cents;
  detail: LineDetail | null;
}

export interface ContractorReportPayment {
  paidOn: Date;
  contractorId: string;
  name: string;
  amountCents: Cents;
  memo: string | null;
}

export type Range = { from: Date; to: Date; label: string };

/** A calendar year, or one quarter of it ("2026", "2026-Q3"). Bad input falls back to this year. */
export function parseRange(period: string | undefined, now = new Date()): Range {
  const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(period ?? "");
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  if (m?.[2]) {
    const q = Number(m[2]);
    return { from: new Date(Date.UTC(year, (q - 1) * 3, 1)), to: new Date(Date.UTC(year, q * 3, 0, 23, 59, 59, 999)), label: `${year}-Q${q}` };
  }
  return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)), label: String(year) };
}

export const quarterOf = (d: Date) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One row per paycheck, with each tax and deduction in its own column. */
export function payrollRegister(lines: ReportLine[]) {
  const taxCols = new Map<string, string>();
  const dedCols = new Map<string, string>();
  for (const l of lines) {
    for (const t of l.detail?.result.lines ?? []) if (t.amount && !taxCols.has(t.id)) taxCols.set(t.id, t.label);
    for (const d of l.detail?.deductionDetail ?? []) if (d.amount && !dedCols.has(d.kind)) dedCols.set(d.kind, DEDUCTION_LABELS[d.kind] ?? d.kind);
  }
  const taxIds = [...taxCols.keys()];
  const dedIds = [...dedCols.keys()];
  const header = [
    "Payday", "Period start", "Period end", "Employee", "Hours", "Overtime hours", "Regular", "Bonus", "Gross",
    ...taxIds.map((id) => taxCols.get(id)!), "Employee taxes", ...dedIds.map((k) => dedCols.get(k)!), "Deductions", "Net pay", "Employer taxes", "Total cost",
  ];
  const sorted = [...lines].sort((a, b) => a.payday.getTime() - b.payday.getTime() || a.employeeName.localeCompare(b.employeeName));
  const rows = sorted.map((l) => {
    const tax = (id: string) => (l.detail?.result.lines ?? []).filter((t) => t.id === id).reduce((s, t) => s + t.amount, 0);
    const ded = (k: string) => (l.detail?.deductionDetail ?? []).filter((d) => d.kind === k).reduce((s, d) => s + d.amount, 0);
    return [
      iso(l.payday), iso(l.periodStart), iso(l.periodEnd), l.employeeName, l.hours ?? "", l.overtimeHours || "",
      money(l.regularCents), money(l.bonusCents), money(l.grossCents),
      ...taxIds.map((id) => money(tax(id))), money(l.employeeTaxesCents),
      ...dedIds.map((k) => money(ded(k))), money(l.deductionsCents),
      money(l.netCents), money(l.employerTaxesCents), money(l.grossCents + l.employerTaxesCents),
    ];
  });
  const sum = (k: keyof ReportLine) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const totals = {
    paychecks: lines.length,
    grossCents: sum("grossCents"),
    employeeTaxesCents: sum("employeeTaxesCents"),
    employerTaxesCents: sum("employerTaxesCents"),
    deductionsCents: sum("deductionsCents"),
    netCents: sum("netCents"),
  };
  return { header, rows, totals };
}

export interface TaxLiabilityRow {
  quarter: string;
  jurisdiction: string;
  id: string;
  label: string;
  payer: "employee" | "employer";
  taxableWagesCents: Cents;
  amountCents: Cents;
}

/** Every tax withheld or owed, by quarter, jurisdiction and tax: what has to be deposited and filed. */
export function taxLiability(lines: ReportLine[]): TaxLiabilityRow[] {
  const by = new Map<string, TaxLiabilityRow>();
  for (const l of lines) {
    const quarter = quarterOf(l.payday);
    for (const t of l.detail?.result.lines ?? []) {
      const key = `${quarter}|${t.jurisdiction}|${t.id}`;
      const row = by.get(key) ?? { quarter, jurisdiction: t.jurisdiction, id: t.id, label: t.label, payer: t.payer, taxableWagesCents: 0, amountCents: 0 };
      row.taxableWagesCents += t.taxableWages;
      row.amountCents += t.amount;
      by.set(key, row);
    }
  }
  const order = (j: string) => (j === "US" ? "" : j);
  return [...by.values()]
    .filter((r) => r.amountCents !== 0 || r.taxableWagesCents !== 0)
    .sort((a, b) => a.quarter.localeCompare(b.quarter) || order(a.jurisdiction).localeCompare(order(b.jurisdiction)) || a.payer.localeCompare(b.payer) || a.label.localeCompare(b.label));
}

export interface LaborCostRow {
  kind: "employee" | "contractor";
  id: string;
  name: string;
  paychecks: number;
  hours: number;
  overtimeHours: number;
  grossCents: Cents;
  employerTaxesCents: Cents;
  /** Employer-paid benefits are not tracked yet; gross plus employer taxes is the cost. */
  totalCostCents: Cents;
}

/** What each person cost the business: gross pay plus employer taxes, and contractor payments. */
export function laborCost(lines: ReportLine[], contractors: ContractorReportPayment[] = []): LaborCostRow[] {
  const by = new Map<string, LaborCostRow>();
  for (const l of lines) {
    const r = by.get(l.employeeId) ?? { kind: "employee" as const, id: l.employeeId, name: l.employeeName, paychecks: 0, hours: 0, overtimeHours: 0, grossCents: 0, employerTaxesCents: 0, totalCostCents: 0 };
    r.paychecks += 1;
    r.hours += l.hours ?? 0;
    r.overtimeHours += l.overtimeHours;
    r.grossCents += l.grossCents;
    r.employerTaxesCents += l.employerTaxesCents;
    r.totalCostCents = r.grossCents + r.employerTaxesCents;
    by.set(l.employeeId, r);
  }
  for (const p of contractors) {
    const key = `c:${p.contractorId}`;
    const r = by.get(key) ?? { kind: "contractor" as const, id: p.contractorId, name: p.name, paychecks: 0, hours: 0, overtimeHours: 0, grossCents: 0, employerTaxesCents: 0, totalCostCents: 0 };
    r.paychecks += 1;
    r.grossCents += p.amountCents;
    r.totalCostCents = r.grossCents;
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => b.totalCostCents - a.totalCostCents || a.name.localeCompare(b.name));
}

/** Dollars with two decimals and no symbol or commas, so spreadsheets read it as a number. */
export const money = (c: Cents) => (c / 100).toFixed(2);

/**
 * RFC 4180 CSV. Text that a spreadsheet would run as a formula (starting with = + - @, tab or
 * carriage return) gets a leading apostrophe; numbers are left alone.
 */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    if (typeof v === "number") return String(v);
    let s = v;
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const REPORTS = {
  register: "Payroll register",
  "tax-liability": "Tax liability",
  "labor-cost": "Labor cost by person",
  contractors: "Contractor payments",
} as const;
export type ReportKind = keyof typeof REPORTS;

/** Header and rows for a CSV download of one report. */
export function reportCsv(kind: ReportKind, lines: ReportLine[], contractors: ContractorReportPayment[]): { header: string[]; rows: (string | number)[][] } {
  switch (kind) {
    case "register": {
      const r = payrollRegister(lines);
      return { header: r.header, rows: r.rows };
    }
    case "tax-liability":
      return {
        header: ["Quarter", "Jurisdiction", "Tax", "Paid by", "Taxable wages", "Amount"],
        rows: taxLiability(lines).map((r) => [r.quarter, r.jurisdiction, r.label, r.payer === "employee" ? "Withheld from employees" : "Employer", money(r.taxableWagesCents), money(r.amountCents)]),
      };
    case "labor-cost":
      return {
        header: ["Name", "Type", "Payments", "Hours", "Overtime hours", "Gross pay", "Employer taxes", "Total cost"],
        rows: laborCost(lines, contractors).map((r) => [r.name, r.kind === "employee" ? "Employee" : "Contractor", r.paychecks, r.hours ? round2(r.hours) : "", r.overtimeHours ? round2(r.overtimeHours) : "", money(r.grossCents), money(r.employerTaxesCents), money(r.totalCostCents)]),
      };
    case "contractors":
      return {
        header: ["Paid on", "Contractor", "Amount", "Memo"],
        rows: [...contractors].sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime()).map((p) => [iso(p.paidOn), p.name, money(p.amountCents), p.memo ?? ""]),
      };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
