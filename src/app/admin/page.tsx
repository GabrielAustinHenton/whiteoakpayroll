import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { loginStatus } from "@/lib/app/invites";
import { sendStaffInvite } from "../ops/actions";
import { approveStaff, denyStaff, removeStaff } from "../staff/actions";
import { createBureau, setStaffBureau } from "./actions";
import { STAFF_STATUS_LABEL } from "@/lib/app/staff-requests";
import { adminEmails, staffEmails } from "@/lib/auth/admins";
import { loadPortal } from "@/lib/app/admin-metrics";
import { PRICING, priceLabel } from "@/lib/pricing";
import { Notice, messages, prettyDate, usd } from "@/components/ui";

export const metadata = { title: "Admin · White Oak Payroll" };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { overdue: "Overdue", due_soon: "Due soon", upcoming: "Upcoming" } as const;
const KIND_LABEL = { payroll: "Payroll", compliance: "Compliance", setup: "Setup", advances: "Advances" } as const;
const ADDON_LABEL = { PTO: "PTO", TIME_TRACKING: "Time Tracking" } as const;
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireAdmin();
  const { sp, error, ok } = await messages(searchParams);
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const p = await loadPortal();
  const rows = q
    ? p.rows.filter((r) => [r.name, r.state, r.owner?.email ?? "", r.owner?.name ?? ""].some((s) => s.toLowerCase().includes(q)))
    : p.rows;
  const [admins, access] = await Promise.all([
    db.user.findMany({ where: { isPlatformAdmin: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true } }),
    db.auditLog.findMany({ where: { action: { startsWith: "admin." } }, orderBy: { createdAt: "desc" }, take: 15, include: { company: { select: { legalName: true } } } }),
  ]);
  const allow = adminEmails();
  const staffList = staffEmails();
  const [staffUsers, requests] = await Promise.all([
    db.user.findMany({ where: { email: { in: staffList } } }),
    db.user.findMany({ where: { staffStatus: { not: null } }, orderBy: { staffRequestedAt: "desc" } }),
  ]);
  const bureaus = await db.bureau.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { companies: true, staff: true } } } });
  const bureauName = new Map(bureaus.map((b) => [b.id, b.name]));
  const BureauSelect = ({ value, required }: { value?: string | null; required?: boolean }) => (
    <select name="bureauId" defaultValue={value ?? ""} required={required} aria-label="Bureau">
      <option value="">{required ? "Choose bureau…" : "No bureau (sees no clients)"}</option>
      {bureaus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
  const pending = requests.filter((r) => r.staffStatus === "PENDING");
  const approved = requests.filter((r) => r.staffStatus === "APPROVED" && !staffList.includes(r.email));
  const closed = requests.filter((r) => r.staffStatus === "DENIED" || r.staffStatus === "REMOVED");
  const names = new Map(admins.map((a) => [a.id, a.name]));
  const maxTrend = Math.max(1, ...p.trend.map((t) => t.totalCents));
  const overdue = p.deadlines.filter((d) => d.status === "overdue").length;

  return (
    <>
      <h1 className="admin-title">White Oak admin</h1>
      <Notice error={error} ok={ok} />
      <p className="muted small">Signed in as {user.name}. Opening a client shows their account read-only; every admin visit is logged.</p>

      <div className="stats">
        <div className="stat"><span className="small muted">Monthly subscriptions (run rate)</span><b>{usd(p.totals.projectedCents)}</b><span className="small muted">{p.totals.payingCompanies} paying of {p.totals.companies} companies</span></div>
        <div className="stat"><span className="small muted">Billed so far in {monthName(p.month)}</span><b>{usd(p.totals.monthToDateCents)}</b><span className="small muted">people actually paid this month</span></div>
        <div className="stat"><span className="small muted">Billed for {monthName(p.lastMonth)}</span><b>{usd(p.totals.lastMonthCents)}</b></div>
        <div className="stat"><span className="small muted">People on payroll</span><b>{p.totals.activeEmployees}</b><span className="small muted">employees, plus {p.totals.contractors} contractors</span></div>
        <div className="stat"><span className="small muted">Advances outstanding</span><b>{usd(p.totals.advancesOutstandingCents)}</b></div>
        <div className="stat"><span className="small muted">Filings overdue</span><b>{overdue}</b><span className="small muted">{p.alerts.length} other alerts</span></div>
      </div>
      <p className="small muted">
        Run rate = each company&apos;s monthly price if all its active people are paid this month ({priceLabel()}, add-ons
        at their listed price). Prices are placeholders and no card is charged in preview.
      </p>

      <h2>Client companies</h2>
      <form className="actions" method="get">
        <input name="q" defaultValue={q} placeholder="Search name, state, owner" aria-label="Search companies" style={{ width: "18rem" }} />
        <button type="submit" className="secondary">Search</button>
        {q && <a href="/admin">Clear</a>}
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th><th>Owner</th><th>State</th><th>Signed up</th>
              <th className="num">Employees</th><th className="num">Contractors</th><th>Plan</th>
              <th className="num">Monthly</th><th className="num">This month so far</th><th className="num">Last month</th><th>Last payday</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><a href={`/admin/companies/${r.id}`}>{r.name}</a>{r.bureauId && bureauName.get(r.bureauId) ? <><br /><span className="small muted">{bureauName.get(r.bureauId)}</span></> : null}</td>
                <td className="small">{r.owner ? <>{r.owner.name}<br /><span className="muted">{r.owner.email}</span></> : "—"}</td>
                <td>{r.state}</td>
                <td>{prettyDate(r.createdAt)}</td>
                <td className="num">{r.activeEmployees}{r.onboarding ? <span className="small muted"> +{r.onboarding} onboarding</span> : null}</td>
                <td className="num">{r.contractors}</td>
                <td className="small">
                  {r.projected.tierRange ? `Tier ${r.projected.tier} (${r.projected.tierRange.from}–${r.projected.tierRange.to})` : "Nobody active"}
                  {r.addOns.map((a) => <span key={a} className="badge" style={{ marginLeft: 4 }}>{ADDON_LABEL[a]}</span>)}
                </td>
                <td className="num"><b>{usd(r.projected.total)}</b></td>
                <td className="num">{usd(r.monthToDate.total)}</td>
                <td className="num">{usd(r.lastMonthCents)}</td>
                <td>{r.lastPayday ? prettyDate(r.lastPayday) : "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="muted">{q ? "No company matches." : "No companies have signed up yet."}</td></tr>}
          </tbody>
          {rows.length > 1 && !q && (
            <tfoot>
              <tr><th colSpan={7}>Total</th><th className="num">{usd(p.totals.projectedCents)}</th><th className="num">{usd(p.totals.monthToDateCents)}</th><th className="num">{usd(p.totals.lastMonthCents)}</th><th /></tr>
            </tfoot>
          )}
        </table>
      </div>

      <h2>Needs attention</h2>
      {p.alerts.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Type</th><th>What</th></tr></thead>
            <tbody>
              {p.alerts.map((a, i) => (
                <tr key={i}><td><a href={`/admin/companies/${a.companyId}`}>{a.companyName}</a></td><td><span className="badge">{KIND_LABEL[a.kind]}</span></td><td><a href={a.href}>{a.text}</a></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">Nothing needs attention.</p>}

      <h2>Filing deadlines across clients</h2>
      <p className="small muted">Returns for periods with paid payroll that are not marked filed yet, due in the next 75 days or already past due.</p>
      {p.deadlines.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Due</th><th>Company</th><th>Form</th><th>Period</th><th>Status</th></tr></thead>
            <tbody>
              {p.deadlines.map((d, i) => (
                <tr key={i}>
                  <td>{prettyDate(new Date(`${d.due}T00:00:00Z`))}</td>
                  <td><a href={`/admin/companies/${d.companyId}`}>{d.companyName}</a></td>
                  <td><a href={`/app/${d.companyId}/filings`}>{d.form}</a></td>
                  <td>{d.period}</td>
                  <td>
                    <span className={`badge ${d.status === "upcoming" ? "" : "draft"}`} style={d.status === "overdue" ? { color: "var(--danger)", borderColor: "var(--danger)" } : undefined}>{STATUS_LABEL[d.status]}</span>
                    <span className="small muted"> {d.generated ? "generated, not marked filed" : "not generated"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">No returns due.</p>}

      <h2>Billed by month</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Month</th><th className="num">Billed</th><th className="num">Paying companies</th><th style={{ width: "45%" }}><span className="sr-only">Bar</span></th></tr></thead>
          <tbody>
            {p.trend.map((t) => (
              <tr key={t.month}>
                <td>{monthName(t.month)}{t.month === p.month ? <span className="small muted"> (so far)</span> : null}</td>
                <td className="num">{usd(t.totalCents)}</td>
                <td className="num">{t.companies}</td>
                <td title={`${monthName(t.month)}: ${usd(t.totalCents)}`}>
                  <span className="bar" style={{ width: `${(t.totalCents / maxTrend) * 100}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>White Oak admins</h2>
      <ul>
        {admins.map((a) => <li key={a.id}>{a.name} <span className="muted">({a.email})</span></li>)}
      </ul>
      <p className="small muted">
        {allow
          ? `Admin list (ADMIN_EMAILS) has ${allow.length} email${allow.length === 1 ? "" : "s"}. Remove an email there to revoke that person's admin access.`
          : "ADMIN_EMAILS is not set, so anyone with the setup code can become an admin. Set it in Vercel to lock this down."}{" "}
        New admins sign up at <a href="/admin/setup">/admin/setup</a>.
      </p>

      <h2 id="bureaus">Bureaus</h2>
      <p className="small muted">
        A bureau is a payroll firm (for example a partner&apos;s) that runs payroll for its own clients. Its staff see only the
        companies in that bureau. Companies with no bureau are White Oak&apos;s own: only admins can open them. Put a company in a
        bureau from its page (click its name above).
      </p>
      {bureaus.length > 0 && (
        <table>
          <thead><tr><th>Bureau</th><th className="num">Companies</th><th className="num">Staff</th></tr></thead>
          <tbody>
            {bureaus.map((b) => <tr key={b.id}><td>{b.name}</td><td className="num">{b._count.companies}</td><td className="num">{b._count.staff}</td></tr>)}
          </tbody>
        </table>
      )}
      <form action={createBureau} className="actions">
        <input name="name" placeholder="Bureau name" aria-label="Bureau name" required style={{ width: "16rem" }} />
        <button type="submit" className="secondary">Add bureau</button>
      </form>

      <h2 id="staff-requests">Payroll staff</h2>
      <p className="small muted">
        Staff work from the <a href="/ops">payroll desk</a>, only in their own bureau&apos;s client companies: they add clients,
        enter employees and hours, run payroll and print. They are not admins, and they must turn on two-step sign-in. New
        staff ask to join at <a href="/staff/join">/staff/join</a> and wait here; until an admin approves them into a bureau
        they have no access. Staff with no bureau see no clients.
      </p>

      <h3>Waiting for approval</h3>
      {pending.length === 0 ? <p className="small muted">Nobody is waiting.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Asked</th><th>Note</th><th /></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}<br /><span className="small muted">{r.email}</span></td>
                  <td className="small">{r.staffRequestedAt ? prettyDate(r.staffRequestedAt) : ""}</td>
                  <td className="small">{r.staffRequestNote ?? <span className="muted">—</span>}</td>
                  <td>
                    <div className="actions">
                      <form action={approveStaff} className="actions"><input type="hidden" name="userId" value={r.id} /><BureauSelect required /><button type="submit">Approve</button></form>
                      <form action={denyStaff}><input type="hidden" name="userId" value={r.id} /><button type="submit" className="secondary">Deny</button></form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Current staff</h3>
      {staffList.length === 0 && approved.length === 0 ? <p className="small muted">No staff yet.</p> : (
        <table>
          <tbody>
            {staffList.map((email) => {
              const u = staffUsers.find((x) => x.email === email);
              const st = loginStatus(u);
              return (
                <tr key={email}>
                  <td>{u?.name ?? ""} <span className="muted">({email})</span></td>
                  <td className="small muted">{st.label} · set in Vercel (STAFF_EMAILS)</td>
                  <td>
                    {u && (
                      <form action={setStaffBureau} className="actions">
                        <input type="hidden" name="userId" value={u.id} />
                        <BureauSelect value={u.bureauId} />
                        <button type="submit" className="secondary">Save</button>
                      </form>
                    )}
                    {(!u || st.pending) && (
                      <form action={sendStaffInvite} className="actions">
                        <input type="hidden" name="email" value={email} />
                        {!u && <input name="name" placeholder="Their name" aria-label="Their name" required style={{ width: "12rem" }} />}
                        <button type="submit" className="secondary">{u ? "Resend invite" : "Send login invite"}</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {approved.map((u) => (
              <tr key={u.id}>
                <td>{u.name} <span className="muted">({u.email})</span></td>
                <td className="small muted">
                  Approved{u.staffDecidedAt ? ` ${prettyDate(u.staffDecidedAt)}` : ""}{u.staffDecidedById && names.get(u.staffDecidedById) ? ` by ${names.get(u.staffDecidedById)}` : ""}
                  {u.totpEnabledAt ? "" : " · two-step not set up yet"}
                </td>
                <td>
                  <div className="actions">
                    <form action={setStaffBureau} className="actions">
                      <input type="hidden" name="userId" value={u.id} />
                      <BureauSelect value={u.bureauId} />
                      <button type="submit" className="secondary">Save</button>
                    </form>
                    <form action={removeStaff}><input type="hidden" name="userId" value={u.id} /><button type="submit" className="danger">Remove access</button></form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted">Staff listed in STAFF_EMAILS are removed by taking the email out of that list in Vercel.</p>

      {closed.length > 0 && (
        <details>
          <summary className="small">Denied or removed ({closed.length})</summary>
          <table>
            <tbody>
              {closed.map((u) => (
                <tr key={u.id}>
                  <td>{u.name} <span className="muted">({u.email})</span></td>
                  <td className="small muted">{STAFF_STATUS_LABEL[u.staffStatus!]}{u.staffDecidedAt ? ` ${prettyDate(u.staffDecidedAt)}` : ""}</td>
                  <td><form action={approveStaff} className="actions"><input type="hidden" name="userId" value={u.id} /><BureauSelect value={u.bureauId} required /><button type="submit" className="secondary">Approve</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <h2>Admin access log</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {access.map((a) => (
              <tr key={a.id}>
                <td className="small">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                <td>{(a.actorId && names.get(a.actorId)) ?? "—"}</td>
                <td>{a.action.replace("admin.", "").replace("_", " ")}</td>
                <td>{a.company?.legalName ?? ""}</td>
                <td className="small muted">{a.detail && typeof a.detail === "object" && "reason" in a.detail ? String((a.detail as { reason: unknown }).reason) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
