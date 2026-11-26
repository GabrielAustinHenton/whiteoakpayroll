import { describe, expect, it } from "vitest";
import { dollars } from "@/lib/money";
import { federalIncomeTax, stateLines } from "@/lib/tax-engine";
import {
  exemptExpires,
  i9Deadlines,
  i9RetainUntil,
  NO_W4_ON_FILE,
  onboardingTasks,
  rehireNeedsNewI9,
  reverificationDue,
  stateCertificateDuties,
  suggestCtCode,
  toFederalW4,
  toMaW4,
  toNyIt2104,
  toOrW4,
  toStateCertificate,
  validateDocumentCombo,
  validateSection1,
  validateSection2,
  validateStateForm,
  validateW4,
  w4Step3Total,
  type FormW4_2026,
  type I9Section1,
  type I9Section2,
} from "@/lib/onboarding";

const sig = { name: "Jamie Rivera", signedAt: "2026-12-01T15:00:00Z" };

const w4 = (over: Partial<FormW4_2026> = {}): FormW4_2026 => ({
  filingStatus: "single_or_mfs",
  multipleJobsCheckbox: false,
  qualifyingChildren: 0,
  otherDependents: 0,
  otherCredits: 0,
  otherIncome: 0,
  deductions: 0,
  extraWithholding: 0,
  exempt: false,
  signature: sig,
  ...over,
});

describe("Form W-4 (2026)", () => {
  it("Step 3 uses $2,200 per child and $500 per other dependent", () => {
    expect(w4Step3Total({ qualifyingChildren: 2, otherDependents: 1, otherCredits: dollars(100) })).toBe(dollars(5_000));
  });

  it("maps every step onto the engine's 2020-or-later W-4", () => {
    const f = toFederalW4(
      w4({ filingStatus: "mfj_or_qss", multipleJobsCheckbox: true, qualifyingChildren: 1, otherIncome: dollars(5_000), deductions: dollars(2_000), extraWithholding: dollars(25) }),
    );
    expect(f).toEqual({
      version: "2020_or_later",
      filingStatus: "married_jointly",
      multipleJobs: true,
      dependentsCredit: dollars(2_200),
      otherIncome: dollars(5_000),
      deductions: dollars(2_000),
      extraWithholding: dollars(25),
      exempt: false,
      nonresidentAlien: undefined,
    });
  });

  it("feeds the federal engine: two kids lowers withholding by $4,400 a year", () => {
    const base = federalIncomeTax({ taxableWages: dollars(5_000), frequency: "biweekly", w4: toFederalW4(w4({ filingStatus: "mfj_or_qss" })) }).withholding;
    const kids = federalIncomeTax({ taxableWages: dollars(5_000), frequency: "biweekly", w4: toFederalW4(w4({ filingStatus: "mfj_or_qss", qualifyingChildren: 2 })) }).withholding;
    expect(base - kids).toBe(Math.round(dollars(4_400) / 26));
  });

  it("an exempt W-4 withholds nothing, and the default for no W-4 is single with no adjustments", () => {
    expect(federalIncomeTax({ taxableWages: dollars(1_000), frequency: "weekly", w4: toFederalW4(w4({ exempt: true })) }).withholding).toBe(0);
    expect(NO_W4_ON_FILE).toMatchObject({ filingStatus: "single", multipleJobs: false, dependentsCredit: 0 });
  });

  it("rejects unsigned forms and NRA exempt claims", () => {
    expect(validateW4(w4({ signature: { name: " ", signedAt: sig.signedAt } })).map((i) => i.field)).toContain("signature");
    expect(validateW4(w4({ exempt: true }), { nonresidentAlien: true }).map((i) => i.field)).toContain("exempt");
    expect(validateW4(w4())).toEqual([]);
  });

  it("2026 exempt status ends February 16, 2027 (Feb 15 is Presidents' Day), matching the form", () => {
    expect(exemptExpires(2026)).toBe("2027-02-16");
    expect(exemptExpires(2027)).toBe("2028-02-15");
  });
});

describe("state certificates", () => {
  it("CT-W4 chart", () => {
    expect(suggestCtCode("single", dollars(14_000))).toBe("E");
    expect(suggestCtCode("single", dollars(50_000))).toBe("F");
    expect(suggestCtCode("mfj_spouse_employed", dollars(80_000))).toBe("A");
    expect(suggestCtCode("mfj_spouse_employed", dollars(150_000))).toBe("D");
    expect(suggestCtCode("head_of_household", dollars(40_000))).toBe("B");
  });

  it("M-4 line 4 total, blind count and student box", () => {
    expect(toMaW4({ line1: 2, line2: 4, line3: 1, additional: 0, headOfHousehold: false, blind: true, spouseBlind: true, fullTimeStudentUnder8k: false, signature: sig })).toEqual({
      exemptions: 7,
      headOfHousehold: false,
      blind: 2,
      fullTimeStudentUnder8k: false,
      additional: 0,
    });
    expect(toMaW4(null)).toEqual({ exemptions: 0 });
  });

  it("OR-W-4 exemption lapses after February 15 of the next year; no form means 8%", () => {
    const f = { filingStatus: "single" as const, allowances: 0, additional: 0, exemptionCode: "L" as const, year: 2026, signature: sig };
    expect(toOrW4(f, new Date("2027-02-15T12:00:00Z")).exempt).toBe(true);
    expect(toOrW4(f, new Date("2027-02-16T12:00:00Z")).noForm).toBe(true);
    expect(toOrW4(null).noForm).toBe(true);
  });

  it("IT-2104 passes line 2 as NYC allowances and needs IT-2104-E to be exempt", () => {
    const f = { status: "married_higher_single" as const, nycResident: true, yonkersResident: false, line1: 2, line2: 3, additionalState: 0, additionalNyc: dollars(5), additionalYonkers: dollars(9), signature: sig };
    expect(toNyIt2104(f)).toMatchObject({ status: "single", allowances: 2, nycAllowances: 3, additionalNyc: dollars(5), additionalYonkers: 0 });
    expect(toNyIt2104(f, { form: "IT-2104-E", year: 2026, signature: sig }).exempt).toBe(true);
  });

  it("produces certificates the state engine accepts", () => {
    const cert = toStateCertificate({ state: "MA", form: null });
    const lines = stateLines({
      certificate: cert,
      frequency: "biweekly",
      gross: dollars(2_000),
      stateIncomeWages: dollars(2_000),
      suiWages: dollars(2_000),
      federalWithholding: dollars(150),
      ficaWithheld: dollars(153),
      employer: { suiRate: 0.02, employerSize: 5 },
      ytd: { suiWages: 0, paidLeaveWages: 0, paidLeaveEmployee: 0 },
    });
    expect(lines.length).toBeGreaterThan(0);
  });

  it("flags copies the employer must send to the state", () => {
    const ny = { state: "NY" as const, form: { status: "single_or_hoh" as const, nycResident: false, yonkersResident: false, line1: 15, line2: 0, additionalState: 0, additionalNyc: 0, additionalYonkers: 0, signature: sig } };
    expect(stateCertificateDuties(ny, { receivedOn: "2026-11-02" })[0].due).toBe("2027-01-31");
    const ct = { state: "CT" as const, form: { code: "E" as const, additional: 0, reduction: 0, signature: sig } };
    expect(stateCertificateDuties(ct, { receivedOn: "2026-11-02", expectedWeeklyWages: dollars(1_200) })).toHaveLength(1);
    expect(stateCertificateDuties(ct, { receivedOn: "2026-11-02", expectedWeeklyWages: dollars(500) })).toHaveLength(0);
    expect(validateStateForm({ state: "NY", form: { ...ny.form, line2: 2 } }).map((i) => i.field)).toContain("line2");
  });
});

const section1 = (over: Partial<I9Section1> = {}): I9Section1 => ({
  lastName: "Rivera",
  firstName: "Jamie",
  address: { street: "1 Elm St", city: "Hartford", state: "CT", zip: "06103" },
  dateOfBirth: "1990-04-02",
  ssnProvided: false,
  attestation: { status: "us_citizen" },
  signature: sig,
  ...over,
});

const doc = (typeId: string, expires?: string) => ({ typeId, issuingAuthority: "CT DMV", number: "123456789", expires });

const section2 = (docs = [doc("drivers_license", "2030-01-01"), doc("ssn_card")]): I9Section2 => ({
  documents: docs,
  alternativeProcedure: false,
  firstDayOfEmployment: "2026-11-30",
  examiner: { lastName: "Lee", firstName: "Sam", title: "Office Manager", signedAt: "2026-12-01T15:00:00Z" },
  business: { name: "Acme Bakery", street: "10 Main St", city: "Hartford", state: "CT", zip: "06103" },
});

describe("Form I-9 (01/20/25)", () => {
  it("Section 2 is due 3 business days after the first day: Monday start, Thursday due", () => {
    expect(i9Deadlines("2026-11-30")).toEqual({ section1: "2026-11-30", section2: "2026-12-03" });
    expect(i9Deadlines("2026-12-03").section2).toBe("2026-12-08");
    expect(i9Deadlines("2026-11-30", { jobUnder3BusinessDays: true }).section2).toBe("2026-11-30");
    expect(i9Deadlines("2026-12-23", { closed: ["2026-12-25"] }).section2).toBe("2026-12-29");
  });

  it("retention is the later of 3 years after hire or 1 year after termination", () => {
    expect(i9RetainUntil("2026-01-05", null)).toBeNull();
    expect(i9RetainUntil("2026-01-05", "2026-06-01")).toBe("2029-01-05");
    expect(i9RetainUntil("2020-01-05", "2026-06-01")).toBe("2027-06-01");
  });

  it("SSN is required only for E-Verify employers; attestation details are checked", () => {
    expect(validateSection1(section1(), { eVerify: false })).toEqual([]);
    expect(validateSection1(section1(), { eVerify: true }).map((i) => i.field)).toContain("ssn");
    const alien = section1({ attestation: { status: "alien_authorized", expires: "2027-06-30", id: { kind: "foreign_passport", value: "X123", country: "" } } });
    expect(validateSection1(alien, { eVerify: false }).map((i) => i.field)).toContain("country");
  });

  it("accepts one List A, or List B plus List C, and nothing else", () => {
    expect(validateDocumentCombo([doc("us_passport", "2030-01-01")], { under18: false })).toEqual([]);
    expect(validateDocumentCombo([doc("drivers_license", "2030-01-01"), doc("ssn_card")], { under18: false })).toEqual([]);
    expect(validateDocumentCombo([doc("drivers_license", "2030-01-01")], { under18: false })).not.toEqual([]);
    expect(validateDocumentCombo([doc("us_passport", "2030-01-01"), doc("ssn_card")], { under18: false })).not.toEqual([]);
    expect(validateDocumentCombo([doc("school_record"), doc("ssn_card")], { under18: false })).not.toEqual([]);
    expect(validateDocumentCombo([doc("school_record"), doc("ssn_card")], { under18: true })).toEqual([]);
  });

  it("remote examination needs E-Verify good standing and kept copies", () => {
    const s2 = { ...section2(), alternativeProcedure: true };
    expect(validateSection2(s2, { under18: false, eVerifyGoodStanding: false }).map((i) => i.field)).toEqual(expect.arrayContaining(["alternativeProcedure", "documents"]));
  });

  it("reverification is due when work authorization expires, never for citizens", () => {
    expect(reverificationDue(section1(), section2())).toBeNull();
    const alien = section1({ attestation: { status: "alien_authorized", expires: "2027-06-30", id: { kind: "a_number", value: "123456789" } } });
    expect(reverificationDue(alien, section2([doc("i766", "2027-06-30")]))).toBe("2027-06-30");
    expect(rehireNeedsNewI9("2023-01-01", "2025-12-01")).toBe(false);
    expect(rehireNeedsNewI9("2023-01-01", "2026-01-02")).toBe(true);
  });
});

describe("onboarding checklist", () => {
  it("lists every form with owner and deadline", () => {
    const tasks = onboardingTasks({ firstDay: "2026-11-30", workState: "OR" });
    expect(tasks.map((t) => [t.id, t.owner, t.due])).toEqual([
      ["w4", "employee", "2026-11-30"],
      ["state_w4", "employee", "2026-11-30"],
      ["i9_section1", "employee", "2026-11-30"],
      ["i9_section2", "client_hr", "2026-12-03"],
      ["new_hire_report", "white_oak", "2026-12-20"],
    ]);
    expect(tasks[1].title).toBe("Form OR-W-4");
  });
});
