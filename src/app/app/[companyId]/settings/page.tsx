import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, StateSelect, dateStr, messages, prettyDate } from "@/components/ui";
import { FREQUENCY_LABEL, type Frequency } from "@/lib/app/periods";
import { createSchedule, setNextCheckNumber, updateBank, updateCompany, upsertStateAccount } from "../actions";

export default async function Settings({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "settings");
  const { error, ok } = await messages(searchParams);
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { stateAccounts: true, paySchedules: true } });
  const hidden = <input type="hidden" name="companyId" value={companyId} />;

  return (
    <>
      <h1>Company settings</h1>
      <Notice error={error} ok={ok} />

      <h2>Company</h2>
      <form action={updateCompany} className="form">
        {hidden}
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
        <Field label="Federal deposit schedule" hint="Most new employers are monthly depositors. The IRS tells you each year in Notice 931 / your lookback period.">
          <select name="depositSchedule" defaultValue={c.depositSchedule}>
            <option value="MONTHLY">Monthly</option>
            <option value="SEMIWEEKLY">Semi-weekly</option>
          </select>
        </Field>
        <button type="submit">Save company</button>
      </form>

      <h2 id="bank">Funding bank account</h2>
      <p className="muted small">
        Payroll and taxes are drawn from this account. {c.bankLast4 ? <>On file: {c.bankName} ending {c.bankLast4}.</> : "Not added yet."} Transfers are simulated until the TD Bank connection is live, and only the last 4 digits are stored.
      </p>
      <form action={updateBank} className="form">
        {hidden}
        <div className="row">
          <Field label="Bank name"><input name="bankName" defaultValue={c.bankName ?? ""} /></Field>
          <Field label="Routing number"><input name="routing" inputMode="numeric" required pattern="\d{9}" /></Field>
          <Field label="Account number"><input name="account" inputMode="numeric" required /></Field>
        </div>
        <button type="submit">Save bank account</button>
      </form>

      <h2 id="checks">Paper checks</h2>
      <p className="muted small">For anyone paid by check, White Oak numbers and prints checks on blank voucher check stock from your bank or office supply store (the kind with your bank's MICR line already printed). Next check number: <b>{c.nextCheckNumber}</b>.</p>
      <form action={setNextCheckNumber} className="form narrow">
        {hidden}
        <Field label="Next check number" hint="Match the first check in your printer."><input name="nextCheckNumber" type="number" min={1} defaultValue={c.nextCheckNumber} /></Field>
        <button type="submit" className="secondary">Save</button>
      </form>

      <h2 id="states">State tax accounts</h2>
      <p className="muted small">Add each state where employees work. Your unemployment rate is on the rate notice the state mailed you; new employers get a standard new-employer rate.</p>
      {c.stateAccounts.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>State</th><th>Withholding account</th><th>Unemployment account</th><th className="num">UI rate</th><th>Notes</th></tr></thead>
            <tbody>
              {c.stateAccounts.map((s) => (
                <tr key={s.id}>
                  <td>{s.state}</td>
                  <td>{s.withholdingAccount ?? "—"}</td>
                  <td>{s.unemploymentAccount ?? "—"}</td>
                  <td className="num">{(s.suiRate * 100).toFixed(2)}%</td>
                  <td className="small">{s.orTransitDistrict ? `Transit district: ${s.orTransitDistrict}` : ""}{s.lessFrequentPayApproval ? "Less frequent pay approved" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form action={upsertStateAccount} className="form">
        {hidden}
        <div className="row">
          <Field label="State"><StateSelect name="state" /></Field>
          <Field label="Withholding account no." hint="CT Tax Reg., MA account, OR BIN, NY withholding ID"><input name="withholdingAccount" /></Field>
          <Field label="Unemployment account no."><input name="unemploymentAccount" /></Field>
          <Field label="UI rate (%)" hint="e.g. 2.4"><input name="suiRatePct" inputMode="decimal" required /></Field>
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

      <h2 id="schedules">Pay schedules</h2>
      {c.paySchedules.length > 0 && (
        <ul>
          {c.paySchedules.map((s) => (
            <li key={s.id}>{s.name}: {FREQUENCY_LABEL[s.frequency as Frequency]}, first payday {prettyDate(s.anchorPayday)}</li>
          ))}
        </ul>
      )}
      <form action={createSchedule} className="form">
        {hidden}
        <div className="row">
          <Field label="Name"><input name="name" defaultValue={c.paySchedules.length ? "" : "Regular"} required /></Field>
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
    </>
  );
}
