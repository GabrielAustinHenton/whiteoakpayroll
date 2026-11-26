import { FICA_2026, FUTA_2026 } from "../tax-engine/tables/2026/federal";

/**
 * 2026 federal payroll tax constants used by the employer cost preview.
 * Values now come from the tax engine's versioned tables (src/lib/tax-engine/tables/2026), which
 * carry their sources and verification status.
 */
export const FEDERAL_2026 = {
  socialSecurity: FICA_2026.socialSecurity,
  medicare: {
    rate: FICA_2026.medicare.rate,
    additionalEmployeeRate: FICA_2026.medicare.additionalRate,
    additionalThreshold: FICA_2026.medicare.additionalThreshold,
  },
  futa: { grossRate: FUTA_2026.grossRate, maxCredit: FUTA_2026.maxCredit, wageBase: FUTA_2026.wageBase },
} as const;
