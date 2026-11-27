import type { Employee, Prisma, RetirementElection, RetirementPlan } from "@prisma/client";
import { db } from "../db";
import type { LineDetail, EmployeeRetirement } from "./engine";
import {
  buildProviderFiles,
  normalizePlan,
  provider,
  readElectionReport,
  totalEmployee,
  totalEmployer,
  type BuiltFile,
  type ContributionRow,
  type Election,
  type ElectionStatus,
  type EmployerFormula,
  type PlanConfig,
  type PlanType,
} from "../retirement";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Stored plan row to the engine's plan config. */
export function planConfig(p: RetirementPlan): PlanConfig {
  const f = (p.employerFormula ?? {}) as Partial<EmployerFormula>;
  return normalizePlan({
    id: p.id,
    type: p.planType as PlanType,
    allowsRoth: p.allowsRoth,
    allowsCatchUp: p.allowsCatchUp,
    simpleApplicable: p.simpleApplicable,
    employer: { tiers: Array.isArray(f.tiers) ? f.tiers : [], nonelective: typeof f.nonelective === "number" ? f.nonelective : 0 },
    autoEnrollRate: p.autoEnrollRate,
    eligibilityDays: p.eligibilityDays,
    eligibilityMinAge: p.eligibilityMinAge,
  });
}

export function electionOf(e: RetirementElection | undefined | null): Election {
  if (!e) return { status: "NOT_ENROLLED", pretaxRate: 0, rothRate: 0, pretaxFlatCents: 0, rothFlatCents: 0 };
  return { status: e.status as ElectionStatus, pretaxRate: e.pretaxRate, rothRate: e.rothRate, pretaxFlatCents: e.pretaxFlatCents, rothFlatCents: e.rothFlatCents };
}

/** The plan that is on pay runs now (one active plan per company). */
export function activePlan(companyId: string) {
  return db.retirementPlan.findFirst({ where: { companyId, status: "ACTIVE" }, include: { elections: true }, orderBy: { createdAt: "desc" } });
}

/** Last calendar year's FICA wages per employee, from paid pay runs (Roth catch-up rule). */
export async function priorYearFicaWages(companyId: string, year: number): Promise<Map<string, number>> {
  const lines = await db.payRunLine.findMany({
    where: { payRun: { companyId, status: "PAID", payday: { gte: new Date(Date.UTC(year - 1, 0, 1)), lt: new Date(Date.UTC(year, 0, 1)) } } },
    select: { employeeId: true, detail: true },
  });
  const out = new Map<string, number>();
  for (const l of lines) {
    const d = l.detail as unknown as LineDetail | null;
    out.set(l.employeeId, (out.get(l.employeeId) ?? 0) + (d?.result.wages.fica ?? 0));
  }
  return out;
}

/** What the engine needs about one employee's retirement, or undefined if the company has no active plan. */
export function employeeRetirement(
  plan: (RetirementPlan & { elections: RetirementElection[] }) | null,
  e: Pick<Employee, "id" | "birthDate" | "hireDate">,
  priorFica: Map<string, number>,
): EmployeeRetirement | undefined {
  if (!plan) return undefined;
  return {
    plan: planConfig(plan),
    election: electionOf(plan.elections.find((x) => x.employeeId === e.id)),
    birthDate: e.birthDate ? iso(e.birthDate) : "",
    hireDate: iso(e.hireDate),
    priorYearFicaWages: priorFica.get(e.id) ?? 0,
  };
}

/** Add business days (Mon-Fri; federal holidays not skipped, so this errs early). */
export function addBusinessDays(d: Date, n: number): Date {
  const out = new Date(d);
  while (n > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    const wd = out.getUTCDay();
    if (wd !== 0 && wd !== 6) n--;
  }
  return out;
}

/**
 * After a pay run is paid, build the provider file(s) for the active plan. Employee deferrals are
 * plan assets once withheld: the DOL safe harbor for plans under 100 participants is deposit within
 * 7 business days (29 CFR 2510.3-102(a)(2)), so that is the due date we show for every provider.
 */
export async function buildRetirementSubmission(payRunId: string) {
  const run = await db.payRun.findUniqueOrThrow({
    where: { id: payRunId },
    include: { company: true, paySchedule: true, lines: { include: { employee: true } } },
  });
  const plan = await db.retirementPlan.findFirst({ where: { companyId: run.companyId, status: "ACTIVE" }, include: { elections: true } });
  if (!plan) return null;
  const year = run.payday.getUTCFullYear();
  const ytdGross = new Map<string, number>();
  const ytdLines = await db.payRunLine.findMany({
    where: { payRun: { companyId: run.companyId, status: "PAID", payday: { gte: new Date(Date.UTC(year, 0, 1)), lte: run.payday } } },
    select: { employeeId: true, grossCents: true },
  });
  for (const l of ytdLines) ytdGross.set(l.employeeId, (ytdGross.get(l.employeeId) ?? 0) + l.grossCents);

  const rows: ContributionRow[] = [];
  for (const l of run.lines) {
    const d = l.detail as unknown as LineDetail | null;
    if (!d?.retirement || d.retirement.planId !== plan.id) continue;
    const e = l.employee;
    const el = plan.elections.find((x) => x.employeeId === e.id);
    rows.push({
      employeeId: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      ssn: e.ssn,
      birthDate: e.birthDate ? iso(e.birthDate) : "",
      hireDate: iso(e.hireDate),
      terminationDate: e.terminationDate ? iso(e.terminationDate) : null,
      address: { line1: e.addressLine1, city: e.city, state: e.state, zip: e.zip },
      email: e.email,
      gross: l.grossCents,
      hours: l.hours,
      ytdGross: ytdGross.get(e.id) ?? l.grossCents,
      retirement: d.retirement,
      electionStatus: d.retirement.autoEnrolled ? "ENROLLED" : ((el?.status as ElectionStatus) ?? "NOT_ENROLLED"),
    });
  }
  // State programs need a roster row before the first contribution for a person.
  const p = provider(plan.provider);
  const newToProgram = p.kind === "state_program" ? rows.filter((r) => totalEmployee(r.retirement) > 0 && !plan.elections.find((x) => x.employeeId === r.employeeId)?.sentToProvider) : [];
  const files = buildProviderFiles(plan.provider, { ein: run.company.ein, payday: iso(run.payday), periodStart: iso(run.periodStart), periodEnd: iso(run.periodEnd), payGroup: run.paySchedule.name }, rows, newToProgram);
  const employeeCents = rows.reduce((s, r) => s + totalEmployee(r.retirement), 0);
  const employerCents = rows.reduce((s, r) => s + totalEmployer(r.retirement), 0);
  const data = {
    files: files as unknown as Prisma.InputJsonValue,
    employeeCents,
    employerCents,
    dueOn: addBusinessDays(run.payday, 7),
  };
  return db.retirementSubmission.upsert({
    where: { planId_payRunId: { planId: plan.id, payRunId } },
    create: { planId: plan.id, payRunId, ...data },
    update: data,
  });
}

export function submissionFiles(s: { files: unknown }): BuiltFile[] {
  return Array.isArray(s.files) ? (s.files as BuiltFile[]) : [];
}

/** Mark a submission sent; people in it are now known to the program. */
export async function markSubmissionSent(companyId: string, submissionId: string, actorId: string, note: string) {
  const s = await db.retirementSubmission.findFirstOrThrow({ where: { id: submissionId, plan: { companyId } }, include: { payRun: { include: { lines: true } } } });
  await db.$transaction([
    db.retirementSubmission.update({ where: { id: s.id }, data: { status: "SENT", sentAt: new Date(), sentById: actorId, note: note || null } }),
    db.retirementElection.updateMany({ where: { planId: s.planId, employeeId: { in: s.payRun.lines.map((l) => l.employeeId) } }, data: { sentToProvider: true } }),
    // The first file the provider takes is the connection working.
    db.retirementPlan.updateMany({ where: { id: s.planId, connectedAt: null }, data: { connectedAt: new Date() } }),
  ]);
}

/**
 * Bring elections from the provider's deferral report into White Oak, matched by SSN. Anyone
 * missing from the plan's election list gets a row. Returns counts and problems for the page.
 */
export async function importElections(companyId: string, planId: string, text: string) {
  const plan = await db.retirementPlan.findFirstOrThrow({ where: { id: planId, companyId } });
  const { elections, problems } = readElectionReport(text);
  const employees = await db.employee.findMany({ where: { companyId }, select: { id: true, ssn: true } });
  const bySsn = new Map(employees.map((e) => [e.ssn.replace(/\D/g, ""), e.id]));
  let updated = 0;
  for (const x of elections) {
    const employeeId = bySsn.get(x.ssn);
    if (!employeeId) { problems.push(`SSN ending ${x.ssn.slice(-4)} is not an employee here.`); continue; }
    const pretaxRate = plan.planType === "STATE_AUTO_IRA" ? 0 : x.pretaxRate;
    const rothRate = plan.planType === "STATE_AUTO_IRA" ? x.pretaxRate + x.rothRate : x.rothRate;
    const data = { status: x.status, pretaxRate, rothRate, pretaxFlatCents: 0, rothFlatCents: 0, source: "provider_import", sentToProvider: true };
    await db.retirementElection.upsert({ where: { planId_employeeId: { planId, employeeId } }, create: { planId, employeeId, ...data }, update: data });
    updated++;
  }
  return { updated, problems };
}
