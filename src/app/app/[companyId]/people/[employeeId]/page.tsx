import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Field, Notice, dateStr, messages, prettyDate } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { completeI9, rehireEmployee, resendEmployeeInvite, terminateEmployee, updateEmployee } from "../../actions";
import { i9Deadlines } from "@/lib/onboarding/i9";
import { loginStatus } from "@/lib/app/invites";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ companyId: string; employeeId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId, employeeId } = await params;
  await requireArea(companyId, "people");
  const { error, ok } = await messages(searchParams);
  const e = await db.employee.findFirst({ where: { id: employeeId, companyId }, include: { user: true } });
  if (!e) notFound();
  const schedules = await db.paySchedule.findMany({ where: { companyId } });
  const waiting = !!e.selfOnboardingInvitedAt && !e.selfOnboardingDoneAt && e.status !== "TERMINATED";
  const needsI9 = !!e.selfOnboardingDoneAt && !e.i9CompletedAt && e.status !== "TERMINATED";
  const s1 = e.i9Section1 as Record<string, unknown> | null;
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
      {waiting && (
        <div className="card">
          <p><b>Waiting on {e.firstName}</b> to enter their SSN, address, W-4, state form, bank account and I-9 Section 1. Portal login: {loginStatus(e.user).label}.</p>
          <p className="small muted">They aren&apos;t on pay runs until they finish. You can change their job and pay below meanwhile.</p>
          <form action={resendEmployeeInvite}>{hidden}<button type="submit" className="secondary">Resend the email</button></form>
        </div>
      )}
      {needsI9 && (
        <div className="card">
          <p><b>{e.firstName} finished their part.</b> Now complete I-9 Section 2 by <b>{prettyDate(new Date(`${i9Deadlines(dateStr(e.hireDate)).section2}T00:00:00Z`))}</b>: look at their original documents in person (one from List A, or one from List B and one from List C).</p>
          {s1 && <p className="small">Section 1 signed by {String(s1.signature ?? "")} on {String(s1.signedAt ?? "").slice(0, 10)}: {String(s1.statusLabel ?? s1.status ?? "")}.</p>}
          <form action={completeI9} className="form">
            {hidden}
            <Field label="Documents examined" hint="e.g. U.S. passport; or driver's license + Social Security card"><input name="documents" required /></Field>
            <label className="check"><input type="checkbox" name="examined" required /> I examined the original documents and they appear genuine and relate to this person.</label>
            <button type="submit">Complete I-9 and activate</button>
          </form>
        </div>
      )}
      <EmployeeForm companyId={companyId} schedules={schedules} e={e} action={updateEmployee} submit="Save changes" quick={waiting} />
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
