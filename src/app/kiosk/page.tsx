import "../time.css";
import { db } from "@/lib/db";
import { Notice, messages } from "@/components/ui";
import { currentKiosk } from "@/lib/time/kiosk";
import { timeSettings, timeTrackingOn } from "@/lib/time/service";
import { KioskApp } from "./kiosk-app";

export const metadata = { title: "Time clock kiosk · White Oak Payroll" };
export const dynamic = "force-dynamic";

export default async function KioskPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { error } = await messages(searchParams);
  const k = await currentKiosk();
  if (!k) {
    return (
      <div className="kiosk">
        <h1>Time clock kiosk</h1>
        <Notice error={error} />
        <p>This device isn&apos;t set up as a kiosk. A manager can set it up from <b>Time Tracking &gt; Kiosks</b>: open the setup link on this tablet.</p>
      </div>
    );
  }
  if (!(await timeTrackingOn(k.companyId))) return <div className="kiosk"><h1>Time clock kiosk</h1><p>Time Tracking is turned off for this company.</p></div>;
  const s = await timeSettings(k.companyId);
  const employees = await db.employee.findMany({
    where: { companyId: k.companyId, status: { not: "TERMINATED" }, kioskPin: { isNot: null } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return (
    <div className="kiosk">
      <KioskApp
        company={k.company.tradeName ?? k.company.legalName}
        place={k.location?.name ?? k.name}
        timeZone={s.timeZone}
        requirePhoto={s.requirePhoto}
        useLocation={k.checkLocation && s.geofenceMode !== "OFF"}
        people={employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName.slice(0, 1)}.` }))}
      />
    </div>
  );
}
