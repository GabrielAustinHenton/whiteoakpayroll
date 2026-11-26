import { dollars } from "../../../money";
import type { Source } from "../../types";

/**
 * Oregon 2026 withholding: ODR 150-206-436, Oregon Withholding Tax Formulas (Rev. 12-31-25),
 * effective January 1, 2026.
 */
export const OR_SOURCE: Source = {
  cite: "Oregon DOR 150-206-436, Withholding Tax Formulas 2026 (Rev. 12-31-25)",
  url: "https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2026.pdf",
  readOn: "2026-11-26",
  verified: true,
  note: "The PDF's Example 1 narrative and FAQ 3 still show 2025 figures ($8,500, $21,165, $1,798); the worksheet lines use 2026 figures and are what we follow.",
};

/** A rate-schedule row: withholding = base + rate * (BASE - over). */
export interface OrRow {
  over: number;
  base: number;
  rate: number;
}
const r = (over: number, base: number, rate: number): OrRow => ({ over: dollars(over), base: dollars(base), rate });

export const OR_2026 = {
  standardDeduction: { single: dollars(2_910), marriedOrSingle3Plus: dollars(5_820) },
  federalSubtractionCap: dollars(8_750),
  /** Phase-out of the federal tax subtraction, by annual wages: [wages at least, max subtraction]. */
  phaseOut: {
    single: [
      [0, 8_750], [125_000, 7_000], [130_000, 5_250], [135_000, 3_500], [140_000, 1_750], [145_000, 0],
    ].map(([w, a]) => ({ wagesAtLeast: dollars(w), cap: dollars(a) })),
    married: [
      [0, 8_750], [250_000, 7_000], [260_000, 5_250], [270_000, 3_500], [280_000, 1_750], [290_000, 0],
    ].map(([w, a]) => ({ wagesAtLeast: dollars(w), cap: dollars(a) })),
  },
  exemptionCredit: dollars(263),
  /** Allowances are not allowed above these annual wages. */
  allowanceCutoff: { single: dollars(100_000), married: dollars(200_000) },
  /** Wages at or above this use the "$50,000 or more" schedules. */
  highWageThreshold: dollars(50_000),
  schedules: {
    /** A: wages under $50,000, single with fewer than 3 allowances. */
    lowSingle: [r(0, 263, 0.0475), r(4_550, 479, 0.0675), r(11_400, 941, 0.0875)],
    /** B: wages under $50,000, married or single with 3+ allowances. */
    lowMarried: [r(0, 263, 0.0475), r(9_100, 695, 0.0675), r(22_800, 1_620, 0.0875)],
    /** C: wages $50,000+, single with fewer than 3 allowances. Row 1 continues the 8.75% slope from 11,400. */
    highSingle: [r(11_400, 678, 0.0875), r(125_000, 10_618, 0.099)],
    /** D: wages $50,000+, married or single with 3+ allowances. */
    highMarried: [r(22_800, 1_357, 0.0875), r(250_000, 21_237, 0.099)],
  },
  /** HB 2119: no OR-W-4 on file (or expired exemption) = flat 8% of wages. Also the optional supplemental rate. */
  noFormRate: 0.08,
  supplementalRate: 0.08,
} as const;

export const OR_OTHER_2026 = {
  /** Statewide transit tax, employee-paid, on all wages of Oregon residents and of nonresidents for work in Oregon. */
  statewideTransitRate: 0.001,
  /** Employer transit payroll taxes. VERIFY: values not read from TriMet/LTD for 2026. */
  triMetRate: 0.008337,
  laneTransitRate: 0.008,
  sui: { wageBase: dollars(56_700) },
  source: {
    cite: "Oregon statewide transit tax (ORS 320.550); EY 2026 SUI wage bases (OR $56,700); TriMet and LTD payroll tax pages",
    url: "https://www.oregon.gov/dor/programs/businesses/Pages/Statewide-Transit-Tax.aspx",
    readOn: "2026-11-26",
    verified: false,
    note: "0.1% transit rate and $56,700 base from secondary sources. TriMet 0.8337% and LTD 0.80% are unverified estimates; read trimet.org and ltd.org before launch. Workers' Benefit Fund (cents per hour) not modeled yet.",
  } satisfies Source,
} as const;
