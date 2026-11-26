import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, messages } from "@/components/ui";
import { inviteTeammate, removeTeammate } from "../actions";

const LABEL = { CLIENT_OWNER: "Owner (full access)", CLIENT_HR: "HR (onboard and offboard only)", EMPLOYEE: "Employee portal", PLATFORM_ADMIN: "White Oak admin" } as const;

export default async function Team({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "team");
  const { error, ok } = await messages(searchParams);
  const members = await db.membership.findMany({ where: { companyId, role: { not: "EMPLOYEE" } }, include: { user: true } });
  return (
    <>
      <h1>Team access</h1>
      <p className="muted">HR users can add, edit and offboard employees and contractors. They cannot see pay runs, bank details, tax filings or billing.</p>
      <Notice error={error} ok={ok} />
      <table>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.user.name}</td><td>{m.user.email}</td><td>{LABEL[m.role]}</td>
              <td>
                <form action={removeTeammate} className="inline">
                  <input type="hidden" name="companyId" value={companyId} />
                  <input type="hidden" name="membershipId" value={m.id} />
                  <button type="submit" className="link small">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Add someone</h2>
      <form action={inviteTeammate} className="form">
        <input type="hidden" name="companyId" value={companyId} />
        <div className="row">
          <Field label="Name"><input name="name" required /></Field>
          <Field label="Email"><input name="email" type="email" required /></Field>
          <Field label="Access">
            <select name="role" defaultValue="CLIENT_HR">
              <option value="CLIENT_HR">HR (onboard and offboard only)</option>
              <option value="CLIENT_OWNER">Owner (full access)</option>
            </select>
          </Field>
        </div>
        <button type="submit">Add</button>
      </form>
    </>
  );
}
