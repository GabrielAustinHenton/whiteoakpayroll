import type { Cents } from "../money";

/**
 * IRS retirement plan limits by year, in cents.
 *
 * 2026 sources:
 *   IR-2025-111 (irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500):
 *     402(g) $24,500; catch-up 50+ $8,000; ages 60-63 $11,250; IRA $7,500 + $1,100 catch-up;
 *     SIMPLE $17,000 ($18,100 applicable plans); SIMPLE catch-up $4,000 ($3,850 applicable), 60-63 $5,250.
 *   IRS Notice 2025-67 as summarized by Mercer (2026-retirement-plan-limits-now-set, Nov 14 2025):
 *     415(c) $72,000; 401(a)(17) $360,000; Roth catch-up wage threshold $150,000 (2025 FICA wages); HCE $160,000.
 * verified = read from the source above on 2026-11-27. Notice 2025-67 itself not read (secondary source).
 */
export interface RetirementLimits {
  year: number;
  /** 402(g): employee elective deferrals, pre-tax plus Roth, all 401(k)/403(b) plans combined. */
  electiveDeferral: Cents;
  /** 414(v) catch-up for age 50+ by year end. */
  catchUp50: Cents;
  /** SECURE 2.0 higher catch-up for those who turn 60, 61, 62 or 63 in the year. */
  catchUp60to63: Cents;
  simpleDeferral: Cents;
  /** Applicable SIMPLE plans: employers with 25 or fewer employees, or 26-100 that elect the higher contribution. */
  simpleDeferralApplicable: Cents;
  simpleCatchUp50: Cents;
  simpleCatchUp50Applicable: Cents;
  simpleCatchUp60to63: Cents;
  /** IRA contribution limit (state auto-IRAs are Roth IRAs) and its 50+ catch-up. */
  ira: Cents;
  iraCatchUp50: Cents;
  /** 415(c) annual additions (employee deferrals + employer money, excluding catch-ups). */
  annualAdditions: Cents;
  /** 401(a)(17): compensation the plan may count for matching and nonelective contributions. */
  compensation: Cents;
  /** 414(v)(7): prior-year FICA wages from this employer above which catch-ups must be Roth. */
  rothCatchUpWageThreshold: Cents;
  verified: boolean;
}

export const LIMITS: Record<number, RetirementLimits> = {
  2026: {
    year: 2026,
    electiveDeferral: 2_450_000,
    catchUp50: 800_000,
    catchUp60to63: 1_125_000,
    simpleDeferral: 1_700_000,
    simpleDeferralApplicable: 1_810_000,
    simpleCatchUp50: 400_000,
    simpleCatchUp50Applicable: 385_000,
    simpleCatchUp60to63: 525_000,
    ira: 750_000,
    iraCatchUp50: 110_000,
    annualAdditions: 7_200_000,
    compensation: 36_000_000,
    rothCatchUpWageThreshold: 15_000_000,
    verified: true,
  },
};

/** Limits for a year. Later years fall back to the newest table we have, flagged unverified. */
export function limitsFor(year: number): RetirementLimits {
  if (LIMITS[year]) return LIMITS[year];
  const newest = Math.max(...Object.keys(LIMITS).map(Number));
  return { ...LIMITS[newest], year, verified: false };
}

/** Age the person reaches by December 31 of the year. Catch-up eligibility uses age at year end. */
export function ageAtYearEnd(birthDate: string, year: number): number {
  return year - Number(birthDate.slice(0, 4));
}

/** The catch-up a person may make this year (0 under 50). */
export function catchUpLimit(kind: "401k" | "simple" | "ira", age: number, l: RetirementLimits, applicableSimple = false): Cents {
  if (age < 50) return 0;
  if (kind === "ira") return l.iraCatchUp50;
  const superCatchUp = age >= 60 && age <= 63;
  if (kind === "simple") return superCatchUp ? l.simpleCatchUp60to63 : applicableSimple ? l.simpleCatchUp50Applicable : l.simpleCatchUp50;
  return superCatchUp ? l.catchUp60to63 : l.catchUp50;
}
