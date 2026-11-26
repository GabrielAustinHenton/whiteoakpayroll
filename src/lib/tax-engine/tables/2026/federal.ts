import { dollars } from "../../../money";
import type { Bracket, Source } from "../../types";

/**
 * 2026 federal payroll tax tables.
 *
 * Income tax withholding follows IRS Publication 15-T (2026), Worksheet 1A and the Annual
 * Percentage Method Tables for automated payroll systems. Tables are stored exactly as the IRS
 * publishes them (columns A, C, D; column E always equals A). Tests check each row's column C
 * against the previous row, which catches transcription errors.
 */

const PUB_15T: Source = {
  cite: "IRS Pub. 15-T (2026), Worksheet 1A and Annual Percentage Method Tables",
  url: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
  readOn: "2026-11-26",
  verified: true,
  note: "MFJ rows read from the IRS PDF; Single and HOH rows read from the USDA NFC bulletin reproducing Pub. 15-T and cross-checked against Rev. Proc. 2025-32 brackets less the Worksheet 1A line 1g amounts.",
};

/** [column A, column C, column D] in dollars. */
function rows(r: [number, number, number][]): Bracket {
  return r.map(([over, base, rate]) => ({ over: dollars(over), base: dollars(base), rate }));
}

export type FederalFilingStatus = "single" | "married_jointly" | "head_of_household";

export const FEDERAL_INCOME_TAX_2026 = {
  source: PUB_15T,
  /** Worksheet 1A line 1g, used when the Step 2 box is not checked on a 2020+ Form W-4. */
  line1g: { married_jointly: dollars(12_900), single: dollars(8_600), head_of_household: dollars(8_600) },
  /** Worksheet 1A line 1k, per allowance on a 2019-or-earlier Form W-4. */
  allowanceValue: dollars(4_300),
  /** Annual nonresident alien add-on, Pub. 15-T Tables 1 and 2. */
  nonresidentAlienAddOn: { w4From2020: dollars(16_100), w4Before2020: dollars(11_800) },
  /** STANDARD schedule: 2020+ W-4 with Step 2 unchecked, and every 2019-or-earlier W-4. */
  standard: {
    married_jointly: rows([
      [0, 0, 0],
      [19_300, 0, 0.1],
      [44_100, 2_480, 0.12],
      [120_100, 11_600, 0.22],
      [230_700, 35_932, 0.24],
      [422_850, 82_048, 0.32],
      [531_750, 116_896, 0.35],
      [788_000, 206_583.5, 0.37],
    ]),
    single: rows([
      [0, 0, 0],
      [7_500, 0, 0.1],
      [19_900, 1_240, 0.12],
      [57_900, 5_800, 0.22],
      [113_200, 17_966, 0.24],
      [209_275, 41_024, 0.32],
      [263_725, 58_448, 0.35],
      [648_100, 192_979.25, 0.37],
    ]),
    head_of_household: rows([
      [0, 0, 0],
      [15_550, 0, 0.1],
      [33_250, 1_770, 0.12],
      [83_000, 7_740, 0.22],
      [121_250, 16_155, 0.24],
      [217_300, 39_207, 0.32],
      [271_750, 56_631, 0.35],
      [656_150, 191_171, 0.37],
    ]),
  },
  /** Form W-4 Step 2 checkbox schedule (multiple jobs). */
  step2Checkbox: {
    married_jointly: rows([
      [0, 0, 0],
      [16_100, 0, 0.1],
      [28_500, 1_240, 0.12],
      [66_500, 5_800, 0.22],
      [121_800, 17_966, 0.24],
      [217_875, 41_024, 0.32],
      [272_325, 58_448, 0.35],
      [400_450, 103_291.75, 0.37],
    ]),
    single: rows([
      [0, 0, 0],
      [8_050, 0, 0.1],
      [14_250, 620, 0.12],
      [33_250, 2_900, 0.22],
      [60_900, 8_983, 0.24],
      [108_938, 20_512, 0.32],
      [136_163, 29_224, 0.35],
      [328_350, 96_489.63, 0.37],
    ]),
    head_of_household: rows([
      [0, 0, 0],
      [12_075, 0, 0.1],
      [20_925, 885, 0.12],
      [45_800, 3_870, 0.22],
      [64_925, 8_077.5, 0.24],
      [112_950, 19_603.5, 0.32],
      [140_175, 28_315.5, 0.35],
      [332_375, 95_585.5, 0.37],
    ]),
  },
  /** Pub. 15 section 7: optional flat rate for supplemental wages, mandatory rate above $1 million. */
  supplemental: {
    flatRate: 0.22,
    mandatoryRate: 0.37,
    mandatoryThreshold: dollars(1_000_000),
    source: {
      cite: "IRS Pub. 15 (2026), section 7, Supplemental Wages",
      url: "https://www.irs.gov/publications/p15",
      readOn: "2026-11-26",
      verified: false,
      note: "Rates unchanged since 2018 and tied to the 22% and 37% brackets that OBBBA made permanent; confirm in the 2026 Pub. 15 text.",
    } satisfies Source,
  },
} as const;

export const FICA_2026 = {
  socialSecurity: { rate: 0.062, wageBase: dollars(184_500) },
  medicare: { rate: 0.0145, additionalRate: 0.009, additionalThreshold: dollars(200_000) },
  source: {
    cite: "SSA 2026 COLA fact sheet (contribution and benefit base $184,500); IRC 3101(b)(2) Additional Medicare Tax",
    url: "https://www.ssa.gov/news/press/factsheets/colafacts2026.pdf",
    readOn: "2026-11-26",
    verified: false,
    note: "$184,500 is the figure SSA announced in October 2025; re-read the SSA page before launch. Medicare rates and the $200,000 withholding threshold are statutory.",
  } satisfies Source,
} as const;

export const FUTA_2026 = {
  grossRate: 0.06,
  maxCredit: 0.054,
  wageBase: dollars(7_000),
  /**
   * Credit reduction by state for 2026 wages. Announced by the DOL in November 2026 and applied
   * on Form 940 Schedule A. VERIFY the final list before year end; none of the launch states is
   * expected to be a credit-reduction state.
   */
  creditReduction: { CT: 0, MA: 0, OR: 0, NY: 0 } as Record<string, number>,
  source: {
    cite: "IRS Form 940 instructions; DOL FUTA credit reductions",
    url: "https://oui.doleta.gov/unemploy/futa_credit.asp",
    readOn: "2026-11-26",
    verified: false,
    note: "6.0% gross, 5.4% maximum credit and $7,000 base are statutory (IRC 3301, 3302, 3306). Credit-reduction list not yet checked for 2026.",
  } satisfies Source,
} as const;
