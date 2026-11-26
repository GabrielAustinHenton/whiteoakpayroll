import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import type { LineDetail } from "@/lib/app/engine";
import type { TaxLine } from "@/lib/tax-engine";
import { DEDUCTION_LABELS } from "@/lib/pay-run/review";
import { approveRun, deleteDraftRun, removeContractorPayment, saveRunInputs, voidOrReissueCheck } from "../../actions";

function group(details: LineDetail[], payer: "employee" | "employer") {
  const m = new Map<string, { label: string; jurisdiction: string; amount: number }>();
  for (const d of details)
    for (const l of d.result.lines as TaxLine[]) {
      if (l.payer !== payer) continue;
      const row = m.get(l.id) ?? { label: l.label, jurisdiction: l.jurisdiction, amount: 0 };
      row.amount += l.amount;
      m.set(l.id, row);
    }
  return [...m.values()].filter((r) => r.amount !== 0);
}

export default async function PayRunPage({ params, searchParams }: { params: Promise<{ companyId: string; runId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId, runId } = await params;
  await requireArea(companyId, "payroll");
  const { error, ok } = await messages(searchParams);
  const run = await db.payRun.findFirst({
    where: { id: runId, companyId },
    include: { paySchedule: true, lines: { include: { employee: true }, orderBy: { employee: { lastName: "asc" } } }, contractorPayments: { include: { contractor: true } } },
  });
  if (!run) notFound();
  const contractors = await db.contractor.findMany({ where: { companyId, status: "ACTIVE" } });
  const checks = await db.check.findMany({
    where: { companyId, OR: [{ payRunLine: { payRunId: runId } }, { contractorPayment: { payRunId: runId } }] },
    orderBy: { number: "asc" },
  });
  const draft = run.status === "DRAFT";
  const details = run.lines.map((l) => l.detail as unknown as LineDetail).filter(Boolean);
  const employeeTaxes = group(details, "employee");
  const employerTaxes = group(details, "employer");
  const deductions = new Map<string, number>();
  for (const d of details) for (const x of d.deductionDetail) deductions.set(x.kind, (deductions.get(x.kind) ?? 0) + x.amount);
  const contractorTotal = run.contractorPayments.reduce((s, p) => s + p.amountCents, 0);
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const net = run.lines.reduce((s, l) => s + l.netCents, 0);
  const federal = sum([...employeeTaxes, ...employerTaxes].filter((x) => x.jurisdiction === "US"));
  const state = sum([...employeeTaxes, ...employerTaxes].filter((x) => x.jurisdiction !== "US"));
  const hidden = (
    <>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="payRunId" value={run.id} />
    </>
  );
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <>
      <h1>Pay run: payday {prettyDate(run.payday)} <span className={`badge ${run.status.toLowerCase()}`}>{run.status.toLowerCase()}</span></h1>
      <p className="muted">{run.paySchedule.name} · pays {iso(run.periodStart)} to {iso(run.periodEnd)}{run.fundingRef ? ` · funding ref ${run.fundingRef} (simulated)` : ""}</p>
      <Notice error={error} ok={ok} />

      <form action={saveRunInputs}>
        {hidden}
        <h2>{draft ? "1. Hours and extra pay" : "Paychecks"}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr>{draft && <th>Pay?</th>}<th>Employee</th><th className="num">Hours</th><th className="num">Bonus</th><th className="num">Gross</th><th className="num">Taxes</th><th className="num">Deductions</th><th className="num">Net pay</th>{!draft && <th>Paystub</th>}</tr></thead>
            <tbody>
              {run.lines.map((l) => (
                <tr key={l.id}>
                  {draft && <td><input type="checkbox" name={`include_${l.id}`} defaultChecked style={{ width: "auto" }} /></td>}
                  <td>{l.employee.firstName} {l.employee.lastName} <span className="small muted">{l.employee.workState} · {l.employee.paymentMethod === "CHECK" ? "check" : "direct deposit"}</span></td>
                  <td className="num">
                    {l.employee.payBasis === "HOURLY"
                      ? draft ? <input name={`hours_${l.id}`} defaultValue={l.hours ?? 0} inputMode="decimal" /> : l.hours
                      : <span className="muted">salary</span>}
                  </td>
                  <td className="num">{draft ? <input name={`bonus_${l.id}`} defaultValue={l.bonusCents ? (l.bonusCents / 100).toFixed(2) : ""} inputMode="decimal" /> : usd(l.bonusCents)}</td>
                  <td className="num">{usd(l.grossCents)}</td>
                  <td className="num">{usd(l.employeeTaxesCents)}</td>
                  <td className="num">{usd(l.deductionsCents)}</td>
                  <td className="num"><b>{usd(l.netCents)}</b></td>
                  {!draft && <td><a href={`/app/${companyId}/paystubs/${l.id}`}>View</a> · <a href={`/api/paystubs/${l.id}`}>PDF</a></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Contractors</h3>
        {run.contractorPayments.length > 0 && (
          <table>
            <tbody>
              {run.contractorPayments.map((p) => (
                <tr key={p.id}><td>{p.contractor.legalName}</td><td className="small muted">{p.memo}</td><td className="num">{usd(p.amountCents)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {draft && contractors.length > 0 && (
          <div className="row">
            <select name="contractorId" defaultValue="">
              <option value="">Add a contractor payment…</option>
              {contractors.map((k) => <option key={k.id} value={k.id}>{k.legalName}</option>)}
            </select>
            <input name="contractorAmount" placeholder="Amount" inputMode="decimal" />
            <input name="contractorMemo" placeholder="Memo (optional)" />
          </div>
        )}
        {draft && contractors.length === 0 && run.contractorPayments.length === 0 && <p className="muted small">No contractors.</p>}
        {draft && <p><button type="submit" className="secondary">Recalculate</button></p>}
      </form>
      {draft && run.contractorPayments.map((p) => (
        <form key={p.id} action={removeContractorPayment} className="inline">
          {hidden}
          <input type="hidden" name="paymentId" value={p.id} />
          <button type="submit" className="link small">Remove {p.contractor.legalName} payment</button>{" "}
        </form>
      ))}

      {!draft && (
        <>
          <h2>Payments</h2>
          <p className="muted">
            Direct deposits go out on payday (simulated until TD Bank is connected).{" "}
            {checks.some((c) => c.status === "ISSUED") && <a href={`/api/payruns/${run.id}/checks`}><b>Print checks (PDF)</b></a>}
          </p>
          {checks.length > 0 && (
            <table>
              <thead><tr><th>Check</th><th>Payee</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id}>
                    <td>{c.number}</td>
                    <td>{c.payee}</td>
                    <td className="num">{usd(c.amountCents)}</td>
                    <td>{c.status === "VOID" ? `void${c.voidReason ? ` (${c.voidReason})` : ""}` : "issued"}</td>
                    <td>
                      {c.status === "ISSUED" && (
                        <form action={voidOrReissueCheck} className="actions">
                          {hidden}
                          <input type="hidden" name="checkId" value={c.id} />
                          <input name="reason" placeholder="Reason (lost, misprint…)" />
                          <a href={`/api/payruns/${run.id}/checks?check=${c.id}`}>Print</a>
                          <button name="mode" value="reissue" type="submit" className="secondary">Void and reissue</button>
                          <button name="mode" value="void" type="submit" className="link">Void only</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <h2>{draft ? "2. Review every line" : "Totals"}</h2>
      <div className="stats">
        <div className="stat"><b>{usd(run.grossCents)}</b>gross wages</div>
        <div className="stat"><b>{usd(run.employerTaxesCents)}</b>your employer taxes</div>
        <div className="stat"><b>{usd(contractorTotal)}</b>contractor payments</div>
        <div className="stat"><b>{usd(run.cashNeededCents)}</b>total cash from your account</div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div>
          <h3>Withheld from employees</h3>
          <table><tbody>
            {employeeTaxes.map((t) => <tr key={t.label}><td>{t.label}</td><td className="num">{usd(t.amount)}</td></tr>)}
            {[...deductions].map(([k, v]) => <tr key={k}><td>{DEDUCTION_LABELS[k as keyof typeof DEDUCTION_LABELS] ?? k}</td><td className="num">{usd(v)}</td></tr>)}
          </tbody></table>
        </div>
        <div>
          <h3>You pay on top of wages</h3>
          <table><tbody>
            {employerTaxes.map((t) => <tr key={t.label}><td>{t.label}</td><td className="num">{usd(t.amount)}</td></tr>)}
            <tr><td><b>Total employer taxes</b></td><td className="num"><b>{usd(run.employerTaxesCents)}</b></td></tr>
          </tbody></table>
        </div>
      </div>
      <h3>Where the money goes</h3>
      <table><tbody>
        <tr><td>Net pay by direct deposit</td><td className="num">{usd(net)}</td></tr>
        <tr><td>Contractors by direct deposit</td><td className="num">{usd(contractorTotal)}</td></tr>
        <tr><td>Federal taxes (IRS via EFTPS)</td><td className="num">{usd(federal)}</td></tr>
        <tr><td>State taxes and programs</td><td className="num">{usd(state)}</td></tr>
        <tr><td>Benefits and other deductions</td><td className="num">{usd(sum([...deductions].map(([, amount]) => ({ amount }))))}</td></tr>
        <tr><td><b>Total</b></td><td className="num"><b>{usd(run.cashNeededCents)}</b></td></tr>
      </tbody></table>

      {draft && (
        <>
          <h2>3. Approve</h2>
          <form action={approveRun} className="approve">
            {hidden}
            <label className="check"><input type="checkbox" name="confirm" /> I reviewed these totals. Take {usd(run.cashNeededCents)} from the company account and pay everyone on {prettyDate(run.payday)}.</label>
            <button type="submit">Approve and pay (simulated)</button>
          </form>
          <form action={deleteDraftRun} style={{ marginTop: 16 }}>
            {hidden}
            <button type="submit" className="link">Delete this draft</button>
          </form>
        </>
      )}
    </>
  );
}
