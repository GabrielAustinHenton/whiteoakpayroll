import type { Cents } from "../money";
import type { PayFrequency } from "./types";
import { taxableWages, type Deduction, type TaxableWages } from "./deductions";
import { federalIncomeTax, federalSupplementalTax, type FederalW4 } from "./federal/income-tax";
import { fica, futa } from "./federal/fica-futa";
import { stateLines as stateLinesFn, type EmployerStateSettings, type StateCertificate, type StateInput } from "./state";

/** Year-to-date amounts for this employee at this employer, before the current paycheck. */
export interface YearToDate {
  ficaWages: Cents;
  futaWages: Cents;
  supplementalWages: Cents;
  /** State unemployment wages by state code. */
  suiWages?: Record<string, Cents>;
  /** Free-form per-tax YTD (e.g. paid leave contributions, MA FICA deduction used) keyed by tax id. */
  byTax?: Record<string, Cents>;
}

export interface PaycheckInput {
  employeeId: string;
  frequency: PayFrequency;
  /** Regular wages this period. */
  regularWages: Cents;
  /** Bonuses/commissions paid with this check and taxed with the supplemental flat rate. */
  supplementalWages?: Cents;
  deductions: Deduction[];
  federalW4: FederalW4;
  /** Work state, used for FUTA credit reduction and by state modules. */
  workState: string;
  ytd: YearToDate;
}

export type TaxPayer = "employee" | "employer";

export interface TaxLine {
  /** Stable id used by filings and the general ledger, e.g. "federal_income", "ct_income", "or_transit". */
  id: string;
  label: string;
  payer: TaxPayer;
  /** Jurisdiction code: "US", "CT", "NY-NYC", ... */
  jurisdiction: string;
  taxableWages: Cents;
  amount: Cents;
}

export interface PaycheckResult {
  employeeId: string;
  gross: Cents;
  wages: TaxableWages;
  lines: TaxLine[];
  employeeTaxes: Cents;
  employerTaxes: Cents;
  deductions: Cents;
  net: Cents;
}

/**
 * Federal part of a paycheck: income tax, FICA both sides, FUTA. `calculatePaycheck` adds the
 * state and local lines, so filings read one list of lines.
 */
export function federalPaycheck(input: PaycheckInput): PaycheckResult {
  const supplemental = input.supplementalWages ?? 0;
  const gross = input.regularWages + supplemental;
  const wages = taxableWages(gross, input.deductions);

  // Split the income-tax base between regular and supplemental pay in proportion to gross, so
  // pre-tax deductions reduce the regular part first and the supplemental part only if needed.
  const regularFitWages = Math.max(0, wages.federalIncome - supplemental);
  const supplementalFitWages = wages.federalIncome - regularFitWages;

  const fit = federalIncomeTax({ taxableWages: regularFitWages, frequency: input.frequency, w4: input.federalW4 });
  const exempt = input.federalW4.exempt === true;
  const supTax = exempt ? 0 : federalSupplementalTax(supplementalFitWages, input.ytd.supplementalWages);
  const f = fica({ ficaWages: wages.fica, ytdFicaWagesBefore: input.ytd.ficaWages });
  const u = futa(wages.futa, input.ytd.futaWages, input.workState);

  const lines: TaxLine[] = [
    { id: "federal_income", label: "Federal income tax", payer: "employee", jurisdiction: "US", taxableWages: wages.federalIncome, amount: fit.withholding + supTax },
    { id: "social_security", label: "Social Security", payer: "employee", jurisdiction: "US", taxableWages: f.socialSecurityWages, amount: f.employee.socialSecurity },
    { id: "medicare", label: "Medicare", payer: "employee", jurisdiction: "US", taxableWages: f.medicareWages, amount: f.employee.medicare },
    { id: "additional_medicare", label: "Additional Medicare", payer: "employee", jurisdiction: "US", taxableWages: f.medicareWages, amount: f.employee.additionalMedicare },
    { id: "social_security_er", label: "Social Security (employer)", payer: "employer", jurisdiction: "US", taxableWages: f.socialSecurityWages, amount: f.employer.socialSecurity },
    { id: "medicare_er", label: "Medicare (employer)", payer: "employer", jurisdiction: "US", taxableWages: f.medicareWages, amount: f.employer.medicare },
    { id: "futa", label: "FUTA", payer: "employer", jurisdiction: "US", taxableWages: u.taxableWages, amount: u.amount },
  ];
  return finalize(input.employeeId, gross, wages, input.deductions, lines);
}

/** Totals and net pay from a list of lines. Exported so state modules can append lines and re-total. */
export function finalize(employeeId: string, gross: Cents, wages: TaxableWages, deductions: Deduction[], lines: TaxLine[]): PaycheckResult {
  const employeeTaxes = lines.filter((l) => l.payer === "employee").reduce((s, l) => s + l.amount, 0);
  const employerTaxes = lines.filter((l) => l.payer === "employer").reduce((s, l) => s + l.amount, 0);
  const deductionTotal = deductions.reduce((s, d) => s + d.amount, 0);
  return {
    employeeId,
    gross,
    wages,
    lines,
    employeeTaxes,
    employerTaxes,
    deductions: deductionTotal,
    net: gross - employeeTaxes - deductionTotal,
  };
}

export interface FullPaycheckInput extends PaycheckInput {
  state: StateCertificate;
  employerState: EmployerStateSettings;
  stateYtd: StateInput["ytd"];
}

/** Federal, state and local taxes for one paycheck. */
export function calculatePaycheck(input: FullPaycheckInput): PaycheckResult {
  const fed = federalPaycheck(input);
  const get = (id: string) => fed.lines.find((l) => l.id === id)?.amount ?? 0;
  const lines = stateLinesFn({
    certificate: input.state,
    frequency: input.frequency,
    gross: fed.gross,
    stateIncomeWages: fed.wages.stateIncome,
    suiWages: fed.wages.fica,
    federalWithholding: get("federal_income"),
    ficaWithheld: get("social_security") + get("medicare"),
    employer: input.employerState,
    ytd: input.stateYtd,
  });
  return finalize(input.employeeId, fed.gross, fed.wages, input.deductions, [...fed.lines, ...lines]);
}
