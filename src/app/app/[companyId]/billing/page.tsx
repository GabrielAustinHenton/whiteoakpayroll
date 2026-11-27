import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Notice, messages, usd } from "@/components/ui";
import { PRICING } from "@/lib/pricing";
import { refreshInvoice } from "@/lib/app/payroll-service";
import { toggleAddOn } from "../actions";

export default async function Billing({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const staff = canUse(role, "billing");
  const { error, ok } = await messages(searchParams);
  const month = new Date().toISOString().slice(0, 7);
  const bill = await refreshInvoice(companyId, month);
  const modules = await db.companyModule.findMany({ where: { companyId } });
  const invoices = await db.invoice.findMany({ where: { companyId }, orderBy: { month: "desc" } });
  const on = (k: "PTO" | "TIME_TRACKING") => modules.some((m) => m.addOn === k);
  return (
    <>
      <h1>Plan and billing</h1>
      <Notice error={error} ok={ok} />
      <div className="card">
        <p className="big">{usd(bill.total)}</p>
        <p className="muted">
          This month ({month}): {bill.peopleCount} {bill.peopleCount === 1 ? "person" : "people"} on payroll, tier {bill.tier}
          {bill.tierRange ? ` (${bill.tierRange.from} to ${bill.tierRange.to} people)` : ""} at {usd(PRICING.pricePerTier)} per 5 people. Everyone on
          payroll during the month counts: employees from the day you add them, and active contractors. Someone you offboard still counts for that
          month and drops off the next. No base fee, no per-employee fee.
        </p>
        <p className="small muted">Prices are placeholders and no card is charged in preview.</p>
      </div>
      <h2>Add-ons</h2>
      {([["TIME_TRACKING", "Time Tracking", "Employees punch in and out from their phones, only at work (geofenced), with breaks and optional photo; hours flow into pay runs."], ["PTO", "PTO", "Paid time off policies and balances beyond required sick leave."]] as const).map(([k, name, desc]) => (
        <div className="card" key={k}>
          <div className="actions">
            <b>{name}</b>
            <span className={`badge ${on(k) ? "active" : ""}`}>{on(k) ? "on" : "off"}</span>
            {staff && <form action={toggleAddOn} className="inline">
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="addOn" value={k} />
              <button type="submit" className="secondary">{on(k) ? "Turn off" : "Turn on"}</button>
            </form>}
          </div>
          <p className="small muted">{desc} Price to be announced.</p>
        </div>
      ))}
      <h2>Invoices</h2>
      <table>
        <thead><tr><th>Month</th><th className="num">People</th><th className="num">Tier</th><th className="num">Total</th></tr></thead>
        <tbody>
          {invoices.map((i) => <tr key={i.id}><td>{i.month}</td><td className="num">{i.peoplePaid}</td><td className="num">{i.tier}</td><td className="num">{usd(i.totalCents)}</td></tr>)}
        </tbody>
      </table>
    </>
  );
}
