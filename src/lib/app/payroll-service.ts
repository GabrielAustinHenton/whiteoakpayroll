import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { computePaycheck, toPaycheckRecord, type LineDetail } from "./engine";
import { activePlan, buildRetirementSubmission, employeeRetirement, priorYearFicaWages } from "./retirement-service";
import { totalEmployer } from "../retirement";
import { nextPeriod, type Frequency } from "./periods";
import { quarterForms, yearForms, type FilingInput } from "./filing-docs";
import { renderFormPdf } from "../pdf/form-pdf";
import { monthlyBill, type AddOnKey } from "../pricing";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function audit(actorId: string | null, companyId: string | null, action: string, detail?: Prisma.InputJsonValue) {
  await db.auditLog.create({ data: { actorId, companyId, action, detail } });
}

/** Start the next regular pay run for a schedule, with every active employee on it. */
export async function createPayRun(companyId: string, payScheduleId: string) {
  const schedule = await db.paySchedule.findFirstOrThrow({ where: { id: payScheduleId, companyId } });
  const last = await db.payRun.findFirst({ where: { payScheduleId, offCycle: false, status: { not: "VOIDED" } }, orderBy: { payday: "desc" } });
  const p = nextPeriod(schedule.frequency as Frequency, iso(schedule.anchorPayday), schedule.payLagDays, last ? iso(last.payday) : null);
  // Someone still filling in their own onboarding (no SSN yet) is left off until they finish.
  const employees = await db.employee.findMany({ where: { companyId, payScheduleId, status: { in: ["ACTIVE", "ONBOARDING"] }, ssn: { not: "" } } });
  const run = await db.payRun.create({
    data: {
      companyId,
      payScheduleId,
      periodStart: day(p.periodStart),
      periodEnd: day(p.periodEnd),
      payday: day(p.payday),
      lines: {
        create: employees.map((e) => ({
          employeeId: e.id,
          hours: e.payBasis === "HOURLY" ? e.defaultHours : null,
          regularCents: 0,
        })),
      },
    },
  });
  await recalculate(run.id);
  return run;
}

/** Recompute every line of a draft pay run with the tax engine and store the results. */
export async function recalculate(payRunId: string) {
  const run = await db.payRun.findUniqueOrThrow({
    where: { id: payRunId },
    include: { paySchedule: true, lines: { include: { employee: { include: { advances: true } } } }, company: { include: { stateAccounts: true } } },
  });
  if (run.status !== "DRAFT") throw new Error("Only draft pay runs can change.");
  const year = run.payday.getUTCFullYear();
  const employerSize = await db.employee.count({ where: { companyId: run.companyId, status: "ACTIVE" } });
  const plan = await activePlan(run.companyId);
  const priorFica = plan ? await priorYearFicaWages(run.companyId, year) : new Map<string, number>();

  for (const line of run.lines) {
    const e = line.employee;
    const priorLines = await db.payRunLine.findMany({
      where: {
        employeeId: e.id,
        payRun: { status: "PAID", payday: { gte: new Date(Date.UTC(year, 0, 1)), lt: run.payday } },
      },
      select: { detail: true },
    });
    const acct = run.company.stateAccounts.find((s) => s.state === e.workState);
    const detail = computePaycheck({ ...e, retirement: employeeRetirement(plan, e, priorFica) }, {
      payday: iso(run.payday),
      frequency: run.paySchedule.frequency as Frequency,
      hours: line.hours,
      overtimeHours: line.overtimeHours,
      bonus: line.bonusCents,
      company: { suiRate: acct?.suiRate ?? 0, orTransitDistrict: acct?.orTransitDistrict },
      employerSize: Math.max(employerSize, 1),
      prior: priorLines.map((l) => l.detail as unknown as LineDetail),
      advances: e.advances
        .filter((a) => a.status === "ACTIVE")
        .map((a) => ({ id: a.id, principalCents: a.principalCents, installmentCents: a.installmentCents, repaidCents: a.repaidCents, authorizationSigned: !!a.authorizationSignedAt })),
    });
    const r = detail.result;
    await db.payRunLine.update({
      where: { id: line.id },
      data: {
        regularCents: r.gross - line.bonusCents,
        grossCents: r.gross,
        employeeTaxesCents: r.employeeTaxes,
        employerTaxesCents: r.employerTaxes,
        deductionsCents: r.deductions,
        netCents: r.net,
        detail: detail as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const lines = await db.payRunLine.findMany({ where: { payRunId } });
  const contractor = await db.contractorPayment.aggregate({ where: { payRunId }, _sum: { amountCents: true } });
  const k = contractor._sum.amountCents ?? 0;
  const gross = lines.reduce((s, l) => s + l.grossCents, 0);
  const er = lines.reduce((s, l) => s + l.employerTaxesCents, 0);
  // Employer 401(k)/SIMPLE money is on top of wages, so it is part of the cash the run needs.
  const erRetirement = lines.reduce((s, l) => {
    const d = l.detail as unknown as LineDetail | null;
    return s + (d?.retirement ? totalEmployer(d.retirement) : 0);
  }, 0);
  await db.payRun.update({
    where: { id: payRunId },
    data: {
      grossCents: gross,
      employerTaxesCents: er,
      netCents: lines.reduce((s, l) => s + l.netCents, 0),
      cashNeededCents: gross + er + k + erRetirement,
    },
  });
}

/**
 * Approve and pay. Money movement is a stub (TD Bank not integrated): the run is marked PAID with
 * a simulated funding reference, advances are credited, and nothing leaves any bank account.
 */
export async function approveAndPay(payRunId: string, actorId: string) {
  const run = await db.payRun.findUniqueOrThrow({
    where: { id: payRunId },
    include: { lines: { include: { employee: true } }, contractorPayments: { include: { contractor: true } } },
  });
  if (run.status !== "DRAFT") throw new Error("This pay run was already approved.");
  if (run.lines.length === 0 && run.contractorPayments.length === 0) throw new Error("Nobody is on this pay run.");
  await db.$transaction(async (tx) => {
    for (const l of run.lines) {
      const d = l.detail as unknown as LineDetail | null;
      for (const r of d?.advanceRepayments ?? []) {
        const a = await tx.advance.update({ where: { id: r.advanceId }, data: { repaidCents: { increment: r.amount } } });
        if (a.repaidCents >= a.principalCents) await tx.advance.update({ where: { id: a.id }, data: { status: "REPAID" } });
      }
    }
    await tx.contractorPayment.updateMany({ where: { payRunId }, data: { paidOn: run.payday } });
    // Paper checks for anyone paid by check, numbered from the company's next check number.
    const toCheck = [
      ...run.lines
        // No bank account on file means a paper check, whatever the payment method says.
        .filter((l) => (l.employee.paymentMethod === "CHECK" || !l.employee.bankLast4) && l.netCents > 0)
        .map((l) => ({ payRunLineId: l.id, payee: `${l.employee.firstName} ${l.employee.lastName}`, amountCents: l.netCents })),
      ...run.contractorPayments
        .filter((p) => p.contractor.paymentMethod === "CHECK" && p.amountCents > 0)
        .map((p) => ({ contractorPaymentId: p.id, payee: p.contractor.businessName ?? p.contractor.legalName, amountCents: p.amountCents })),
    ];
    for (const c of toCheck) await issueCheck(tx, run.companyId, run.payday, c);
    await tx.payRun.update({
      where: { id: payRunId },
      data: { status: "PAID", approvedById: actorId, approvedAt: new Date(), fundingRef: `SIMULATED-${payRunId.slice(-8).toUpperCase()}` },
    });
  });
  await audit(actorId, run.companyId, "payrun.approved", { payRunId, cashNeededCents: run.cashNeededCents });
  // Retirement provider file for this payday (built now, uploaded or sent from the Retirement page).
  await buildRetirementSubmission(payRunId);
  await refreshInvoice(run.companyId, iso(run.payday).slice(0, 7));
}

/** Everything the filings builder needs for one company. */
export async function filingInput(companyId: string): Promise<FilingInput> {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { stateAccounts: true, employees: true, contractors: true } });
  const runs = await db.payRun.findMany({ where: { companyId, status: "PAID" }, include: { lines: true, contractorPayments: true } });
  const records = runs.flatMap((r) => r.lines.filter((l) => l.detail).map((l) => toPaycheckRecord(l, r)));
  const payments = await db.contractorPayment.findMany({ where: { contractor: { companyId }, OR: [{ payRunId: null }, { payRun: { status: "PAID" } }] } });
  return {
    company: {
      legalName: c.legalName,
      ein: c.ein,
      address: { line1: c.addressLine1, city: c.city, state: c.state, zip: c.zip },
      stateIds: Object.fromEntries(c.stateAccounts.map((s) => [s.state, s.withholdingAccount ?? ""])),
      uiIds: Object.fromEntries(c.stateAccounts.map((s) => [s.state, s.unemploymentAccount ?? ""])),
    },
    records,
    employees: c.employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, ssn: e.ssn, address: { line1: e.addressLine1, city: e.city, state: e.state, zip: e.zip } })),
    contractors: c.contractors.map((k) => ({
      id: k.id,
      name: k.businessName ? `${k.legalName} (${k.businessName})` : k.legalName,
      ssn: k.tin,
      tinType: k.tinType === "ein" ? "ein" : "ssn",
      workState: k.state,
      address: { line1: k.addressLine1, city: k.city, state: k.state, zip: k.zip },
    })),
    contractorPayments: payments.map((p) => ({ contractorId: p.contractorId, paidOn: iso(p.paidOn), amount: p.amountCents, backupWithholding: 0 })),
  };
}

/**
 * Generate (or regenerate) the archive for a quarter or a year. Earlier copies of the same form
 * and period are replaced unless they were marked filed, which are kept as the filed record.
 */
export async function generateFilings(companyId: string, period: string, actorId: string) {
  const input = await filingInput(companyId);
  const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(period);
  if (!m) throw new Error("Period must look like 2026 or 2026-Q4.");
  const year = Number(m[1]);
  const forms = m[2] ? quarterForms(input, year, Number(m[2]) as 1 | 2 | 3 | 4) : yearForms(input, year);
  for (const f of forms) {
    const pdf = Buffer.from(await renderFormPdf(f.doc));
    await db.filing.deleteMany({ where: { companyId, form: f.form, period: f.period, recipient: f.recipient ?? null, status: { not: "filed" } } });
    await db.filing.create({
      data: { companyId, form: f.form, period: f.period, recipient: f.recipient ?? null, data: f.data as Prisma.InputJsonValue, pdf },
    });
  }
  await audit(actorId, companyId, "filings.generated", { period, forms: forms.map((f) => f.form) });
  return forms.length;
}

/**
 * People on the bill for a month: every employee on payroll at any point in the month (added to
 * White Oak by month end and not let go before it began), anyone paid that month, and contractors
 * only in months they are paid. The count never drops within a month: adding a 6th person moves
 * the month to the next tier, and offboarding them that month does not move it back.
 */
export async function billPeople(companyId: string, month: string) {
  const [y, mo] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1));
  const to = new Date(Date.UTC(y, mo, 1));
  const [employees, lines, pays] = await Promise.all([
    db.employee.findMany({ where: { companyId, createdAt: { lt: to }, OR: [{ terminationDate: null }, { terminationDate: { gte: from } }] }, select: { id: true, firstName: true, lastName: true, terminationDate: true, createdAt: true } }),
    db.payRunLine.findMany({ where: { payRun: { companyId, payday: { gte: from, lt: to }, status: "PAID" }, grossCents: { gt: 0 } }, select: { employeeId: true, employee: { select: { firstName: true, lastName: true } } } }),
    db.contractorPayment.findMany({
      where: { contractor: { companyId }, paidOn: { gte: from, lt: to }, OR: [{ payRunId: null }, { payRun: { status: "PAID" } }] },
      select: { contractorId: true, contractor: { select: { legalName: true, businessName: true } } },
    }),
  ]);
  const people = new Map<string, { name: string; kind: "employee" | "contractor"; why: string }>();
  for (const e of employees) {
    const why = e.terminationDate ? `on payroll until ${e.terminationDate.toISOString().slice(0, 10)}` : e.createdAt >= from ? `added ${e.createdAt.toISOString().slice(0, 10)}` : "on payroll";
    people.set(`e:${e.id}`, { name: `${e.firstName} ${e.lastName}`, kind: "employee", why });
  }
  for (const l of lines) if (!people.has(`e:${l.employeeId}`)) people.set(`e:${l.employeeId}`, { name: `${l.employee.firstName} ${l.employee.lastName}`, kind: "employee", why: "paid this month" });
  for (const p of pays) people.set(`c:${p.contractorId}`, { name: p.contractor.businessName ?? p.contractor.legalName, kind: "contractor", why: "paid this month" });
  return [...people.values()].sort((x, y2) => x.name.localeCompare(y2.name));
}

async function monthBill(companyId: string, month: string) {
  const [counted, stored, modules] = await Promise.all([
    billPeople(companyId, month),
    db.invoice.findUnique({ where: { companyId_month: { companyId, month } } }),
    db.companyModule.findMany({ where: { companyId } }),
  ]);
  const people = Math.max(counted.length, stored?.peoplePaid ?? 0);
  const addOns = modules.map((m) => (m.addOn === "PTO" ? "pto" : "time_tracking") as AddOnKey);
  return { people, bill: monthlyBill(people, addOns) };
}

/** Recompute and store a month's bill. Called whenever headcount, payments or add-ons change. */
export async function refreshInvoice(companyId: string, month: string) {
  const { people, bill } = await monthBill(companyId, month);
  await db.invoice.upsert({
    where: { companyId_month: { companyId, month } },
    create: { companyId, month, peoplePaid: people, tier: bill.tier, totalCents: bill.total, lines: bill as unknown as Prisma.InputJsonValue },
    update: { peoplePaid: people, tier: bill.tier, totalCents: bill.total, lines: bill as unknown as Prisma.InputJsonValue },
  });
  return { ...bill, peopleCount: people };
}

/**
 * The White Oak fee for a pay run's month. The fee is one flat monthly charge for the people on
 * payroll, billed on the 1st of the next month; it is never added to a pay run's cash, and
 * running payroll again that month does not raise it.
 */
export async function feeForRun(payRunId: string) {
  const run = await db.payRun.findUniqueOrThrow({ where: { id: payRunId } });
  const month = iso(run.payday).slice(0, 7);
  const { people, bill } = await monthBill(run.companyId, month);
  const [y, mo] = month.split("-").map(Number);
  const billedOn = new Date(Date.UTC(y, mo, 1));
  return { month, people, bill, billedOn };
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Take the next check number and record the check. */
export async function issueCheck(
  tx: Tx,
  companyId: string,
  checkDate: Date,
  c: { payRunLineId?: string; contractorPaymentId?: string; payee: string; amountCents: number },
) {
  const company = await tx.company.update({ where: { id: companyId }, data: { nextCheckNumber: { increment: 1 } } });
  return tx.check.create({ data: { companyId, number: company.nextCheckNumber - 1, checkDate, ...c } });
}

/** Void a check (kept in the register) and, optionally, reissue the same payment under a new number. */
export async function voidCheck(companyId: string, checkId: string, reason: string, reissue: boolean, actorId: string) {
  return db.$transaction(async (tx) => {
    const c = await tx.check.findFirstOrThrow({ where: { id: checkId, companyId } });
    if (c.status === "VOID") throw new Error("That check is already void.");
    await tx.check.update({ where: { id: c.id }, data: { status: "VOID", voidReason: reason || null, voidedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId, companyId, action: reissue ? "check.reissued" : "check.voided", detail: { number: c.number, reason } } });
    if (!reissue) return null;
    return issueCheck(tx, companyId, new Date(), { payRunLineId: c.payRunLineId ?? undefined, contractorPaymentId: c.contractorPaymentId ?? undefined, payee: c.payee, amountCents: c.amountCents });
  });
}
