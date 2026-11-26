import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { decideAdvance } from "../actions";
import { loginStatus } from "@/lib/app/invites";

export default async function Advances({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "advances");
  const { error, ok } = await messages(searchParams);
  const employees = await db.employee.findMany({ where: { companyId, status: { not: "TERMINATED" } }, include: { user: true }, orderBy: { lastName: "asc" } });
  const advances = await db.advance.findMany({ where: { employee: { companyId } }, include: { employee: true }, orderBy: { requestedAt: "desc" } });
  return (
    <>
      <h1>Payday advances</h1>
      <p className="muted">Employees request advances in their portal. They are interest-free and repaid by a fixed deduction on each pay run, never taking pay below minimum wage. Connecticut employees only for now.</p>
      <Notice error={error} ok={ok} />
      <div className="card">
        <p><b>How an employee requests an advance</b></p>
        <ol className="small">
          <li>When you add an employee, they get an email inviting them to the employee portal. They click the link and choose a password.</li>
          <li>After that they sign in at whiteoakpayroll.com/login and land on <b>My pay</b>.</li>
          <li>Under <b>Payday advance</b> they enter the amount, how much to repay each pay run, and type their name to sign the repayment authorization.</li>
          <li>The request shows up here for you to approve or decline. Approved advances are repaid automatically on each pay run.</li>
        </ol>
        <p className="small muted">They must be Active (I-9 complete) and work in Connecticut. Other states stay off until counsel signs off.</p>
        <table>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.firstName} {e.lastName}</td>
                <td className="small">{e.workState}{e.workState === "CT" ? "" : " (advances not available)"}{e.status !== "ACTIVE" ? " · onboarding" : ""}</td>
                <td className="small muted">{loginStatus(e.user).label}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
