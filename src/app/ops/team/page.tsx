import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ownsBureau, requireStaff } from "@/lib/auth/session";
import { appUrl } from "@/lib/email";
import { Notice, messages, prettyDate } from "@/components/ui";
import { approveStaff, denyStaff, removeStaff } from "../../staff/actions";

export const metadata = { title: "Your staff · White Oak Payroll" };
export const dynamic = "force-dynamic";

/** A bureau owner's page: their join link, requests to join their bureau, and their staff. */
export default async function BureauTeam({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireStaff();
  if (user.isPlatformAdmin) redirect("/admin#staff-requests");
  if (!ownsBureau(user)) redirect("/ops");
  const { error, ok } = await messages(searchParams);
  const [bureau, people] = await Promise.all([
    db.bureau.findUniqueOrThrow({ where: { id: user.bureauId! } }),
    db.user.findMany({ where: { bureauId: user.bureauId, staffStatus: { not: null } }, orderBy: { name: "asc" } }),
  ]);
  const pending = people.filter((p) => p.staffStatus === "PENDING");
  const staff = people.filter((p) => p.staffStatus === "APPROVED");
  const joinLink = `${appUrl()}/staff/join?bureau=${bureau.id}`;

  return (
    <>
      <p className="small"><a href="/ops">← Payroll desk</a></p>
      <h1>{bureau.name} staff</h1>
      <Notice error={error} ok={ok} />
      <p className="muted">
        Your staff see only {bureau.name}&apos;s clients. To add someone, send them this link. They create a login and ask to join,
        you get an email, and you approve them here. Until then they have no access.
      </p>
      <p><code style={{ wordBreak: "break-all" }}>{joinLink}</code></p>

      <h2>Waiting for approval</h2>
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
                      <form action={approveStaff}><input type="hidden" name="userId" value={r.id} /><button type="submit">Approve</button></form>
                      <form action={denyStaff}><input type="hidden" name="userId" value={r.id} /><button type="submit" className="secondary">Deny</button></form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Staff</h2>
      <table>
        <tbody>
          {staff.map((u) => (
            <tr key={u.id}>
              <td>{u.name} <span className="muted">({u.email})</span>{u.bureauOwner ? <span className="badge" style={{ marginLeft: 4 }}>Owner</span> : null}</td>
              <td className="small muted">{u.totpEnabledAt ? "Two-step on" : "Two-step not set up yet"}</td>
              <td>
                {!u.bureauOwner && u.id !== user.id && (
                  <form action={removeStaff}><input type="hidden" name="userId" value={u.id} /><button type="submit" className="danger">Remove access</button></form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Staff set up by White Oak through its staff list are managed by White Oak; ask them to change those.</p>
    </>
  );
}
