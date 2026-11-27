import { addShift, decideCorrection, deleteShift, editShift } from "./actions";

const hm = (d: Date, tz: string) => d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Inline "Fix" form for one shift: change in and out, or delete it. */
export function EditShift({ companyId, entry, date, tz, back }: { companyId: string; entry: { id: string; clockInAt: Date; clockOutAt: Date | null }; date: string; tz: string; back: string }) {
  return (
    <details>
      <summary className="small">Fix</summary>
      <form action={editShift} className="actions" style={{ marginTop: 6 }}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <input type="hidden" name="back" value={back} />
        <input name="date" type="date" defaultValue={date} required aria-label="Day" />
        <input name="in" type="time" defaultValue={hm(entry.clockInAt, tz)} required aria-label="In" />
        <input name="out" type="time" defaultValue={entry.clockOutAt ? hm(entry.clockOutAt, tz) : ""} required aria-label="Out" />
        <input name="note" placeholder="Why" aria-label="Why" />
        <button type="submit" className="secondary">Save</button>
      </form>
      <form action={deleteShift} className="inline">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" className="link small">Delete this shift</button>
      </form>
    </details>
  );
}

export function AddShift({ companyId, employees, today, back }: { companyId: string; employees: { id: string; firstName: string; lastName: string }[]; today: string; back: string }) {
  return (
    <details className="card">
      <summary><b>Add a missed shift</b></summary>
      <form action={addShift} className="actions" style={{ marginTop: 8 }}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="back" value={back} />
        <select name="employeeId" required defaultValue="" aria-label="Employee">
          <option value="" disabled>Employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
        </select>
        <input name="date" type="date" defaultValue={today} required aria-label="Day" />
        <input name="in" type="time" required aria-label="In" />
        <input name="out" type="time" required aria-label="Out" />
        <input name="mealMinutes" type="number" min={0} max={240} placeholder="Meal min" aria-label="Unpaid meal minutes" />
        <input name="note" placeholder="Why" aria-label="Why" />
        <button type="submit">Add shift</button>
      </form>
    </details>
  );
}

export function DecideCorrection({ companyId, id, back }: { companyId: string; id: string; back: string }) {
  return (
    <form action={decideCorrection} className="actions">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="correctionId" value={id} />
      <input type="hidden" name="back" value={back} />
      <input name="decisionNote" placeholder="Note (optional)" aria-label="Note" />
      <button type="submit" name="decision" value="approve">Approve</button>
      <button type="submit" name="decision" value="decline" className="secondary">Decline</button>
    </form>
  );
}
