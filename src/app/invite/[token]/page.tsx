import { acceptInvite } from "../../auth-actions";
import { Field, Notice, messages } from "@/components/ui";
import { userForInvite } from "@/lib/app/invites";
import { db } from "@/lib/db";

export const metadata = { title: "Set up your login · White Oak Payroll" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const { error } = await messages(searchParams);
  const user = await userForInvite(token);
  if (!user) {
    return (
      <>
        <h1>This invite link no longer works</h1>
        <p className="muted">It has expired or was already used. If you already chose a password, <a href="/login">sign in</a>. Otherwise ask your employer to resend the invite.</p>
      </>
    );
  }
  const company = user.memberships[0] ? await db.company.findUnique({ where: { id: user.memberships[0].companyId } }) : null;
  return (
    <>
      <h1>Set up your login</h1>
      <p className="muted">
        {company ? `${company.tradeName || company.legalName} invited you to White Oak Payroll. ` : ""}Your login is <b>{user.email}</b>. Choose a password to finish.
      </p>
      <Notice error={error} />
      <form action={acceptInvite} className="form narrow">
        <input type="hidden" name="token" value={token} />
        <Field label="Password" hint="At least 10 characters"><input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Password again"><input name="confirm" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <button type="submit">Set password and sign in</button>
      </form>
    </>
  );
}
