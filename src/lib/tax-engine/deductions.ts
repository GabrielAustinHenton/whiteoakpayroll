import type { Cents } from "../money";

/**
 * Pre-tax and post-tax deductions and which wage bases they reduce.
 *
 * Federal treatment: IRS Pub. 15-B (cafeteria plans, HSAs) and Pub. 15 section 5 (401(k) elective
 * deferrals are exempt from income tax withholding but subject to FICA and FUTA). State treatment
 * is filled in per state in the state modules; the launch states all follow the federal income tax
 * treatment for these items (Oregon confirmed in ODR 150-206-436 FAQ 5-6; CT, MA, NY to verify).
 */
export type DeductionKind =
  /** Traditional 401(k)/403(b)/457(b) elective deferral. */
  | "retirement_pretax"
  /** Roth 401(k), and state auto-IRAs (MyCTSavings, OregonSaves), which are Roth IRAs: after tax. */
  | "retirement_roth"
  /** SIMPLE IRA salary reduction (408(p)): pre-tax like a 401(k); W-2 box 12 code S. */
  | "simple_ira"
  | "state_auto_ira"
  /** Section 125 cafeteria plan: health, dental, vision premiums. */
  | "section125_health"
  /** HSA contributions through a cafeteria plan. */
  | "hsa_section125"
  /** Dependent care FSA (section 129 via 125). */
  | "dependent_care_fsa"
  /** Qualified transportation fringe (section 132(f)). */
  | "commuter_pretax"
  | "advance_repayment"
  | "garnishment"
  | "other_posttax";

export interface Deduction {
  kind: DeductionKind;
  amount: Cents;
}

export interface WageBaseFlags {
  /** Reduces wages for federal income tax withholding. */
  federalIncome: boolean;
  /** Reduces wages for Social Security and Medicare. */
  fica: boolean;
  /** Reduces wages for FUTA. */
  futa: boolean;
  /** Reduces wages for state income tax (launch states follow federal; override per state if not). */
  stateIncome: boolean;
}

export const DEDUCTION_TREATMENT: Record<DeductionKind, WageBaseFlags> = {
  retirement_pretax: { federalIncome: true, fica: false, futa: false, stateIncome: true },
  simple_ira: { federalIncome: true, fica: false, futa: false, stateIncome: true },
  retirement_roth: { federalIncome: false, fica: false, futa: false, stateIncome: false },
  state_auto_ira: { federalIncome: false, fica: false, futa: false, stateIncome: false },
  section125_health: { federalIncome: true, fica: true, futa: true, stateIncome: true },
  hsa_section125: { federalIncome: true, fica: true, futa: true, stateIncome: true },
  dependent_care_fsa: { federalIncome: true, fica: true, futa: true, stateIncome: true },
  commuter_pretax: { federalIncome: true, fica: true, futa: true, stateIncome: true },
  advance_repayment: { federalIncome: false, fica: false, futa: false, stateIncome: false },
  garnishment: { federalIncome: false, fica: false, futa: false, stateIncome: false },
  other_posttax: { federalIncome: false, fica: false, futa: false, stateIncome: false },
};

export interface TaxableWages {
  gross: Cents;
  federalIncome: Cents;
  fica: Cents;
  futa: Cents;
  stateIncome: Cents;
  /** Sum of deductions taken before tax for at least one base. */
  pretaxTotal: Cents;
  posttaxTotal: Cents;
}

/** Gross wages less the deductions that reduce each base. Bases never go below zero. */
export function taxableWages(gross: Cents, deductions: Deduction[]): TaxableWages {
  const out: TaxableWages = { gross, federalIncome: gross, fica: gross, futa: gross, stateIncome: gross, pretaxTotal: 0, posttaxTotal: 0 };
  for (const d of deductions) {
    const f = DEDUCTION_TREATMENT[d.kind];
    if (f.federalIncome) out.federalIncome -= d.amount;
    if (f.fica) out.fica -= d.amount;
    if (f.futa) out.futa -= d.amount;
    if (f.stateIncome) out.stateIncome -= d.amount;
    if (f.federalIncome || f.fica || f.futa || f.stateIncome) out.pretaxTotal += d.amount;
    else out.posttaxTotal += d.amount;
  }
  for (const k of ["federalIncome", "fica", "futa", "stateIncome"] as const) out[k] = Math.max(0, out[k]);
  return out;
}
