import { timeTrackingOn } from "@/lib/time/service";
import { fillHoursFromTime } from "./actions";

/** On a draft pay run: fill the hours grid from Time Tracking punches (shown only when the add-on is on). */
export async function FillHoursFromTime({ companyId, payRunId, period }: { companyId: string; payRunId: string; period: string }) {
  if (!(await timeTrackingOn(companyId))) return null;
  return (
    <div className="card">
      <form action={fillHoursFromTime} className="actions">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="payRunId" value={payRunId} />
        <button type="submit">Fill hours from Time Tracking</button>
        <span className="small muted">Regular and overtime hours punched {period}. <a href={`/app/${companyId}/time/timesheets`}>Review timesheets</a></span>
      </form>
    </div>
  );
}
