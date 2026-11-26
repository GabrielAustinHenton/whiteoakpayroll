import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { decideAdvance } from "../actions";

export default async function Advances({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "advances");
  const { error, ok } = await messages(searchParams);
  const advances = await db.advance.findMany({ where: { employee: { companyId } }, include: { employee: true }, orderBy: { requestedAt: "desc" } });
  return (
    <>
      <h1>Payday advances</h1>
      <p className="muted">Employees request advances in their portal. They are interest-free and repaid by a fixed deduction on each pay run, never taking pay below minimum wage. Connecticut employees only for now.</p>
      <Notice error={error} ok={ok} />
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
