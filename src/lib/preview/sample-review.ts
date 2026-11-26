import { dollars } from "../money";
import type { LaunchState } from "../payroll/schedules";
import type { ReviewEmployeeInput, ReviewInput, StateUnemployment } from "../pay-run/review";
import type { Deduction, FederalW4 } from "../tax-engine";
import { sampleRoster } from "./sample-roster";

/**
 * Sample unemployment setting for the preview. Every employer gets its own assigned rate from the
 * state, so this is an example, not a real rate for any state.
 */
export const SAMPLE_UNEMPLOYMENT: StateUnemployment = { rate: 0.03, wageBase: dollars(26_100) };

const W4S: FederalW4[] = [
  { version: "2020_or_later", filingStatus: "single", multipleJobs: false, dependentsCredit: 0, otherIncome: 0, deductions: 0, extraWithholding: 0 },
  { version: "2020_or_later", filingStatus: "married_jointly", multipleJobs: false, dependentsCredit: dollars(4_400), otherIncome: 0, deductions: 0, extraWithholding: 0 },
  { version: "2020_or_later", filingStatus: "head_of_household", multipleJobs: false, dependentsCredit: dollars(2_200), otherIncome: 0, deductions: 0, extraWithholding: 0 },
  { version: "2020_or_later", filingStatus: "single", multipleJobs: true, dependentsCredit: 0, otherIncome: 0, deductions: 0, extraWithholding: dollars(25) },
];

/** Per-paycheck deductions as a share of gross, cycled across the roster. */
const DEDUCTIONS: { kind: Deduction["kind"]; share: number }[][] = [
  [{ kind: "retirement_pretax", share: 0.05 }, { kind: "section125_health", share: 0.04 }],
  [{ kind: "section125_health", share: 0.06 }],
  [],
  [{ kind: "retirement_roth", share: 0.03 }],
  [{ kind: "retirement_pretax", share: 0.06 }, { kind: "hsa_section125", share: 0.02 }],
];

/** A repeatable bi-weekly pay run of `count` made-up employees, all working in `state`. */
export function sampleReview(count: number, state: LaunchState): ReviewInput {
  const employees: ReviewEmployeeInput[] = sampleRoster(count).map((e, i) => ({
    employeeId: e.employeeId,
    frequency: "biweekly",
    regularWages: e.grossWages,
    deductions: DEDUCTIONS[i % DEDUCTIONS.length].map((d) => ({ kind: d.kind, amount: Math.round(e.grossWages * d.share) })),
    federalW4: W4S[i % W4S.length],
    workState: state,
    ytd: { ficaWages: e.ytdWagesBefore, futaWages: e.ytdWagesBefore, supplementalWages: 0 },
  }));
  return { employees, unemployment: { [state]: SAMPLE_UNEMPLOYMENT }, employerSize: count };
}
