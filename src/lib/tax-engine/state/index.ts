import { applyRate, type Cents } from "../../money";
import type { PayFrequency } from "../types";
import type { TaxLine } from "../paycheck";
import { underWageBase } from "../federal/fica-futa";
import { paidLeaveContribution } from "../../taxes/state-paid-leave";
import { ctWithholding, type CtW4 } from "./ct";
import { maWithholding, type MaW4 } from "./ma";
import { orWithholding, type OrW4 } from "./or";
import { nycWithholding, nysWithholding, yonkersWithholding, type NyIt2104 } from "./ny";
import { CT_SUI_2026 } from "../tables/2026/ct";
import { MA_SUI_2026 } from "../tables/2026/ma";
import { OR_OTHER_2026 } from "../tables/2026/or";
import { NY_OTHER_2026 } from "../tables/2026/ny";

export type LaunchState = "CT" | "MA" | "OR" | "NY";

export type StateCertificate =
  | { state: "CT"; w4: CtW4 }
  | { state: "MA"; w4: MaW4 }
  | { state: "OR"; w4: OrW4 }
  | { state: "NY"; w4: NyIt2104 };

/** Employer settings for one state account. */
export interface EmployerStateSettings {
  /** Assigned unemployment rate from the state's rate notice (for CT this already includes the 1.0% solvency rate). */
  suiRate: number;
  /** Employees in the state (or MA covered individuals), for paid leave and EMAC thresholds. */
  employerSize: number;
  /** Oregon: the work site is inside the TriMet or Lane Transit District. */
  orTransitDistrict?: "trimet" | "lane";
}

export interface StateInput {
  certificate: StateCertificate;
  frequency: PayFrequency;
  gross: Cents;
  /** Wages for state income tax after pre-tax deductions. */
  stateIncomeWages: Cents;
  /** Wages for unemployment and paid leave (FICA-style base). */
  suiWages: Cents;
  federalWithholding: Cents;
  ficaWithheld: Cents;
  employer: EmployerStateSettings;
  ytd: {
    suiWages: Cents;
    paidLeaveWages: Cents;
    paidLeaveEmployee: Cents;
    maFicaDeductionUsed?: Cents;
  };
}

const WEEKS: Record<PayFrequency, number> = {
  weekly: 1, biweekly: 2, semimonthly: 52 / 24, monthly: 52 / 12, quarterly: 13, semiannually: 26, annually: 52, daily: 1 / 5,
};

/** All state and local tax lines for one employee on one paycheck. */
export function stateLines(input: StateInput): TaxLine[] {
  const { certificate: c, employer } = input;
  const st = c.state;
  const lines: TaxLine[] = [];
  const add = (id: string, label: string, payer: "employee" | "employer", jurisdiction: string, taxableWages: Cents, amount: Cents) =>
    lines.push({ id, label, payer, jurisdiction, taxableWages, amount });

  // Income tax withholding.
  switch (c.state) {
    case "CT":
      add("ct_income", "Connecticut income tax", "employee", "CT", input.stateIncomeWages, ctWithholding(input.stateIncomeWages, input.frequency, c.w4));
      break;
    case "MA": {
      const r = maWithholding({
        wages: input.stateIncomeWages,
        frequency: input.frequency,
        w4: c.w4,
        ficaThisPeriod: input.ficaWithheld,
        ficaDeductionUsedBefore: input.ytd.maFicaDeductionUsed ?? 0,
      });
      add("ma_income", "Massachusetts income tax", "employee", "MA", input.stateIncomeWages, r.withholding);
      break;
    }
    case "OR":
      add("or_income", "Oregon income tax", "employee", "OR", input.stateIncomeWages, orWithholding({ wages: input.stateIncomeWages, frequency: input.frequency, w4: c.w4, federalWithholding: input.federalWithholding }));
      add("or_transit", "Oregon statewide transit tax", "employee", "OR", input.gross, applyRate(input.gross, OR_OTHER_2026.statewideTransitRate));
      if (employer.orTransitDistrict === "trimet")
        add("or_trimet", "TriMet transit payroll tax", "employer", "OR-TRIMET", input.gross, applyRate(input.gross, OR_OTHER_2026.triMetRate));
      if (employer.orTransitDistrict === "lane")
        add("or_lane_transit", "Lane Transit District payroll tax", "employer", "OR-LTD", input.gross, applyRate(input.gross, OR_OTHER_2026.laneTransitRate));
      break;
    case "NY": {
      const nys = nysWithholding(input.stateIncomeWages, input.frequency, c.w4);
      add("ny_income", "New York State income tax", "employee", "NY", input.stateIncomeWages, nys);
      if (c.w4.nycResident) add("nyc_income", "New York City income tax", "employee", "NY-NYC", input.stateIncomeWages, nycWithholding(input.stateIncomeWages, input.frequency, c.w4));
      const yk = yonkersWithholding(input.stateIncomeWages, nys, c.w4);
      if (c.w4.yonkersResident || c.w4.yonkersNonresidentWorker) add("yonkers_income", "Yonkers income tax", "employee", "NY-YONKERS", input.stateIncomeWages, yk);
      const dblMax = Math.round(NY_OTHER_2026.dblWeeklyMax * WEEKS[input.frequency]);
      add("ny_dbl", "NY disability (DBL)", "employee", "NY", input.gross, Math.min(applyRate(input.gross, NY_OTHER_2026.dblEmployeeRate), dblMax));
      break;
    }
  }

  // Unemployment insurance (employer-paid in all four launch states).
  const suiBase = { CT: CT_SUI_2026.wageBase, MA: MA_SUI_2026.wageBase, OR: OR_OTHER_2026.sui.wageBase, NY: NY_OTHER_2026.sui.wageBase }[st];
  const suiTaxable = underWageBase(input.suiWages, input.ytd.suiWages, suiBase);
  add(`${st.toLowerCase()}_sui`, `${st} unemployment insurance`, "employer", st, suiTaxable, applyRate(suiTaxable, employer.suiRate));
  if (st === "MA" && employer.employerSize >= MA_SUI_2026.emacMinEmployees)
    add("ma_emac", "MA Employer Medical Assistance Contribution", "employer", "MA", suiTaxable, applyRate(suiTaxable, MA_SUI_2026.emacRate));
  if (st === "NY")
    add("ny_rsf", "NY Re-employment Service Fund", "employer", "NY", suiTaxable, applyRate(suiTaxable, NY_OTHER_2026.reemploymentServiceFundRate));

  // Paid family and medical leave (rates in src/lib/taxes/state-paid-leave.ts).
  const pl = paidLeaveContribution({
    state: st,
    grossWages: input.suiWages,
    ytdWagesBefore: input.ytd.paidLeaveWages,
    ytdEmployeeContributionBefore: input.ytd.paidLeaveEmployee,
    employerSize: employer.employerSize,
  });
  add(`${st.toLowerCase()}_paid_leave`, pl.program, "employee", st, pl.taxableWages, pl.employee);
  if (pl.employer > 0) add(`${st.toLowerCase()}_paid_leave_er`, `${pl.program} (employer)`, "employer", st, pl.taxableWages, pl.employer);

  return lines;
}
