import { dollars } from "../../../money";
import type { Source } from "../../types";

/**
 * Massachusetts 2026 withholding: DOR Circular M (effective January 1, 2026), percentage method.
 */
export const MA_2026 = {
  rate: 0.05,
  /** 4% surtax: withhold 9% on annualized wages above the 2026 surtax threshold. */
  surtaxRate: 0.04,
  surtaxThreshold: dollars(1_107_750),
  /** FICA, Medicare and MA/US/Railroad retirement deductions, capped per year. */
  ficaDeductionCap: dollars(2_000),
  /** Annual exemption: 1 exemption = $4,400; more than 1 = $1,000 x n + $3,400. Spouse counts as 4. */
  exemptionOne: dollars(4_400),
  exemptionPer: dollars(1_000),
  exemptionPlus: dollars(3_400),
  headOfHouseholdCredit: dollars(120),
  blindCredit: dollars(110),
  /** No withholding when annual wages are $8,000 or less (employee claiming 1+ exemptions). */
  noWithholdingFloor: dollars(8_000),
  source: {
    cite: "MA DOR Circular M, Income Tax Withholding Tables, effective January 1, 2026 (percentage method, pp. 12-13); MA DOR 4% surtax page",
    url: "https://www.mass.gov/doc/massachusetts-circular-m-income-tax-withholding-tables-at-50-effective-january-1-2026/download",
    readOn: "2026-11-26",
    verified: false,
    note: "Surtax threshold $1,107,750 read verbatim from mass.gov. The percentage-method steps, exemption formula, credits and $8,000 floor came from a summary of pages 12-13, not verbatim text: re-read those pages before launch.",
  } satisfies Source,
} as const;

export const MA_SUI_2026 = {
  wageBase: dollars(15_000),
  /** Employer Medical Assistance Contribution, on the same $15,000 base, employers with 6+ employees. */
  emacRate: 0.0036,
  emacMinEmployees: 6,
  source: {
    cite: "EY Tax News 2026 SUI wage bases (MA $15,000); MA DUA EMAC",
    url: "https://taxnews.ey.com/news/2026-0124-2026-state-unemployment-insurance-taxable-wage-bases",
    readOn: "2026-11-26",
    verified: false,
    note: "Wage base from EY's table, not mass.gov. EMAC 0.36% is from memory and must be verified with DUA. The employer's assigned UI rate (which includes the workforce training fund) comes from the DUA rate notice.",
  } satisfies Source,
} as const;
