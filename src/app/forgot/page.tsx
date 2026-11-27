import { forgotPassword } from "../auth-actions";
import { Field, messages } from "@/components/ui";

export const metadata = { title: "Reset your password · White Oak Payroll" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { sp } = await messages(searchParams);
  if (sp.sent) {
    return (
      <>
        <h1>Check your email</h1>
        <p>If that email has a White Oak Payroll login, we sent it a link to choose a new password. The link works once and expires in an hour.</p>
        <p className="small muted">Nothing arrived after a few minutes? Check spam, or <a href="/forgot">try again</a>.</p>
        <p><a href="/login">Back to sign in</a></p>
      </>
    );
  }
  return (
    <>
      <h1>Reset your password</h1>
      <p className="muted">Enter the email you sign in with and we&apos;ll email you a link to choose a new password.</p>
      <form action={forgotPassword} className="form narrow">
        <Field label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
        <button type="submit">Email me a reset link</button>
        <p className="small muted"><a href="/login">Back to sign in</a></p>
      </form>
    </>
  );
}
