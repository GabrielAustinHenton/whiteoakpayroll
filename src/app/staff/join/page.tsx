import { Field, Notice, messages } from "@/components/ui";
import { requestStaffAccess } from "../actions";

export const metadata = { title: "Join as payroll staff · White Oak Payroll" };

export default async function JoinStaff({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error } = await messages(searchParams);
  return (
    <>
      <h1>Join White Oak as payroll staff</h1>
      <p className="muted">
        For people who will enter data and run payroll for White Oak&apos;s clients. Create your login here, and a White Oak
        administrator will approve it. You won&apos;t see any client until then. We&apos;ll email you when you&apos;re approved.
      </p>
      <Notice error={error} />
      <form action={requestStaffAccess} className="form narrow">
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
