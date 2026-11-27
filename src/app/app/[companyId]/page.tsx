import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { refreshInvoice } from "@/lib/app/payroll-service";
import { companyTodos } from "@/lib/app/automation";

export default async function Overview({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { error, ok } = await messages(searchParams);
  const { role, mode } = await requireArea(companyId, "dashboard");
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      stateAccounts: true,
      paySchedules: true,
      _count: { select: { employees: true, contractors: true } },
      payRuns: { where: canUse(role, "payroll", mode) ? {} : { status: { in: ["APPROVED", "PAID"] } }, orderBy: { payday: "desc" }, take: 5 },
    },
  });
  const active = await db.employee.count({ where: { companyId, status: "ACTIVE" } });
  const onboarding = await db.employee.count({ where: { companyId, status: "ONBOARDING" } });
  const base = `/app/${companyId}`;
  const owner = canUse(role, "settings", mode);
  const month = new Date().toISOString().slice(0, 7);
  const bill = canUse(role, "reports", mode) ? await refreshInvoice(companyId, month) : null;

  const selfServe = mode === "SELF_SERVE";
  const todos = owner && selfServe ? await companyTodos(companyId) : [];
  const steps = [
    { done: !!c.bankLast4, label: "Add the bank account payroll is paid from", href: `${base}/settings#bank`, owner: true },
    { done: c.stateAccounts.length > 0, label: "Add your state tax accounts and unemployment rate", href: `${base}/settings#states`, owner: true },
    { done: c.paySchedules.length > 0, label: "Create a pay schedule", href: `${base}/settings#schedules`, owner: true },
    { done: c._count.employees > 0, label: "Add employees (or contractors)", href: `${base}/people`, owner: false },
    { done: onboarding === 0 && c._count.employees > 0, label: "Finish onboarding (W-4, state form, I-9) for everyone", href: `${base}/people`, owner: false },
    { done: c.payRuns.some((r) => r.status === "PAID"), label: "Run your first payroll", href: `${base}/payroll`, owner: true },
  ].filter((s) => owner || !s.owner);

  return (
    <>
      <h1>{c.tradeName ?? c.legalName}</h1>
      <Notice error={error} ok={ok} />
      <p className="muted">EIN {c.ein} · {c.city}, {c.state}</p>
      <div className="stats">
        <div className="stat"><b>{active}</b>active employees</div>
        <div className="stat"><b>{onboarding}</b>onboarding</div>
        <div className="stat"><b>{c._count.contractors}</b>contractors</div>
        {bill && (
          <a className="stat" href={`${base}/billing`} style={{ textDecoration: "none", color: "inherit" }}>
            <b>{usd(bill.total)}</b>White Oak fee this month{bill.tierRange ? ` (${bill.peopleCount} ${bill.peopleCount === 1 ? "person" : "people"})` : " (nobody on payroll yet)"}
          </a>
        )}
      </div>
      {owner && selfServe && (
        <>
          {!c.setupCompletedAt && (
            <div className="card">
              <p><b>Finish setting up payroll</b> · {steps.filter((x) => x.done).length} of {steps.length} done</p>
              <p className="small muted">Next: {steps.find((x) => !x.done)?.label ?? "run your first payroll"}.</p>
              <a href={`${base}/setup`}><button type="button">Continue setup</button></a>
            </div>
          )}
          <h2>To do</h2>
          {todos.length === 0 ? <p className="muted">Nothing needs you right now. We&apos;ll email you when a pay run is ready to approve or a deadline is coming up.</p> : (
            <ul className="todos">
              {todos.map((t) => (
                <li key={t.key} className={t.urgent ? "urgent" : ""}>
                  <a href={`${base}${t.href}`}>{t.title}</a>
                  {t.detail && <div className="small muted">{t.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!owner && mode === "MANAGED" && (
        <div className="card">
          <p><b>White Oak runs your payroll.</b> Send hours and changes to your White Oak payroll specialist as usual.</p>
          <p className="small">Here you can <a href={`${base}/people/new`}>add a new employee</a> with their W-4 and I-9 details, and see your <a href={`${base}/payroll`}>pay runs, paystubs and checks</a>, <a href={`${base}/filings`}>tax filings</a> and <a href={`${base}/billing`}>White Oak bill</a>.</p>
        </div>
      )}
      {owner && !selfServe && <h2>Setup</h2>}
      {owner && !selfServe && <ol className="steps">
        {steps.map((s) => (
          <li key={s.label}>
            <span className={s.done ? "done" : "todo"}>{s.done ? "✓" : "○"}</span>
            <a href={s.href}>{s.label}</a>
          </li>
        ))}
      </ol>}
      {canUse(role, "reports", mode) && (
        <>
          <h2>Recent pay runs</h2>
          {c.payRuns.length === 0 ? (
            <p className="muted">No pay runs yet.{owner && <> <a href={`${base}/payroll`}>Start one</a> once setup is done.</>}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Payday</th><th>Status</th><th className="num">Gross</th><th className="num">Cash needed</th></tr></thead>
                <tbody>
                  {c.payRuns.map((r) => (
                    <tr key={r.id}>
                      <td><a href={`${base}/payroll/${r.id}`}>{prettyDate(r.payday)}</a></td>
                      <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status.toLowerCase()}</span></td>
                      <td className="num">{usd(r.grossCents)}</td>
                      <td className="num">{usd(r.cashNeededCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
