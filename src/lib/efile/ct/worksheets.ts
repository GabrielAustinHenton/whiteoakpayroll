import { usd } from "../xml";
import type { CT941, CTW3 } from "../../filings/state-returns";
import type { Form1099Nec } from "../../filings/form1099nec";

/**
 * myconneCT accepts CT-941, CT-W3 and CT-1096 from bulk filers as CSV uploads, but the column
 * layouts are published as .xlsx specs we have not been able to read yet. Until they are wired in,
 * we produce a keying worksheet with each line labelled as on the form, so the return can be
 * entered in myconneCT by hand (a few minutes per client) and the worksheet archived with it.
 */
function sheet(title: string, rows: [string, string][]): string {
  const w = Math.max(...rows.map(([k]) => k.length));
  return [title, "=".repeat(title.length), ...rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`), ""].join("\n");
}

export function ct941Worksheet(f: CT941, employer: { name: string; ctTrn: string }): string {
  return sheet(`CT-941 ${f.year} Q${f.quarter}: ${employer.name} (CT TRN ${employer.ctTrn})`, [
    ["Line 1 Gross wages", usd(f.line1_grossWages)],
    ["Line 2 Gross Connecticut wages", usd(f.line2_ctWages)],
    ["Line 3 CT income tax withheld", usd(f.line3_ctTaxWithheld)],
    ["Line 5 Payments made for the quarter", usd(f.line5_payments)],
    ["Line 8 Balance due", usd(f.line8_balanceDue)],
    ["Line 9 Overpayment", usd(f.line9_overpayment)],
  ]);
}

export function ctW3Worksheet(f: CTW3, employer: { name: string; ctTrn: string }): string {
  return sheet(`CT-W3 ${f.year}: ${employer.name} (CT TRN ${employer.ctTrn})`, [
    ["Number of W-2s", String(f.w2Count)],
    ["Number of 1099s with CT withholding", String(f.form1099Count)],
    ["Line 1 Gross CT wages", usd(f.line1_grossCtWages)],
    ["Line 2 CT tax withheld (W-2)", usd(f.line2_ctTaxWithheldW2)],
    ["Line 3 CT tax withheld (1099)", usd(f.line3_ctTaxWithheld1099)],
    ["Line 4 Total CT tax withheld", usd(f.line4_totalCtTaxWithheld)],
    ["Line 5 Paid for the year", usd(f.line5_paidForYear)],
    ["Line 6 Balance due", usd(f.line6_balanceDue)],
    ["Line 7 Overpayment", usd(f.line7_overpayment)],
  ]);
}

/** CT-1096, Connecticut Annual Summary and Transmittal of Information Returns. */
export function ct1096Worksheet(forms: Form1099Nec[], year: number, payer: { name: string; ctTrn: string }): string {
  const ct = forms.filter((f) => f.contractor.state === "CT");
  return sheet(`CT-1096 ${year}: ${payer.name} (CT TRN ${payer.ctTrn})`, [
    ["Form type", "1099-NEC"],
    ["Number of forms (CT payees)", String(ct.length)],
    ["Total CT income reported", usd(ct.reduce((s, f) => s + f.box7_stateIncome, 0))],
    ["Total CT tax withheld", usd(ct.reduce((s, f) => s + f.box5_stateTaxWithheld, 0))],
  ]);
}
