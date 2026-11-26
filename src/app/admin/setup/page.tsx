import { Field, Notice, messages } from "@/components/ui";
import { setupAdmin } from "../../auth-actions";

export const metadata = { title: "Admin login · White Oak Payroll" };

export default async function AdminSetup({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error } = await messages(searchParams);
  return (
    <>
      <h1>Create your White Oak admin login</h1>
      <p className="muted">
        For White Oak staff only. Your email must be on the admin list, and you need the setup code. If you already
        have a login with this email (for example as a company owner), enter that password and it becomes an admin too.
      </p>
      <Notice error={error} />
      <form action={setupAdmin} className="form narrow">
        <Field label="Your name"><input name="name" autoComplete="name" /></Field>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint="New login: at least 10 characters. Existing login: its current password.">
          <input name="password" type="password" required autoComplete="new-password" />
        </Field>
        <Field label="Setup code"><input name="token" type="password" required /></Field>
        <button type="submit">Create admin login</button>
        <p className="small muted">Already an admin? <a href="/login">Sign in</a></p>
      </form>
    </>
  );
}
