import { describe, expect, it } from "vitest";
import { employeeFica, employerTaxesForEmployee, summarizePayRunCost, taxableUnderBase } from "@/lib/taxes/employer-taxes";
import { dollars } from "@/lib/money";

const ctSuta = { rate: 0.03, wageBase: dollars(26_100) };

describe("employer taxes", () => {
  it("caps taxable wages at the remaining wage base", () => {
    expect(taxableUnderBase(dollars(2_000), dollars(6_000), dollars(7_000))).toBe(dollars(1_000));
    expect(taxableUnderBase(dollars(2_000), dollars(8_000), dollars(7_000))).toBe(0);
  });

  it("computes FICA, FUTA and SUTA for a $2,000 check early in the year", () => {
    const r = employerTaxesForEmployee({ employeeId: "e1", grossWages: dollars(2_000), ytdWagesBefore: 0 }, ctSuta);
    const by = Object.fromEntries(r.lines.map((l) => [l.tax, l.amount]));
    expect(by.social_security).toBe(12_400); // 6.2%
    expect(by.medicare).toBe(2_900); // 1.45%
    expect(by.futa).toBe(1_200); // 0.6%
    expect(by.suta).toBe(6_000); // 3%
    expect(r.total).toBe(22_500);
  });

  it("stops Social Security at the wage base and flags the cap", () => {
    const r = employerTaxesForEmployee(
      { employeeId: "e1", grossWages: dollars(10_000), ytdWagesBefore: dollars(180_000) },
      ctSuta,
    );
    const ss = r.lines.find((l) => l.tax === "social_security")!;
    expect(ss.taxableWages).toBe(dollars(4_500));
    expect(r.socialSecurityCapReached).toBe(true);
  });

  it("applies a FUTA credit reduction when the state has one", () => {
    const r = employerTaxesForEmployee(
      { employeeId: "e1", grossWages: dollars(1_000), ytdWagesBefore: 0 },
      { ...ctSuta, futaCreditReduction: 0.003 },
    );
    expect(r.lines.find((l) => l.tax === "futa")!.amount).toBe(900); // 0.9%
  });

  it("withholds Additional Medicare only above $200,000", () => {
    const f = employeeFica({ employeeId: "e1", grossWages: dollars(10_000), ytdWagesBefore: dollars(195_000) });
    expect(f.additionalMedicare).toBe(4_500); // 0.9% of $5,000
  });

  it("rolls up a pay run's total employer cost", () => {
    const s = summarizePayRunCost(
      [
        { employeeId: "a", grossWages: dollars(2_000), ytdWagesBefore: 0 },
        { employeeId: "b", grossWages: dollars(1_000), ytdWagesBefore: 0 },
      ],
      ctSuta,
    );
    expect(s.grossWages).toBe(dollars(3_000));
    expect(s.employerTaxes).toBe(22_500 + 11_250);
    expect(s.totalEmployerCost).toBe(dollars(3_000) + 33_750);
  });
});
