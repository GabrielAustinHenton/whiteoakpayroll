import type { Cents } from "../money";
import type { CtW4 } from "../tax-engine/state/ct";
import type { MaW4 } from "../tax-engine/state/ma";
import type { OrW4 } from "../tax-engine/state/or";
import type { NyIt2104 } from "../tax-engine/state/ny";
import type { LaunchState, StateCertificate } from "../tax-engine/state";
import type { CtCode } from "../tax-engine/tables/2026/ct";
import type { FormIssue } from "./w4";

/**
 * State withholding certificates for the launch states, as the employee fills them in, plus the
 * conversion to the tax engine's inputs and the employer duties each form creates.
 * Sources: FORM_VERSIONS in ./sources.ts.
 */

interface Signed {
  /** Typed full legal name as the electronic signature, and when it was signed. */
  signature: { name: string; signedAt: string };
}

// ---------- Connecticut CT-W4 (Rev. 12/25) ----------

export type CtFilingStatus = "single" | "head_of_household" | "mfj_spouse_not_employed" | "mfj_spouse_employed" | "mfs" | "qualifying_surviving_spouse";

export interface FormCtW4 extends Signed {
  /** Line 1. */
  code: CtCode;
  /** Line 2: additional withholding per pay period. */
  additional: Cents;
  /** Line 3: reduced withholding per pay period. */
  reduction: Cents;
  /** Military Spouses Residency Relief Act exemption, with state of legal residence. Requires the spouse's LES and military dependent ID. */
  msrra?: { domicileState: string };
}

/**
 * The CT-W4 chart: which code fits a filing status and expected annual income (combined for
 * married filing jointly). Anyone may pick "D" for the highest withholding instead.
 * Thresholds read from CT-W4 (Rev. 12/25); verified: false until checked against the DRS PDF layout.
 */
export function suggestCtCode(status: CtFilingStatus, expectedAnnualIncome: Cents): CtCode {
  const $ = (n: number) => n * 100;
  switch (status) {
    case "single":
      return expectedAnnualIncome <= $(15_000) ? "E" : "F";
    case "head_of_household":
      return expectedAnnualIncome <= $(19_000) ? "E" : "B";
    case "mfj_spouse_not_employed":
      return expectedAnnualIncome <= $(24_000) ? "E" : "C";
    case "mfj_spouse_employed":
      return expectedAnnualIncome <= $(24_000) ? "E" : expectedAnnualIncome <= $(100_500) ? "A" : "D";
    case "mfs":
      return expectedAnnualIncome <= $(12_000) ? "E" : "A";
    case "qualifying_surviving_spouse":
      return expectedAnnualIncome <= $(24_000) ? "E" : "C";
  }
}

export function toCtW4(f: FormCtW4 | null): CtW4 {
  // No CT-W4 on file: withhold at 6.99% with no exemption (engine treats code null that way).
  if (!f) return { code: null };
  return { code: f.msrra ? "E" : f.code, additional: f.additional, reduction: f.reduction };
}

// ---------- Massachusetts M-4 (Rev. 3/24) ----------

export interface FormM4 extends Signed {
  /** Line 1: 1, or 2 if age 65 or over. */
  line1: 1 | 2;
  /** Line 2: 0, 4 if spouse exemption allowed, 5 if spouse is also 65 or over. */
  line2: 0 | 4 | 5;
  /** Line 3: qualified dependents (plus 1 for each under age 12, per Instruction D). */
  line3: number;
  /** Line 5: additional withholding per pay period. */
  additional: Cents;
  /** Box A. */
  headOfHousehold: boolean;
  /** Box B. */
  blind: boolean;
  /** Box C: spouse is blind and not subject to withholding. */
  spouseBlind: boolean;
  /** Box D: full-time student, seasonal/part-time/temporary job, annual income $8,000 or less. Employer must not withhold. */
  fullTimeStudentUnder8k: boolean;
}

export const m4Line4 = (f: Pick<FormM4, "line1" | "line2" | "line3">) => f.line1 + f.line2 + f.line3;

export function toMaW4(f: FormM4 | null): MaW4 {
  // No M-4 on file: withhold on the basis of no exemptions.
  if (!f) return { exemptions: 0 };
  return {
    exemptions: m4Line4(f),
    headOfHousehold: f.headOfHousehold,
    blind: (f.blind ? 1 : 0) + (f.spouseBlind ? 1 : 0),
    fullTimeStudentUnder8k: f.fullTimeStudentUnder8k,
    additional: f.additional,
  };
}

// ---------- Oregon OR-W-4 (2026) ----------

/** Line 4a exemption codes. There is no code I. */
export const OR_EXEMPTION_CODES = {
  A: "Air carrier employee",
  B: "American Indian enrolled tribal member living and working in Indian country in Oregon",
  C: "Amtrak Act worker",
  D: "Casual laborer",
  E: "Domestic service worker",
  F: "Hydroelectric dam worker (Bonneville, John Day, McNary, The Dalles)",
  G: "Military pay for nonresidents stationed in Oregon, and spouses",
  H: "Minister or member of a religious order",
  J: "Real estate salesperson under a written contract",
  K: "Waterway worker",
  L: "No tax liability",
  M: "Nonresident expecting a refund because wages are not subject to Oregon tax",
} as const;
export type OrExemptionCode = keyof typeof OR_EXEMPTION_CODES;

export interface FormOrW4 extends Signed {
  /** Line 1. */
  filingStatus: "single" | "married" | "married_single_rate";
  /** Line 2. */
  allowances: number;
  /** Line 3: additional amount per paycheck. */
  additional: Cents;
  /** Line 4a code; line 4b "Exempt" is implied when present. An exemption ends February 15 of the next year. */
  exemptionCode?: OrExemptionCode;
  /** The form's tax year, for exemption expiry. */
  year: number;
}

export function toOrW4(f: FormOrW4 | null, today = new Date()): OrW4 {
  // Federal W-4s from 2020 on cannot be used for Oregon. With no OR-W-4 (and no pre-2020 W-4): 8% of wages.
  if (!f) return { filingStatus: "single", allowances: 0, noForm: true };
  const exemptActive = !!f.exemptionCode && today.toISOString().slice(0, 10) < `${f.year + 1}-02-16`;
  if (f.exemptionCode && !exemptActive) return { filingStatus: "single", allowances: 0, noForm: true };
  return { filingStatus: f.filingStatus, allowances: f.allowances, additional: f.additional, exempt: exemptActive };
}

// ---------- New York IT-2104 (2026) ----------

export interface FormIt2104 extends Signed {
  /** Head of household marks Single. "Married, but withhold at higher single rate" withholds as single. */
  status: "single_or_hoh" | "married" | "married_higher_single";
  nycResident: boolean;
  yonkersResident: boolean;
  /** Line 1: NYS (and Yonkers) allowances. */
  line1: number;
  /** Line 2: NYC allowances. */
  line2: number;
  /** Lines 3-5: additional withholding per pay period. */
  additionalState: Cents;
  additionalNyc: Cents;
  additionalYonkers: Cents;
}

/** Exemption is claimed on a separate form (IT-2104-E, IT-2104-IND or IT-2104-MS), not on IT-2104. */
export interface FormIt2104E extends Signed {
  form: "IT-2104-E" | "IT-2104-IND" | "IT-2104-MS";
  year: number;
}

export function toNyIt2104(f: FormIt2104 | null, exemption?: FormIt2104E | null, employer: { yonkersWorksite?: boolean } = {}): NyIt2104 {
  // No IT-2104: zero allowances, single (IT-2104-I: employers may use zero allowances).
  const base: NyIt2104 = f
    ? {
        status: f.status === "married" ? "married" : "single",
        allowances: f.line1,
        nycAllowances: f.line2,
        additionalState: f.additionalState,
        additionalNyc: f.nycResident ? f.additionalNyc : 0,
        additionalYonkers: f.yonkersResident ? f.additionalYonkers : 0,
        nycResident: f.nycResident,
        yonkersResident: f.yonkersResident,
      }
    : { status: "single", allowances: 0 };
  base.yonkersNonresidentWorker = !!employer.yonkersWorksite && !base.yonkersResident;
  if (exemption) base.exempt = true;
  return base;
}

// ---------- Shared ----------

export type StateForm =
  | { state: "CT"; form: FormCtW4 | null }
  | { state: "MA"; form: FormM4 | null }
  | { state: "OR"; form: FormOrW4 | null }
  | { state: "NY"; form: FormIt2104 | null; exemption?: FormIt2104E | null; yonkersWorksite?: boolean };

export function toStateCertificate(s: StateForm): StateCertificate {
  switch (s.state) {
    case "CT":
      return { state: "CT", w4: toCtW4(s.form) };
    case "MA":
      return { state: "MA", w4: toMaW4(s.form) };
    case "OR":
      return { state: "OR", w4: toOrW4(s.form) };
    case "NY":
      return { state: "NY", w4: toNyIt2104(s.form, s.exemption, { yonkersWorksite: s.yonkersWorksite }) };
  }
}

export const STATE_FORM_NAME: Record<LaunchState, string> = { CT: "CT-W4", MA: "M-4", OR: "OR-W-4", NY: "IT-2104" };

export function validateStateForm(s: StateForm): FormIssue[] {
  const issues: FormIssue[] = [];
  const f = s.form;
  if (!f) return issues;
  if (!f.signature.name.trim()) issues.push({ field: "signature", message: `Sign Form ${STATE_FORM_NAME[s.state]} by typing your full name.` });
  const whole = (n: number, field: string) => {
    if (!Number.isInteger(n) || n < 0) issues.push({ field, message: "Enter a whole number, 0 or more." });
  };
  const money = (n: number, field: string) => {
    if (!Number.isInteger(n) || n < 0) issues.push({ field, message: "Enter an amount of $0 or more." });
  };
  if (s.state === "CT") {
    money(s.form!.additional, "additional");
    money(s.form!.reduction, "reduction");
    if (s.form!.additional > 0 && s.form!.reduction > 0) issues.push({ field: "reduction", message: "Enter an amount on line 2 or line 3, not both." });
  } else if (s.state === "MA") {
    whole(s.form!.line3, "line3");
    money(s.form!.additional, "additional");
  } else if (s.state === "OR") {
    whole(s.form!.allowances, "allowances");
    money(s.form!.additional, "additional");
    if (s.form!.exemptionCode && (s.form!.allowances > 0 || s.form!.additional > 0)) {
      issues.push({ field: "exemptionCode", message: "If you claim exempt, leave lines 2 and 3 blank." });
    }
  } else {
    whole(s.form!.line1, "line1");
    whole(s.form!.line2, "line2");
    money(s.form!.additionalState, "additionalState");
    if (!s.form!.nycResident && s.form!.line2 > 0) issues.push({ field: "line2", message: "Line 2 (NYC allowances) is only for New York City residents." });
  }
  return issues;
}

export interface EmployerDuty {
  state: LaunchState;
  action: string;
  due?: string;
  source: string;
}

/**
 * Copies of a certificate that the employer must send to the state. Shown on the Client HR
 * onboarding checklist and queued for the filings module.
 */
export function stateCertificateDuties(s: StateForm, opts: { expectedWeeklyWages?: Cents; receivedOn: string }): EmployerDuty[] {
  const duties: EmployerDuty[] = [];
  if (s.state === "CT" && s.form && toCtW4(s.form).code === "E" && (opts.expectedWeeklyWages ?? 0) > 1_000_00) {
    duties.push({
      state: "CT",
      action: "Mail a copy of this CT-W4 to DRS, PO Box 2931, Hartford CT 06104-2931 (employee claims E and wages are expected above $1,000 a week).",
      source: "CT-W4 (Rev. 12/25) employer instructions; $1,000/week trigger to confirm against IP 2026(1)",
    });
  }
  if (s.state === "NY" && s.form && (s.form.line1 > 14 || s.form.line2 > 14)) {
    duties.push({
      state: "NY",
      action: "Send a copy of this IT-2104 to NYS Tax Department, Income Tax Audit Administrator, Withholding Certificate Coordinator, W A Harriman Campus, Albany NY 12227-0865 (more than 14 allowances).",
      due: nyQuarterDue(opts.receivedOn),
      source: "IT-2104-I (2026), Box A",
    });
  }
  if (s.state === "OR" && s.form?.exemptionCode) {
    duties.push({
      state: "OR",
      action: `Oregon exemption (code ${s.form.exemptionCode}) ends February 15, ${s.form.year + 1}. Ask for a new OR-W-4 before then; after it ends, withhold 8% until one arrives.`,
      due: `${s.form.year + 1}-02-15`,
      source: "OR-W-4 instructions 150-101-402-1 (Rev. 07-28-25)",
    });
  }
  return duties;
}

/** IT-2104 copies are due by the end of the month after the calendar quarter received. */
function nyQuarterDue(receivedOn: string): string {
  const [y, m] = receivedOn.split("-").map(Number);
  const q = Math.ceil(m / 3);
  return q === 4 ? `${y + 1}-01-31` : `${y}-${["04-30", "07-31", "10-31"][q - 1]}`;
}

/**
 * State new-hire reporting deadlines (days after hire). CT and NY read from the CT-W4 and IT-2104-I
 * instructions; MA and OR are from memory and must be verified before launch.
 */
export const NEW_HIRE_REPORTING: Record<LaunchState, { agency: string; days: number; url: string }> = {
  CT: { agency: "CT Department of Labor", days: 20, url: "https://portal.ct.gov/dol" },
  MA: { agency: "MA DOR Child Support Enforcement", days: 14, url: "https://www.mass.gov/how-to/report-new-hires" },
  OR: { agency: "Oregon DOJ Child Support Program", days: 20, url: "https://www.doj.state.or.us/child-support/" },
  NY: { agency: "NYS Tax Department New Hire Notification (nynewhire.com)", days: 20, url: "https://www.nynewhire.com" },
};
