import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { prettyDate, usd } from "@/components/ui";

export default async function Admin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/admin/claim");
  const companies = await db.company.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { employees: true, contractors: true, payRuns: true, filings: true } }, invoices: { orderBy: { month: "desc" }, take: 1 } },
  });
  const recent = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { company: true } });
  return (
    <>
      <h1>White Oak admin</h1>
      <h2>Client companies</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Company</th><th>State</th><th>Signed up</th><th className="num">Employees</th><th className="num">Contractors</th><th className="num">Pay runs</th><th className="num">Forms</th><th className="num">Latest bill</th></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td><a href={`/app/${c.id}`}>{c.legalName}</a></td>
                <td>{c.state}</td>
                <td>{prettyDate(c.createdAt)}</td>
                <td className="num">{c._count.employees}</td>
                <td className="num">{c._count.contractors}</td>
                <td className="num">{c._count.payRuns}</td>
                <td className="num"><a href={`/app/${c.id}/filings`}>{c._count.filings}</a></td>
                <td className="num">{c.invoices[0] ? usd(c.invoices[0].totalCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Recent activity</h2>
      <table>
        <tbody>
          {recent.map((a) => (
            <tr key={a.id}><td className="small">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td><td>{a.company?.legalName ?? ""}</td><td>{a.action}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
