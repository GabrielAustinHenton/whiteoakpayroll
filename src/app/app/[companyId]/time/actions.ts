"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWrite } from "@/lib/auth/session";
import { audit } from "@/lib/app/payroll-service";
import { TIME_ZONES } from "@/lib/time/clock";
import { timeSettings } from "@/lib/time/service";
import { str } from "@/components/ui";

const go = (path: string, msg: { error?: string; ok?: string } = {}): never => {
  const q = msg.error ? `?error=${encodeURIComponent(msg.error)}` : msg.ok ? `?ok=${encodeURIComponent(msg.ok)}` : "";
  redirect(path + q);
};

function readLocation(form: FormData) {
  const latitude = Number(str(form.get("latitude")));
  const longitude = Number(str(form.get("longitude")));
  const radiusMeters = Math.round(Number(str(form.get("radiusMeters"))));
  const name = str(form.get("name"));
  if (!name) return { error: "Give the location a name, like \"Main shop\"." };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0))
    return { error: "Place the pin on the map (search the address, or tap the map)." };
  if (!(radiusMeters >= 30 && radiusMeters <= 5000)) return { error: "Choose a radius between 30 and 5,000 meters (about 100 feet to 3 miles)." };
  return { data: { name, address: str(form.get("address")) || null, latitude, longitude, radiusMeters } };
}

export async function saveLocation(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const back = `/app/${companyId}/time/locations`;
  const r = readLocation(form);
  if (r.error) go(back, { error: r.error });
  const locationId = str(form.get("locationId"));
  if (locationId) {
    await db.workLocation.update({ where: { id: (await db.workLocation.findFirstOrThrow({ where: { id: locationId, companyId } })).id }, data: r.data! });
    await audit(user.id, companyId, "time.location_updated", { locationId, ...r.data! });
    go(back, { ok: `Saved ${r.data!.name}.` });
  }
  const created = await db.workLocation.create({ data: { companyId, ...r.data! } });
  await audit(user.id, companyId, "time.location_added", { locationId: created.id, ...r.data! });
  go(back, { ok: `Added ${created.name}. Employees can punch within ${created.radiusMeters} meters of the pin.` });
}

export async function setLocationActive(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  const loc = await db.workLocation.findFirstOrThrow({ where: { id: str(form.get("locationId")), companyId } });
  const active = str(form.get("active")) === "true";
  await db.workLocation.update({ where: { id: loc.id }, data: { active } });
  await audit(user.id, companyId, active ? "time.location_reactivated" : "time.location_archived", { locationId: loc.id });
  go(`/app/${companyId}/time/locations`, { ok: active ? `${loc.name} is active again.` : `${loc.name} archived. Past punches keep it.` });
}

export async function saveTimeSettings(form: FormData) {
  const companyId = str(form.get("companyId"));
  const { user } = await requireWrite(companyId, "payroll");
  await timeSettings(companyId);
  const mode = str(form.get("geofenceMode"));
  const tz = str(form.get("timeZone"));
  const acc = Math.round(Number(str(form.get("maxAccuracyMeters"))));
  const week = Number(str(form.get("weekStartsOn")));
  const data = {
    geofenceMode: mode === "FLAG" ? "FLAG" : mode === "OFF" ? "OFF" : "BLOCK",
    maxAccuracyMeters: acc >= 10 && acc <= 1000 ? acc : 100,
    requirePhoto: form.get("requirePhoto") === "on",
    timeZone: TIME_ZONES.some(([z]) => z === tz) ? tz : "America/New_York",
    weekStartsOn: Number.isInteger(week) && week >= 0 && week <= 6 ? week : 0,
  } as const;
  await db.timeSettings.update({ where: { companyId }, data });
  await audit(user.id, companyId, "time.settings_updated", data);
  go(`/app/${companyId}/time/settings`, { ok: "Time Tracking settings saved." });
}
