"use client";

import { useState } from "react";
import { formatUSD, type Cents } from "@/lib/money";
import { monthlyBill } from "@/lib/pricing";
import type { LaunchState } from "@/lib/payroll/schedules";
import { reviewPayRun, type ReviewLine } from "@/lib/pay-run/review";
import { sampleReview, SAMPLE_UNEMPLOYMENT } from "@/lib/preview/sample-review";
import { usePeopleCount } from "@/lib/preview/use-people-count";
import { PeopleInput } from "../people-input";

const STATES: { code: LaunchState; name: string }[] = [
  { code: "CT", name: "Connecticut" },
  { code: "MA", name: "Massachusetts" },
  { code: "NY", name: "New York" },
  { code: "OR", name: "Oregon" },
];
const MAX_ROWS = 50;

/** Plain-language note for each line so employers know what they are paying and why. */
const LINE_NOTES: Record<string, string> = {
  federal_income: "From each employee's Form W-4. Sent to the IRS.",
  social_security: "6.2% of wages up to $184,500 a year. Sent to the IRS.",
  medicare: "1.45% of all wages. Sent to the IRS.",
  additional_medicare: "0.9% on an employee's wages over $200,000 this year.",
  social_security_er: "You match the employee's 6.2%, up to $184,500 a year per person.",
  medicare_er: "You match the employee's 1.45%, with no cap.",
  futa: "0.6% on the first $7,000 per person each year, after the state credit.",
};

function noteFor(l: ReviewLine): string {
  if (LINE_NOTES[l.id]) return LINE_NOTES[l.id];
  if (l.id.endsWith("_sui")) {
    return `Sample rate ${(SAMPLE_UNEMPLOYMENT.rate * 100).toFixed(1)}% on the first ${formatUSD(SAMPLE_UNEMPLOYMENT.wageBase)}. Your state assigns your real rate.`;
  }
  if (l.id.endsWith("_paid_leave_er")) return "Employer share of the state paid leave program.";
  if (l.id.endsWith("_paid_leave")) return "Employee share of the state paid leave program, withheld from pay.";
  return "";
}

function LineTable({ lines, total, totalLabel }: { lines: ReviewLine[]; total: Cents; totalLabel: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Line</th>
            <th>What it is</th>
            <th className="num">People</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.filter((l) => l.amount > 0).map((l) => (
            <tr key={l.id}>
              <td>{l.label.replace(/ \(employer\)$/, "")}</td>
              <td className="muted small">{noteFor(l)}</td>
              <td className="num">{l.employees}</td>
              <td className="num">{formatUSD(l.amount)}</td>
            </tr>
          ))}
          <tr>
            <th colSpan={3}>{totalLabel}</th>
            <th className="num">{formatUSD(total)}</th>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function PayRunReview() {
  const { people } = usePeopleCount();
  const [state, setState] = useState<LaunchState>("CT");
  const [reviewed, setReviewed] = useState(false);
  const [approved, setApproved] = useState(false);

  const run = reviewPayRun(sampleReview(people, state));
  const fee = monthlyBill(people).total;
  const stateName = STATES.find((s) => s.code === state)?.name ?? state;

  const controls = (
    <div className="controls">
      <PeopleInput />
      <label>
        Work state{" "}
        <select value={state} onChange={(e) => { setState(e.target.value as LaunchState); setApproved(false); }}>
          {STATES.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </label>
    </div>
  );

  if (people === 0) {
    return (
      <>
        {controls}
        <p className="muted">Enter how many people you pay to see a sample pay run.</p>
      </>
    );
  }

  return (
    <>
      {controls}

      <section className="card" aria-labelledby="cash-needed">
        <p className="muted" id="cash-needed">Total cash needed for this pay run</p>
        <p className="big">{formatUSD(run.cashNeeded)}</p>
        <p className="muted small">
          Bi-weekly run for {people} {people === 1 ? "person" : "people"} in {stateName}: {formatUSD(run.gross)} gross
          wages plus {formatUSD(run.employerTaxes)} in employer taxes.
        </p>
        <table>
          <tbody>
            {run.cashBreakdown.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.label}
                  <div className="muted small">{d.detail}</div>
                </td>
                <td className="num">{formatUSD(d.amount)}</td>
              </tr>
            ))}
            <tr>
              <th>Total cash needed</th>
              <th className="num">{formatUSD(run.cashNeeded)}</th>
            </tr>
          </tbody>
        </table>
      </section>

      <h2>Taxes you pay on top of wages</h2>
      <p className="muted">These are your costs as the employer. None of them come out of your employees&rsquo; pay.</p>
      <LineTable lines={run.employerLines} total={run.employerTaxes} totalLabel="Employer taxes" />

      <h2>Withheld from employees&rsquo; pay</h2>
      <p className="muted">
        Already part of gross wages, so these do not add to your cost. White Oak sends them to the right agency for you.
      </p>
      <LineTable lines={run.employeeLines} total={run.employeeTaxes} totalLabel="Employee withholdings" />
      <p className="muted small">State income tax withholding is not in this preview yet. It will appear here as its own line.</p>

      {run.deductionLines.length > 0 ? (
        <>
          <h2>Deductions</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Deduction</th><th className="num">People</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {run.deductionLines.map((d) => (
                  <tr key={d.kind}><td>{d.label}</td><td className="num">{d.employees}</td><td className="num">{formatUSD(d.amount)}</td></tr>
                ))}
                <tr><th colSpan={2}>Deductions</th><th className="num">{formatUSD(run.deductions)}</th></tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <details className="per-employee">
        <summary>See each employee&rsquo;s paycheck</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Gross</th>
                <th className="num">Withheld</th>
                <th className="num">Deductions</th>
                <th className="num">Net pay</th>
                <th className="num">Employer taxes</th>
              </tr>
            </thead>
            <tbody>
              {run.employees.slice(0, MAX_ROWS).map((e) => (
                <tr key={e.employeeId}>
                  <td>{e.employeeId.replace(/ #\d+$/, "")}</td>
                  <td className="num">{formatUSD(e.gross)}</td>
                  <td className="num">{formatUSD(e.employeeTaxes)}</td>
                  <td className="num">{formatUSD(e.deductions)}</td>
                  <td className="num">{formatUSD(e.net)}</td>
                  <td className="num">{formatUSD(e.employerTaxes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {people > MAX_ROWS ? <p className="muted small">Showing the first {MAX_ROWS} of {people} people. Totals include everyone.</p> : null}
      </details>

      <section className="card approve">
        <label className="check">
          <input type="checkbox" checked={reviewed} onChange={(e) => { setReviewed(e.target.checked); setApproved(false); }} />
          I&rsquo;ve reviewed these amounts and want to pay {formatUSD(run.cashNeeded)} for this run.
        </label>
        <button type="button" disabled={!reviewed || approved} onClick={() => setApproved(true)}>
          Approve payroll
        </button>
        {approved ? (
          <p role="status">Approved in preview only. No money moved and nothing was filed.</p>
        ) : null}
        <p className="muted small">
          Your White Oak fee of {formatUSD(fee)} a month is billed separately and is not part of this run.
        </p>
      </section>
    </>
  );
}
