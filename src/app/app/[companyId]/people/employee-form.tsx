import type { Employee, I9Record, PaySchedule } from "@prisma/client";
import { exemptExpires, i9Deadlines } from "@/lib/onboarding";
import { W4_FORM_YEAR, w4Prefill } from "@/lib/app/onboarding-records";
import { ssnLast4 } from "@/lib/security/field-crypto";
import { Field, StateSelect, dateStr } from "@/components/ui";
import { FREQUENCY_LABEL, type Frequency } from "@/lib/app/periods";

const d = (c: number | undefined) => (c ? (c / 100).toFixed(2) : "");

/** Add / edit employee: personal, job and pay, federal W-4, state certificate, I-9, deposit, deductions. */
export function EmployeeForm({ companyId, schedules, e, action, submit, companyState, latestW4, i9 }: { companyId: string; schedules: PaySchedule[]; e?: Employee; action: (f: FormData) => Promise<void>; submit: string; companyState?: string; latestW4?: unknown; i9?: I9Record | null }) {
  const step3 = w4Prefill(latestW4, e?.w4DependentsCents ?? 0);
  const section2Due = i9 ? dateStr(i9.section2DueOn) : e ? i9Deadlines(dateStr(e.hireDate)).section2 : null;
  const s = (e?.stateW4 ?? {}) as Record<string, string | number | boolean>;
  const sv = (k: string) => (s[k] === undefined || s[k] === null ? "" : String(s[k]));
  const sm = (k: string) => (typeof s[k] === "number" && s[k] ? ((s[k] as number) / 100).toFixed(2) : "");
  return (
    <form action={action} className="form">
      <input type="hidden" name="companyId" value={companyId} />
      {e && <input type="hidden" name="employeeId" value={e.id} />}
      <fieldset>
        <legend>Personal</legend>
        <div className="row">
          <Field label="First name"><input name="firstName" defaultValue={e?.firstName} required /></Field>
          <Field label="Last name"><input name="lastName" defaultValue={e?.lastName} required /></Field>
          <Field label="Email" hint="For the employee portal"><input name="email" type="email" defaultValue={e?.email} required /></Field>
        </div>
        <div className="row">
          <Field label={e ? "SSN (leave blank to keep)" : "SSN"} hint={e ? `On file ending ${ssnLast4(e)} (stored encrypted)` : "Test SSNs only: 000-xx-xxxx. Stored encrypted."}>
            <input name="ssn" required={!e} placeholder="000-12-3456" />
          </Field>
          <Field label="Date of birth"><input type="date" name="birthDate" defaultValue={dateStr(e?.birthDate)} required /></Field>
        </div>
        <Field label="Home street address"><input name="addressLine1" defaultValue={e?.addressLine1} required /></Field>
        <div className="row">
          <Field label="City"><input name="city" defaultValue={e?.city} required /></Field>
          <Field label="State"><input name="homeState" defaultValue={e?.state} required maxLength={2} /></Field>
          <Field label="ZIP"><input name="zip" defaultValue={e?.zip} required /></Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Job and pay</legend>
        <div className="row">
          <Field label="Hire date"><input type="date" name="hireDate" defaultValue={dateStr(e?.hireDate)} required /></Field>
          <Field label="Work state"><StateSelect name="workState" defaultValue={e?.workState ?? companyState} /></Field>
          <Field label="Pay schedule">
            <select name="payScheduleId" defaultValue={e?.payScheduleId} required>
              {schedules.map((p) => <option key={p.id} value={p.id}>{p.name} ({FREQUENCY_LABEL[p.frequency as Frequency]})</option>)}
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Paid">
            <select name="payBasis" defaultValue={e?.payBasis ?? "HOURLY"}>
              <option value="HOURLY">Hourly</option>
              <option value="SALARIED">Salary</option>
            </select>
          </Field>
          <Field label="Rate ($/hour or $/year)"><input name="payRate" inputMode="decimal" defaultValue={d(e?.payRateCents)} required /></Field>
          <Field label="Usual hours per pay period" hint="Hourly only; you can change hours on each pay run"><input name="defaultHours" inputMode="decimal" defaultValue={e?.defaultHours ?? ""} /></Field>
        </div>
        <label className="check"><input type="checkbox" name="nyManualWorker" defaultChecked={e?.nyManualWorker} /> New York manual worker (more than 25% physical labor; must be paid weekly)</label>
      </fieldset>

      <fieldset>
        <legend>Federal Form W-4</legend>
        <div className="row">
          <Field label="Step 1(c) filing status">
            <select name="w4FilingStatus" defaultValue={e?.w4FilingStatus ?? "single"}>
              <option value="single">Single or married filing separately</option>
              <option value="married_jointly">Married filing jointly</option>
              <option value="head_of_household">Head of household</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="3(a) qualifying children under 17" hint="x $2,200"><input name="w4Children" type="number" min={0} defaultValue={step3.children || ""} /></Field>
          <Field label="3(b) other dependents" hint="x $500"><input name="w4OtherDependents" type="number" min={0} defaultValue={step3.otherDependents || ""} /></Field>
          <Field label="Step 3 other credits ($/year)"><input name="w4OtherCredits" inputMode="decimal" defaultValue={d(step3.otherCreditsCents)} /></Field>
        </div>
        <label className="check"><input type="checkbox" name="w4MultipleJobs" defaultChecked={e?.w4MultipleJobs} /> Step 2(c): multiple jobs or spouse works</label>
        <div className="row">
          <Field label="4(a) other income ($/year)"><input name="w4OtherIncome" inputMode="decimal" defaultValue={d(e?.w4OtherIncomeCents)} /></Field>
          <Field label="4(b) deductions ($/year)"><input name="w4Deductions" inputMode="decimal" defaultValue={d(e?.w4DeductionsCents)} /></Field>
          <Field label="4(c) extra withholding ($/check)"><input name="w4Extra" inputMode="decimal" defaultValue={d(e?.w4ExtraCents)} /></Field>
        </div>
        <label className="check"><input type="checkbox" name="w4Exempt" defaultChecked={e?.w4Exempt} /> Claims exemption from withholding for {W4_FORM_YEAR} (a new W-4 is due by {exemptExpires(W4_FORM_YEAR)})</label>
      </fieldset>

      <fieldset>
        <legend>State withholding certificate (fill the one for the work state)</legend>
        {(["CT", "MA", "OR", "NY"] as const).map((st) => {
          const mine = e?.workState === st;
          const v = (k: string) => (mine ? sv(k) : "");
          const m = (k: string) => (mine ? sm(k) : "");
          const b = (k: string) => mine && s[k] === true;
          const n = (k: string) => `s_${st.toLowerCase()}_${k}`;
          return (
            <details key={st} data-state={st} open={mine || (!e && st === companyState)}>
              <summary>{{ CT: "Connecticut CT-W4", MA: "Massachusetts M-4", OR: "Oregon OR-W-4", NY: "New York IT-2104" }[st]}</summary>
              {st === "CT" && (
                <div className="row">
                  <Field label="Withholding code" hint="No form on file withholds at the highest rate">
                    <select name={n("code")} defaultValue={v("code")}>
                      <option value="">No CT-W4 on file</option>
                      {["A", "B", "C", "D", "E", "F"].map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </Field>
                  <Field label="Line 2 additional ($/check)"><input name={n("additional")} inputMode="decimal" defaultValue={m("additional")} /></Field>
                  <Field label="Line 3 reduced ($/check)"><input name={n("reduction")} inputMode="decimal" defaultValue={m("reduction")} /></Field>
                </div>
              )}
              {st === "MA" && (
                <>
                  <div className="row">
                    <Field label="Total exemptions"><input name={n("exemptions")} type="number" min={0} defaultValue={v("exemptions")} /></Field>
                    <Field label="Additional ($/check)"><input name={n("additional")} inputMode="decimal" defaultValue={m("additional")} /></Field>
                  </div>
                  <div className="row">
                    <Field label="Boxes B and C: blind (you and/or spouse)">
                      <select name={n("blind")} defaultValue={v("blind") || "0"}><option value="0">None</option><option value="1">One</option><option value="2">Both</option></select>
                    </Field>
                  </div>
                  <label className="check"><input type="checkbox" name={n("headOfHousehold")} defaultChecked={b("headOfHousehold")} /> Box A: head of household</label>
                  <label className="check"><input type="checkbox" name={n("student")} defaultChecked={b("fullTimeStudentUnder8k")} /> Box D: full-time student, seasonal or part-time job, $8,000 or less this year (no withholding)</label>
                </>
              )}
              {st === "OR" && (
                <div className="row">
                  <Field label="Filing status">
                    <select name={n("filingStatus")} defaultValue={mine ? (Object.keys(s).length ? v("filingStatus") : "none") : "single"}>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="married_single_rate">Married, withhold at single rate</option>
                      <option value="none">No OR-W-4 on file (flat 8%)</option>
                    </select>
                  </Field>
                  <Field label="Allowances"><input name={n("allowances")} type="number" min={0} defaultValue={v("allowances")} /></Field>
                  <Field label="Additional ($/check)"><input name={n("additional")} inputMode="decimal" defaultValue={m("additional")} /></Field>
                </div>
              )}
              {st === "NY" && (
                <>
                  <div className="row">
                    <Field label="Status">
                      <select name={n("status")} defaultValue={v("status") || "single"}>
                        <option value="single">Single or head of household</option>
                        <option value="married">Married</option>
                      </select>
                    </Field>
                    <Field label="Line 1 allowances"><input name={n("allowances")} type="number" min={0} defaultValue={v("allowances")} /></Field>
                    <Field label="Line 2 NYC allowances"><input name={n("nycAllowances")} type="number" min={0} defaultValue={v("nycAllowances")} /></Field>
                  </div>
                  <div className="row">
                    <Field label="Line 3 additional NYS ($/check)"><input name={n("additionalState")} inputMode="decimal" defaultValue={m("additionalState")} /></Field>
                    <Field label="Line 4 additional NYC ($/check)"><input name={n("additionalNyc")} inputMode="decimal" defaultValue={m("additionalNyc")} /></Field>
                    <Field label="Line 5 additional Yonkers ($/check)"><input name={n("additionalYonkers")} inputMode="decimal" defaultValue={m("additionalYonkers")} /></Field>
                  </div>
                  <label className="check"><input type="checkbox" name={n("nycResident")} defaultChecked={b("nycResident")} /> New York City resident</label>
                  <label className="check"><input type="checkbox" name={n("yonkersResident")} defaultChecked={b("yonkersResident")} /> Yonkers resident</label>
                </>
              )}
              <label className="check"><input type="checkbox" name={n("exempt")} defaultChecked={b("exempt")} /> Exempt from {st} withholding{st === "NY" ? " (Form IT-2104-E on file)" : st === "OR" ? " (line 4 exemption code; ends Feb 15 next year)" : ""}</label>
            </details>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>Deductions and how they are paid</legend>
        <div className="row">
          <Field label="Pay by">
            <select name="paymentMethod" defaultValue={e?.paymentMethod ?? "DIRECT_DEPOSIT"}>
              <option value="DIRECT_DEPOSIT">Direct deposit</option>
              <option value="CHECK">Paper check</option>
            </select>
          </Field>
          <Field label="401(k) pre-tax (% of pay)"><input name="retirementPct" inputMode="decimal" defaultValue={e?.retirementPretaxRate ? (e.retirementPretaxRate * 100).toString() : ""} /></Field>
          <Field label="Health premium ($/check, pre-tax)"><input name="healthPremium" inputMode="decimal" defaultValue={d(e?.healthPremiumCents)} /></Field>
          <Field label="Deposit account number" hint={e?.bankLast4 ? `On file ending ${e.bankLast4}` : "Last 4 kept; deposits simulated"}><input name="bankAccount" inputMode="numeric" /></Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Form I-9</legend>
        <p className="small muted">Edition 01/20/25. Keep the signed I-9 on paper for now; White Oak tracks the deadlines and how long to keep it.</p>
        <label className="check"><input type="checkbox" name="i9Section1" defaultChecked={!!i9?.section1CompletedAt || (!i9 && !!e?.i9CompletedAt)} /> Section 1 signed by the employee (due by the first day of work)</label>
        <label className="check"><input type="checkbox" name="i9Section2" defaultChecked={!!i9?.section2CompletedAt || (!i9 && !!e?.i9CompletedAt)} /> Section 2: you examined their original documents in person (one from List A, or one from List B and one from List C){section2Due ? `, due ${section2Due}` : ", due by the 3rd business day after the first day of work"}</label>
        <div className="row">
          <Field label="Work authorization expires" hint="Only if they presented an expiring document such as an EAD; Supplement B is due by then"><input type="date" name="i9ReverifyBy" defaultValue={dateStr(i9?.reverifyBy ?? undefined)} /></Field>
        </div>
        <p className="small muted">The employee becomes Active once both sections are done.</p>
      </fieldset>
      <button type="submit">{submit}</button>
      {/* Open the matching state certificate when the work state changes. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.currentScript.closest("form").querySelector("[name=workState]").addEventListener("change",function(ev){var f=ev.target.form;f.querySelectorAll("details[data-state]").forEach(function(d){d.open=d.dataset.state===ev.target.value;});});`,
        }}
      />
    </form>
  );
}
