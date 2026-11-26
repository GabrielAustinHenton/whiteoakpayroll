import { describe, expect, it } from "vitest";
import { nextPeriod, periodFor } from "@/lib/app/periods";
import { amountInWords } from "@/lib/pdf/check-pdf";
import { computePaycheck, employeeStateCertificate, toPaycheckRecord, type EmployeeTaxProfile } from "@/lib/app/engine";
import { quarterForms, yearForms, type FilingInput } from "@/lib/app/filing-docs";
import { renderFormPdf } from "@/lib/pdf/form-pdf";
import { normalizeEin, normalizeSsn } from "@/lib/app/ids";

const ben: EmployeeTaxProfile = {
  id: "e1",
  workState: "OR",
  payBasis: "SALARIED",
  payRateCents: 6_800_000,
  w4FilingStatus: "single",
  w4MultipleJobs: false,
  w4DependentsCents: 0,
  w4OtherIncomeCents: 0,
  w4DeductionsCents: 0,
  w4ExtraCents: 0,
  w4Exempt: false,
  stateW4: { filingStatus: "single", allowances: 1 },
  retirementPretaxRate: 0.04,
  healthPremiumCents: 0,
};

describe("pay periods", () => {
  it("steps bi-weekly paydays from the anchor and lags the period end", () => {
    expect(periodFor("BIWEEKLY", "2026-10-09", 5)).toEqual({ periodStart: "2026-09-21", periodEnd: "2026-10-04", payday: "2026-10-09" });
    expect(nextPeriod("BIWEEKLY", "2026-10-09", 5, "2026-10-09").payday).toBe("2026-10-23");
  });
  it("pays semi-monthly on the 15th and the last day", () => {
    expect(nextPeriod("SEMIMONTHLY", "2026-01-15", 0, "2026-01-15")).toEqual({ periodStart: "2026-01-16", periodEnd: "2026-01-31", payday: "2026-01-31" });
    expect(nextPeriod("SEMIMONTHLY", "2026-01-15", 0, "2026-02-28").payday).toBe("2026-03-15");
  });
  it("pays monthly on the last day", () => {
    expect(nextPeriod("MONTHLY", "2026-01-31", 0, "2026-01-31").payday).toBe("2026-02-28");
  });
});

describe("checks", () => {
  it("writes the amount in words", () => {
    expect(amountInWords(208530)).toBe("Two Thousand Eighty-Five and 30/100");
    expect(amountInWords(100000000)).toBe("One Million and 00/100");
    expect(amountInWords(1)).toBe("Zero and 01/100");
  });
});

describe("test IDs only (preview)", () => {
  it("rejects real-looking SSNs and EINs", () => {
    expect(normalizeSsn("123-45-6789").error).toBeTruthy();
    expect(normalizeSsn("000123456").value).toBe("000-12-3456");
    expect(normalizeEin("12-3456789").error).toBeTruthy();
    expect(normalizeEin("001234567").value).toBe("00-1234567");
  });
});

describe("engine adapter", () => {
  it("uses Oregon's flat 8% when no OR-W-4 is on file", () => {
    expect(employeeStateCertificate({ ...ben, stateW4: null })).toEqual({ state: "OR", w4: { filingStatus: "single", allowances: 0, noForm: true } });
  });

  it("computes a full Oregon paycheck with TriMet and the 401(k)", () => {
    const d = computePaycheck(ben, { frequency: "BIWEEKLY", hours: null, bonus: 0, company: { suiRate: 0.024, orTransitDistrict: "trimet" }, employerSize: 2, prior: [], advances: [] });
    const ids = d.result.lines.map((l) => l.id);
    expect(d.result.gross).toBe(261_538);
    expect(ids).toEqual(expect.arrayContaining(["federal_income", "or_income", "or_transit", "or_trimet", "or_sui", "or_paid_leave"]));
    expect(d.deductionDetail).toEqual([{ kind: "retirement_pretax", amount: 10_462 }]);
    expect(d.result.net).toBe(d.result.gross - d.result.employeeTaxes - d.result.deductions);
  });

  it("caps FUTA using earlier checks this year", () => {
    const ctx = { frequency: "BIWEEKLY" as const, hours: null, bonus: 0, company: { suiRate: 0.024 }, employerSize: 2, advances: [] };
    const first = computePaycheck(ben, { ...ctx, prior: [] });
    const second = computePaycheck(ben, { ...ctx, prior: [first] });
    const third = computePaycheck(ben, { ...ctx, prior: [first, second] });
    const futa = (x: typeof first) => x.result.lines.find((l) => l.id === "futa")!.taxableWages;
    expect(futa(first) + futa(second) + futa(third)).toBe(700_000);
  });

  it("takes an advance repayment after taxes and keeps taxes unchanged", () => {
    const ctx = { frequency: "BIWEEKLY" as const, hours: 80, bonus: 0, company: { suiRate: 0.03 }, employerSize: 2, prior: [] };
    const ct = { ...ben, workState: "CT", stateW4: { code: "F" } };
    const without = computePaycheck(ct, { ...ctx, advances: [] });
    const withAdv = computePaycheck(ct, { ...ctx, advances: [{ id: "a1", principalCents: 50_000, installmentCents: 10_000, repaidCents: 0, authorizationSigned: true }] });
    expect(withAdv.advanceRepayments).toEqual([{ advanceId: "a1", amount: 10_000 }]);
    expect(withAdv.result.employeeTaxes).toBe(without.result.employeeTaxes);
    expect(withAdv.result.net).toBe(without.result.net - 10_000);
  });
});

describe("filings archive", () => {
  const d = computePaycheck(ben, { frequency: "BIWEEKLY", hours: null, bonus: 0, company: { suiRate: 0.024 }, employerSize: 1, prior: [], advances: [] });
  const input: FilingInput = {
    company: { legalName: "Test Co", ein: "00-1234567", address: { line1: "1 St", city: "Portland", state: "OR", zip: "97201" }, stateIds: { OR: "123" }, uiIds: {} },
    records: [toPaycheckRecord({ employeeId: "e1", detail: d }, { payday: new Date("2026-10-09"), periodStart: new Date("2026-09-21"), periodEnd: new Date("2026-10-04") })],
    employees: [{ id: "e1", name: "Ben Cho", ssn: "000-22-2222", address: { line1: "2 Elm", city: "Portland", state: "OR", zip: "97202" } }],
    contractors: [],
    contractorPayments: [],
  };

  it("builds the 941 and Oregon OQ for the quarter", () => {
    expect(quarterForms(input, 2026, 4).map((f) => f.form)).toEqual(["941", "OQ"]);
    expect(quarterForms(input, 2026, 3)).toEqual([]);
  });

  it("always keeps a 1096 when contractors were paid, even below the 1099 threshold", async () => {
    const withK: FilingInput = {
      ...input,
      contractors: [{ id: "k1", name: "Cam", ssn: "000-33-3333", tinType: "ssn", workState: "CT", address: input.employees[0].address }],
      contractorPayments: [{ contractorId: "k1", paidOn: "2026-10-09", amount: 50_000, backupWithholding: 0 }],
    };
    const forms = yearForms(withK, 2026).map((f) => f.form);
    expect(forms).toContain("1096");
    expect(forms).not.toContain("1099-NEC");
    const pdf = await renderFormPdf(yearForms(withK, 2026).find((f) => f.form === "1096")!.doc);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("issues W-2s, W-3 and 940 at year end", () => {
    expect(yearForms(input, 2026).map((f) => f.form)).toEqual(["940", "W-2", "W-3"]);
  });
});
