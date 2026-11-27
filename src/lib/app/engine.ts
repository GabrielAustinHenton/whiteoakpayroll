import type { Cents } from "../money";
import {
  calculatePaycheck,
  type Deduction,
  type FederalW4,
  type PaycheckResult,
  type PayFrequency,
  type StateCertificate,
} from "../tax-engine";
import { advanceDeduction } from "../payroll/advances";
import type { PaycheckRecord } from "../filings/records";
import { PERIODS, type Frequency } from "./periods";
import { retirementForPaycheck, retirementYtd, totalEmployer, type Election, type PlanConfig, type RetirementLine } from "../retirement";

/**
 * The one place that turns stored app data (employees, company state accounts, prior paychecks)
 * into tax engine input, and engine output back into what we store on a pay run line.
 */

export const LAUNCH_STATES = ["CT", "MA", "OR", "NY"] as const;
export type AppState = (typeof LAUNCH_STATES)[number];
export const STATE_NAMES: Record<AppState, string> = { CT: "Connecticut", MA: "Massachusetts", OR: "Oregon", NY: "New York" };

/** Employee fields the engine needs (a subset of the Employee row). */
export interface EmployeeTaxProfile {
  id: string;
  workState: string;
  payBasis: "HOURLY" | "SALARIED";
  payRateCents: number;
  w4FilingStatus: string;
  w4MultipleJobs: boolean;
  w4DependentsCents: number;
  w4OtherIncomeCents: number;
  w4DeductionsCents: number;
  w4ExtraCents: number;
  w4Exempt: boolean;
  stateW4: unknown;
  /** Old flat pre-tax 401(k) percent, used only when the company has no retirement plan set up. */
  retirementPretaxRate: number;
  healthPremiumCents: number;
  /** The company's active retirement plan and this person's election, when one is set up. */
  retirement?: EmployeeRetirement;
}

export interface EmployeeRetirement {
  plan: PlanConfig;
  election: Election;
  /** YYYY-MM-DD */
  birthDate: string;
  hireDate: string;
  /** Last year's FICA wages from this employer (Roth catch-up rule). */
  priorYearFicaWages: Cents;
}

export interface CompanyStateSettings {
  suiRate: number;
  orTransitDistrict?: string | null;
}

export interface AdvanceForRun {
  id: string;
  principalCents: number;
  installmentCents: number;
  repaidCents: number;
  authorizationSigned: boolean;
}

/** What we store on each pay run line: enough to print a paystub and to file every return. */
export interface LineDetail {
  frequency: PayFrequency;
  result: PaycheckResult;
  deductionDetail: Deduction[];
  /** Advance repayment taken on this check, by advance id. */
  advanceRepayments: { advanceId: string; amount: Cents }[];
  /** Bonus paid on this check (taxed as supplemental wages). */
  supplemental: Cents;
  /** Retirement plan contributions on this check (employee and employer), when a plan is set up. */
  retirement?: RetirementLine;
}

const FREQ: Record<Frequency, PayFrequency> = { WEEKLY: "weekly", BIWEEKLY: "biweekly", SEMIMONTHLY: "semimonthly", MONTHLY: "monthly" };

export function employeeFederalW4(e: EmployeeTaxProfile): FederalW4 {
  const fs = e.w4FilingStatus === "married_jointly" || e.w4FilingStatus === "head_of_household" ? e.w4FilingStatus : "single";
  return {
    version: "2020_or_later",
    filingStatus: fs as "single" | "married_jointly" | "head_of_household",
    multipleJobs: e.w4MultipleJobs,
    dependentsCredit: e.w4DependentsCents,
    otherIncome: e.w4OtherIncomeCents,
    deductions: e.w4DeductionsCents,
    extraWithholding: e.w4ExtraCents,
    exempt: e.w4Exempt,
  } as FederalW4;
}

/**
 * The state withholding certificate on file, or the state's rule for "no certificate":
 * CT withholds at the highest rate (code D), OR flat 8% (noForm), MA as zero exemptions,
 * NY as single with zero allowances.
 */
export function employeeStateCertificate(e: EmployeeTaxProfile): StateCertificate {
  const raw = (e.stateW4 ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof raw[k] === "number" ? (raw[k] as number) : Number(raw[k] ?? 0) || 0);
  const bool = (k: string) => raw[k] === true || raw[k] === "on" || raw[k] === "true";
  const has = Object.keys(raw).length > 0;
  switch (e.workState) {
    case "CT":
      return { state: "CT", w4: { code: has && raw.code ? (raw.code as "A") : null, additional: num("additional"), reduction: num("reduction") } };
    case "MA":
      return {
        state: "MA",
        w4: { exemptions: num("exemptions"), headOfHousehold: bool("headOfHousehold"), blind: num("blind"), fullTimeStudentUnder8k: bool("fullTimeStudentUnder8k"), additional: num("additional"), exempt: bool("exempt") },
      };
    case "OR":
      return {
        state: "OR",
        w4: has
          ? { filingStatus: (raw.filingStatus as "single") ?? "single", allowances: num("allowances"), additional: num("additional"), exempt: bool("exempt") }
          : { filingStatus: "single", allowances: 0, noForm: true },
      };
    case "NY":
      return {
        state: "NY",
        w4: {
          status: raw.status === "married" ? "married" : "single",
          allowances: num("allowances"),
          // IT-2104 line 2; older rows without it fall back to line 1 inside the engine.
          nycAllowances: raw.nycAllowances === undefined ? undefined : num("nycAllowances"),
          additionalState: num("additionalState"),
          additionalNyc: bool("nycResident") ? num("additionalNyc") : 0,
          additionalYonkers: bool("yonkersResident") ? num("additionalYonkers") : 0,
          nycResident: bool("nycResident"),
          yonkersResident: bool("yonkersResident"),
          exempt: bool("exempt"),
        },
      };
    default:
      throw new Error(`${e.workState} is not a launch state (CT, MA, OR, NY).`);
  }
}

/** Overtime pay: hours x 1.5 x the hourly rate. Salaried employees get none here. */
export function overtimeWages(e: Pick<EmployeeTaxProfile, "payBasis" | "payRateCents">, hours: number): Cents {
  return e.payBasis === "HOURLY" && hours > 0 ? Math.round(e.payRateCents * 1.5 * hours) : 0;
}

/** Regular wages for the period: hours x rate, or annual salary / periods per year. */
export function regularWages(e: Pick<EmployeeTaxProfile, "payBasis" | "payRateCents">, freq: Frequency, hours: number | null): Cents {
  if (e.payBasis === "HOURLY") return Math.round(e.payRateCents * (hours ?? 0));
  return Math.round(e.payRateCents / PERIODS[freq]);
}

/** Year-to-date figures the engine needs, from this employee's earlier paid checks this year. */
export function ytdFrom(prior: LineDetail[], state: string) {
  const st = state.toLowerCase();
  let ficaWages = 0, futaWages = 0, supplementalWages = 0, suiWages = 0, paidLeaveWages = 0, paidLeaveEmployee = 0;
  for (const d of prior) {
    ficaWages += d.result.wages.fica;
    futaWages += d.result.wages.futa;
    for (const l of d.result.lines) {
      if (l.id === `${st}_sui`) suiWages += l.taxableWages;
      if (l.id === `${st}_paid_leave`) {
        paidLeaveWages += l.taxableWages;
        paidLeaveEmployee += l.amount;
      }
    }
    supplementalWages += d.supplemental ?? 0;
  }
  return { ytd: { ficaWages, futaWages, supplementalWages }, stateYtd: { suiWages, paidLeaveWages, paidLeaveEmployee } };
}

/**
 * Minimum wage floor for advance repayments (2026, per hour). UNVERIFIED placeholders: confirm the
 * 2026 rates (and Oregon's Portland metro / NYC regional rates) before advances go live.
 */
const MIN_WAGE_2026: Record<string, Cents> = { CT: 1694, MA: 1500, OR: 1505, NY: 1650 };

export interface PaycheckContext {
  frequency: Frequency;
  hours: number | null;
  /** Overtime hours at 1.5x (hourly only). */
  overtimeHours?: number;
  bonus: Cents;
  company: CompanyStateSettings;
  employerSize: number;
  prior: LineDetail[];
  advances: AdvanceForRun[];
  /** YYYY-MM-DD; needed for retirement plan eligibility and limits. Defaults to today. */
  payday?: string;
}

/** Compute one paycheck, including retirement, health and advance repayment deductions. */
export function computePaycheck(e: EmployeeTaxProfile, ctx: PaycheckContext): LineDetail {
  const regular = regularWages(e, ctx.frequency, ctx.hours) + overtimeWages(e, ctx.overtimeHours ?? 0);
  const gross = regular + ctx.bonus;
  const deductions: Deduction[] = [];
  let retirement: RetirementLine | undefined;
  if (e.retirement) {
    const r = retirementForPaycheck({
      ...e.retirement,
      gross,
      payday: ctx.payday ?? new Date().toISOString().slice(0, 10),
      ytd: retirementYtd(ctx.prior),
    });
    retirement = r.line;
    deductions.push(...r.deductions);
  } else if (e.retirementPretaxRate > 0) {
    deductions.push({ kind: "retirement_pretax", amount: Math.round(gross * e.retirementPretaxRate) });
  }
  if (e.healthPremiumCents > 0) deductions.push({ kind: "section125_health", amount: Math.min(e.healthPremiumCents, gross) });

  const { ytd, stateYtd } = ytdFrom(ctx.prior, e.workState);
  const input = {
    employeeId: e.id,
    frequency: FREQ[ctx.frequency],
    regularWages: regular,
    supplementalWages: ctx.bonus,
    deductions,
    federalW4: employeeFederalW4(e),
    workState: e.workState,
    ytd,
    state: employeeStateCertificate(e),
    employerState: {
      suiRate: ctx.company.suiRate,
      employerSize: ctx.employerSize,
      orTransitDistrict: (ctx.company.orTransitDistrict as "trimet" | "lane" | null) ?? undefined,
    },
    stateYtd,
  };
  let result = calculatePaycheck(input);

  // Advance repayment comes last: it is taken from net pay and never below the minimum wage floor.
  const advanceRepayments: { advanceId: string; amount: Cents }[] = [];
  let net = result.net;
  const floor = Math.round(((ctx.hours ?? 0) + (ctx.overtimeHours ?? 0)) * (MIN_WAGE_2026[e.workState] ?? 0));
  for (const a of ctx.advances) {
    const amount = advanceDeduction({
      advance: { principal: a.principalCents, installment: a.installmentCents, repaid: a.repaidCents, authorizationOnFile: a.authorizationSigned },
      netPayBefore: net,
      minimumWageFloor: floor,
    });
    if (amount > 0) {
      advanceRepayments.push({ advanceId: a.id, amount });
      net -= amount;
    }
  }
  if (advanceRepayments.length) {
    const total = advanceRepayments.reduce((s, r) => s + r.amount, 0);
    deductions.push({ kind: "advance_repayment", amount: total });
    // advance_repayment reduces no wage base, so taxes are unchanged; re-run only to re-total.
    result = calculatePaycheck({ ...input, deductions });
  }
  return { frequency: FREQ[ctx.frequency], result, deductionDetail: deductions, advanceRepayments, supplemental: ctx.bonus, ...(retirement ? { retirement } : {}) };
}

/** Stored lines back into the records the filings library reads. */
export function toPaycheckRecord(line: { employeeId: string; detail: unknown }, run: { payday: Date; periodStart: Date; periodEnd: Date }): PaycheckRecord {
  const d = line.detail as LineDetail;
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return {
    payday: iso(run.payday),
    periodStart: iso(run.periodStart),
    periodEnd: iso(run.periodEnd),
    employeeId: line.employeeId,
    result: d.result,
    deductionDetail: d.deductionDetail,
    employerRetirement: d.retirement ? totalEmployer(d.retirement) : 0,
  };
}
