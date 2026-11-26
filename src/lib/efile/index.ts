/**
 * E-file layer: turns the filings built in src/lib/filings into submissions for each agency
 * channel. Nothing here sends anything; transmitters (MeF A2A, IRIS A2A) stay "not configured"
 * until White Oak Payroll has the credentials listed in docs/registrations.md, and portal channels
 * (SSA BSO, myconneCT) produce files that a person uploads.
 */
import { build1099Necs, check941, ct941, ctW3, form1096, form940, form941, type Employer, type PaycheckRecord, type Person, type W2 } from "../filings";
import type { Contractor, ContractorPaymentRecord, Form1099Nec } from "../filings/form1099nec";
import type { Efw2Options } from "../filings/efw2";
import type { Cents } from "../money";
import { ctNecFile, ctW2File, ctW2FileName } from "./ct/files";
import { ct1096Worksheet, ct941Worksheet, ctW3Worksheet } from "./ct/worksheets";
import { irisNecTransmission, type IrisTransmitter } from "./iris/1099nec";
import { package940, package941, type ReportingAgent } from "./mef/94x";
import { bsoW2Submission } from "./ssa/bso";
import { newSubmission, type Submission } from "./submission";

export * from "./submission";
export * from "./zip";
export * from "./mef/94x";
export * from "./mef/transmitter";
export * from "./iris/1099nec";
export * from "./ssa/bso";
export * from "./ct/files";
export * from "./ct/worksheets";

const text = (s: string) => new TextEncoder().encode(s);
const digits = (s: string) => s.replace(/\D/g, "");

export function mef941Submission(
  records: PaycheckRecord[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  deposits: Cents,
  employer: Employer,
  agent: ReportingAgent,
  depositor: "monthly" | "semiweekly",
  now = new Date(),
): Submission {
  const f = form941(records, year, quarter, deposits);
  const pkg = package941(f, employer, agent, depositor, now);
  return newSubmission({
    id: pkg.submissionId,
    channel: "irs_mef",
    form: "941",
    companyEin: employer.ein,
    period: `${year}Q${quarter}`,
    files: [{ name: `${pkg.submissionId}.zip`, contentType: "application/zip", bytes: pkg.zip }],
    errors: check941(f),
    warnings: ["MeF element names are not yet checked against the IRS 94x XSDs (docs/tax-engine.md)."],
  });
}

export function mef940Submission(records: PaycheckRecord[], year: number, deposits: Cents, states: string[], employer: Employer, agent: ReportingAgent, now = new Date()): Submission {
  const f = form940(records, year, deposits, states);
  const pkg = package940(f, employer, agent, now);
  return newSubmission({
    id: pkg.submissionId,
    channel: "irs_mef",
    form: "940",
    companyEin: employer.ein,
    period: String(year),
    files: [{ name: `${pkg.submissionId}.zip`, contentType: "application/zip", bytes: pkg.zip }],
    warnings: ["MeF element names are not yet checked against the IRS 94x XSDs (docs/tax-engine.md)."],
  });
}

/** 1099-NEC through IRIS, plus the 1096 we always archive (CT auditors ask for it even when e-filed). */
export function iris1099Submission(
  contractors: Contractor[],
  payments: ContractorPaymentRecord[],
  year: number,
  payer: Employer,
  transmitter: IrisTransmitter,
  opts: { test: boolean; uuid?: string },
): { submission: Submission; forms: Form1099Nec[] } {
  const forms = build1099Necs(contractors, payments, year, payer.stateIds);
  const { utid, xml } = irisNecTransmission(forms, payer, transmitter, { taxYear: year, ...opts });
  const archived1096 = form1096(forms, year, { name: payer.name, ein: payer.ein }, true);
  const submission = newSubmission({
    id: utid,
    channel: "irs_iris",
    form: "1099-NEC",
    companyEin: payer.ein,
    period: String(year),
    files: [
      { name: `${utid.replace(/:/g, "_")}.xml`, contentType: "application/xml", bytes: text(xml) },
      { name: `1096-${year}-${digits(payer.ein)}.json`, contentType: "application/json", bytes: text(JSON.stringify(archived1096, null, 2)) },
    ],
    errors: forms.length ? [] : ["No contractor reached the reporting threshold; nothing to file."],
    warnings: ["IRIS element names are not yet checked against the IRIS XSDs, which need an IRIS TCC to download."],
  });
  return { submission, forms };
}

export function ssaW2Submission(opts: Efw2Options, employer: Employer, employees: { person: Person; w2: W2 }[]): Submission {
  return bsoW2Submission(opts, employer, employees);
}

/** Connecticut year-end: W-2 file, 1099 file (when there are CT payees) and the CT-W3 / CT-1096 worksheets. */
export function ctYearEndSubmissions(
  year: number,
  submitter: Employer,
  employer: Employer,
  employees: { person: Person; w2: W2 }[],
  forms1099: Form1099Nec[],
  paidForYear: Cents,
): Submission[] {
  const trn = employer.stateIds.CT ?? "";
  const ctEmployees = employees.filter((e) => e.w2.states.some((s) => s.state === "CT"));
  const ctForms = forms1099.filter((f) => f.contractor.state === "CT");
  const base = { channel: "ct_myconnect" as const, companyEin: employer.ein, period: String(year) };
  const out: Submission[] = [];
  const errors = trn ? [] : ["Employer has no CT Tax Registration Number"];
  out.push(
    newSubmission({
      ...base,
      id: `ct-w2-${year}-${digits(employer.ein)}`,
      form: "CT W-2",
      files: trn && ctEmployees.length ? [{ name: ctW2FileName(year), contentType: "text/plain", bytes: text(ctW2File({ year, submitter }, employer, ctEmployees)) }] : [],
      errors: ctEmployees.length ? errors : [...errors, "No employees with Connecticut wages"],
      warnings: ctEmployees.length < 25 ? ["Fewer than 25 CT W-2s: the electronic file is optional, but still accepted."] : [],
    }),
  );
  if (ctForms.length)
    out.push(
      newSubmission({
        ...base,
        id: `ct-1099-${year}-${digits(employer.ein)}`,
        form: "CT 1099-NEC",
        files: [{ name: `CT1099NEC${year}.txt`, contentType: "text/plain", bytes: text(ctNecFile({ year, transmitter: submitter }, employer, ctForms)) }],
        errors,
      }),
    );
  const w3 = ctW3(employees.map((e) => e.w2), forms1099, year, paidForYear);
  out.push(
    newSubmission({
      ...base,
      id: `ct-w3-${year}-${digits(employer.ein)}`,
      form: "CT-W3",
      files: [
        { name: `CT-W3-${year}.txt`, contentType: "text/plain", bytes: text(ctW3Worksheet(w3, { name: employer.name, ctTrn: trn })) },
        { name: `CT-1096-${year}.txt`, contentType: "text/plain", bytes: text(ct1096Worksheet(forms1099, year, { name: employer.name, ctTrn: trn })) },
      ],
      errors,
      warnings: ["Key the CT-W3 and CT-1096 in myconneCT after the W-2/1099 uploads (CSV upload layouts not yet wired in)."],
    }),
  );
  return out;
}

export function ct941Submission(records: PaycheckRecord[], year: number, quarter: 1 | 2 | 3 | 4, payments: Cents, employer: Employer): Submission {
  const trn = employer.stateIds.CT ?? "";
  const f = ct941(records, year, quarter, payments);
  return newSubmission({
    id: `ct-941-${year}Q${quarter}-${digits(employer.ein)}`,
    channel: "ct_myconnect",
    form: "CT-941",
    companyEin: employer.ein,
    period: `${year}Q${quarter}`,
    files: [{ name: `CT-941-${year}Q${quarter}.txt`, contentType: "text/plain", bytes: text(ct941Worksheet(f, { name: employer.name, ctTrn: trn })) }],
    errors: trn ? [] : ["Employer has no CT Tax Registration Number"],
    warnings: ["Key the CT-941 in myconneCT (CSV upload layout not yet wired in)."],
  });
}
