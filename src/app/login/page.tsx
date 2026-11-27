import { login } from "../auth-actions";
import { Field, Notice, messages } from "@/components/ui";

export const metadata = { title: "Sign in · White Oak Payroll" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error } = await messages(searchParams);
  return (
    <>
      <h1>Sign in</h1>
      <Notice error={error} />
      <form action={login} className="form narrow">
        <Field label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password"><input name="password" type="password" required autoComplete="current-password" /></Field>
        <p className="small"><a href="/forgot">Forgot password?</a></p>
        <button type="submit">Sign in</button>
        <p className="small muted">New company? <a href="/signup">Set up your company</a></p>
        <p className="small muted">Joining White Oak as payroll staff? <a href="/staff/join">Ask to join</a></p>
        <p className="small muted">White Oak admins: <a href="/admin/setup">create your admin login</a></p>
      </form>
    </>
  );
}
