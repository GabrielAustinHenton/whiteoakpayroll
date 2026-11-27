/**
 * Numbers for the White Oak admin portal: what each client pays, totals, filing deadlines across
 * clients, and things that need attention. The pure functions here are tested; loadPortal() reads
 * the database once for all companies.
 */
import { monthlyBill, type AddOnKey, type MonthlyBill } from "../pricing";
import { nextBusinessDay, quarterReturnDue, addDays } from "../filings/calendar";
import { db } from "../db";

export const STATE_RETURN: Record<string, string> = { CT: "CT-941", MA: "M-941", OR: "OQ", NY: "NYS-45" };

export interface CompanyBillingInput {
  /** Distinct people (employees + contractors) paid so far this month. */
  paidThisMonth: number;
  /** Active employees + active contractors right now. */
  activePeople: number;
  addOns: AddOnKey[];
}

export interface CompanyBilling {
  /** What the company owes for this month so far (people actually paid). */
  monthToDate: MonthlyBill;
  /** The monthly price if every active person is paid this month: the run-rate subscription. */
  projected: MonthlyBill;
}

export function companyBilling(i: CompanyBillingInput): CompanyBilling {
  return {
    monthToDate: monthlyBill(i.paidThisMonth, i.addOns),
    projected: monthlyBill(Math.max(i.activePeople, i.paidThisMonth), i.addOns),
  };
}

/** Sum invoice totals by month, newest last, for the trend (months with no invoices show 0). */
export function revenueTrend(invoices: { month: string; totalCents: number }[], thisMonth: string, months = 6) {
  const [y, m] = thisMonth.split("-").map(Number);
  const out: { month: string; totalCents: number; companies: number }[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    const key = d.toISOString().slice(0, 7);
    const rows = invoices.filter((i) => i.month === key);
    out.push({ month: key, totalCents: rows.reduce((s, r) => s + r.totalCents, 0), companies: rows.filter((r) => r.totalCents > 0).length });
  }
  return out;
}

export interface DeadlineInput {
  companyId: string;
  companyName: string;
  /** Quarters with a paid pay run ("2026-Q3"), with the work states paid in that quarter. */
  paidQuarters: { period: string; states: string[] }[];
  /** Years with paid wages, and years with contractor payments. */
  wageYears: number[];
  contractorYears: number[];
  /** "form|period" for filings marked filed, and for filings generated (filed or not). */
  filed: Set<string>;
  generated: Set<string>;
}

export interface Deadline {
  companyId: string;
  companyName: string;
  form: string;
  period: string;
  due: string;
  status: "overdue" | "due_soon" | "upcoming";
  /** The return is generated in the archive but not marked filed yet. */
  generated: boolean;
}

/**
 * Returns not yet marked filed: quarterly 941 and state returns, and year-end 940, W-2/W-3 and
 * 1099-NEC/1096 (all due the last day of the month after the period, moved to the next business day).
 * Overdue = due date passed; due soon = within 14 days; upcoming = within `horizonDays`.
 */
export function filingDeadlines(companies: DeadlineInput[], today: string, horizonDays = 75): Deadline[] {
  const out: Deadline[] = [];
  const horizon = addDays(today, horizonDays);
  const soon = addDays(today, 14);
  for (const c of companies) {
    const want: { form: string; period: string; due: string }[] = [];
    for (const q of c.paidQuarters) {
      const [y, n] = [Number(q.period.slice(0, 4)), Number(q.period.slice(6)) as 1 | 2 | 3 | 4];
      const due = nextBusinessDay(quarterReturnDue(y, n));
      want.push({ form: "941", period: q.period, due });
      for (const s of q.states) if (STATE_RETURN[s]) want.push({ form: STATE_RETURN[s], period: q.period, due });
    }
    for (const y of c.wageYears) {
      const due = nextBusinessDay(`${y + 1}-01-31`);
      want.push({ form: "940", period: String(y), due }, { form: "W-3", period: String(y), due });
    }
    for (const y of c.contractorYears) want.push({ form: "1096", period: String(y), due: nextBusinessDay(`${y + 1}-01-31`) });
    for (const w of want) {
      const key = `${w.form}|${w.period}`;
      if (c.filed.has(key) || w.due > horizon) continue;
      out.push({
        companyId: c.companyId,
        companyName: c.companyName,
        ...w,
        status: w.due < today ? "overdue" : w.due <= soon ? "due_soon" : "upcoming",
        generated: c.generated.has(key),
      });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.companyName.localeCompare(b.companyName));
}

export interface Alert {
  companyId: string;
  companyName: string;
  kind: "payroll" | "compliance" | "setup" | "advances";
  text: string;
  href: string;
}

const ADDON_KEY = { PTO: "pto", TIME_TRACKING: "time_tracking" } as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const quarterKey = (d: Date) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

/** Everything the admin dashboard shows, in a fixed number of queries. */
export async function loadPortal(now = new Date()) {
  const today = iso(now);
  const month = today.slice(0, 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));

  const [companies, linesThisMonth, contractorPaysThisMonth, paidRuns, contractorPays, filings, invoices, openRuns, advances] = await Promise.all([
    db.company.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        modules: true,
        stateAccounts: { select: { state: true } },
        paySchedules: { select: { id: true } },
        memberships: { where: { role: "CLIENT_OWNER" }, include: { user: { select: { name: true, email: true } } } },
        employees: { where: { status: { not: "TERMINATED" } }, select: { id: true, firstName: true, lastName: true, status: true, hireDate: true, i9CompletedAt: true, paymentMethod: true, bankLast4: true, workState: true } },
        contractors: { where: { status: "ACTIVE" }, select: { id: true, legalName: true, w9ReceivedAt: true } },
        payRuns: { where: { status: "PAID" }, orderBy: { payday: "desc" }, take: 1, select: { payday: true } },
      },
    }),
    db.payRunLine.findMany({ where: { grossCents: { gt: 0 }, payRun: { status: "PAID", payday: { gte: monthStart, lt: nextMonth } } }, select: { employeeId: true, payRun: { select: { companyId: true } } } }),
    db.contractorPayment.findMany({
      where: { paidOn: { gte: monthStart, lt: nextMonth }, OR: [{ payRunId: null }, { payRun: { status: "PAID" } }] },
      select: { contractorId: true, contractor: { select: { companyId: true } } },
    }),
    db.payRun.findMany({ where: { status: "PAID", payday: { gte: yearStart } }, select: { companyId: true, payday: true, lines: { where: { grossCents: { gt: 0 } }, select: { employee: { select: { workState: true } } } } } }),
    db.contractorPayment.findMany({ where: { paidOn: { gte: yearStart }, OR: [{ payRunId: null }, { payRun: { status: "PAID" } }] }, select: { paidOn: true, contractor: { select: { companyId: true } } } }),
    db.filing.findMany({ select: { companyId: true, form: true, period: true, status: true } }),
    db.invoice.findMany({ select: { companyId: true, month: true, totalCents: true } }),
    db.payRun.findMany({ where: { status: { in: ["DRAFT", "APPROVED"] } }, select: { id: true, companyId: true, status: true, payday: true } }),
    db.advance.findMany({ where: { status: { in: ["REQUESTED", "ACTIVE"] } }, select: { status: true, principalCents: true, repaidCents: true, employee: { select: { companyId: true } } } }),
  ]);

  const paidPeople = new Map<string, Set<string>>();
  const addPaid = (cid: string, key: string) => (paidPeople.get(cid) ?? paidPeople.set(cid, new Set()).get(cid)!).add(key);
  for (const l of linesThisMonth) addPaid(l.payRun.companyId, `e:${l.employeeId}`);
  for (const p of contractorPaysThisMonth) addPaid(p.contractor.companyId, `c:${p.contractorId}`);

  const lastMonthBilled = new Map(invoices.filter((i) => i.month === lastMonth).map((i) => [i.companyId, i.totalCents]));

  const rows = companies.map((c) => {
    const addOns = c.modules.map((m) => ADDON_KEY[m.addOn]);
    const activeEmployees = c.employees.filter((e) => e.status === "ACTIVE").length;
    const billing = companyBilling({ paidThisMonth: paidPeople.get(c.id)?.size ?? 0, activePeople: activeEmployees + c.contractors.length, addOns });
    const owner = c.memberships[0]?.user;
    return {
      id: c.id,
      name: c.tradeName ? `${c.legalName} (${c.tradeName})` : c.legalName,
      legalName: c.legalName,
      state: c.state,
      createdAt: c.createdAt,
      owner,
      activeEmployees,
      onboarding: c.employees.length - activeEmployees,
      contractors: c.contractors.length,
      addOns: c.modules.map((m) => m.addOn),
      lastPayday: c.payRuns[0]?.payday ?? null,
      lastMonthCents: lastMonthBilled.get(c.id) ?? 0,
      ...billing,
    };
  });

  // Filing deadlines
  const byCompany = new Map(companies.map((c) => [c.id, c]));
  const deadlineInputs = new Map<string, DeadlineInput>();
  const input = (cid: string) => {
    let d = deadlineInputs.get(cid);
    if (!d) {
      d = { companyId: cid, companyName: byCompany.get(cid)?.legalName ?? cid, paidQuarters: [], wageYears: [], contractorYears: [], filed: new Set(), generated: new Set() };
      deadlineInputs.set(cid, d);
    }
    return d;
  };
  for (const r of paidRuns) {
    const d = input(r.companyId);
    const period = quarterKey(r.payday);
    let q = d.paidQuarters.find((x) => x.period === period);
    if (!q) d.paidQuarters.push((q = { period, states: [] }));
    for (const l of r.lines) if (!q.states.includes(l.employee.workState)) q.states.push(l.employee.workState);
    const y = r.payday.getUTCFullYear();
    if (!d.wageYears.includes(y)) d.wageYears.push(y);
  }
  for (const p of contractorPays) {
    const d = input(p.contractor.companyId);
    const y = p.paidOn.getUTCFullYear();
    if (!d.contractorYears.includes(y)) d.contractorYears.push(y);
  }
  for (const f of filings) {
    const d = deadlineInputs.get(f.companyId);
    if (!d) continue;
    d.generated.add(`${f.form}|${f.period}`);
    if (f.status === "filed") d.filed.add(`${f.form}|${f.period}`);
  }
  const deadlines = filingDeadlines([...deadlineInputs.values()], today);

  // Alerts
  const alerts: Alert[] = [];
  const name = (cid: string) => byCompany.get(cid)?.legalName ?? cid;
  const in2 = addDays(today, 2);
  for (const r of openRuns) {
    const payday = iso(r.payday);
    if (r.status === "APPROVED") alerts.push({ companyId: r.companyId, companyName: name(r.companyId), kind: "payroll", text: `Pay run for ${payday} is approved but not paid`, href: `/app/${r.companyId}/payroll/${r.id}` });
    else if (payday <= in2) alerts.push({ companyId: r.companyId, companyName: name(r.companyId), kind: "payroll", text: payday < today ? `Draft pay run for ${payday} is past its payday` : `Draft pay run for ${payday} is not approved yet`, href: `/app/${r.companyId}/payroll/${r.id}` });
  }
  for (const c of companies) {
    const base = { companyId: c.id, companyName: c.legalName };
    if (!c.bankLast4) alerts.push({ ...base, kind: "setup", text: "No funding bank account", href: `/app/${c.id}/settings` });
    if (!c.paySchedules.length) alerts.push({ ...base, kind: "setup", text: "No pay schedule", href: `/app/${c.id}/settings` });
    const workStates = new Set([c.state, ...c.employees.map((e) => e.workState)]);
    for (const s of workStates) if (!c.stateAccounts.some((a) => a.state === s)) alerts.push({ ...base, kind: "setup", text: `No ${s} tax account numbers`, href: `/app/${c.id}/settings` });
    // I-9 section 2 is due by the third business day after the start date; 3 calendar days is close enough for a flag.
    const noI9 = c.employees.filter((e) => !e.i9CompletedAt && iso(e.hireDate) < addDays(today, -3));
    if (noI9.length) alerts.push({ ...base, kind: "compliance", text: `${noI9.length} employee${noI9.length > 1 ? "s" : ""} without a completed I-9 (${noI9.slice(0, 3).map((e) => `${e.firstName} ${e.lastName}`).join(", ")}${noI9.length > 3 ? ", …" : ""})`, href: `/app/${c.id}/people` });
    const noW9 = c.contractors.filter((k) => !k.w9ReceivedAt);
    if (noW9.length) alerts.push({ ...base, kind: "compliance", text: `${noW9.length} contractor${noW9.length > 1 ? "s" : ""} without a W-9`, href: `/app/${c.id}/people` });
    const noBank = c.employees.filter((e) => e.paymentMethod === "DIRECT_DEPOSIT" && !e.bankLast4);
    if (noBank.length) alerts.push({ ...base, kind: "setup", text: `${noBank.length} direct deposit employee${noBank.length > 1 ? "s" : ""} without a bank account`, href: `/app/${c.id}/people` });
  }
  const requested = new Map<string, number>();
  for (const a of advances) if (a.status === "REQUESTED") requested.set(a.employee.companyId, (requested.get(a.employee.companyId) ?? 0) + 1);
  for (const [cid, n] of requested) alerts.push({ companyId: cid, companyName: name(cid), kind: "advances", text: `${n} advance request${n > 1 ? "s" : ""} waiting for the employer`, href: `/app/${cid}/advances` });

  const advancesOutstandingCents = advances.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + a.principalCents - a.repaidCents, 0);

  return {
    today,
    month,
    lastMonth,
    rows,
    totals: {
      companies: rows.length,
      payingCompanies: rows.filter((r) => r.projected.total > 0).length,
      activeEmployees: rows.reduce((s, r) => s + r.activeEmployees, 0),
      contractors: rows.reduce((s, r) => s + r.contractors, 0),
      projectedCents: rows.reduce((s, r) => s + r.projected.total, 0),
      monthToDateCents: rows.reduce((s, r) => s + r.monthToDate.total, 0),
      lastMonthCents: rows.reduce((s, r) => s + r.lastMonthCents, 0),
      advancesOutstandingCents,
    },
    trend: revenueTrend(invoices, month),
    deadlines,
    alerts,
  };
}
