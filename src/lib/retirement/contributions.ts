import type { Cents } from "../money";
import type { Deduction, DeductionKind } from "../tax-engine/deductions";
import { ageAtYearEnd, catchUpLimit, limitsFor } from "./limits";
import { normalizePlan, type Election, type PlanConfig } from "./plans";

/**
 * One paycheck's retirement contributions: employee deferrals (with the IRS limits applied using
 * year-to-date amounts) and the employer's match or nonelective contribution.
 *
 * Simplifications, stated so nobody relies on them silently:
 * - The match is figured per paycheck with no year-end true-up.
 * - The 402(g) limit is applied per employer; we cannot see deferrals at another job.
 * - Roth catch-up (414(v)(7)) uses prior-year FICA wages from this employer, entered or computed.
 */

/** What we store on the pay run line under detail.retirement. */
export interface RetirementLine {
  planId: string;
  planType: PlanConfig["type"];
  /** Regular deferrals (within 402(g), the SIMPLE limit, or the IRA limit). */
  pretax: Cents;
  roth: Cents;
  /** Catch-up deferrals above the regular limit. */
  catchUpPretax: Cents;
  catchUpRoth: Cents;
  employerMatch: Cents;
  employerNonelective: Cents;
  /** Pay the plan counted for the employer contribution (capped at 401(a)(17) for the year). */
  planComp: Cents;
  autoEnrolled: boolean;
  notes: string[];
}

export interface RetirementYtd {
  /** Regular (non catch-up) deferrals so far this year, pre-tax plus Roth. */
  deferral: Cents;
  catchUp: Cents;
  employer: Cents;
  planComp: Cents;
}

export const ZERO_YTD: RetirementYtd = { deferral: 0, catchUp: 0, employer: 0, planComp: 0 };

export interface RetirementInput {
  plan: PlanConfig;
  election: Election;
  gross: Cents;
  /** YYYY-MM-DD */
  payday: string;
  /** YYYY-MM-DD, or "" when not entered yet. */
  birthDate: string;
  hireDate: string;
  ytd: RetirementYtd;
  /** Prior-year FICA wages paid by this employer (Roth catch-up rule). */
  priorYearFicaWages: Cents;
}

export function totalEmployee(l: RetirementLine): Cents {
  return l.pretax + l.roth + l.catchUpPretax + l.catchUpRoth;
}
export function totalEmployer(l: RetirementLine): Cents {
  return l.employerMatch + l.employerNonelective;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** First date someone may contribute: after the service wait and once they reach the minimum age. */
export function eligibleFrom(plan: PlanConfig, birthDate: string, hireDate: string): string {
  const byService = addDays(hireDate, plan.eligibilityDays);
  // Birth date not entered yet (self-onboarding): only the service wait applies.
  if (!birthDate) return byService;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const byAge = `${String(by + plan.eligibilityMinAge).padStart(4, "0")}-${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}`;
  return byService > byAge ? byService : byAge;
}

/** Employer match on this check: tiers applied to the deferral as a share of plan pay. */
export function matchFor(tiers: PlanConfig["employer"]["tiers"], deferral: Cents, planComp: Cents): Cents {
  if (planComp <= 0 || deferral <= 0) return 0;
  let remaining = deferral / planComp;
  let match = 0;
  for (const t of tiers) {
    const slice = Math.min(remaining, t.upTo);
    if (slice <= 0) break;
    match += slice * t.rate;
    remaining -= slice;
  }
  return Math.round(match * planComp);
}

export function retirementForPaycheck(input: RetirementInput): { line: RetirementLine; deductions: Deduction[] } {
  const plan = normalizePlan(input.plan);
  const year = Number(input.payday.slice(0, 4));
  const lim = limitsFor(year);
  const notes: string[] = [];
  const line: RetirementLine = {
    planId: plan.id,
    planType: plan.type,
    pretax: 0,
    roth: 0,
    catchUpPretax: 0,
    catchUpRoth: 0,
    employerMatch: 0,
    employerNonelective: 0,
    planComp: 0,
    autoEnrolled: false,
    notes,
  };
  const gross = Math.max(0, input.gross);
  const from = eligibleFrom(plan, input.birthDate, input.hireDate);
  if (input.payday < from) {
    notes.push(`Not eligible for the plan until ${from}.`);
    return { line, deductions: [] };
  }

  // What the employee asked for (or the plan's default for people who have not chosen).
  let e: Election = input.election;
  if (e.status === "OPTED_OUT") {
    notes.push("Opted out.");
  } else if (e.status === "NOT_ENROLLED" && plan.autoEnrollRate > 0) {
    e = { ...e, pretaxRate: plan.type === "STATE_AUTO_IRA" ? 0 : plan.autoEnrollRate, rothRate: plan.type === "STATE_AUTO_IRA" ? plan.autoEnrollRate : 0, pretaxFlatCents: 0, rothFlatCents: 0 };
    line.autoEnrolled = true;
    notes.push(`Auto-enrolled at the plan default of ${(plan.autoEnrollRate * 100).toFixed(1).replace(/\.0$/, "")}%.`);
  } else if (e.status === "NOT_ENROLLED") {
    e = { ...e, pretaxRate: 0, rothRate: 0, pretaxFlatCents: 0, rothFlatCents: 0 };
  }
  let wantPretax = e.status === "OPTED_OUT" ? 0 : Math.round(gross * e.pretaxRate) + e.pretaxFlatCents;
  let wantRoth = e.status === "OPTED_OUT" ? 0 : Math.round(gross * e.rothRate) + e.rothFlatCents;
  if (plan.type === "STATE_AUTO_IRA") {
    // State programs are Roth IRAs: every dollar is after tax.
    wantRoth += wantPretax;
    wantPretax = 0;
  } else if (!plan.allowsRoth && wantRoth > 0) {
    notes.push("This plan does not allow Roth; the Roth election was taken as pre-tax.");
    wantPretax += wantRoth;
    wantRoth = 0;
  }
  // Never more than the paycheck.
  if (wantPretax + wantRoth > gross) {
    const scale = gross / (wantPretax + wantRoth);
    wantPretax = Math.floor(wantPretax * scale);
    wantRoth = Math.floor(wantRoth * scale);
  }

  // Unknown birth date: no catch-up until it is entered.
  const age = input.birthDate ? ageAtYearEnd(input.birthDate, year) : 0;
  const kind = plan.type === "SIMPLE_IRA" ? "simple" : plan.type === "STATE_AUTO_IRA" ? "ira" : "401k";
  const regularLimit = kind === "simple" ? (plan.simpleApplicable ? lim.simpleDeferralApplicable : lim.simpleDeferral) : kind === "ira" ? lim.ira : lim.electiveDeferral;
  const catchUpCap = plan.allowsCatchUp || kind === "ira" ? catchUpLimit(kind, age, lim, plan.simpleApplicable) : 0;

  let regularRoom = Math.max(0, regularLimit - input.ytd.deferral);
  let catchUpRoom = Math.max(0, catchUpCap - input.ytd.catchUp);
  // 414(v)(7): high earners' 401(k) catch-ups must be Roth (SIMPLE and IRA are exempt).
  const rothOnlyCatchUp = kind === "401k" && input.priorYearFicaWages > lim.rothCatchUpWageThreshold;

  line.pretax = Math.min(wantPretax, regularRoom);
  regularRoom -= line.pretax;
  line.roth = Math.min(wantRoth, regularRoom);
  regularRoom -= line.roth;
  let overPretax = wantPretax - line.pretax;
  let overRoth = wantRoth - line.roth;

  if (overPretax + overRoth > 0 && catchUpRoom > 0) {
    if (kind === "ira") {
      line.catchUpRoth = Math.min(overRoth, catchUpRoom);
      overRoth -= line.catchUpRoth;
    } else if (rothOnlyCatchUp) {
      if (plan.allowsRoth) {
        line.catchUpRoth = Math.min(overPretax + overRoth, catchUpRoom);
        notes.push("Catch-up made as Roth: last year's wages here were over the Roth catch-up threshold.");
      } else {
        notes.push("No catch-up: last year's wages here were over the Roth catch-up threshold and the plan has no Roth option.");
      }
      overPretax = overRoth = 0;
    } else {
      line.catchUpPretax = Math.min(overPretax, catchUpRoom);
      catchUpRoom -= line.catchUpPretax;
      line.catchUpRoth = Math.min(overRoth, catchUpRoom);
      overPretax -= line.catchUpPretax;
      overRoth -= line.catchUpRoth;
    }
  }
  if (overPretax + overRoth > 0) notes.push("Stopped at the IRS annual limit for this year.");

  // Employer money: none for state auto-IRAs or for people who are not eligible.
  if (plan.type !== "STATE_AUTO_IRA") {
    line.planComp = Math.max(0, Math.min(gross, lim.compensation - input.ytd.planComp));
    const deferral = totalEmployee(line);
    let match = matchFor(plan.employer.tiers, deferral, line.planComp);
    let nonelective = Math.round(line.planComp * plan.employer.nonelective);
    if (kind === "401k") {
      // 415(c): employee regular deferrals plus employer money; catch-ups do not count.
      const room = Math.max(0, lim.annualAdditions - input.ytd.deferral - input.ytd.employer - line.pretax - line.roth);
      if (match + nonelective > room) {
        notes.push("Employer contribution reduced to stay within the 415(c) annual additions limit.");
        const over = match + nonelective - room;
        const fromNonelective = Math.min(nonelective, over);
        nonelective -= fromNonelective;
        match -= over - fromNonelective;
      }
    }
    line.employerMatch = match;
    line.employerNonelective = nonelective;
  }

  const deductions: Deduction[] = [];
  const pretaxKind: DeductionKind = plan.type === "SIMPLE_IRA" ? "simple_ira" : "retirement_pretax";
  const rothKind: DeductionKind = plan.type === "STATE_AUTO_IRA" ? "state_auto_ira" : "retirement_roth";
  if (line.pretax + line.catchUpPretax > 0) deductions.push({ kind: pretaxKind, amount: line.pretax + line.catchUpPretax });
  if (line.roth + line.catchUpRoth > 0) deductions.push({ kind: rothKind, amount: line.roth + line.catchUpRoth });
  return { line, deductions };
}

/** Year-to-date retirement figures from earlier paychecks' stored detail. */
export function retirementYtd(prior: { retirement?: RetirementLine; deductionDetail?: Deduction[] }[]): RetirementYtd {
  const out = { ...ZERO_YTD };
  for (const p of prior) {
    if (p.retirement) {
      out.deferral += p.retirement.pretax + p.retirement.roth;
      out.catchUp += p.retirement.catchUpPretax + p.retirement.catchUpRoth;
      out.employer += totalEmployer(p.retirement);
      out.planComp += p.retirement.planComp;
    } else {
      // Paychecks from before a plan was set up in White Oak: the old flat 401(k) percent.
      for (const d of p.deductionDetail ?? []) if (d.kind === "retirement_pretax" || d.kind === "retirement_roth" || d.kind === "simple_ira") out.deferral += d.amount;
    }
  }
  return out;
}
