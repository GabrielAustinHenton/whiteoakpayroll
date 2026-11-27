import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, messages } from "@/components/ui";
import { managesTime } from "@/lib/time/access";
import { TIME_ZONES } from "@/lib/time/clock";
import { timeSettings, timeTrackingOn } from "@/lib/time/service";
import { saveTimeSettings } from "../actions";
import { TimeTabs } from "../tabs";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TimeSettingsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  const manage = managesTime(role, company);
  const { error, ok } = await messages(searchParams);
  const s = await timeSettings(companyId);
  const on = await timeTrackingOn(companyId);
  return (
    <>
      <h1>Time Tracking settings</h1>
      <TimeTabs companyId={companyId} manage={manage} />
      <Notice error={error} ok={ok} />
      {!on && <p className="notice">Time Tracking is off. Turn it on in <a href={`/app/${companyId}/billing`}>Plan and billing</a>.</p>}
      <form action={saveTimeSettings} className="form">
        <input type="hidden" name="companyId" value={companyId} />
        <fieldset disabled={!manage}>
          <legend>Location check (geofence)</legend>
          <label className="check"><input type="radio" name="geofenceMode" value="BLOCK" defaultChecked={s.geofenceMode === "BLOCK"} /> <span><b>Require being at work.</b> Punching in (or back from a break) away from every work location is refused. Punching out anywhere is allowed and flagged, so paid time never keeps running.</span></label>
          <label className="check"><input type="radio" name="geofenceMode" value="FLAG" defaultChecked={s.geofenceMode === "FLAG"} /> <span><b>Allow, but flag.</b> Punches away from work go through and are marked for you to review. Good for crews that sometimes start at a customer&apos;s site.</span></label>
          <label className="check"><input type="radio" name="geofenceMode" value="OFF" defaultChecked={s.geofenceMode === "OFF"} /> <span><b>Don&apos;t check location.</b> The phone is not asked for its location.</span></label>
          <Field label="Flag GPS fixes weaker than (meters)" hint="Phones usually report 5 to 50 meters outdoors. Weak fixes that could be inside the circle are allowed and flagged.">
            <input name="maxAccuracyMeters" type="number" min={10} max={1000} defaultValue={s.maxAccuracyMeters} />
          </Field>
        </fieldset>
        <fieldset disabled={!manage}>
          <legend>Photo at punch</legend>
          <label className="check"><input type="checkbox" name="requirePhoto" defaultChecked={s.requirePhoto} /> <span>Ask for a selfie when punching in and out, so a coworker can&apos;t punch for someone else. Photos are small and only managers see them.</span></label>
        </fieldset>
        <fieldset disabled={!manage}>
          <legend>Workdays and workweek</legend>
          <Field label="Time zone">
            <select name="timeZone" defaultValue={s.timeZone}>{TIME_ZONES.map(([z, n]) => <option key={z} value={z}>{n} ({z})</option>)}</select>
          </Field>
          <Field label="Workweek starts on" hint="Overtime is counted over a fixed 7-day workweek. Keep it the same week to week; changing it to dodge overtime is not allowed.">
            <select name="weekStartsOn" defaultValue={String(s.weekStartsOn)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </Field>
        </fieldset>
        {manage && <p><button type="submit">Save settings</button></p>}
      </form>
      <h2>Privacy</h2>
      <p className="small muted">
        White Oak reads an employee&apos;s location only at the moment they tap a punch button, never in the background. Before their first punch, employees
        see a notice explaining this and confirm they read it (Connecticut and New York require written notice of electronic monitoring). Blocked punch
        attempts are kept so you can see who tried to punch from where.
      </p>
    </>
  );
}
