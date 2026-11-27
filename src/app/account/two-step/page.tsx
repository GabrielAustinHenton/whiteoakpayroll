import { requireUser } from "@/lib/auth/session";
import { Field, Notice, messages, prettyDate } from "@/components/ui";
import { groupSecret } from "@/lib/auth/totp";
import { setupQrSvg } from "@/lib/auth/totp-qr";
import { landingFor } from "@/lib/auth/landing";
import { db } from "@/lib/db";
import { disableTwoStep, startTwoStepSetup } from "../../two-step-actions";
import { ConfirmSetupForm, RegenerateCodesForm } from "./codes-forms";

export const metadata = { title: "Two-step sign-in · White Oak Payroll" };

export default async function TwoStep({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { error, ok, sp } = await messages(searchParams);
  const required = user.needsTwoStep || sp.required === "1";
  const whiteOak = user.isPlatformAdmin || user.isStaff;
  const next = landingFor({ ...user, totpEnabledAt: new Date(), employee: await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } }) });

  return (
    <>
      <p className="small"><a href="/account">← Account</a></p>
      <h1>Two-step sign-in</h1>
      <Notice error={error} ok={ok} />
      {user.totpEnabledAt ? (
        <>
          <p className="notice ok">On since {prettyDate(user.totpEnabledAt)}. Each sign-in asks for a code from your authenticator app.</p>
          <h2>Recovery codes</h2>
          <p className="muted">{user.recoveryCodeHashes.length} unused. Get a new set if you lost them or used most of them; the old set stops working.</p>
          <RegenerateCodesForm />
          {!whiteOak && (
            <details style={{ marginTop: 32 }}>
              <summary>Turn off two-step sign-in</summary>
              <form action={disableTwoStep} className="form narrow" style={{ marginTop: 12 }}>
                <Field label="Password"><input name="password" type="password" required autoComplete="current-password" /></Field>
                <Field label="Code from your app"><input name="code" inputMode="numeric" required autoComplete="one-time-code" className="code-input" /></Field>
                <button type="submit" className="danger">Turn off</button>
              </form>
            </details>
          )}
        </>
      ) : (
        <>
          {required ? (
            <p className="notice" role="alert">
              <b>White Oak admins and payroll staff must turn on two-step sign-in.</b> Your login can reach every client&apos;s pay, bank and Social Security numbers, so a password alone isn&apos;t enough. It takes about a minute.
            </p>
          ) : (
            <p className="muted">Protect your login with a code from your phone, so a stolen password alone can&apos;t get in.</p>
          )}
          {!user.totpSecret ? (
            <form action={startTwoStepSetup}>
              <button type="submit">Set up two-step sign-in</button>
            </form>
          ) : (
            <ol className="setup-steps">
              <li>
                <p>Install an authenticator app on your phone if you don&apos;t have one: Google Authenticator, Microsoft Authenticator, 1Password or Authy.</p>
              </li>
              <li>
                <p>In the app, add an account and scan this code:</p>
                <div className="qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: await setupQrSvg(user.totpSecret, user.email) }} />
                <p className="small muted">Can&apos;t scan? Enter this key instead: <code className="secret">{groupSecret(user.totpSecret)}</code></p>
              </li>
              <li>
                <p>Type the 6-digit code the app shows:</p>
                <ConfirmSetupForm next={next} />
              </li>
            </ol>
          )}
        </>
      )}
    </>
  );
}
