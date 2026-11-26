import { applyRate, type Cents } from "../money";
import { FEDERAL_2026 } from "./rates-2026";

/** Taxable portion of this paycheck, given wages already paid this year and an annual wage base. */
export function taxableUnderBase(grossThisRun: Cents, ytdBefore: Cents, wageBase: Cents): Cents {
  const room = Math.max(0, wageBase - ytdBefore);
  return Math.min(grossThisRun, room);
}

export interface EmployeeRunInput {
  employeeId: string;
  /** Gross wages subject to FICA/FUTA/SUTA for this run. */
  grossWages: Cents;
  /** Same wages paid earlier this calendar year, before this run. */
  ytdWagesBefore: Cents;
}

export interface SutaSetting {
  /** The employer's assigned state unemployment rate, e.g. 0.0242. */
  rate: number;
  /** The state's taxable wage base. */
  wageBase: Cents;
  /** FUTA credit reduction for the state in this year, if any (e.g. 0.003). */
  futaCreditReduction?: number;
}

export interface EmployerTaxLine {
  tax: "social_security" | "medicare" | "futa" | "suta";
  rate: number;
  taxableWages: Cents;
  amount: Cents;
}

export interface EmployerTaxResult {
  employeeId: string;
  lines: EmployerTaxLine[];
  total: Cents;
  /** True once this employee has hit the Social Security cap after this run. */
  socialSecurityCapReached: boolean;
}

/**
 * Employer-side payroll taxes for one employee on one pay run.
 * This is what the employer pays on top of wages and is shown on every pay run preview.
 */
export function employerTaxesForEmployee(input: EmployeeRunInput, suta: SutaSetting): EmployerTaxResult {
  const { grossWages, ytdWagesBefore } = input;
  const ss = FEDERAL_2026.socialSecurity;
  const futa = FEDERAL_2026.futa;

  const ssTaxable = taxableUnderBase(grossWages, ytdWagesBefore, ss.wageBase);
  const futaRate = futa.grossRate - futa.maxCredit + (suta.futaCreditReduction ?? 0);
  const futaTaxable = taxableUnderBase(grossWages, ytdWagesBefore, futa.wageBase);
  const sutaTaxable = taxableUnderBase(grossWages, ytdWagesBefore, suta.wageBase);

  const lines: EmployerTaxLine[] = [
    { tax: "social_security", rate: ss.rate, taxableWages: ssTaxable, amount: applyRate(ssTaxable, ss.rate) },
    {
      tax: "medicare",
      rate: FEDERAL_2026.medicare.rate,
      taxableWages: grossWages,
      amount: applyRate(grossWages, FEDERAL_2026.medicare.rate),
    },
    { tax: "futa", rate: futaRate, taxableWages: futaTaxable, amount: applyRate(futaTaxable, futaRate) },
    { tax: "suta", rate: suta.rate, taxableWages: sutaTaxable, amount: applyRate(sutaTaxable, suta.rate) },
  ];

  return {
    employeeId: input.employeeId,
    lines,
    total: lines.reduce((sum, l) => sum + l.amount, 0),
    socialSecurityCapReached: ytdWagesBefore + grossWages >= ss.wageBase,
  };
}

/** Employee-side FICA withholding (Social Security, Medicare, Additional Medicare). */
export function employeeFica(input: EmployeeRunInput): { socialSecurity: Cents; medicare: Cents; additionalMedicare: Cents } {
  const { grossWages, ytdWagesBefore } = input;
  const ss = FEDERAL_2026.socialSecurity;
  const med = FEDERAL_2026.medicare;
  const ssTaxable = taxableUnderBase(grossWages, ytdWagesBefore, ss.wageBase);
  const overThreshold = Math.max(0, ytdWagesBefore + grossWages - med.additionalThreshold);
  return {
    socialSecurity: applyRate(ssTaxable, ss.rate),
    medicare: applyRate(grossWages, med.rate),
    additionalMedicare: applyRate(Math.min(grossWages, overThreshold), med.additionalEmployeeRate),
  };
}

export interface PayRunCostSummary {
  grossWages: Cents;
  employerTaxes: Cents;
  byTax: Record<EmployerTaxLine["tax"], Cents>;
  perEmployee: EmployerTaxResult[];
  /** Total cash the employer funds for this run, excluding our subscription fee. */
  totalEmployerCost: Cents;
}

/** Roll up employer tax cost for a whole pay run: the "exact cost" view employers see before approving. */
export function summarizePayRunCost(employees: EmployeeRunInput[], suta: SutaSetting): PayRunCostSummary {
  const perEmployee = employees.map((e) => employerTaxesForEmployee(e, suta));
  const byTax = { social_security: 0, medicare: 0, futa: 0, suta: 0 };
  for (const result of perEmployee) for (const line of result.lines) byTax[line.tax] += line.amount;
  const grossWages = employees.reduce((s, e) => s + e.grossWages, 0);
  const employerTaxes = perEmployee.reduce((s, r) => s + r.total, 0);
  return { grossWages, employerTaxes, byTax, perEmployee, totalEmployerCost: grossWages + employerTaxes };
}
