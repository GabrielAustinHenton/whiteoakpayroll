import { db } from "@/lib/db";
import { requireArea } from "@/lib/auth/session";
import { Notice, messages } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { createEmployee } from "../../actions";

export default async function NewEmployee({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { companyId } = await params;
  await requireArea(companyId, "people");
  const { error } = await messages(searchParams);
  const schedules = await db.paySchedule.findMany({ where: { companyId } });
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  return (
    <>
      <h1>Add an employee</h1>
      <Notice error={error} />
      {schedules.length === 0 ? (
        <p className="notice">The company owner needs to create a pay schedule first (Company settings).</p>
      ) : (
        <EmployeeForm companyId={companyId} schedules={schedules} action={createEmployee} submit="Add employee" companyState={company.state} />
      )}
    </>
  );
}
