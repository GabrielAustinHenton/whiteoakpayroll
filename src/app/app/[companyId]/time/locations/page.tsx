import "../../../../time.css";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, messages } from "@/components/ui";
import { managesTime } from "@/lib/time/access";
import { timeTrackingOn } from "@/lib/time/service";
import { LocationPicker } from "./location-picker";
import { saveLocation, setLocationActive } from "../actions";
import { TimeTabs } from "../tabs";

const STATE_CENTER: Record<string, [number, number]> = { CT: [41.6, -72.7], MA: [42.3, -71.8], OR: [45.5, -122.65], NY: [42.9, -75.5] };

export default async function LocationsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { role } = await requireArea(companyId, "reports");
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();
  const manage = managesTime(role, company);
  const { error, ok, sp } = await messages(searchParams);
  const on = await timeTrackingOn(companyId);
  const locations = await db.workLocation.findMany({ where: { companyId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const editing = typeof sp.edit === "string" ? locations.find((l) => l.id === sp.edit) : undefined;
  const center = STATE_CENTER[company.state];

  return (
    <>
      <h1>Work locations</h1>
      <TimeTabs companyId={companyId} manage={manage} />
      <Notice error={error} ok={ok} />
      {!on && <p className="notice">Time Tracking is off. Turn it on in <a href={`/app/${companyId}/billing`}>Plan and billing</a> before employees can punch.</p>}
      <p className="muted">
        Employees can punch in only inside one of these circles (or punches outside are flagged, depending on <a href={`/app/${companyId}/time/settings`}>settings</a>).
        Add every site people report to.
      </p>
      {locations.length === 0 ? <p className="muted">No work locations yet. Until you add one, punches are not checked against a place.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Address</th><th className="num">Radius</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className={l.active ? "" : "muted"}>
                <td>{l.name} {!l.active && <span className="badge terminated">archived</span>}</td>
                <td className="small">{l.address ?? ""} <a className="small" href={`https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=18/${l.latitude}/${l.longitude}`} target="_blank" rel="noreferrer">map</a></td>
                <td className="num">{l.radiusMeters} m</td>
                <td>
                  {manage && <span className="actions">
                    <a href={`?edit=${l.id}`}>Edit</a>
                    <form action={setLocationActive} className="inline">
                      <input type="hidden" name="companyId" value={companyId} />
                      <input type="hidden" name="locationId" value={l.id} />
                      <input type="hidden" name="active" value={l.active ? "false" : "true"} />
                      <button type="submit" className="link small">{l.active ? "Archive" : "Reactivate"}</button>
                    </form>
                  </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {manage && (
        <>
          <h2>{editing ? `Edit ${editing.name}` : "Add a work location"}</h2>
          <form action={saveLocation} className="form" key={editing?.id ?? "new"}>
            <input type="hidden" name="companyId" value={companyId} />
            {editing && <input type="hidden" name="locationId" value={editing.id} />}
            <Field label="Name"><input name="name" required defaultValue={editing?.name ?? ""} placeholder="Main shop" /></Field>
            <LocationPicker latitude={editing?.latitude} longitude={editing?.longitude} radiusMeters={editing?.radiusMeters} address={editing?.address ?? ""} center={center} />
            <div className="actions">
              <button type="submit">{editing ? "Save location" : "Add location"}</button>
              {editing && <a href={`/app/${companyId}/time/locations`}>Cancel</a>}
            </div>
          </form>
        </>
      )}
    </>
  );
}
