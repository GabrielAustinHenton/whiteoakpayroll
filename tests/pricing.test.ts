import { describe, expect, it } from "vitest";
import { monthlyBill, tierFor } from "@/lib/pricing";

describe("tier pricing", () => {
  it("steps up every 5 people", () => {
    expect(tierFor(0)).toBe(0);
    expect(tierFor(1)).toBe(1);
    expect(tierFor(5)).toBe(1);
    expect(tierFor(6)).toBe(2);
    expect(tierFor(100)).toBe(20);
  });

  it("bills a 72-employee company at tier 15 with no per-employee fee", () => {
    const bill = monthlyBill(72);
    expect(bill.tier).toBe(15);
    expect(bill.tierRange).toEqual({ from: 71, to: 75 });
    expect(bill.basePrice).toBe(37_500);
    expect(bill.total).toBe(37_500);
  });

  it("adds each add-on once as a flat line", () => {
    const bill = monthlyBill(10, ["pto", "pto", "time_tracking"]);
    expect(bill.addOns.map((a) => a.key)).toEqual(["pto", "time_tracking"]);
  });

  it("rejects bad counts", () => {
    expect(() => tierFor(-1)).toThrow();
    expect(() => tierFor(2.5)).toThrow();
  });
});
