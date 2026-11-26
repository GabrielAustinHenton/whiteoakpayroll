import type { Employee, PaySchedule } from "@prisma/client";
import { Field, StateSelect, dateStr } from "@/components/ui";
import { FREQUENCY_LABEL, type Frequency } from "@/lib/app/periods";

const d = (c: number | undefined) => (c ? (c / 100).toFixed(2) : "");

/** Add / edit employee: personal, job and pay, federal W-4, state certificate, I-9, deposit, deductions. */
export function EmployeeForm({ companyId, schedules, e, action, submit, companyState }: { companyId: string; schedules: PaySchedule[]; e?: Employee; action: (f: FormData) => Promise<void>; submit: string; companyState?: string }) {
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
          <Field label="Email" hint="Required. Their employee portal invite is emailed here."><input name="email" type="email" defaultValue={e?.email} required /></Field>
        </div>
        <div className="row">
          <Field label={e ? "SSN (leave blank to keep)" : "SSN"} hint={e ? `On file ending ${e.ssn.slice(-4)}` : "Test SSNs only: 000-xx-xxxx"}>
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
          <Field label="Step 3 dependents ($/year)"><input name="w4Dependents" inputMode="decimal" defaultValue={d(e?.w4DependentsCents)} /></Field>
        </div>
        <label className="check"><input type="checkbox" name="w4MultipleJobs" defaultChecked={e?.w4MultipleJobs} /> Step 2(c): multiple jobs or spouse works</label>
        <div className="row">
          <Field label="4(a) other income ($/year)"><input name="w4OtherIncome" inputMode="decimal" defaultValue={d(e?.w4OtherIncomeCents)} /></Field>
          <Field label="4(b) deductions ($/year)"><input name="w4Deductions" inputMode="decimal" defaultValue={d(e?.w4DeductionsCents)} /></Field>
          <Field label="4(c) extra withholding ($/check)"><input name="w4Extra" inputMode="decimal" defaultValue={d(e?.w4ExtraCents)} /></Field>
        </div>
        <label className="check"><input type="checkbox" name="w4Exempt" defaultChecked={e?.w4Exempt} /> Claims exemption from withholding (expires Feb 15 next year)</label>
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
                </div>
              )}
              {st === "MA" && (
                <>
                  <div className="row">
                    <Field label="Total exemptions"><input name={n("exemptions")} type="number" min={0} defaultValue={v("exemptions")} /></Field>
                    <Field label="Additional ($/check)"><input name={n("additional")} inputMode="decimal" defaultValue={m("additional")} /></Field>
                  </div>
                  <label className="check"><input type="checkbox" name={n("headOfHousehold")} defaultChecked={b("headOfHousehold")} /> Head of household</label>
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
                    <Field label="Additional NYS ($/check)"><input name={n("additionalState")} inputMode="decimal" defaultValue={m("additionalState")} /></Field>
                  </div>
                  <label className="check"><input type="checkbox" name={n("nycResident")} defaultChecked={b("nycResident")} /> New York City resident</label>
                  <label className="check"><input type="checkbox" name={n("yonkersResident")} defaultChecked={b("yonkersResident")} /> Yonkers resident</label>
                </>
              )}
              <label className="check"><input type="checkbox" name={n("exempt")} defaultChecked={b("exempt")} /> Exempt from {st} withholding</label>
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
        <label className="check"><input type="checkbox" name="i9Done" defaultChecked={!!e?.i9CompletedAt} /> Sections 1 and 2 are complete (Section 2 is due by the 3rd business day after the first day of work)</label>
        <p className="small muted">The employee becomes Active once the I-9 is complete.</p>
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
