import { applyRate, type Cents } from "../money";
import type { LaunchState } from "../payroll/schedules";
import { federalPaycheck, finalize, type PaycheckInput, type PaycheckResult, type TaxLine, type TaxPayer } from "../tax-engine";
import type { DeductionKind } from "../tax-engine/deductions";
import { underWageBase } from "../tax-engine/federal/fica-futa";
import { paidLeaveContribution } from "../taxes/state-paid-leave";

/**
 * The pay run review: everything an employer sees, line by line, before approving payroll.
 *
 * Per-employee figures come from the tax engine (`federalPaycheck`). This module only adds the
 * state lines that exist today (unemployment and paid leave), totals every line across the run, and
 * works out where the money goes. State income tax lines will arrive from the state tax engine and
 * flow through here unchanged, because everything is grouped by `TaxLine.id`.
 */

export interface StateUnemployment {
  /** The employer's assigned rate, e.g. 0.03. */
  rate: number;
  wageBase: Cents;
}

export interface ReviewEmployeeInput extends PaycheckInput {
  workState: LaunchState;
}

export interface ReviewInput {
  employees: ReviewEmployeeInput[];
  /** Unemployment insurance settings for each state the employer pays in. */
  unemployment: Partial<Record<LaunchState, StateUnemployment>>;
  /** Headcount used for paid leave employer-share thresholds (MA, OR at 25+). */
  employerSize: number;
}

export interface ReviewLine {
  id: string;
  label: string;
  payer: TaxPayer;
  jurisdiction: string;
  amount: Cents;
  /** How many employees on this run had a nonzero amount for this line. */
  employees: number;
}

export interface DeductionLine {
  kind: DeductionKind;
  label: string;
  amount: Cents;
  employees: number;
}

export interface CashDestination {
  id: "net_pay" | "federal" | "state" | "deductions";
  label: string;
  detail: string;
  amount: Cents;
}

export interface PayRunReview {
  employees: PaycheckResult[];
  gross: Cents;
  /** Taxes held back from employees' pay. Part of gross, not extra cost. */
  employeeLines: ReviewLine[];
  employeeTaxes: Cents;
  deductionLines: DeductionLine[];
  deductions: Cents;
  netPay: Cents;
  /** Taxes the employer pays on top of gross wages. */
  employerLines: ReviewLine[];
  employerTaxes: Cents;
  /** Gross wages plus employer taxes: what leaves the employer's bank account for this run. */
  cashNeeded: Cents;
  /** The same total, split by where it goes. */
  cashBreakdown: CashDestination[];
}

export const DEDUCTION_LABELS: Record<DeductionKind, string> = {
  retirement_pretax: "401(k), pre-tax",
  retirement_roth: "401(k), Roth",
  simple_ira: "SIMPLE IRA",
  state_auto_ira: "State retirement program (auto-IRA)",
  section125_health: "Health, dental, vision premiums",
  hsa_section125: "HSA contributions",
  dependent_care_fsa: "Dependent care FSA",
  commuter_pretax: "Commuter benefits",
  advance_repayment: "Payday advance repayment",
  garnishment: "Wage garnishment",
  other_posttax: "Other after-tax deductions",
};

/** Federal lines plus state unemployment and paid leave for one employee. */
export function reviewPaycheck(e: ReviewEmployeeInput, input: ReviewInput): PaycheckResult {
  const federal = federalPaycheck(e);
  const lines: TaxLine[] = [...federal.lines];
  const state = e.workState;
  const st = state.toLowerCase();

  const ui = input.unemployment[state];
  if (ui) {
    const ytd = e.ytd.suiWages?.[state] ?? e.ytd.futaWages;
    const taxable = underWageBase(federal.wages.futa, ytd, ui.wageBase);
    lines.push({ id: `${st}_sui`, label: `${state} unemployment`, payer: "employer", jurisdiction: state, taxableWages: taxable, amount: applyRate(taxable, ui.rate) });
  }

  const leave = paidLeaveContribution({
    state,
    grossWages: federal.wages.fica,
    ytdWagesBefore: e.ytd.ficaWages,
    ytdEmployeeContributionBefore: e.ytd.byTax?.[`${st}_paid_leave`],
    employerSize: input.employerSize,
  });
  lines.push({ id: `${st}_paid_leave`, label: leave.program, payer: "employee", jurisdiction: state, taxableWages: leave.taxableWages, amount: leave.employee });
  if (leave.employer > 0) {
    lines.push({ id: `${st}_paid_leave_er`, label: `${leave.program} (employer share)`, payer: "employer", jurisdiction: state, taxableWages: leave.taxableWages, amount: leave.employer });
  }

  return finalize(e.employeeId, federal.gross, federal.wages, e.deductions, lines);
}

function groupLines(results: PaycheckResult[], payer: TaxPayer): ReviewLine[] {
  const byId = new Map<string, ReviewLine>();
  for (const r of results) {
    for (const l of r.lines) {
      if (l.payer !== payer) continue;
      const row = byId.get(l.id) ?? { id: l.id, label: l.label, payer, jurisdiction: l.jurisdiction, amount: 0, employees: 0 };
      row.amount += l.amount;
      if (l.amount > 0) row.employees += 1;
      byId.set(l.id, row);
    }
  }
  // Federal first, then states; keep engine order within each.
  return [...byId.values()].sort((a, b) => Number(a.jurisdiction !== "US") - Number(b.jurisdiction !== "US"));
}

const sum = (xs: { amount: Cents }[]) => xs.reduce((s, x) => s + x.amount, 0);

export function reviewPayRun(input: ReviewInput): PayRunReview {
  const employees = input.employees.map((e) => reviewPaycheck(e, input));
  const employeeLines = groupLines(employees, "employee");
  const employerLines = groupLines(employees, "employer");

  const byKind = new Map<DeductionKind, DeductionLine>();
  for (const e of input.employees) {
    for (const d of e.deductions) {
      const row = byKind.get(d.kind) ?? { kind: d.kind, label: DEDUCTION_LABELS[d.kind], amount: 0, employees: 0 };
      row.amount += d.amount;
      if (d.amount > 0) row.employees += 1;
      byKind.set(d.kind, row);
    }
  }
  const deductionLines = [...byKind.values()];

  const gross = employees.reduce((s, e) => s + e.gross, 0);
  const employeeTaxes = sum(employeeLines);
  const employerTaxes = sum(employerLines);
  const deductions = sum(deductionLines);
  const netPay = employees.reduce((s, e) => s + e.net, 0);
  const allLines = [...employeeLines, ...employerLines];
  const federal = sum(allLines.filter((l) => l.jurisdiction === "US"));
  const state = sum(allLines.filter((l) => l.jurisdiction !== "US"));

  return {
    employees,
    gross,
    employeeLines,
    employeeTaxes,
    deductionLines,
    deductions,
    netPay,
    employerLines,
    employerTaxes,
    cashNeeded: gross + employerTaxes,
    cashBreakdown: [
      { id: "net_pay", label: "Net pay to employees", detail: "Direct deposit to each employee's bank account", amount: netPay },
      { id: "federal", label: "Federal taxes", detail: "Withheld and employer taxes, deposited with the IRS", amount: federal },
      { id: "state", label: "State taxes and programs", detail: "Unemployment and paid leave, paid to each state", amount: state },
      { id: "deductions", label: "Benefits and other deductions", detail: "Sent to the plan or provider for each deduction", amount: deductions },
    ],
  };
}
