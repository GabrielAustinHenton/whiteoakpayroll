import { requireUser } from "@/lib/auth/session";
import { Field, Notice, messages } from "@/components/ui";
import { changePassword } from "../auth-actions";

export default async function Account({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { error, ok } = await messages(searchParams);
  return (
    <>
      <h1>Account</h1>
      <p className="muted">{user.name} · {user.email}</p>
      <Notice error={error} ok={ok} />
      <form action={changePassword} className="form narrow">
        <Field label="Current password"><input name="current" type="password" required /></Field>
        <Field label="New password"><input name="next" type="password" minLength={10} required /></Field>
        <button type="submit">Change password</button>
      </form>
      <h2>Two-step sign-in</h2>
      <p className="muted">{user.totpEnabledAt ? "On. Each sign-in asks for a code from your authenticator app." : "Off. Add a code from your phone so a stolen password alone can't get in."}</p>
      <a className="button secondary" href="/account/two-step">{user.totpEnabledAt ? "Manage" : "Set up"}</a>
    </>
  );
}
