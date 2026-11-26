import type { Cents } from "../../money";
import type { Source } from "../../tax-engine/types";
import type { Form940 } from "../../filings/form940";
import type { Form941 } from "../../filings/form941";
import type { Employer } from "../../filings/w2";
import { document, el, usd, type XmlNode } from "../xml";
import { zip } from "../zip";

/**
 * IRS Modernized e-File (MeF) 94x returns: Form 941 (quarterly family, schema versions like
 * "2026Q4v4.0") and Form 940 (annual family, "2026v3.0"), filed by White Oak Payroll as Reporting
 * Agent.
 *
 * STATUS: structure follows Pub. 4164 (submission = zip with manifest/manifest.xml and
 * xml/<return>.xml; SubmissionId = EFIN + ccyyddd + 7 lowercase alphanumerics). The IRS 94x XSDs
 * are distributed to registered e-file providers, so the element names below are our best
 * knowledge and MUST be aligned with the official XSDs (run scripts/validate-mef.sh) before
 * Assurance Testing. Every element name lives in this file only, so aligning them is a one-file change.
 */
export const MEF_SOURCE: Source = {
  cite: "IRS Pub. 4164 (Processing Year 2026); TY2026 schemas and business rules for employment tax MeF forms",
  url: "https://www.irs.gov/e-file-providers/tax-year-2026-schemas-and-business-rules-for-employment-tax-modernized-e-file-mef-forms",
  readOn: "2026-11-26",
  verified: false,
  note: "Schema versions verified on the IRS TY2026 page (941: 2026Q1-Q4 v4.0 in production from 1/13/2026; 940: 2026v2.0/v3.0, production date TBD). Element names not yet checked against the XSDs.",
};

export const MEF_VERSIONS = {
  quarterly941: (quarter: number) => `2026Q${quarter}v4.0`,
  annual940: "2026v3.0",
};

export interface ReportingAgent {
  name: string;
  ein: string;
  /** 6-digit EFIN from the IRS e-file application. */
  efin: string;
  /** 5-digit ETIN for transmitting. */
  etin: string;
  /** Software ID issued after passing ATS for this tax year and package. */
  softwareId: string;
  /** Reporting Agent PIN (5 digits) issued by the IRS for signing 94x returns. */
  pin: string;
  address: Employer["address"];
  phone: string;
}

/** Name control: first four significant characters of the business name (Pub. 4164 / name control rules simplified). */
export function businessNameControl(name: string): string {
  const cleaned = name.toUpperCase().replace(/^THE\s+/, "").replace(/[^A-Z0-9&-]/g, "");
  return cleaned.slice(0, 4);
}

let seq = 0;
/** SubmissionId: EFIN (6) + year (4) + day of year (3) + 7 lowercase alphanumerics = 20 characters. */
export function submissionId(efin: string, when: Date, sequence?: number): string {
  if (!/^\d{6}$/.test(efin)) throw new Error("EFIN must be 6 digits");
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  const doy = Math.floor((when.getTime() - start) / 86_400_000);
  const n = sequence ?? ++seq;
  return `${efin}${when.getUTCFullYear()}${String(doy).padStart(3, "0")}${n.toString(36).padStart(7, "0").slice(-7)}`;
}

const ein = (s: string) => s.replace(/\D/g, "");

function returnHeader(opts: {
  type: "941" | "940";
  periodEnd: string;
  employer: Employer;
  agent: ReportingAgent;
  timestamp: string;
}): XmlNode {
  const { employer: e, agent: a } = opts;
  return el("ReturnHeader", [
    el("ReturnTs", opts.timestamp),
    el("TaxPeriodEndDt", opts.periodEnd),
    el("ReturnTypeCd", opts.type),
    el("SoftwareId", a.softwareId),
    el("Business", [
      el("EIN", ein(e.ein)),
      el("BusinessName", [el("BusinessNameLine1Txt", e.name.toUpperCase().slice(0, 75))]),
      el("BusinessNameControlTxt", businessNameControl(e.name)),
      el("USAddress", [
        el("AddressLine1Txt", e.address.line1.toUpperCase()),
        el("AddressLine2Txt", e.address.line2?.toUpperCase()),
        el("CityNm", e.address.city.toUpperCase()),
        el("StateAbbreviationCd", e.address.state),
        el("ZIPCd", e.address.zip + (e.address.zipExt ?? "")),
      ]),
    ]),
    // Signed by the Reporting Agent under Form 8655 authority.
    el("ReportingAgentSignatureGrp", [
      el("ReportingAgentPIN", a.pin),
      el("BusinessName", [el("BusinessNameLine1Txt", a.name.toUpperCase())]),
      el("EIN", ein(a.ein)),
      el("SignatureDt", opts.timestamp.slice(0, 10)),
    ]),
  ])!;
}

export function irs941Xml(f: Form941, depositorType: "monthly" | "semiweekly"): XmlNode {
  return el("IRS941", [
    el("EmployeeCnt", f.line1_employees),
    el("WagesAmt", usd(f.line2_wages)),
    el("FederalIncomeTaxWthldAmt", usd(f.line3_incomeTaxWithheld)),
    el("TaxableSocSecWagesAmt", usd(f.line5a_ssWages)),
    el("SocialSecurityTaxAmt", usd(f.line5a_ssTax)),
    el("TaxableSocSecTipsAmt", usd(f.line5b_ssTips)),
    el("TaxOnSocialSecurityTipsAmt", usd(f.line5b_ssTipsTax)),
    el("TaxableMedicareWagesTipsAmt", usd(f.line5c_medicareWages)),
    el("TaxOnMedicareWagesTipsAmt", usd(f.line5c_medicareTax)),
    el("TxblWageTipsSubjAddnlMedcrAmt", usd(f.line5d_addlMedicareWages)),
    el("AddnlMedicareTaxWithholdingAmt", usd(f.line5d_addlMedicareTax)),
    el("TotalSSMdcrTaxAmt", usd(f.line5e_total)),
    el("TotalTaxBeforeAdjustmentAmt", usd(f.line6_totalBeforeAdjustments)),
    f.line7_fractionsOfCents ? el("CurrentQtrFractionsCentsAmt", usd(f.line7_fractionsOfCents)) : undefined,
    el("TotalTaxAfterAdjustmentAmt", usd(f.line10_totalAfterAdjustments)),
    el("TotalTaxAmt", usd(f.line12_totalAfterCredits)),
    el("TotalTaxDepositAmt", usd(f.line13_deposits)),
    f.line14_balanceDue ? el("BalanceDueAmt", usd(f.line14_balanceDue)) : undefined,
    f.line15_overpayment ? el("OverpaymentGrp", [el("OverpaidAmt", usd(f.line15_overpayment)), el("ApplyOverpaymentNextReturnInd", "X")]) : undefined,
    depositorType === "monthly"
      ? el("MonthlyDepositorGrp", [
          el("Month1LiabilityAmt", usd(f.monthlyLiability[0])),
          el("Month2LiabilityAmt", usd(f.monthlyLiability[1])),
          el("Month3LiabilityAmt", usd(f.monthlyLiability[2])),
          el("TotalQuarterLiabilityAmt", usd(f.monthlyLiability.reduce((a, b) => a + b, 0))),
        ])
      : el("SemiweeklyScheduleDepositorInd", "X"),
  ])!;
}

/** Schedule B (Form 941): daily liabilities for semiweekly depositors. */
export function irs941ScheduleBXml(f: Form941, employerEin: string): XmlNode {
  const byMonth: Record<number, [string, Cents][]> = { 1: [], 2: [], 3: [] };
  for (const [day, amt] of Object.entries(f.scheduleB).sort(([a], [b]) => a.localeCompare(b))) {
    byMonth[Number(day.slice(5, 7)) - (f.quarter - 1) * 3].push([day, amt]);
  }
  const month = (m: 1 | 2 | 3) =>
    el(`Month${m}LiabilityGrp`, [
      ...byMonth[m].map(([d, amt]) => el("TaxLiabilityGrp", [el("DayOfMonthNum", Number(d.slice(8, 10))), el("TaxLiabilityAmt", usd(amt))])),
      el(`TotalMonth${m}LiabilityAmt`, usd(byMonth[m].reduce((s, [, a]) => s + a, 0))),
    ]);
  return el("IRS941ScheduleB", [
    el("EIN", ein(employerEin)),
    el("TaxYr", f.year),
    el("QuarterNum", f.quarter),
    month(1),
    month(2),
    month(3),
    el("TotalQuarterLiabilityAmt", usd(Object.values(f.scheduleB).reduce((a, b) => a + b, 0))),
  ])!;
}

export function irs940Xml(f: Form940): XmlNode {
  return el("IRS940", [
    f.line1a_state === "multi" ? el("MultiStateCd", "MU") : el("StateCd", f.line1a_state),
    el("TotalPaymentsToEmployeesAmt", usd(f.line3_totalPayments)),
    f.line4_exemptPayments ? el("ExemptPaymentsAmt", usd(f.line4_exemptPayments)) : undefined,
    el("TotalExcessOfFUTAWageBaseAmt", usd(f.line5_over7000)),
    el("TotalExemptPaymentsAmt", usd(f.line6_subtotal)),
    el("TotalTaxableFUTAWagesAmt", usd(f.line7_futaWages)),
    el("FUTATaxBeforeAdjustmentsAmt", usd(f.line8_futaBeforeAdjustments)),
    f.line11_creditReduction ? el("CreditReductionAmt", usd(f.line11_creditReduction)) : undefined,
    el("TotalTaxAfterAdjustmentsAmt", usd(f.line12_totalFuta)),
    el("FUTATaxDepositedAmt", usd(f.line13_deposits)),
    f.line14_balanceDue ? el("BalanceDueAmt", usd(f.line14_balanceDue)) : undefined,
    f.line15_overpayment ? el("OverpaymentGrp", [el("OverpaidAmt", usd(f.line15_overpayment)), el("ApplyOverpaymentNextReturnInd", "X")]) : undefined,
    f.line12_totalFuta > 50_000
      ? el("FUTALiabilityByQuarterGrp", [
          el("Quarter1LiabilityAmt", usd(f.quarterlyLiability[0])),
          el("Quarter2LiabilityAmt", usd(f.quarterlyLiability[1])),
          el("Quarter3LiabilityAmt", usd(f.quarterlyLiability[2])),
          el("Quarter4LiabilityAmt", usd(f.quarterlyLiability[3])),
          el("TotalYearLiabilityAmt", usd(f.quarterlyLiability.reduce((a, b) => a + b, 0))),
        ])
      : undefined,
  ])!;
}

function manifest(o: { submissionId: string; efin: string; type: string; taxYr: number; periodBegin: string; periodEnd: string; employerEin: string }): string {
  return document(
    el(
      "IRSSubmissionManifest",
      [
        el("SubmissionId", o.submissionId),
        el("EFIN", o.efin),
        el("TaxYr", o.taxYr),
        el("SubmissionCategoryCd", "EMPL"),
        el("SubmissionTyp", o.type),
        el("TaxPeriodBeginDt", o.periodBegin),
        el("TaxPeriodEndDt", o.periodEnd),
        el("EIN", ein(o.employerEin)),
      ],
      { xmlns: "http://www.irs.gov/efile", "xmlns:efile": "http://www.irs.gov/efile" },
    )!,
  );
}

export interface MefPackage {
  submissionId: string;
  manifestXml: string;
  returnXml: string;
  zip: Uint8Array;
}

function pack(submissionIdValue: string, manifestXml: string, returnXml: string): MefPackage {
  return {
    submissionId: submissionIdValue,
    manifestXml,
    returnXml,
    zip: zip([
      { path: `${submissionIdValue}/manifest/manifest.xml`, data: manifestXml },
      { path: `${submissionIdValue}/xml/submission.xml`, data: returnXml },
    ]),
  };
}

export function package941(f: Form941, employer: Employer, agent: ReportingAgent, depositor: "monthly" | "semiweekly", now = new Date()): MefPackage {
  const id = submissionId(agent.efin, now);
  const periodEnd = `${f.year}-${String(f.quarter * 3).padStart(2, "0")}-${f.quarter === 1 || f.quarter === 4 ? "31" : "30"}`;
  const periodBegin = `${f.year}-${String(f.quarter * 3 - 2).padStart(2, "0")}-01`;
  const ret = el(
    "Return",
    [
      returnHeader({ type: "941", periodEnd, employer, agent, timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z") }),
      el("ReturnData", [irs941Xml(f, depositor), depositor === "semiweekly" ? irs941ScheduleBXml(f, employer.ein) : undefined], {
        documentCnt: depositor === "semiweekly" ? "2" : "1",
      }),
    ],
    { xmlns: "http://www.irs.gov/efile", returnVersion: MEF_VERSIONS.quarterly941(f.quarter) },
  )!;
  return pack(id, manifest({ submissionId: id, efin: agent.efin, type: "941", taxYr: f.year, periodBegin, periodEnd, employerEin: employer.ein }), document(ret));
}

export function package940(f: Form940, employer: Employer, agent: ReportingAgent, now = new Date()): MefPackage {
  const id = submissionId(agent.efin, now);
  const ret = el(
    "Return",
    [
      returnHeader({ type: "940", periodEnd: `${f.year}-12-31`, employer, agent, timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z") }),
      el("ReturnData", [irs940Xml(f)], { documentCnt: "1" }),
    ],
    { xmlns: "http://www.irs.gov/efile", returnVersion: MEF_VERSIONS.annual940 },
  )!;
  return pack(id, manifest({ submissionId: id, efin: agent.efin, type: "940", taxYr: f.year, periodBegin: `${f.year}-01-01`, periodEnd: `${f.year}-12-31`, employerEin: employer.ein }), document(ret));
}
