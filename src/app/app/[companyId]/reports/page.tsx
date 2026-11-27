import { requireArea } from "@/lib/auth/session";
import { usd } from "@/components/ui";
import { REPORTS, laborCost, parseRange, payrollRegister, taxLiability, type ReportKind } from "@/lib/reports";
import { loadReportData, reportYears } from "@/lib/reports/load";

export default async function Reports({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "reports");
  const sp = await searchParams;
  const range = parseRange(sp.period);
  const [{ lines, contractors }, years] = await Promise.all([loadReportData(companyId, range), reportYears(companyId)]);
  const reg = payrollRegister(lines);
  const tax = taxLiability(lines);
  const cost = laborCost(lines, contractors);
  const contractorTotal = contractors.reduce((s, p) => s + p.amountCents, 0);
  const totalCost = reg.totals.grossCents + reg.totals.employerTaxesCents + contractorTotal;
  const csv = (k: ReportKind) => `/api/companies/${companyId}/reports/${k}?period=${range.label}`;
  const periods = years.flatMap((y) => [String(y), `${y}-Q1`, `${y}-Q2`, `${y}-Q3`, `${y}-Q4`]);

  return (
    <>
      <h1>Reports</h1>
      <form className="controls" method="get">
        <label className="field">
          <span>Period</span>
          <select name="period" defaultValue={range.label}>
            {periods.map((p) => <option key={p} value={p}>{p.includes("Q") ? `${p.slice(5)} ${p.slice(0, 4)}` : `All of ${p}`}</option>)}
          </select>
        </label>
        <button type="submit" className="secondary">Show</button>
      </form>
      <p className="muted small">Paid pay runs with a payday in {range.label}. Download any report as a spreadsheet (CSV) for your accountant.</p>

      <div className="stats">
        <div className="stat"><span className="muted small">Gross pay</span><b>{usd(reg.totals.grossCents)}</b></div>
        <div className="stat"><span className="muted small">Employer taxes</span><b>{usd(reg.totals.employerTaxesCents)}</b></div>
        <div className="stat"><span className="muted small">Contractors</span><b>{usd(contractorTotal)}</b></div>
        <div className="stat"><span className="muted small">Total labor cost</span><b>{usd(totalCost)}</b></div>
      </div>

      {lines.length === 0 && contractors.length === 0 ? (
        <div className="empty">
          <p><b>Nothing paid in {range.label} yet.</b></p>
          <p className="muted">Reports fill in as soon as a pay run is paid. Pick another period above, or open <a href={`/app/${companyId}/payroll`}>Pay runs</a>.</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="h-register">
            <div className="section-head">
              <h2 id="h-register">{REPORTS.register}</h2>
              <a className="button secondary" href={csv("register")} download>Download CSV</a>
            </div>
            <p className="muted small">{reg.totals.paychecks} paycheck{reg.totals.paychecks === 1 ? "" : "s"}. The CSV has one row per paycheck, with every tax and deduction in its own column.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Totals</th><th className="num" scope="col">Gross</th><th className="num" scope="col">Employee taxes</th><th className="num" scope="col">Deductions</th><th className="num" scope="col">Net pay</th><th className="num" scope="col">Employer taxes</th></tr></thead>
                <tbody>
                  <tr><th scope="row">{range.label}</th><td className="num">{usd(reg.totals.grossCents)}</td><td className="num">{usd(reg.totals.employeeTaxesCents)}</td><td className="num">{usd(reg.totals.deductionsCents)}</td><td className="num">{usd(reg.totals.netCents)}</td><td className="num">{usd(reg.totals.employerTaxesCents)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="h-tax">
            <div className="section-head">
              <h2 id="h-tax">{REPORTS["tax-liability"]}</h2>
              <a className="button secondary" href={csv("tax-liability")} download>Download CSV</a>
            </div>
            <p className="muted small">Every tax withheld from paychecks or owed by the business, by quarter. These are the amounts deposited and reported on your returns.</p>
            {tax.length === 0 ? <p className="muted">No taxes in this period.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">Quarter</th><th scope="col">Where</th><th scope="col">Tax</th><th scope="col">Paid by</th><th className="num" scope="col">Taxable wages</th><th className="num" scope="col">Amount</th></tr></thead>
                  <tbody>
                    {tax.map((r) => (
                      <tr key={`${r.quarter}${r.jurisdiction}${r.id}`}>
                        <td>{r.quarter}</td><td>{r.jurisdiction === "US" ? "Federal" : r.jurisdiction}</td><td>{r.label}</td>
                        <td className="small">{r.payer === "employee" ? "Withheld" : "Employer"}</td>
                        <td className="num">{usd(r.taxableWagesCents)}</td><td className="num">{usd(r.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th colSpan={5}>Total</th><th className="num">{usd(tax.reduce((s, r) => s + r.amountCents, 0))}</th></tr></tfoot>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="h-cost">
            <div className="section-head">
              <h2 id="h-cost">{REPORTS["labor-cost"]}</h2>
              <a className="button secondary" href={csv("labor-cost")} download>Download CSV</a>
            </div>
            <p className="muted small">Gross pay plus the employer&apos;s share of taxes for each employee, and what each contractor was paid.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Name</th><th className="num" scope="col">Payments</th><th className="num" scope="col">Hours</th><th className="num" scope="col">Gross</th><th className="num" scope="col">Employer taxes</th><th className="num" scope="col">Total cost</th></tr></thead>
                <tbody>
                  {cost.map((r) => (
                    <tr key={`${r.kind}${r.id}`}>
                      <td>{r.name}{r.kind === "contractor" && <span className="badge" style={{ marginLeft: 8 }}>contractor</span>}</td>
                      <td className="num">{r.paychecks}</td>
                      <td className="num">{r.hours ? (Math.round(r.hours * 100) / 100).toLocaleString("en-US") : ""}</td>
                      <td className="num">{usd(r.grossCents)}</td>
                      <td className="num">{r.kind === "employee" ? usd(r.employerTaxesCents) : ""}</td>
                      <td className="num">{usd(r.totalCostCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th colSpan={5}>Total</th><th className="num">{usd(totalCost)}</th></tr></tfoot>
              </table>
            </div>
          </section>

          {contractors.length > 0 && (
            <section aria-labelledby="h-contractors">
              <div className="section-head">
                <h2 id="h-contractors">{REPORTS.contractors}</h2>
                <a className="button secondary" href={csv("contractors")} download>Download CSV</a>
              </div>
              <p className="muted small">{contractors.length} payment{contractors.length === 1 ? "" : "s"} totaling {usd(contractorTotal)}. Year totals feed each contractor&apos;s 1099-NEC.</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
