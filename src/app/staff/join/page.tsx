import { Field, Notice, messages } from "@/components/ui";
import { requestStaffAccess } from "../actions";
import { db } from "@/lib/db";

export const metadata = { title: "Join as payroll staff · White Oak Payroll" };

export default async function JoinStaff({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error, sp } = await messages(searchParams);
  const bureauId = typeof sp.bureau === "string" ? sp.bureau : "";
  const bureau = bureauId ? await db.bureau.findUnique({ where: { id: bureauId }, select: { id: true, name: true } }) : null;
  return (
    <>
      <h1>{bureau ? `Join ${bureau.name} as payroll staff` : "Join White Oak as payroll staff"}</h1>
      <p className="muted">
        For people who will enter data and run payroll for {bureau ? `${bureau.name}'s` : "White Oak's"} clients. Create your login
        here, and {bureau ? `${bureau.name}'s owner or a White Oak administrator` : "a White Oak administrator"} will approve it. You
        won&apos;t see any client until then. We&apos;ll email you when you&apos;re approved.
      </p>
      {bureauId && !bureau && <p className="notice">This join link isn&apos;t valid any more. Ask for a new one.</p>}
      <Notice error={error} />
      <form action={requestStaffAccess} className="form narrow">
        {bureau && <input type="hidden" name="bureau" value={bureau.id} />}
        <Field label="Your name"><input name="name" autoComplete="name" required /></Field>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint="At least 10 characters. If this email already has a White Oak login, enter that password.">
          <input name="password" type="password" required autoComplete="new-password" />
        </Field>
        <Field label="Password again"><input name="confirm" type="password" autoComplete="new-password" /></Field>
        <Field label="Note for the administrator (optional)" hint="For example, who asked you to sign up.">
          <textarea name="note" rows={3} maxLength={500} />
        </Field>
        <button type="submit">Ask to join</button>
        <p className="small muted">Already approved? <a href="/login">Sign in</a>. Running your own company&apos;s payroll? <a href="/signup">Set up your company</a>.</p>
      </form>
    </>
  );
}
