import { redirect } from "next/navigation";
import { pendingTwoStep } from "@/lib/auth/session";
import { Field, Notice, messages } from "@/components/ui";
import { verifyTwoStepLogin } from "../../two-step-actions";

export const metadata = { title: "Two-step sign-in · White Oak Payroll" };

export default async function TwoStepLogin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error } = await messages(searchParams);
  const pending = await pendingTwoStep();
  if (!pending) redirect("/login");
  return (
    <>
      <h1>Enter your sign-in code</h1>
      <p className="muted">Open your authenticator app and type the 6-digit code for White Oak Payroll ({pending.user.email}).</p>
      <Notice error={error} />
      <form action={verifyTwoStepLogin} className="form narrow">
        <Field label="Code">
          <input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required autoFocus className="code-input" aria-describedby="code-help" />
        </Field>
        <small id="code-help" className="muted">The code changes every 30 seconds.</small>
        <button type="submit">Sign in</button>
      </form>
      <details className="small" style={{ marginTop: 24 }}>
        <summary>Lost your phone? Use a recovery code</summary>
        <form action={verifyTwoStepLogin} className="form narrow" style={{ marginTop: 12 }}>
          <Field label="Recovery code" hint="One of the codes you saved when you turned on two-step sign-in. Each works once.">
            <input name="recovery" autoComplete="off" required placeholder="xxxx-xxxx" />
          </Field>
          <button type="submit" className="secondary">Use recovery code</button>
        </form>
      </details>
    </>
  );
}
