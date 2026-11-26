import { describe, expect, it } from "vitest";
import { dollars } from "@/lib/money";
import { calculatePaycheck, type FullPaycheckInput } from "@/lib/tax-engine";
import {
  addDays,
  buildEfw2,
  buildW2s,
  build1099Necs,
  check941,
  ct941,
  ctW3,
  form1096,
  mustEfileInformationReturns,
  ctDepositDue,
  federal941DepositDue,
  form940,
  form941,
  formOQ,
  holidays,
  nys45,
  sumLines,
  w3Totals,
  type Employer,
  type PaycheckRecord,
} from "@/lib/filings";
import { buildNachaFile, isValidRouting } from "@/lib/money-movement";

const fedW4 = { version: "2020_or_later" as const, filingStatus: "single" as const, multipleJobs: false, dependentsCredit: 0, otherIncome: 0, deductions: 0, extraWithholding: 0 };

/** Run 26 biweekly paychecks for one employee, carrying year-to-date amounts forward. */
function simulateYear(employeeId: string, gross: number, base: Omit<FullPaycheckInput, "employeeId" | "regularWages" | "ytd" | "stateYtd" | "frequency">): PaycheckRecord[] {
  const out: PaycheckRecord[] = [];
  const ytd = { ficaWages: 0, futaWages: 0, supplementalWages: 0 };
  const stateYtd = { suiWages: 0, paidLeaveWages: 0, paidLeaveEmployee: 0, maFicaDeductionUsed: 0 };
  let payday = "2026-01-09"; // a Friday
  for (let i = 0; i < 26; i++) {
    const result = calculatePaycheck({ ...base, employeeId, frequency: "biweekly", regularWages: dollars(gross), ytd: { ...ytd }, stateYtd: { ...stateYtd } });
    out.push({ payday, periodStart: addDays(payday, -18), periodEnd: addDays(payday, -5), employeeId, result, deductionDetail: base.deductions });
    ytd.ficaWages += result.wages.fica;
    ytd.futaWages += result.wages.futa;
    stateYtd.suiWages += result.wages.fica;
    stateYtd.paidLeaveWages += result.wages.fica;
    stateYtd.paidLeaveEmployee += result.lines.filter((l) => l.id.endsWith("_paid_leave")).reduce((s, l) => s + l.amount, 0);
    payday = addDays(payday, 14);
  }
  return out;
}

const ctBase = {
  deductions: [{ kind: "retirement_pretax" as const, amount: dollars(200) }],
  federalW4: fedW4,
  workState: "CT",
  state: { state: "CT" as const, w4: { code: "F" as const } },
  employerState: { suiRate: 0.03, employerSize: 2 },
};

const records = [...simulateYear("alice", 4_000, ctBase), ...simulateYear("bob", 9_000, ctBase)];

const employer: Employer = {
  ein: "12-3456789",
  name: "Sample Bakery LLC",
  address: { line1: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
  contact: { name: "Pat Owner", phone: "860-555-0100", email: "pat@example.com" },
  stateIds: { CT: "1234567-000" },
};

describe("Form 941", () => {
  const quarters = ([1, 2, 3, 4] as const).map((q) => form941(records, 2026, q, 0));

  it("balances each quarter (line 16 equals line 12)", () => {
    for (const f of quarters) expect(check941(f)).toEqual([]);
  });

  it("counts employees paid for the period including the 12th of the third month", () => {
    expect(quarters[0].line1_employees).toBe(2);
  });

  it("stops Social Security wages for the $234,000 earner at $184,500 across the year", () => {
    const ssWages = quarters.reduce((s, f) => s + f.line5a_ssWages, 0);
    expect(ssWages).toBe(dollars(4_000 * 26) + dollars(184_500));
  });

  it("reports Additional Medicare on wages above $200,000", () => {
    expect(quarters.reduce((s, f) => s + f.line5d_addlMedicareWages, 0)).toBe(dollars(9_000 * 26 - 200_000));
  });

  it("line 7 fractions of cents stays within a few cents", () => {
    for (const f of quarters) expect(Math.abs(f.line7_fractionsOfCents)).toBeLessThan(50);
  });
});

describe("Form 940", () => {
  it("FUTA wages are $7,000 per employee and tax is 0.6%", () => {
    const f = form940(records, 2026, 0, ["CT"]);
    expect(f.line7_futaWages).toBe(dollars(14_000));
    expect(f.line12_totalFuta).toBe(dollars(84));
    expect(f.quarterlyLiability.reduce((a, b) => a + b, 0)).toBe(dollars(84));
  });
});

describe("W-2, W-3 and EFW2", () => {
  const w2s = buildW2s(records, 2026, employer);
  const quarters = ([1, 2, 3, 4] as const).map((q) => form941(records, 2026, q, 0));

  it("W-3 totals tie to the four 941s", () => {
    const t = w3Totals(w2s);
    expect(t.box1).toBe(quarters.reduce((s, f) => s + f.line2_wages, 0));
    expect(t.box2).toBe(quarters.reduce((s, f) => s + f.line3_incomeTaxWithheld, 0));
    expect(t.box3).toBe(quarters.reduce((s, f) => s + f.line5a_ssWages, 0));
    expect(t.box12D).toBe(dollars(200 * 26 * 2));
  });

  it("puts the 401(k) in box 12 code D and CT in box 15-17", () => {
    const alice = w2s.find((w) => w.employeeId === "alice")!;
    expect(alice.box1_wages).toBe(dollars(3_800 * 26));
    expect(alice.box3_ssWages).toBe(dollars(4_000 * 26));
    expect(alice.box12.D).toBe(dollars(5_200));
    expect(alice.box13_retirementPlan).toBe(true);
    expect(alice.states[0]).toMatchObject({ state: "CT", stateId: "1234567-000", stateWages: dollars(3_800 * 26) });
    expect(alice.box14["CT PFL"]).toBe(sumLines(records.filter((r) => r.employeeId === "alice"), "ct_paid_leave"));
  });

  it("writes 512-byte EFW2 records with money in the right positions", () => {
    const people = w2s.map((w2) => ({
      w2,
      person: { ssn: w2.employeeId === "alice" ? "123-45-6789" : "987-65-4321", firstName: w2.employeeId, lastName: "Sample", address: employer.address },
    }));
    const file = buildEfw2({ year: 2026, bsoUserId: "ABCD1234", submitter: employer }, employer, people);
    const recs = file.split("\r\n").filter(Boolean);
    expect(recs.map((r) => r.slice(0, 2))).toEqual(["RA", "RE", "RW", "RW", "RT", "RF"]);
    for (const r of recs) expect(r.length).toBe(512);
    const rw = recs[2];
    expect(rw.slice(2, 11)).toBe("123456789");
    expect(rw.slice(187, 198)).toBe(String(dollars(3_800 * 26)).padStart(11, "0"));
    expect(rw.slice(286, 297)).toBe(String(dollars(5_200)).padStart(11, "0"));
    expect(recs[1].slice(2, 6)).toBe("2026");
    expect(recs[4].slice(2, 9)).toBe("0000002");
    expect(recs[5].slice(7, 16)).toBe("000000002");
  });
});

describe("CT-W3", () => {
  it("reconciles CT W-2 withholding with what was paid for the year", () => {
    const w2s = buildW2s(records, 2026, employer);
    const total = sumLines(records, "ct_income");
    const f = ctW3(w2s, [], 2026, total - dollars(10));
    expect(f.w2Count).toBe(2);
    expect(f.line2_ctTaxWithheldW2).toBe(total);
    expect(f.line6_balanceDue).toBe(dollars(10));
    // The four CT-941s add up to the CT-W3 total.
    const quarters = ([1, 2, 3, 4] as const).map((q) => ct941(records, 2026, q, 0).line3_ctTaxWithheld);
    expect(quarters.reduce((a, b) => a + b, 0)).toBe(f.line4_totalCtTaxWithheld);
  });
});

describe("state quarterly returns", () => {
  it("CT-941 matches CT withholding", () => {
    const f = ct941(records, 2026, 1, 0);
    expect(f.line3_ctTaxWithheld).toBe(sumLines(records.filter((r) => r.payday < "2026-04-01"), "ct_income"));
    expect(f.line8_balanceDue).toBe(f.line3_ctTaxWithheld);
  });

  it("Oregon OQ and NYS-45 pick up only their state's paychecks", () => {
    const orRecs = simulateYear("ore", 3_000, {
      deductions: [],
      federalW4: fedW4,
      workState: "OR",
      state: { state: "OR", w4: { filingStatus: "single", allowances: 1 } },
      employerState: { suiRate: 0.024, employerSize: 5 },
    });
    const nyRecs = simulateYear("nyc", 3_000, {
      deductions: [],
      federalW4: fedW4,
      workState: "NY",
      state: { state: "NY", w4: { status: "single", allowances: 1, nycResident: true } },
      employerState: { suiRate: 0.041, employerSize: 5 },
    });
    const all = [...records, ...orRecs, ...nyRecs];
    const oq = formOQ(all, 2026, 1);
    expect(oq.form132.map((r) => r.employeeId)).toEqual(["ore"]);
    expect(oq.statewideTransitTax).toBe(dollars(3) * 6); // six biweekly paydays in Q1 2026
    const ny = nys45(all, 2026, 4);
    expect(ny.partC).toHaveLength(1);
    expect(ny.partC[0].grossFederalWagesYtd).toBe(dollars(3_000 * 26));
    expect(ny.partA.taxableWages).toBe(0); // the $17,600 base was used up by Q2
    expect(ny.partB.nycWithheld).toBeGreaterThan(0);
  });
});

describe("1099-NEC", () => {
  it("files for contractors paid $2,000 or more (2026 threshold)", () => {
    const c = (id: string) => ({ id, tin: "12-3456789", tinType: "ein" as const, name: id, address: employer.address, state: "CT" });
    const forms = build1099Necs(
      [c("big"), c("small")],
      [
        { contractorId: "big", paidOn: "2026-03-01", amount: dollars(2_500), backupWithholding: 0 },
        { contractorId: "small", paidOn: "2026-03-01", amount: dollars(1_999), backupWithholding: 0 },
      ],
      2026,
      { CT: "1234567-000" },
    );
    expect(forms.map((f) => f.contractor.id)).toEqual(["big"]);
    expect(forms[0].box7_stateIncome).toBe(dollars(2_500));
    const t = form1096(forms, 2026, { name: employer.name, ein: employer.ein }, false);
    expect(t).toMatchObject({ box3_totalForms: 1, box5_totalAmountReported: dollars(2_500), notRequired: false });
    expect(mustEfileInformationReturns(9)).toBe(false);
    expect(mustEfileInformationReturns(10)).toBe(true);
  });
});

describe("deposit calendar", () => {
  it("knows 2026 federal holidays, including observed Independence Day", () => {
    const h = holidays(2026);
    expect(h.has("2026-07-03")).toBe(true);
    expect(h.has("2026-11-26")).toBe(true);
    expect(h.has("2026-04-16")).toBe(true);
  });

  it("monthly depositors pay by the 15th, rolled past weekends and holidays", () => {
    // Feb 15, 2026 is a Sunday and Feb 16 is Washington's Birthday.
    expect(federal941DepositDue("2026-01-09", "monthly")).toBe("2026-02-17");
  });

  it("semiweekly: Friday payday is due Wednesday; Tuesday payday Friday, with 3 business days minimum", () => {
    expect(federal941DepositDue("2026-01-09", "semiweekly")).toBe("2026-01-14");
    expect(federal941DepositDue("2026-01-13", "semiweekly")).toBe("2026-01-16");
    // Period ends Fri Dec 25 (holiday): 3 business days after is Wed Dec 30.
    expect(federal941DepositDue("2026-12-23", "semiweekly")).toBe("2026-12-30");
    // Nominal Fri Jan 1, 2027 is a holiday: Monday Jan 4.
    expect(federal941DepositDue("2026-12-29", "semiweekly")).toBe("2027-01-04");
  });

  it("CT weekly remitters: Friday payday due the next Wednesday", () => {
    expect(ctDepositDue("2026-01-09", "weekly")).toBe("2026-01-14");
    expect(ctDepositDue("2026-01-13", "weekly")).toBe("2026-01-21");
  });
});

describe("NACHA placeholder", () => {
  it("validates routing numbers and writes a blocked, balanced-count file", () => {
    expect(isValidRouting("011000015")).toBe(true);
    expect(isValidRouting("011000016")).toBe(false);
    const file = buildNachaFile({
      immediateDestination: "011000015",
      destinationName: "TD BANK",
      immediateOrigin: "1123456789",
      originName: "WHITE OAK PAYROLL",
      odfiId: "01100001",
      createdAt: new Date("2026-11-26T15:30:00Z"),
      batches: [
        {
          companyName: "SAMPLE BAKERY",
          companyId: "1123456789",
          secCode: "PPD",
          entryDescription: "PAYROLL",
          effectiveDate: "2026-11-27",
          entries: [
            { routing: "011000015", account: "12345", accountType: "checking", direction: "credit", amount: dollars(1_234.56), individualId: "alice", name: "Alice Sample" },
            { routing: "011000015", account: "67890", accountType: "savings", direction: "credit", amount: dollars(100), individualId: "bob", name: "Bob Sample" },
          ],
        },
      ],
    });
    const lines = file.trim().split("\n");
    expect(lines.length % 10).toBe(0);
    for (const l of lines) expect(l.length).toBe(94);
    expect(lines[2].slice(1, 3)).toBe("22");
    expect(lines[3].slice(1, 3)).toBe("32");
    expect(lines[2].slice(29, 39)).toBe("0000123456");
    const batchControl = lines[4];
    expect(batchControl.slice(0, 4)).toBe("8220");
    expect(batchControl.slice(10, 20)).toBe("0002200002"); // entry hash: 01100001 x 2
    expect(batchControl.slice(32, 44)).toBe("000000133456");
  });
});
