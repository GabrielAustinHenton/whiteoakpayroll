import { randomUUID } from "node:crypto";
import type { Source } from "../../tax-engine/types";
import type { Form1099Nec } from "../../filings/form1099nec";
import type { Employer } from "../../filings/w2";
import { document, el, usd } from "../xml";

/**
 * IRIS A2A 1099-NEC transmission (Pub. 5718, Processing Year 2027). For Tax Year 2026 IRIS is the
 * only IRS system for e-filing information returns; FIRE is closed.
 *
 * STATUS: the transmission/submission/record structure, UTID format, TestCd, limits and character
 * rules are from Pub. 5718. The XSDs (IRS-IRIntakeTransmissionMessage.xsd, IRS-Form1099NECType.xsd,
 * TY2026 v1.2) are in the IRS Secure Object Repository and need an active IRIS TCC, so the element
 * names below are best knowledge and must be aligned with those XSDs before ATS.
 */
export const IRIS_SOURCE: Source = {
  cite: "IRS Pub. 5718 (PY2027) IRIS A2A Specifications; Pub. 5719 IRIS Test Package",
  url: "https://www.irs.gov/pub/irs-pdf/p5718.pdf",
  readOn: "2026-11-26",
  verified: false,
  note: "Endpoints, OAuth flow, UTID, limits verified in Pub. 5718. Element names unverified (schemas behind SOR).",
};

export const IRIS_ENDPOINTS = {
  token: "https://api.www4.irs.gov/auth/oauth/v2/token",
  submit: { production: "https://api.www4.irs.gov/IRIntakeAcceptanceA2A/1.0/irisa2a/v1/intake-acceptance", ats: "https://api.alt.www4.irs.gov/IRIntakeAcceptanceA2A/1.0/irisa2a/v1/intakeacceptance" },
  status: { production: "https://api.www4.irs.gov/IRIntakeAcceptanceA2A/1.0/iris/transstatusorack", ats: "https://api.alt.www4.irs.gov/IRIntakeAcceptanceA2A/1.0/iris/transstatusorack" },
} as const;

export const IRIS_LIMITS = { recordsPerSubmission: 30_000, bytesPerTransmission: 100 * 1024 * 1024 };

/** UTID: UUID:IRIS:<TCC>::A (Pub. 5718). The TCC here must match the manifest's TransmitterControlCd. */
export function utid(tcc: string, uuid: string = randomUUID()): string {
  if (!/^[A-Z0-9]{5}$/.test(tcc)) throw new Error("TCC must be 5 characters");
  return `${uuid}:IRIS:${tcc}::A`;
}

/** IRIS rejects "--", and apostrophes in person names. */
export function irisText(s: string, personName = false): string {
  let t = s.replace(/-{2,}/g, "-");
  if (personName) t = t.replace(/'/g, "");
  return t;
}

export interface IrisTransmitter {
  tcc: string;
  tin: string;
  name: string;
  contact: { name: string; phone: string; email: string };
  softwareId: string;
}

export function irisNecTransmission(
  forms: Form1099Nec[],
  issuer: Employer,
  transmitter: IrisTransmitter,
  opts: { taxYear: number; test: boolean; uuid?: string },
): { utid: string; xml: string } {
  if (forms.length > IRIS_LIMITS.recordsPerSubmission) throw new Error("Split into multiple submissions: 30,000 records maximum");
  const id = utid(transmitter.tcc, opts.uuid);
  const records = forms.map((f, i) =>
    el("Form1099NECDetail", [
      el("TaxYr", opts.taxYear),
      el("RecordId", i + 1),
      el("RecipientTIN", f.contractor.tin.replace(/\D/g, "")),
      el("TINTypeCd", f.contractor.tinType === "ein" ? "BUSINESS_TIN" : "INDIVIDUAL_TIN"),
      el("RecipientName", [el(f.contractor.tinType === "ein" ? "BusinessNameLine1Txt" : "PersonFullNm", irisText(f.contractor.name, f.contractor.tinType === "ssn"))]),
      el("MailingAddressGrp", [
        el("USAddress", [
          el("AddressLine1Txt", irisText(f.contractor.address.line1)),
          el("CityNm", f.contractor.address.city),
          el("StateAbbreviationCd", f.contractor.address.state),
          el("ZIPCd", f.contractor.address.zip),
        ]),
      ]),
      el("NonemployeeCompensationAmt", usd(f.box1_nonemployeeComp)),
      f.box4_federalTaxWithheld ? el("FederalIncomeTaxWithheldAmt", usd(f.box4_federalTaxWithheld)) : undefined,
      f.contractor.state
        ? el("StateLocalTaxGrp", [
            el("StateTaxGrp", [
              el("StateAbbreviationCd", f.contractor.state),
              el("PayerStateIdNum", f.box6_statePayerNumber),
              el("StateIncomeAmt", usd(f.box7_stateIncome)),
              f.box5_stateTaxWithheld ? el("StateTaxWithheldAmt", usd(f.box5_stateTaxWithheld)) : undefined,
            ]),
          ])
        : undefined,
    ]),
  );
  const xml = document(
    el(
      "IRTransmission",
      [
        el("IRTransmissionManifest", [
          el("UniqueTransmissionId", id),
          el("TaxYr", opts.taxYear),
          el("PriorYearDataInd", "0"),
          el("TransmissionTypeCd", "O"),
          el("TestCd", opts.test ? "T" : "P"),
          el("TransmitterGrp", [el("TIN", transmitter.tin.replace(/\D/g, "")), el("TransmitterControlCd", transmitter.tcc), el("BusinessName", [el("BusinessNameLine1Txt", transmitter.name)])]),
          el("SoftwareId", transmitter.softwareId),
          el("ContactPersonInformationGrp", [el("ContactPersonNm", transmitter.contact.name), el("ContactPhoneNum", transmitter.contact.phone.replace(/\D/g, "")), el("ContactEmailAddressTxt", transmitter.contact.email)]),
          el("TotalIssuerFormCnt", 1),
          el("TotalRecipientFormCnt", forms.length),
          el("PaperSubmissionInd", "0"),
          el("MediaSourceCd", "A2A"),
          el("SubmissionChannelCd", "A2A"),
        ]),
        el("IRSubmission1Grp", [
          el("IRSubmission1Header", [
            el("SubmissionId", 1),
            el("TaxYr", opts.taxYear),
            el("IssuerDetail", [
              el("TIN", issuer.ein.replace(/\D/g, "")),
              el("BusinessName", [el("BusinessNameLine1Txt", irisText(issuer.name))]),
              el("MailingAddressGrp", [el("USAddress", [el("AddressLine1Txt", issuer.address.line1), el("CityNm", issuer.address.city), el("StateAbbreviationCd", issuer.address.state), el("ZIPCd", issuer.address.zip)])]),
              el("PhoneNum", issuer.contact.phone.replace(/\D/g, "")),
            ]),
            el("FormTypeCd", "1099NEC"),
            el("TotalReportedRcpntFormCnt", forms.length),
          ]),
          el("IRSubmission1Detail", records),
        ]),
      ],
      { xmlns: "urn:us:gov:treasury:irs:ir" },
    )!,
  );
  return { utid: id, xml };
}

/** Transport: REST + OAuth 2.0 JWT bearer (RS256 client and user JWTs, 15-minute exp). */
export interface IrisClient {
  submit(xml: string, opts: { ats: boolean }): Promise<{ receiptId: string }>;
  status(utidOrReceipt: string, opts: { ats: boolean }): Promise<{ status: "Accepted" | "Rejected" | "Processing" | "Partially Accepted" | "Accepted with Errors" | "Not Found"; errors: string[] }>;
}

export class IrisNotConfigured implements IrisClient {
  async submit(): Promise<{ receiptId: string }> {
    throw new Error("IRIS A2A is not set up: White Oak Payroll needs an IRIS A2A TCC, API client ID, X.509 certificate/JWKS and passing ATS. See docs/registrations.md.");
  }
  async status(): Promise<{ status: "Not Found"; errors: string[] }> {
    return { status: "Not Found", errors: [] };
  }
}
