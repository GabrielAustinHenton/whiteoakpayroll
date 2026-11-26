import type { Cents } from "../../money";
import type { Source } from "../../tax-engine/types";
import { Rec } from "../../filings/efw2";
import type { Form1099Nec } from "../../filings/form1099nec";
import type { Employer, Person, W2 } from "../../filings/w2";

export const CT_EFILE_SOURCE: Source = {
  cite: "CT DRS 2026 Form W-2 Record Specifications; 2026 Form 1099-R, 1099-MISC, 1099-K, 1099-NEC and W-2G Record Specifications; myconneCT TPBF page",
  url: "https://portal.ct.gov/drs/withholding-taxes/w2-electronic-filing-requirements/filing-requirements",
  readOn: "2026-11-26",
  verified: false,
  note: "Positions read from the 2026 specs, which are marked DRAFT. 1099-NEC amount codes follow IRS Pub. 1220 (1 = nonemployee compensation, 4 = federal withholding); confirm against the CT spec's table. CT-941, CT-W3 and CT-1096 CSV layouts are in .xlsx specs we could not read yet.",
};

/** File name required by DRS: CTTAX + 4-digit year. */
export const ctW2FileName = (year: number) => `CTTAX${year}.txt`;

/**
 * Connecticut W-2 file for myconneCT: RA, RE, RS (one per employee, CT wages only), RT, RF; 512
 * bytes per record with CR/LF. One file per CT Tax Registration Number. DRS needs 25+ W-2s with
 * CT wages to be filed electronically (fewer may be keyed or uploaded too). The CT-W3 is filed
 * after the upload to complete it.
 */
export function ctW2File(opts: { year: number; submitter: Employer; bsoOrUserId?: string; resubmission?: boolean }, employer: Employer, employees: { person: Person; w2: W2 }[]): string {
  const trn = (employer.stateIds.CT ?? "").replace(/\D/g, "");
  if (!trn) throw new Error("Employer has no CT Tax Registration Number");
  const s = opts.submitter;
  const lines: string[] = [];
  lines.push(
    new Rec("RA")
      .digits(3, 11, s.ein)
      .alpha(12, 19, opts.bsoOrUserId)
      .alpha(29, 29, opts.resubmission ? "1" : "0")
      .alpha(30, 35, opts.resubmission ? "AMEND" : "")
      .alpha(38, 94, s.name)
      .alpha(117, 138, s.address.line1)
      .alpha(139, 160, s.address.city)
      .alpha(161, 162, s.address.state)
      .alpha(163, 167, s.address.zip)
      .toString(),
  );
  lines.push(
    new Rec("RE")
      .digits(3, 6, opts.year)
      .digits(8, 16, employer.ein)
      .alpha(40, 96, employer.name)
      .alpha(119, 140, employer.address.line1)
      .alpha(141, 162, employer.address.city)
      .alpha(163, 164, employer.address.state)
      .alpha(165, 169, employer.address.zip)
      .alpha(221, 221, "0")
      .toString(),
  );
  let wages: Cents = 0;
  let tax: Cents = 0;
  let n = 0;
  for (const { person: p, w2 } of employees) {
    const ct = w2.states.find((x) => x.state === "CT");
    if (!ct) continue;
    n++;
    wages += ct.stateWages;
    tax += ct.stateTax;
    lines.push(
      new Rec("RS")
        .alpha(3, 4, "09")
        .digits(10, 18, p.ssn)
        .alpha(19, 33, p.firstName)
        .alpha(34, 48, p.middleName)
        .alpha(49, 68, p.lastName)
        .alpha(69, 72, p.suffix)
        .alpha(95, 116, p.address.line1)
        .alpha(117, 138, p.address.city)
        .alpha(139, 140, p.address.state)
        .alpha(141, 145, p.address.zip)
        .alpha(248, 267, trn)
        .alpha(274, 275, "09")
        .money(276, 286, ct.stateWages)
        .money(287, 297, ct.stateTax)
        .toString(),
    );
  }
  lines.push(new Rec("RT").digits(3, 9, n).money(10, 24, wages).money(25, 39, tax).toString());
  lines.push(new Rec("RF").digits(3, 11, n).money(12, 27, wages).money(28, 43, tax).toString());
  for (const l of lines) if (l.length !== 512) throw new Error("CT W-2 record must be 512 bytes");
  return lines.join("\r\n") + "\r\n";
}

/** 1099 amount fields 1-9, A-H, J occupy positions 55-270, 12 digits each. */
const AMOUNT_CODES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "J"];
const amountPos = (code: string) => {
  const i = AMOUNT_CODES.indexOf(code);
  return [55 + i * 12, 66 + i * 12] as const;
};

/**
 * Connecticut 1099-NEC file (750-byte T/A/B/C/F records based on IRS Pub. 1220). After uploading
 * W-2/1099 files a bulk filer also uploads the CT-1096 to complete the filing.
 */
export function ctNecFile(opts: { year: number; transmitter: Employer }, payer: Employer, forms: Form1099Nec[]): string {
  const trn = (payer.stateIds.CT ?? payer.ein).replace(/\D/g, "");
  const t = opts.transmitter;
  const ctForms = forms.filter((f) => f.contractor.state === "CT" || f.box6_statePayerNumber);
  const lines: string[] = [];
  lines.push(
    new Rec("T", 750)
      .digits(2, 5, opts.year)
      .digits(7, 15, t.ein)
      .alpha(30, 69, t.name)
      .alpha(110, 149, t.name)
      .alpha(190, 229, t.address.line1)
      .alpha(230, 269, t.address.city)
      .alpha(270, 271, t.address.state)
      .alpha(272, 280, t.address.zip)
      .digits(296, 303, ctForms.length)
      .toString(),
  );
  lines.push(
    new Rec("A", 750)
      .digits(2, 5, opts.year)
      .digits(12, 20, payer.ein)
      .alpha(26, 27, "NE")
      .alpha(28, 45, "14")
      .alpha(53, 92, payer.name)
      .alpha(216, 224, payer.address.zip + (payer.address.zipExt ?? ""))
      .toString(),
  );
  let comp = 0;
  let fed = 0;
  ctForms.forEach((f, i) => {
    comp += f.box1_nonemployeeComp;
    fed += f.box4_federalTaxWithheld;
    const [a1s, a1e] = amountPos("1");
    const [a4s, a4e] = amountPos("4");
    lines.push(
      new Rec("B", 750)
        .digits(2, 5, opts.year)
        .alpha(7, 10, f.contractor.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4))
        .alpha(11, 11, f.contractor.tinType === "ein" ? "1" : "2")
        .digits(12, 20, f.contractor.tin)
        .alpha(21, 40, f.contractor.id)
        .money(a1s, a1e, f.box1_nonemployeeComp)
        .money(a4s, a4e, f.box4_federalTaxWithheld)
        .alpha(288, 327, f.contractor.name)
        .alpha(368, 407, f.contractor.address.line1)
        .alpha(448, 487, f.contractor.address.city)
        .alpha(488, 489, f.contractor.address.state)
        .alpha(490, 498, f.contractor.address.zip + (f.contractor.address.zipExt ?? ""))
        .alphaRight(669, 722, trn)
        .money(723, 734, f.box5_stateTaxWithheld)
        .alpha(747, 748, "08")
        .toString(),
    );
    void i;
  });
  const c = new Rec("C", 750).digits(2, 9, ctForms.length);
  // Control totals: 18 characters per amount code starting at position 16.
  c.money(16, 33, comp).money(16 + 3 * 18, 33 + 3 * 18, fed);
  lines.push(c.toString());
  lines.push(new Rec("F", 750).digits(2, 9, 1).toString());
  for (const l of lines) if (l.length !== 750) throw new Error("CT 1099 record must be 750 bytes");
  return lines.join("\r\n") + "\r\n";
}
