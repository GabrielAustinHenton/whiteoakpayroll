import type { Cents } from "../money";
import type { Source } from "../tax-engine/types";
import type { Employer, Person, W2 } from "./w2";

/**
 * SSA EFW2 (Publication 42-007, Tax Year 2026) writer for Forms W-2/W-3 uploaded through
 * Business Services Online. Fixed 512-byte records: RA, RE, RW, (RS), RT, RF.
 */
export const EFW2_SOURCE: Source = {
  cite: "SSA Publication 42-007, EFW2 Specifications, Tax Year 2026 (11/12/2026)",
  url: "https://www.ssa.gov/employer/efw/26efw2.pdf",
  readOn: "2026-11-26",
  verified: false,
  note: "RA, RE (incl. new Signature PIN 319-328) and RW 1-489 positions match the 2026 spec summary. RT, RF and RS positions are from the prior-year layout. RO/RU (box 12 codes A/B split, J/K/L/P, TA/TP/TT) and the RW box 14b tipped occupation codes are not written yet. Validate every file with SSA AccuWage Online before upload.",
};

export class Rec {
  private buf: string[];
  constructor(id: string, length = 512) {
    this.buf = Array(length).fill(" ");
    this.alpha(1, 2, id);
  }
  /** Left-justified, blank-filled, uppercase. Positions are 1-based and inclusive, as in the spec. */
  alpha(start: number, end: number, v: string | undefined, keepCase = false) {
    const len = end - start + 1;
    const s = (keepCase ? (v ?? "") : (v ?? "").toUpperCase()).slice(0, len).padEnd(len, " ");
    for (let i = 0; i < len; i++) this.buf[start - 1 + i] = s[i];
    return this;
  }
  /** Right-justified, zero-filled, cents with no decimal point. */
  money(start: number, end: number, cents: Cents) {
    const len = end - start + 1;
    if (cents < 0) throw new Error(`Negative amount at ${start}`);
    const s = String(Math.round(cents));
    if (s.length > len) throw new Error(`Amount too large for ${start}-${end}`);
    return this.alpha(start, end, s.padStart(len, "0"));
  }
  /** Right-justified, blank-filled text (some state fields). */
  alphaRight(start: number, end: number, v: string | undefined) {
    const len = end - start + 1;
    return this.alpha(start, end, (v ?? "").toUpperCase().slice(-len).padStart(len, " "));
  }
  digits(start: number, end: number, v: string | number) {
    const len = end - start + 1;
    return this.alpha(start, end, String(v).replace(/\D/g, "").padStart(len, "0").slice(-len));
  }
  toString() {
    return this.buf.join("");
  }
}

const tin = (s: string) => s.replace(/\D/g, "");

export interface Efw2Options {
  year: number;
  /** BSO User ID of the person submitting. */
  bsoUserId: string;
  /** Submitter: White Oak Payroll as the filer for its clients, or the employer itself. */
  submitter: Employer;
  employerSignaturePin?: string;
  /** "98" in-house program. */
  softwareCode?: "98" | "99";
}

export function buildEfw2(opts: Efw2Options, employer: Employer, employees: { person: Person; w2: W2 }[]): string {
  const s = opts.submitter;
  const ra = new Rec("RA")
    .digits(3, 11, tin(s.ein))
    .alpha(12, 19, opts.bsoUserId)
    .alpha(36, 37, opts.softwareCode ?? "98")
    .alpha(38, 94, s.name)
    .alpha(95, 116, s.address.line2)
    .alpha(117, 138, s.address.line1)
    .alpha(139, 160, s.address.city)
    .alpha(161, 162, s.address.state)
    .alpha(163, 167, s.address.zip)
    .alpha(168, 171, s.address.zipExt)
    .alpha(217, 273, s.name)
    .alpha(274, 295, s.address.line2)
    .alpha(296, 317, s.address.line1)
    .alpha(318, 339, s.address.city)
    .alpha(340, 341, s.address.state)
    .alpha(342, 346, s.address.zip)
    .alpha(347, 350, s.address.zipExt)
    .alpha(396, 422, s.contact.name)
    .alpha(423, 437, s.contact.phone.replace(/\D/g, ""))
    .alpha(446, 485, s.contact.email, true)
    // Preparer code: S = service bureau (we prepare for the client), L = self-prepared.
    .alpha(500, 500, tin(s.ein) === tin(employer.ein) ? "L" : "S");

  const re = new Rec("RE")
    .digits(3, 6, opts.year)
    .digits(8, 16, tin(employer.ein))
    .alpha(26, 26, "0")
    .alpha(40, 96, employer.name)
    .alpha(97, 118, employer.address.line2)
    .alpha(119, 140, employer.address.line1)
    .alpha(141, 162, employer.address.city)
    .alpha(163, 164, employer.address.state)
    .alpha(165, 169, employer.address.zip)
    .alpha(170, 173, employer.address.zipExt)
    .alpha(174, 174, "N") // kind of employer: none of the special categories
    .alpha(219, 219, "R") // employment code: regular (Form 941)
    .alpha(221, 221, "0")
    .alpha(222, 248, employer.contact.name)
    .alpha(249, 263, employer.contact.phone.replace(/\D/g, ""))
    .alpha(279, 318, employer.contact.email, true)
    .alpha(319, 328, opts.employerSignaturePin);

  const lines = [ra.toString(), re.toString()];
  const t = { n: 0, box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box10: 0, d: 0, w: 0, aa: 0, dd: 0 };
  for (const { person: p, w2 } of employees) {
    const rw = new Rec("RW")
      .digits(3, 11, tin(p.ssn))
      .alpha(12, 26, p.firstName)
      .alpha(27, 41, p.middleName)
      .alpha(42, 61, p.lastName)
      .alpha(62, 65, p.suffix)
      .alpha(66, 87, p.address.line2)
      .alpha(88, 109, p.address.line1)
      .alpha(110, 131, p.address.city)
      .alpha(132, 133, p.address.state)
      .alpha(134, 138, p.address.zip)
      .alpha(139, 142, p.address.zipExt)
      .money(188, 198, w2.box1_wages)
      .money(199, 209, w2.box2_federalTax)
      .money(210, 220, w2.box3_ssWages)
      .money(221, 231, w2.box4_ssTax)
      .money(232, 242, w2.box5_medicareWages)
      .money(243, 253, w2.box6_medicareTax)
      .money(254, 264, w2.box7_ssTips)
      .money(276, 286, w2.box10_dependentCare)
      .money(287, 297, w2.box12.D ?? 0)
      .money(298, 308, 0)
      .money(309, 319, 0)
      .money(320, 330, 0)
      .money(331, 341, 0)
      .money(353, 363, 0)
      .money(364, 374, w2.box12.W ?? 0)
      .money(375, 385, 0)
      .money(386, 396, 0)
      .money(408, 418, 0)
      .money(419, 429, 0)
      .money(430, 440, 0)
      .money(441, 451, w2.box12.AA ?? 0)
      .money(452, 462, 0)
      .money(463, 473, w2.box12.DD ?? 0)
      .money(474, 484, 0)
      .alpha(486, 486, "0")
      .alpha(488, 488, w2.box13_retirementPlan ? "1" : "0")
      .alpha(489, 489, "0");
    lines.push(rw.toString());
    t.n++;
    t.box1 += w2.box1_wages;
    t.box2 += w2.box2_federalTax;
    t.box3 += w2.box3_ssWages;
    t.box4 += w2.box4_ssTax;
    t.box5 += w2.box5_medicareWages;
    t.box6 += w2.box6_medicareTax;
    t.box7 += w2.box7_ssTips;
    t.box10 += w2.box10_dependentCare;
    t.d += w2.box12.D ?? 0;
    t.w += w2.box12.W ?? 0;
    t.aa += w2.box12.AA ?? 0;
    t.dd += w2.box12.DD ?? 0;
  }

  const rt = new Rec("RT")
    .digits(3, 9, t.n)
    .money(10, 24, t.box1)
    .money(25, 39, t.box2)
    .money(40, 54, t.box3)
    .money(55, 69, t.box4)
    .money(70, 84, t.box5)
    .money(85, 99, t.box6)
    .money(100, 114, t.box7)
    .money(130, 144, t.box10)
    .money(145, 159, t.d)
    .money(160, 174, 0)
    .money(175, 189, 0)
    .money(190, 204, 0)
    .money(205, 219, 0)
    .money(235, 249, 0)
    .money(250, 264, t.w)
    .money(265, 279, 0)
    .money(280, 294, 0)
    .money(295, 309, 0)
    .money(310, 324, 0)
    .money(325, 339, 0)
    .money(340, 354, t.aa)
    .money(355, 369, 0)
    .money(370, 384, t.dd)
    .money(385, 399, 0);
  lines.push(rt.toString());
  lines.push(new Rec("RF").digits(8, 16, t.n).toString());

  for (const l of lines) if (l.length !== 512) throw new Error("EFW2 record length must be 512");
  return lines.join("\r\n") + "\r\n";
}
