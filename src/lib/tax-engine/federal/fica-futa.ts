import { applyRate, type Cents } from "../../money";
import { FICA_2026, FUTA_2026 } from "../tables/2026/federal";

/** Taxable portion of this paycheck under an annual wage base. */
export function underWageBase(thisRun: Cents, ytdBefore: Cents, wageBase: Cents): Cents {
  return Math.max(0, Math.min(thisRun, wageBase - ytdBefore));
}

export interface FicaInput {
  /** Wages subject to FICA this run (gross less section 125 and other FICA-exempt deductions). */
  ficaWages: Cents;
  ytdFicaWagesBefore: Cents;
}

export interface FicaResult {
  socialSecurityWages: Cents;
  medicareWages: Cents;
  employee: { socialSecurity: Cents; medicare: Cents; additionalMedicare: Cents };
  employer: { socialSecurity: Cents; medicare: Cents };
}

/**
 * Social Security and Medicare for both sides. Additional Medicare Tax (0.9%) is withheld from
 * the employee only, on wages paid to that employee above $200,000 in the calendar year,
 * regardless of filing status (IRC 3102(f)).
 */
export function fica(input: FicaInput): FicaResult {
  const { socialSecurity: ss, medicare: med } = FICA_2026;
  const ssWages = underWageBase(input.ficaWages, input.ytdFicaWagesBefore, ss.wageBase);
  const aboveThreshold = Math.max(
    0,
    Math.min(input.ficaWages, input.ytdFicaWagesBefore + input.ficaWages - med.additionalThreshold),
  );
  return {
    socialSecurityWages: ssWages,
    medicareWages: input.ficaWages,
    employee: {
      socialSecurity: applyRate(ssWages, ss.rate),
      medicare: applyRate(input.ficaWages, med.rate),
      additionalMedicare: applyRate(aboveThreshold, med.additionalRate),
    },
    employer: { socialSecurity: applyRate(ssWages, ss.rate), medicare: applyRate(input.ficaWages, med.rate) },
  };
}

export interface FutaResult {
  taxableWages: Cents;
  rate: number;
  amount: Cents;
}

/** Employer-only FUTA at the net rate (6.0% less the 5.4% credit, plus any state credit reduction). */
export function futa(futaWages: Cents, ytdFutaWagesBefore: Cents, state: string): FutaResult {
  const f = FUTA_2026;
  const rate = f.grossRate - f.maxCredit + (f.creditReduction[state] ?? 0);
  const taxableWages = underWageBase(futaWages, ytdFutaWagesBefore, f.wageBase);
  return { taxableWages, rate, amount: applyRate(taxableWages, rate) };
}
