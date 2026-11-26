import { applyRate, dollars, type Cents } from "../money";
import type { LaunchState } from "../payroll/schedules";
import { FEDERAL_2026 } from "./rates-2026";
import { taxableUnderBase } from "./employer-taxes";

/**
 * 2026 state paid family and medical leave contributions for the launch states.
 *
 * Sources (read 2026-11-26):
 * - CT Paid Leave: 0.5% of wages, employee-paid, capped at the Social Security wage base; rate held for 2026 and 2027.
 *   https://www.ctpaidleave.org/how-ct-paid-leave-works/contributions
 *   https://www.ctpaidleave.org/remit-contributions
 * - MA PFML: 0.88% total for employers with 25+ covered individuals (employee up to 0.46%, employer 0.42%);
 *   0.46% employee-only under 25. Capped at the Social Security wage base. Split changes January 1, 2027.
 *   https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator
 * - Paid Leave Oregon: 60% employee / 40% employer (employer share only at 25+ employees); 2026 wage cap $184,500.
 *   https://paidleave.oregon.gov/employers/small-employers.html
 *   VERIFY: the 1% total rate for 2026 was not confirmed on an official page.
 * - NY PFL: 0.432% employee, annual maximum $411.91 in 2026. https://paidfamilyleave.ny.gov/2026
 *   NY disability (DBL) is not modeled yet.
 */
export interface PaidLeaveRule {
  program: string;
  employeeRate: number;
  /** Employer rate when the employer is at or above the size threshold. */
  employerRate: number;
  /** Employee rate when below the size threshold (MA lets small employers withhold the full rate from employees). */
  smallEmployerEmployeeRate?: number;
  /** Employer share applies only at or above this many employees. */
  employerShareThreshold?: number;
  /** Annual wage cap; contributions stop once YTD wages reach it. */
  wageBase?: Cents;
  /** Annual maximum employee contribution (NY sets a dollar max instead of a wage cap). */
  employeeAnnualMax?: Cents;
}

export const PAID_LEAVE_2026: Record<LaunchState, PaidLeaveRule> = {
  CT: { program: "CT Paid Leave", employeeRate: 0.005, employerRate: 0, wageBase: FEDERAL_2026.socialSecurity.wageBase },
  MA: {
    program: "MA PFML",
    employeeRate: 0.0046,
    employerRate: 0.0042,
    smallEmployerEmployeeRate: 0.0046,
    employerShareThreshold: 25,
    wageBase: FEDERAL_2026.socialSecurity.wageBase,
  },
  OR: {
    program: "Paid Leave Oregon",
    employeeRate: 0.006,
    employerRate: 0.004,
    employerShareThreshold: 25,
    wageBase: dollars(184_500),
  },
  NY: { program: "NY Paid Family Leave", employeeRate: 0.00432, employerRate: 0, employeeAnnualMax: dollars(411.91) },
};

export interface PaidLeaveInput {
  state: LaunchState;
  grossWages: Cents;
  ytdWagesBefore: Cents;
  /** Employee contributions already withheld this year (for NY's annual max). */
  ytdEmployeeContributionBefore?: Cents;
  /** Employees (or MA covered individuals) the employer has, for the employer-share threshold. */
  employerSize: number;
}

export interface PaidLeaveResult {
  program: string;
  taxableWages: Cents;
  /** Withheld from the employee's pay. */
  employee: Cents;
  /** Paid by the employer; shown in the employer cost view. */
  employer: Cents;
}

export function paidLeaveContribution(input: PaidLeaveInput): PaidLeaveResult {
  const rule = PAID_LEAVE_2026[input.state];
  const taxable =
    rule.wageBase === undefined
      ? input.grossWages
      : taxableUnderBase(input.grossWages, input.ytdWagesBefore, rule.wageBase);

  const large = rule.employerShareThreshold === undefined || input.employerSize >= rule.employerShareThreshold;
  const employeeRate = large ? rule.employeeRate : (rule.smallEmployerEmployeeRate ?? rule.employeeRate);
  const employerRate = large ? rule.employerRate : 0;

  let employee = applyRate(taxable, employeeRate);
  if (rule.employeeAnnualMax !== undefined) {
    const room = Math.max(0, rule.employeeAnnualMax - (input.ytdEmployeeContributionBefore ?? 0));
    employee = Math.min(employee, room);
  }

  return { program: rule.program, taxableWages: taxable, employee, employer: applyRate(taxable, employerRate) };
}
