import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, dateStr, messages, prettyDate } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { onboardingTasks, stateCertificateDuties } from "@/lib/onboarding";
import type { LaunchState } from "@/lib/tax-engine/state";
import { rehireEmployee, terminateEmployee, updateEmployee } from "../../actions";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ companyId: string; employeeId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId, employeeId } = await params;
  await requireArea(companyId, "people");
  const { error, ok } = await messages(searchParams);
  const e = await db.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!e) notFound();
  const schedules = await db.paySchedule.findMany({ where: { companyId } });
  const [latestW4, stateCert, i9] = await Promise.all([
    db.w4Certificate.findFirst({ where: { employeeId, supersededAt: null }, orderBy: { createdAt: "desc" } }),
    db.stateWithholdingCertificate.findFirst({ where: { employeeId, state: e.workState, supersededAt: null }, orderBy: { createdAt: "desc" } }),
    db.i9Record.findUnique({ where: { employeeId } }),
  ]);
  const ws = e.workState as LaunchState;
  const done: Record<string, boolean> = {
    w4: !!latestW4,
    state_w4: !!stateCert,
    i9_section1: !!i9?.section1CompletedAt,
    i9_section2: !!i9?.section2CompletedAt,
    new_hire_report: false,
  };
  const tasks = e.status === "TERMINATED" ? [] : onboardingTasks({ firstDay: dateStr(i9?.firstDayOfEmployment ?? e.hireDate), workState: ws });
  const duties = stateCert && ws === "NY"
    ? stateCertificateDuties({ state: "NY", form: { status: "single_or_hoh", nycResident: false, yonkersResident: false, line1: Number((stateCert.data as Record<string, unknown>).allowances ?? 0), line2: Number((stateCert.data as Record<string, unknown>).nycAllowances ?? 0), additionalState: 0, additionalNyc: 0, additionalYonkers: 0, signature: { name: "on file", signedAt: "" } } }, { receivedOn: dateStr(stateCert.createdAt) })
    : [];
  const hidden = (
    <>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="employeeId" value={e.id} />
    </>
  );
  return (
    <>
      <h1>{e.firstName} {e.lastName} <span className={`badge ${e.status.toLowerCase()}`}>{e.status.toLowerCase()}</span></h1>
      <Notice error={error} ok={ok} />
      {e.status === "TERMINATED" ? (
        <div className="card">
          <p>Offboarded {prettyDate(e.terminationDate)}{e.terminationReason ? ` (${e.terminationReason})` : ""}.</p>
          <form action={rehireEmployee}>{hidden}<button type="submit" className="secondary">Rehire</button></form>
        </div>
      ) : null}
      {tasks.length > 0 && (
        <div className="card">
          <h2>Onboarding forms</h2>
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                {done[t.id] ? "Done" : `Due ${t.due}`}: {t.title}
                <span className="small muted"> ({t.id === "new_hire_report" ? "you, for now: White Oak doesn't file new-hire reports yet" : t.owner === "employee" ? "employee" : "you"})</span>
                {!done[t.id] && t.ifMissing ? <span className="small muted"> {t.ifMissing}</span> : null}
              </li>
            ))}
          </ul>
          {duties.map((x) => <p key={x.action} className="small"><b>Send to the state:</b> {x.action}{x.due ? ` Due ${x.due}.` : ""}</p>)}
        </div>
      )}
      {i9?.retainUntil && <p className="small muted">Keep their Form I-9 until {dateStr(i9.retainUntil)}, then destroy it.</p>}
      <EmployeeForm companyId={companyId} schedules={schedules} e={e} action={updateEmployee} submit="Save changes" latestW4={latestW4?.data} i9={i9} />
      {e.status !== "TERMINATED" && (
        <>
          <h2>Offboard</h2>
          <form action={terminateEmployee} className="form">
            {hidden}
            <div className="row">
              <Field label="Last day"><input type="date" name="terminationDate" defaultValue={dateStr(new Date())} required /></Field>
              <Field label="Reason">
                <select name="reason" defaultValue="Resigned">
                  <option>Resigned</option>
                  <option>Laid off</option>
                  <option>Fired</option>
                  <option>Retired</option>
                </select>
              </Field>
            </div>
            <button type="submit" className="danger">Offboard employee</button>
          </form>
        </>
      )}
    </>
  );
}
