import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { Field, Notice, dateStr, messages } from "@/components/ui";
import { featuresFor } from "@/lib/app/features";
import { testIdsOnly } from "@/lib/app/ids";
import { STATE_FORM_NAME } from "@/lib/onboarding/state-certificates";
import type { LaunchState } from "@/lib/payroll/schedules";
import { StateW4Fieldset, W4Fieldset } from "../../app/[companyId]/people/employee-form";
import { saveMyDetails } from "../actions";

export const metadata = { title: "My details · White Oak Payroll" };

/**
 * Employee self-service: first-time onboarding (SSN, date of birth, address, W-4, state form,
 * direct deposit, I-9 Section 1), and later changes to address, withholding and bank account.
 */
export default async function MyDetails({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { error, ok } = await messages(searchParams);
  const e = await db.employee.findUnique({ where: { userId: user.id }, include: { company: true } });
  if (!e) redirect("/me");
  const f = featuresFor(e.company);
  const onboarding = !e.ssn;
  const company = e.company.tradeName || e.company.legalName;
  if (!f.employeePortal) {
    return (
      <>
        <h1>My details</h1>
        <p className="muted">{company} manages your details directly. Ask them to update your address, W-4 or bank account.</p>
      </>
    );
  }
  const stateForm = STATE_FORM_NAME[e.workState as LaunchState] ?? "state withholding form";
  return (
    <>
      <p className="small"><a href="/me">← My pay</a></p>
      <h1>{onboarding ? `Welcome to ${company}` : "My details"}</h1>
      {onboarding && <p className="muted">Fill this in once so you get paid correctly and on time. It takes about 10 minutes. Have your Social Security number and your bank&apos;s routing and account numbers ready.</p>}
      {testIdsOnly() && onboarding && <p className="notice">Preview: use a test SSN starting with 000.</p>}
      <Notice error={error} ok={ok} />
      <form action={saveMyDetails} className="form">
        <fieldset>
          <legend>About you</legend>
          <p className="small">{e.firstName} {e.lastName}. If your legal name is different, tell {company}.</p>
          {onboarding && (
            <div className="row">
              <Field label="Social Security number"><input name="ssn" required placeholder="000-12-3456" autoComplete="off" /></Field>
              <Field label="Date of birth"><input type="date" name="birthDate" required defaultValue={dateStr(e.birthDate)} /></Field>
            </div>
          )}
          <Field label="Home street address"><input name="addressLine1" defaultValue={e.addressLine1} required autoComplete="street-address" /></Field>
          <div className="row">
            <Field label="City"><input name="city" defaultValue={e.city} required /></Field>
            <Field label="State"><input name="homeState" defaultValue={e.state} required maxLength={2} /></Field>
            <Field label="ZIP"><input name="zip" defaultValue={e.zip} required pattern="\d{5}" /></Field>
          </div>
        </fieldset>

        <p className="small muted">
          Your W-4 and {stateForm} tell {company} how much tax to withhold. Not sure? Single with no adjustments is the usual choice if you have one job and no dependents. The IRS{" "}
          <a href="https://www.irs.gov/individuals/tax-withholding-estimator" target="_blank" rel="noreferrer">withholding estimator</a> can help.
        </p>
        <W4Fieldset e={onboarding ? undefined : e} />
        <StateW4Fieldset e={onboarding ? undefined : e} only={e.workState} />

        <fieldset>
          <legend>How you get paid</legend>
          <Field label="Pay by">
            <select name="paymentMethod" defaultValue={e.paymentMethod}>
              <option value="DIRECT_DEPOSIT">Direct deposit to my bank account</option>
              <option value="CHECK">Paper check</option>
            </select>
          </Field>
          <div className="row">
            <Field label="Routing number" hint="9 digits"><input name="routing" inputMode="numeric" pattern="\d{9}" autoComplete="off" /></Field>
            <Field label="Account number" hint={e.bankLast4 ? `On file ending ${e.bankLast4}. Leave blank to keep.` : "Checking account"}><input name="account" inputMode="numeric" autoComplete="off" /></Field>
          </div>
        </fieldset>

        {onboarding && (
          <fieldset>
            <legend>Form I-9, Section 1</legend>
            <p className="small">Every new employee in the U.S. completes Form I-9. You attest to your status here; on or before your third day, show {company} your original documents (for example a U.S. passport, or a driver&apos;s license and Social Security card).</p>
            <Field label="I attest, under penalty of perjury, that I am">
              <select name="i9Status" defaultValue="us_citizen">
                <option value="us_citizen">A citizen of the United States</option>
                <option value="noncitizen_national">A noncitizen national of the United States</option>
                <option value="lawful_permanent_resident">A lawful permanent resident</option>
                <option value="alien_authorized">An alien authorized to work</option>
              </select>
            </Field>
            <div className="row">
              <Field label="A-Number or USCIS number" hint="Permanent residents and authorized aliens"><input name="i9Number" /></Field>
              <Field label="Work authorization expires" hint="Authorized aliens only; blank if it doesn't expire"><input type="date" name="i9Expires" /></Field>
            </div>
            <Field label="Type your full legal name to sign"><input name="signature" required /></Field>
          </fieldset>
        )}

        <label className="check"><input type="checkbox" name="electronicW2" defaultChecked={e.electronicW2Consent} /> Send my W-2 electronically here instead of by mail. I can change this anytime before January.</label>
        <button type="submit">{onboarding ? "Finish" : "Save changes"}</button>
      </form>
    </>
  );
}
