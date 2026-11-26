import { buildEfw2, EFW2_SOURCE, type Efw2Options } from "../../filings/efw2";
import type { Employer, Person, W2 } from "../../filings/w2";
import { newSubmission, type Submission } from "../submission";

/**
 * SSA Business Services Online has no API: a person signs in to BSO and uploads the EFW2 file
 * ("Report Wages To Social Security" > "Upload Wage File"). We build and check the file, mark it
 * ready_for_upload, and record the BSO WFID (wage file identifier) as the agency reference afterward.
 */
export const BSO_SOURCE = EFW2_SOURCE;

/** Checks SSA would reject on: record lengths, SSNs, names. AccuWage Online is still the final check. */
export function checkEfw2(file: string): string[] {
  const errors: string[] = [];
  const recs = file.split("\r\n").filter(Boolean);
  recs.forEach((r, i) => {
    if (r.length !== 512) errors.push(`Record ${i + 1} (${r.slice(0, 2)}) is ${r.length} bytes, not 512`);
    if (r.startsWith("RW")) {
      const ssn = r.slice(2, 11);
      if (!/^\d{9}$/.test(ssn) || ssn.startsWith("000") || ssn.startsWith("666") || ssn.startsWith("9") || ssn.slice(3, 5) === "00" || ssn.slice(5) === "0000")
        errors.push(`Record ${i + 1}: SSN ${ssn.slice(0, 3)}-xx-${ssn.slice(5)} is not valid`);
      if (!r.slice(11, 26).trim() || !r.slice(41, 61).trim()) errors.push(`Record ${i + 1}: employee first and last name are required`);
    }
  });
  const ids = recs.map((r) => r.slice(0, 2));
  if (ids[0] !== "RA" || ids[ids.length - 1] !== "RF") errors.push("File must start with RA and end with RF");
  return errors;
}

export function efw2FileName(year: number, employerEin: string) {
  return `W2REPORT_${year}_${employerEin.replace(/\D/g, "")}.txt`;
}

export function bsoW2Submission(opts: Efw2Options, employer: Employer, employees: { person: Person; w2: W2 }[]): Submission {
  const file = buildEfw2(opts, employer, employees);
  const errors = checkEfw2(file);
  return newSubmission({
    id: `ssa-w2-${opts.year}-${employer.ein.replace(/\D/g, "")}`,
    channel: "ssa_bso",
    form: "W-2/W-3",
    companyEin: employer.ein,
    period: String(opts.year),
    files: [{ name: efw2FileName(opts.year, employer.ein), contentType: "text/plain", bytes: new TextEncoder().encode(file) }],
    errors,
    warnings: [
      "Run the file through SSA AccuWage Online before uploading.",
      "Upload in BSO, then record the WFID shown on the receipt as the agency reference.",
      ...(EFW2_SOURCE.verified ? [] : ["EFW2 RT/RF/RS positions are not yet verified against Pub. 42-007 TY2026 (docs/tax-engine.md)."]),
    ],
  });
}
