import { addDays, isBusinessDay, quarterOf, quarterReturnDue, nextBusinessDay } from "@/lib/filings/calendar";
import { i9Deadlines } from "@/lib/onboarding/i9";
import { nextPeriod, type Frequency } from "./periods";

/**
 * The owner's to-do list: what needs them, by when. Pure so it can be tested; companyTodos() in
 * automation.ts loads the facts. The same list drives the Overview, the daily reminder email and
 * automatic draft pay runs.
 */

export interface Todo {
  /** Stable id, also the reminder key so each reminder is emailed once. */
  key: string;
  title: string;
  detail?: string;
  /** YYYY-MM-DD */
  due?: string;
  /** Path inside the company app, e.g. "/payroll/abc". */
  href: string;
  urgent: boolean;
  /** Worth an email when it becomes due soon (not just shown on the Overview). */
  remind: boolean;
}

export interface TodoFacts {
  today: string;
  schedules: { id: string; name: string; frequency: Frequency; anchorPayday: string; payLagDays: number; lastRegularPayday: string | null }[];
  openRuns: { id: string; payScheduleId: string; payday: string; status: "DRAFT" | "APPROVED"; offCycle: boolean }[];
  employees: {
    id: string;
    name: string;
    status: "ONBOARDING" | "ACTIVE" | "TERMINATED";
    hireDate: string;
    selfOnboardingInvited: boolean;
    selfOnboardingDone: boolean;
    i9Done: boolean;
  }[];
  /** Quarters (e.g. "2026-Q3") with at least one paid run. */
  paidQuarters: string[];
  /** 941 filings marked filed, by period. */
  filed941: string[];
}

/** Direct deposits go out by standard ACH, so a run must be approved 2 business days before payday. */
export const APPROVAL_BUSINESS_DAYS = 2;

/** The nth business day before `d`. */
export function businessDaysBefore(d: string, n: number): string {
  let x = d;
  for (let i = 0; i < n; i++) {
    x = addDays(x, -1);
    while (!isBusinessDay(x)) x = addDays(x, -1);
  }
  return x;
}

export const approveBy = (payday: string) => businessDaysBefore(payday, APPROVAL_BUSINESS_DAYS);

/** How many days ahead a regular pay run is prepared automatically. */
export const DRAFT_DAYS_AHEAD = 7;

const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The next regular payday on each schedule that has no open run yet, if it is within the window. */
export function runsToPrepare(f: Pick<TodoFacts, "today" | "schedules" | "openRuns">, daysAhead = DRAFT_DAYS_AHEAD) {
  return f.schedules.flatMap((s) => {
    if (f.openRuns.some((r) => r.payScheduleId === s.id && !r.offCycle)) return [];
    const next = nextPeriod(s.frequency, s.anchorPayday, s.payLagDays, s.lastRegularPayday);
    const ahead = daysBetween(f.today, next.payday);
    return ahead >= 0 && ahead <= daysAhead ? [{ scheduleId: s.id, payday: next.payday }] : [];
  });
}

export function buildTodos(f: TodoFacts): Todo[] {
  const out: Todo[] = [];
  const { today } = f;

  for (const r of f.openRuns) {
    if (r.status !== "DRAFT") continue;
    const by = approveBy(r.payday);
    const late = by < today;
    out.push({
      key: `approve:${r.id}`,
      title: late ? `Approve today: payday ${pretty(r.payday)} is at risk` : `Review and approve the pay run for ${pretty(r.payday)}`,
      detail: late
        ? "The approval cutoff for on-time direct deposit has passed. Approve now; deposits may land a day or two late, and paper checks can still be printed."
        : `Approve by ${pretty(by)} so direct deposits arrive on payday.`,
      due: by,
      href: `/payroll/${r.id}`,
      urgent: late || daysBetween(today, by) <= 1,
      remind: daysBetween(today, by) <= 2,
    });
  }

  for (const p of runsToPrepare(f)) {
    const s = f.schedules.find((x) => x.id === p.scheduleId)!;
    out.push({
      key: `start:${s.id}:${p.payday}`,
      title: `Start the ${s.name} pay run for ${pretty(p.payday)}`,
      detail: `Approve by ${pretty(approveBy(p.payday))}.`,
      due: approveBy(p.payday),
      href: "/payroll",
      urgent: approveBy(p.payday) <= today,
      remind: false,
    });
  }

  for (const e of f.employees) {
    if (e.status !== "ONBOARDING") continue;
    if (e.selfOnboardingInvited && !e.selfOnboardingDone) {
      out.push({
        key: `waiting:${e.id}`,
        title: `Waiting on ${e.name} to finish their onboarding`,
        detail: "They were emailed a link to enter their details, W-4, state form and bank account. You can resend it from their page.",
        due: e.hireDate,
        href: `/people/${e.id}`,
        urgent: false,
        remind: false,
      });
      continue;
    }
    if (!e.i9Done) {
      const due = i9Deadlines(e.hireDate).section2;
      out.push({
        key: `i9:${e.id}`,
        title: `Check ${e.name}'s I-9 documents`,
        detail: `Look at their original identity and work documents in person and complete Section 2 by ${pretty(due)}.`,
        due,
        href: `/people/${e.id}`,
        urgent: due <= today,
        remind: daysBetween(today, due) <= 1,
      });
    }
  }

  // 941 for each finished quarter with payroll, until it is marked filed.
  for (const q of f.paidQuarters) {
    if (f.filed941.includes(q)) continue;
    const [y, qq] = [Number(q.slice(0, 4)), Number(q.slice(6)) as 1 | 2 | 3 | 4];
    const cur = quarterOf(today);
    if (y > cur.year || (y === cur.year && qq >= cur.quarter)) continue;
    const due = nextBusinessDay(quarterReturnDue(y, qq));
    out.push({
      key: `941:${q}`,
      title: `File the ${q} Form 941 and state returns`,
      detail: `Due ${pretty(due)}. Generate them on Tax filings, check them, then mark them filed.`,
      due,
      href: "/filings",
      urgent: due <= today,
      remind: daysBetween(today, due) <= 7,
    });
  }

  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}
