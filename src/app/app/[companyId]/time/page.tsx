import "../../../time.css";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { canUse, requireArea } from "@/lib/auth/session";
import { Notice, messages } from "@/components/ui";
import { managesTime } from "@/lib/time/access";
import { addDays, dayLabel, formatMinutes, localDate, localTime, paidMinutes, startOfLocalDay, weekStart } from "@/lib/time/clock";
import { SERIOUS_FLAGS, flagLabel } from "@/lib/time/flags";
import { formatDistance } from "@/lib/time/geofence";
import { timeSettings, timeTrackingOn } from "@/lib/time/service";
import { TimeTabs } from "./tabs";
import { AddShift, DecideCorrection, EditShift } from "./shift-forms";

type PunchRecord = { latitude?: number | null; longitude?: number | null; accuracy?: number | null; distanceMeters?: number | null; locationName?: string | null; inside?: boolean };

function Where({ p }: { p: PunchRecord | null }) {
  if (!p || p.latitude == null || p.longitude == null) return <span className="muted">no location</span>;
  const away = p.distanceMeters != null && !p.inside ? ` · ${formatDistance(p.distanceMeters)} from ${p.locationName}` : "";
  return (
    <a href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=18/${p.latitude}/${p.longitude}`} target="_blank" rel="noreferrer" className="small">
      {p.inside ? p.locationName ?? "map" : "map"}{away}{p.accuracy != null ? ` (±${p.accuracy} m)` : ""}
    </a>
  );
}

export default async function TimecardsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  const manage = managesTime(role, company);
  const { error, ok, sp } = await messages(searchParams);
  const on = await timeTrackingOn(companyId);
  if (!on) {
    return (
      <>
        <h1>Time Tracking</h1>
        <p>Employees punch in and out from their phones, only when they&apos;re at work. You set each work location on a map; punches from anywhere else are blocked or flagged. Hours flow into your pay runs.</p>
        <p>{canUse(role, "billing") || manage ? <a href={`/app/${companyId}/billing`}>Turn on Time Tracking in Plan and billing</a> : "Ask White Oak to turn on Time Tracking."}</p>
      </>
    );
  }
  const s = await timeSettings(companyId);
  const tz = s.timeZone;
  const today = localDate(new Date(), tz);
  const wk = weekStart(typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today, s.weekStartsOn);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  const from = startOfLocalDay(wk, tz);
  const to = startOfLocalDay(addDays(wk, 7), tz);
  const now = new Date();

  const [entries, openNow, blocked, locationCount, corrections] = await Promise.all([
    db.timeEntry.findMany({
      where: { companyId, clockInAt: { gte: from, lt: to } },
      include: { breaks: true, employee: true, location: true },
      orderBy: [{ clockInAt: "asc" }],
    }),
    db.timeEntry.findMany({ where: { companyId, clockOutAt: null }, include: { employee: true, location: true, breaks: true }, orderBy: { clockInAt: "asc" } }),
    db.auditLog.findMany({ where: { companyId, action: "time.punch_blocked", createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.workLocation.count({ where: { companyId, active: true } }),
    db.timeCorrection.findMany({ where: { companyId, status: "PENDING" }, include: { employee: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const back = `/app/${companyId}/time`;
  const activeEmployees = await db.employee.findMany({ where: { companyId, status: { not: "TERMINATED" } }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true } });
  const names = new Map((await db.employee.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

  const byEmp = new Map<string, typeof entries>();
  for (const e of entries) byEmp.set(e.employeeId, [...(byEmp.get(e.employeeId) ?? []), e]);
  const people = [...byEmp.entries()].sort((a, b) => a[1][0].employee.lastName.localeCompare(b[1][0].employee.lastName));
  const flagged = entries.filter((e) => e.flags.length > 0).length;

  return (
    <>
      <h1>Timecards</h1>
      <TimeTabs companyId={companyId} manage={manage} />
      <Notice error={error} ok={ok} />
      {locationCount === 0 && s.geofenceMode !== "OFF" && (
        <p className="notice error">No work locations yet, so punches aren&apos;t checked against a place. <a href={`/app/${companyId}/time/locations`}>Add a work location</a>.</p>
      )}

      {corrections.length > 0 && (
        <>
          <h2>Missed-punch requests</h2>
          {corrections.map((c) => (
            <div className="card" key={c.id}>
              <p><b>{c.employee.firstName} {c.employee.lastName}</b>: {c.entryId ? "forgot to punch out" : "missed shift"}, {dayLabel(localDate(c.clockInAt, tz))} {localTime(c.clockInAt, tz)} to {localTime(c.clockOutAt, tz)}{c.mealMinutes ? `, ${c.mealMinutes}-minute meal` : ""}.<br /><span className="small muted">&ldquo;{c.reason}&rdquo;</span></p>
              {manage ? <DecideCorrection companyId={companyId} id={c.id} back={back} /> : <p className="small muted">Waiting for your payroll manager.</p>}
            </div>
          ))}
        </>
      )}

      <h2>Working now</h2>
      {openNow.length === 0 ? <p className="muted">Nobody is punched in.</p> : (
        <div className="who-in">
          {openNow.map((e) => {
            const br = e.breaks.find((b) => !b.endAt);
            return (
              <div className="stat" key={e.id}>
                <b style={{ fontSize: "1rem" }}>{e.employee.firstName} {e.employee.lastName}</b>
                <span className="small">{br ? `On ${br.kind === "REST" ? "rest" : "meal"} break since ${localTime(br.startAt, tz)}` : `In since ${localTime(e.clockInAt, tz)}`}{localDate(e.clockInAt, tz) !== today ? ` ${dayLabel(localDate(e.clockInAt, tz))}` : ""}</span>
                <div className="small muted">{e.location?.name ?? "no location"} · {formatMinutes(paidMinutes(e, now))}</div>
                {e.flags.map((f) => <span key={f} className={`flag ${SERIOUS_FLAGS.has(f) ? "serious" : ""}`}>{flagLabel(f)}</span>)}
              </div>
            );
          })}
        </div>
      )}

      <h2>Week of {dayLabel(wk)}</h2>
      <p className="actions small">
        <a href={`?week=${addDays(wk, -7)}`}>← Previous week</a>
        {wk !== weekStart(today, s.weekStartsOn) && <a href="?">This week</a>}
        <a href={`?week=${addDays(wk, 7)}`}>Next week →</a>
        <span className="muted">{entries.length} shifts · {flagged} flagged</span>
      </p>
      {people.length === 0 ? <p className="muted">No punches this week.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th>{days.map((d) => <th key={d} className="num">{dayLabel(d).replace(/,.*/, "")}<br /><span className="small muted">{d.slice(5)}</span></th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {people.map(([id, list]) => {
                const perDay = days.map((d) => list.filter((e) => localDate(e.clockInAt, tz) === d).reduce((s, e) => s + paidMinutes(e, now), 0));
                const total = perDay.reduce((a, b) => a + b, 0);
                return (
                  <tr key={id}>
                    <td><a href={`#emp-${id}`}>{list[0].employee.firstName} {list[0].employee.lastName}</a>{list.some((e) => e.flags.length) && <span className="flag">review</span>}</td>
                    {perDay.map((m, i) => <td key={i} className="num">{m ? (m / 60).toFixed(2) : ""}</td>)}
                    <td className="num"><b>{(total / 60).toFixed(2)}</b>{total > 40 * 60 && <div className="small" style={{ color: "#b7791f" }}>{((total - 2400) / 60).toFixed(2)} over 40</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {people.map(([id, list]) => (
        <details key={id} id={`emp-${id}`} className="card" open={list.some((e) => e.flags.length > 0)}>
          <summary><b>{list[0].employee.firstName} {list[0].employee.lastName}</b> · {list.length} shift{list.length > 1 ? "s" : ""}</summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Day</th><th>In</th><th>Out</th><th>Breaks</th><th className="num">Paid</th><th>Review</th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>{dayLabel(localDate(e.clockInAt, tz))}{e.source !== "PHONE" && <div className="small muted">{e.source.toLowerCase()}</div>}</td>
                    <td>
                      {e.inPhoto && <a href={`/api/time/photo/${e.id}?side=in`} target="_blank" rel="noreferrer"><img className="punch-photo" src={`/api/time/photo/${e.id}?side=in`} alt="Punch-in photo" /></a>}{" "}
                      {localTime(e.clockInAt, tz)}<div><Where p={e.inPunch as PunchRecord} /></div>
                    </td>
                    <td>
                      {e.outPhoto && <a href={`/api/time/photo/${e.id}?side=out`} target="_blank" rel="noreferrer"><img className="punch-photo" src={`/api/time/photo/${e.id}?side=out`} alt="Punch-out photo" /></a>}{" "}
                      {e.clockOutAt ? <>{localTime(e.clockOutAt, tz)}<div><Where p={e.outPunch as PunchRecord} /></div></> : <span className="badge draft">still in</span>}
                    </td>
                    <td className="small">{e.breaks.map((b) => <div key={b.id}>{b.kind === "REST" ? "Rest" : "Meal"} {localTime(b.startAt, tz)}–{b.endAt ? localTime(b.endAt, tz) : "now"}</div>)}</td>
                    <td className="num">{formatMinutes(paidMinutes(e, now))}</td>
                    <td>
                      {e.flags.map((f) => <span key={f} className={`flag ${SERIOUS_FLAGS.has(f) ? "serious" : ""}`}>{flagLabel(f)}</span>)}
                      {e.note && <div className="small muted">{e.note}</div>}
                      {manage && <EditShift companyId={companyId} entry={e} date={localDate(e.clockInAt, tz)} tz={tz} back={back} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {manage && <AddShift companyId={companyId} employees={activeEmployees} today={today} back={back} />}

      {blocked.length > 0 && (
        <>
          <h2>Blocked punch attempts</h2>
          <p className="small muted">Punches refused because the person was away from every work location (or shared no location).</p>
          <table>
            <thead><tr><th>When</th><th>Employee</th><th>Tried to</th><th>Where</th></tr></thead>
            <tbody>
              {blocked.map((b) => {
                const d = b.detail as PunchRecord & { employeeId?: string; kind?: string };
                return (
                  <tr key={b.id}>
                    <td>{dayLabel(localDate(b.createdAt, tz))} {localTime(b.createdAt, tz)}</td>
                    <td>{names.get(d.employeeId ?? "") ?? "Unknown"}</td>
                    <td>{d.kind === "in" ? "punch in" : d.kind === "break_end" ? "end break" : d.kind}</td>
                    <td><Where p={d} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
