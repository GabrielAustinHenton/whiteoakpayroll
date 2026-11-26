import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate, usd } from "@/components/ui";
import { FREQUENCY_LABEL, nextPeriod, type Frequency } from "@/lib/app/periods";
import { startPayRun } from "../actions";

export default async function Payroll({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const staff = canUse(role, "payroll");
  const { error, ok } = await messages(searchParams);
  const schedules = await db.paySchedule.findMany({ where: { companyId }, include: { payRuns: { where: { offCycle: false }, orderBy: { payday: "desc" }, take: 1 } } });
  const runs = await db.payRun.findMany({ where: { companyId, ...(staff ? {} : { status: { in: ["APPROVED", "PAID"] } }) }, orderBy: { payday: "desc" }, include: { paySchedule: true, _count: { select: { lines: true } } } });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <>
      <h1>Pay runs</h1>
      <Notice error={error} ok={ok} />
      {!staff && <p className="muted">White Oak runs your payroll. Open a pay run for its register, paystubs and checks.</p>}
      {staff && schedules.length === 0 && <p className="notice">Create a pay schedule in <a href={`/app/${companyId}/settings#schedules`}>Company settings</a> first.</p>}
      {staff && schedules.map((s) => {
        const p = nextPeriod(s.frequency as Frequency, iso(s.anchorPayday), s.payLagDays, s.payRuns[0] ? iso(s.payRuns[0].payday) : null);
        return (
          <div className="card" key={s.id}>
            <p><b>{s.name}</b> · {FREQUENCY_LABEL[s.frequency as Frequency]}</p>
            <p className="muted">Next: pays {p.periodStart} to {p.periodEnd}, payday {p.payday}</p>
            <form action={startPayRun}>
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="payScheduleId" value={s.id} />
              <button type="submit">Start this pay run</button>
            </form>
          </div>
        );
      })}
      <h2>All pay runs</h2>
      {runs.length === 0 ? <p className="muted">None yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Payday</th><th>Period</th><th>Schedule</th><th>Status</th><th className="num">People</th><th className="num">Gross</th><th className="num">Cash needed</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><a href={`/app/${companyId}/payroll/${r.id}`}>{prettyDate(r.payday)}</a></td>
                  <td className="small">{iso(r.periodStart)} to {iso(r.periodEnd)}</td>
                  <td>{r.paySchedule.name}</td>
                  <td><span className={`badge ${r.status.toLowerCase()}`}>{r.status.toLowerCase()}</span></td>
                  <td className="num">{r._count.lines}</td>
                  <td className="num">{usd(r.grossCents)}</td>
                  <td className="num">{usd(r.cashNeededCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
