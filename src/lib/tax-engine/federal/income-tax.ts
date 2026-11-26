import type { Cents } from "../../money";
import { PAY_PERIODS, roundCents, taxFromBracket, type PayFrequency } from "../types";
import { FEDERAL_INCOME_TAX_2026, type FederalFilingStatus } from "../tables/2026/federal";

/** What the employee put on Form W-4. Amounts are annual, in cents, as written on the form. */
export type FederalW4 =
  | {
      version: "2020_or_later";
      filingStatus: FederalFilingStatus;
      /** Step 2(c) checkbox: multiple jobs or spouse works. */
      multipleJobs: boolean;
      /** Step 3 total credits. */
      dependentsCredit: Cents;
      /** Step 4(a) other income. */
      otherIncome: Cents;
      /** Step 4(b) deductions. */
      deductions: Cents;
      /** Step 4(c) extra withholding per pay period. */
      extraWithholding: Cents;
      /** Exempt checkbox below Step 4(c). */
      exempt?: boolean;
      nonresidentAlien?: boolean;
    }
  | {
      version: "2019_or_earlier";
      /** "married_higher_single" is the old "Married, but withhold at higher Single rate" box. */
      maritalStatus: "single" | "married" | "married_higher_single";
      allowances: number;
      /** Line 6 additional amount per pay period. */
      extraWithholding: Cents;
      exempt?: boolean;
      nonresidentAlien?: boolean;
    };

export interface FederalIncomeTaxInput {
  /** Wages subject to federal income tax this period (after pre-tax deductions). */
  taxableWages: Cents;
  frequency: PayFrequency;
  w4: FederalW4;
  year?: 2026;
}

export interface FederalIncomeTaxResult {
  withholding: Cents;
  /** Worksheet 1A line 2a, for audit display. */
  adjustedAnnualWage: Cents;
  tentativePerPeriod: Cents;
}

/**
 * Federal income tax withholding by the IRS Pub. 15-T Worksheet 1A percentage method for
 * automated payroll systems. Works in cents and rounds once, at the end, to the nearest cent
 * (Pub. 15-T allows rounding to the nearest dollar; cents keep us closer to the exact method).
 */
export function federalIncomeTax(input: FederalIncomeTaxInput): FederalIncomeTaxResult {
  const t = FEDERAL_INCOME_TAX_2026;
  const { w4 } = input;
  const periods = PAY_PERIODS[input.frequency];
  if (w4.exempt) return { withholding: 0, adjustedAnnualWage: 0, tentativePerPeriod: 0 };

  // Nonresident aliens: add the Table 1 or 2 amount to wages before figuring withholding.
  const nraAddOn = w4.nonresidentAlien
    ? (w4.version === "2020_or_later" ? t.nonresidentAlienAddOn.w4From2020 : t.nonresidentAlienAddOn.w4Before2020) / periods
    : 0;

  const line1c = (input.taxableWages + nraAddOn) * periods;

  let adjusted: number;
  let table;
  if (w4.version === "2020_or_later") {
    const line1e = line1c + w4.otherIncome;
    const line1g = w4.multipleJobs ? 0 : t.line1g[w4.filingStatus];
    adjusted = Math.max(0, line1e - (w4.deductions + line1g));
    table = (w4.multipleJobs ? t.step2Checkbox : t.standard)[w4.filingStatus];
  } else {
    adjusted = Math.max(0, line1c - w4.allowances * t.allowanceValue);
    table = t.standard[w4.maritalStatus === "married" ? "married_jointly" : "single"];
  }

  const annualTax = taxFromBracket(table, adjusted);
  const line2h = annualTax / periods;
  const credits = w4.version === "2020_or_later" ? w4.dependentsCredit / periods : 0;
  const line3c = Math.max(0, line2h - credits);
  const withholding = roundCents(line3c) + w4.extraWithholding;

  return { withholding, adjustedAnnualWage: roundCents(adjusted), tentativePerPeriod: roundCents(line2h) };
}

/**
 * Withholding on supplemental wages (bonuses, commissions) paid separately from regular wages,
 * using the optional flat rate, and the mandatory 37% on the part of supplemental wages that takes
 * the year's total above $1 million (Pub. 15 section 7).
 */
export function federalSupplementalTax(supplemental: Cents, ytdSupplementalBefore: Cents): Cents {
  const s = FEDERAL_INCOME_TAX_2026.supplemental;
  const roomUnderMillion = Math.max(0, s.mandatoryThreshold - ytdSupplementalBefore);
  const atFlat = Math.min(supplemental, roomUnderMillion);
  const atMandatory = supplemental - atFlat;
  return roundCents(atFlat * s.flatRate + atMandatory * s.mandatoryRate);
}
