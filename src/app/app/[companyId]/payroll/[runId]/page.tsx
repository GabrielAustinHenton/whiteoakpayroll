import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import type { LineDetail } from "@/lib/app/engine";
import { feeForRun } from "@/lib/app/payroll-service";
import { PRICING, priceLabel } from "@/lib/pricing";
import type { TaxLine } from "@/lib/tax-engine";
import { DEDUCTION_LABELS } from "@/lib/pay-run/review";
import { GridKeys } from "./grid-keys";
import { FillHoursFromTime } from "../../time/fill-hours";
import { runChecks } from "@/lib/app/run-checks";
import { approveBy } from "@/lib/app/todos";
import { approveRun, deleteDraftRun, removeContractorPayment, saveRunInputs, voidOrReissueCheck, importHours } from "../../actions";

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
  const { role, mode } = await requireArea(companyId, "reports");
  const staff = canUse(role, "payroll", mode);
  const { error, ok, sp } = await messages(searchParams);
  const imported = typeof sp.imported === "string" ? sp.imported : "";
  const run = await db.payRun.findFirst({
    where: { id: runId, companyId },
    include: { paySchedule: true, lines: { include: { employee: true }, orderBy: { employee: { lastName: "asc" } } }, contractorPayments: { include: { contractor: true } } },
  });
  // Clients see a pay run once White Oak has approved it.
  if (!run || (!staff && run.status === "DRAFT")) notFound();
  const contractors = await db.contractor.findMany({ where: { companyId, status: "ACTIVE" } });
  const fee = await feeForRun(run.id);
  const monthName = new Date(`${fee.month}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
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
  const flags = draft && staff ? await draftFlags(run, iso) : [];
  const blocked = flags.some((f) => f.level === "stop");

  return (
    <>
      <h1>Pay run: payday {prettyDate(run.payday)} <span className={`badge ${run.status.toLowerCase()}`}>{run.status.toLowerCase()}</span></h1>
      <p className="muted">{run.paySchedule.name} · pays {iso(run.periodStart)} to {iso(run.periodEnd)}{run.fundingRef ? ` · funding ref ${run.fundingRef} (simulated)` : ""}</p>
      <Notice error={error} ok={ok} />

      {draft && <FillHoursFromTime companyId={companyId} payRunId={run.id} period={`${iso(run.periodStart)} to ${iso(run.periodEnd)}`} />}
      {draft && (
        <details className="card" open={!!imported}>
          <summary><b>Import hours from BuddyPunch</b> (or another time clock)</summary>
          <p className="small muted">
            In BuddyPunch run the <b>Payroll Export</b> (or Hours Summary) report for {iso(run.periodStart)} to {iso(run.periodEnd)} and download it as CSV.
            Upload it here: hours are matched to employees by name and filled into the grid below for you to check before approving.
          </p>
          <form action={importHours} className="actions">
            {hidden}
            <input type="file" name="file" accept=".csv,text/csv" required style={{ width: "auto" }} />
            <button type="submit" className="secondary">Import hours</button>
          </form>
          {imported && <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{imported}</pre>}
        </details>
      )}

      <form action={saveRunInputs}>
        {hidden}
        <h2>{draft ? "1. Hours and extra pay" : "Paychecks"}</h2>
        {draft && <p className="small muted">Type hours, press Tab to move to the next box, and press Enter to recalculate. Overtime is paid at 1.5 times the hourly rate.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr>{draft && <th>Pay?</th>}<th>Employee</th><th className="num">Hours</th><th className="num">Overtime</th><th className="num">Bonus</th><th className="num">Gross</th><th className="num">Taxes</th><th className="num">Deductions</th><th className="num">Net pay</th>{!draft && <th>Paystub</th>}</tr></thead>
            <tbody>
              {run.lines.map((l) => (
                <tr key={l.id}>
                  {draft && <td><input type="checkbox" name={`include_${l.id}`} defaultChecked tabIndex={-1} aria-label={`Pay ${l.employee.firstName} ${l.employee.lastName}`} style={{ width: "auto" }} /></td>}
                  <td>{l.employee.firstName} {l.employee.lastName} <span className="small muted">{l.employee.workState} · {l.employee.paymentMethod === "CHECK" ? "check" : "direct deposit"}</span></td>
                  <td className="num">
                    {l.employee.payBasis === "HOURLY"
                      ? draft ? <input name={`hours_${l.id}`} className="grid-hours" defaultValue={l.hours ?? 0} inputMode="decimal" aria-label={`Hours for ${l.employee.firstName} ${l.employee.lastName}`} /> : l.hours
                      : <span className="muted">salary</span>}
                  </td>
                  <td className="num">
                    {l.employee.payBasis === "HOURLY"
                      ? draft ? <input name={`ot_${l.id}`} defaultValue={l.overtimeHours || ""} inputMode="decimal" aria-label={`Overtime hours for ${l.employee.firstName} ${l.employee.lastName}`} /> : l.overtimeHours || ""
                      : ""}
                  </td>
                  <td className="num">{draft ? <input name={`bonus_${l.id}`} defaultValue={l.bonusCents ? (l.bonusCents / 100).toFixed(2) : ""} inputMode="decimal" aria-label={`Bonus for ${l.employee.firstName} ${l.employee.lastName}`} /> : usd(l.bonusCents)}</td>
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
      {draft && <GridKeys />}
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
            {checks.some((c) => c.status === "ISSUED") && <><a href={`/api/payruns/${run.id}/checks`}><b>Print all checks (PDF)</b></a> · </>}
            {run.status === "PAID" && <a href={`/api/payruns/${run.id}/paystubs`}><b>Print all paystubs (PDF)</b></a>}
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
                      {c.status === "ISSUED" && !staff && <a href={`/api/payruns/${run.id}/checks?check=${c.id}`}>Print</a>}
                      {c.status === "ISSUED" && staff && (
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
      <div className="card">
        <p className="big">{usd(fee.bill.total)}</p>
        <p>
          <b>White Oak Payroll fee for {monthName}</b>: {fee.bill.tierRange ? `${fee.people} ${fee.people === 1 ? "person" : "people"} on payroll this month, tier ${fee.bill.tier} (${fee.bill.tierRange.from} to ${fee.bill.tierRange.to} people) at ${priceLabel()}` : "nobody on payroll yet this month"}
          {fee.bill.addOns.length > 0 && ` plus ${fee.bill.addOns.map((a) => `${a.name} ${usd(a.price)}`).join(", ")}`}.
        </p>
        <p className="small muted">
          One flat monthly fee, billed separately on {prettyDate(fee.billedOn)}. It is not part of this pay run&apos;s cash, and running payroll again this month does not raise it; adding people does. No per-employee or per-run fees. <a href={`/app/${companyId}/billing`}>Plan and billing</a>
        </p>
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
          {flags.length > 0 && (
            <>
              <p><b>Before you approve, check {flags.length === 1 ? "this" : `these ${flags.length} things`}:</b></p>
              <ul className="flags">{flags.map((f, i) => <li key={i} className={f.level === "stop" ? "block" : ""}>{f.message}</li>)}</ul>
            </>
          )}
          <form action={approveRun} className="approve">
            {hidden}
            <label className="check"><input type="checkbox" name="confirm" /> I reviewed these totals. Take {usd(run.cashNeededCents)} from the company account and pay everyone on {prettyDate(run.payday)}.</label>
            <button type="submit" disabled={blocked}>Approve and pay (simulated)</button>
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

type RunWithLines = { id: string; companyId: string; payScheduleId: string; payday: Date; lines: { employeeId: string; hours: number | null; overtimeHours: number; bonusCents: number; grossCents: number; netCents: number; employee: { firstName: string; lastName: string; payBasis: "HOURLY" | "SALARIED"; defaultHours: number; paymentMethod: string; bankLast4: string | null; i9CompletedAt: Date | null; hireDate: Date; terminationDate: Date | null } }[]; periodStart: Date; periodEnd: Date };

/** Pre-run checks for a draft: unusual hours or pay, missing bank accounts, onboarding not done. */
async function draftFlags(run: RunWithLines, iso: (d: Date) => string) {
  const [previous, waiting] = await Promise.all([
    db.payRunLine.findMany({
      where: { employeeId: { in: run.lines.map((l) => l.employeeId) }, grossCents: { gt: 0 }, payRun: { status: "PAID", offCycle: false, payday: { lt: run.payday } } },
      orderBy: { payRun: { payday: "desc" } },
      select: { employeeId: true, grossCents: true },
    }),
    db.employee.findMany({ where: { companyId: run.companyId, payScheduleId: run.payScheduleId, status: { not: "TERMINATED" }, ssn: "" }, select: { firstName: true, lastName: true } }),
  ]);
  const last = new Map<string, number>();
  for (const p of previous) if (!last.has(p.employeeId)) last.set(p.employeeId, p.grossCents);
  const payday = iso(run.payday);
  return runChecks({
    today: iso(new Date()),
    payday,
    approveBy: approveBy(payday),
    periodStart: iso(run.periodStart),
    periodEnd: iso(run.periodEnd),
    lines: run.lines.map((l) => ({
      name: `${l.employee.firstName} ${l.employee.lastName}`,
      payBasis: l.employee.payBasis,
      hours: l.hours,
      overtimeHours: l.overtimeHours,
      defaultHours: l.employee.defaultHours,
      bonusCents: l.bonusCents,
      grossCents: l.grossCents,
      netCents: l.netCents,
      previousGrossCents: last.get(l.employeeId) ?? null,
      paymentMethod: l.employee.paymentMethod,
      bankLast4: l.employee.bankLast4,
      i9Done: !!l.employee.i9CompletedAt,
      hireDate: iso(l.employee.hireDate),
      terminationDate: l.employee.terminationDate ? iso(l.employee.terminationDate) : null,
    })),
    waitingOnboarding: waiting.map((w) => `${w.firstName} ${w.lastName}`),
  });
}
