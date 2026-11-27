import { resetPassword } from "../../auth-actions";
import { Field, Notice, messages } from "@/components/ui";
import { userForReset } from "@/lib/app/password-reset";

export const metadata = { title: "Choose a new password · White Oak Payroll" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const { error } = await messages(searchParams);
  const user = await userForReset(token);
  if (!user) {
    return (
      <>
        <h1>This reset link no longer works</h1>
        <p className="muted">It has expired or was already used. <a href="/forgot">Ask for a new link</a>, or <a href="/login">sign in</a>.</p>
      </>
    );
  }
  return (
    <>
      <h1>Choose a new password</h1>
      <p className="muted">For <b>{user.email}</b>. You&apos;ll be signed out everywhere else.</p>
      <Notice error={error} />
      <form action={resetPassword} className="form narrow">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" hint="At least 10 characters"><input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="New password again"><input name="confirm" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <button type="submit">Save new password</button>
      </form>
    </>
  );
}
