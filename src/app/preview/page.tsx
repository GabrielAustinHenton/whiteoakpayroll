import { summarizePayRunCost } from "@/lib/taxes/employer-taxes";
import { dollars, formatUSD } from "@/lib/money";
import { monthlyBill } from "@/lib/pricing";

// Sample data until pay runs are wired to the database and payroll provider.
const SAMPLE = [
  { employeeId: "Ana Ruiz", grossWages: dollars(2_400), ytdWagesBefore: dollars(4_800) },
  { employeeId: "Ben Cho", grossWages: dollars(1_850), ytdWagesBefore: dollars(6_200) },
  { employeeId: "Dee Park", grossWages: dollars(7_500), ytdWagesBefore: dollars(180_000) },
];
const SAMPLE_SUTA = { rate: 0.03, wageBase: dollars(26_100) };

const LABELS = { social_security: "Social Security", medicare: "Medicare", futa: "FUTA", suta: "State unemployment" } as const;

export default function PreviewPage() {
  const run = summarizePayRunCost(SAMPLE, SAMPLE_SUTA);
  const fee = monthlyBill(SAMPLE.length).total;

  return (
    <>
      <h1>Pay run preview</h1>
      <p className="muted">Sample data. This is the screen an employer sees before approving payroll.</p>
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
            {run.perEmployee.map((r, i) => (
              <tr key={r.employeeId}>
                <td>
                  {r.employeeId}
                  {r.socialSecurityCapReached ? <span className="muted"> (Social Security cap reached)</span> : null}
                </td>
                <td className="num">{formatUSD(SAMPLE[i].grossWages)}</td>
                {r.lines.map((l) => (
                  <td key={l.tax} className="num">{formatUSD(l.amount)}</td>
                ))}
                <td className="num">{formatUSD(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
