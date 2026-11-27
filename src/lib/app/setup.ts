/**
 * The guided setup for a self-serve owner, in the order a first-time employer needs it.
 * Pure so it can be tested; the wizard page loads the facts.
 */

export type SetupStepId = "company" | "states" | "schedule" | "bank" | "people" | "payroll";

export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** Why it's needed, in one plain sentence. */
  why: string;
  done: boolean;
  /** Required before the first payroll can run. */
  required: boolean;
}

export interface SetupFacts {
  companyConfirmed: boolean;
  /** States where the company or its employees work. */
  workStates: string[];
  stateAccounts: string[];
  schedules: number;
  bank: boolean;
  people: number;
  paidRuns: number;
}

export function setupSteps(f: SetupFacts): SetupStep[] {
  const missingStates = f.workStates.filter((s) => !f.stateAccounts.includes(s));
  return [
    { id: "company", title: "Check your company details", why: "Your legal name, EIN and address go on every tax form and paystub.", done: f.companyConfirmed, required: true },
    {
      id: "states",
      title: "Add your state tax accounts",
      why: missingStates.length ? `We need your ${missingStates.join(", ")} withholding and unemployment accounts to withhold and file state taxes.` : "Your state withholding and unemployment accounts let us withhold and file state taxes.",
      done: f.stateAccounts.length > 0 && missingStates.length === 0,
      required: true,
    },
    { id: "schedule", title: "Choose how often you pay", why: "Your pay schedule sets every payday and pay period, and we check it against state pay-frequency rules.", done: f.schedules > 0, required: true },
    { id: "bank", title: "Connect the bank account payroll comes from", why: "Paychecks and taxes are drawn from this account a few days before each payday.", done: f.bank, required: true },
    { id: "people", title: "Add your team", why: "Add employees and contractors. Employees can fill in their own tax forms and bank details.", done: f.people > 0, required: true },
    { id: "payroll", title: "Run your first payroll", why: "Review every paycheck and the total cash needed, then approve.", done: f.paidRuns > 0, required: false },
  ];
}

/** The step to show: the one asked for, else the first one not done. */
export function currentStep(steps: SetupStep[], asked?: string): SetupStep {
  return steps.find((s) => s.id === asked) ?? steps.find((s) => !s.done) ?? steps[steps.length - 1];
}

export const setupReady = (steps: SetupStep[]) => steps.filter((s) => s.required).every((s) => s.done);
