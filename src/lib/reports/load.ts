import { db } from "../db";
import type { LineDetail } from "../app/engine";
import type { ContractorReportPayment, Range, ReportLine } from "./index";

/** Paid paychecks and contractor payments for one company in a date range (by payday). */
export async function loadReportData(companyId: string, range: Range): Promise<{ lines: ReportLine[]; contractors: ContractorReportPayment[] }> {
  const [runs, payments] = await Promise.all([
    db.payRun.findMany({
      where: { companyId, status: "PAID", payday: { gte: range.from, lte: range.to } },
      include: { lines: { where: { grossCents: { gt: 0 } }, include: { employee: { select: { firstName: true, lastName: true } } } } },
    }),
    db.contractorPayment.findMany({
      where: { contractor: { companyId }, paidOn: { gte: range.from, lte: range.to } },
      include: { contractor: { select: { legalName: true, businessName: true } } },
    }),
  ]);
  const lines = runs.flatMap((r) =>
    r.lines.map((l) => ({
      payday: r.payday,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      employeeId: l.employeeId,
      employeeName: `${l.employee.lastName}, ${l.employee.firstName}`,
      hours: l.hours,
      overtimeHours: l.overtimeHours,
      regularCents: l.regularCents,
      bonusCents: l.bonusCents,
      grossCents: l.grossCents,
      employeeTaxesCents: l.employeeTaxesCents,
      employerTaxesCents: l.employerTaxesCents,
      deductionsCents: l.deductionsCents,
      netCents: l.netCents,
      detail: (l.detail as unknown as LineDetail | null) ?? null,
    })),
  );
  const contractors = payments.map((p) => ({
    paidOn: p.paidOn,
    contractorId: p.contractorId,
    name: p.contractor.businessName ?? p.contractor.legalName,
    amountCents: p.amountCents,
    memo: p.memo,
  }));
  return { lines, contractors };
}

/** Years that have a paid pay run, newest first, always including this year. */
export async function reportYears(companyId: string, now = new Date()): Promise<number[]> {
  const first = await db.payRun.findFirst({ where: { companyId, status: "PAID" }, orderBy: { payday: "asc" }, select: { payday: true } });
  const thisYear = now.getUTCFullYear();
  const start = Math.min(first?.payday.getUTCFullYear() ?? thisYear, thisYear);
  return Array.from({ length: thisYear - start + 1 }, (_, i) => thisYear - i);
}
