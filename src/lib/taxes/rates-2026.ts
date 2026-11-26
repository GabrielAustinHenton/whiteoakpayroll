import { dollars } from "../money";

/**
 * 2026 federal payroll tax constants.
 *
 * VERIFY BEFORE LAUNCH: these figures were entered from memory during scaffolding and must be
 * checked against IRS Publication 15 and the SSA wage base announcement for 2026.
 * The payroll provider remains the source of truth for actual withholding; these constants power
 * our own employer cost preview and cross-checks.
 */
export const FEDERAL_2026 = {
  socialSecurity: {
    rate: 0.062, // each of employer and employee
    wageBase: dollars(184_500),
  },
  medicare: {
    rate: 0.0145, // each of employer and employee, no wage base
    additionalEmployeeRate: 0.009, // employee only, on wages above threshold
    additionalThreshold: dollars(200_000),
  },
  futa: {
    grossRate: 0.06,
    maxCredit: 0.054,
    wageBase: dollars(7_000),
  },
} as const;
