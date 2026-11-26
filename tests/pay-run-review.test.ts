import { describe, expect, it } from "vitest";
import { reviewPayRun } from "@/lib/pay-run/review";
import { sampleReview } from "@/lib/preview/sample-review";
import { dollars } from "@/lib/money";
import type { LaunchState } from "@/lib/payroll/schedules";

const STATES: LaunchState[] = ["CT", "MA", "OR", "NY"];

describe("pay run review", () => {
  it.each(STATES)("cash needed equals gross plus employer taxes and the breakdown adds up (%s)", (state) => {
    const r = reviewPayRun(sampleReview(30, state));
    expect(r.cashNeeded).toBe(r.gross + r.employerTaxes);
    expect(r.cashBreakdown.reduce((s, d) => s + d.amount, 0)).toBe(r.cashNeeded);
    expect(r.netPay).toBe(r.gross - r.employeeTaxes - r.deductions);
  });

  it("totals each line across employees", () => {
    const r = reviewPayRun(sampleReview(14, "CT"));
    for (const line of [...r.employeeLines, ...r.employerLines]) {
      const perEmployee = r.employees.flatMap((e) => e.lines).filter((l) => l.id === line.id).reduce((s, l) => s + l.amount, 0);
      expect(line.amount).toBe(perEmployee);
    }
    expect(r.employerTaxes).toBe(r.employees.reduce((s, e) => s + e.employerTaxes, 0));
  });

  it("shows every employer tax, federal before state", () => {
    const r = reviewPayRun(sampleReview(30, "MA"));
    expect(r.employerLines.map((l) => l.id)).toEqual(["social_security_er", "medicare_er", "futa", "ma_sui", "ma_paid_leave_er"]);
    expect(r.employeeLines.map((l) => l.id)).toEqual(["federal_income", "social_security", "medicare", "additional_medicare", "ma_paid_leave"]);
  });

  it("drops the MA employer paid leave share under 25 employees", () => {
    const r = reviewPayRun(sampleReview(10, "MA"));
    expect(r.employerLines.find((l) => l.id === "ma_paid_leave_er")).toBeUndefined();
  });

  it("matches a hand-worked single paycheck", () => {
    // $2,400 bi-weekly, single, no deductions, $4,800 YTD; CT; sample 3% unemployment on a $26,100 base.
    const input = sampleReview(1, "CT");
    input.employees[0].deductions = [];
    const r = reviewPayRun(input);
    const er = Object.fromEntries(r.employerLines.map((l) => [l.id, l.amount]));
    expect(er.social_security_er).toBe(dollars(148.8));
    expect(er.medicare_er).toBe(dollars(34.8));
    expect(er.futa).toBe(dollars(13.2)); // $2,200 left under the $7,000 base at 0.6%
    expect(er.ct_sui).toBe(dollars(72));
    expect(r.employeeLines.find((l) => l.id === "ct_paid_leave")?.amount).toBe(dollars(12));
    expect(r.cashNeeded).toBe(dollars(2_400) + dollars(148.8 + 34.8 + 13.2 + 72));
  });
});
