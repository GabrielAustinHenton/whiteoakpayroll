import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { companyBilling } from "@/lib/app/admin-metrics";
import { logAdminView } from "@/lib/app/admin-view";
import { PRICING, priceLabel, type AddOnKey } from "@/lib/pricing";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { FEATURES, FEATURE_KEYS, MODE_LABEL, featuresFor } from "@/lib/app/features";
import { setCompanyBureau, setServiceMode } from "../../actions";

export const dynamic = "force-dynamic";

const ROLE = { CLIENT_OWNER: "Owner", CLIENT_HR: "HR", EMPLOYEE: "Employee", PLATFORM_ADMIN: "Admin" } as const;
const FREQ = { WEEKLY: "Weekly", BIWEEKLY: "Every 2 weeks", SEMIMONTHLY: "Twice a month", MONTHLY: "Monthly" } as const;

export default async function AdminCompany({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireAdmin();
  const { error, ok } = await messages(searchParams);
  const { companyId } = await params;
  const bureaus = await db.bureau.findMany({ orderBy: { name: "asc" } });
  const c = await db.company.findUnique({
    where: { id: companyId },
    include: {
      stateAccounts: true,
      paySchedules: true,
      modules: true,
      memberships: { where: { role: { not: "EMPLOYEE" } }, include: { user: { select: { name: true, email: true } } } },
      invoices: { orderBy: { month: "desc" }, take: 12 },
      payRuns: { orderBy: { payday: "desc" }, take: 8 },
      _count: { select: { filings: true, checks: true } },
    },
  });
  if (!c) notFound();
  await logAdminView(user.id, companyId);

  const month = new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const [employees, contractors, lines, pays, auditTrail] = await Promise.all([
    db.employee.groupBy({ by: ["status"], where: { companyId }, _count: true }),
    db.contractor.count({ where: { companyId, status: "ACTIVE" } }),
    db.payRunLine.findMany({ where: { grossCents: { gt: 0 }, payRun: { companyId, status: "PAID", payday: { gte: from, lt: to } } }, select: { employeeId: true }, distinct: ["employeeId"] }),
    db.contractorPayment.findMany({ where: { contractor: { companyId }, paidOn: { gte: from, lt: to }, OR: [{ payRunId: null }, { payRun: { status: "PAID" } }] }, select: { contractorId: true }, distinct: ["contractorId"] }),
    db.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const count = (s: string) => employees.find((e) => e.status === s)?._count ?? 0;
  const addOns = c.modules.map((x) => (x.addOn === "PTO" ? "pto" : "time_tracking") as AddOnKey);
  const bill = companyBilling({ paidThisMonth: lines.length + pays.length, activePeople: count("ACTIVE") + contractors, addOns });
  const actors = new Map((await db.user.findMany({ where: { id: { in: auditTrail.map((a) => a.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <p className="small"><a href="/admin">← All companies</a></p>
      <h1 className="admin-title">{c.legalName}</h1>
      {c.tradeName && <p className="muted">Doing business as {c.tradeName}</p>}
      <div className="actions">
        <a href={`/app/${c.id}`}><button type="button">Open their account (read-only)</button></a>
        <a href={`/app/${c.id}/settings`}>Their settings page</a>
        <a href={`/app/${c.id}/filings`}>Filings archive ({c._count.filings})</a>
      </div>

      <div className="stats">
        <div className="stat"><span className="small muted">Monthly subscription (run rate)</span><b>{usd(bill.projected.total)}</b><span className="small muted">{bill.projected.tierRange ? `tier ${bill.projected.tier}, ${bill.projected.tierRange.from}–${bill.projected.tierRange.to} people` : "nobody active"}</span></div>
        <div className="stat"><span className="small muted">Billed so far this month</span><b>{usd(bill.monthToDate.total)}</b><span className="small muted">{lines.length + pays.length} people paid</span></div>
        <div className="stat"><span className="small muted">Employees</span><b>{count("ACTIVE")}</b><span className="small muted">{count("ONBOARDING")} onboarding, {count("TERMINATED")} terminated</span></div>
        <div className="stat"><span className="small muted">Contractors</span><b>{contractors}</b></div>
      </div>

      <h2>Subscription</h2>
      <table>
        <tbody>
          <tr><td>Base plan</td><td>{priceLabel()}, people paid in the month</td><td className="num">{usd(bill.projected.basePrice)}</td></tr>
          {bill.projected.addOns.map((a) => <tr key={a.key}><td>Add-on</td><td>{a.name}</td><td className="num">{usd(a.price)}</td></tr>)}
          {!bill.projected.addOns.length && <tr><td>Add-ons</td><td className="muted">None</td><td /></tr>}
          <tr><th colSpan={2}>Monthly total</th><th className="num">{usd(bill.projected.total)}</th></tr>
        </tbody>
      </table>

      <h2>Service</h2>
      <Notice error={error} ok={ok} />
      <p>{MODE_LABEL[c.serviceMode]}. Features on: {FEATURE_KEYS.filter((k) => featuresFor(c)[k]).map((k) => FEATURES[k].label).join(", ") || "none"}.</p>
      <form action={setServiceMode} className="actions">
        <input type="hidden" name="companyId" value={c.id} />
        <input type="hidden" name="serviceMode" value={c.serviceMode === "MANAGED" ? "SELF_SERVE" : "MANAGED"} />
        <button type="submit" className="secondary">{c.serviceMode === "MANAGED" ? "Switch to self-serve" : "Switch to managed by the payroll desk"}</button>
        <span className="small muted">Switching resets the company&apos;s feature switches to that mode&apos;s defaults.</span>
      </form>

      <h2>Bureau</h2>
      <p className="small muted">Payroll staff only see companies in their own bureau. With no bureau, only White Oak admins can open this company.</p>
      <form action={setCompanyBureau} className="actions">
        <input type="hidden" name="companyId" value={c.id} />
        <select name="bureauId" defaultValue={c.bureauId ?? ""} aria-label="Bureau">
          <option value="">No bureau (White Oak admins only)</option>
          {bureaus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="submit" className="secondary">Save bureau</button>
      </form>

      <h2>Company settings</h2>
      <table>
        <tbody>
          <tr><td>Legal name</td><td>{c.legalName}</td></tr>
          <tr><td>EIN</td><td>{c.ein}</td></tr>
          <tr><td>Address</td><td>{c.addressLine1}, {c.city}, {c.state} {c.zip}</td></tr>
          <tr><td>Funding bank</td><td>{c.bankLast4 ? `${c.bankName ?? "Bank"} ····${c.bankLast4}` : <span className="muted">Not set</span>}</td></tr>
          <tr><td>941 deposit schedule</td><td>{c.depositSchedule === "SEMIWEEKLY" ? "Semiweekly" : "Monthly"}</td></tr>
          <tr><td>Next check number</td><td>{c.nextCheckNumber}</td></tr>
          <tr><td>Signed up</td><td>{prettyDate(c.createdAt)}</td></tr>
        </tbody>
      </table>
      <h3>State tax accounts</h3>
      {c.stateAccounts.length ? (
        <table>
          <thead><tr><th>State</th><th>Withholding #</th><th>Unemployment #</th><th className="num">SUI rate</th></tr></thead>
          <tbody>{c.stateAccounts.map((s) => <tr key={s.id}><td>{s.state}</td><td>{s.withholdingAccount ?? "—"}</td><td>{s.unemploymentAccount ?? "—"}</td><td className="num">{(s.suiRate * 100).toFixed(2)}%</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">None entered.</p>}
      <h3>Pay schedules</h3>
      {c.paySchedules.length ? (
        <ul>{c.paySchedules.map((s) => <li key={s.id}>{s.name}: {FREQ[s.frequency]}, payday {prettyDate(s.anchorPayday)} and onward</li>)}</ul>
      ) : <p className="muted">None yet.</p>}
      <h3>Team logins</h3>
      <ul>{c.memberships.map((mb) => <li key={mb.id}>{mb.user.name} <span className="muted">({mb.user.email})</span> · {ROLE[mb.role]}</li>)}</ul>

      <h2>Recent pay runs</h2>
      {c.payRuns.length ? (
        <table>
          <thead><tr><th>Payday</th><th>Status</th><th className="num">Gross</th><th className="num">Employer taxes</th><th className="num">Cash needed</th></tr></thead>
          <tbody>{c.payRuns.map((r) => <tr key={r.id}><td><a href={`/app/${c.id}/payroll/${r.id}`}>{prettyDate(r.payday)}</a>{r.offCycle ? " (off-cycle)" : ""}</td><td><span className={`badge ${r.status.toLowerCase()}`}>{r.status.toLowerCase()}</span></td><td className="num">{usd(r.grossCents)}</td><td className="num">{usd(r.employerTaxesCents)}</td><td className="num">{usd(r.cashNeededCents)}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">No pay runs yet.</p>}

      <h2>Invoices</h2>
      {c.invoices.length ? (
        <table>
          <thead><tr><th>Month</th><th className="num">People paid</th><th className="num">Tier</th><th className="num">Total</th></tr></thead>
          <tbody>{c.invoices.map((i) => <tr key={i.id}><td>{i.month}</td><td className="num">{i.peoplePaid}</td><td className="num">{i.tier}</td><td className="num">{usd(i.totalCents)}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">No invoices yet.</p>}

      <h2>Activity</h2>
      <table>
        <tbody>
          {auditTrail.map((a) => (
            <tr key={a.id}><td className="small">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td><td>{(a.actorId && actors.get(a.actorId)) ?? "—"}</td><td>{a.action}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
