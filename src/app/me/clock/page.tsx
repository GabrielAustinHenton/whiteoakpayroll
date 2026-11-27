import "../../time.css";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { clockStatus, timeSettings, timeTrackingOn } from "@/lib/time/service";
import { formatMinutes, localDate, localTime, paidMinutes, startOfLocalDay } from "@/lib/time/clock";
import { PunchClock } from "./punch-clock";
import { LocationNotice } from "./location-notice";

export const metadata = { title: "Time clock · White Oak Payroll" };
export const dynamic = "force-dynamic";

export default async function ClockPage() {
  const user = await requireUser();
  const e = await db.employee.findUnique({ where: { userId: user.id }, include: { company: true } });
  if (!e) {
    return (
      <>
        <h1>Time clock</h1>
        <p className="muted">Your login is not linked to an employee record.</p>
      </>
    );
  }
  const company = e.company.tradeName ?? e.company.legalName;
  if (!(await timeTrackingOn(e.companyId))) {
    return (
      <>
        <h1>Time clock</h1>
        <p className="muted">{company} doesn't use White Oak's time clock. Ask your manager how to record your hours.</p>
        <p><a href="/me">← My pay</a></p>
      </>
    );
  }
  const settings = await timeSettings(e.companyId);
  const tz = settings.timeZone;
  const status = await clockStatus(e.id);
  const today = localDate(new Date(), tz);
  const todays = await db.timeEntry.findMany({
    where: { employeeId: e.id, OR: [{ clockInAt: { gte: startOfLocalDay(today, tz) } }, { clockOutAt: null }] },
    include: { breaks: true, location: true },
    orderBy: { clockInAt: "asc" },
  });
  const now = new Date();
  const minutesToday = todays.reduce((s, t) => s + paidMinutes(t, now), 0);
  const acked = await db.auditLog.findFirst({ where: { actorId: user.id, companyId: e.companyId, action: "time.location_notice_ack" }, select: { id: true } });
  const usesLocation = settings.geofenceMode !== "OFF";

  return (
    <div className="clock-page">
      <p className="small"><a href="/me">← My pay</a></p>
      <h1>Time clock</h1>
      <p className="muted">{e.firstName} {e.lastName} · {company}</p>
      {usesLocation && !acked ? (
        <LocationNotice company={company} />
      ) : (
        <PunchClock
          state={status.state}
          since={(status.onBreak?.startAt ?? status.open?.clockInAt)?.toISOString() ?? null}
          breakKind={status.onBreak?.kind ?? null}
          minutesToday={minutesToday}
          requirePhoto={settings.requirePhoto}
          usesLocation={usesLocation}
          timeZone={tz}
        />
      )}
      <h2>Today</h2>
      {todays.length === 0 ? <p className="muted">No punches yet today.</p> : (
        <ul className="punch-list">
          {todays.map((t) => (
            <li key={t.id}>
              <b>{localTime(t.clockInAt, tz)}</b> to <b>{t.clockOutAt ? localTime(t.clockOutAt, tz) : "now"}</b>
              {t.location ? ` · ${t.location.name}` : ""}
              {t.breaks.length > 0 && <span className="small muted"> · {t.breaks.length} break{t.breaks.length > 1 ? "s" : ""}</span>}
              <span className="small muted"> · {formatMinutes(paidMinutes(t, now))}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Total today: {formatMinutes(minutesToday)}. Something wrong? Tell your manager to fix the punch.</p>
      {usesLocation && (
        <p className="small muted">
          Your location is checked only at the moment you punch in, punch out or take a break, to confirm you're at work.
          White Oak never tracks your location between punches. {company} can see where each punch happened.
        </p>
      )}
    </div>
  );
}
