import "../../../../time.css";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, messages, prettyDate } from "@/components/ui";
import { managesTime } from "@/lib/time/access";
import { timeTrackingOn } from "@/lib/time/service";
import { createKiosk, newKioskLink, revokeKiosk, setEmployeePin } from "../actions";
import { TimeTabs } from "../tabs";

export default async function KiosksPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  if (!(await timeTrackingOn(companyId))) notFound();
  const manage = managesTime(role, company);
  const { error, ok, sp } = await messages(searchParams);
  const [kiosks, locations, employees] = await Promise.all([
    db.kiosk.findMany({ where: { companyId }, include: { location: true }, orderBy: { createdAt: "asc" } }),
    db.workLocation.findMany({ where: { companyId, active: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { companyId, status: { not: "TERMINATED" } }, include: { kioskPin: { select: { updatedAt: true, lockedUntil: true } } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
  ]);
  const h = await headers();
  const origin = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const setup = manage && typeof sp.setup === "string" ? `${origin}/kiosk/setup/${sp.setup}` : null;
  const setupFor = kiosks.find((k) => k.id === sp.kiosk);

  return (
    <>
      <h1>Kiosks</h1>
      <TimeTabs companyId={companyId} manage={manage} />
      <Notice error={error} ok={ok} />
      <p className="muted">
        A kiosk is a shared tablet at the job site, for employees who don&apos;t punch from their own phone. They tap their name and type a 4 to 6 digit PIN.
        Turn on &ldquo;Photo at punch&rdquo; in settings to take a picture at each kiosk punch, so nobody punches for a coworker.
      </p>
      {setup && (
        <div className="card">
          <p><b>Open this link on the tablet{setupFor ? ` for ${setupFor.name}` : ""}</b> (once, within 24 hours). It turns that browser into the kiosk.</p>
          <p><code style={{ wordBreak: "break-all" }}>{setup}</code></p>
          <p className="small muted">Then add it to the tablet&apos;s home screen and turn on guided access or screen pinning so it stays on the time clock. The link stops working after one use.</p>
        </div>
      )}
      <h2>Tablets</h2>
      {kiosks.length === 0 ? <p className="muted">No kiosks yet.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Location</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {kiosks.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>{k.location?.name ?? <span className="muted">none</span>}{k.checkLocation && <div className="small muted">checks tablet GPS</div>}</td>
                <td className="small">{k.revokedAt ? <span className="badge terminated">off</span> : k.deviceTokenHash ? <>set up{k.lastSeenAt ? `, last used ${prettyDate(k.lastSeenAt)}` : ""}</> : k.setupExpiresAt && k.setupExpiresAt > new Date() ? "waiting for setup link" : "setup link expired"}</td>
                <td>
                  {manage && <span className="actions">
                    <form action={newKioskLink} className="inline"><input type="hidden" name="companyId" value={companyId} /><input type="hidden" name="kioskId" value={k.id} /><button type="submit" className="link small">{k.deviceTokenHash ? "Move to a new tablet" : "New setup link"}</button></form>
                    {!k.revokedAt && <form action={revokeKiosk} className="inline"><input type="hidden" name="companyId" value={companyId} /><input type="hidden" name="kioskId" value={k.id} /><button type="submit" className="link small">Turn off</button></form>}
                  </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {manage && (
        <details className="card" open={kiosks.length === 0}>
          <summary><b>Add a kiosk</b></summary>
          <form action={createKiosk} className="form" style={{ marginTop: 8 }}>
            <input type="hidden" name="companyId" value={companyId} />
            <Field label="Name"><input name="name" placeholder="Front desk tablet" /></Field>
            <Field label="Where it is" hint="Punches on this tablet count at this work location.">
              <select name="locationId" defaultValue={locations[0]?.id ?? ""}>
                <option value="">No location</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <label className="check"><input type="checkbox" name="checkLocation" /> <span>Also check the tablet&apos;s GPS at each punch (only if the tablet shares its location; otherwise leave off)</span></label>
            <button type="submit">Create kiosk and get setup link</button>
          </form>
        </details>
      )}
      <h2>Employee PINs</h2>
      <p className="small muted">Only people with a PIN appear on the kiosk. Leave the box empty to make a random PIN. PINs lock for 15 minutes after 5 wrong tries.</p>
      <table>
        <thead><tr><th>Employee</th><th>PIN</th>{manage && <th>Set PIN</th>}</tr></thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id}>
              <td>{e.firstName} {e.lastName}</td>
              <td className="small">{e.kioskPin ? <>set {prettyDate(e.kioskPin.updatedAt)}{e.kioskPin.lockedUntil && e.kioskPin.lockedUntil > new Date() ? <span className="flag serious">locked</span> : null}</> : <span className="muted">none</span>}</td>
              {manage && (
                <td>
                  <form action={setEmployeePin} className="actions">
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="employeeId" value={e.id} />
                    <input name="pin" inputMode="numeric" pattern="\d{4,6}" placeholder="random" autoComplete="off" aria-label={`PIN for ${e.firstName} ${e.lastName}`} style={{ width: "7rem" }} />
                    <button type="submit" className="secondary">{e.kioskPin ? "Reset" : "Set"}</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
