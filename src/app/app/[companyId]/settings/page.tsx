import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, messages, prettyDate } from "@/components/ui";
import { FREQUENCY_LABEL, type Frequency } from "@/lib/app/periods";
import { FEATURES, FEATURE_KEYS, MODE_LABEL, featuresFor } from "@/lib/app/features";
import { setNextCheckNumber, updateFeatures } from "../actions";
import { BankForm, CompanyForm, ScheduleForm, StateAccountForm } from "./forms";

export default async function Settings({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "settings");
  const { error, ok } = await messages(searchParams);
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { stateAccounts: true, paySchedules: true } });
  const hidden = <input type="hidden" name="companyId" value={companyId} />;
  const features = featuresFor(c);

  return (
    <>
      <h1>Company settings</h1>
      <Notice error={error} ok={ok} />

      <h2>Company</h2>
      <CompanyForm companyId={companyId} c={c} />

      <h2 id="bank">Funding bank account</h2>
      <p className="muted small">
        Payroll and taxes are drawn from this account. {c.bankLast4 ? <>On file: {c.bankName} ending {c.bankLast4}.</> : "Not added yet."} Transfers are simulated until the TD Bank connection is live, and only the last 4 digits are stored.
      </p>
      <BankForm companyId={companyId} c={c} />

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
      <StateAccountForm companyId={companyId} />

      <h2 id="schedules">Pay schedules</h2>
      {c.paySchedules.length > 0 && (
        <ul>
          {c.paySchedules.map((s) => (
            <li key={s.id}>{s.name}: {FREQUENCY_LABEL[s.frequency as Frequency]}, first payday {prettyDate(s.anchorPayday)}</li>
          ))}
        </ul>
      )}
      <ScheduleForm companyId={companyId} first={c.paySchedules.length === 0} />

      <h2 id="features">Features</h2>
      <p className="muted small">Service: {MODE_LABEL[c.serviceMode]}. Turn on only what your team uses.</p>
      <form action={updateFeatures} className="form">
        {hidden}
        {FEATURE_KEYS.map((k) => (
          <label className="check" key={k}>
            <input type="checkbox" name={k} defaultChecked={features[k]} />
            <span><b>{FEATURES[k].label}</b><br /><span className="small muted">{FEATURES[k].help}</span></span>
          </label>
        ))}
        <button type="submit" className="secondary">Save features</button>
      </form>
    </>
  );
}
