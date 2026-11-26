import { describe, expect, it } from "vitest";
import { paidLeaveContribution } from "@/lib/taxes/state-paid-leave";
import { dollars } from "@/lib/money";

describe("state paid leave contributions", () => {
  it("withholds CT Paid Leave at 0.5% from the employee only", () => {
    const r = paidLeaveContribution({ state: "CT", grossWages: dollars(2_000), ytdWagesBefore: 0, employerSize: 3 });
    expect(r.employee).toBe(1_000);
    expect(r.employer).toBe(0);
  });

  it("stops CT Paid Leave at the Social Security wage base", () => {
    const r = paidLeaveContribution({ state: "CT", grossWages: dollars(10_000), ytdWagesBefore: dollars(180_000), employerSize: 3 });
    expect(r.taxableWages).toBe(dollars(4_500));
    expect(r.employee).toBe(2_250);
  });

  it("splits MA PFML for 25+ employers and charges small employers nothing", () => {
    const big = paidLeaveContribution({ state: "MA", grossWages: dollars(1_000), ytdWagesBefore: 0, employerSize: 30 });
    expect(big.employee).toBe(460);
    expect(big.employer).toBe(420);
    const small = paidLeaveContribution({ state: "MA", grossWages: dollars(1_000), ytdWagesBefore: 0, employerSize: 10 });
    expect(small.employee).toBe(460);
    expect(small.employer).toBe(0);
  });

  it("applies the Oregon employer share only at 25+ employees", () => {
    expect(paidLeaveContribution({ state: "OR", grossWages: dollars(1_000), ytdWagesBefore: 0, employerSize: 25 }).employer).toBe(400);
    expect(paidLeaveContribution({ state: "OR", grossWages: dollars(1_000), ytdWagesBefore: 0, employerSize: 24 }).employer).toBe(0);
  });

  it("caps NY PFL at the annual maximum", () => {
    const r = paidLeaveContribution({
      state: "NY",
      grossWages: dollars(5_000),
      ytdWagesBefore: dollars(90_000),
      ytdEmployeeContributionBefore: dollars(400),
      employerSize: 5,
    });
    expect(r.employee).toBe(1_191);
  });
});
