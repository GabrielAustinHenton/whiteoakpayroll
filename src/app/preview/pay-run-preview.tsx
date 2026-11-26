"use client";

import { summarizePayRunCost } from "@/lib/taxes/employer-taxes";
import { dollars, formatUSD } from "@/lib/money";
import { monthlyBill } from "@/lib/pricing";
import { usePeopleCount } from "@/lib/preview/use-people-count";
import { sampleRoster } from "@/lib/preview/sample-roster";
import { PeopleInput } from "../people-input";

const SAMPLE_SUTA = { rate: 0.03, wageBase: dollars(26_100) };
const MAX_ROWS = 50;
const LABELS = { social_security: "Social Security", medicare: "Medicare", futa: "FUTA", suta: "State unemployment" } as const;

export function PayRunPreview() {
  const { people } = usePeopleCount();
  const roster = sampleRoster(people);
  const run = summarizePayRunCost(roster, SAMPLE_SUTA);
  const fee = monthlyBill(people).total;
  const shown = run.perEmployee.slice(0, MAX_ROWS);

  return (
    <>
      <PeopleInput />
      {people === 0 ? (
        <p className="muted">Enter how many people you pay to see a sample pay run.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Gross wages</th>
                {Object.values(LABELS).map((l) => (
                  <th key={l} className="num">{l}</th>
                ))}
                <th className="num">Employer taxes</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.employeeId}>
                  <td>
                    {r.employeeId.replace(/ #\d+$/, "")}
                    {r.socialSecurityCapReached ? <span className="muted"> (Social Security cap reached)</span> : null}
                  </td>
                  <td className="num">{formatUSD(roster[i].grossWages)}</td>
                  {r.lines.map((l) => (
                    <td key={l.tax} className="num">{formatUSD(l.amount)}</td>
                  ))}
                  <td className="num">{formatUSD(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {people > MAX_ROWS ? (
            <p className="muted">Showing the first {MAX_ROWS} of {people} people. Totals below include everyone.</p>
          ) : null}
        </div>
      )}
      <h2>What this run costs you</h2>
      <table>
        <tbody>
          <tr><td>Gross wages</td><td className="num">{formatUSD(run.grossWages)}</td></tr>
          {Object.entries(LABELS).map(([k, l]) => (
            <tr key={k}><td>{l} (employer share)</td><td className="num">{formatUSD(run.byTax[k as keyof typeof LABELS])}</td></tr>
          ))}
          <tr><th>Total cost of this pay run</th><th className="num">{formatUSD(run.totalEmployerCost)}</th></tr>
          <tr><td className="muted">White Oak fee (billed monthly, not per run)</td><td className="num muted">{formatUSD(fee)}</td></tr>
        </tbody>
      </table>
    </>
  );
}
