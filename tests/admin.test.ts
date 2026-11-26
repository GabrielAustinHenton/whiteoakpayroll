import { describe, expect, it } from "vitest";
import { adminAllowed, adminEmails } from "../src/lib/auth/admins";
import { companyBilling, filingDeadlines, revenueTrend, type DeadlineInput } from "../src/lib/app/admin-metrics";

describe("admin allowlist", () => {
  it("is off when ADMIN_EMAILS is unset", () => {
    expect(adminEmails({})).toBeNull();
    expect(adminAllowed("anyone@example.com", {})).toBe(true);
  });
  it("matches case-insensitively and accepts commas, semicolons or spaces", () => {
    const env = { ADMIN_EMAILS: " A@Example.com, b@example.com;c@example.com " };
    expect(adminEmails(env)).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    expect(adminAllowed("a@EXAMPLE.com", env)).toBe(true);
    expect(adminAllowed("d@example.com", env)).toBe(false);
  });
});

describe("company billing", () => {
  it("bills month to date on people paid and run rate on active people", () => {
    const b = companyBilling({ paidThisMonth: 3, activePeople: 7, addOns: [] });
    expect(b.monthToDate.tier).toBe(1);
    expect(b.monthToDate.total).toBe(2500);
    expect(b.projected.tier).toBe(2);
    expect(b.projected.total).toBe(5000);
  });
  it("never projects below what was already paid", () => {
    expect(companyBilling({ paidThisMonth: 6, activePeople: 2, addOns: [] }).projected.tier).toBe(2);
  });
  it("is zero with nobody active", () => {
    expect(companyBilling({ paidThisMonth: 0, activePeople: 0, addOns: [] }).projected.total).toBe(0);
  });
});

describe("revenue trend", () => {
  it("fills six months ending this month, across a year boundary", () => {
    const t = revenueTrend([{ month: "2026-01", totalCents: 2500 }, { month: "2026-01", totalCents: 5000 }, { month: "2025-11", totalCents: 0 }], "2026-02");
    expect(t.map((x) => x.month)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(t[4]).toEqual({ month: "2026-01", totalCents: 7500, companies: 2 });
    expect(t[2].companies).toBe(0);
  });
});

describe("filing deadlines", () => {
  const base = (over: Partial<DeadlineInput> = {}): DeadlineInput => ({
    companyId: "c1",
    companyName: "Good PDX",
    paidQuarters: [{ period: "2026-Q3", states: ["OR"] }, { period: "2026-Q4", states: ["OR"] }],
    wageYears: [2026],
    contractorYears: [],
    filed: new Set(),
    generated: new Set(),
    ...over,
  });

  it("flags last quarter's returns as overdue and year-end returns as upcoming", () => {
    const d = filingDeadlines([base()], "2026-11-26");
    const q3 = d.filter((x) => x.period === "2026-Q3");
    // Oct 31 2026 is a Saturday: due Monday Nov 2.
    expect(q3.map((x) => [x.form, x.due, x.status])).toEqual([["941", "2026-11-02", "overdue"], ["OQ", "2026-11-02", "overdue"]]);
    // Jan 31 2027 is a Sunday: due Monday Feb 1 (inside the 75-day horizon).
    const q4 = d.filter((x) => x.period === "2026-Q4");
    expect(q4.every((x) => x.due === "2027-02-01" && x.status === "upcoming")).toBe(true);
    expect(d.some((x) => x.form === "940" && x.period === "2026")).toBe(true);
  });

  it("skips returns marked filed and notes ones generated but not filed", () => {
    const d = filingDeadlines([base({ filed: new Set(["941|2026-Q3"]), generated: new Set(["941|2026-Q3", "OQ|2026-Q3"]) })], "2026-11-26");
    const q3 = d.filter((x) => x.period === "2026-Q3");
    expect(q3).toHaveLength(1);
    expect(q3[0]).toMatchObject({ form: "OQ", generated: true });
  });

  it("adds the 1096 for contractor years and leaves out far-off deadlines", () => {
    const d = filingDeadlines([base({ contractorYears: [2026] })], "2026-08-01");
    expect(d.some((x) => x.form === "1096")).toBe(false);
    expect(filingDeadlines([base({ contractorYears: [2026] })], "2026-12-15").some((x) => x.form === "1096")).toBe(true);
  });
});
