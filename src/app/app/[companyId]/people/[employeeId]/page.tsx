import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, dateStr, messages, prettyDate } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { rehireEmployee, resendPortalInvite, terminateEmployee, updateEmployee } from "../../actions";
import { loginStatus } from "@/lib/app/invites";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ companyId: string; employeeId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId, employeeId } = await params;
  await requireArea(companyId, "people");
  const { error, ok } = await messages(searchParams);
  const e = await db.employee.findFirst({ where: { id: employeeId, companyId }, include: { user: true } });
  if (!e) notFound();
  const schedules = await db.paySchedule.findMany({ where: { companyId } });
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
      <div className="card">
        <p>
          <b>Employee portal:</b> {e.user ? `${loginStatus(e.user).label} (${e.user.email})` : "no login"}
          {e.user && loginStatus(e.user).pending && (
            <form action={resendPortalInvite} className="inline"> {hidden}<button type="submit" className="link small">Resend the invite email</button></form>
          )}
        </p>
        <p className="small muted">The invite goes to the email on file. Change the email below and save to send it to a new address.</p>
      </div>
      {e.status === "TERMINATED" ? (
        <div className="card">
          <p>Offboarded {prettyDate(e.terminationDate)}{e.terminationReason ? ` (${e.terminationReason})` : ""}.</p>
          <form action={rehireEmployee}>{hidden}<button type="submit" className="secondary">Rehire</button></form>
        </div>
      ) : null}
      <EmployeeForm companyId={companyId} schedules={schedules} e={e} action={updateEmployee} submit="Save changes" />
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
