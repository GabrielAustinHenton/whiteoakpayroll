import { exemptExpires, i9Deadlines, i9RetainUntil, w4Step3Total, FORM_VERSIONS, STATE_FORM_NAME, type FormW4_2026 } from "../onboarding";
import type { LaunchState } from "../tax-engine/state";

/**
 * Turns what Client HR enters on the employee form into onboarding records: a versioned W-4 and
 * state certificate (kept for audits), and the I-9 dates. Pure functions; the server actions save them.
 */

export const W4_FORM_YEAR = 2026;

export interface W4Entry {
  filingStatus: string;
  multipleJobs: boolean;
  children: number;
  otherDependents: number;
  otherCreditsCents: number;
  otherIncomeCents: number;
  deductionsCents: number;
  extraCents: number;
  exempt: boolean;
}

const FS: Record<string, FormW4_2026["filingStatus"]> = { single: "single_or_mfs", married_jointly: "mfj_or_qss", head_of_household: "head_of_household" };

/** The 2026 W-4 as entered, without a signature (a paper form signed by the employee and kept by the employer). */
export function w4Data(w: W4Entry): Omit<FormW4_2026, "signature"> {
  return {
    filingStatus: FS[w.filingStatus] ?? "single_or_mfs",
    multipleJobsCheckbox: w.multipleJobs,
    qualifyingChildren: Math.max(0, Math.floor(w.children)),
    otherDependents: Math.max(0, Math.floor(w.otherDependents)),
    otherCredits: w.otherCreditsCents,
    otherIncome: w.otherIncomeCents,
    deductions: w.deductionsCents,
    extraWithholding: w.extraCents,
    exempt: w.exempt,
  };
}

/** Step 3 total stored on the employee for the engine. */
export const w4DependentsCents = (w: W4Entry) => w4Step3Total({ qualifyingChildren: w.children, otherDependents: w.otherDependents, otherCredits: w.otherCreditsCents });

/** Values to prefill the form: the latest saved W-4, or the Step 3 dollar total for older rows. */
export function w4Prefill(latest: unknown, dependentsCents: number): { children: number; otherDependents: number; otherCreditsCents: number } {
  const d = latest as Partial<FormW4_2026> | null | undefined;
  if (d && typeof d.qualifyingChildren === "number") return { children: d.qualifyingChildren, otherDependents: d.otherDependents ?? 0, otherCreditsCents: d.otherCredits ?? 0 };
  return { children: 0, otherDependents: 0, otherCreditsCents: dependentsCents };
}

export function w4Record(w: W4Entry) {
  const data = w4Data(w);
  return {
    formYear: W4_FORM_YEAR,
    data,
    exempt: w.exempt,
    exemptExpiresOn: w.exempt ? new Date(`${exemptExpires(W4_FORM_YEAR)}T00:00:00Z`) : null,
  };
}

export function stateRecord(state: string, data: unknown) {
  const key = ({ CT: "CT_W4", MA: "MA_M4", OR: "OR_W4", NY: "NY_IT2104" } as const)[state as LaunchState];
  return { state, formName: STATE_FORM_NAME[state as LaunchState], formRevision: key ? FORM_VERSIONS[key].edition : "", data };
}

/** Stable comparison so a save only creates a new version when the form actually changed. */
export function sameForm(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): unknown =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== false && v !== 0 && v !== "").sort(([p], [q]) => p.localeCompare(q)).map(([k, v]) => [k, norm(v)]))
      : x;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** I-9 dates for a first day of work (the hire date). */
export function i9Dates(firstDay: Date, terminatedOn?: Date | null) {
  const due = i9Deadlines(iso(firstDay));
  const retain = i9RetainUntil(iso(firstDay), terminatedOn ? iso(terminatedOn) : null);
  return { firstDayOfEmployment: firstDay, section2DueOn: day(due.section2), retainUntil: retain ? day(retain) : null };
}
