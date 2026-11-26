/**
 * Form I-9, Employment Eligibility Verification, edition 01/20/25 (expires 05/31/2027).
 * Rules come from the form instructions and the USCIS Handbook for Employers (M-274); see
 * FORM_VERSIONS in ./sources.ts. This module holds no document images: those live in encrypted
 * object storage and are referenced by id (docs/onboarding-forms.md).
 */
import type { FormIssue } from "./w4";

export const I9_EDITION = "01/20/25";
export const I9_EDITION_EXPIRES = "2027-05-31";

// ---------- Section 1 (employee) ----------

export type I9Attestation =
  | { status: "us_citizen" }
  | { status: "noncitizen_national" }
  | { status: "lawful_permanent_resident"; aNumber: string }
  | {
      /** The 01/20/25 edition labels this box "An alien authorized to work". */
      status: "alien_authorized";
      /** Work authorization expiration (ISO), or "N/A". */
      expires: string;
      /** Exactly one of these identifies the employee. */
      id: { kind: "a_number"; value: string } | { kind: "i94"; value: string } | { kind: "foreign_passport"; value: string; country: string };
    };

export interface I9Section1 {
  lastName: string;
  firstName: string;
  middleInitial?: string;
  otherLastNames?: string;
  address: { street: string; apt?: string; city: string; state: string; zip: string };
  dateOfBirth: string;
  /** Voluntary unless the employer uses E-Verify. Stored encrypted; see docs/onboarding-forms.md. */
  ssnProvided: boolean;
  email?: string;
  phone?: string;
  attestation: I9Attestation;
  /** Typed name as the electronic signature; the system records an attestation timestamp and IP. */
  signature: { name: string; signedAt: string };
  /** Supplement A, one per preparer/translator who helped. */
  preparers?: { lastName: string; firstName: string; address: string; signedAt: string }[];
}

export function validateSection1(s: I9Section1, opts: { eVerify: boolean; offerAcceptedOn?: string }): FormIssue[] {
  const issues: FormIssue[] = [];
  if (!s.lastName.trim() || !s.firstName.trim()) issues.push({ field: "name", message: "Enter your legal first and last name." });
  if (!s.address.street.trim() || !s.address.city.trim() || !s.address.zip.trim()) issues.push({ field: "address", message: "Enter your home address." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.dateOfBirth)) issues.push({ field: "dateOfBirth", message: "Enter your date of birth." });
  if (opts.eVerify && !s.ssnProvided) issues.push({ field: "ssn", message: "Your employer uses E-Verify, so your Social Security number is required." });
  const a = s.attestation;
  if (a.status === "lawful_permanent_resident" && !/^A?\d{7,9}$/i.test(a.aNumber.replace(/[-\s]/g, ""))) {
    issues.push({ field: "aNumber", message: "Enter your 7 to 9 digit A-Number or USCIS Number." });
  }
  if (a.status === "alien_authorized") {
    if (a.expires !== "N/A" && !/^\d{4}-\d{2}-\d{2}$/.test(a.expires)) issues.push({ field: "expires", message: "Enter your work authorization expiration date, or N/A." });
    if (!a.id.value.trim()) issues.push({ field: "id", message: "Enter an A-Number, Form I-94 admission number, or foreign passport number." });
    if (a.id.kind === "foreign_passport" && !a.id.country.trim()) issues.push({ field: "country", message: "Enter the passport's country of issuance." });
  }
  if (!s.signature.name.trim()) issues.push({ field: "signature", message: "Sign Section 1 by typing your full name." });
  if (opts.offerAcceptedOn && s.signature.signedAt.slice(0, 10) < opts.offerAcceptedOn) {
    issues.push({ field: "signature", message: "Section 1 can only be completed after the job offer is accepted." });
  }
  return issues;
}

// ---------- Acceptable documents ----------

export type I9List = "A" | "B" | "C";

export interface I9DocumentType {
  id: string;
  list: I9List;
  title: string;
  /** Only for employees under 18 who cannot present another List B document. */
  under18Only?: boolean;
  /** Presenting it means Supplement B reverification is due when work authorization expires. */
  reverify?: boolean;
}

/** USCIS "Form I-9 Acceptable Documents" (reviewed 2025-04-08). Titles shortened; the page has the full text. */
export const I9_DOCUMENTS: readonly I9DocumentType[] = [
  { id: "us_passport", list: "A", title: "U.S. Passport or U.S. Passport Card" },
  { id: "i551", list: "A", title: "Permanent Resident Card or Alien Registration Receipt Card (Form I-551)" },
  { id: "foreign_passport_i551_stamp", list: "A", title: "Foreign passport with temporary I-551 stamp or printed I-551 notation on a machine-readable immigrant visa" },
  { id: "i766", list: "A", title: "Employment Authorization Document with photograph (Form I-766)", reverify: true },
  { id: "foreign_passport_i94", list: "A", title: "Foreign passport with Form I-94/I-94A showing an unexpired work endorsement for this employer", reverify: true },
  { id: "fsm_rmi_passport_i94", list: "A", title: "Passport from the Federated States of Micronesia or Marshall Islands with Form I-94/I-94A (Compact of Free Association)", reverify: true },
  { id: "drivers_license", list: "B", title: "Driver's license or ID card issued by a U.S. state or outlying possession, with photo or identifying information" },
  { id: "government_id", list: "B", title: "ID card issued by a federal, state, or local government agency, with photo or identifying information" },
  { id: "school_id", list: "B", title: "School ID card with a photograph" },
  { id: "voter_card", list: "B", title: "Voter's registration card" },
  { id: "military_card", list: "B", title: "U.S. Military card or draft record" },
  { id: "military_dependent_id", list: "B", title: "Military dependent's ID card" },
  { id: "merchant_mariner", list: "B", title: "U.S. Coast Guard Merchant Mariner Card" },
  { id: "tribal_document_b", list: "B", title: "Native American tribal document" },
  { id: "canadian_dl", list: "B", title: "Driver's license issued by a Canadian government authority" },
  { id: "school_record", list: "B", title: "School record or report card", under18Only: true },
  { id: "medical_record", list: "B", title: "Clinic, doctor, or hospital record", under18Only: true },
  { id: "daycare_record", list: "B", title: "Day-care or nursery school record", under18Only: true },
  { id: "ssn_card", list: "C", title: "U.S. Social Security card without employment restrictions" },
  { id: "birth_abroad", list: "C", title: "Certification of report of birth issued by the Department of State (Forms DS-1350, FS-545, FS-240)" },
  { id: "birth_certificate", list: "C", title: "Original or certified copy of a U.S. birth certificate with an official seal" },
  { id: "tribal_document_c", list: "C", title: "Native American tribal document" },
  { id: "i197", list: "C", title: "U.S. Citizen ID Card (Form I-197)" },
  { id: "i179", list: "C", title: "ID Card for Use of Resident Citizen in the United States (Form I-179)" },
  { id: "dhs_employment_auth", list: "C", title: "Employment authorization document issued by DHS (List C #7)", reverify: true },
];

export const documentType = (id: string) => I9_DOCUMENTS.find((d) => d.id === id);

export interface I9PresentedDocument {
  typeId: string;
  issuingAuthority: string;
  /** Stored encrypted; only the last 4 are shown in the app. */
  number: string;
  expires?: string;
  /** A receipt for a replacement of a lost, stolen, or damaged document, or one of the special receipts. */
  receipt?: { kind: "replacement" | "refugee_i94" | "temporary_i551"; issuedOn: string };
  /** Object storage key of the encrypted front/back images, if the employer keeps copies. */
  imageKeys?: string[];
}

/** Receipt validity (M-274 section 4.4). The employee must then present the actual document. */
export function receiptValidUntil(r: NonNullable<I9PresentedDocument["receipt"]>, firstDay: string, stampExpires?: string): string {
  if (r.kind === "temporary_i551") return stampExpires ?? addYears(r.issuedOn, 1);
  // Replacement and refugee I-94 receipts: 90 days from the first day of employment.
  return addDays(firstDay, 90);
}

// ---------- Section 2 (employer) ----------

export interface I9Section2 {
  documents: I9PresentedDocument[];
  additionalInfo?: string;
  /** DHS-authorized alternative procedure (remote examination). Only for E-Verify employers in good standing. */
  alternativeProcedure: boolean;
  firstDayOfEmployment: string;
  examiner: { lastName: string; firstName: string; title: string; signedAt: string };
  business: { name: string; street: string; city: string; state: string; zip: string };
}

/**
 * The employee chooses which documents to present: either one List A document, or one List B
 * plus one List C. The employer may not ask for specific documents.
 */
export function validateDocumentCombo(docs: I9PresentedDocument[], employee: { under18: boolean }): FormIssue[] {
  const types = docs.map((d) => documentType(d.typeId));
  if (types.some((t) => !t)) return [{ field: "documents", message: "Unknown document type." }];
  const lists = types.map((t) => t!.list);
  const a = lists.filter((l) => l === "A").length;
  const b = lists.filter((l) => l === "B").length;
  const c = lists.filter((l) => l === "C").length;
  const issues: FormIssue[] = [];
  // Some List A entries are a combination (e.g. foreign passport + I-94); they are recorded as up to 3 rows.
  const listAOk = a >= 1 && b === 0 && c === 0;
  const bcOk = a === 0 && b === 1 && c === 1;
  if (!listAOk && !bcOk) issues.push({ field: "documents", message: "Record one List A document, or one List B and one List C document." });
  if (!employee.under18 && types.some((t) => t!.under18Only)) {
    issues.push({ field: "documents", message: "School, medical, and day-care records are only acceptable List B documents for employees under 18." });
  }
  for (const d of docs) {
    if (!d.issuingAuthority.trim() || !d.number.trim()) issues.push({ field: d.typeId, message: "Enter the issuing authority and document number." });
    if (d.expires && d.expires !== "N/A" && !d.receipt && d.expires < new Date().toISOString().slice(0, 10)) {
      issues.push({ field: d.typeId, message: "Expired documents are not acceptable (except where USCIS has automatically extended them; record that in Additional Information)." });
    }
  }
  return issues;
}

export function validateSection2(s: I9Section2, opts: { under18: boolean; eVerifyGoodStanding: boolean }): FormIssue[] {
  const issues = validateDocumentCombo(s.documents, { under18: opts.under18 });
  if (s.alternativeProcedure && !opts.eVerifyGoodStanding) {
    issues.push({ field: "alternativeProcedure", message: "Remote document examination is only available to E-Verify employers in good standing." });
  }
  if (s.alternativeProcedure && s.documents.some((d) => !d.imageKeys?.length)) {
    issues.push({ field: "documents", message: "With the alternative procedure, keep copies (front and back) of every document examined." });
  }
  if (!s.examiner.lastName.trim() || !s.examiner.title.trim()) issues.push({ field: "examiner", message: "Enter the name and title of the person who examined the documents." });
  if (/p\.?\s*o\.?\s*box/i.test(s.business.street)) issues.push({ field: "business", message: "Use the business's street address, not a P.O. box." });
  return issues;
}

// ---------- Deadlines and retention ----------

/** Mon-Fri, skipping any dates the employer is closed (e.g. holidays it observes). */
export function addBusinessDays(iso: string, n: number, closed: readonly string[] = []): string {
  const d = new Date(`${iso}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !closed.includes(d.toISOString().slice(0, 10))) left--;
  }
  return d.toISOString().slice(0, 10);
}

export interface I9Deadlines {
  /** Section 1: no later than the first day of employment. */
  section1: string;
  /** Section 2: within 3 business days after the first day (Monday start: Thursday). Same day if the job lasts under 3 business days. */
  section2: string;
}

export function i9Deadlines(firstDay: string, opts: { jobUnder3BusinessDays?: boolean; closed?: readonly string[] } = {}): I9Deadlines {
  return {
    section1: firstDay,
    section2: opts.jobUnder3BusinessDays ? firstDay : addBusinessDays(firstDay, 3, opts.closed),
  };
}

/**
 * Keep the I-9 for 3 years after the first day of employment or 1 year after employment ends,
 * whichever is later (8 CFR 274a.2(b)(2)(i)(A)). While employed, there is no purge date.
 * Document copies are kept with the form and purged at the same time.
 */
export function i9RetainUntil(firstDay: string, terminatedOn?: string | null): string | null {
  if (!terminatedOn) return null;
  const a = addYears(firstDay, 3);
  const b = addYears(terminatedOn, 1);
  return a > b ? a : b;
}

/** Supplement B is due no later than the date work authorization expires. Never for citizens, nationals, LPRs, or List B documents. */
export function reverificationDue(section1: I9Section1, section2: I9Section2): string | null {
  const st = section1.attestation.status;
  if (st === "us_citizen" || st === "noncitizen_national" || st === "lawful_permanent_resident") return null;
  const dates = section2.documents
    .filter((d) => documentType(d.typeId)?.reverify && d.expires && d.expires !== "N/A")
    .map((d) => d.expires!);
  if (section1.attestation.status === "alien_authorized" && section1.attestation.expires !== "N/A") dates.push(section1.attestation.expires);
  return dates.length ? dates.sort()[0] : null;
}

/** Rehire within 3 years of the original I-9 date may use Supplement B; otherwise complete a new I-9. */
export function rehireNeedsNewI9(originalI9Date: string, rehireDate: string): boolean {
  return rehireDate > addYears(originalI9Date, 3);
}

function addYears(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
