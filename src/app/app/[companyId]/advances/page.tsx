import { db } from "@/lib/db";
import { ADVANCE_ENABLED_STATES } from "@/lib/payroll/advances";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, messages, prettyDate, usd } from "@/components/ui";
import { decideAdvance, recordAdvance } from "../actions";

export default async function Advances({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "advances");
  const { error, ok } = await messages(searchParams);
  const eligible = await db.employee.findMany({ where: { companyId, status: "ACTIVE", workState: { in: [...ADVANCE_ENABLED_STATES] } }, orderBy: { lastName: "asc" } });
  const advances = await db.advance.findMany({ where: { employee: { companyId } }, include: { employee: true }, orderBy: { requestedAt: "desc" } });
  return (
    <>
      <h1>Payday advances</h1>
      <p className="muted">Interest-free advances on pay, repaid by a fixed deduction on each pay run that never takes pay below minimum wage. Connecticut employees only for now.</p>
      <Notice error={error} ok={ok} />
      <div className="card">
        <p><b>Record an advance request</b></p>
        <p className="small muted">
          The employee asks through their employer and signs the written repayment authorization (keep the signed copy). Enter it here, then approve it below.
          Only active Connecticut employees are listed.
        </p>
        {eligible.length === 0 ? <p className="small">No active Connecticut employees.</p> : (
          <form action={recordAdvance} className="form">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="row">
              <Field label="Employee">
                <select name="employeeId" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  {eligible.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                </select>
              </Field>
              <Field label="Advance ($)" hint="Up to $1,000"><input name="amount" inputMode="decimal" required /></Field>
              <Field label="Repay per pay run ($)"><input name="installment" inputMode="decimal" required /></Field>
            </div>
            <div className="row">
              <Field label="Name as signed on the authorization"><input name="signedName" required /></Field>
              <Field label="Date signed"><input name="signedOn" type="date" required /></Field>
            </div>
            <button type="submit">Record request</button>
          </form>
        )}
      </div>
      <h2>Requests</h2>
      {advances.length === 0 ? <p className="muted">No requests.</p> : (
        <table>
          <thead><tr><th>Employee</th><th>Requested</th><th className="num">Amount</th><th className="num">Per pay run</th><th className="num">Repaid</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {advances.map((a) => (
              <tr key={a.id}>
                <td>{a.employee.firstName} {a.employee.lastName} <span className="small muted">{a.employee.workState}</span></td>
                <td>{prettyDate(a.requestedAt)}</td>
                <td className="num">{usd(a.principalCents)}</td>
                <td className="num">{usd(a.installmentCents)}</td>
                <td className="num">{usd(a.repaidCents)}</td>
                <td><span className="badge">{a.status.toLowerCase()}</span></td>
                <td>{a.status === "REQUESTED" && (
                  <form action={decideAdvance} className="actions">
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="advanceId" value={a.id} />
                    <button name="decision" value="approve" type="submit">Approve</button>
                    <button name="decision" value="decline" type="submit" className="secondary">Decline</button>
                  </form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
