import { dollars } from "../../../money";
import type { Bracket, Source } from "../../types";

/**
 * Connecticut 2026 income tax withholding: DRS TPG-211, Withholding Calculation Rules (Rev. 12/25),
 * effective January 1, 2026. Connecticut has no percentage method; employers use these
 * calculation rules (Steps 1-16) or the wage-bracket tables. TPG-211 states the 2026 rules are
 * unchanged from 2025.
 */
export const CT_SOURCE: Source = {
  cite: "CT DRS TPG-211, 2026 Withholding Calculation Rules (Rev. 12/25)",
  url: "https://portal.ct.gov/drs/withholding-taxes/tax-information",
  readOn: "2026-11-26",
  verified: true,
  note: "Tables read from the TPG-211 PDF text. Band boundaries (over X but not over Y) should be spot-checked against the PDF at the edges.",
};

/** Form CT-W4 withholding codes. E means no withholding; "none" means no CT-W4 on file. */
export type CtCode = "A" | "B" | "C" | "D" | "E" | "F";

/** Table A: full exemption up to `start`, then $1,000 less for each $1,000 (or part) above it. */
export const CT_EXEMPTION: Record<CtCode, { full: number; start: number }> = {
  A: { full: dollars(12_000), start: dollars(24_000) },
  B: { full: dollars(19_000), start: dollars(38_000) },
  C: { full: dollars(24_000), start: dollars(48_000) },
  F: { full: dollars(15_000), start: dollars(30_000) },
  D: { full: 0, start: 0 },
  E: { full: 0, start: 0 },
};

function rows(r: [number, number, number][]): Bracket {
  return r.map(([over, base, rate]) => ({ over: dollars(over), base: dollars(base), rate }));
}

const TABLE_B_ADF = rows([
  [0, 0, 0.02],
  [10_000, 200, 0.045],
  [50_000, 2_000, 0.055],
  [100_000, 4_750, 0.06],
  [200_000, 10_750, 0.065],
  [250_000, 14_000, 0.069],
  [500_000, 31_250, 0.0699],
]);

/** Table B: initial tax on annualized taxable income. */
export const CT_INITIAL_TAX: Record<Exclude<CtCode, "E">, Bracket> = {
  A: TABLE_B_ADF,
  D: TABLE_B_ADF,
  F: TABLE_B_ADF,
  B: rows([
    [0, 0, 0.02],
    [16_000, 320, 0.045],
    [80_000, 3_200, 0.055],
    [160_000, 7_600, 0.06],
    [320_000, 17_200, 0.065],
    [400_000, 22_400, 0.069],
    [800_000, 50_000, 0.0699],
  ]),
  C: rows([
    [0, 0, 0.02],
    [20_000, 400, 0.045],
    [100_000, 4_000, 0.055],
    [200_000, 9_500, 0.06],
    [400_000, 21_500, 0.065],
    [500_000, 28_000, 0.069],
    [1_000_000, 62_500, 0.0699],
  ]),
};

/** A stepped add-on: `step` dollars for each `band` (or part) of salary over `start`, up to `max`, plus `base`. */
export interface Steps {
  start: number;
  band: number;
  step: number;
  base: number;
  max: number;
}
const s = (start: number, band: number, step: number, base: number, max: number): Steps => ({
  start: dollars(start),
  band: dollars(band),
  step: dollars(step),
  base: dollars(base),
  max: dollars(max),
});

/** Table C: 2% phase-out add-back, by annualized salary. */
export const CT_PHASE_OUT: Record<Exclude<CtCode, "E">, Steps[]> = {
  A: [s(50_250, 2_500, 25, 0, 250)],
  D: [s(50_250, 2_500, 25, 0, 250)],
  B: [s(78_500, 4_000, 40, 0, 400)],
  C: [s(100_500, 5_000, 50, 0, 500)],
  F: [s(56_500, 5_000, 25, 0, 250)],
};

const RECAPTURE_ADF = [s(105_000, 5_000, 25, 0, 250), s(200_000, 5_000, 90, 250, 2_950), s(500_000, 5_000, 50, 2_950, 3_400)];

/** Table D: tax recapture, by annualized salary. Later segments replace earlier ones once reached. */
export const CT_RECAPTURE: Record<Exclude<CtCode, "E">, Steps[]> = {
  A: RECAPTURE_ADF,
  D: RECAPTURE_ADF,
  F: RECAPTURE_ADF,
  B: [s(168_000, 8_000, 40, 0, 400), s(320_000, 8_000, 140, 400, 4_600), s(800_000, 8_000, 80, 4_600, 5_320)],
  C: [s(210_000, 10_000, 50, 0, 500), s(400_000, 10_000, 180, 500, 5_900), s(1_000_000, 10_000, 100, 5_900, 6_800)],
};

/** Table E: personal tax credit decimal. Each [over, decimal] applies to salary over `over`. */
function credit(r: [number, number][]): { over: number; decimal: number }[] {
  return r.map(([over, decimal]) => ({ over: dollars(over), decimal }));
}

export const CT_CREDIT: Record<Exclude<CtCode, "E">, { over: number; decimal: number }[]> = {
  A: credit([
    [12_000, 0.75], [15_000, 0.7], [15_500, 0.65], [16_000, 0.6], [16_500, 0.55], [17_000, 0.5], [17_500, 0.45],
    [18_000, 0.4], [18_500, 0.35], [20_000, 0.3], [20_500, 0.25], [21_000, 0.2], [21_500, 0.15], [25_000, 0.14],
    [25_500, 0.13], [26_000, 0.12], [26_500, 0.11], [27_000, 0.1], [48_000, 0.09], [48_500, 0.08], [49_000, 0.07],
    [49_500, 0.06], [50_000, 0.05], [50_500, 0.04], [51_000, 0.03], [51_500, 0.02], [52_000, 0.01], [52_500, 0],
  ]),
  B: credit([
    [19_000, 0.75], [24_000, 0.7], [24_500, 0.65], [25_000, 0.6], [25_500, 0.55], [26_000, 0.5], [26_500, 0.45],
    [27_000, 0.4], [27_500, 0.35], [34_000, 0.3], [34_500, 0.25], [35_000, 0.2], [35_500, 0.15], [44_000, 0.14],
    [44_500, 0.13], [45_000, 0.12], [45_500, 0.11], [46_000, 0.1], [74_000, 0.09], [74_500, 0.08], [75_000, 0.07],
    [75_500, 0.06], [76_000, 0.05], [76_500, 0.04], [77_000, 0.03], [77_500, 0.02], [78_000, 0.01], [78_500, 0],
  ]),
  C: credit([
    [24_000, 0.75], [30_000, 0.7], [30_500, 0.65], [31_000, 0.6], [31_500, 0.55], [32_000, 0.5], [32_500, 0.45],
    [33_000, 0.4], [33_500, 0.35], [40_000, 0.3], [40_500, 0.25], [41_000, 0.2], [41_500, 0.15], [50_000, 0.14],
    [50_500, 0.13], [51_000, 0.12], [51_500, 0.11], [52_000, 0.1], [96_000, 0.09], [96_500, 0.08], [97_000, 0.07],
    [97_500, 0.06], [98_000, 0.05], [98_500, 0.04], [99_000, 0.03], [99_500, 0.02], [100_000, 0.01], [100_500, 0],
  ]),
  F: credit([
    [15_000, 0.75], [18_800, 0.7], [19_300, 0.65], [19_800, 0.6], [20_300, 0.55], [20_800, 0.5], [21_300, 0.45],
    [21_800, 0.4], [22_300, 0.35], [25_000, 0.3], [25_500, 0.25], [26_000, 0.2], [26_500, 0.15], [31_300, 0.14],
    [31_800, 0.13], [32_300, 0.12], [32_800, 0.11], [33_300, 0.1], [60_000, 0.09], [60_500, 0.08], [61_000, 0.07],
    [61_500, 0.06], [62_000, 0.05], [62_500, 0.04], [63_000, 0.03], [63_500, 0.02], [64_000, 0.01], [64_500, 0],
  ]),
  D: credit([[0, 0]]),
};

/** Form CT-W4 employer instructions: no CT-W4 on file means 6.99% with no exemption. */
export const CT_NO_FORM_RATE = 0.0699;

export const CT_SUI_2026 = {
  wageBase: dollars(27_000),
  newEmployerRate: 0.019,
  /** Fund solvency rate included in every 2026 contribution rate (min 1.1%, max 9.9%). */
  fundSolvencyRate: 0.01,
  source: {
    cite: "CT DOL, Information on Unemployment Tax Rate for Calendar Year 2026",
    url: "https://portal.ct.gov/dol/divisions/unemployment-insurance-tax/information-on-unemployment-tax-rate-for-calendar-year-2026",
    readOn: "2026-11-26",
    verified: true,
    note: "Whether the 1.0% fund solvency rate is added on top of the 1.9% new-employer rate is not stated; use the rate on the employer's DOL notice.",
  } satisfies Source,
};
