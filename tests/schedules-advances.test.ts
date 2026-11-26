import { describe, expect, it } from "vitest";
import { checkPayFrequency } from "@/lib/payroll/schedules";
import { advanceDeduction, canOfferAdvance, installmentCount } from "@/lib/payroll/advances";
import { dollars } from "@/lib/money";

describe("pay frequency rules", () => {
  it("blocks monthly pay in NY and weekly-only for manual workers", () => {
    expect(checkPayFrequency("monthly", { state: "NY", payBasis: "salaried" }).allowed).toBe(false);
    expect(checkPayFrequency("semimonthly", { state: "NY", payBasis: "salaried" }).allowed).toBe(true);
    expect(checkPayFrequency("biweekly", { state: "NY", payBasis: "hourly", nyManualWorker: true }).allowed).toBe(false);
  });

  it("requires approval in CT for less than bi-weekly", () => {
    expect(checkPayFrequency("monthly", { state: "CT", payBasis: "salaried" }).allowed).toBe(false);
    expect(checkPayFrequency("monthly", { state: "CT", payBasis: "salaried", ctLessFrequentApproval: true }).allowed).toBe(true);
  });

  it("allows MA monthly only for salaried employees who elect it", () => {
    expect(checkPayFrequency("semimonthly", { state: "MA", payBasis: "hourly" }).allowed).toBe(false);
    expect(checkPayFrequency("monthly", { state: "MA", payBasis: "salaried" }).allowed).toBe(false);
    expect(checkPayFrequency("monthly", { state: "MA", payBasis: "salaried", maElectedMonthly: true }).allowed).toBe(true);
  });

  it("allows all frequencies in OR", () => {
    expect(checkPayFrequency("monthly", { state: "OR", payBasis: "hourly" }).allowed).toBe(true);
  });
});

describe("payday advances", () => {
  const advance = { principal: dollars(500), installment: dollars(100), repaid: 0, authorizationOnFile: true };

  it("launches in CT only", () => {
    expect(canOfferAdvance("CT")).toBe(true);
    expect(canOfferAdvance("OR")).toBe(false);
  });

  it("splits into equal installments", () => {
    expect(installmentCount(dollars(500), dollars(150))).toBe(4);
  });

  it("takes the installment, capped by balance and the minimum wage floor", () => {
    expect(advanceDeduction({ advance, netPayBefore: dollars(1_000), minimumWageFloor: dollars(600) })).toBe(dollars(100));
    expect(advanceDeduction({ advance: { ...advance, repaid: dollars(450) }, netPayBefore: dollars(1_000), minimumWageFloor: 0 })).toBe(dollars(50));
    expect(advanceDeduction({ advance, netPayBefore: dollars(640), minimumWageFloor: dollars(600) })).toBe(dollars(40));
  });

  it("deducts nothing without a signed authorization", () => {
    expect(advanceDeduction({ advance: { ...advance, authorizationOnFile: false }, netPayBefore: dollars(1_000), minimumWageFloor: 0 })).toBe(0);
  });
});
