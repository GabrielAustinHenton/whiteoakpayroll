import type { Cents } from "../money";
import type { FederalW4 } from "../tax-engine/federal/income-tax";
import type { FederalFilingStatus } from "../tax-engine/tables/2026/federal";

/**
 * Form W-4 (2026) exactly as the employee fills it in. Personal details (name, SSN, address) live
 * on the employee record; the SSN is never stored on the certificate itself. See
 * docs/onboarding-forms.md for how SSNs are encrypted.
 */
export interface FormW4_2026 {
  /** Step 1(c). */
  filingStatus: "single_or_mfs" | "mfj_or_qss" | "head_of_household";
  /** Step 2(c): two jobs total, or married filing jointly and spouse also works. */
  multipleJobsCheckbox: boolean;
  /** Step 3(a): number of qualifying children under 17 (multiplied by $2,200 on the form). */
  qualifyingChildren: number;
  /** Step 3(b): number of other dependents (multiplied by $500). */
  otherDependents: number;
  /** Other credits the employee adds to Step 3, annual cents. */
  otherCredits: Cents;
  /** Step 4(a) other income (not from jobs), annual cents. */
  otherIncome: Cents;
  /** Step 4(b) deductions from the Deductions Worksheet, annual cents. */
  deductions: Cents;
  /** Step 4(c) extra withholding per pay period, cents. */
  extraWithholding: Cents;
  /** Exempt checkbox after Step 4: "I claim exemption from withholding for 2026...". */
  exempt: boolean;
  /** Step 5. Typed full legal name as the electronic signature, and when it was signed. */
  signature: { name: string; signedAt: string };
}

/** Step 3 amounts on the 2026 form. The form says to complete Step 3 only if income is $200,000 or less ($400,000 if MFJ). */
export const W4_2026_STEP3 = { perChild: 2_200_00, perOtherDependent: 500_00 } as const;

/** Employer-determined facts that change how the W-4 is applied. */
export interface W4EmployerFacts {
  /** Nonresident alien employees follow Notice 1392 and Pub. 15-T NRA add-on. */
  nonresidentAlien?: boolean;
  /** IRS lock-in letter: withhold at no more than this maximum (overrides the employee's W-4). */
  lockIn?: { filingStatus: FederalFilingStatus; multipleJobs: boolean };
}

export function w4Step3Total(f: Pick<FormW4_2026, "qualifyingChildren" | "otherDependents" | "otherCredits">): Cents {
  return f.qualifyingChildren * W4_2026_STEP3.perChild + f.otherDependents * W4_2026_STEP3.perOtherDependent + f.otherCredits;
}

export interface FormIssue {
  field: string;
  message: string;
}

/** Checks a W-4 before it is accepted. An invalid W-4 must not be used; keep the prior one. */
export function validateW4(f: FormW4_2026, facts: W4EmployerFacts = {}): FormIssue[] {
  const issues: FormIssue[] = [];
  const nonNegInt = (n: number) => Number.isInteger(n) && n >= 0;
  if (!nonNegInt(f.qualifyingChildren)) issues.push({ field: "qualifyingChildren", message: "Enter a whole number of children." });
  if (!nonNegInt(f.otherDependents)) issues.push({ field: "otherDependents", message: "Enter a whole number of dependents." });
  for (const k of ["otherCredits", "otherIncome", "deductions", "extraWithholding"] as const) {
    if (!Number.isInteger(f[k]) || f[k] < 0) issues.push({ field: k, message: "Enter an amount of $0 or more." });
  }
  if (!f.signature.name.trim()) issues.push({ field: "signature", message: "Step 5: type your full name to sign. The form is not valid unless signed." });
  if (facts.nonresidentAlien) {
    // Notice 1392: NRAs may not claim exempt, must check Single (or MFS) in Step 1(c), and should not claim the standard-deduction-style Step 3/4(b) amounts beyond what Notice 1392 allows.
    if (f.exempt) issues.push({ field: "exempt", message: "Nonresident aliens may not claim exemption from withholding on Form W-4 (Notice 1392)." });
    if (f.filingStatus !== "single_or_mfs") issues.push({ field: "filingStatus", message: "Nonresident aliens check Single or Married filing separately (Notice 1392)." });
  }
  return issues;
}

/** Map Step 1(c) to the tax engine. MFS withholds as single and QSS as married filing jointly. */
export function engineFilingStatus(s: FormW4_2026["filingStatus"]): FederalFilingStatus {
  return s === "mfj_or_qss" ? "married_jointly" : s === "single_or_mfs" ? "single" : "head_of_household";
}

/** Convert a signed 2026 W-4 into the tax engine's input. */
export function toFederalW4(f: FormW4_2026, facts: W4EmployerFacts = {}): FederalW4 {
  if (facts.lockIn) {
    // A lock-in letter sets the maximum. The employee may still ask for more via 4(c) (Pub. 505).
    return {
      version: "2020_or_later",
      filingStatus: facts.lockIn.filingStatus,
      multipleJobs: facts.lockIn.multipleJobs,
      dependentsCredit: 0,
      otherIncome: 0,
      deductions: 0,
      extraWithholding: f.extraWithholding,
      nonresidentAlien: facts.nonresidentAlien,
    };
  }
  return {
    version: "2020_or_later",
    filingStatus: engineFilingStatus(f.filingStatus),
    multipleJobs: f.multipleJobsCheckbox,
    dependentsCredit: w4Step3Total(f),
    otherIncome: f.otherIncome,
    deductions: f.deductions,
    extraWithholding: f.extraWithholding,
    exempt: f.exempt,
    nonresidentAlien: facts.nonresidentAlien,
  };
}

/**
 * Used when a new employee gives no W-4, or gives an invalid one: withhold as Single or MFS with
 * no other entries (Pub. 15-T, "Employees who fail to furnish Form W-4").
 */
export const NO_W4_ON_FILE: FederalW4 = {
  version: "2020_or_later",
  filingStatus: "single",
  multipleJobs: false,
  dependentsCredit: 0,
  otherIncome: 0,
  deductions: 0,
  extraWithholding: 0,
};

/**
 * Exempt status lasts one calendar year. It expires on February 15 of the next year (moved to the
 * next business day when that is a weekend or Presidents' Day). Without a new W-4 by then, withhold
 * as if Single/MFS with no entries, unless an earlier non-exempt W-4 is on file (Pub. 15).
 */
export function exemptExpires(formYear: number): string {
  const d = new Date(Date.UTC(formYear + 1, 1, 15));
  const presidentsDay = thirdMonday(formYear + 1, 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || d.getUTCDate() === presidentsDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function thirdMonday(year: number, month: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + 14;
}
