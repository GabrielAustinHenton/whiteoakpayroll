import { describe, expect, it } from "vitest";
import { dollars } from "@/lib/money";
import {
  FEDERAL_INCOME_TAX_2026,
  federalIncomeTax,
  federalPaycheck,
  federalSupplementalTax,
  fica,
  futa,
  taxableWages,
  type FederalW4,
} from "@/lib/tax-engine";
import type { Bracket } from "@/lib/tax-engine/types";

const w4 = (over: Partial<Extract<FederalW4, { version: "2020_or_later" }>> = {}): FederalW4 => ({
  version: "2020_or_later",
  filingStatus: "single",
  multipleJobs: false,
  dependentsCredit: 0,
  otherIncome: 0,
  deductions: 0,
  extraWithholding: 0,
  ...over,
});

/** Column C of each row must equal the previous row's C + (A - previous A) * previous D. */
function expectConsistent(table: Bracket) {
  for (let i = 1; i < table.length; i++) {
    const prev = table[i - 1];
    const expected = prev.base + (table[i].over - prev.over) * prev.rate;
    // The IRS computes C from unrounded half-bracket boundaries (e.g. 108,937.50) and prints A
    // rounded to the dollar, so allow up to 25 cents of drift.
    expect(Math.abs(table[i].base - expected), `row ${i}`).toBeLessThanOrEqual(25);
  }
}

describe("Pub. 15-T 2026 tables", () => {
  for (const schedule of ["standard", "step2Checkbox"] as const)
    for (const status of ["single", "married_jointly", "head_of_household"] as const)
      it(`${schedule} ${status} rows are internally consistent`, () => expectConsistent(FEDERAL_INCOME_TAX_2026[schedule][status]));

  it("standard tables start at the 2026 standard deduction less the line 1g amount", () => {
    // Rev. Proc. 2025-32 / OBBBA 2026 standard deductions: $16,100 single, $32,200 MFJ, $24,150 HOH.
    expect(FEDERAL_INCOME_TAX_2026.standard.single[1].over).toBe(dollars(16_100 - 8_600));
    expect(FEDERAL_INCOME_TAX_2026.standard.married_jointly[1].over).toBe(dollars(32_200 - 12_900));
    expect(FEDERAL_INCOME_TAX_2026.standard.head_of_household[1].over).toBe(dollars(24_150 - 8_600));
  });
});

describe("federal income tax withholding (Worksheet 1A)", () => {
  it("single, biweekly $2,000", () => {
    // 2,000 x 26 = 52,000 - 8,600 = 43,400; 1,240 + 12% x (43,400 - 19,900) = 4,060; / 26 = 156.15
    const r = federalIncomeTax({ taxableWages: dollars(2_000), frequency: "biweekly", w4: w4() });
    expect(r.adjustedAnnualWage).toBe(dollars(43_400));
    expect(r.withholding).toBe(15_615);
  });

  it("married filing jointly, semimonthly $5,000 with $4,400 of Step 3 credits", () => {
    // 120,000 - 12,900 = 107,100; 2,480 + 12% x 63,000 = 10,040; 10,040/24 - 4,400/24 = 235.00
    const r = federalIncomeTax({
      taxableWages: dollars(5_000),
      frequency: "semimonthly",
      w4: w4({ filingStatus: "married_jointly", dependentsCredit: dollars(4_400) }),
    });
    expect(r.withholding).toBe(23_500);
  });

  it("Step 2 checkbox uses the higher schedule and skips line 1g", () => {
    // 52,000 on the single checkbox table: 2,900 + 22% x (52,000 - 33,250) = 7,025; / 26 = 270.19
    const r = federalIncomeTax({ taxableWages: dollars(2_000), frequency: "biweekly", w4: w4({ multipleJobs: true }) });
    expect(r.withholding).toBe(27_019);
  });

  it("Step 4(a), 4(b) and 4(c) adjust withholding", () => {
    // 52,000 + 5,000 - (3,000 + 8,600) = 45,400; 1,240 + 12% x 25,500 = 4,300; /26 = 165.38 + 20 extra
    const r = federalIncomeTax({
      taxableWages: dollars(2_000),
      frequency: "biweekly",
      w4: w4({ otherIncome: dollars(5_000), deductions: dollars(3_000), extraWithholding: dollars(20) }),
    });
    expect(r.withholding).toBe(16_538 + 2_000);
  });

  it("head of household, weekly $900", () => {
    // 46,800 - 8,600 = 38,200; 1,770 + 12% x 4,950 = 2,364; / 52 = 45.46
    const r = federalIncomeTax({ taxableWages: dollars(900), frequency: "weekly", w4: w4({ filingStatus: "head_of_household" }) });
    expect(r.withholding).toBe(4_546);
  });

  it("pre-2020 Form W-4 with allowances", () => {
    // weekly 1,000 x 52 = 52,000 - 2 x 4,300 = 43,400 on the single standard table = 4,060; / 52 = 78.08
    const r = federalIncomeTax({
      taxableWages: dollars(1_000),
      frequency: "weekly",
      w4: { version: "2019_or_earlier", maritalStatus: "single", allowances: 2, extraWithholding: 0 },
    });
    expect(r.withholding).toBe(7_808);
  });

  it("nonresident alien add-on raises the wage amount", () => {
    // (2,000 + 16,100/26) x 26 = 68,100 - 8,600 = 59,500; 5,800 + 22% x 1,600 = 6,152; / 26 = 236.62
    const r = federalIncomeTax({ taxableWages: dollars(2_000), frequency: "biweekly", w4: w4({ nonresidentAlien: true }) });
    expect(r.withholding).toBe(23_662);
  });

  it("exempt employees and low wages withhold nothing", () => {
    expect(federalIncomeTax({ taxableWages: dollars(5_000), frequency: "weekly", w4: w4({ exempt: true }) }).withholding).toBe(0);
    expect(federalIncomeTax({ taxableWages: dollars(250), frequency: "biweekly", w4: w4() }).withholding).toBe(0);
  });

  it("supplemental wages: 22% flat, 37% above $1 million", () => {
    expect(federalSupplementalTax(dollars(10_000), 0)).toBe(dollars(2_200));
    expect(federalSupplementalTax(dollars(100_000), dollars(950_000))).toBe(dollars(50_000 * 0.22 + 50_000 * 0.37));
  });
});

describe("FICA and FUTA", () => {
  it("stops Social Security at $184,500 and starts Additional Medicare above $200,000", () => {
    const r = fica({ ficaWages: dollars(20_000), ytdFicaWagesBefore: dollars(190_000) });
    expect(r.socialSecurityWages).toBe(0);
    expect(r.employee.additionalMedicare).toBe(dollars(10_000 * 0.009));
    expect(r.employer.medicare).toBe(dollars(290));
    const s = fica({ ficaWages: dollars(10_000), ytdFicaWagesBefore: dollars(180_000) });
    expect(s.socialSecurityWages).toBe(dollars(4_500));
  });

  it("FUTA is 0.6% of the first $7,000", () => {
    expect(futa(dollars(5_000), dollars(4_000), "CT")).toMatchObject({ taxableWages: dollars(3_000), amount: dollars(18) });
  });
});

describe("pre-tax deductions", () => {
  it("401(k) reduces income tax wages only; section 125 reduces every base", () => {
    const w = taxableWages(dollars(2_000), [
      { kind: "retirement_pretax", amount: dollars(100) },
      { kind: "section125_health", amount: dollars(50) },
      { kind: "state_auto_ira", amount: dollars(60) },
    ]);
    expect(w.federalIncome).toBe(dollars(1_850));
    expect(w.fica).toBe(dollars(1_950));
    expect(w.futa).toBe(dollars(1_950));
    expect(w.posttaxTotal).toBe(dollars(60));
  });
});

describe("federal paycheck", () => {
  it("adds up a $2,000 biweekly check with a 401(k)", () => {
    const r = federalPaycheck({
      employeeId: "e1",
      frequency: "biweekly",
      regularWages: dollars(2_000),
      deductions: [{ kind: "retirement_pretax", amount: dollars(100) }],
      federalW4: w4(),
      workState: "CT",
      ytd: { ficaWages: 0, futaWages: 0, supplementalWages: 0 },
    });
    const by = Object.fromEntries(r.lines.map((l) => [l.id, l.amount]));
    // 1,900 x 26 = 49,400 - 8,600 = 40,800; 1,240 + 12% x 20,900 = 3,748; / 26 = 144.15
    expect(by.federal_income).toBe(14_415);
    expect(by.social_security).toBe(12_400);
    expect(by.medicare).toBe(2_900);
    expect(by.futa).toBe(1_200);
    expect(r.net).toBe(dollars(2_000) - 14_415 - 12_400 - 2_900 - dollars(100));
  });

  it("taxes a bonus at the supplemental rate", () => {
    const r = federalPaycheck({
      employeeId: "e1",
      frequency: "biweekly",
      regularWages: dollars(2_000),
      supplementalWages: dollars(1_000),
      deductions: [],
      federalW4: w4(),
      workState: "CT",
      ytd: { ficaWages: 0, futaWages: 0, supplementalWages: 0 },
    });
    expect(r.lines.find((l) => l.id === "federal_income")!.amount).toBe(15_615 + 22_000);
  });
});
