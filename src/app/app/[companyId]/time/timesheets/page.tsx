import { Fragment } from "react";
import "../../../../time.css";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, prettyDate } from "@/components/ui";
import { managesTime } from "@/lib/time/access";
import { addDays, dayLabel, localDate } from "@/lib/time/clock";
import { toHours } from "@/lib/time/timesheet";
import { periodChoices, periodSummary } from "@/lib/time/timesheets";
import { timeSettings, timeTrackingOn } from "@/lib/time/service";
import { approveTimesheets, unapproveTimesheet } from "../actions";
import { TimeTabs } from "../tabs";

const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function TimesheetsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  const manage = managesTime(role, company);
  const { error, ok, sp } = await messages(searchParams);
  if (!(await timeTrackingOn(companyId))) notFound();
  const s = await timeSettings(companyId);
  const choices = await periodChoices(companyId);
  const today = localDate(new Date(), s.timeZone);
  const [ps, pe] = typeof sp.period === "string" ? sp.period.split("_") : [];
  const start = ymd(ps) ?? ymd(sp.start) ?? choices[0]?.start ?? addDays(today, -13);
  const end = ymd(pe) ?? ymd(sp.end) ?? choices[0]?.end ?? today;
  const { rows } = await periodSummary(companyId, start, end);
  const approvers = new Map((await db.user.findMany({ where: { id: { in: rows.flatMap((r) => (r.timesheet ? [r.timesheet.approvedById] : [])) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const sheetIds = await db.timesheet.findMany({ where: { companyId, periodStart: start, periodEnd: end }, select: { id: true, employeeId: true } });
  const days: string[] = [];
  for (let d = start; d <= end && days.length < 31; d = addDays(d, 1)) days.push(d);
  const total = (k: "regularMinutes" | "overtimeMinutes") => toHours(rows.reduce((a, r) => a + r.hours[k], 0));

  return (
    <>
      <h1>Timesheets</h1>
      <TimeTabs companyId={companyId} manage={manage} />
      <Notice error={error} ok={ok} />
      <form className="actions" method="get">
        <select name="period" defaultValue={`${start}_${end}`} aria-label="Pay period">
          {choices.map((c) => <option key={c.label} value={`${c.start}_${c.end}`}>{c.label}</option>)}
          {!choices.some((c) => c.start === start && c.end === end) && <option value={`${start}_${end}`}>{start} to {end}</option>}
        </select>
        <button type="submit" className="secondary">Show</button>
      </form>
      <details className="small">
        <summary>Other dates</summary>
        <form className="actions" method="get">
          <input type="date" name="start" defaultValue={start} aria-label="From" />
          <input type="date" name="end" defaultValue={end} aria-label="To" />
          <button type="submit" className="secondary">Show</button>
        </form>
      </details>
      <p className="small muted">
        Overtime is hours over 40 in a workweek starting {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.weekStartsOn]}, paid at 1.5 times the rate.
        Approving locks the period&apos;s shifts. Pay runs fill hours from here with &ldquo;Fill hours from Time Tracking&rdquo;.
      </p>
      {rows.length === 0 ? <p className="muted">No hourly employees or punches in this period.</p> : (
        <form action={approveTimesheets}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="start" value={start} />
          <input type="hidden" name="end" value={end} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {manage && <th><span className="sr-only">Approve</span></th>}
                  <th>Employee</th>
                  {days.length <= 16 && days.map((d) => <th key={d} className="num small">{dayLabel(d).replace(/,.*/, "")}<br />{d.slice(8)}</th>)}
                  <th className="num">Regular</th><th className="num">Overtime</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (<Fragment key={r.employee.id}>
                  <tr>
                    {manage && <td>{!r.timesheet && <input type="checkbox" name="employeeId" value={r.employee.id} defaultChecked={!r.hours.openShifts && !r.pendingCorrections} disabled={r.hours.openShifts > 0} aria-label={`Approve ${r.employee.firstName} ${r.employee.lastName}`} style={{ width: "auto" }} />}</td>}
                    <td>
                      {r.employee.firstName} {r.employee.lastName}
                      {r.employee.payBasis !== "HOURLY" && <span className="small muted"> salaried</span>}
                      {r.flagged > 0 && <a className="flag serious" href={`/app/${companyId}/time?week=${start}`}>{r.flagged} flagged</a>}
                      {r.pendingCorrections > 0 && <a className="flag" href={`/app/${companyId}/time`}>{r.pendingCorrections} request{r.pendingCorrections > 1 ? "s" : ""}</a>}
                    </td>
                    {days.length <= 16 && days.map((d) => <td key={d} className="num small">{r.hours.byDay[d] ? toHours(r.hours.byDay[d]).toFixed(2) : ""}</td>)}
                    <td className="num">{toHours(r.hours.regularMinutes).toFixed(2)}</td>
                    <td className="num">{r.hours.overtimeMinutes ? <b>{toHours(r.hours.overtimeMinutes).toFixed(2)}</b> : ""}</td>
                    <td className="small">
                      {r.timesheet ? (
                        <>
                          <span className="badge active">approved</span> {prettyDate(r.timesheet.approvedAt)} by {approvers.get(r.timesheet.approvedById) ?? "manager"}
                          {(r.timesheet.regularMinutes !== r.hours.regularMinutes || r.timesheet.overtimeMinutes !== r.hours.overtimeMinutes) && <div style={{ color: "#b7791f" }}>Hours changed since approval</div>}
                        </>
                      ) : r.hours.openShifts ? <span className="badge draft">still punched in</span> : <span className="badge draft">to approve</span>}
                    </td>
                  </tr>
                  {r.hours.warnings.length > 0 && (
                    <tr><td colSpan={99} className="small" style={{ color: "#b7791f", borderTop: 0, paddingTop: 0 }}>{r.hours.warnings.map((w) => <div key={w}>Check: {w}</div>)}</td></tr>
                  )}
                </Fragment>))}
              </tbody>
              <tfoot><tr>{manage && <th />}<th>Total</th>{days.length <= 16 && days.map((d) => <th key={d} />)}<th className="num">{total("regularMinutes").toFixed(2)}</th><th className="num">{total("overtimeMinutes").toFixed(2)}</th><th /></tr></tfoot>
            </table>
          </div>
          {manage && rows.some((r) => !r.timesheet) && <p><button type="submit">Approve ticked timesheets</button></p>}
        </form>
      )}
      {manage && sheetIds.length > 0 && (
        <details>
          <summary className="small">Reopen an approved timesheet</summary>
          {sheetIds.map((t) => {
            const r = rows.find((x) => x.employee.id === t.employeeId);
            return (
              <form key={t.id} action={unapproveTimesheet} className="inline">
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="timesheetId" value={t.id} />
                <button type="submit" className="link small">Reopen {r ? `${r.employee.firstName} ${r.employee.lastName}` : "timesheet"}</button>{" "}
              </form>
            );
          })}
        </details>
      )}
    </>
  );
}
