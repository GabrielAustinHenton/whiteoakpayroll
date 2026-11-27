import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { setContractorStatus } from "../actions";

export default async function People({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role, mode } = await requireArea(companyId, "add_people");
  const staff = canUse(role, "people", mode);
  const { error, ok } = await messages(searchParams);
  const employees = await db.employee.findMany({ where: { companyId }, orderBy: [{ status: "asc" }, { lastName: "asc" }] });
  const contractors = await db.contractor.findMany({ where: { companyId }, orderBy: { legalName: "asc" } });
  const base = `/app/${companyId}/people`;
  return (
    <>
      <h1>People</h1>
      <Notice error={error} ok={ok} />
      <div className="actions">
        <a href={`${base}/new`}><button type="button">Add employee</button></a>
        {staff && <a href={`${base}/contractors/new`}><button type="button" className="secondary">Add contractor</button></a>}
      </div>
      <h2>Employees</h2>
      {!staff && <p className="small muted">Add new hires here with their W-4 and I-9 details. White Oak reviews each new employee, keeps their records up to date and runs payroll. To change someone's pay or let someone go, contact White Oak.</p>}
      {employees.length === 0 ? <p className="muted">No employees yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Work state</th><th>Pay</th><th>Hired</th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{staff ? <a href={`${base}/${e.id}`}>{e.firstName} {e.lastName}</a> : `${e.firstName} ${e.lastName}`}</td>
                  <td>
                    <span className={`badge ${e.status.toLowerCase()}`}>{e.status.toLowerCase()}</span>
                    {e.status === "ONBOARDING" && <span className="small muted"> {e.selfOnboardingInvitedAt && !e.selfOnboardingDoneAt ? "waiting on them" : !e.i9CompletedAt ? "I-9 Section 2 needed" : ""}</span>}
                  </td>
                  <td>{e.workState}</td>
                  <td>{e.payBasis === "HOURLY" ? `${usd(e.payRateCents)}/hr` : `${usd(e.payRateCents)}/yr`}</td>
                  <td>{prettyDate(e.hireDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Contractors</h2>
      {contractors.length === 0 ? <p className="muted">No contractors yet. Contractors get a 1099-NEC at year end; no taxes are withheld.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>TIN</th><th>W-9</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {contractors.map((k) => (
                <tr key={k.id}>
                  <td>{k.legalName}{k.businessName ? ` (${k.businessName})` : ""}</td>
                  <td>{k.tinType.toUpperCase()} ending {k.tin.slice(-4)}</td>
                  <td>{k.w9ReceivedAt ? "Received" : "Missing"}</td>
                  <td><span className={`badge ${k.status.toLowerCase()}`}>{k.status.toLowerCase()}</span></td>
                  <td>
                    {staff && <form action={setContractorStatus} className="inline">
                      <input type="hidden" name="companyId" value={companyId} />
                      <input type="hidden" name="contractorId" value={k.id} />
                      <input type="hidden" name="status" value={k.status === "TERMINATED" ? "ACTIVE" : "TERMINATED"} />
                      <button type="submit" className="link">{k.status === "TERMINATED" ? "Reactivate" : "End"}</button>
                    </form>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
