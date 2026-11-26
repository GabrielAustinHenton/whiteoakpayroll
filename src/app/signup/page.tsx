import { signup } from "../auth-actions";
import { Field, Notice, StateSelect, messages } from "@/components/ui";
import { testIdsOnly } from "@/lib/app/ids";

export const metadata = { title: "Sign up · White Oak Payroll" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error } = await messages(searchParams);
  return (
    <>
      <h1>Set up your company</h1>
      <p className="muted">Create your login and your company. You can add employees, contractors and pay schedules next.</p>
      {testIdsOnly() && (
        <p className="notice">Preview: use test numbers only. EINs must start with 00 (for example 00-1234567) and SSNs with 000.</p>
      )}
      <Notice error={error} />
      <form action={signup} className="form">
        <fieldset>
          <legend>You</legend>
          <Field label="Your name"><input name="name" required autoComplete="name" /></Field>
          <Field label="Email"><input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Password" hint="At least 10 characters."><input name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        </fieldset>
        <fieldset>
          <legend>Company</legend>
          <Field label="Legal name"><input name="legalName" required /></Field>
          <Field label="Doing business as (optional)"><input name="tradeName" /></Field>
          <Field label="EIN"><input name="ein" required placeholder="00-1234567" /></Field>
          <Field label="Street address"><input name="addressLine1" required /></Field>
          <div className="row">
            <Field label="City"><input name="city" required /></Field>
            <Field label="State"><StateSelect name="state" /></Field>
            <Field label="ZIP"><input name="zip" required pattern="\d{5}" /></Field>
          </div>
        </fieldset>
        <button type="submit">Create company</button>
        <p className="small muted">Already have an account? <a href="/login">Sign in</a></p>
      </form>
    </>
  );
}
