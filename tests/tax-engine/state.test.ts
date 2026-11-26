import { describe, expect, it } from "vitest";
import { dollars } from "@/lib/money";
import {
  calculatePaycheck,
  ctCreditDecimal,
  ctExemption,
  ctWithholding,
  maWithholding,
  nycWithholding,
  nysWithholding,
  orWithholding,
  perPeriodSchedule,
  yonkersWithholding,
} from "@/lib/tax-engine";
import { NYS_2026 } from "@/lib/tax-engine/tables/2026/ny";

describe("Connecticut (TPG-211)", () => {
  it("phases out the Table A exemption by $1,000 per $1,000 of salary", () => {
    expect(ctExemption("A", dollars(24_000))).toBe(dollars(12_000));
    expect(ctExemption("A", dollars(24_500))).toBe(dollars(11_000));
    expect(ctExemption("A", dollars(34_500))).toBe(dollars(1_000));
    expect(ctExemption("A", dollars(35_500))).toBe(0);
    expect(ctExemption("C", dollars(48_000))).toBe(dollars(24_000));
  });

  it("reads the Table E credit decimal", () => {
    expect(ctCreditDecimal("F", dollars(52_000))).toBe(0.1);
    expect(ctCreditDecimal("A", dollars(26_000))).toBe(0.13);
    expect(ctCreditDecimal("C", dollars(100_600))).toBe(0);
  });

  it("code F, biweekly $2,000", () => {
    // salary 52,000, no exemption; 2,000 + 5.5% x 2,000 = 2,110; x (1 - 0.10) = 1,899; / 26 = 73.04
    expect(ctWithholding(dollars(2_000), "biweekly", { code: "F" })).toBe(7_304);
  });

  it("code A, weekly $500", () => {
    // salary 26,000, exemption 10,000; 200 + 4.5% x 6,000 = 470; x 0.87 = 408.90; / 52 = 7.86
    expect(ctWithholding(dollars(500), "weekly", { code: "A" })).toBe(786);
  });

  it("adds the phase-out and recapture for high earners (code A, $152,000)", () => {
    // taxable 152,000: 4,750 + 6% x 52,000 = 7,870; + 250 phase-out + 250 recapture = 8,370; / 12 = 697.50
    expect(ctWithholding(dollars(152_000 / 12), "monthly", { code: "A" })).toBe(69_750);
  });

  it("code E withholds nothing; no CT-W4 withholds 6.99%", () => {
    expect(ctWithholding(dollars(2_000), "biweekly", { code: "E" })).toBe(0);
    expect(ctWithholding(dollars(2_000), "biweekly", { code: null })).toBe(dollars(139.8));
  });
});

describe("Massachusetts (Circular M)", () => {
  it("weekly $1,000, 1 exemption, first check of the year", () => {
    // (1,000 - 76.50 FICA) x 52 = 48,022 - 4,400 = 43,622 x 5% = 2,181.10 / 52 = 41.94
    const r = maWithholding({ wages: dollars(1_000), frequency: "weekly", w4: { exemptions: 1 }, ficaThisPeriod: dollars(76.5), ficaDeductionUsedBefore: 0 });
    expect(r.withholding).toBe(4_194);
    expect(r.ficaDeductionUsed).toBe(dollars(76.5));
  });

  it("stops the FICA deduction at $2,000 a year and applies the 4% surtax", () => {
    // 1,200,000 - 4,400 = 1,195,600 x 5% = 59,780 + 4% x 87,850 = 63,294 / 12 = 5,274.50
    const r = maWithholding({ wages: dollars(100_000), frequency: "monthly", w4: { exemptions: 1 }, ficaThisPeriod: dollars(1_450), ficaDeductionUsedBefore: dollars(2_000) });
    expect(r.withholding).toBe(dollars(5_274.5));
  });

  it("head of household and blind credits, and the $8,000 floor", () => {
    const base = { wages: dollars(1_000), frequency: "weekly" as const, ficaThisPeriod: 0, ficaDeductionUsedBefore: dollars(2_000) };
    // 52,000 - 5,400 = 46,600 x 5% = 2,330 / 52 = 44.81; less $120 HOH and $110 blind = 2,100 / 52 = 40.38
    expect(maWithholding({ ...base, w4: { exemptions: 2 } }).withholding).toBe(4_481);
    expect(maWithholding({ ...base, w4: { exemptions: 2, headOfHousehold: true, blind: 1 } }).withholding).toBe(4_038);
    expect(maWithholding({ ...base, wages: dollars(150), w4: { exemptions: 1 } }).withholding).toBe(0);
  });
});

describe("Oregon (150-206-436)", () => {
  it("matches the 2026 publication's Example 1 ($1,789 a year)", () => {
    const annual = orWithholding({ wages: dollars(25_000), frequency: "annually", w4: { filingStatus: "single", allowances: 0 }, federalWithholding: dollars(1_000) });
    expect(Math.round(annual / 100)).toBe(1_789);
    // Example 2 per-period results: monthly $149, biweekly $69, weekly $34.
    for (const [freq, n, expected] of [["monthly", 12, 149], ["biweekly", 26, 69], ["weekly", 52, 34]] as const) {
      const r = orWithholding({ wages: dollars(25_000 / n), frequency: freq, w4: { filingStatus: "single", allowances: 0 }, federalWithholding: dollars(1_000 / n) });
      expect(Math.round(r / 100)).toBe(expected);
    }
  });

  it("phases out the federal subtraction and allowances for high earners", () => {
    // single, $132,000, 4 allowances (single with 3+ uses the married schedule and $5,820 deduction,
    // but the single phase-out): subtraction capped at $5,250; allowances 0 above $100,000.
    // BASE = 132,000 - 5,250 - 5,820 = 120,930; 1,357 + 8.75% x (120,930 - 22,800) = 9,943.38
    const r = orWithholding({ wages: dollars(132_000), frequency: "annually", w4: { filingStatus: "single", allowances: 4 }, federalWithholding: dollars(21_098) });
    expect(r).toBe(994_338);
  });

  it("no OR-W-4 on file means 8%", () => {
    expect(orWithholding({ wages: dollars(1_000), frequency: "weekly", w4: { filingStatus: "single", allowances: 0, noForm: true }, federalWithholding: 0 })).toBe(dollars(80));
  });
});

describe("New York (NYS-50-T-NYS Method II)", () => {
  it("derives the published per-period single tables from the annual schedule", () => {
    const weekly = perPeriodSchedule(NYS_2026.single, 52);
    expect(weekly[6]).toMatchObject({ over: dollars(2_070), base: 11_358 });
    expect(weekly[9]).toMatchObject({ over: dollars(5_104), base: 36_713 });
    const biweekly = perPeriodSchedule(NYS_2026.single, 26);
    expect(biweekly[9]).toMatchObject({ over: dollars(10_208), base: 73_427 });
    const monthly = perPeriodSchedule(NYS_2026.single, 12);
    expect(monthly[8]).toMatchObject({ over: dollars(17_950), base: 111_408 });
  });

  it("matches the publication's worked examples", () => {
    expect(nysWithholding(dollars(400), "weekly", { status: "single", allowances: 3 })).toBe(801);
    // Publication prints $258.51; Table II-C row 7 gives 246.08 + 7.53% x 165 = 258.5045. Allow the cent.
    expect(Math.abs(nysWithholding(dollars(5_000), "semimonthly", { status: "single", allowances: 1 }) - 25_851)).toBeLessThanOrEqual(1);
    expect(nysWithholding(dollars(50_000), "monthly", { status: "single", allowances: 3 })).toBe(357_663);
    expect(nysWithholding(dollars(750), "daily", { status: "single", allowances: 2 })).toBe(4_410);
  });

  it("Yonkers resident surcharge is 16.75% of NYS tax (publication example: $1.34)", () => {
    expect(yonkersWithholding(dollars(400), 801, { status: "single", allowances: 3, yonkersResident: true })).toBe(134);
  });

  it("NYC: within 5 cents of the 2026 biweekly wage-bracket table at $1,000-$1,020 (single, 0 exemptions = $24.45)", () => {
    const r = nycWithholding(dollars(1_010), "biweekly", { status: "single", allowances: 0, nycResident: true });
    expect(Math.abs(r - 2_445)).toBeLessThanOrEqual(5);
  });

  it("NYC uses IT-2104 line 2 allowances when given", () => {
    const one = nycWithholding(dollars(1_010), "biweekly", { status: "single", allowances: 0, nycAllowances: 1, nycResident: true });
    const same = nycWithholding(dollars(1_010), "biweekly", { status: "single", allowances: 1, nycResident: true });
    expect(one).toBe(same);
  });
});

describe("full paycheck", () => {
  it("NYC resident, biweekly $3,000", () => {
    const r = calculatePaycheck({
      employeeId: "e1",
      frequency: "biweekly",
      regularWages: dollars(3_000),
      deductions: [],
      federalW4: { version: "2020_or_later", filingStatus: "single", multipleJobs: false, dependentsCredit: 0, otherIncome: 0, deductions: 0, extraWithholding: 0 },
      workState: "NY",
      ytd: { ficaWages: 0, futaWages: 0, supplementalWages: 0 },
      state: { state: "NY", w4: { status: "single", allowances: 0, nycResident: true } },
      employerState: { suiRate: 0.041, employerSize: 10 },
      stateYtd: { suiWages: 0, paidLeaveWages: 0, paidLeaveEmployee: 0 },
    });
    const ids = r.lines.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["federal_income", "ny_income", "nyc_income", "ny_dbl", "ny_sui", "ny_rsf", "ny_paid_leave", "futa"]));
    const by = Object.fromEntries(r.lines.map((l) => [l.id, l.amount]));
    expect(by.ny_dbl).toBe(120); // $0.60 a week cap
    expect(by.ny_sui).toBe(dollars(123));
    expect(r.net).toBe(r.gross - r.employeeTaxes);
  });

  it("Oregon worker in TriMet pays the 0.1% statewide transit tax; employer pays TriMet", () => {
    const r = calculatePaycheck({
      employeeId: "e2",
      frequency: "weekly",
      regularWages: dollars(1_000),
      deductions: [{ kind: "retirement_pretax", amount: dollars(50) }],
      federalW4: { version: "2020_or_later", filingStatus: "single", multipleJobs: false, dependentsCredit: 0, otherIncome: 0, deductions: 0, extraWithholding: 0 },
      workState: "OR",
      ytd: { ficaWages: 0, futaWages: 0, supplementalWages: 0 },
      state: { state: "OR", w4: { filingStatus: "single", allowances: 1 } },
      employerState: { suiRate: 0.024, employerSize: 30, orTransitDistrict: "trimet" },
      stateYtd: { suiWages: 0, paidLeaveWages: 0, paidLeaveEmployee: 0 },
    });
    const by = Object.fromEntries(r.lines.map((l) => [l.id, l]));
    expect(by.or_transit.amount).toBe(100);
    expect(by.or_income.taxableWages).toBe(dollars(950));
    expect(by.or_trimet.payer).toBe("employer");
    expect(by.or_paid_leave_er.amount).toBeGreaterThan(0);
  });
});
