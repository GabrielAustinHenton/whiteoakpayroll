import { db } from "../db";
import type { CurrentUser } from "../auth/session";
import { canUse, roleIn } from "../auth/session";
import { overtimeWages, type LineDetail } from "./engine";
import { DEDUCTION_LABELS } from "../pay-run/review";
import { usd, type FormDoc } from "../pdf/form-pdf";

/** A paystub with this-period and year-to-date columns, if the viewer may see it. */
export async function loadPaystub(lineId: string, user: CurrentUser) {
  const line = await db.payRunLine.findUnique({ where: { id: lineId }, include: { employee: true, payRun: { include: { company: true } } } });
  if (!line || line.payRun.status !== "PAID") return null;
  const role = roleIn(user, line.payRun.companyId);
  const own = line.employee.userId === user.id;
  if (!own && !canUse(role, "reports")) return null;

  const year = line.payRun.payday.getUTCFullYear();
  const ytdLines = await db.payRunLine.findMany({
    where: { employeeId: line.employeeId, payRun: { status: "PAID", payday: { gte: new Date(Date.UTC(year, 0, 1)), lte: line.payRun.payday } } },
  });
  const d = line.detail as unknown as LineDetail;
  const ytdDetails = ytdLines.map((l) => l.detail as unknown as LineDetail);
  const ytdOf = (id: string) => ytdDetails.reduce((s, x) => s + x.result.lines.filter((l) => l.id === id).reduce((a, l) => a + l.amount, 0), 0);
  const ytdDed = (k: string) => ytdDetails.reduce((s, x) => s + x.deductionDetail.filter((l) => l.kind === k).reduce((a, l) => a + l.amount, 0), 0);
  const nonzero = (x: { current: number; ytd: number }) => x.current !== 0 || x.ytd !== 0;
  const taxes = d.result.lines.filter((l) => l.payer === "employee").map((l) => ({ label: l.label, current: l.amount, ytd: ytdOf(l.id) })).filter(nonzero);
  const employerTaxes = d.result.lines.filter((l) => l.payer === "employer").map((l) => ({ label: l.label, current: l.amount, ytd: ytdOf(l.id) })).filter(nonzero);
  const deductions = d.deductionDetail.map((x) => ({ label: DEDUCTION_LABELS[x.kind], current: x.amount, ytd: ytdDed(x.kind) }));
  const check = await db.check.findFirst({ where: { payRunLineId: lineId, status: "ISSUED" } });
  const sumYtd = (k: "grossCents" | "netCents") => ytdLines.reduce((s, l) => s + l[k], 0);
  const e = line.employee;
  const c = line.payRun.company;
  return {
    line,
    company: c,
    employee: e,
    paidBy: check ? `Paper check ${check.number}` : `Direct deposit${line.employee.bankLast4 ? ` to account ending ${line.employee.bankLast4}` : ""}`,
    earnings: [
      ...(e.payBasis === "HOURLY" && line.overtimeHours > 0
        ? [
            { label: `Regular (${line.hours ?? 0} h x ${usd(e.payRateCents)})`, current: line.regularCents - overtimeWages(e, line.overtimeHours) },
            { label: `Overtime (${line.overtimeHours} h x ${usd(Math.round(e.payRateCents * 1.5))})`, current: overtimeWages(e, line.overtimeHours) },
          ]
        : [{ label: e.payBasis === "HOURLY" ? `Regular (${line.hours ?? 0} h x ${usd(e.payRateCents)})` : "Salary", current: line.regularCents }]),
      ...(line.bonusCents ? [{ label: "Bonus", current: line.bonusCents }] : []),
    ],
    gross: { current: line.grossCents, ytd: sumYtd("grossCents") },
    net: { current: line.netCents, ytd: sumYtd("netCents") },
    taxes,
    employerTaxes,
    deductions,
  };
}

export type Paystub = NonNullable<Awaited<ReturnType<typeof loadPaystub>>>;

export function paystubDoc(p: Paystub): FormDoc {
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const r = p.line.payRun;
  const row = (x: { label: string; current: number; ytd?: number }) => ({ label: x.label, value: x.ytd === undefined ? usd(x.current) : `${usd(x.current)}   YTD ${usd(x.ytd)}` });
  return {
    form: "Paystub",
    title: `Earnings statement for ${p.employee.firstName} ${p.employee.lastName}`,
    period: `Payday ${iso(r.payday)}`,
    parties: [
      { label: "Employer", lines: [p.company.legalName, p.company.addressLine1, `${p.company.city}, ${p.company.state} ${p.company.zip}`] },
      { label: "Employee", lines: [`${p.employee.firstName} ${p.employee.lastName}`, `SSN ***-**-${p.employee.ssn.slice(-4)}`, `Pay period ${iso(r.periodStart)} to ${iso(r.periodEnd)}`] },
    ],
    sections: [
      { heading: "Earnings", rows: [...p.earnings.map(row), { label: "Gross pay", value: `${usd(p.gross.current)}   YTD ${usd(p.gross.ytd)}` }] },
      { heading: "Taxes withheld", rows: p.taxes.map(row) },
      { heading: "Deductions", rows: p.deductions.length ? p.deductions.map(row) : [{ label: "None", value: "" }] },
      { heading: "Net pay", rows: [{ label: p.paidBy, value: `${usd(p.net.current)}   YTD ${usd(p.net.ytd)}` }] },
      { heading: "Paid by your employer (not taken from your pay)", rows: p.employerTaxes.map(row) },
    ],
  };
}
