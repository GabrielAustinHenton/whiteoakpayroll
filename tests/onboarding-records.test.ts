import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptField, encryptField, encryptedKeyId, keyring, protectSsn, revealSsn, ssnLast4 } from "@/lib/security/field-crypto";
import { i9Dates, sameForm, stateRecord, w4DependentsCents, w4Prefill, w4Record, type W4Entry } from "@/lib/app/onboarding-records";
import { employeeStateCertificate, type EmployeeTaxProfile } from "@/lib/app/engine";

describe("field encryption", () => {
  const key = randomBytes(32).toString("base64");
  const ring = keyring({ FIELD_ENCRYPTION_KEY: key, FIELD_ENCRYPTION_KEY_ID: "k7" });

  it("round-trips, uses a fresh IV each time, and never contains the plaintext", () => {
    const a = encryptField("000-12-3456", ring);
    const b = encryptField("000-12-3456", ring);
    expect(a).not.toBe(b);
    expect(a).not.toContain("3456");
    expect(encryptedKeyId(a)).toBe("k7");
    expect(decryptField(a, ring)).toBe("000-12-3456");
  });

  it("detects tampering", () => {
    const parts = encryptField("000-12-3456", ring).split(":");
    parts[3] = Buffer.from("tampered!!!").toString("base64");
    expect(() => decryptField(parts.join(":"), ring)).toThrow();
  });

  it("reads values written with an old key after rotation", () => {
    const old = encryptField("000-99-0001", ring);
    const rotated = keyring({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"), FIELD_ENCRYPTION_KEY_ID: "k8", FIELD_ENCRYPTION_OLD_KEYS: `k7:${key}` });
    expect(decryptField(old, rotated)).toBe("000-99-0001");
  });

  it("refuses to run without a key once real SSNs are allowed", () => {
    expect(() => keyring({ TEST_IDS_ONLY: "false" })).toThrow(/FIELD_ENCRYPTION_KEY/);
    expect(keyring({}).currentId).toBe("dev");
  });

  it("stores ciphertext plus last 4 and clears the plaintext column", () => {
    const p = protectSsn("000-12-3456", ring);
    expect(p).toMatchObject({ ssnLast4: "3456", ssn: null });
    expect(revealSsn(p, ring)).toBe("000-12-3456");
    expect(revealSsn({ ssn: "000-11-2222" }, ring)).toBe("000-11-2222");
    expect(ssnLast4({ ssn: "000-11-2222" })).toBe("2222");
  });
});

const entry = (over: Partial<W4Entry> = {}): W4Entry => ({
  filingStatus: "married_jointly",
  multipleJobs: false,
  children: 2,
  otherDependents: 1,
  otherCreditsCents: 0,
  otherIncomeCents: 0,
  deductionsCents: 0,
  extraCents: 0,
  exempt: false,
  ...over,
});

describe("onboarding records", () => {
  it("stores the 2026 W-4 as entered and the Step 3 total for the engine", () => {
    expect(w4DependentsCents(entry())).toBe(4_900_00);
    const r = w4Record(entry({ exempt: true }));
    expect(r.data.filingStatus).toBe("mfj_or_qss");
    expect(r.exemptExpiresOn?.toISOString().slice(0, 10)).toBe("2027-02-16");
  });

  it("prefills Step 3 from the saved W-4, or from the old dollar total", () => {
    expect(w4Prefill(w4Record(entry()).data, 4_900_00)).toEqual({ children: 2, otherDependents: 1, otherCreditsCents: 0 });
    expect(w4Prefill(null, 2_000_00)).toEqual({ children: 0, otherDependents: 0, otherCreditsCents: 2_000_00 });
  });

  it("only versions a form when something changed", () => {
    expect(sameForm({ a: 1, b: false, c: { d: 2 } }, { c: { d: 2 }, a: 1 })).toBe(true);
    expect(sameForm({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("names the state form and revision", () => {
    expect(stateRecord("OR", {})).toMatchObject({ formName: "OR-W-4", formRevision: expect.stringContaining("2026") });
  });

  it("I-9 dates: Section 2 due the 3rd business day; retention after termination", () => {
    const d = i9Dates(new Date("2026-11-30T00:00:00Z"));
    expect(d.section2DueOn.toISOString().slice(0, 10)).toBe("2026-12-03");
    expect(d.retainUntil).toBeNull();
    expect(i9Dates(new Date("2026-11-30T00:00:00Z"), new Date("2027-03-01T00:00:00Z")).retainUntil?.toISOString().slice(0, 10)).toBe("2029-11-30");
  });
});

describe("engine mapping of the new state fields", () => {
  const emp = (workState: string, stateW4: unknown): EmployeeTaxProfile => ({
    id: "e1", workState, payBasis: "SALARIED", payRateCents: 60_000_00, w4FilingStatus: "single", w4MultipleJobs: false, w4DependentsCents: 0,
    w4OtherIncomeCents: 0, w4DeductionsCents: 0, w4ExtraCents: 0, w4Exempt: false, stateW4, retirementPretaxRate: 0, healthPremiumCents: 0,
  });

  it("passes CT line 3, MA boxes B-D, and NY lines 2, 4 and 5", () => {
    expect(employeeStateCertificate(emp("CT", { code: "F", reduction: 500 })).w4).toMatchObject({ reduction: 500 });
    expect(employeeStateCertificate(emp("MA", { exemptions: 1, blind: 1, fullTimeStudentUnder8k: true })).w4).toMatchObject({ blind: 1, fullTimeStudentUnder8k: true });
    const ny = employeeStateCertificate(emp("NY", { allowances: 1, nycAllowances: 3, nycResident: true, additionalNyc: 700, additionalYonkers: 900 })).w4;
    expect(ny).toMatchObject({ allowances: 1, nycAllowances: 3, additionalNyc: 700, additionalYonkers: 0 });
    expect(employeeStateCertificate(emp("NY", { allowances: 2 })).w4).toMatchObject({ nycAllowances: undefined });
  });
});
