import { describe, expect, it } from "vitest";
import { computePaycheck, type EmployeeTaxProfile } from "@/lib/app/engine";
import { laborCost, parseRange, payrollRegister, reportCsv, taxLiability, toCsv, type ReportLine } from "@/lib/reports";

const ben: EmployeeTaxProfile = {
  id: "e1", workState: "OR", payBasis: "SALARIED", payRateCents: 6_800_000, w4FilingStatus: "single", w4MultipleJobs: false,
  w4DependentsCents: 0, w4OtherIncomeCents: 0, w4DeductionsCents: 0, w4ExtraCents: 0, w4Exempt: false,
  stateW4: { filingStatus: "single", allowances: 1 }, retirementPretaxRate: 0.04, healthPremiumCents: 0,
};

function line(payday: string, employeeId = "e1", name = "Lee, Ben"): ReportLine {
  const detail = computePaycheck({ ...ben, id: employeeId }, { frequency: "BIWEEKLY", hours: null, bonus: 0, company: { suiRate: 0.024 }, employerSize: 2, prior: [], advances: [] });
  const r = detail.result;
  return {
    payday: new Date(`${payday}T00:00:00Z`), periodStart: new Date(`${payday}T00:00:00Z`), periodEnd: new Date(`${payday}T00:00:00Z`),
    employeeId, employeeName: name, hours: null, overtimeHours: 0, regularCents: r.gross, bonusCents: 0, grossCents: r.gross,
    employeeTaxesCents: r.employeeTaxes, employerTaxesCents: r.employerTaxes, deductionsCents: r.deductions, netCents: r.net, detail,
  };
}

describe("report ranges", () => {
  it("parses years and quarters, falling back to this year", () => {
    const q3 = parseRange("2026-Q3");
    expect(q3.from.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(q3.to.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(parseRange("2025").label).toBe("2025");
    expect(parseRange("nonsense", new Date("2026-05-01")).label).toBe("2026");
  });
});

describe("payroll reports", () => {
  const lines = [line("2026-07-10"), line("2026-07-24"), line("2026-10-09", "e2", "Ortiz, Ana")];

  it("register has one row per paycheck and adds up", () => {
    const r = payrollRegister(lines);
    expect(r.rows).toHaveLength(3);
    expect(r.header).toContain("Federal income tax");
    expect(r.totals.grossCents).toBe(lines.reduce((s, l) => s + l.grossCents, 0));
    // gross - employee taxes - deductions = net, on every row
    for (const l of lines) expect(l.grossCents - l.employeeTaxesCents - l.deductionsCents).toBe(l.netCents);
  });

  it("tax liability groups by quarter and matches the paychecks", () => {
    const t = taxLiability(lines);
    expect(new Set(t.map((r) => r.quarter))).toEqual(new Set(["2026-Q3", "2026-Q4"]));
    const total = t.reduce((s, r) => s + r.amountCents, 0);
    expect(total).toBe(lines.reduce((s, l) => s + l.employeeTaxesCents + l.employerTaxesCents, 0));
    expect(t[0].jurisdiction).toBe("US");
  });

  it("labor cost is gross plus employer taxes, contractors included", () => {
    const c = laborCost(lines, [{ paidOn: new Date("2026-08-01"), contractorId: "c1", name: "Sparks LLC", amountCents: 50_000, memo: null }]);
    const ben = c.find((r) => r.id === "e1")!;
    expect(ben.paychecks).toBe(2);
    expect(ben.totalCostCents).toBe(lines[0].grossCents * 2 + lines[0].employerTaxesCents * 2);
    expect(c.find((r) => r.kind === "contractor")!.totalCostCents).toBe(50_000);
  });

  it("builds CSV for every report kind", () => {
    for (const k of ["register", "tax-liability", "labor-cost", "contractors"] as const) {
      const { header, rows } = reportCsv(k, lines, []);
      expect(header.length).toBeGreaterThan(2);
      if (k !== "contractors") expect(rows.length).toBeGreaterThan(0);
    }
  });
});

describe("csv", () => {
  it("quotes and neutralizes spreadsheet formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", '=HYPERLINK("evil")'], ["-12.50", 3]])).toBe('a,b\r\n"x,y","\'=HYPERLINK(""evil"")"\r\n-12.50,3\r\n');
  });
});
