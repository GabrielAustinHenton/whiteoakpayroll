import type { Cents } from "../../money";
import { PAY_PERIODS, roundCents, type PayFrequency } from "../types";
import { MA_2026 } from "../tables/2026/ma";

export interface MaW4 {
  /** Total exemptions from Form M-4, as the employee entered them. */
  exemptions: number;
  headOfHousehold?: boolean;
  /** Number of blind people claimed (employee and/or spouse), 0-2. */
  blind?: number;
  /** Full-time student with annual earnings of $8,000 or less: not subject to withholding. */
  fullTimeStudentUnder8k?: boolean;
  additional?: Cents;
  exempt?: boolean;
}

export function maAnnualExemption(n: number): Cents {
  const t = MA_2026;
  if (n <= 0) return 0;
  if (n === 1) return t.exemptionOne;
  return t.exemptionPer * n + t.exemptionPlus;
}

export interface MaInput {
  wages: Cents;
  frequency: PayFrequency;
  w4: MaW4;
  /** Social Security + Medicare (and MA/US retirement) withheld this period. */
  ficaThisPeriod: Cents;
  /** Of the $2,000 annual FICA deduction, the part already used this year. */
  ficaDeductionUsedBefore: Cents;
}

export interface MaResult {
  withholding: Cents;
  /** FICA deduction taken this period, to add to the YTD tracker. */
  ficaDeductionUsed: Cents;
}

/** Massachusetts withholding by the Circular M percentage method. */
export function maWithholding(input: MaInput): MaResult {
  const t = MA_2026;
  const { w4 } = input;
  const periods = PAY_PERIODS[input.frequency];
  const ficaDeduction = Math.max(0, Math.min(input.ficaThisPeriod, t.ficaDeductionCap - input.ficaDeductionUsedBefore));
  if (w4.exempt || w4.fullTimeStudentUnder8k) return { withholding: 0, ficaDeductionUsed: ficaDeduction };

  const annualWages = input.wages * periods;
  if (w4.exemptions >= 1 && annualWages <= t.noWithholdingFloor) return { withholding: 0, ficaDeductionUsed: ficaDeduction };

  const annualTaxable = Math.max(0, (input.wages - ficaDeduction) * periods - maAnnualExemption(w4.exemptions));
  const surtaxBase = Math.max(0, annualTaxable - t.surtaxThreshold);
  let annualTax = annualTaxable * t.rate + surtaxBase * t.surtaxRate;
  if (w4.headOfHousehold) annualTax -= t.headOfHouseholdCredit;
  annualTax -= (w4.blind ?? 0) * t.blindCredit;
  const perPeriod = Math.max(0, roundCents(annualTax / periods));
  return { withholding: perPeriod + (w4.additional ?? 0), ficaDeductionUsed: ficaDeduction };
}
