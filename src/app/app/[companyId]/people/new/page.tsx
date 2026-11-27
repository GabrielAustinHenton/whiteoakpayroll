import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages, usd } from "@/components/ui";
import { featuresFor } from "@/lib/app/features";
import { refreshInvoice } from "@/lib/app/payroll-service";
import { monthlyBill } from "@/lib/pricing";
import { EmployeeForm } from "../employee-form";
import { createEmployee } from "../../actions";

export default async function NewEmployee({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  const { mode } = await requireArea(companyId, "add_people");
  const { error, sp } = await messages(searchParams);
  const schedules = await db.paySchedule.findMany({ where: { companyId } });
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const selfOnboarding = featuresFor(company).employeeSelfOnboarding;
  const quick = selfOnboarding && sp.full !== "1";
  const bill = await refreshInvoice(companyId, new Date().toISOString().slice(0, 7));
  const after = monthlyBill(bill.peopleCount + 1, bill.addOns.map((a) => a.key));
  const base = `/app/${companyId}/people/new`;
  return (
    <>
      <h1>Add an employee</h1>
      <Notice error={error} />
      {schedules.length === 0 ? (
        <p className="notice">
          {mode === "MANAGED" ? "White Oak sets up the pay schedule first. Once it is in place you can add employees here." : <>Choose a pay schedule first in the <a href={`/app/${companyId}/setup?step=schedule`}>setup guide</a>.</>}
        </p>
      ) : (
        <>
          {selfOnboarding && (
            <p className="small">
              {quick ? <>You enter the job and pay; they fill in the rest. <a href={`${base}?full=1`}>Enter everything myself instead</a></> : <>Entering everything yourself. <a href={base}>Let them fill in their own details instead</a> (recommended)</>}
            </p>
          )}
          {mode === "SELF_SERVE" && (
            <p className="small muted">
              {after.total === bill.total
                ? `Your White Oak fee this month stays ${usd(bill.total)}.`
                : `Adding them moves this month's White Oak fee from ${usd(bill.total)} to ${usd(after.total)} (${after.tierRange!.from} to ${after.tierRange!.to} people).`}
            </p>
          )}
          <EmployeeForm companyId={companyId} schedules={schedules} action={createEmployee} submit={quick ? "Add and email them" : "Add employee"} companyState={company.state} quick={quick} />
        </>
      )}
    </>
  );
}
