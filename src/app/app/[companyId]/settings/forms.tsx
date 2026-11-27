import type { Company } from "@prisma/client";
import { Field, StateSelect, dateStr } from "@/components/ui";
import { FREQUENCY_LABEL } from "@/lib/app/periods";
import { createSchedule, updateBank, updateCompany, upsertStateAccount } from "../actions";

/**
 * The company setup forms, shared by Company settings and the setup wizard. `returnTo` sends the
 * owner back to the page they came from (the wizard) after saving.
 */
type P = { companyId: string; returnTo?: string };

function Hidden({ companyId, returnTo }: P) {
  return (
    <>
      <input type="hidden" name="companyId" value={companyId} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
    </>
  );
}

export function CompanyForm({ c, ...p }: P & { c: Company }) {
  return (
    <form action={updateCompany} className="form">
      <Hidden {...p} />
      <div className="row">
        <Field label="Legal name"><input name="legalName" defaultValue={c.legalName} required /></Field>
        <Field label="Doing business as"><input name="tradeName" defaultValue={c.tradeName ?? ""} /></Field>
        <Field label="EIN"><input name="ein" defaultValue={c.ein} required /></Field>
      </div>
      <Field label="Street address"><input name="addressLine1" defaultValue={c.addressLine1} required /></Field>
      <div className="row">
        <Field label="City"><input name="city" defaultValue={c.city} required /></Field>
        <Field label="State"><StateSelect name="state" defaultValue={c.state} /></Field>
        <Field label="ZIP"><input name="zip" defaultValue={c.zip} required /></Field>
      </div>
      <Field label="Federal deposit schedule" hint="New employers are monthly depositors. The IRS tells you each year (Notice 931); if you are not sure, keep monthly.">
        <select name="depositSchedule" defaultValue={c.depositSchedule}>
          <option value="MONTHLY">Monthly</option>
          <option value="SEMIWEEKLY">Semi-weekly</option>
        </select>
      </Field>
      <button type="submit">Save company</button>
    </form>
  );
}

export function BankForm({ c, ...p }: P & { c: Company }) {
  return (
    <form action={updateBank} className="form">
      <Hidden {...p} />
      <div className="row">
        <Field label="Bank name"><input name="bankName" defaultValue={c.bankName ?? ""} /></Field>
        <Field label="Routing number" hint="9 digits, bottom left of a check"><input name="routing" inputMode="numeric" required pattern="\d{9}" /></Field>
        <Field label="Account number"><input name="account" inputMode="numeric" required /></Field>
      </div>
      <button type="submit">Save bank account</button>
    </form>
  );
}

export function StateAccountForm({ defaultState, ...p }: P & { defaultState?: string }) {
  return (
    <form action={upsertStateAccount} className="form">
      <Hidden {...p} />
      <div className="row">
        <Field label="State"><StateSelect name="state" defaultValue={defaultState} /></Field>
        <Field label="Withholding account no." hint="CT Tax Reg., MA account, OR BIN, NY withholding ID. Leave blank if you applied and are waiting."><input name="withholdingAccount" /></Field>
        <Field label="Unemployment account no."><input name="unemploymentAccount" /></Field>
        <Field label="Unemployment rate (%)" hint="On the rate notice the state mailed you, e.g. 2.4"><input name="suiRatePct" inputMode="decimal" required /></Field>
      </div>
      <Field label="Oregon only: work site transit district" hint="Portland metro is TriMet; Eugene/Springfield is Lane Transit District.">
        <select name="orTransitDistrict" defaultValue="">
          <option value="">None</option>
          <option value="trimet">TriMet</option>
          <option value="lane">Lane Transit District</option>
        </select>
      </Field>
      <label className="check"><input type="checkbox" name="lessFrequentPayApproval" /> Connecticut only: we have Labor Commissioner approval to pay less often than every two weeks</label>
      <button type="submit">Save state account</button>
    </form>
  );
}

export function ScheduleForm({ first, ...p }: P & { first: boolean }) {
  return (
    <form action={createSchedule} className="form">
      <Hidden {...p} />
      <div className="row">
        <Field label="Name"><input name="name" defaultValue={first ? "Regular" : ""} required /></Field>
        <Field label="How often">
          <select name="frequency" defaultValue="BIWEEKLY">
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="First payday"><input type="date" name="anchorPayday" required defaultValue={dateStr(new Date(Date.now() + 7 * 86_400_000))} /></Field>
        <Field label="Days from period end to payday" hint="Weekly / every two weeks only"><input name="payLagDays" type="number" min={0} max={14} defaultValue={5} /></Field>
      </div>
      <p className="small muted">CT and MA hourly staff must be paid weekly or every two weeks; NY manual workers weekly; NY never monthly.</p>
      <button type="submit">Create schedule</button>
    </form>
  );
}
