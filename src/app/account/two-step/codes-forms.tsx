"use client";

import { useActionState } from "react";
import { confirmTwoStepSetup, regenerateRecoveryCodes, type CodesState } from "../../two-step-actions";

function RecoveryCodes({ codes, next }: { codes: string[]; next: string }) {
  const text = codes.join("\n");
  return (
    <div className="card" role="status">
      <p><b>Save these recovery codes now.</b> Each one signs you in once if you lose your phone. They won&apos;t be shown again.</p>
      <ul className="recovery-codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <a className="button secondary" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`White Oak Payroll recovery codes\n\n${text}\n`)}`} download="white-oak-recovery-codes.txt">Download</a>
        <a className="button" href={next}>I saved them, continue</a>
      </div>
    </div>
  );
}

export function ConfirmSetupForm({ next }: { next: string }) {
  const [state, action, busy] = useActionState<CodesState, FormData>(confirmTwoStepSetup, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} next={next} />;
  return (
    <form action={action} className="form narrow">
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      <label className="field">
        <span>6-digit code from the app</span>
        <input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required className="code-input" />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Checking…" : "Turn on two-step sign-in"}</button>
    </form>
  );
}

export function RegenerateCodesForm() {
  const [state, action, busy] = useActionState<CodesState, FormData>(regenerateRecoveryCodes, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} next="/account/two-step" />;
  return (
    <form action={action} className="actions">
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      <input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required placeholder="Code from app" aria-label="Code from your authenticator app" className="code-input" />
      <button type="submit" className="secondary" disabled={busy}>Get new recovery codes</button>
    </form>
  );
}
