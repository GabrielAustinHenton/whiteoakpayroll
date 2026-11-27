import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function AppIndex() {
  const user = await requireUser();
  const ids = user.memberships.filter((m) => m.role !== "EMPLOYEE").map((m) => m.companyId);
  if (user.isStaff && ids.length === 0) redirect("/ops");
  if (user.isPlatformAdmin && ids.length === 0) redirect("/admin");
  if (user.memberships.length === 0 && user.staffStatus) redirect("/staff/pending");
  if (ids.length === 0) redirect("/me");
  if (ids.length === 1) redirect(`/app/${ids[0]}`);
  const companies = await db.company.findMany({ where: { id: { in: ids } }, orderBy: { legalName: "asc" } });
  return (
    <>
      <h1>Your companies</h1>
      <ul>
        {companies.map((c) => (
          <li key={c.id}><a href={`/app/${c.id}`}>{c.legalName}</a></li>
        ))}
      </ul>
    </>
  );
}
