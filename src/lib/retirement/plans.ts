/**
 * Retirement plan setup: plan types, employer contribution formulas, and the employee's election.
 * Pure data, no database: the app stores these on RetirementPlan / RetirementElection rows.
 */

export type PlanType = "401K" | "SAFE_HARBOR_401K" | "SIMPLE_IRA" | "STATE_AUTO_IRA";

export const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  "401K": "401(k)",
  SAFE_HARBOR_401K: "Safe harbor 401(k)",
  SIMPLE_IRA: "SIMPLE IRA",
  STATE_AUTO_IRA: "State retirement program (auto-IRA)",
};

/**
 * Match tiers stack in order: { rate: 1, upTo: 0.03 }, { rate: 0.5, upTo: 0.02 } means 100% of the
 * first 3% of pay the employee defers, then 50% of the next 2% (the basic safe harbor match).
 */
export interface MatchTier {
  rate: number;
  upTo: number;
}

export interface EmployerFormula {
  tiers: MatchTier[];
  /** Nonelective (profit sharing / safe harbor) percent of pay for every eligible employee, deferring or not. */
  nonelective: number;
}

export const EMPLOYER_PRESETS: Record<string, { label: string; formula: EmployerFormula; planTypes: PlanType[] }> = {
  none: { label: "No employer contribution", formula: { tiers: [], nonelective: 0 }, planTypes: ["401K", "STATE_AUTO_IRA"] },
  basic_safe_harbor: {
    label: "Basic safe harbor match: 100% of the first 3%, 50% of the next 2%",
    formula: { tiers: [{ rate: 1, upTo: 0.03 }, { rate: 0.5, upTo: 0.02 }], nonelective: 0 },
    planTypes: ["401K", "SAFE_HARBOR_401K"],
  },
  enhanced_safe_harbor: {
    label: "Enhanced safe harbor match: 100% of the first 4%",
    formula: { tiers: [{ rate: 1, upTo: 0.04 }], nonelective: 0 },
    planTypes: ["401K", "SAFE_HARBOR_401K"],
  },
  nonelective_3: {
    label: "Safe harbor nonelective: 3% of pay for everyone eligible",
    formula: { tiers: [], nonelective: 0.03 },
    planTypes: ["401K", "SAFE_HARBOR_401K"],
  },
  simple_match_3: { label: "SIMPLE match: 100% of the first 3%", formula: { tiers: [{ rate: 1, upTo: 0.03 }], nonelective: 0 }, planTypes: ["SIMPLE_IRA"] },
  simple_nonelective_2: { label: "SIMPLE nonelective: 2% of pay for everyone eligible", formula: { tiers: [], nonelective: 0.02 }, planTypes: ["SIMPLE_IRA"] },
  custom: { label: "Custom match", formula: { tiers: [], nonelective: 0 }, planTypes: ["401K"] },
};

export interface PlanConfig {
  id: string;
  type: PlanType;
  /** Plan allows Roth deferrals (401(k) only; state auto-IRAs are always Roth). */
  allowsRoth: boolean;
  /** Plan allows age-50+ catch-up contributions. */
  allowsCatchUp: boolean;
  employer: EmployerFormula;
  /** SIMPLE only: the employer qualifies for the higher "applicable" SIMPLE limits. */
  simpleApplicable?: boolean;
  /** Default deferral for people who have not chosen (auto-enrollment). 0 = no auto-enrollment. */
  autoEnrollRate: number;
  /** Days after hire before someone may contribute (state programs: the 30-day opt-out window). */
  eligibilityDays: number;
  eligibilityMinAge: number;
}

export type ElectionStatus = "ENROLLED" | "OPTED_OUT" | "NOT_ENROLLED";

export interface Election {
  status: ElectionStatus;
  /** Percent of gross, e.g. 0.05. */
  pretaxRate: number;
  rothRate: number;
  /** Flat dollars per paycheck, added to the percent. */
  pretaxFlatCents: number;
  rothFlatCents: number;
}

export const NO_ELECTION: Election = { status: "NOT_ENROLLED", pretaxRate: 0, rothRate: 0, pretaxFlatCents: 0, rothFlatCents: 0 };

/** Plan rules the law fixes no matter what was entered: state IRAs take no employer money and are Roth, SIMPLE IRAs are pre-tax here. */
export function normalizePlan(p: PlanConfig): PlanConfig {
  if (p.type === "STATE_AUTO_IRA") return { ...p, allowsRoth: true, employer: { tiers: [], nonelective: 0 } };
  if (p.type === "SIMPLE_IRA") return { ...p, allowsRoth: false };
  return p;
}
