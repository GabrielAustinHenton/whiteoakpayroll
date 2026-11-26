import type { Cents } from "../money";
import { byEmployee, inYear, sumDeductions, sumLines, type PaycheckRecord } from "./records";

export interface Person {
  ssn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  address: Address;
}

export interface Address {
  line1: string;
  /** Delivery address (street). EFW2 calls line1 the "location address" (suite, attention). */
  line2?: string;
  city: string;
  state: string;
  zip: string;
  zipExt?: string;
}

export interface Employer {
  ein: string;
  name: string;
  address: Address;
  contact: { name: string; phone: string; email: string };
  /** State withholding account numbers by state. */
  stateIds: Record<string, string>;
}

export interface W2StateBox {
  state: string;
  stateId: string;
  /** Box 16 */
  stateWages: Cents;
  /** Box 17 */
  stateTax: Cents;
}

export interface W2LocalBox {
  locality: string;
  /** Box 18 */
  localWages: Cents;
  /** Box 19 */
  localTax: Cents;
}

export interface W2 {
  year: number;
  employeeId: string;
  box1_wages: Cents;
  box2_federalTax: Cents;
  box3_ssWages: Cents;
  box4_ssTax: Cents;
  box5_medicareWages: Cents;
  /** Box 6 includes Additional Medicare Tax withheld. */
  box6_medicareTax: Cents;
  box7_ssTips: Cents;
  box10_dependentCare: Cents;
  box12: Partial<Record<"D" | "W" | "AA" | "DD", Cents>>;
  box13_retirementPlan: boolean;
  /** Box 14 other: e.g. "CT PFL", "NY PFL", "NY DBL", "OR STT". */
  box14: Record<string, Cents>;
  states: W2StateBox[];
  locals: W2LocalBox[];
}

const STATE_INCOME_IDS: Record<string, string> = { CT: "ct_income", MA: "ma_income", OR: "or_income", NY: "ny_income" };
const LOCAL_IDS: Record<string, string> = { "NY-NYC": "nyc_income", "NY-YONKERS": "yonkers_income" };
const BOX14: Record<string, string> = {
  ct_paid_leave: "CT PFL",
  ma_paid_leave: "MA PFML",
  or_paid_leave: "OR PLO",
  ny_paid_leave: "NY PFL",
  ny_dbl: "NY SDI",
  or_transit: "OR STT",
};

/** Build each employee's W-2 for a year from their paid paychecks. */
export function buildW2s(all: PaycheckRecord[], year: number, employer: Employer): W2[] {
  const out: W2[] = [];
  for (const [employeeId, recs] of byEmployee(inYear(all, year))) {
    const states: W2StateBox[] = [];
    for (const [st, id] of Object.entries(STATE_INCOME_IDS)) {
      const wages = sumLines(recs, id, "taxableWages");
      const tax = sumLines(recs, id);
      if (wages || tax) states.push({ state: st, stateId: employer.stateIds[st] ?? "", stateWages: wages, stateTax: tax });
    }
    const locals: W2LocalBox[] = [];
    for (const [loc, id] of Object.entries(LOCAL_IDS)) {
      const wages = sumLines(recs, id, "taxableWages");
      const tax = sumLines(recs, id);
      if (wages || tax) locals.push({ locality: loc === "NY-NYC" ? "NYC" : "YONKERS", localWages: wages, localTax: tax });
    }
    const box14: Record<string, Cents> = {};
    for (const [id, label] of Object.entries(BOX14)) {
      const v = sumLines(recs, id);
      if (v) box14[label] = v;
    }
    const d = sumDeductions(recs, "retirement_pretax");
    const aa = sumDeductions(recs, "retirement_roth");
    const w = sumDeductions(recs, "hsa_section125");
    const box12: W2["box12"] = {};
    if (d) box12.D = d;
    if (aa) box12.AA = aa;
    if (w) box12.W = w;
    out.push({
      year,
      employeeId,
      box1_wages: sumLines(recs, "federal_income", "taxableWages"),
      box2_federalTax: sumLines(recs, "federal_income"),
      box3_ssWages: sumLines(recs, "social_security", "taxableWages"),
      box4_ssTax: sumLines(recs, "social_security"),
      box5_medicareWages: sumLines(recs, "medicare", "taxableWages"),
      box6_medicareTax: sumLines(recs, "medicare") + sumLines(recs, "additional_medicare"),
      box7_ssTips: 0,
      box10_dependentCare: sumDeductions(recs, "dependent_care_fsa"),
      box12,
      box13_retirementPlan: d + aa > 0,
      box14,
      states,
      locals,
    });
  }
  return out;
}

/** Form W-3 totals. */
export function w3Totals(w2s: W2[]) {
  const t = { count: w2s.length, box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box10: 0, box12D: 0, box12W: 0, box12AA: 0 };
  for (const w of w2s) {
    t.box1 += w.box1_wages;
    t.box2 += w.box2_federalTax;
    t.box3 += w.box3_ssWages;
    t.box4 += w.box4_ssTax;
    t.box5 += w.box5_medicareWages;
    t.box6 += w.box6_medicareTax;
    t.box7 += w.box7_ssTips;
    t.box10 += w.box10_dependentCare;
    t.box12D += w.box12.D ?? 0;
    t.box12W += w.box12.W ?? 0;
    t.box12AA += w.box12.AA ?? 0;
  }
  return t;
}
