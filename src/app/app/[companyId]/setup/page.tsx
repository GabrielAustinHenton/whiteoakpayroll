import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { FREQUENCY_LABEL, nextPeriod, type Frequency } from "@/lib/app/periods";
import { currentStep, setupReady, setupSteps } from "@/lib/app/setup";
import { approveBy } from "@/lib/app/todos";
import { featuresFor } from "@/lib/app/features";
import { refreshInvoice } from "@/lib/app/payroll-service";
import { BankForm, CompanyForm, ScheduleForm, StateAccountForm } from "../settings/forms";
import { confirmCompany, startPayRun } from "../actions";

const STATE_NAME: Record<string, string> = { CT: "Connecticut", MA: "Massachusetts", OR: "Oregon", NY: "New York" };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const nice = (d: string) => prettyDate(new Date(`${d}T00:00:00Z`));

/** Guided setup for a self-serve owner: one step at a time, in the order payroll needs it. */
export default async function Setup({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "settings");
  const { error, ok, sp } = await messages(searchParams);
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      stateAccounts: true,
      paySchedules: { include: { payRuns: { where: { offCycle: false, status: { not: "VOIDED" } }, orderBy: { payday: "desc" }, take: 1 } } },
      employees: { where: { status: { not: "TERMINATED" } }, orderBy: { createdAt: "asc" } },
      contractors: { where: { status: "ACTIVE" } },
    },
  });
  const [confirmed, paidRuns] = await Promise.all([
    db.auditLog.count({ where: { companyId, action: { in: ["company.updated", "company.confirmed"] } } }),
    db.payRun.count({ where: { companyId, status: "PAID" } }),
  ]);
  const workStates = [...new Set([c.state, ...c.employees.map((e) => e.workState)])];
  const steps = setupSteps({
    companyConfirmed: confirmed > 0,
    workStates,
    stateAccounts: c.stateAccounts.map((s) => s.state),
    schedules: c.paySchedules.length,
    bank: !!c.bankLast4,
    people: c.employees.length + c.contractors.length,
    paidRuns,
  });
  const step = currentStep(steps, typeof sp.step === "string" ? sp.step : undefined);
  const ready = setupReady(steps);
  if (ready && !c.setupCompletedAt) await db.company.update({ where: { id: companyId }, data: { setupCompletedAt: new Date() } });
  const base = `/app/${companyId}`;
  const here = `${base}/setup`;
  const doneCount = steps.filter((s) => s.done).length;
  const features = featuresFor(c);
  const bill = await refreshInvoice(companyId, iso(new Date()).slice(0, 7));
  const missingStates = workStates.filter((s) => !c.stateAccounts.some((a) => a.state === s));

  return (
    <>
      <h1>Set up payroll</h1>
      <p className="muted">About 15 minutes. Have your EIN, your state tax account numbers and unemployment rate, and your business bank account handy. You can stop anytime; we save each step.</p>
      <Notice error={error} ok={ok} />
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <div className="wizard">
        <ol className="wizard-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`${s.id === step.id ? "current" : ""} ${s.done ? "done" : ""}`}>
              <a href={`${here}?step=${s.id}`}>
                <span className="dot" aria-hidden>{s.done ? "✓" : i + 1}</span>
                <span>{s.title}{s.done && <span className="sr-only"> (done)</span>}</span>
              </a>
            </li>
          ))}
        </ol>

        <div className="wizard-body card">
          <h2>{step.title}</h2>
          <p className="muted">{step.why}</p>

          {step.id === "company" && (
            <>
              <CompanyForm companyId={companyId} c={c} returnTo={here} />
              {!step.done && (
                <form action={confirmCompany} className="actions" style={{ marginTop: 12 }}>
                  <input type="hidden" name="companyId" value={companyId} />
                  <button type="submit" className="secondary">These details are right</button>
                </form>
              )}
            </>
          )}

          {step.id === "states" && (
            <>
              {c.stateAccounts.length > 0 && (
                <ul>{c.stateAccounts.map((a) => <li key={a.id}>{STATE_NAME[a.state] ?? a.state}: unemployment rate {(a.suiRate * 100).toFixed(2)}%{a.withholdingAccount ? `, withholding ${a.withholdingAccount}` : ", withholding account pending"}</li>)}</ul>
              )}
              {missingStates.length > 0 && <p>Next: <b>{missingStates.map((s) => STATE_NAME[s] ?? s).join(", ")}</b>.</p>}
              <details className="help">
                <summary>Don&apos;t have these numbers yet?</summary>
                <p className="small">Register with the state before your first payday: CT at myconneCT and the CT DOL, MA at MassTaxConnect, Oregon with a Combined Employer Registration, NY with the NYS-100. The state mails your unemployment rate; a new employer gets the state&apos;s standard new-employer rate. You can enter the rate now and the account numbers later.</p>
              </details>
              <StateAccountForm companyId={companyId} returnTo={here} defaultState={missingStates[0] ?? c.state} />
            </>
          )}

          {step.id === "schedule" && (
            <>
              {c.paySchedules.length > 0 && <ul>{c.paySchedules.map((s) => <li key={s.id}>{s.name}: {FREQUENCY_LABEL[s.frequency as Frequency]}, first payday {prettyDate(s.anchorPayday)}</li>)}</ul>}
              <p className="small">Most small businesses pay <b>every two weeks</b>. You can add a second schedule later, for example weekly for hourly staff and twice a month for salaried.</p>
              <ScheduleForm companyId={companyId} returnTo={here} first={c.paySchedules.length === 0} />
            </>
          )}

          {step.id === "bank" && (
            <>
              {c.bankLast4 && <p>On file: {c.bankName} ending {c.bankLast4}.</p>}
              <p className="small">Use the business checking account you pay bills from. For each payday we draw net pay and taxes from it 2 business days ahead, then pay employees and the tax agencies. Transfers are simulated until our bank connection is live.</p>
              <BankForm companyId={companyId} c={c} returnTo={here} />
            </>
          )}

          {step.id === "people" && (
            <>
              {c.employees.length + c.contractors.length > 0 ? (
                <ul>
                  {c.employees.map((e) => <li key={e.id}>{e.firstName} {e.lastName} · {e.selfOnboardingInvitedAt && !e.selfOnboardingDoneAt ? "invited to fill in their details" : e.status.toLowerCase()}</li>)}
                  {c.contractors.map((k) => <li key={k.id}>{k.legalName} · contractor</li>)}
                </ul>
              ) : <p>Nobody yet.</p>}
              {c.paySchedules.length === 0 ? (
                <p className="notice">Choose a pay schedule first; everyone is paid on one.</p>
              ) : (
                <div className="actions">
                  <a href={`${base}/people/new`}><button type="button">Add an employee</button></a>
                  <a href={`${base}/people/contractors/new`}><button type="button" className="secondary">Add a contractor</button></a>
                </div>
              )}
              <p className="small muted">
                {features.employeeSelfOnboarding ? "You enter their job and pay; they get an email to fill in their own SSN, W-4, state form and bank account. " : ""}
                Your White Oak fee this month: <b>{usd(bill.total)}</b> for {bill.peopleCount} {bill.peopleCount === 1 ? "person" : "people"}. <a href={`${base}/billing`}>How it&apos;s counted</a>
              </p>
            </>
          )}

          {step.id === "payroll" && (
            <>
              {!ready && <p className="notice">Finish the steps above first: {steps.filter((s) => s.required && !s.done).map((s) => s.title.toLowerCase()).join("; ")}.</p>}
              {ready && c.paySchedules.map((s) => {
                const p = nextPeriod(s.frequency as Frequency, iso(s.anchorPayday), s.payLagDays, s.payRuns[0] ? iso(s.payRuns[0].payday) : null);
                return (
                  <div key={s.id} className="card">
                    <p><b>{s.name}</b>: pays {nice(p.periodStart)} to {nice(p.periodEnd)}, payday <b>{nice(p.payday)}</b>. Approve by <b>{nice(approveBy(p.payday))}</b>.</p>
                    {features.autoDraftPayroll && <p className="small muted">From now on we prepare each pay run a week before payday and email you when it is ready to approve.</p>}
                    <form action={startPayRun}>
                      <input type="hidden" name="companyId" value={companyId} />
                      <input type="hidden" name="payScheduleId" value={s.id} />
                      <button type="submit">Start this pay run now</button>
                    </form>
                  </div>
                );
              })}
              {paidRuns > 0 && <p>You&apos;re all set. <a href={base}>Go to your Overview</a>.</p>}
            </>
          )}

          {step.done && step.id !== "payroll" && (
            <p style={{ marginTop: 16 }}><a href={`${here}?step=${steps[steps.findIndex((s) => s.id === step.id) + 1].id}`}><button type="button">Next step</button></a></p>
          )}
        </div>
      </div>
    </>
  );
}
