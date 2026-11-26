import type { Cents } from "../money";
import { dollars } from "../money";
import type { Source } from "../tax-engine/types";
import type { Address } from "./w2";

export const NEC_2026: { reportingThreshold: Cents; backupWithholdingRate: number; source: Source } = {
  /** P.L. 119-21 (OBBBA) raised the IRC 6041 threshold from $600 to $2,000 for payments after 2025. */
  reportingThreshold: dollars(2_000),
  backupWithholdingRate: 0.24,
  source: {
    cite: "IRC 6041(a) as amended by P.L. 119-21 sec. 70433; IRS Instructions for Forms 1099-MISC and 1099-NEC (2026)",
    url: "https://www.irs.gov/instructions/i1099mec",
    readOn: "2026-11-26",
    verified: false,
    note: "Confirm the $2,000 threshold and its effective date in the 2026 instructions before year end.",
  },
};

export interface Contractor {
  id: string;
  tin: string;
  tinType: "ssn" | "ein";
  name: string;
  address: Address;
  /** State where the work was done, for boxes 5-7 and state reporting. */
  state?: string;
}

export interface ContractorPaymentRecord {
  contractorId: string;
  paidOn: string;
  amount: Cents;
  backupWithholding: Cents;
  stateTaxWithheld?: Cents;
}

export interface Form1099Nec {
  year: number;
  contractor: Contractor;
  box1_nonemployeeComp: Cents;
  box4_federalTaxWithheld: Cents;
  box5_stateTaxWithheld: Cents;
  box6_statePayerNumber: string;
  box7_stateIncome: Cents;
}

/** One 1099-NEC per contractor paid at least the threshold (or any amount with backup withholding). */
export function build1099Necs(
  contractors: Contractor[],
  payments: ContractorPaymentRecord[],
  year: number,
  statePayerNumbers: Record<string, string>,
): Form1099Nec[] {
  const out: Form1099Nec[] = [];
  for (const c of contractors) {
    const ps = payments.filter((p) => p.contractorId === c.id && p.paidOn.startsWith(`${year}-`));
    const total = ps.reduce((s, p) => s + p.amount, 0);
    const bw = ps.reduce((s, p) => s + p.backupWithholding, 0);
    if (total < NEC_2026.reportingThreshold && bw === 0) continue;
    out.push({
      year,
      contractor: c,
      box1_nonemployeeComp: total,
      box4_federalTaxWithheld: bw,
      box5_stateTaxWithheld: ps.reduce((s, p) => s + (p.stateTaxWithheld ?? 0), 0),
      box6_statePayerNumber: c.state ? (statePayerNumbers[c.state] ?? "") : "",
      box7_stateIncome: c.state ? total : 0,
    });
  }
  return out;
}

/**
 * IRIS (Information Returns Intake System) is the IRS replacement for FIRE. Small volumes can be
 * keyed or uploaded as CSV in the IRIS Taxpayer Portal; software filing uses the IRIS A2A XML
 * channel, which needs an IRIS Transmitter Control Code and passing communications tests. This CSV
 * is our internal export; map it onto the portal's current CSV template before uploading.
 */
export function necCsv(forms: Form1099Nec[]): string {
  const head = ["year", "recipient_tin_type", "recipient_tin", "recipient_name", "address", "city", "state", "zip", "box1", "box4", "box5", "box6", "box7"];
  const money = (c: Cents) => (c / 100).toFixed(2);
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = forms.map((f) =>
    [
      String(f.year),
      f.contractor.tinType.toUpperCase(),
      f.contractor.tin.replace(/\D/g, ""),
      f.contractor.name,
      [f.contractor.address.line1, f.contractor.address.line2].filter(Boolean).join(" "),
      f.contractor.address.city,
      f.contractor.address.state,
      f.contractor.address.zip,
      money(f.box1_nonemployeeComp),
      money(f.box4_federalTaxWithheld),
      money(f.box5_stateTaxWithheld),
      f.box6_statePayerNumber,
      money(f.box7_stateIncome),
    ].map(q).join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}
