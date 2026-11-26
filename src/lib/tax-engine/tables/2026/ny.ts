import { dollars } from "../../../money";
import type { Bracket, PayFrequency, Source } from "../../types";

function rows(r: [number, number, number][]): Bracket {
  return r.map(([over, base, rate]) => ({ over: dollars(over), base: dollars(base), rate }));
}

/**
 * New York State 2026: NYS-50-T-NYS (1/26), Method II exact calculation, effective January 1, 2026.
 * Per-period tables in the publication equal the annual schedule divided by the number of pay
 * periods, with column 1 rounded to the dollar and column 5 rounded to the cent; we derive them the
 * same way (tests check the derived weekly and biweekly single rows against the publication).
 */
export const NYS_SOURCE: Source = {
  cite: "NYS-50-T-NYS (1/26), New York State Withholding Tax Tables and Methods, Method II",
  url: "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf",
  readOn: "2026-11-26",
  verified: true,
  note: "Single schedule and Tables A-C read from the publication. The married schedule and the Method III high-income rates came from USDA NFC bulletin NFC-26-1772477134, because the publication's married page did not extract: verify against NYS-50-T-NYS page 19 and page 22.",
};

export const NYS_2026 = {
  /** Table B deduction allowance per period [single, married]. */
  deductionAllowance: {
    daily: [2_845, 3_060],
    weekly: [14_230, 15_290],
    biweekly: [28_460, 30_580],
    semimonthly: [30_835, 33_125],
    monthly: [61_670, 66_250],
    annually: [dollars(7_400), dollars(7_950)],
  } as Partial<Record<PayFrequency, [number, number]>>,
  annualDeduction: { single: dollars(7_400), married: dollars(7_950) },
  /** Table C value of one exemption per period. */
  exemption: { daily: 385, weekly: 1_925, biweekly: 3_850, semimonthly: 4_165, monthly: 8_330, annually: dollars(1_000) } as Partial<
    Record<PayFrequency, number>
  >,
  annualExemption: dollars(1_000),
  single: rows([
    [0, 0, 0.039],
    [8_500, 332, 0.044],
    [11_700, 472, 0.0515],
    [13_900, 586, 0.054],
    [80_650, 4_190, 0.059],
    [96_800, 5_143, 0.0703],
    [107_650, 5_906, 0.0753],
    [157_650, 9_673, 0.064],
    [215_400, 13_369, 0.1144],
    [265_400, 19_091, 0.0735],
  ]),
  married: rows([
    [0, 0, 0.039],
    [8_500, 332, 0.044],
    [11_700, 472, 0.0515],
    [13_900, 586, 0.054],
    [80_650, 4_190, 0.059],
    [96_800, 5_143, 0.0657],
    [107_650, 5_855, 0.0707],
    [157_650, 9_388, 0.0801],
    [211_550, 13_708, 0.064],
    [323_200, 20_854, 0.1349],
    [373_200, 27_600, 0.0735],
    [1_077_550, 79_369, 0.0765],
  ]),
  /** Method III: annualized net wages at or above these amounts are taxed at a flat rate on the whole amount. */
  methodIII: {
    single: [
      { atLeast: dollars(1_077_550), rate: 0.1045 },
      { atLeast: dollars(5_000_000), rate: 0.111 },
      { atLeast: dollars(25_000_000), rate: 0.117 },
    ],
    married: [
      { atLeast: dollars(2_155_350), rate: 0.1045 },
      { atLeast: dollars(5_000_000), rate: 0.111 },
      { atLeast: dollars(25_000_000), rate: 0.117 },
    ],
  },
  supplementalRate: 0.117,
} as const;

/**
 * New York City residents. VERIFY: the 2026 NYS-50-T-NYC Method II pages did not extract. These
 * figures come from USDA NFC TAXES-18-08 (2018); the NYS bulletin for 2026 says NYC rates did not
 * change. Spot checks against the 2026 NYC biweekly wage-bracket table match within 2 cents at
 * $1,010 but are 83 cents high at $2,910, so the high bracket needs checking before launch.
 */
export const NYC_2026 = {
  annualDeduction: { single: dollars(5_000), married: dollars(5_500) },
  annualExemption: dollars(1_000),
  schedule: rows([
    [0, 0, 0.0205],
    [8_000, 164, 0.028],
    [8_700, 184, 0.0325],
    [15_000, 388, 0.0395],
    [25_000, 783, 0.0415],
    [60_000, 2_236, 0.0425],
  ]),
  supplementalRate: 0.0425,
  source: {
    cite: "NYS-50-T-NYC (1/26) supplemental rate; USDA NFC TAXES-18-08 for the annual schedule",
    url: "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nyc.pdf",
    readOn: "2026-11-26",
    verified: false,
  } satisfies Source,
} as const;

export const YONKERS_2026 = {
  /** Resident surcharge: 16.75% of the NYS withholding. */
  residentSurchargeRate: 0.1675,
  /** Nonresident earnings tax on wages for work in Yonkers. VERIFY: exclusion amounts not applied. */
  nonresidentRate: 0.005,
  source: {
    cite: "NYS-50-T-Y (1/26), Yonkers Withholding Tax Tables and Methods",
    url: "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_y.pdf",
    readOn: "2026-11-26",
    verified: false,
    note: "16.75% resident surcharge read from Method II step 5. 0.50% nonresident rate is the publication's supplemental rate; the Method VI-VIII pages with exclusions did not extract.",
  } satisfies Source,
} as const;

export const NY_OTHER_2026 = {
  sui: { wageBase: dollars(17_600) },
  /** Re-employment Service Fund, employer, on the SUI base. */
  reemploymentServiceFundRate: 0.00075,
  /** Disability benefits (DBL): employee share 0.5% of wages, at most $0.60 per week. */
  dblEmployeeRate: 0.005,
  dblWeeklyMax: 60,
  /**
   * MCTMT (employer, filed with NYS on MTA-305): zone 1 (NYC) 0.60%, zone 2 0.34%, when quarterly
   * payroll expense in the region exceeds $312,500. VERIFY all three figures.
   */
  mctmt: { zone1Rate: 0.006, zone2Rate: 0.0034, quarterlyThreshold: dollars(312_500) },
  source: {
    cite: "EY 2026 SUI wage bases (NY $17,600); NY WCL 209 (DBL); NY Tax Law Article 23 (MCTMT)",
    url: "https://taxnews.ey.com/news/2026-0124-2026-state-unemployment-insurance-taxable-wage-bases",
    readOn: "2026-11-26",
    verified: false,
    note: "Wage base from EY's table, not dol.ny.gov. RSF 0.075%, DBL 0.5%/$0.60 and MCTMT rates are from memory.",
  } satisfies Source,
} as const;
