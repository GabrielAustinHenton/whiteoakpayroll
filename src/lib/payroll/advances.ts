import type { Cents } from "../money";
import type { LaunchState } from "./schedules";

/**
 * Payday advances: employer-funded, zero interest, no fee, repaid by a fixed deduction on each pay run.
 * Zero interest keeps these outside Connecticut's Small Loan Act (APR above 12%), per PA 25-155.
 * Other launch states restrict loan deductions and stay disabled until counsel signs off.
 */
export const ADVANCE_ENABLED_STATES: ReadonlySet<LaunchState> = new Set(["CT"]);

export interface Advance {
  principal: Cents;
  /** Fixed amount deducted each pay run. */
  installment: Cents;
  repaid: Cents;
  /** Employee's signed authorization is on file (CGS 31-71e requires a commissioner-approved form). */
  authorizationOnFile: boolean;
}

export function remainingBalance(a: Advance): Cents {
  return Math.max(0, a.principal - a.repaid);
}

export function installmentCount(principal: Cents, installment: Cents): number {
  if (installment <= 0) throw new Error("installment must be positive");
  return Math.ceil(principal / installment);
}

export interface DeductionInput {
  advance: Advance;
  /** Net pay after taxes and all other deductions, before the advance deduction. */
  netPayBefore: Cents;
  /** Minimum wage owed for hours in this period (hours x state minimum wage). */
  minimumWageFloor: Cents;
}

/**
 * The advance deduction for one pay run: the installment, capped by the balance,
 * and never taking pay below the minimum wage floor.
 */
export function advanceDeduction({ advance, netPayBefore, minimumWageFloor }: DeductionInput): Cents {
  if (!advance.authorizationOnFile) return 0;
  const headroom = Math.max(0, netPayBefore - minimumWageFloor);
  return Math.min(advance.installment, remainingBalance(advance), headroom);
}

export function canOfferAdvance(state: LaunchState): boolean {
  return ADVANCE_ENABLED_STATES.has(state);
}
