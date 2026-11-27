import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { Field, Notice, messages, prettyDate, usd } from "@/components/ui";
import { canOfferAdvance } from "@/lib/payroll/advances";
import type { LaunchState } from "@/lib/payroll/schedules";
import { featuresFor } from "@/lib/app/features";
import { requestAdvance } from "./actions";

export default async function Me({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { error, ok } = await messages(searchParams);
  const e = await db.employee.findUnique({
    where: { userId: user.id },
    include: { company: true, advances: { orderBy: { requestedAt: "desc" } }, payRunLines: { where: { payRun: { status: "PAID" } }, include: { payRun: true }, orderBy: { payRun: { payday: "desc" } } } },
  });
  if (!e) {
    return (
      <>
        <h1>My pay</h1>
        <p className="muted">Your login is not linked to an employee record. If you run a company, go to <a href="/app">My company</a>.</p>
      </>
    );
  }
  const w2s = await db.filing.findMany({ where: { companyId: e.companyId, form: "W-2" }, select: { id: true, period: true, data: true } });
  const mine = w2s.filter((f) => (f.data as { employeeId?: string }).employeeId === e.id);
  const f = featuresFor(e.company);
  const advancesOk = canOfferAdvance(e.workState as LaunchState);
  const company = e.company.tradeName ?? e.company.legalName;
  return (
    <>
      <h1>My pay · {company}</h1>
      <Notice error={error} ok={ok} />
      {f.employeePortal && !e.ssn && e.status !== "TERMINATED" && (
        <div className="card">
          <p><b>Finish your new-hire paperwork</b> so {company} can pay you: your details, W-4, state tax form and direct deposit.</p>
          <a href="/me/details"><button type="button">Start (about 10 minutes)</button></a>
        </div>
      )}
      {f.employeePortal && e.ssn && (
        <p className="small"><a href="/me/details">Update my address, tax withholding or bank account</a>{e.bankLast4 ? ` · Paid by direct deposit to account ending ${e.bankLast4}` : e.paymentMethod === "CHECK" ? " · Paid by paper check" : ""}</p>
      )}
      <h2>Paystubs</h2>
      {e.payRunLines.length === 0 ? <p className="muted">No paychecks yet.</p> : (
        <table>
          <thead><tr><th>Payday</th><th className="num">Gross</th><th className="num">Net</th><th></th></tr></thead>
          <tbody>
            {e.payRunLines.map((l) => (
              <tr key={l.id}>
                <td>{prettyDate(l.payRun.payday)}</td>
                <td className="num">{usd(l.grossCents)}</td>
                <td className="num">{usd(l.netCents)}</td>
                <td><a href={`/app/${e.companyId}/paystubs/${l.id}`}>View</a> · <a href={`/api/paystubs/${l.id}`}>PDF</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>W-2s</h2>
      {mine.length === 0 ? <p className="muted">Your W-2 appears here by January 31.</p> : (
        <ul>{mine.map((f) => <li key={f.id}><a href={`/api/filings/${f.id}`}>{f.period} Form W-2 (PDF)</a></li>)}</ul>
      )}
      {f.advances && <>
      <h2>Payday advance</h2>
      {e.advances.map((a) => (
        <p key={a.id}>{usd(a.principalCents)} requested {prettyDate(a.requestedAt)}: {a.status.toLowerCase()}, {usd(a.repaidCents)} repaid.</p>
      ))}
      {advancesOk ? (
        <form action={requestAdvance} className="form">
          <div className="row">
            <Field label="Amount"><input name="amount" inputMode="decimal" required /></Field>
            <Field label="Repay per pay run"><input name="installment" inputMode="decimal" required /></Field>
          </div>
          <p className="small">
            Repayment authorization: I authorize {e.company.legalName} to deduct the amount above from each paycheck until this
            advance is repaid. There is no interest and no fee, and no deduction will take my pay below minimum wage.
          </p>
          <Field label="Type your full name to sign"><input name="signature" required /></Field>
          <button type="submit">Request advance</button>
        </form>
      ) : (
        <p className="muted">Advances are not available for {e.workState} employees yet.</p>
      )}
      </>}
    </>
  );
}
